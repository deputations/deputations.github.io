// tests/03-history.test.js
// P1: Direct links, reload, Back and Forward restore state/district/results.
// P1: Restoring browser history does not push another history entry.

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

export async function test_back_forward_restores_complete_state() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(200);
    await page.locator('[data-district="Pune"]').click();
    await delay(200);

    let url = await probe.url(page);
    assert.matches(url, /state=MH&district=Pune/, 'URL has state=MH&district=Pune');

    await page.goBack();
    await delay(300);

    url = await probe.url(page);
    assert.matches(url, /state=MH$/, 'Back: URL is /?state=MH');
    const title = await probe.summaryTitle(page);
    assert.includes(title, 'MAHARASHTRA', 'Back: summary is Maharashtra');

    await page.goForward();
    await delay(300);

    url = await probe.url(page);
    assert.matches(url, /state=MH&district=Pune/, 'Forward: URL restored to Pune');

    const resultsHidden = await probe.resultsHidden(page);
    assert.isFalse(resultsHidden, 'Forward: results panel is visible');
    const cards = await probe.cardTitles(page);
    assert.isAbove(cards.length, 0, 'Forward: results restored');
  } finally {
    await teardown(context);
  }
}

export async function test_deep_link_restores_district_on_reload() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(800); // cinematic zoom-out
    await page.locator('[data-district="Pune"]').click();
    await delay(200);

    await page.reload();
    await delay(500);

    const url = await probe.url(page);
    assert.matches(url, /state=MH/, 'Reload: URL retains state=MH');
    assert.matches(url, /district=Pune/, 'Reload: URL retains district=Pune');

    const title = await probe.summaryTitle(page);
    assert.includes(title, 'MAHARASHTRA', 'Reload: summary is Maharashtra');

    const resultsHidden = await probe.resultsHidden(page);
    assert.isFalse(resultsHidden, 'Reload: results panel visible');
    const cards = await probe.cardTitles(page);
    assert.isAbove(cards.length, 0, 'Reload: Pune cards restored');
  } finally {
    await teardown(context);
  }
}

export async function test_deep_link_national_no_extra_history() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(800); // cinematic zoom-out

    let url = await probe.url(page);
    assert.matches(url, /state=MH$/, 'State URL correct');

    await page.locator('#btn-back').click();
    await delay(600); // wait for back animation

    const natUrl = await probe.url(page);
    assert.equal(natUrl, 'http://127.0.0.1:8092/', 'National URL has no query');

    // Verify we're at national view (btn-back is now hidden)
    const title = await probe.summaryTitle(page);
    assert.includes(title, 'ALL INDIA', 'View is national after back');
  } finally {
    await teardown(context);
  }
}

export async function test_popstate_no_extra_push() {
  const { page, context } = await setup();
  try {
    await page.locator('[data-abbr="MH"]').click();
    await delay(200);
    await page.locator('[data-district="Pune"]').click();
    await delay(200);

    const urlBefore = await probe.url(page);

    await page.goBack();
    await delay(200);
    await page.goForward();
    await delay(200);

    const urlAfter = await probe.url(page);
    assert.equal(urlBefore, urlAfter, 'Forward returns to exact same URL');
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_back_forward_restores_complete_state,
  test_deep_link_restores_district_on_reload,
  test_deep_link_national_no_extra_history,
  test_popstate_no_extra_push
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
