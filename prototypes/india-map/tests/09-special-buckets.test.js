// tests/09-special-buckets.test.js
// Tests for nationwide and unknown-location special buckets.
// The map-provider separates nationwide ("All India") and unknown-location
// listings from per-state counts. These buckets should appear above regular
// results in the national view and should be absent from state/district views.

import { startServer, newContext, assert, delay } from './harness.js';

let server;

async function setup() {
  if (!server) server = await startServer();
  const { context, page } = await newContext();
  await page.goto('http://127.0.0.1:8092/');
  await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
  await delay(500); // allow app init and first render to complete
  return { page, context };
}

async function teardown(ctx) {
  await ctx.close();
}

// 1. National view shows nationwide count
export async function test_national_view_has_nationwide_bucket() {
  const { page, context } = await setup();
  try {
    const data = await page.evaluate(() => window.__app.getData());
    assert.isAbove(data.nationwideCount, 0,
      `National view should have nationwide count > 0 (got ${data.nationwideCount})`);
    assert.equal(data.nationwideCount, 1,
      `Nationwide count should be exactly 1 (got ${data.nationwideCount})`);
  } finally {
    await teardown(context);
  }
}

// 2. National view shows unknown count
export async function test_national_view_has_unknown_bucket() {
  const { page, context } = await setup();
  try {
    const data = await page.evaluate(() => window.__app.getData());
    assert.isAbove(data.unknownCount, 0,
      `National view should have unknown count > 0 (got ${data.unknownCount})`);
    assert.equal(data.unknownCount, 1,
      `Unknown count should be exactly 1 (got ${data.unknownCount})`);
  } finally {
    await teardown(context);
  }
}

// 3. Filtering reduces nationwide/unknown counts correctly
export async function test_filtering_reduces_special_counts() {
  const { page, context } = await setup();
  try {
    // Unfiltered baseline
    const unfiltered = await page.evaluate(() => window.__app.getData());
    assert.isAbove(unfiltered.nationwideCount, 0, 'unfiltered nationwideCount > 0');
    assert.isAbove(unfiltered.unknownCount, 0, 'unfiltered unknownCount > 0');

    // Apply category=govt filter: nationwide listing is govt (stays),
    // unknown listing is private (removed)
    await page.evaluate(() => window.__app.setFilter('category', 'govt'));
    await delay(200);

    const filtered = await page.evaluate(() => window.__app.getData());

    // Nationwide (govt) remains; unknown (private) drops to 0
    assert.equal(filtered.nationwideCount, unfiltered.nationwideCount,
      `Nationwide count should remain unchanged under govt filter (was ${unfiltered.nationwideCount}, now ${filtered.nationwideCount})`);
    assert.equal(filtered.unknownCount, 0,
      `Unknown count should be 0 after govt filter (got ${filtered.unknownCount})`);

    // Now apply category=private: nationwide (govt) drops, unknown (private) returns
    await page.evaluate(() => window.__app.setFilter('category', 'private'));
    await delay(200);

    const privateFiltered = await page.evaluate(() => window.__app.getData());
    assert.equal(privateFiltered.nationwideCount, 0,
      `Nationwide count should be 0 after private filter (got ${privateFiltered.nationwideCount})`);
    assert.equal(privateFiltered.unknownCount, unfiltered.unknownCount,
      `Unknown count should be restored under private filter (was ${unfiltered.unknownCount}, now ${privateFiltered.unknownCount})`);
  } finally {
    await teardown(context);
  }
}

// 4a. State view listings exclude nationwide and unknown entries
export async function test_state_view_excludes_special_buckets() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(600);

    const data = await page.evaluate(() => window.__app.getData());
    const stateListings = data.statewideListings['MH'] || [];

    const hasNationwide = stateListings.some(l => l.state === 'All India');
    const hasUnknown = stateListings.some(l => !l.state);

    assert.isFalse(hasNationwide,
      'State listings should not include nationwide ("All India") entries');
    assert.isFalse(hasUnknown,
      'State listings should not include unknown-location entries');
  } finally {
    await teardown(context);
  }
}

// 4b. District view listings exclude nationwide and unknown entries
export async function test_district_view_excludes_special_buckets() {
  const { page, context } = await setup();
  try {
    // Drill into MH, then Pune district
    await page.locator('[data-abbr="MH"]').click();
    await delay(600);

    await page.evaluate(() => {
      const btn = document.querySelector('.ad-state[data-district="Pune"]');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await delay(600);

    const data = await page.evaluate(() => window.__app.getData());
    // District listings = filteredListings matching state=MH and district=Pune
    const districtListings = data.filteredListings.filter(l => {
      if (!l.state || l.state === 'All India' || !l.district) return false;
      const states = l.state.split(',').map(s => s.trim());
      if (!states.includes('MH')) return false;
      return l.district === 'Pune';
    });

    const hasNationwide = districtListings.some(l => l.state === 'All India');
    const hasUnknown = districtListings.some(l => !l.state);

    assert.isFalse(hasNationwide,
      'District listings should not include nationwide ("All India") entries');
    assert.isFalse(hasUnknown,
      'District listings should not include unknown-location entries');
  } finally {
    await teardown(context);
  }
}

// 4c. Results panel in state/district view does not contain special-bucket elements
export async function test_results_panel_has_no_special_buckets_in_state_view() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(800);

    const hasSpecialBuckets = await page.evaluate(() => {
      return document.querySelectorAll('.ad-special-bucket').length;
    });
    assert.equal(hasSpecialBuckets, 0,
      `Results panel should have no .ad-special-bucket elements in state view (found ${hasSpecialBuckets})`);
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_national_view_has_nationwide_bucket,
  test_national_view_has_unknown_bucket,
  test_filtering_reduces_special_counts,
  test_state_view_excludes_special_buckets,
  test_district_view_excludes_special_buckets,
  test_results_panel_has_no_special_buckets_in_state_view
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
