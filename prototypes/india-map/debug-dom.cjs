const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS_DIR = 'D:\\claude\\Deputation\\prototypes\\india-map\\screenshots';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(8000);

  // Full DOM exploration
  const domInfo = await page.evaluate(() => {
    const results = {};

    // SVG paths
    const paths = document.querySelectorAll('svg path');
    results.pathCount = paths.length;
    results.pathAttrs = [];
    for (let i = 0; i < Math.min(5, paths.length); i++) {
      const p = paths[i];
      results.pathAttrs.push({
        aria: p.getAttribute('aria-label'),
        role: p.getAttribute('role'),
        abbr: p.getAttribute('data-abbr'),
        district: p.getAttribute('data-district'),
        id: p.id,
        class: p.getAttribute('class')
      });
    }

    // Buttons
    const buttons = document.querySelectorAll('button');
    results.btnCount = buttons.length;
    results.btnLabels = [];
    for (const b of buttons) {
      const label = b.getAttribute('aria-label') || '';
      if (label.includes('Maharashtra') || label.includes('MH')) {
        results.btnLabels.push({
          label,
          id: b.id,
          outerHTML: b.outerHTML.substring(0, 200)
        });
      }
    }

    // Map group
    const g = document.getElementById('map-group');
    results.mapGroup = g ? { exists: true, transform: g.getAttribute('transform') } : null;

    // SVG id
    const svg = document.getElementById('india-map');
    results.svgId = svg ? svg.id : 'not found';

    return results;
  });
  console.log('DOM info:', JSON.stringify(domInfo, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
