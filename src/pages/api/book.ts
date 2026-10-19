import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, isAdmin } from '../../lib/market';

export const prerender = false;

// Public market snapshot: remaining asks, resting bids (no contact info),
// and the recent trade tape. Polled by the order book every few seconds.
export const GET: APIRoute = async ({ request }) => {
  try {
    const { cfg, market } = getMarket();
    const owner = isAdmin(request, cfg.adminToken);
    const book = await market.book();
    return json({
      ...book,
      // the owner sees the market as open while the desk halt hides it from the public
      halted: await market.isHalted(owner),
      owner,
      publicRpc: process.env.PUBLIC_SOLANA_RPC || (import.meta as any).env?.PUBLIC_SOLANA_RPC || cfg.rpc,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
