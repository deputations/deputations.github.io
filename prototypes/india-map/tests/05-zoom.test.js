// tests/05-zoom.test.js
// P2: Zoom is incremental; filter doesn't break transforms.

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

function parseScale(transform) {
  if (!transform) return 1.0;
  const m = transform.match(/scale\(([^)]+)\)/);
  return m ? parseFloat(m[1]) : 1.0;
}

export async function test_zoom_is_incremental() {
  const { page, context } = await setup();
  try {
    const t0 = await probe.transforms(page);
    const scale0 = parseScale(t0[0]);

    await page.locator('#btn-zoom-in').click();
    await delay(100);
    const t1 = await probe.transforms(page);
    const scale1 = parseScale(t1[0]);
    assert.isAbove(scale1, scale0, 'Zoom in increases scale');

    await page.locator('#btn-zoom-in').click();
    await delay(100);
    const t2 = await probe.transforms(page);
    const scale2 = parseScale(t2[0]);
    assert.isAbove(scale2, scale1, 'Second zoom increases further');

    await page.locator('#btn-zoom-out').click();
    await delay(100);
    const t3 = await probe.transforms(page);
    const scale3 = parseScale(t3[0]);
    assert.truthy(scale3 < scale2, `Zoom out decreases scale (${scale3} < ${scale2})`);

    await page.locator('#btn-zoom-reset').click();
    await delay(400);
    const t4 = await probe.transforms(page);
    const scale4 = parseScale(t4[0]);
    assert.truthy(Math.abs(scale4 - 1.0) < 0.002, `Reset converges to 1.0 (got ${scale4})`);
  } finally {
    await teardown(context);
  }
}

export async function test_zoom_preserves_filter() {
  const { page, context } = await setup();
  try {
    await page.locator('.exchange-btn[data-exchange="govt"]').click();
    await delay(100);

    const countBefore = await probe.summaryCount(page);
    assert.equal(countBefore, '8', 'Govt filter shows 8');

    await page.locator('#btn-zoom-in').click();
    await delay(100);
    const countAfter = await probe.summaryCount(page);
    assert.equal(countAfter, '8', 'Zoom does not change filtered count');

    const active = await probe.activeExchange(page);
    assert.equal(active, 'govt', 'Exchange still govt after zoom');
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_zoom_is_incremental,
  test_zoom_preserves_filter
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
