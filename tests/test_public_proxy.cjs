const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('public function gate rejects missing, short and forged tokens',async()=>{
  const code = fs.readFileSync('supabase/functions/_shared/public-proxy.js','utf8');
  const {verifyProxyToken} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const expected = 'a'.repeat(64);
  assert.equal(await verifyProxyToken(expected,expected),true);
  assert.equal(await verifyProxyToken('b'.repeat(64),expected),false);
  assert.equal(await verifyProxyToken(null,expected),false);
  assert.equal(await verifyProxyToken('short',expected),false);
  assert.equal(await verifyProxyToken(expected,''),false);
});
