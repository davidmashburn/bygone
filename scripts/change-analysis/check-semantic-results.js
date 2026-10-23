const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const load=file=>JSON.parse(fs.readFileSync(path.join(__dirname,file)));
const manifest=load('semantic-corpus/manifest.json'),raw=load('results/semantic-eval-2026-10-22.json'),norm=load('results/semantic-normalized-2026-10-22.json');
const digest=createHash('sha256').update(fs.readFileSync(path.join(__dirname,'semantic-corpus/manifest.json'))).digest('hex');
assert.equal(raw.manifestSha256,digest);assert.equal(norm.manifestSha256,digest);
assert.equal(raw.rounds.length,2);
let endpoints=0,localComparisons=0;
for(let i=0;i<30;i++){
 const a=raw.rounds[0].results[i],b=raw.rounds[1].results[i];
 assert.equal(a.id,b.id);assert.deepEqual(a.parsed,b.parsed);
 assert.equal(a.parsed.status,'ok');assert.equal(a.parsed.refactoringCount,a.parsed.refactorings.length);
 const c=manifest.cases.find(c=>c.id===a.id),n=norm.cases.find(n=>n.id===a.id);
 for(const g of n.groups){
  assert.equal(g.behavior,'unassessed');assert.equal(g.unresolved.length,0);
  for(const side of ['before','after'])for(const e of g.endpoints[side]){
   const text=c[side][e.path];assert.equal(text.slice(e.start,e.end),e.text);
   assert.equal(createHash('sha256').update(e.text).digest('hex'),e.textDigest);
   assert.equal(e.native.startLine,e.startLine);assert.equal(e.native.endLine,e.endLine);endpoints++;
  }
  for(const comparison of g.comparisons){
   const a=g.endpoints.before[0],b=g.endpoints.after[0];
   assert.equal(comparison.changes.filter(c=>!c.added).map(c=>c.value).join(''),a.text);
   assert.equal(comparison.changes.filter(c=>!c.removed).map(c=>c.value).join(''),b.text);
   localComparisons++;
  }
 }
}
assert.equal(norm.cases.find(c=>c.id==='control-10').status,'partial');
assert.deepEqual(norm.score.totals,{expected:14,engineFound:11,baselineFound:6,unionFound:12,engineExtraGroups:0});
console.log(`Two runs agree for all 30 cases; ${endpoints} normalized declaration endpoints resolve; ${localComparisons} local diffs reconstruct both source slices`);
const held=norm.score.cases.filter(c=>c.split==='held-out');
console.log('Held-out expected/engine/baseline:',held.reduce((n,c)=>n+c.expected,0),held.reduce((n,c)=>n+c.engineFound,0),held.reduce((n,c)=>n+c.baselineFound,0));
const peak=/\s(\d+)\s+maximum resident set size/.exec(raw.stderr);assert(peak);console.log('Peak resident bytes:',peak[1]);
