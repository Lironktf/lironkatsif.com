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
      JSON.stringify({ error: 'server_error', message: 'something went wrong, try again' }),
      { status: 500, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }
});
