// Minimal key-value store used by the market. Two implementations with the
// same semantics: Upstash Redis (production) and an in-memory store (local
// dev and tests). All operations the market relies on for correctness
// (hincrby, set-if-absent, incr) are atomic in both.

import { Redis } from '@upstash/redis';

export interface Store {
  get(key: string): Promise<string | null>;
  /** Returns false when `nx` is set and the key already exists. */
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string, ttlSec: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  lpush(key: string, value: string, keep: number): Promise<void>;
  lrange(key: string, count: number): Promise<string[]>;
}

export class MemoryStore implements Store {
  private kv = new Map<string, { v: string; exp?: number }>();
  private hashes = new Map<string, Map<string, string>>();
  private sets = new Map<string, Set<string>>();
  private lists = new Map<string, string[]>();

  private live(key: string) {
    const e = this.kv.get(key);
    if (e && e.exp != null && Date.now() > e.exp) {
      this.kv.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.v ?? null;
  }
  async set(key: string, value: string, opts: { ex?: number; nx?: boolean } = {}) {
    if (opts.nx && this.live(key)) return false;
    this.kv.set(key, { v: value, exp: opts.ex ? Date.now() + opts.ex * 1000 : undefined });
    return true;
  }
  async del(key: string) {
    this.kv.delete(key);
    this.lists.delete(key);
    this.hashes.delete(key);
    this.sets.delete(key);
  }
  async incr(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.kv.set(key, { v: String(n), exp: e?.exp ?? Date.now() + ttlSec * 1000 });
    return n;
  }
  private h(key: string) {
    let m = this.hashes.get(key);
    if (!m) this.hashes.set(key, (m = new Map()));
    return m;
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.h(key));
  }
  async hset(key: string, field: string, value: string) {
    this.h(key).set(field, value);
  }
  async hdel(key: string, field: string) {
    this.h(key).delete(field);
  }
  async hincrby(key: string, field: string, by: number) {
    const m = this.h(key);
    const n = Number(m.get(field) ?? 0) + by;
    m.set(field, String(n));
    return n;
  }
  private s(key: string) {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Set()));
    return s;
  }
  async sadd(key: string, member: string) {
    this.s(key).add(member);
  }
  async srem(key: string, member: string) {
    this.s(key).delete(member);
  }
  async smembers(key: string) {
    return [...this.s(key)];
  }
  async lpush(key: string, value: string, keep: number) {
    const l = this.lists.get(key) ?? [];
    l.unshift(value);
    this.lists.set(key, l.slice(0, keep));
  }
  async lrange(key: string, count: number) {
    return (this.lists.get(key) ?? []).slice(0, count);
  }
}

/** Turns an HGETALL reply (object, flat array, or null) into a string map. */
export function normalizeHash(reply: unknown): Record<string, string> {
  if (reply == null) return {};
  if (Array.isArray(reply)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1]);
    return out;
  }
  return Object.fromEntries(Object.entries(reply as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
}

export class UpstashStore implements Store {
  private r: Redis;
  constructor(url: string, token: string) {
    this.r = new Redis({ url, token, automaticDeserialization: false });
  }
  async get(key: string) {
    return (await this.r.get<string>(key)) ?? null;
  }
  async set(key: string, value: string, opts: { ex?: number; nx?: boolean } = {}) {
    const res =
      opts.ex && opts.nx
        ? await this.r.set(key, value, { ex: opts.ex, nx: true })
        : opts.ex
          ? await this.r.set(key, value, { ex: opts.ex })
          : opts.nx
            ? await this.r.set(key, value, { nx: true })
            : await this.r.set(key, value);
    return res === 'OK';
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async incr(key: string, ttlSec: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, ttlSec);
    return n;
  }
  async hgetall(key: string) {
    // With automaticDeserialization off, Upstash returns HGETALL as a flat
    // [field, value, field, value, ...] array, not an object. Normalize both.
    return normalizeHash(await this.r.hgetall(key));
  }
  async hset(key: string, field: string, value: string) {
    await this.r.hset(key, { [field]: value });
  }
  async hdel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
  async hincrby(key: string, field: string, by: number) {
    return await this.r.hincrby(key, field, by);
  }
  async sadd(key: string, member: string) {
    await this.r.sadd(key, member);
  }
  async srem(key: string, member: string) {
    await this.r.srem(key, member);
  }
  async smembers(key: string) {
    return (await this.r.smembers(key)) as string[];
  }
  async lpush(key: string, value: string, keep: number) {
    await this.r.lpush(key, value);
    await this.r.ltrim(key, 0, keep - 1);
  }
  async lrange(key: string, count: number) {
    return (await this.r.lrange(key, 0, count - 1)) as string[];
  }
}

// One store per server instance. Without Redis credentials the market runs
// on memory (fine for `astro dev`; production must set Upstash keys, see
// docs/MARKET.md, because Vercel functions don't share memory).
let shared: Store | null = null;
export function getStore(url: string, token: string): Store {
  if (!shared) shared = url && token ? new UpstashStore(url, token) : new MemoryStore();
  return shared;
}
export function setStoreForTests(s: Store | null) {
  shared = s;
}
