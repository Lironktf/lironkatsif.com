// Server-side market configuration, read from environment variables.
// Nothing here is shipped to the browser except what /api/book returns.

const USDC_MINTS = {
  'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GgPAEERYPJgZJDncDU',
} as const;

export type Cluster = keyof typeof USDC_MINTS;

/** Reads a variable from the runtime env first (Vercel), then Vite's env (astro dev). */
export function env(key: string): string {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (fromProcess != null && fromProcess !== '') return fromProcess;
  const viteEnv = (import.meta as any).env as Record<string, string> | undefined;
  return viteEnv?.[key] ?? '';
}

export function marketConfig() {
  const cluster: Cluster = env('SOLANA_CLUSTER') === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
  return {
    cluster,
    // The market is halted unless MARKET_HALTED is explicitly "false".
    envHalted: env('MARKET_HALTED') !== 'false',
    recipient: env('SOL_RECIPIENT'),
    usdcMint: env('USDC_MINT') || USDC_MINTS[cluster],
    rpc:
      env('SOLANA_RPC') ||
      (cluster === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'),
    bookingUrl: env('BOOKING_URL'),
    contactEmail: env('CONTACT_EMAIL') || 'lkatsif@uwaterloo.ca',
    adminToken: env('ADMIN_TOKEN'),
    orderTtlSec: Number(env('ORDER_TTL_SEC') || 900),
    redisUrl: env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL'),
    redisToken: env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN'),
    telegramToken: env('TELEGRAM_BOT_TOKEN'),
    telegramChat: env('TELEGRAM_CHAT_ID'),
    resendKey: env('RESEND_API_KEY'),
    notifyEmail: env('NOTIFY_EMAIL'),
    resendFrom: env('RESEND_FROM') || 'LIRON/USDC <onboarding@resend.dev>',
  };
}

export type MarketConfig = ReturnType<typeof marketConfig>;
