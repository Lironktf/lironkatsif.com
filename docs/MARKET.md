# The LIRON/USDC market

The order book on the home page is a real market: asks are 15-minute blocks of
my time, paid in USDC on Solana; bids are offers I can accept.

## How it works

```
browser                     server (Vercel functions)              Solana
───────                     ─────────────────────────              ──────
poll GET /api/book  ──────▶ inventory, bids (no contacts), tape
POST /api/bid       ──────▶ validate, rate-limit, store, notify me
POST /api/order     ──────▶ check halt + my USDC account exists,
                            reserve blocks (atomic), new reference,
                            price computed HERE, return Solana Pay URL
pay (wallet or QR)  ─────────────────────────────────────────────▶ USDC transfer
                                                                    carrying the reference
poll POST /api/confirm ───▶ find tx by reference, validate amount,
                            recipient and mint on-chain; one tx fills
                            one order; record trade; notify me;
                            return booking link  ◀─────────────────
```

- Unpaid orders hold their blocks for `ORDER_TTL_SEC` (15 min), then release.
  A payment that lands late still fills (the buyer paid); if that oversells a
  level, the trade is flagged in the notification.
- The booking link is never in the page source. It is returned only after a
  verified payment.
- `/admin` (token-protected): halt instantly, edit inventory, read bid contacts,
  see pending orders and trades.

Code: `src/lib/market/` (logic, storage, Solana verification, notifications),
`src/pages/api/` (routes), `src/islands/orderbook/` (UI), `src/pages/admin.astro`.

## Tests

```bash
npm run test:market          # 11 unit tests: inventory, double-spend, expiry, bids, halt
npm run test:e2e             # full purchase against a LOCAL solana-test-validator (see script header)
```

The end-to-end run (2026-10-17) passed all checks on a local validator: server
pricing, on-chain verification, fill, tape, sold-out, idempotent confirms,
underpayment rejected, private bid contacts, admin auth, admin halt. A QR
payment made from outside the browser flipped the open ticket to FILLED on its own.

## Go-live checklist (you do these; nothing here moves money until step 7)

1. **Create a USDC account on your wallet** (`SOL_RECIPIENT`). Send yourself any
   small amount of USDC on Solana once. Without it, orders are refused
   ("payments offline"), because Solana Pay can only verify a transfer into an
   account that already exists.
2. **Storage:** Vercel → Storage / Marketplace → Upstash Redis → connect to this
   project. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Required in
   production: Vercel functions don't share memory.
3. **RPC:** create a free Helius (or QuickNode) key. Put the full URL in
   `SOLANA_RPC`. For `PUBLIC_SOLANA_RPC`, use a second key restricted to
   `lironkatsif.com` (it is visible to browsers).
4. **Admin:** set `ADMIN_TOKEN` to a long random string (`openssl rand -hex 24`).
5. **Booking:** create a Cal.com event (15/30/60 min) and set `BOOKING_URL`.
6. **Notifications:** Telegram bot (`@BotFather` → token; message the bot, then
   read your chat id) and/or Resend (`RESEND_API_KEY`, `NOTIFY_EMAIL`).
7. **Test on devnet first:** `SOLANA_CLUSTER=devnet`, `MARKET_HALTED=false`, a
   devnet wallet with devnet USDC (faucet.circle.com). Buy a block end to end.
8. **Go live:** `SOLANA_CLUSTER=mainnet-beta`, `MARKET_HALTED=false`, redeploy.
   Halt any time from `/admin`.

Prices and starting inventory live in `src/data/asks.json`. After launch, edit
inventory from `/admin` (the file only seeds levels the store hasn't seen).
