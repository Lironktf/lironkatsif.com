import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse } from '../../lib/market';

export const prerender = false;

// Public market snapshot: remaining asks, resting bids (no contact info),
// and the recent trade tape. Polled by the order book every few seconds.
export const GET: APIRoute = async () => {
  try {
    const { cfg, market } = getMarket();
    const book = await market.book();
    return json({
      ...book,
      publicRpc: process.env.PUBLIC_SOLANA_RPC || (import.meta as any).env?.PUBLIC_SOLANA_RPC || cfg.rpc,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
