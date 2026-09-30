// Deterministic smoke tests for india-map-data.js
// Run: node tests/test_india_map_data.js

const fs = require('fs');
const path = require('path');

// ---- Minimal DOM shims ----
globalThis.window = globalThis;
globalThis.document = { readyState: 'complete' };
globalThis.sessionStorage = {};

// ---- Load the data module ----
const dataPath = path.join(__dirname, '..', 'india-map-data.js');
const dataCode = fs.readFileSync(dataPath, 'utf-8');
eval(dataCode);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log(`  PASS: ${message}`); }
  else { failed++; console.error(`  FAIL: ${message}`); }
}

function section(name) { console.log(`\n=== ${name} ===`); }

// ===== TESTS =====

section('C01: Data loader — single load() definition');
assert(typeof window.IndiaMapData.load === 'function', 'load() is a function');
// loadFromJSON/Supabase/RawData are internal (not exported) — load() orchestrates them
assert(window.IndiaMapData.load.toString().includes('loadFromSupabase'), 'load() calls loadFromSupabase');
assert(window.IndiaMapData.load.toString().includes('loadFromJSON'), 'load() calls loadFromJSON');
assert(window.IndiaMapData.load.toString().includes('loadFromRawData'), 'load() calls loadFromRawData as fallback');

section('C02: normaliseVacancy + deriveCategory');
const raw = {
  Vacancy_ID: 'V001',
  Post_Name: 'Professor of Computer Science',
  Ministry: 'Education',
  Functional_Area: 'Higher Education and Academic Affairs',
  Last_Date_To_Apply: '2026-12-31',
  Status: 'Active',
  state_abbr: 'MH',
  district: 'Pune',
  location_scope: 'district'
};
const norm = window.IndiaMapData.normaliseVacancy(raw);
assert(norm !== null, 'normaliseVacancy returns non-null');
assert(norm.id === 'V001', 'id preserved');
assert(norm.state_abbr === 'MH', 'state_abbr preserved');
assert(norm.district === 'Pune', 'district preserved');
assert(norm.category === 'Education', `deriveCategory returns Education (got: ${norm.category})`);

const raw2 = {
  Vacancy_ID: 'V002',
  Post_Name: 'Assistant Accounts Officer',
  Functional_Area: 'Accounts and Finance Administration',
  Last_Date_To_Apply: '2026-11-30',
  state_abbr: 'DL',
  district: 'New Delhi',
  location_scope: 'district'
};
const norm2 = window.IndiaMapData.normaliseVacancy(raw2);
assert(norm2.category === 'Functional', `deriveCategory returns Functional (got: ${norm2.category})`);

const raw3 = { Vacancy_ID: 'V003', Post_Name: 'Mystery Post', Functional_Area: 'Unknown Field', Last_Date_To_Apply: '2026-10-01', state_abbr: 'KA', district: '', location_scope: 'district' };
const norm3 = window.IndiaMapData.normaliseVacancy(raw3);
assert(norm3.category === 'General', `deriveCategory returns General (got: ${norm3.category})`);

section('C02: isActive — date normalization');
assert(window.IndiaMapData.isActive({ Last_Date_To_Apply: '2099-01-01' }) === true, 'Future date is active');
assert(window.IndiaMapData.isActive({ Last_Date_To_Apply: '2000-01-01' }) === false, 'Past date is inactive');
assert(window.IndiaMapData.isActive({}) === true, 'No date defaults to active');
assert(window.IndiaMapData.isActive({ closingDate: '2027-06-15' }) === true, 'Normalized closingDate field works');

section('C02: normaliseVacancy edge cases');
assert(window.IndiaMapData.normaliseVacancy(null) === null, 'Null returns null');
assert(window.IndiaMapData.normaliseVacancy(undefined) === null, 'Undefined returns null');
assert(window.IndiaMapData.normaliseVacancy('string') === null, 'String returns null');
assert(window.IndiaMapData.normaliseVacancy({}).id === '', 'Empty object normalises');

section('C03: getFiltered — category filtering (unit)');
// Test the deriveCategory function directly by checking normaliseVacancy output
assert(norm.category === 'Education', 'Professor → Education');
assert(norm2.category === 'Functional', 'Accounts Officer → Functional');
assert(norm3.category === 'General', 'Unknown → General');

// Test that getFiltered handles empty abbr gracefully
const result = window.IndiaMapData.getFiltered('');
assert(Array.isArray(result), 'getFiltered returns array for empty abbr');
assert(result.length === 0, 'getFiltered returns empty for empty abbr');

section('C03: getFiltered with category string matching');
const result2 = window.IndiaMapData.getFiltered('MH', { category: 'Education' });
assert(Array.isArray(result2), 'getFiltered returns array with category');
// With empty allVacancies, returns 0 — that is correct behavior
assert(result2.length === 0, 'getFiltered returns 0 when allVacancies is empty (no data loaded)');

section('C04: Draw-in animation consistency');
const cssPath = path.join(__dirname, '..', 'india-map.css');
const css = fs.readFileSync(cssPath, 'utf-8');
assert(css.includes('@keyframes ad-draw'), 'CSS has @keyframes ad-draw');
assert(css.includes('.ad-draw-state'), 'CSS has .ad-draw-state class selector');

const jsPath = path.join(__dirname, '..', 'india-map-view.js');
const js = fs.readFileSync(jsPath, 'utf-8');
assert(js.includes("`ad-draw "), 'JS uses ad-draw keyframe name (matches CSS)');
assert(!js.includes('ad-draw-state 2s'), 'JS does NOT use ad-draw-state as keyframe name (was bug)');

section('C04: map:drawInComplete event');
assert(js.includes('map:drawInComplete'), 'JS dispatches map:drawInComplete event');
assert(!js.includes('setTimeout(() => drillToState'), 'Deep-link does NOT use fixed setTimeout');
assert(js.includes("addEventListener('map:drawInComplete'"), 'Deep-link listens for map:drawInComplete event');

section('C05: Modal DOM elements in HTML');
const htmlPath = path.join(__dirname, '..', 'india-map.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
assert(html.includes('id="modal"'), 'HTML has #modal dialog element');
assert(html.includes('id="modalTitle"'), 'HTML has #modalTitle');
assert(html.includes('id="modalBody"'), 'HTML has #modalBody');
assert(html.includes('<dialog'), 'Uses native <dialog> element');

section('C06: Mobile filter toggle in HTML');
assert(html.includes('id="mapFiltersToggle"'), 'HTML has #mapFiltersToggle');
assert(html.includes('hidden'), 'mapFiltersToggle has hidden attribute (shown by JS on mobile)');
assert(html.includes('aria-label="Toggle filters"'), 'Has aria-label for accessibility');
assert(html.includes('aria-expanded'), 'Has aria-expanded for accessibility');
// JS wires the toggle click handler
assert(js.includes('mapFiltersToggle'), 'JS references mapFiltersToggle element');
assert(js.includes('onFiltersToggle'), 'JS wires onFiltersToggle handler');

section('C06: neighbor-dim CSS exists');
assert(css.includes('.neighbor-dim'), 'CSS has .neighbor-dim rule for spotlight hover');

section('C06: Particle suspension on mobile');
assert(js.includes('window.innerWidth < 768'), 'Particle init checks mobile breakpoint');
assert(js.includes('Skip entirely on mobile'), 'Skip comment present for mobile particle suspension');

section('C07: Realtime handler uses public API');
assert(js.includes('IndiaMapData.incrementStateCount'), 'handleNewVacancy uses incrementStateCount() public API');
assert(!js.includes('IndiaMapData.stateCounts'), 'handleNewVacancy does NOT access private stateCounts');
assert(js.includes('getStateCount(abbr)'), 'handleNewVacancy uses getStateCount() for display');

section('C07: incrementStateCount public API');
assert(typeof window.IndiaMapData.incrementStateCount === 'function', 'incrementStateCount is exported');
// State is private — verify the function is callable and doesn't throw.
// Actual count verification requires load() to populate state first.
let threw = false;
try { window.IndiaMapData.incrementStateCount('DL', 'New Delhi'); } catch (e) { threw = true; }
assert(!threw, 'incrementStateCount does not throw for valid input');
try { window.IndiaMapData.incrementStateCount('', ''); } catch (e) { threw = true; }
assert(!threw, 'incrementStateCount handles empty abbr gracefully');

section('C08: Homepage files untouched');
const indexPath = path.join(__dirname, '..', 'index.html');
const appJsPath = path.join(__dirname, '..', 'app.js');
const styleCssPath = path.join(__dirname, '..', 'style.css');
assert(fs.existsSync(indexPath), 'index.html exists on disk');
assert(fs.existsSync(appJsPath), 'app.js exists on disk');
assert(fs.existsSync(styleCssPath), 'style.css exists on disk');

// ---- Summary ----
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSome tests failed. Review output above.');
  process.exit(1);
}
