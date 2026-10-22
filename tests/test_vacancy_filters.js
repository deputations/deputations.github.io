// shared/vacancy-filters.js — the filter rules the home page and the India
// map share, and the saved selection that carries a choice between them.
// Run: node --test tests/test_vacancy_filters.js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const store = {};
  const sessionStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  const context = {URLSearchParams, Map, Set, WeakMap, sessionStorage};
  context.window = context;
  vm.createContext(context);
  for (const file of ['enrich.js', 'shared/vacancy-filters.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, {filename: file});
  }
  return {F: context.DepFilters, store};
}

const rows = [
  {Post_Name: 'Deputy Director', Organisation: 'Central Water Commission (CWC)', Ministry: 'Jal Shakti',
    Organisation_Type: 'Attached Office', Region: 'North', Location_City: 'New Delhi', Location_State: 'Delhi',
    Level_Text: 'Level-11', Status: 'Active', eligibility_tiers: [{level: 10, min_years: 3}]},
  {Post_Name: 'Assistant Director', Organisation: 'Central Water Commission', Ministry: 'Jal Shakti',
    Organisation_Type: 'Attached Office', Region: 'South', Location_City: 'Chennai', Location_State: 'Tamil Nadu',
    Level_Text: 'Level-10', Status: 'Active', eligibility_tiers: [{level: 8, min_years: 2}]},
  {Post_Name: 'Private Secretary', Organisation: 'AIIMS, Patna', Ministry: 'Health and Family Welfare',
    Organisation_Type: 'Autonomous Body', Region: 'East', Location_City: 'Patna', Location_State: 'Bihar',
    Level_Text: 'Level-8', Status: 'Expired'},
];

test('an empty selection matches every row, and Status defaults to Active', () => {
  const {F} = load();
  const s = F.emptyState();
  assert.equal(s.status, 'Active');
  assert.deepEqual(rows.map(r => F.matches(r, s, {applyStatus: false})), [true, true, true]);
  assert.deepEqual(rows.map(r => F.matches(r, s)), [true, true, false]);
});

test('each sidebar filter narrows the rows', () => {
  const {F} = load();
  const pick = patch => rows.filter(r => F.matches(r, Object.assign(F.emptyState(), patch), {applyStatus: false}))
    .map(r => r.Post_Name);
  assert.deepEqual(pick({levels: ['Level-10', 'Level-8']}), ['Assistant Director', 'Private Secretary']);
  assert.deepEqual(pick({ministry: 'Jal Shakti'}), ['Deputy Director', 'Assistant Director']);
  assert.deepEqual(pick({orgType: 'Autonomous Body'}), ['Private Secretary']);
  assert.deepEqual(pick({region: 'South'}), ['Assistant Director']);
  assert.deepEqual(pick({locations: ['New Delhi, Delhi']}), ['Deputy Director']);
  // Both spellings of the Commission are one organisation
  assert.deepEqual(pick({orgs: [F.orgKey('Central Water Commission (CWC)')]}), ['Deputy Director', 'Assistant Director']);
  // Search tolerates one typo in a single word
  assert.deepEqual(pick({search: 'secretery'}), ['Private Secretary']);
  // My Pay Level uses the eligibility tiers; years only count with a level
  assert.deepEqual(pick({myPayLevel: '10'}), ['Deputy Director']);
  assert.deepEqual(pick({myPayLevel: '10', experience: '1'}), []);
  assert.deepEqual(pick({experience: '1'}), ['Deputy Director', 'Assistant Director', 'Private Secretary']);
});

test('exclude drops one filter, for that dropdown\'s own counts', () => {
  const {F} = load();
  const s = Object.assign(F.emptyState(), {ministry: 'Jal Shakti', region: 'South'});
  const count = exclude => rows.filter(r => F.matches(r, s, {exclude, applyStatus: false})).length;
  assert.equal(count(''), 1);
  assert.equal(count('region'), 2);
  assert.equal(count('ministry'), 1);
});

test('activeCount counts the filters both pages offer', () => {
  const {F} = load();
  assert.equal(F.activeCount(F.emptyState()), 0);
  const s = Object.assign(F.emptyState(), {levels: ['Level-10', 'Level-11'], ministry: 'Jal Shakti',
    status: '', quick: ['closingSoon'], watchlist: true});
  assert.equal(F.activeCount(s), 2);
});

test('a selection survives the home page URL format', () => {
  const {F} = load();
  const s = Object.assign(F.emptyState(), {
    search: 'director', myPayLevel: '13A', experience: '3', ministry: 'Jal Shakti', orgType: 'Attached Office',
    region: 'NorthEast', levels: ['Level-10', 'Level-11'], orgs: [F.orgKey('AIIMS, Patna')],
    locations: ['Patna, Bihar', 'New Delhi, Delhi'], status: '', quick: ['closingSoon'], watchlist: true,
  });
  const p = F.toParams(s);
  assert.equal(p.get('level'), 'Level-10,Level-11');
  assert.equal(p.get('status'), '', 'Status "All" is written, so it is not read back as Active');
  assert.ok(F.hasFilterParams(p));
  assert.deepEqual(JSON.parse(JSON.stringify(F.fromParams(new URLSearchParams(p.toString())))),
    JSON.parse(JSON.stringify(s)));
  // An organisation name with a comma stays one value
  const q = new URLSearchParams();
  q.append('org', 'AIIMS, Patna');
  assert.deepEqual(Array.from(F.fromParams(q).orgs), ['aiims patna']);
  assert.equal(F.fromParams(new URLSearchParams()).status, 'Active');
  assert.ok(!F.hasFilterParams(new URLSearchParams('state=MH')));
});

test('save and load share a selection across pages in one tab', () => {
  const {F, store} = load();
  assert.equal(F.load(), null, 'nothing saved yet');
  F.save(Object.assign(F.emptyState(), {levels: ['Level-10'], ministry: 'Jal Shakti'}));
  assert.equal(store[F.STORE_KEY], 'ministry=Jal+Shakti&level=Level-10&status=Active');
  const back = F.load();
  assert.deepEqual(Array.from(back.levels), ['Level-10']);
  assert.equal(back.ministry, 'Jal Shakti');
});

test('pay levels sort highest first, with 13A between 14 and 13', () => {
  const {F} = load();
  assert.deepEqual(['Level-8', 'Level-13', 'Level-13A', 'Level-14', 'Other'].sort(F.compareLevels),
    ['Level-14', 'Level-13A', 'Level-13', 'Level-8', 'Other']);
  const v = Array.from(F.myPayLevelValues());
  assert.equal(v[0], '18');
  assert.deepEqual(v.slice(v.indexOf('14'), v.indexOf('14') + 3), ['14', '13A', '13']);
});
