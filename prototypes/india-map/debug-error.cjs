const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = 'D:\\claude\\Deputation\\prototypes\\india-map\\screenshots';
const INDEX_HTML = 'D:\\claude\\Deputation\\prototypes\\india-map\\index.html';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const originalHTML = fs.readFileSync(INDEX_HTML, 'utf8');
  const patchedHTML = originalHTML.replace(
    /<script src="https:\/\/unpkg\.com\/@phosphor-icons\/web"><\/script>/,
    '<!-- disabled -->'
  );
  fs.writeFileSync(INDEX_HTML, patchedHTML);

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata'
    });

    const page = await context.newPage();

    // Catch ALL errors including script errors
    const errorLog = [];
    page.on('pageerror', err => {
      errorLog.push('PAGEERROR: ' + err.message + '\n' + (err.stack || '').substring(0, 500));
      console.error('[PAGEERROR]', err.message);
    });

    // Override window.onerror and window.onunhandledrejection via CDP-like injection
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error') {
        errorLog.push('CONSOLE ERROR: ' + text);
        console.error('[CONSOLE ERROR]', text);
      }
    });

    console.log('Navigating...');
    await page.goto('http://127.0.0.1:8092/');

    // Inject error handler BEFORE module scripts run — not possible with goto.
    // Instead, inject immediately after goto and wait longer.
    await page.evaluate(() => {
      // Override window.onerror to catch everything
      window.__errors = [];
      window.onerror = function(message, source, lineno, colno, error) {
        window.__errors.push({ message, source, lineno, colno, stack: error?.stack });
        console.error('CAUGHT:', message, 'at', source + ':' + lineno);
      };
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const msg = reason?.message || reason?.toString() || 'unknown';
        window.__errors.push({ message: 'UnhandledRejection: ' + msg });
        console.error('UNHANDLED REJECTION:', msg);
      });
    });

    await sleep(8000);

    // Check for errors
    const caughtErrors = await page.evaluate(() => window.__errors || []);
    console.log('Caught errors count:', caughtErrors.length);
    caughtErrors.forEach((e, i) => console.log(`  Error ${i + 1}:`, e.message));

    // Check DOM state
    const domState = await page.evaluate(() => {
      const svg = document.getElementById('india-map');
      const body = document.body;
      return {
        bodyChildren: body.children.length,
        svgChildren: svg ? svg.children.length : 0,
        svgExists: !!svg,
        mapGroup: !!document.getElementById('map-group'),
        btnBack: !!document.getElementById('btn-back'),
        btnLogin: !!document.getElementById('btn-login'),
        btnFilter: !!document.getElementById('btn-filter'),
        hasStatePaths: svg ? !!svg.querySelector('path[data-abbr]') : false,
        hasDistrictPaths: svg ? !!svg.querySelector('path[data-district]') : false
      };
    });
    console.log('DOM state:', JSON.stringify(domState));

    if (domState.svgChildren > 0 && domState.mapGroup) {
      console.log('SUCCESS: Map is loaded!');
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'national-view.png') });
      console.log('Saved national-view.png');
    }

    await browser.close();
  } finally {
    fs.writeFileSync(INDEX_HTML, originalHTML);
    console.log('Restored original index.html');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  try { fs.writeFileSync(INDEX_HTML, originalHTML); } catch(e) {}
  process.exit(1);
});
