// End-to-end test of the market against a LOCAL solana-test-validator.
// Never points at mainnet. Usage (see docs/MARKET.md):
//   npx tsx scripts/e2e-local.ts <fixtures.json> [baseUrl]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Connection, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildUsdcTransfer } from '../src/islands/orderbook/transfer';

const [fixturesPath, base = 'http://localhost:4321'] = process.argv.slice(2);
const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(fx.payer));
const RPC = 'http://127.0.0.1:8899';
const conn = new Connection(RPC, 'confirmed');

async function api(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
async function pay(order: any) {
  const tx = await buildUsdcTransfer(conn, payer.publicKey, order);
  return await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
}
async function waitFill(ref: string) {
  for (let i = 0; i < 20; i++) {
    const r = await api('/api/confirm', { ref });
    if (r.body.status === 'filled' || r.status !== 200) return r;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error('timed out waiting for fill');
}
const ok = (m: string) => console.log('  ✔', m);

assert.equal((await api('/api/book')).body.halted, false);
ok('market open');

// 1. a real purchase
const o = await api('/api/order', { price: 1, qty: 2, amount: 0.01 });
assert.equal(o.status, 201);
assert.equal(o.body.amount, 2, 'amount is computed by the server');
assert.ok(o.body.url.startsWith('solana:'));
ok(`order created, server priced it at ${o.body.amount} USDC`);
assert.equal((await api('/api/confirm', { ref: o.body.ref })).body.status, 'pending');
ok('confirm before paying: pending');
const sig = await pay(o.body);
const f = await waitFill(o.body.ref);
assert.equal(f.body.status, 'filled');
assert.equal(f.body.sig, sig);
ok(`payment verified on-chain and filled (tx ${sig.slice(0, 12)}…)`);

const book = (await api('/api/book')).body;
assert.equal(book.levels.find((l: any) => l.price === 1).size, 0);
assert.equal(book.trades[0].sig, sig);
ok('inventory decremented, trade printed on the public tape');
assert.equal((await api('/api/order', { price: 1, qty: 1 })).status, 409);
ok('sold-out level rejects new orders (409)');
assert.equal((await waitFill(o.body.ref)).body.status, 'filled');
assert.equal((await api('/api/book')).body.trades.filter((t: any) => t.sig === sig).length, 1);
ok('re-confirming is idempotent, still one trade');

// 2. underpayment is rejected
const u = await api('/api/order', { price: 0.5, qty: 1 });
await pay({ ...u.body, amount: 0.4 });
const uf = await waitFill(u.body.ref);
assert.equal(uf.status, 422);
assert.equal(uf.body.error, 'invalid_payment');
ok('underpayment (0.40 for a 0.50 order) rejected as invalid_payment');

// 3. bids: public without contact, private to admin
const b = await api('/api/bid', { price: 0.25, size: 1, note: 'e2e', contact: 'e2e@test', website: '' });
assert.equal(b.status, 201);
const pubBid = (await api('/api/book')).body.bids.find((x: any) => x.id === b.body.bid.id);
assert.ok(pubBid && pubBid.contact === undefined);
ok('bid on the public book, contact hidden');
assert.equal((await api('/api/admin/state')).status, 401);
assert.equal((await api('/api/admin/state', undefined, { authorization: 'Bearer wrong' })).status, 401);
const adm = await api('/api/admin/state', undefined, { authorization: 'Bearer test-admin-token' });
assert.equal(adm.status, 200);
assert.ok(adm.body.bids.some((x: any) => x.contact === 'e2e@test'));
ok('admin API rejects bad tokens; owner sees bid contact');

// 4. instant halt from the admin panel
const H = { authorization: 'Bearer test-admin-token' };
await api('/api/admin/action', { action: 'halt' }, H);
assert.equal((await api('/api/order', { price: 2.5, qty: 1 })).status, 423);
await api('/api/admin/action', { action: 'unhalt' }, H);
assert.equal((await api('/api/order', { price: 2.5, qty: 1 })).status, 201);
ok('admin halt blocks orders (423); unhalt reopens');

console.log('\nall end-to-end checks passed');
