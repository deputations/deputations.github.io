const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = 'D:\\claude\\Deputation\\prototypes\\india-map\\screenshots';
const INDEX_HTML = 'D:\\claude\\Deputation\\prototypes\\india-map\\index.html';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // Patch index.html to remove external phosphor icons dependency
  const originalHTML = fs.readFileSync(INDEX_HTML, 'utf8');
  const patchedHTML = originalHTML.replace(
    /<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/,
    '<!-- phosphor icons disabled for screenshot capture -->'
  );
  fs.writeFileSync(INDEX_HTML, patchedHTML);
  console.log('Patched index.html (removed phosphor icons CDN)');

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata'
    });

    const page = await context.newPage();

    page.on('pageerror', err => console.error('[pageerror]', err.message));

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
    // Restore original HTML
    fs.writeFileSync(INDEX_HTML, originalHTML);
    console.log('Restored original index.html');
  }
}

main().catch(err => {
  console.error('Error:', err);
  // Restore on error too
  try { fs.writeFileSync(INDEX_HTML, originalHTML); } catch(e) {}
  process.exit(1);
});
