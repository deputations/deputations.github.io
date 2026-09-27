// tests/run-all.js — Run all test files sequentially in one process
// This avoids port conflicts by reusing the same server across all tests

const { startServer, newContext, teardown, delay } = await import('./harness.js');
const { chromium } = await import('playwright');

const testFiles = [
  '01-rerender-cleanup.test.js',
  '02-filter-sync.test.js',
  '03-history.test.js',
  '04-async-geometry.test.js',
  '05-zoom.test.js',
  '06-distinct-ids.test.js',
  '07-geography.test.js',
  '08-tooltip.test.js',
  '09-special-buckets.test.js',
];

console.log('Starting test server...');
const server = await startServer();
console.log(`Server running at http://127.0.0.1:8092/\n`);

let passed = 0;
let failed = 0;

for (const file of testFiles) {
  const { default: runTests } = await import(`./${file}`);
  const browser = await chromium.launch();

  for (const testFn of runTests) {
    const context = await browser.newContext();
    try {
      await testFn(context, browser);
      passed++;
      process.stdout.write('✓');
    } catch (err) {
      failed++;
      console.log(`\n✗ ${file}: ${testFn.name}`);
      console.log(`  ${err.message.split('\n')[0]}`);
    }
    await context.close();
  }

  await browser.close();
}

console.log(`\n\n══ Results: ${passed} passed, ${failed} failed (${testFiles.length} files) ══`);

server.close();
process.exit(failed > 0 ? 1 : 0);
