const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function helpers() {
  const context={window:{},console,Date,Intl,Map,Set};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('enrich.js','utf8'),context);
  vm.runInContext(fs.readFileSync('shared/vacancy-utils.js','utf8'),context);
  const app=fs.readFileSync('app.js','utf8');
  vm.runInContext(app.slice(app.indexOf('    function formatEligibility(item) {'),app.indexOf('    function formatDaysLeft(daysLeft) {')),context);
  return {E:context.window.DepEnrich,U:context.window.DepUtils,modal:context.formatEligibility,sort:context.getEligibilitySortValue};
}

test('Internal Audit Officer summary and level-10 filter use all three saved tiers',()=>{
  const {E,U,modal,sort}=helpers();
  const raw={level:'12',req_level1:'12',req_level2:'11',min_years_experience:'0',min_years_experience2:'3',eligibility_tiers:[{level:'12',min_years:'0'},{level:'11',min_years:'3'},{level:'10',min_years:'5'}]};
  const row=E.enrichRecord(raw);
  const before=JSON.stringify(row);
  const expected='Level 12 (0 years) OR Level 11 (3 years) OR Level 10 (5 years)';
  assert.equal(modal(row),expected);assert.equal(U.formatEligibility(row),expected);
  assert.equal(E.formatEligibilitySummary(raw),expected);assert.equal(sort(row),10);
  assert.equal(E.formatEligibilityCompact(row),'L12 / L11(3Y) / L10(5Y)');
  assert(E.isEligible(row,'10','5'));assert(!E.isEligible(row,'10','4'));
  assert(E.isEligible(row,'11','3'));assert(E.isEligible(row,'12','0'));
  assert.equal(JSON.stringify(row),before,'Rendering must not change saved eligibility or filtering.');
});

test('four tiers, skipped levels and 13A are explicit alternatives, never a range',()=>{
  const {E,modal}=helpers();
  const row={Req_Level1:'14',Req_Level2:'13A',eligibility_tiers:[{level:14,min_years:0},{level:13.5,label:'13A',min_years:1},{level:12,min_years:3},{level:10,min_years:5}]};
  assert.equal(modal(row),'Level 14 (0 years) OR Level 13A (1 year) OR Level 12 (3 years) OR Level 10 (5 years)');
  assert.equal(E.formatEligibilityCompact(row),'L14 / L13A(1Y) / L12(3Y) / L10(5Y)');
  assert(!E.isEligible(row,'11','10'));assert(E.isEligible(row,'13A','1'));
  assert(!modal(row).includes('13.5'));
});

test('JSON-string tiers take precedence over legacy pairs and stale cached summary text',()=>{
  const {E}=helpers();
  const row={Req_Level1:'12',Req_Level2:'11',eligibility_tiers_text:'L12 · L11 (3y)',eligibility_tiers:JSON.stringify([{level:'10',min_years:'5'},{level:'11',min_years:'3'},{level:'12',min_years:'0'}])};
  assert.equal(E.formatEligibilitySummary(row),'Level 12 (0 years) OR Level 11 (3 years) OR Level 10 (5 years)');
});

test('legacy rows still render and absent service years are not invented as zero',()=>{
  const {E}=helpers();
  assert.equal(E.formatEligibilitySummary({Req_Level1:'11',Req_Level2:'9',Min_Years_Experience:'0',Min_Years_Experience2:'5'}),'Level 11 (0 years) OR Level 9 (5 years)');
  assert.equal(E.formatEligibilitySummary({Req_Level1:'11',Req_Level2:'9'}),'Level 11 OR Level 9');
  assert.equal(E.formatEligibilitySummary({eligibility_tiers:[{level:'13A',min_years:''}]}),'Level 13A');
  assert.equal(E.formatEligibilitySummary({eligibility_tiers:[{level:'unknown',min_years:'0'}],Req_Level1:'10'}),'Level 10');
  assert.equal(E.formatEligibilitySummary({}),'Not specified');
});

test('home page finance example is compact, complete and highest level first',()=>{
  const {E}=helpers();
  const row={eligibility_tiers:[{level:'7',min_years:'5'},{level:'10',min_years:'0'},{level:'8',min_years:'4'}]};
  assert.equal(E.formatEligibilityCompact(row),'L10 / L8(4Y) / L7(5Y)');
  assert.equal(E.formatEligibilitySummary(row),'Level 10 (0 years) OR Level 8 (4 years) OR Level 7 (5 years)');
});
