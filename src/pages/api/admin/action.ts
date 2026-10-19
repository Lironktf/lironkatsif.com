import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, isAdmin } from '../../../lib/market';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const { cfg, market } = getMarket();
  if (!isAdmin(request, cfg.adminToken)) return json({ error: 'unauthorized' }, 401);
  try {
    const a = await request.json().catch(() => ({}));
    if (a.action === 'delete-bid') await market.deleteBid(a.id);
    else if (a.action === 'set-inventory') await market.setInventory(Number(a.price), Number(a.size));
    else if (a.action === 'halt') await market.setHalt(true);
    else if (a.action === 'unhalt') await market.setHalt(false);
    else if (a.action === 'reset-tape') await market.resetTape();
    else if (a.action === 'cancel-pending') await market.cancelAllPending();
    else return json({ error: 'bad_request', message: 'unknown action' }, 400);
    return json({ ok: true, state: await market.adminState() });
  } catch (err) {
    return errorResponse(err);
  }
};
