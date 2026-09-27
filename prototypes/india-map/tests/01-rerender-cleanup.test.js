// tests/01-rerender-cleanup.test.js
// P1: Repeated filtering and navigation leave exactly one map group with unique shape IDs.

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

export async function test_repeated_filtering_no_duplicate_layers() {
  const { page, context } = await setup();
  try {
    const g0 = await probe.mapGroups(page);
    const s0 = await probe.stateShapeCount(page);
    const idSet0 = await probe.uniqueShapeIdCount(page);
    assert.equal(g0, 1, `Initial groups (expected 1, got ${g0})`);
    assert.equal(s0, 36, `Initial state shapes (expected 36, got ${s0})`);
    assert.equal(idSet0, 36, `Initial unique IDs (expected 36, got ${idSet0})`);

    // Apply a filter via the drawer (exchange rail removed)
    await page.locator('#filter-jobType').selectOption('Full-time');
    await delay(100);
    const g1 = await probe.mapGroups(page);
    const s1 = await probe.stateShapeCount(page);
    const idSet1 = await probe.uniqueShapeIdCount(page);
    assert.equal(g1, 1, `After filter: groups (expected 1, got ${g1})`);
    assert.equal(s1, 36, `After filter: state shapes (expected 36, got ${s1})`);
    assert.equal(idSet1, 36, `After filter: unique IDs (expected 36, got ${idSet1})`);

    // Apply a different filter
    await page.locator('#filter-jobType').selectOption('Part-time');
    await delay(100);
    const g2 = await probe.mapGroups(page);
    const s2 = await probe.stateShapeCount(page);
    const idSet2 = await probe.uniqueShapeIdCount(page);
    assert.equal(g2, 1, `After 2nd filter: groups (expected 1, got ${g2})`);
    assert.equal(s2, 36, `After 2nd filter: state shapes (expected 36, got ${s2})`);
    assert.equal(idSet2, 36, `After 2nd filter: unique IDs (expected 36, got ${idSet2})`);

    // Clear filter
    await page.locator('#filter-jobType').selectOption('Any');
    await delay(100);
    const g3 = await probe.mapGroups(page);
    const s3 = await probe.stateShapeCount(page);
    const idSet3 = await probe.uniqueShapeIdCount(page);
    assert.equal(g3, 1, `After clear: groups (expected 1, got ${g3})`);
    assert.equal(s3, 36, `After clear: state shapes (expected 36, got ${s3})`);
    assert.equal(idSet3, 36, `After clear: unique IDs (expected 36, got ${idSet3})`);
  } finally {
    await teardown(context);
  }
}

export async function test_navigation_back_to_national_no_duplicate() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(300);
    let g = await probe.mapGroups(page);
    let s = await probe.stateShapeCount(page);
    let d = await probe.districtShapeCount(page);
    assert.equal(g, 1, `State view: groups (expected 1, got ${g})`);
    assert.equal(s, 0, `State view: state shapes (expected 0, got ${s})`);
    assert.equal(d > 0, true, `State view: districts present (got ${d})`);

    await page.locator('[data-district="Pune"]').click();
    await delay(200);
    g = await probe.mapGroups(page);
    assert.equal(g, 1, `District view: groups (expected 1, got ${g})`);

    // Close results panel before going back (overlay would intercept clicks)
    await page.locator('#btn-close-results').click();
    await delay(200);
    await page.locator('#btn-back').click();
    await delay(600); // wait for async district geometry load
    g = await probe.mapGroups(page);
    assert.equal(g, 1, `Back to state: groups (expected 1, got ${g})`);

    await page.locator('#btn-back').click();
    await delay(200);
    g = await probe.mapGroups(page);
    s = await probe.stateShapeCount(page);
    const idSet = await probe.uniqueShapeIdCount(page);
    assert.equal(g, 1, `Back to national: groups (expected 1, got ${g})`);
    assert.equal(s, 36, `Back to national: state shapes (expected 36, got ${s})`);
    assert.equal(idSet, 36, `Back to national: unique IDs (expected 36, got ${idSet})`);
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_repeated_filtering_no_duplicate_layers,
  test_navigation_back_to_national_no_duplicate
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
  await (await startServer())?.close?.();
  await new Promise(r => setTimeout(r, 500));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}
