import { chromium } from 'playwright';
import fs from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = 'D:\\claude\\Deputation\\prototypes\\india-map\\screenshots';
const INDEX_HTML = 'D:\\claude\\Deputation\\prototypes\\india-map\\index.html';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const originalHTML = fs.readFileSync(INDEX_HTML, 'utf8');

  // Patch: replace external phosphor icons CDN with a local mock
  const patchedHTML = originalHTML.replace(
    /<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/,
    '<script>window.PhosphorIcons = { icons: {} };</script>'
  );
  fs.writeFileSync(INDEX_HTML, patchedHTML);

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata'
    });

    // Block external requests (matches test harness)
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
        return route.continue();
      }
      return route.abort();
    });

    const page = await context.newPage();

    page.on('pageerror', err => console.error('[pageerror]', err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') console.error('[console error]', msg.text());
    });

    console.log('Navigating...');
    await page.goto('http://127.0.0.1:8092/');
    console.log('Waiting for map...');

    await page.waitForFunction(
      () => document.getElementById('india-map').children.length > 0,
      null,
      { timeout: 15000 }
    );
    console.log('Map populated!');
    await sleep(3000);

    // 1. National view
    console.log('1. National view...');
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'national-view.png') });

    // 2. Click Maharashtra
    console.log('2. Clicking Maharashtra...');
    await page.locator('[data-abbr="MH"]').click();
    await sleep(2500);

    const mhInfo = await page.evaluate(() => {
      const g = document.getElementById('map-group');
      if (!g) return { error: 'no map-group' };
      const t = g.getAttribute('transform');
      const m = t && t.match(/scale\(([^)]+)\)/);
      return { transform: t, scale: m ? parseFloat(m[1]) : null };
    });
    console.log('MH info:', JSON.stringify(mhInfo));
    const mhZoom = mhInfo.scale ? mhInfo.scale.toFixed(2) + 'x' : 'unknown';
    console.log('Maharashtra zoom:', mhZoom);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'maharashtra-zoom.png') });

    // 3. Click Pune
    console.log('3. Clicking Pune...');
    await page.locator('[data-district="Pune"]').click();
    await sleep(2000);

    const puneInfo = await page.evaluate(() => {
      const rp = document.getElementById('results-panel');
      return { resultsOpen: rp && !rp.hidden };
    });
    console.log('Pune info:', JSON.stringify(puneInfo));

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'pune-results.png') });

    // 4. Back
    console.log('4. Back...');
    await page.locator('#btn-back').click();
    await sleep(2500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'back-to-state.png') });

    // 5. Back to national
    console.log('5. Back to national...');
    await page.locator('#btn-back').click();
    await sleep(2500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'back-to-national.png') });

    await browser.close();
    console.log('\n=== RESULTS ===');
    console.log('Maharashtra zoom:', mhZoom);
  } finally {
    fs.writeFileSync(INDEX_HTML, originalHTML);
    console.log('Restored original index.html');
  }
}

main().catch(err => {
  console.error('Error:', err);
  try { fs.writeFileSync(INDEX_HTML, originalHTML); } catch(e) {}
  process.exit(1);
});
