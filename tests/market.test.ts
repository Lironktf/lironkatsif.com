import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Market, MarketError } from '../src/lib/market/market';
import { MemoryStore } from '../src/lib/market/store';
import asks from '../src/data/asks.json';

const cfg: any = {
  cluster: 'devnet', envHalted: false, recipient: 'GQWyY1KZUp4ZXWh3mEMc83ibA4fWHRKcPKc9qMfEeVWy',
  usdcMint: 'x', rpc: 'x', bookingUrl: 'https://cal.com/x', contactEmail: 'a@b.c', adminToken: 't',
  orderTtlSec: 900,
};
let n = 0;
const ref = () => `ref${++n}`;

function setup(over: Partial<typeof cfg> = {}) {
  const payments = new Map<string, string>(); // ref -> sig
  const notes: string[] = [];
  const store = new MemoryStore();
  const m = new Market(store, { ...cfg, ...over }, async (r) => (payments.has(r) ? { sig: payments.get(r)! } : null),
    async (t) => { notes.push(t); });
  return { m, store, payments, notes };
}
const cheapest = Math.min(...asks.levels.map((l) => l.price));
const cheapSize = asks.levels.find((l) => l.price === cheapest)!.size;
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as MarketError).code; } };

test('book seeds inventory from asks.json', async () => {
  const { m } = setup();
  const b = await m.book();
  assert.equal(b.levels.length, asks.levels.length);
  assert.equal(b.levels.find((l) => l.price === cheapest)!.size, cheapSize);
  assert.equal(b.halted, false);
});

test('halted by env, by missing recipient, and by admin override', async () => {
  assert.equal(await code(setup({ envHalted: true }).m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref)), 'halted');
  assert.equal(await code(setup({ recipient: '' }).m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref)), 'halted');
  const { m } = setup();
  await m.setHalt(true);
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref)), 'halted');
  await m.setHalt(false);
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref)), 'ok');
});

test('order reserves inventory, rejects unknown price and bad size, and cannot oversell', async () => {
  const { m } = setup();
  assert.equal(await code(m.createOrder({ price: 0.37, qty: 1 }, 'ip', ref)), 'bad_request');
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 0 }, 'ip', ref)), 'bad_request');
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1.5 }, 'ip', ref)), 'bad_request');
  for (let i = 0; i < cheapSize; i++) await m.createOrder({ price: cheapest, qty: 1 }, 'ip' + i, ref);
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1 }, 'ipx', ref)), 'sold_out');
  const b = await m.book();
  assert.equal(b.levels.find((l) => l.price === cheapest)!.size, 0);
});

test('amount is computed server-side, never taken from the client', async () => {
  const { m } = setup();
  const o = await m.createOrder({ price: cheapest, qty: 2, amount: 0.0001 }, 'ip', ref);
  assert.equal(o.amount, Math.round(cheapest * 2 * 100) / 100);
});

test('confirm: pending until paid, then filled once, trade printed, owner notified', async () => {
  const { m, payments, notes } = setup();
  const o = await m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref);
  assert.equal((await m.confirm(o.ref)).status, 'pending');
  payments.set(o.ref, 'SIG1');
  assert.equal((await m.confirm(o.ref)).status, 'filled');
  assert.equal((await m.confirm(o.ref)).status, 'filled'); // idempotent
  const b = await m.book();
  assert.equal(b.trades.length, 1);
  assert.equal(b.trades[0].sig, 'SIG1');
  assert.equal(notes.filter((t) => t.startsWith('FILLED')).length, 1);
});

test('concurrent confirms of the same order record exactly one trade', async () => {
  const { m, payments } = setup();
  const o = await m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref);
  payments.set(o.ref, 'SIGC');
  await Promise.all(Array.from({ length: 10 }, () => m.confirm(o.ref)));
  assert.equal((await m.book()).trades.length, 1);
});

test('one transaction cannot pay for two orders', async () => {
  const { m, payments } = setup();
  const a = await m.createOrder({ price: cheapest, qty: 1 }, 'ip1', ref);
  const b = await m.createOrder({ price: cheapest, qty: 1 }, 'ip2', ref);
  payments.set(a.ref, 'SAME');
  payments.set(b.ref, 'SAME');
  assert.equal((await m.confirm(a.ref)).status, 'filled');
  assert.equal(await code(m.confirm(b.ref)), 'invalid_payment');
});

test('unpaid orders expire and release inventory; late payment still fills and flags oversell', async () => {
  const { m, payments, notes } = setup({ orderTtlSec: 0 });
  const orders = [];
  for (let i = 0; i < cheapSize; i++) orders.push(await m.createOrder({ price: cheapest, qty: 1 }, 'ip' + i, ref));
  await new Promise((r) => setTimeout(r, 5));
  let b = await m.book(); // sweeps
  assert.equal(b.levels.find((l) => l.price === cheapest)!.size, cheapSize);
  // someone else buys out the level, then the expired order gets paid late
  const fresh = setup(); // independent sanity: confirm on expired order
  for (let i = 0; i < cheapSize; i++) await m.createOrder({ price: cheapest, qty: 1 }, 'buy' + i, ref);
  payments.set(orders[0].ref, 'LATE');
  const r = await m.confirm(orders[0].ref);
  assert.equal(r.status, 'filled');
  assert.equal(r.order.oversold, true);
  assert.ok(notes.some((t) => t.includes('oversold')));
  void fresh;
});

test('unknown order is not_found', async () => {
  assert.equal(await code(setup().m.confirm('nope')), 'not_found');
});

test('bids: validated, contact required, honeypot, contact and ip never public, rate limited', async () => {
  const { m } = setup();
  assert.equal(await code(m.placeBid({ price: 1, size: 1 }, 'ip')), 'bad_request');
  assert.equal(await code(m.placeBid({ price: -1, size: 1, contact: 'x' }, 'ip')), 'bad_request');
  assert.equal(await code(m.placeBid({ price: 1, size: 0, contact: 'x' }, 'ip')), 'bad_request');
  assert.equal(await code(m.placeBid({ price: 1, size: 1, contact: 'x', website: 'spam' }, 'ip')), 'bad_request');
  const bid = await m.placeBid({ price: 0.333, size: 2, note: 'help', contact: 'me@x.com' }, 'ip');
  assert.equal(bid.price, 0.33);
  const pub = (await m.book()).bids[0] as any;
  assert.equal(pub.contact, undefined);
  assert.equal(pub.ip, undefined);
  for (let i = 0; i < 4; i++) await m.placeBid({ price: 1, size: 1, contact: 'c' }, 'ip');
  assert.equal(await code(m.placeBid({ price: 1, size: 1, contact: 'c' }, 'ip')), 'rate_limited');
  const admin = await m.adminState();
  assert.equal(admin.bids.length, 5);
  assert.equal(admin.bids.some((b) => b.contact === 'me@x.com'), true);
  await m.deleteBid(bid.id);
  assert.equal((await m.book()).bids.length, 4);
});

test('admin can set inventory but not for unknown levels', async () => {
  const { m } = setup();
  await m.setInventory(cheapest, 7);
  assert.equal((await m.book()).levels.find((l) => l.price === cheapest)!.size, 7);
  assert.equal(await code(m.setInventory(0.37, 1)), 'bad_request');
  assert.equal(await code(m.setInventory(cheapest, -1)), 'bad_request');
});

test('owner test mode: desk halt blocks the public but not the owner; env halt blocks everyone', async () => {
  const { m } = setup();
  await m.setHalt(true);
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1 }, 'pub', ref)), 'halted');
  assert.equal(await code(m.placeBid({ price: 0.1, size: 1, contact: 'c' }, 'pub')), 'halted');
  assert.equal(await code(m.createOrder({ price: cheapest, qty: 1 }, 'own', ref, true)), 'ok');
  assert.equal(await code(m.placeBid({ price: 0.1, size: 1, contact: 'c' }, 'own', true)), 'ok');
  assert.equal(await m.isHalted(false), true);
  assert.equal(await m.isHalted(true), false);
  const env = setup({ envHalted: true }).m;
  assert.equal(await code(env.createOrder({ price: cheapest, qty: 1 }, 'own', ref, true)), 'halted');
  const norecip = setup({ recipient: '' }).m;
  assert.equal(await code(norecip.createOrder({ price: cheapest, qty: 1 }, 'own', ref, true)), 'halted');
});

test('reset-tape clears trades and restores inventory', async () => {
  const { m, payments } = setup();
  const o = await m.createOrder({ price: cheapest, qty: 1 }, 'ip', ref);
  payments.set(o.ref, 'SIGR');
  await m.confirm(o.ref);
  assert.equal((await m.book()).trades.length, 1);
  await m.resetTape();
  const b = await m.book();
  assert.equal(b.trades.length, 0);
  assert.equal(b.levels.find((l) => l.price === cheapest)!.size, cheapSize);
});
