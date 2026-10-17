import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, isAdmin } from '../../../lib/market';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const { cfg, market } = getMarket();
  if (!isAdmin(request, cfg.adminToken)) return json({ error: 'unauthorized' }, 401);
  try {
    return json(await market.adminState());
  } catch (err) {
    return errorResponse(err);
  }
};
