// Core market logic, independent of HTTP and of the storage backend.
//
// Correctness rules:
//  - Inventory is reserved atomically (HINCRBY) when an order is created and
//    released if the order expires unpaid.
//  - An order is only marked filled after the server verifies the USDC
//    transfer on-chain. Each transaction signature can fill one order only.
//  - A payment that arrives after its order expired still fills it (the buyer
//    paid). If that oversells a level, the trade is flagged for the owner.

import type { Store } from './store';
import type { MarketConfig } from './config';
import asksFile from '../../data/asks.json';

export type Level = { price: number; size: number; note?: string };
export type PublicBid = { id: string; price: number; size: number; note: string; ts: number };
export type StoredBid = PublicBid & { contact: string; ip: string };
export type Trade = { id: string; price: number; size: number; ts: number; sig: string };
export type Order = {
  ref: string;
  price: number;
  qty: number;
  amount: number;
  status: 'pending' | 'expired' | 'filled';
  createdAt: number;
  expiresAt: number;
  sig?: string;
  filledAt?: number;
  oversold?: boolean;
};

export class MarketError extends Error {
  constructor(
    public code: 'halted' | 'bad_request' | 'sold_out' | 'not_found' | 'rate_limited' | 'invalid_payment',
    message: string,
  ) {
    super(message);
  }
}

const K = {
  inv: 'mkt:inv',
  bids: 'mkt:bids',
  trades: 'mkt:trades',
  pending: 'mkt:pending',
  halt: 'mkt:halt',
  order: (ref: string) => `mkt:order:${ref}`,
  sig: (sig: string) => `mkt:sig:${sig}`,
  fill: (ref: string) => `mkt:fill:${ref}`,
  rate: (what: string, ip: string) => `mkt:rate:${what}:${ip}`,
};

const levels = (): Level[] =>
  [...(asksFile.levels as Level[])].sort((a, b) => a.price - b.price);
const priceKey = (p: number) => p.toFixed(2);
const round2 = (n: number) => Math.round(n * 100) / 100;

export type Verifier = (ref: string, amount: number) => Promise<{ sig: string } | null>;
export type Notifier = (text: string) => Promise<void>;

export class Market {
  constructor(
    private store: Store,
    private cfg: MarketConfig,
    private verify: Verifier,
    private notify: Notifier,
  ) {}

  async isHalted(): Promise<boolean> {
    if (this.cfg.envHalted || !this.cfg.recipient) return true;
    return (await this.store.get(K.halt)) === '1';
  }

  /** Seeds inventory from asks.json the first time a level is seen. */
  private async inventory(): Promise<Record<string, number>> {
    const raw = await this.store.hgetall(K.inv);
    for (const l of levels()) {
      const k = priceKey(l.price);
      if (raw[k] == null) {
        await this.store.hset(K.inv, k, String(l.size));
        raw[k] = String(l.size);
      }
    }
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
  }

  async sweepExpired(now = Date.now()) {
    for (const ref of await this.store.smembers(K.pending)) {
      const o = await this.getOrder(ref);
      if (!o || o.status !== 'pending') {
        await this.store.srem(K.pending, ref);
        continue;
      }
      if (now > o.expiresAt) {
        o.status = 'expired';
        await this.saveOrder(o);
        await this.store.hincrby(K.inv, priceKey(o.price), o.qty);
        await this.store.srem(K.pending, ref);
      }
    }
  }

  async book() {
    await this.sweepExpired();
    const inv = await this.inventory();
    const bids = Object.values(await this.store.hgetall(K.bids))
      .map((s) => JSON.parse(s) as StoredBid)
      .sort((a, b) => b.price - a.price || a.ts - b.ts)
      .map(({ id, price, size, note, ts }) => ({ id, price, size, note, ts }));
    const trades = (await this.store.lrange(K.trades, 30)).map((s) => JSON.parse(s) as Trade);
    return {
      halted: await this.isHalted(),
      cluster: this.cfg.cluster,
      levels: levels().map((l) => ({
        price: l.price,
        note: l.note ?? '',
        size: Math.max(0, inv[priceKey(l.price)] ?? 0),
      })),
      bids,
      trades,
    };
  }

  private async rateLimit(what: string, ip: string, max: number, windowSec: number) {
    const n = await this.store.incr(K.rate(what, ip || 'unknown'), windowSec);
    if (n > max) throw new MarketError('rate_limited', 'slow down: too many requests, try again later');
  }

  async placeBid(input: any, ip: string): Promise<PublicBid> {
    if (input?.website) throw new MarketError('bad_request', 'rejected'); // honeypot
    const price = Number(input?.price);
    const size = Number(input?.size);
    const note = String(input?.note ?? '').trim().slice(0, 140);
    const contact = String(input?.contact ?? '').trim().slice(0, 120);
    if (!Number.isFinite(price) || price < 0.01 || price > 10_000)
      throw new MarketError('bad_request', 'price must be between 0.01 and 10,000 usdc');
    if (!Number.isInteger(size) || size < 1 || size > 32)
      throw new MarketError('bad_request', 'size must be a whole number of blocks, 1 to 32');
    if (!contact) throw new MarketError('bad_request', 'add an email or telegram so I can fill you');
    await this.rateLimit('bid', ip, 5, 3600);
    const bid: StoredBid = {
      id: crypto.randomUUID().slice(0, 8),
      price: round2(price),
      size,
      note,
      contact,
      ip,
      ts: Date.now(),
    };
    await this.store.hset(K.bids, bid.id, JSON.stringify(bid));
    await this.notify(
      `New bid on LIRON/USDC: ${bid.size} x 15m @ ${bid.price.toFixed(2)} USDC\nfrom: ${bid.contact}\nnote: ${bid.note || '-'}`,
    );
    const { contact: _c, ip: _i, ...pub } = bid;
    return pub;
  }

  async createOrder(input: any, ip: string, newRef: () => string) {
    if (await this.isHalted()) throw new MarketError('halted', 'trading is halted');
    const price = Number(input?.price);
    const qty = Number(input?.qty);
    const level = levels().find((l) => priceKey(l.price) === priceKey(price));
    if (!level) throw new MarketError('bad_request', 'no ask at that price');
    if (!Number.isInteger(qty) || qty < 1 || qty > level.size)
      throw new MarketError('bad_request', 'invalid size');
    await this.rateLimit('order', ip, 20, 3600);
    await this.sweepExpired();
    await this.inventory();
    const left = await this.store.hincrby(K.inv, priceKey(price), -qty);
    if (left < 0) {
      await this.store.hincrby(K.inv, priceKey(price), qty);
      throw new MarketError('sold_out', 'not enough blocks left at that price');
    }
    const now = Date.now();
    const order: Order = {
      ref: newRef(),
      price: level.price,
      qty,
      amount: round2(level.price * qty),
      status: 'pending',
      createdAt: now,
      expiresAt: now + this.cfg.orderTtlSec * 1000,
    };
    await this.saveOrder(order);
    await this.store.sadd(K.pending, order.ref);
    return order;
  }

  async getOrder(ref: string): Promise<Order | null> {
    const s = await this.store.get(K.order(ref));
    return s ? (JSON.parse(s) as Order) : null;
  }
  private async saveOrder(o: Order) {
    await this.store.set(K.order(o.ref), JSON.stringify(o), { ex: 60 * 60 * 24 * 30 });
  }

  /** Checks the chain for this order's payment. Safe to call repeatedly. */
  async confirm(ref: string) {
    const order = await this.getOrder(String(ref ?? ''));
    if (!order) throw new MarketError('not_found', 'unknown order');
    if (order.status === 'filled') return { status: 'filled' as const, order };

    const paid = await this.verify(order.ref, order.amount);
    if (!paid) {
      if (order.status === 'pending' && Date.now() > order.expiresAt) await this.sweepExpired();
      const fresh = (await this.getOrder(order.ref))!;
      return { status: fresh.status === 'expired' ? ('expired' as const) : ('pending' as const), order: fresh };
    }

    // one signature fills one order, ever
    const sigOk = await this.store.set(K.sig(paid.sig), order.ref, { nx: true });
    if (!sigOk && (await this.store.get(K.sig(paid.sig))) !== order.ref)
      throw new MarketError('invalid_payment', 'that transaction already paid for another order');
    // and one order is filled once, even under concurrent confirms
    if (!(await this.store.set(K.fill(order.ref), '1', { nx: true }))) {
      return { status: 'filled' as const, order: (await this.getOrder(order.ref))! };
    }

    const current = (await this.getOrder(order.ref))!;
    if (current.status === 'expired') {
      // inventory was released when it expired; take it again (may oversell)
      const left = await this.store.hincrby(K.inv, priceKey(current.price), -current.qty);
      current.oversold = left < 0;
    }
    current.status = 'filled';
    current.sig = paid.sig;
    current.filledAt = Date.now();
    await this.saveOrder(current);
    await this.store.srem(K.pending, current.ref);
    const trade: Trade = {
      id: current.ref.slice(0, 8),
      price: current.price,
      size: current.qty,
      ts: current.filledAt,
      sig: paid.sig,
    };
    await this.store.lpush(K.trades, JSON.stringify(trade), 200);
    await this.notify(
      `FILLED on LIRON/USDC: ${current.qty} x 15m @ ${current.price.toFixed(2)} = ${current.amount.toFixed(2)} USDC` +
        `${current.oversold ? '\nWARNING: this level is now oversold' : ''}\ntx ${paid.sig}`,
    );
    return { status: 'filled' as const, order: current };
  }

  // ── owner tools ──────────────────────────────────────────────
  async adminState() {
    await this.sweepExpired();
    const bids = Object.values(await this.store.hgetall(K.bids))
      .map((s) => JSON.parse(s) as StoredBid)
      .sort((a, b) => b.ts - a.ts);
    const orders: Order[] = [];
    for (const ref of await this.store.smembers(K.pending)) {
      const o = await this.getOrder(ref);
      if (o) orders.push(o);
    }
    return {
      halted: await this.isHalted(),
      envHalted: this.cfg.envHalted,
      haltOverride: (await this.store.get(K.halt)) === '1',
      recipient: this.cfg.recipient,
      cluster: this.cfg.cluster,
      inventory: await this.inventory(),
      bids,
      pendingOrders: orders,
      trades: (await this.store.lrange(K.trades, 200)).map((s) => JSON.parse(s) as Trade),
    };
  }
  async deleteBid(id: string) {
    await this.store.hdel(K.bids, String(id));
  }
  async setInventory(price: number, size: number) {
    if (!levels().some((l) => priceKey(l.price) === priceKey(price)))
      throw new MarketError('bad_request', 'no such level');
    if (!Number.isInteger(size) || size < 0 || size > 1000) throw new MarketError('bad_request', 'bad size');
    await this.store.hset(K.inv, priceKey(price), String(size));
  }
  async setHalt(on: boolean) {
    if (on) await this.store.set(K.halt, '1');
    else await this.store.del(K.halt);
  }
}
