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

  // Capture console messages
  const consoleLogs = [];
  context.on('page', page => {
    page.on('console', msg => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      if (msg.type() === 'error') console.error('PAGE ERROR:', msg.text());
    });
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  });

  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(5000);

  console.log('Console logs:', consoleLogs.join('\n'));

  const domInfo = await page.evaluate(() => {
    const svg = document.getElementById('india-map');
    const html = document.body.innerHTML.substring(0, 500);
    const scriptErrors = document.querySelectorAll('script[type="importmap"]');
    const moduleScripts = document.querySelectorAll('script[type="module"]');
    return {
      bodyHTML: html,
      svgChildren: svg ? svg.children.length : 0,
      scriptErrors: scriptErrors.length,
      moduleScripts: moduleScripts.length,
      moduleSrc: Array.from(moduleScripts).map(s => s.src)
    };
  });
  console.log('Page info:', JSON.stringify(domInfo, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
