// Exercise the real Edge Function with isolated provider/database mocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/semantic-search/index.ts', 'utf8')
  .replace(/^import .*;\r?\n/gm, '');

async function run({ready = true, openaiFailure = false, openaiRpcFailure = false, geminiDisabled = false, hasKey = true} = {}) {
  const calls = [];
  let handler;
  const vector = Array(768).fill(0.1);
  const state = [
    {key:'openai_embedding_model', value:ready ? 'text-embedding-3-small' : ''},
    {key:'embed_task_type', value:'RETRIEVAL_DOCUMENT'},
    {key:'disabled_until', value:geminiDisabled ? '2999-01-01T00:00:00Z' : ''},
  ];
  const admin = {
    from(table) {
      if (table === 'semantic_search_state') return {
        select: () => ({ in: async () => ({data:state, error:null}) }),
        update: () => ({ eq: async () => ({error:null}) }),
      };
      return {select: () => ({in: async () => ({data:[{vacancy_id:'V1', post_name:'Director'}], error:null})})};
    },
    rpc: async (name) => {
      calls.push(name);
      return name === 'search_vacancies_openai' && openaiRpcFailure
        ? {error:new Error('index unavailable')} : {data:[{vacancy_id:'V1', distance:0.2}], error:null};
    },
  };
  const fetchMock = async (url) => {
    const openai = String(url).includes('api.openai.com');
    calls.push(openai ? 'openai' : 'gemini');
    if (openai && openaiFailure) return new Response('', {status:429});
    return new Response(JSON.stringify(openai ? {data:[{embedding:vector}]} : {embedding:{values:vector}}));
  };
  const env = {SUPABASE_URL:'https://example.test', SUPABASE_SERVICE_ROLE_KEY:'service', GEMINI_API_KEY:'gemini', OPENAI_API_KEY:hasKey ? 'openai' : '', PUBLIC_PROXY_SECRET:'a'.repeat(32)};
  const deno = {env:{get:key=>env[key]}, serve:fn=>{handler=fn;}};
  const js = stripTypeScriptTypes(source, {mode:'transform'});
  new Function('Deno','createClient','verifyProxyToken','fetch', js)(deno, () => admin, async () => true, fetchMock);
  const response = await handler(new Request('https://example.test', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({query:'finance in Delhi'})}));
  return {calls, status:response.status, body:await response.json()};
}

(async () => {
  let r = await run({geminiDisabled:true});
  assert.equal(r.status, 200); assert.deepEqual(r.calls, ['openai','search_vacancies_openai']);
  assert.equal(r.body.results[0].vacancy_id, 'V1');
  r = await run({openaiFailure:true});
  assert.equal(r.status, 200); assert.deepEqual(r.calls, ['openai','gemini','search_vacancies']);
  r = await run({openaiRpcFailure:true});
  assert.equal(r.status, 200); assert.deepEqual(r.calls, ['openai','search_vacancies_openai','gemini','search_vacancies']);
  r = await run({ready:false});
  assert.equal(r.status, 200); assert.deepEqual(r.calls, ['gemini','search_vacancies']);
  r = await run({hasKey:false});
  assert.equal(r.status, 200); assert.deepEqual(r.calls, ['gemini','search_vacancies']);
  r = await run({openaiFailure:true, geminiDisabled:true});
  assert.equal(r.status, 503); assert.deepEqual(r.calls, ['openai']);
  console.log('OpenAI primary, Gemini fallback, and independent disable guard verified.');
})().catch(error => {console.error(error); process.exit(1);});
