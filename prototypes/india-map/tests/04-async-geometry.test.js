// tests/04-async-geometry.test.js
// P1: Delayed geometry responses cannot overwrite newer navigation or filters.

import { startServer, newContext, probe, assert, delay } from './harness.js';

let server;

async function setup(opts = {}) {
  if (!server) server = await startServer();
  const { context, page } = await newContext();
  // Override fetch in-page to delay district geometry requests.
  // This avoids Playwright route-priority issues with the harness abort handler.
  if (opts.slowDistricts) {
    await page.addInitScript(() => {
      const origFetch = window.fetch;
      window.fetch = function (url, ...args) {
        if (typeof url === 'string' && url.includes('/districts/MH.geojson')) {
          return new Promise((resolve) => {
            setTimeout(() => resolve(origFetch(url, ...args)), 800);
          });
        }
        return origFetch(url, ...args);
      };
    });
  }
  await page.goto('http://127.0.0.1:8092/');
  await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
  return { page, context };
}

async function teardown(ctx) {
  await ctx.close();
}

export async function test_stale_district_geometry_does_not_overwrite() {
  const { page, context } = await setup({ slowDistricts: true });
  try {
    await page.locator('[data-abbr="MH"]').click();
    // Immediately click Back before the 800ms geometry fetch resolves
    await delay(100);
    await page.locator('#btn-back').click({ force: true });
    await delay(1500);

    const title = await probe.summaryTitle(page);
    assert.equal(title, 'ALL INDIA DEPUTATIONS', 'Stale geometry cannot overwrite national view');

    const chips = await probe.chips(page);
    assert.notIncludes(chips, 'Maharashtra', 'No Maharashtra chip after stale geometry');
  } finally {
    await teardown(context);
  }
}

export async function test_filter_after_state_selection_updates_results() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);
    await page.locator('[data-district="Pune"]').click();
    await delay(500); // wait for results panel to open

    // Apply govt filter via window bridge
    await page.evaluate(() => window.__app.setFilter('category', 'govt'));
    await page.evaluate(() => window.__app.refreshAfterFilter());
    await delay(500); // wait for panel re-render

    const cards = await probe.cardTitles(page);
    assert.equal(cards.length, 1, `Pune govt filter: 1 card (got ${cards.length})`);
    assert.includes(cards, 'Section Officer – Pune Division', 'Govt listing present');

    const distCount = await probe.districtShapeCount(page);
    assert.isAbove(distCount, 0, `Districts still visible (${distCount})`);
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_stale_district_geometry_does_not_overwrite,
  test_filter_after_state_selection_updates_results
];

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      await t();
      console.log(`✓ ${t.name}`);
      pass++;
    } catch (err) {
      console.error(`✗ ${t.name}\n   ${err.message}`);
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
