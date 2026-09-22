// tests/capture-screenshots.js — Capture desktop and mobile screenshots
import { startServer, startBrowser, delay } from './harness.js';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'tests', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function captureView(name, page, scenario = 'populated') {
  await page.goto(`http://127.0.0.1:8092/?scenario=${scenario}`);
  await page.waitForTimeout(2500);
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`✓ Captured ${name}`);
  return file;
}

async function captureAfterClick(name, page, selector, delayMs = 1500) {
  await page.locator(selector).click();
  await page.waitForTimeout(delayMs);
  const file = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`✓ Captured ${name}`);
  return file;
}

async function main() {
  const server = await startServer();
  const browser = await startBrowser();

  // === DESKTOP ===
  console.log('\n=== Desktop (1280×800) ===');
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktop = await desktopCtx.newPage();

  await captureView('desktop-01-national', desktop);

  await captureAfterClick('desktop-02-state-mh', desktop, '[data-abbr="MH"]');
  await captureAfterClick('desktop-03-district-pune', desktop, '[data-district="Pune"]');
  await captureAfterClick('desktop-04-filter-open', desktop, '#btn-filter');
  await desktop.goBack(); await delay(1000);
  await desktop.goBack(); await delay(1000);

  await captureView('desktop-05-empty', desktop, 'empty');

  await desktopCtx.close();

  // === MOBILE ===
  console.log('\n=== Mobile (375×812) ===');
  const mobileCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const mobile = await mobileCtx.newPage();
  await mobile.goto('http://127.0.0.1:8092/');
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-01-national.png') });
  console.log('✓ Captured mobile-01-national');

  await mobile.locator('[data-abbr="MH"]').click();
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: path.join(SCREENSHOTS_DIR, 'mobile-02-state-mh.png') });
  console.log('✓ Captured mobile-02-state-mh');

  await mobileCtx.close();

  await browser.close();
  await new Promise(r => server.close(r));
  console.log('\n✓ All screenshots saved to tests/screenshots/');
}

main().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
