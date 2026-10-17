import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, clientIp } from '../../lib/market';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const { market } = getMarket();
    const body = await request.json().catch(() => ({}));
    const bid = await market.placeBid(body, clientIp(request, clientAddress));
    return json({ bid }, 201);
  } catch (err) {
    return errorResponse(err);
  }
};
