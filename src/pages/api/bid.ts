import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, clientIp } from '../../lib/market';
import { MarketError } from '../../lib/market/market';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const { cfg, market } = getMarket();
    // In production, bids need durable storage (Upstash). Without it they'd live
    // in one function instance's memory and silently disappear.
    if (!cfg.redisUrl && process.env.VERCEL)
      throw new MarketError('halted', 'bids are offline for now. email me instead');
    const body = await request.json().catch(() => ({}));
    const bid = await market.placeBid(body, clientIp(request, clientAddress));
    return json({ bid }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};
