// tests/07-geography.test.js
// District alias validation, Mumbai/Bengaluru mismatches, coverage validation.

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

export async function test_maharashtra_district_count() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);
    const count = await probe.districtShapeCount(page);
    assert.equal(count, 35, `MH has 35 district shapes (got ${count})`);
  } finally {
    await teardown(context);
  }
}

export async function test_karnataka_district_coverage() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="KA"]').click();
    await delay(300);
    const hasBengaluru = await page.locator('[data-district="Bengaluru Urban"]').count();
    assert.equal(hasBengaluru, 1, 'Bengaluru Urban district is present');
  } finally {
    await teardown(context);
  }
}

export async function test_mumbai_alias_aggregates_both_fixtures() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);
    // The GeoJSON "Mumbai" feature renders with fixture name "Mumbai City".
    // Its aria-label should aggregate both Mumbai City (1) + Mumbai Suburban (1) = 2
    const ariaLabel = await page.locator('[data-district="Mumbai City"]').getAttribute('aria-label');
    assert.includes(ariaLabel, ': 2 jobs', `Mumbai polygon aggregates both fixtures (got "${ariaLabel}")`);
  } finally {
    await teardown(context);
  }
}

export async function test_delhi_has_districts() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="DL"]').click();
    await delay(300);
    const count = await probe.districtShapeCount(page);
    assert.equal(count, 11, `DL has 11 district shapes (got ${count})`);
  } finally {
    await teardown(context);
  }
}

export async function test_geojson_assets_exist() {
  const { page, context } = await setup();
  try {
    const paths = await page.locator('#india-map path').count();
    assert.isAbove(paths, 0, 'Map has path elements');
    const states = await probe.stateShapeCount(page);
    assert.equal(states, 36, 'All 36 states rendered');
  } finally {
    await teardown(context);
  }
}

export async function test_ka_has_30_districts() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="KA"]').click();
    await delay(300);
    const count = await probe.districtShapeCount(page);
    assert.equal(count, 30, `KA has 30 district shapes (got ${count})`);
  } finally {
    await teardown(context);
  }
}

export async function test_multi_state_listings_counted_once_nationally() {
  const { page, context } = await setup();
  try {
    const count = await probe.summaryCount(page);
    assert.equal(count, '17', 'National count is 17 (base without edge cases)');
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_maharashtra_district_count,
  test_karnataka_district_coverage,
  test_delhi_has_districts,
  test_geojson_assets_exist,
  test_ka_has_30_districts,
  test_multi_state_listings_counted_once_nationally,
  test_mumbai_alias_aggregates_both_fixtures
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
