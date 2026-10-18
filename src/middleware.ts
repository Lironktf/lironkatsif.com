import { defineMiddleware } from 'astro:middleware';

// API routes always answer in JSON, even if a route module fails to load.
export const onRequest = defineMiddleware(async (ctx, next) => {
  if (!ctx.url.pathname.startsWith('/api/')) return next();
  try {
    return await next();
  } catch (err) {
    const e = err as Error;
    console.error('[api crash]', e);
    return new Response(
      JSON.stringify({ error: 'server_error', detail: `${e?.name}: ${e?.message}`.slice(0, 300) }),
      { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
});
