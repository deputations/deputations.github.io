const { chromium } = require('playwright');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('[console]', msg.text()));

  await page.goto('http://127.0.0.1:8092/', { waitUntil: 'networkidle', timeout: 30000 });
  await sleep(3000);

  // Click Maharashtra
  console.log('Clicking Maharashtra...');
  await page.locator('[aria-label="Maharashtra: 13 deputations"]').click();
  await sleep(2500);

  // List all buttons and their aria-labels
  const buttons = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    return Array.from(btns).map(b => ({
      label: b.getAttribute('aria-label') || '',
      text: b.textContent.trim().substring(0, 80),
      id: b.id,
      visible: b.offsetParent !== null,
      rect: b.getBoundingClientRect()
    })).filter(b => b.label || b.text);
  });
  console.log('Buttons after Maharashtra click:', JSON.stringify(buttons, null, 2));

  // Check for paths with district
  const districts = await page.evaluate(() => {
    const paths = document.querySelectorAll('svg path, svg circle, svg polygon');
    const allElements = document.querySelectorAll('[data-district], [data-name], [data-id]');
    return {
      paths: paths.length,
      dataEls: Array.from(allElements).slice(0, 30).map(el => ({
        tag: el.tagName,
        district: el.getAttribute('data-district'),
        name: el.getAttribute('data-name'),
        id: el.getAttribute('data-id'),
        state: el.getAttribute('data-state')
      }))
    };
  });
  console.log('District elements:', JSON.stringify(districts, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
