const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const code = fs.readFileSync('public-data.js', 'utf8');

function fixture(options = {}) {
  const current = [{Vacancy_ID:'A', Last_Date_To_Apply:'2099-10-17'}];
  const archive = [{Vacancy_ID:'B', Last_Date_To_Apply:'2020-01-01'}];
  const version = '0123456789abcdefabcd';
  const desc = (path, rows) => ({path:`snapshots/${version}/${path}.json`, count:rows.length,
    sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')});
  const manifest = {schema:1, version, generated_at_utc:new Date().toISOString(),
    current:desc('current',current), archive:{a:desc('archive-a',archive)}, index:{B:'a'}};
  const paths = {'data/vacancies-manifest.json':manifest,
    [`data/${manifest.current.path}`]:current, [`data/${manifest.archive.a.path}`]:archive,
    'data/vacancies.json':current.concat(archive)};
  const calls = [], elements = {};
  const context = {window:{crypto:crypto.webcrypto}, crypto:crypto.webcrypto, Intl, Date, Map, Set, Promise,
    AbortController, setTimeout, clearTimeout, TextDecoder, Uint8Array,
    document:{body:{appendChild(el){elements[el.id]=el;}},getElementById(id){return elements[id];},createElement(){return {style:{},setAttribute(){}};}},
    async fetch(path) {
      calls.push(path);
      if(options.failManifest && path.endsWith('manifest.json')) throw new Error('offline');
      const body = JSON.stringify(options.corrupt && path.includes('archive-') ? [] : paths[path]);
      return {ok:!!paths[path], status:200, arrayBuffer:async()=>new TextEncoder().encode(body).buffer};
    }};
  vm.createContext(context); vm.runInContext(code, context);
  return {api:context.window.PublicVacancies,calls,paths};
}
test('startup fetches only current data; archived deep link loads one pinned shard',async()=>{
  const f=fixture();assert.equal((await f.api.load()).length,1);
  assert.equal(f.calls.length,2);assert(!f.calls.some(p=>p.includes('archive-')));
  assert.equal((await f.api.load({ids:['B']})).length,2);assert.equal(f.calls.length,3);
  await f.api.load({all:true});assert.equal(f.calls.length,3);assert(f.api.archiveLoaded());
});
test('checksum failure rejects archive without destroying current data',async()=>{
  const f=fixture({corrupt:true});await f.api.load();
  await assert.rejects(()=>f.api.load({all:true}),/checksum/);
  assert.equal((await f.api.load()).length,1);
});
test('missing manifest falls back to last public compatibility file without Supabase',async()=>{
  const f=fixture({failManifest:true});assert.equal((await f.api.load()).length,2);
  assert(f.api.archiveLoaded());assert(f.calls.every(p=>p.startsWith('data/')));
});
test('deadline stays active until midnight Kolkata independent of browser timezone',()=>{
  const f=fixture();const row={Last_Date_To_Apply:'2026-10-17'};
  assert.equal(f.api.classify(row,new Date('2026-10-17T18:29:59Z')).Status,'Active');
  assert.equal(f.api.classify(row,new Date('2026-10-17T18:30:00Z')).Status,'Inactive');
  assert.equal(f.api.classify({Last_Date_To_Apply:'2026-02-30'}).Status,'Unknown');
});
