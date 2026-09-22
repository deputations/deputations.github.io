// tests/06-distinct-ids.test.js
// P2: Duplicate IDs cannot inflate any aggregate or results count.

import { startServer, newContext, probe, assert, delay } from './harness.js';

let server;

async function setup(scenario = 'populated') {
  if (!server) server = await startServer();
  const { context, page } = await newContext();
  const scenarioParam = scenario !== 'populated' ? `?scenario=${scenario}` : '';
  await page.goto(`http://127.0.0.1:8092/${scenarioParam}`);
  await page.waitForFunction(() => document.getElementById('india-map').children.length > 0, null, { timeout: 5000 });
  return { page, context };
}

async function teardown(ctx) {
  await ctx.close();
}

export async function test_national_count_uses_distinct_ids() {
  const { page, context } = await setup();
  try {
    const cards = await probe.cardTitles(page);
    const unique = new Set(cards);
    assert.equal(unique.size, cards.length, 'No duplicate card titles (distinct IDs)');
  } finally {
    await teardown(context);
  }
}

export async function test_empty_scenario_shows_zero() {
  const { page, context } = await setup('empty');
  try {
    const count = await probe.summaryCount(page);
    assert.equal(count, '0', 'Empty scenario shows 0');
    const title = await probe.summaryTitle(page);
    assert.includes(title, 'INDIA', 'Empty scenario still shows national header');
  } finally {
    await teardown(context);
  }
}

export async function test_empty_zero_states_navigable() {
  const { page, context } = await setup('empty');
  try {
    const states = await probe.stateShapeCount(page);
    assert.isAbove(states, 0, 'Empty mode still shows state outlines');
    await page.locator('[data-abbr="MZ"]').click();
    await delay(300);
    const title = await probe.summaryTitle(page);
    assert.includes(title, 'MIZORAM', 'Empty mode can drill into zero-count state');
  } finally {
    await teardown(context);
  }
}

export async function test_multi_state_nationwide_unknown() {
  const { page, context } = await setup();
  try {
    const count = await probe.summaryCount(page);
    assert.equal(count, '17', 'Base populated count is 17 (without edge cases)');
  } finally {
    await teardown(context);
  }
}

const tests = [
  test_national_count_uses_distinct_ids,
  test_empty_scenario_shows_zero,
  test_empty_zero_states_navigable,
  test_multi_state_nationwide_unknown
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
