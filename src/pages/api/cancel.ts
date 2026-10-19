import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse } from '../../lib/market';

export const prerender = false;

// Buyer pressed "cancel order": release the reserved blocks right away.
export const POST: APIRoute = async ({ request }) => {
  try {
    const { market } = getMarket();
    const { ref } = await request.json().catch(() => ({ ref: '' }));
    await market.cancelOrder(String(ref ?? ''));
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
};
