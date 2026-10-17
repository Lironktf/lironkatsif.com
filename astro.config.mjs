// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.lironkatsif.com',
  // Pages stay static; only routes with `prerender = false` (the market API)
  // run as Vercel functions.
  adapter: vercel(),
  integrations: [react(), mdx()],
  markdown: {
    shikiConfig: { theme: 'vesper' },
  },
});
