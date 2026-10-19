import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse } from '../../lib/market';

export const prerender = false;

// Polled by the buyer after paying. Verifies the transfer on-chain; only a
// filled order gets the booking link.
export const POST: APIRoute = async ({ request }) => {
  try {
    const { cfg, market } = getMarket();
    const { ref } = await request.json().catch(() => ({ ref: '' }));
    const r = await market.confirm(String(ref ?? ''));
    if (r.status !== 'filled') return json({ status: r.status });
    return json({
      status: 'filled',
      sig: r.order.sig,
      // Only ever hand out a real https link. Anything else (e.g. an API key
      // pasted into BOOKING_URL by mistake) falls back to "email me".
      booking: /^https:\/\/\S+$/.test(cfg.bookingUrl) ? cfg.bookingUrl : null,
      contact: cfg.contactEmail,
    });
  } catch (err) {
    return errorResponse(err);
  }
};
