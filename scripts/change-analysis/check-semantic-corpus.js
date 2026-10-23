const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { analyze, inventory } = require('./symbol-probe');
const { createHash } = require('node:crypto');
const raw=fs.readFileSync(path.join(__dirname,'semantic-corpus/manifest.json'));
const manifest=JSON.parse(raw), summary={manifestSha256:createHash('sha256').update(raw).digest('hex'),cases:[],behaviorCounterexample:{}};
assert.equal(manifest.cases.length,30);
assert.equal(manifest.cases.filter(c=>c.split==='held-out').length,10);
function supplied(c){
 const keep=p=>!c.excludeUnchanged||c.before[p]!==c.after[p];
 return {before:Object.fromEntries(Object.entries(c.before).filter(([p])=>keep(p))),after:Object.fromEntries(Object.entries(c.after).filter(([p])=>keep(p)))};
}
for(const c of manifest.cases){
 const input=supplied(c), result=analyze(input.before,input.after);
 const expected=c.expectedPairs.filter(p=>p.operation!=='continuation');
 const predicted=result.matches.filter(m=>m.pathChanged||m.nameChanged);
 const same=(m,p)=>m.source.path===p.sourcePath&&m.source.name===p.sourceName&&m.destination.path===p.destinationPath&&m.destination.name===p.destinationName;
 const found=expected.filter(p=>predicted.some(m=>same(m,p)));
 const extras=predicted.filter(m=>!expected.some(p=>same(m,p)));
 const r={id:c.id,split:c.split,expected:expected.length,found:found.length,extra:extras.length,status:result.status,
   missed:expected.filter(p=>!found.includes(p)),extraLinks:extras};
 if(c.expectedInventory){
  r.inventory={};
  for(const side of ['before','after']){
   const actual=inventory(input[side]).entries, want=c.expectedInventory[side];
   assert.equal(actual.length,want.length,`${c.id}/${side} inventory cardinality`);
   for(const e of want) assert(actual.some(a=>a.path===e.path&&a.name===e.name&&a.kind===e.kind),`${c.id}/${side}/${e.name}`);
   r.inventory[side]={expected:want.length,found:actual.length};
  }
 }
 for(const m of result.matches){
  for(const [side,e] of [['before',m.source],['after',m.destination]]){
   const text=input[side][e.path],slice=text.slice(e.start,e.end);
   assert.equal(createHash('sha256').update(JSON.stringify(slice)).digest('hex'),e.raw);
  }
  assert.equal(m.behavior,'unassessed');
 }
 summary.cases.push(r);
}
const c=manifest.cases.find(c=>c.id==='mixed-05');
const run=text=>vm.runInNewContext(text.replace(/export /g,'')+';localPrice(10)',{}, {timeout:1000});
summary.behaviorCounterexample={caseId:c.id,before:run(c.before['src/cart.js']),after:run(c.after['src/billing.js'])};
assert.equal(summary.behaviorCounterexample.before,10);assert.equal(summary.behaviorCounterexample.after,20);
fs.writeFileSync(path.join(__dirname,'results/semantic-baseline-score-2026-10-22.json'),JSON.stringify(summary,null,2)+'\n');
console.log('30 cases checked; 10 held out; all annotated historical function inventories and raw range digests agree');
console.log('Changed binding counterexample executed: 10 -> 20');
console.log('Expected/predicted cross-file pairs:',summary.cases.reduce((n,c)=>n+c.expected,0), summary.cases.reduce((n,c)=>n+c.found,0),'extra',summary.cases.reduce((n,c)=>n+c.extra,0));
