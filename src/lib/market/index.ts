import { marketConfig } from './config';
import { getStore } from './store';
import { Market, MarketError } from './market';
import { solanaVerifier } from './solana';
import { notifier } from './notify';
import { timingSafeEqual } from 'node:crypto';

export function getMarket() {
  const cfg = marketConfig();
  return { cfg, market: new Market(getStore(cfg.redisUrl, cfg.redisToken), cfg, solanaVerifier(cfg), notifier(cfg)) };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const STATUS: Record<MarketError['code'], number> = {
  halted: 423,
  bad_request: 400,
  sold_out: 409,
  not_found: 404,
  rate_limited: 429,
  invalid_payment: 422,
};

export function errorResponse(err: unknown) {
  if (err instanceof MarketError) return json({ error: err.code, message: err.message }, STATUS[err.code]);
  console.error('[market]', err);
  return json({ error: 'server_error', message: 'something went wrong, try again' }, 500);
}

export function clientIp(request: Request, fallback?: string) {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    fallback ||
    ''
  );
}

export function isAdmin(request: Request, token: string) {
  if (!token) return false;
  const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
