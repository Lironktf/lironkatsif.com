export const SITE = {
  name: 'Liron Katsif',
  url: 'https://www.lironkatsif.com',
  title: 'Liron Katsif — LIRON/USDC',
  description:
    'Personal site of Liron Katsif. Features a live order book where you can buy my time with USDC on Solana.',
  email: 'liron@qapture.io',
  github: 'https://github.com/Lironktf',

  // ── Market config ─────────────────────────────────────────────
  ticker: 'LIRON/USDC',
  chain: 'SOLANA',
  // HARD TRADING HALT. While true, nobody can reach checkout at all —
  // the buy flow stops at a "market halted" state regardless of any
  // other config. Set to false to open the market.
  halted: true,
  // Your Solana wallet address (base58). Leave empty and the buy flow
  // shows a "wallet not configured" state instead of a payment QR.
  solAddress: '',
  // USDC mint on Solana mainnet
  usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  rpc: 'https://api.mainnet-beta.solana.com',
  // Booking link revealed after a fill (e.g. a cal.com event URL).
  bookingUrl: '',
};
