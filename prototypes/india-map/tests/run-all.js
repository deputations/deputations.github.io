// tests/run-all.js — Run all test files
import { startServer, stopServer, startBrowser, stopBrowser } from './harness.js';

const testFiles = [
  '01-rerender-cleanup.test.js',
  '02-filter-sync.test.js',
  '03-history.test.js',
  '04-async-geometry.test.js',
  '05-zoom.test.js',
  '06-distinct-ids.test.js',
  '07-geography.test.js'
];

async function main() {
  await startServer();
  await startBrowser();

  let pass = 0, fail = 0;
  const failed = [];

  for (const file of testFiles) {
    const mod = await import(`./${file}`);
    const tests = Object.entries(mod).filter(([k]) => k.startsWith('test_'));
    console.log(`\n══ ${file} ══`);
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        pass++;
      } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        failed.push({ name, file, err });
        fail++;
      }
    }
  }

  await stopBrowser();
  await stopServer();

  console.log(`\n══ RESULTS ══\n  ${pass} passed, ${fail} failed`);
  if (failed.length > 0) {
    console.log('\nFailed tests:');
    failed.forEach(f => console.log(`  - ${f.file}: ${f.name}`));
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
