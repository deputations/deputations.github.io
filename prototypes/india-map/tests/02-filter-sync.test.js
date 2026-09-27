// tests/02-filter-sync.test.js
// Tests: Government filter in Pune, Clear All, category filter, filter chips

import { startServer, newContext, probe, assert, delay } from './harness.js';

let server;

async function setup() {
  if (!server) server = await startServer();
  const { context, page } = await newContext();
  await page.goto('http://127.0.0.1:8092/');
  await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
  return { page, context };
}

async function teardown(ctx) {
  await ctx.close();
}

export async function test_govt_filter_in_pune_removes_private() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);

    await page.locator('[data-district="Pune"]').click();
    await delay(200);

    const cards0 = await probe.cardTitles(page);
    assert.equal(cards0.length, 2, `Initial Pune cards (expected 2, got ${cards0.length})`);
    assert.includes(cards0, 'Section Officer – Pune Division', 'Government listing present');
    assert.includes(cards0, 'Supply Chain Analyst – Pune', 'Private listing present');

    // Apply category filter via window bridge (module-scoped functions)
    await page.evaluate(() => window.__app.setFilter('category', 'govt'));
    await page.evaluate(() => window.__app.refreshAfterFilter());
    await delay(300);

    const cards1 = await probe.cardTitles(page);
    assert.equal(cards1.length, 1, `After govt filter: cards (expected 1, got ${cards1.length})`);
    assert.includes(cards1, 'Section Officer – Pune Division', 'Government listing still present');
  } finally {
    await teardown(context);
  }
}

export async function test_clear_all_synchronizes_everything() {
  const { page, context } = await setup();
  try {
    // Set govt filter via window bridge
    await page.evaluate(() => window.__app.setFilter('category', 'govt'));
    await page.evaluate(() => window.__app.refreshAfterFilter());
    await page.evaluate(() => window.__app.updateAppliedFilters());
    await delay(200);

    const chipsBefore = await probe.chips(page);
    assert.includes(chipsBefore, 'Government', 'Chips show govt filter (display label)');

    await page.locator('#btn-clear-all').click();
    await delay(100);

    // Clear All re-renders map; chips should update
    const chipsAfter = await probe.chips(page);
    assert.notIncludes(chipsAfter, 'Government', 'Chips cleared after Clear All');

    // Now test Clear All from within a state
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);
    const title = await probe.summaryTitle(page);
    assert.includes(title, 'MAHARASHTRA', 'In MH state view');

    await page.locator('#btn-clear-all').click();
    await delay(100);

    const title2 = await probe.summaryTitle(page);
    assert.includes(title2, 'ALL INDIA', 'Clear All from state returns to national');
  } finally {
    await teardown(context);
  }
}

export async function test_remove_individual_filter_chip() {
  const { page, context } = await setup();
  try {
    await page.evaluate(() => window.__app.setFilter('qualification', 'Graduate'));
    await page.evaluate(() => window.__app.updateAppliedFilters());
    await delay(300);

    const chips = await probe.chips(page);
    assert.includes(chips, 'Graduate', 'Graduate chip appears');

    // Remove Graduate chip
    await page.locator('.ad-filter-chip button').click();
    await delay(100);

    const chips2 = await probe.chips(page);
    assert.notIncludes(chips2, 'Graduate', 'Graduate chip removed');
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_govt_filter_in_pune_removes_private,
  test_clear_all_synchronizes_everything,
  test_remove_individual_filter_chip
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
