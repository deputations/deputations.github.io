const { chromium } = require('playwright');
const path = require('path');

const SCREENSHOTS_DIR = 'D:\\claude\\Deputation\\prototypes\\india-map\\screenshots';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata'
  });

  const page = await context.newPage();

  // Capture all console messages
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('error') || text.includes('Error')) {
      console.error(`[${msg.type()}]`, text);
    }
  });
  page.on('pageerror', err => console.error('[pageerror]', err.message, err.stack));

  console.log('Navigating...');
  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'commit', timeout: 30000 });
  console.log('Navigation committed, waiting for load...');

  // Wait for the page to stabilize
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    console.log('Network idle');
  } catch (e) {
    console.log('Network idle timeout (expected with CDN), continuing...');
  }

  // Wait for DOM to be ready
  await page.waitForFunction('document.readyState === "complete"', { timeout: 10000 });
  console.log('Document complete');

  // Give ES modules time to load and execute
  await sleep(5000);

  // Check what's in the DOM
  const state = await page.evaluate(() => {
    const svg = document.getElementById('india-map');
    const mapGroup = document.getElementById('map-group');
    const paths = svg ? svg.querySelectorAll('path').length : 0;
    const mhPaths = svg ? svg.querySelectorAll('path[data-abbr="MH"]').length : 0;
    const mapGroupTransform = mapGroup ? mapGroup.getAttribute('transform') : 'no map-group';
    return {
      svgChildren: svg ? svg.children.length : 0,
      paths,
      mhPaths,
      mapGroupTransform
    };
  });
  console.log('State:', JSON.stringify(state));

  await browser.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
