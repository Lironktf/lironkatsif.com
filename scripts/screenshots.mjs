import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE = 'http://localhost:4321';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

// ── OG image (1200x630) ──
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(new URL('./og.html', import.meta.url).href);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'public/og.png' });
  await page.close();
  console.log('og.png done');
}

const desktop = { width: 1440, height: 900 };

async function newPage(vp = desktop) {
  const page = await browser.newPage({ viewport: vp });
  return page;
}

// 1. home — full page
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/01-home-full.png`, fullPage: true });
  await page.close();
  console.log('01 done');
}

// 2. hero viewport
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/02-hero.png` });
  await page.close();
  console.log('02 done');
}

// 3. order book panel
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const book = page.locator('.ob');
  await book.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await book.screenshot({ path: `${OUT}/03-orderbook.png` });
  await page.close();
  console.log('03 done');
}

// 4. buy ticket open (click best ask = last ask row)
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('.asks .ob-row').last().click();
  await page.waitForTimeout(400);
  await page.locator('.ob').screenshot({ path: `${OUT}/04-buy-ticket.png` });
  // click the buy button to show the offline/unconfigured state honestly
  await page.locator('.exec').click();
  await page.waitForTimeout(400);
  await page.locator('.ob').screenshot({ path: `${OUT}/05-buy-offline-state.png` });
  await page.close();
  console.log('04+05 done');
}

// 6. bid ticket
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('.tabs button', { hasText: 'place bid' }).click();
  await page.waitForTimeout(300);
  await page.locator('.line input').first().fill('140');
  await page.locator('.line input').nth(2).fill('code review for my startup');
  await page.locator('.ob').screenshot({ path: `${OUT}/06-bid-ticket.png` });
  await page.close();
  console.log('06 done');
}

// 7. demo feed on
{
  const page = await newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('.demo-btn').click();
  await page.waitForTimeout(7000);
  await page.locator('.ob').scrollIntoViewIfNeeded();
  await page.locator('.ob').screenshot({ path: `${OUT}/07-demo-feed.png` });
  await page.close();
  console.log('07 done');
}

// 8. blog index
{
  const page = await newPage();
  await page.goto(BASE + '/blog/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/08-blog-index.png` });
  await page.close();
  console.log('08 done');
}

// 9. blog post
{
  const page = await newPage();
  await page.goto(BASE + '/blog/this-site-is-an-order-book/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/09-blog-post.png`, fullPage: true });
  await page.close();
  console.log('09 done');
}

// 10. 404
{
  const page = await newPage();
  await page.goto(BASE + '/404', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/10-404.png` });
  await page.close();
  console.log('10 done');
}

// 11. mobile home
{
  const page = await newPage({ width: 390, height: 844 });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/11-mobile-home.png`, fullPage: true });
  await page.close();
  console.log('11 done');
}

await browser.close();
console.log('ALL DONE');
