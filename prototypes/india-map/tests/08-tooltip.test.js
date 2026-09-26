// tests/08-tooltip.test.js
// Tests: zero-count states show district count preview, non-zero states show count

import { startServer, newContext, assert, delay } from './harness.js';

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

export async function test_zero_count_shows_district_preview() {
  const { page, context } = await setup();
  try {
    // Goa has 0 listings — hover to check tooltip
    const goaPath = page.locator('#map-group [data-abbr="GA"]');
    await goaPath.hover();
    await delay(300);

    const tooltip = await page.evaluate(() => ({
      name: document.getElementById('tooltip-name')?.textContent,
      count: document.getElementById('tooltip-count')?.textContent
    }));

    assert.equal(tooltip.name, 'Goa', `Tooltip name (expected "Goa", got "${tooltip.name}")`);
    assert.isTrue(
      tooltip.count.includes('district') || tooltip.count === '0 deputations',
      `Zero-count tooltip should mention districts or show 0 deputations (got "${tooltip.count}")`
    );
  } finally {
    await teardown(context);
  }
}

export async function test_nonzero_count_shows_number() {
  const { page, context } = await setup();
  try {
    // Maharashtra has 6 listings — hover to check tooltip
    const mhPath = page.locator('#map-group [data-abbr="MH"]');
    await mhPath.hover();
    await delay(300);

    const tooltip = await page.evaluate(() => ({
      name: document.getElementById('tooltip-name')?.textContent,
      count: document.getElementById('tooltip-count')?.textContent
    }));

    assert.equal(tooltip.name, 'Maharashtra', `Tooltip name (expected "Maharashtra", got "${tooltip.name}")`);
    assert.equal(tooltip.count, '6', `Non-zero tooltip should show count (expected "6", got "${tooltip.count}")`);
  } finally {
    await teardown(context);
  }
}

export async function test_district_map_hover_shows_district_name() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(600);

    // Hover over Pune district
    const punePath = page.locator('#map-group [data-district="Pune"]');
    await punePath.hover();
    await delay(300);

    const tooltip = await page.evaluate(() => ({
      name: document.getElementById('tooltip-name')?.textContent,
      count: document.getElementById('tooltip-count')?.textContent
    }));

    assert.isTrue(
      tooltip.name.includes('Pune'),
      `District tooltip should contain "Pune" (got "${tooltip.name}")`
    );
    // Pune has 2 listings
    assert.equal(tooltip.count, '2', `Pune district count (expected 2, got ${tooltip.count})`);
  } finally {
    await teardown(context);
  }
}

export async function test_empty_scenario_tooltip() {
  const { page, context } = await newContext();
  try {
    await page.goto('http://127.0.0.1:8092/?scenario=empty');
    await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
    await delay(500);

    // Hover over MH in empty scenario — should still show district preview
    const mhPath = page.locator('#map-group [data-abbr="MH"]');
    await mhPath.hover();
    await delay(300);

    const tooltip = await page.evaluate(() => ({
      name: document.getElementById('tooltip-name')?.textContent,
      count: document.getElementById('tooltip-count')?.textContent
    }));

    assert.equal(tooltip.name, 'Maharashtra', `Empty-scenario tooltip name`);
    // Empty scenario has 0 deputations everywhere
    assert.truthy(
      tooltip.count.includes('district') || tooltip.count === '0 deputations',
      `Empty-scenario zero-count tooltip (got "${tooltip.count}")`
    );
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_zero_count_shows_district_preview,
  test_nonzero_count_shows_number,
  test_district_map_hover_shows_district_name,
  test_empty_scenario_tooltip
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
