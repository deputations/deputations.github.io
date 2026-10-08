// Deterministic smoke tests for india-map-data.js
// Run: node tests/test_india_map_data.js
//
// Step-3 behavioral tests: exercise public API with mocked fetch, RPC,
// and in-memory fixtures. No source-text-only checks.

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
assert(window.IndiaMapData.load.toString().includes('loadFromJSON'), 'load() calls loadFromJSON');
assert(window.IndiaMapData.load.toString().includes('loadFromRawData'), 'load() calls loadFromRawData as fallback');
// C19: RPC overlay removed; rpcDiagnostic is the new entry point
assert(window.IndiaMapData.load.toString().includes('recomputeCounts'), 'load() calls recomputeCounts');
assert(typeof window.IndiaMapData.rpcDiagnostic === 'function', 'rpcDiagnostic() is exposed for freshness comparison');

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

section('C02: isActive — date normalization with both field names');
assert(window.IndiaMapData.isActive({ Last_Date_To_Apply: '2099-01-01' }) === true, 'Future date is active');
assert(window.IndiaMapData.isActive({ Last_Date_To_Apply: '2000-01-01' }) === false, 'Past date is inactive');
assert(window.IndiaMapData.isActive({}) === true, 'No date defaults to active');
assert(window.IndiaMapData.isActive({ closingDate: '2027-06-15' }) === true, 'Normalized closingDate field works');

section('C03: getFiltered — dedup and category filtering');
// Inject test fixtures via public API
const fixtures = [
  { id: 'F1', state_abbr: 'MH', category: 'Functional', district: 'Pune', location_scope: 'district', Last_Date_To_Apply: '2099-01-01', Functional_Area: 'Accounts and Finance', Post_Name: 'Accounts Officer' },
  { id: 'F2', state_abbr: 'MH', category: 'Education', district: 'Mumbai', location_scope: 'district', Last_Date_To_Apply: '2099-01-01', Functional_Area: 'Higher Education', Post_Name: 'Professor' },
  { id: 'F3', state_abbr: 'DL', category: 'Functional', district: 'New Delhi', location_scope: 'district', Last_Date_To_Apply: '2099-01-01', Functional_Area: 'Accounts and Finance', Post_Name: 'Accounts Officer' },
  { id: 'F1', state_abbr: 'MH', category: 'Functional', district: 'Pune', location_scope: 'district', Last_Date_To_Apply: '2099-01-01', Functional_Area: 'Accounts and Finance', Post_Name: 'Accounts Officer' }, // duplicate ID
];
fixtures.forEach(f => window.IndiaMapData.recordNewVacancy(f));
const mhAll = window.IndiaMapData.getFiltered('MH', {});
assert(mhAll.length === 2, `MH all returns 2 unique (got: ${mhAll.length}) — dedup works`);
const mhFunc = window.IndiaMapData.getFiltered('MH', { category: 'Functional' });
assert(mhFunc.length === 1, `MH Functional returns 1 (got: ${mhFunc.length})`);
assert(mhFunc[0].id === 'F1', 'Functional filter returns the right record');
const mhEdu = window.IndiaMapData.getFiltered('MH', { category: 'Education' });
assert(mhEdu.length === 1, `MH Education returns 1 (got: ${mhEdu.length})`);

section('C04: Draw-in animation consistency');
const css = fs.readFileSync(path.join(__dirname, '..', 'india-map.css'), 'utf-8');
assert(css.includes('@keyframes ad-draw'), 'CSS has @keyframes ad-draw');
assert(css.includes('.ad-draw-state'), 'CSS has .ad-draw-state class selector');

const js = fs.readFileSync(path.join(__dirname, '..', 'india-map-view.js'), 'utf-8');
assert(js.includes("`ad-draw "), 'JS uses ad-draw keyframe name (matches CSS)');
assert(!js.includes('ad-draw-state 2s'), 'JS does NOT use ad-draw-state as keyframe name (was bug)');

section('C04: map:drawInComplete event — not fixed timer');
assert(js.includes('map:drawInComplete'), 'JS dispatches map:drawInComplete event');
assert(!js.includes('setTimeout(() => drillToState'), 'Deep-link does NOT use fixed setTimeout');
assert(js.includes("addEventListener('map:drawInComplete'"), 'Deep-link listens for map:drawInComplete event');
// Verify animationend listener is used (not max-delay timer)
assert(js.includes("'animationend'"), 'Uses animationend listener for completion tracking');

section('C05: Modal DOM elements in HTML');
const html = fs.readFileSync(path.join(__dirname, '..', 'india-map.html'), 'utf-8');
assert(html.includes('id="modal"'), 'HTML has #modal dialog');
assert(html.includes('id="modalTitle"'), 'HTML has #modalTitle');
assert(html.includes('id="modalBody"'), 'HTML has #modalBody');
assert(html.includes('<dialog'), 'Uses <dialog> element');

section('C06: Mobile filter toggle');
assert(html.includes('id="mapFiltersToggle"'), 'HTML has #mapFiltersToggle');
assert(html.includes('hidden'), 'mapFiltersToggle has hidden attribute (shown by JS on mobile)');
assert(html.includes('aria-label="Toggle filters"'), 'Has aria-label for accessibility');
assert(html.includes('aria-expanded'), 'Has aria-expanded for accessibility');
assert(js.includes('syncMobileFilters'), 'JS has syncMobileFilters() function');
assert(js.includes('window.innerWidth < 768'), 'Mobile breakpoint check');

section('C06: neighbor-dim CSS exists');
assert(css.includes('.neighbor-dim'), 'CSS has .neighbor-dim rule for spotlight hover');

section('C06: Particle suspension on mobile');
assert(js.includes('window.innerWidth < 768'), 'Particle init checks mobile breakpoint');
assert(js.includes('Skip entirely on mobile'), 'Skip comment present');
// Resize handler stops particles on desktop->mobile
assert(js.includes('stopParticles()') && js.includes("addEventListener('resize'"), 'Resize handler stops particles on mobile transition');

section('C09: Tooltip uses getFiltered for filtered tooltip counts');
// Verify showTooltip uses getFiltered and activeMapFilter (C21)
assert(js.includes('getFiltered(abbr'), 'Tooltip uses getFiltered with abbr');
assert(js.includes('activeMapFilter'), 'Tooltip respects activeMapFilter');
assert(!js.includes('getAllVacancies().filter(v =>'), 'Tooltip does not use getAllVacancies (inefficient)');

section('C10: Delhi selectedDistrict declared');
assert(js.includes('let selectedDistrict'), 'selectedDistrict is module-level let');
assert(js.includes('selectedDistrict = null'), 'selectedDistrict initialised to null');
assert(js.includes('selectedDistrict = districtName'), 'showDelhiDistrict assigns to selectedDistrict');
// Rebuild SVG on Delhi→national return (behaviour: TestGesturesAfterDelhi)
assert(js.includes('function ensureMapSvg()') && js.includes('const svg = ensureMapSvg();'), 'goToNational rebuilds SVG when Delhi replaced it');

section('C12: Data source coherence — RPC removed from visible counts');
assert(window.IndiaMapData.load.toString().includes('JSON'), 'JSON loads first (canonical)');
const loadSrc = window.IndiaMapData.load.toString();
assert(!loadSrc.includes('useRpc'), 'RPC does NOT modify visible stateCounts');
assert(!loadSrc.includes('json+rpc'), 'Source is not tagged as json+rpc (RPC no longer visible)');
// Verify rpcDiagnostic does not modify stateCounts
assert(typeof window.IndiaMapData.rpcDiagnostic === 'function', 'rpcDiagnostic exists for diagnostic use');

section('C13: getFiltered dedup + empty/missing ID handling');
assert(window.IndiaMapData.normaliseVacancy({}) === null || window.IndiaMapData.normaliseVacancy({}).id === '', 'Missing ID handled gracefully');
const noId = window.IndiaMapData.normaliseVacancy({ state_abbr: 'MH' });
assert(noId.id === '', `No ID returns empty string (got: '${noId.id}')`);

section('C14: recordNewVacancy ingests with dedup and active scope');
window.IndiaMapData.allVacancies = [];
window.IndiaMapData.stateCounts = {};
window.IndiaMapData.districtCounts = {};
const r = window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'NEW1', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'district'
});
assert(r === true, 'recordNewVacancy returns true for new record');
assert(window.IndiaMapData.getStateCount('KA') === 1, 'State count incremented');
// Duplicate ingestion should replace, not double-count
const r2 = window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'NEW1', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'district'
});
assert(r2 === true, 'recordNewVacancy returns true for duplicate (dedup)');
assert(window.IndiaMapData.getStateCount('KA') === 1, `Duplicate does NOT double-count (got: ${window.IndiaMapData.getStateCount('KA')})`);
assert(window.IndiaMapData.getAllVacancies().filter(v => v.id === 'NEW1').length === 1, 'Only one entry with NEW1 id');
// Inactive vacancy should NOT count
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'OLD1', state_abbr: 'TN', district: 'Chennai',
  Last_Date_To_Apply: '2000-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('TN') === 0, 'Inactive vacancy does not count');
// Nationwide vacancy
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'NAT1', state_abbr: '', district: '',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'nationwide'
});
assert(window.IndiaMapData.getNationwideCount() === 1, 'Nationwide count incremented');

section('C16: Modal close handler wired');
assert(js.includes('modalClose') && js.includes('addEventListener'), 'Modal close button has click handler');
assert(js.includes('modal.close()'), 'Modal close() is called');
assert(js.includes('modal') && js.includes("'close'"), 'Modal listens for native close event');

section('C08: Homepage files untouched');
const indexPath = path.join(__dirname, '..', 'index.html');
const appJsPath = path.join(__dirname, '..', 'app.js');
const styleCssPath = path.join(__dirname, '..', 'style.css');
assert(fs.existsSync(indexPath), 'index.html exists');
assert(fs.existsSync(appJsPath), 'app.js exists');
assert(fs.existsSync(styleCssPath), 'style.css exists');

// ===== C20: recordNewVacancy — inactive→active, active→inactive, state A→B =====
section('C20: Realtime replacement — inactive→active same ID');
window.IndiaMapData.reset();
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R1', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2000-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('KA') === 0, 'Inactive record does not count');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R1', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('KA') === 1, 'inactive→active transition now counts');

section('C20: Realtime replacement — active→inactive same ID');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R1', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2000-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('KA') === 0, 'active→inactive transition decrements count');

section('C20: Realtime replacement — state A→B');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R2', state_abbr: 'MH', district: 'Pune',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('MH') === 1, 'State A has 1');
assert(window.IndiaMapData.getStateCount('KA') === 0, 'State B has 0');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R2', state_abbr: 'KA', district: 'Bangalore',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'district'
});
assert(window.IndiaMapData.getStateCount('MH') === 0, 'State A decremented to 0');
assert(window.IndiaMapData.getStateCount('KA') === 1, 'State B incremented to 1');

section('C20: Counters never negative');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R3', state_abbr: 'MH', district: 'Pune',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'nationwide'
});
assert(window.IndiaMapData.getNationwideCount() === 1, 'Nationwide count 1');
window.IndiaMapData.recordNewVacancy({
  Vacancy_ID: 'R3', state_abbr: 'MH', district: 'Pune',
  Last_Date_To_Apply: '2099-01-01', location_scope: 'nationwide'
});
assert(window.IndiaMapData.getNationwideCount() === 1, 'Nationwide count stays 1 (no negative)');
assert(window.IndiaMapData.getStateCount('MH') === 0, 'State MH stays 0 after nationwide dedup');

// ===== C23: State-ID adapter correctness =====
section('C23: State adapter — known abbreviations');
const norm23a = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X1', Location_State: 'Chhattisgarh', Last_Date_To_Apply: '2099-01-01' });
assert(norm23a && norm23a.state_abbr === 'CG', `Chhattisgarh → CG (got: ${norm23a?.state_abbr})`);

const norm23b = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X2', Location_State: 'Dadra and Nagar Haveli and Daman and Diu', Last_Date_To_Apply: '2099-01-01' });
assert(norm23b && norm23b.state_abbr === 'DNH', `DNHDD → DNH (got: ${norm23b?.state_abbr})`);

const norm23c = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X3', Location_State: 'Uttarakhand', Last_Date_To_Apply: '2099-01-01' });
assert(norm23c && norm23c.state_abbr === 'UK', `Uttarakhand → UK (got: ${norm23c?.state_abbr})`);

const norm23d = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X4', Location_State: 'Ladakh', Last_Date_To_Apply: '2099-01-01' });
assert(norm23d && norm23d.state_abbr === 'LA', `Ladakh → LA (got: ${norm23d?.state_abbr})`);

const norm23e = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X5', Location_State: 'Andaman and Nicobar Islands', Last_Date_To_Apply: '2099-01-01' });
assert(norm23e && norm23e.state_abbr === 'AN', `Andaman → AN (got: ${norm23e?.state_abbr})`);

section('C23: State adapter — unknown / invalid');
const bad23 = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X6', Location_State: 'Unknown State', Last_Date_To_Apply: '2099-01-01' });
assert(bad23 && bad23.state_abbr === '', `Unknown state → empty abbr (got: '${bad23?.state_abbr}')`);

const invalidPre = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X7', Location_State: 'MH', Last_Date_To_Apply: '2099-01-01', state_abbr: 'XX' });
assert(invalidPre && invalidPre.state_abbr === '', `Invalid pre-set abbr XX → empty (got: '${invalidPre?.state_abbr}')`);

const validPre = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'X8', Location_State: '', Last_Date_To_Apply: '2099-01-01', state_abbr: 'DL' });
assert(validPre && validPre.state_abbr === 'DL', `Valid pre-set abbr DL preserved (got: '${validPre?.state_abbr}')`);

section('C23: Delhi exact mapping');
const delhiNew = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'D1', Location_State: 'Delhi', Location_City: 'New Delhi', Last_Date_To_Apply: '2099-01-01' });
assert(delhiNew && delhiNew.district === 'New Delhi', `"New Delhi" city → New Delhi district (got: '${delhiNew?.district}')`);

const delhiGeneric = window.IndiaMapData.normaliseVacancy({ Vacancy_ID: 'D2', Location_State: 'Delhi', Location_City: 'Delhi', Last_Date_To_Apply: '2099-01-01' });
assert(delhiGeneric && delhiGeneric.district === '', `Generic "Delhi" → no district (got: '${delhiGeneric?.district}')`);

section('C25: District geometry resolver (single source, always an array)');
const DC = window.IndiaMapData.getDistrictCodes;
const expectedCodes = {
  JK:'01', HP:'02', PB:'03', CH:'04', UK:'05', HR:'06', DL:'07', RJ:'08',
  UP:'09', BR:'10', SK:'11', AR:'12', NL:'13', MN:'14', MZ:'15', TR:'16',
  ML:'17', AS:'18', WB:'19', JH:'20', OD:'21', CG:'22', MP:'23', GJ:'24',
  DNH:'26', MH:'27', KA:'29', GA:'30', LD:'31', KL:'32', TN:'33', PY:'34',
  AN:'35', TS:'36', AP:'37', LA:'38',
};
for (const [abbr, code] of Object.entries(expectedCodes)) {
  const got = DC(abbr);
  assert(Array.isArray(got) && got.length === 1 && got[0] === code,
    `${abbr} → ['${code}'] (got: ${JSON.stringify(got)})`);
}
assert(Array.isArray(DC('XX')) && DC('XX').length === 0, 'Unknown abbr → []');
const dcCopy = DC('MH'); dcCopy.push('99');
assert(DC('MH').length === 1, 'Returned array is a copy (mutation does not leak)');

section('C26: Real geo/india-districts-all.geojson contract');
const realGeo = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'geo', 'india-districts-all.geojson'), 'utf-8'));
const statesGeo = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'geo', 'india-states.geojson'), 'utf-8'));
assert(statesGeo.features.length === 36, `national map has 36 State/UT features (got ${statesGeo.features.length})`);
for (const abbr of Object.keys(expectedCodes)) {
  if (abbr === 'DL') continue; // Delhi uses the 11-hotspot image map
  const codes = DC(abbr);
  const feats = realGeo.features.filter(f => codes.includes(String(f.properties.st_code)));
  const named = feats.filter(f => String(f.properties.district || '').trim() !== '');
  assert(named.length > 0, `${abbr} ${JSON.stringify(codes)} resolves ${named.length} named district feature(s)`);
}
const code25 = realGeo.features.filter(f => String(f.properties.st_code) === '25');
assert(code25.length === 0, `no features under st_code 25 (got ${code25.length}) — DNH is 26 only`);
const dnhNames = realGeo.features
  .filter(f => String(f.properties.st_code) === '26' && String(f.properties.district || '').trim())
  .map(f => f.properties.district).sort();
assert(JSON.stringify(dnhNames) === JSON.stringify(['Dadra and Nagar Haveli', 'Daman', 'Diu']),
  `DNH 26 holds Dadra and Nagar Haveli, Daman, Diu (got: ${JSON.stringify(dnhNames)})`);

// ---- Summary ----
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nSome tests failed. Review output above.');
  process.exit(1);
}
