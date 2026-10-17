import type { APIRoute } from 'astro';
import { getMarket, json, errorResponse, clientIp } from '../../lib/market';
import { newReference, paymentUrl, recipientReady } from '../../lib/market/solana';
import { MarketError } from '../../lib/market/market';

export const prerender = false;

// Reserves inventory and returns the payment request for this order. The
// amount is computed here from asks.json; the client only picks price + qty.
export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    const { cfg, market } = getMarket();
    const body = await request.json().catch(() => ({}));
    if (!(await market.isHalted()) && !(await recipientReady(cfg)))
      throw new MarketError('halted', 'payments offline: the receiving USDC account is not set up yet');
    const order = await market.createOrder(body, clientIp(request, clientAddress), newReference);
    return json(
      {
        ref: order.ref,
        price: order.price,
        qty: order.qty,
        amount: order.amount,
        expiresAt: order.expiresAt,
        recipient: cfg.recipient,
        mint: cfg.usdcMint,
        cluster: cfg.cluster,
        url: paymentUrl(cfg, order),
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
};
