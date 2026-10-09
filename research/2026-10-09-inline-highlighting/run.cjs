const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');
const crypto = require('node:crypto');
const root = '/Users/davmash/code/bygone';
const work = __dirname;
const esbuild = require(root+'/node_modules/esbuild');
const Diff = require(root+'/node_modules/diff');
const {candidates,graphemes,refine,smart} = require('./candidates.cjs');
const fixtures = require('./fixtures.cjs');
const source = fs.readFileSync(root+'/src/diffEngine.ts','utf8');
const manifest = {date:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'), node:process.version, diffVersion:require(root+'/node_modules/diff/package.json').version};
fs.writeFileSync(work+'/source-snapshot.ts',source);
function buildEngine(name) {
  const dir = path.join(work,name);
  for(const sub of ['out','test','media']) fs.mkdirSync(path.join(dir,sub),{recursive:true});
  let input = source;
  if(name!=='baseline') input = `import {candidates} from '${work}/candidates.cjs';\n` + source.replace('const changes = Diff.diffWordsWithSpace(leftContent, rightContent);',`const changes = candidates.${name}(leftContent, rightContent);`);
  input += '\nexport {buildInlineSegments,buildWhitespaceOnlySegments};\n';
  esbuild.buildSync({stdin:{contents:input,resolveDir:root+'/src',loader:'ts',sourcefile:'diffEngine.ts'},bundle:true,platform:'node',target:'node18',format:'cjs',outfile:dir+'/out/diffEngine.js',logLevel:'silent'});
  for(const file of ['test/diffRegression.test.js','test/yamlDiffFixture.js','media/scrollMapping.js']) fs.copyFileSync(root+'/'+file,dir+'/'+file);
  return require(dir+'/out/diffEngine.js');
}
const engines = {baseline:buildEngine('baseline')};
for(const name of Object.keys(candidates).filter(n=>n!=='words')) engines[name] = buildEngine(name);
const regressions = {};
for(const name of Object.keys(engines)) {
  const result=spawnSync(process.execPath,['--test','--test-reporter=tap',work+'/'+name+'/test/diffRegression.test.js'],{encoding:'utf8',timeout:60000});
  fs.writeFileSync(work+'/'+name+'/regression.log',(result.stdout||'')+(result.stderr||''));
  regressions[name]={status:result.status,summary:(result.stdout||'').split('\n').filter(l=>/^# (tests|pass|fail|duration)/.test(l))};
}
function view(changes,side) {
  return changes.filter(c=> side==='left' ? !c.added : !c.removed).map(c=>({text:c.value,changed:!!(c.added||c.removed)}));
}
function renderText(changes,side) {
  const segments = view(changes,side), merged=[];
  for(const s of segments) {const p=merged.at(-1); if(p && p.changed===s.changed)p.text+=s.text; else merged.push({...s});}
  return merged.map(s=>s.changed?'['+s.text+']':s.text).join('');
}
function ranges(changes,side) {
  let n=0; const result=[];
  for(const c of view(changes,side)) {if(c.changed) result.push([n,n+c.text.length]); n+=c.text.length;}
  return result;
}
function boundaries(text) {
  let n=0; const result=new Set([0]); for(const s of graphemes(text))result.add(n+=s.length); return result;
}
let validations=0;
function validate(a,b,result) {
  assert.equal(view(result,'left').map(c=>c.text).join(''),a);
  assert.equal(view(result,'right').map(c=>c.text).join(''),b);
  if(a===b) assert.ok(!result.some(c=>c.added||c.removed));
  if(a!==b) assert.ok(result.some(c=>c.added||c.removed));
  validations++;
}
function inspect(c) {
  const results={};
  for(const [name,fn] of Object.entries(candidates)) {
    const changes=fn(c.left,c.right); validate(c.left,c.right,changes);
    const rendered=['left','right'].map(side=>renderText(changes,side));
    const splitGraphemes=['left','right'].flatMap(side=>{
      const safe=boundaries(c[side]); return ranges(changes,side).filter(([s,e])=>!safe.has(s)||!safe.has(e)).map(range=>({side,range}));
    });
    const changedChars=changes.filter(v=>v.added||v.removed).reduce((n,v)=>n+graphemes(v.value).length,0);
    const islands=changes.filter((v,i)=> i>0 && i<changes.length-1 && !v.added&&!v.removed && /^[\p{L}\p{N}]{1,2}$/u.test(v.value)).length;
    const reverse=fn(c.right,c.left);
    const symmetric = renderText(reverse,'left')===rendered[1] && renderText(reverse,'right')===rendered[0];
    results[name]={rendered,changes,splitGraphemes,changedChars,islands,symmetric,expectedMatch:c.expected?JSON.stringify(c.expected)===JSON.stringify(rendered):null};
  }
  return {...c,results};
}
// Sample actual corresponding changed lines from the last 40 source commits.
// Existing line alignment selects the pairs; it is held constant across variants.
const patch = execFileSync('git',['log',manifest.commit,'-40','-p','--format=COMMIT %H','--no-ext-diff','--no-renames','-U0','--','src','media/*.js','cli','README.md','docs'],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
fs.writeFileSync(work+'/corpus.patch',patch);
const corpus=[],seen=new Set(); let left=[],right=[],commit='',file='',hunks=0;
function flush() {
  if(left.length&&right.length && left.length<=20&&right.length<=20) {
    hunks++;
    const rows=engines.baseline.alignReplacementLines(left,right);
    for(const row of rows) {
      if(!row.left||!row.right||row.left===row.right||Math.max(row.left.length,row.right.length)>500||/[\r\n]/.test(row.left+row.right))continue;
      const key=JSON.stringify([row.left,row.right]); if(seen.has(key))continue;seen.add(key);
      corpus.push({id:'history-'+corpus.length,category:'repository',left:row.left,right:row.right,why:'Actual changed line pair',commit,file});
    }
  }
  left=[];right=[];
}
for(const line of patch.split('\n')) {
  if(line.startsWith('COMMIT ')){flush();commit=line.slice(7);}
  else if(line.startsWith('diff --git ')){flush();file=line.split(' b/')[1];}
  else if(line.startsWith('@@'))flush();
  else if(line.startsWith('-')&&!line.startsWith('---'))left.push(line.slice(1));
  else if(line.startsWith('+')&&!line.startsWith('+++'))right.push(line.slice(1));
  else if(!line.startsWith('\\'))flush();
}
flush();
fs.writeFileSync(work+'/corpus.json',JSON.stringify(corpus,null,2));
const fixtureResults=fixtures.map(inspect),corpusResults=corpus.map(inspect);
// Deterministic mutation fuzz; compare masks and invariants, not invented intent.
let seed=0x5eed1234;
function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const alphabet=['a','b','c','d','E','F','0','1','_',' ',';','.','é','e\u0301','👩‍💻','中'];
let fuzzRuns=0;const fuzzBoundaryCounts=Object.fromEntries(Object.keys(candidates).map(n=>[n,0]));
const fuzzExamples=[];
for(let i=0;i<1500;i++) {
  const a=Array.from({length:5+Math.floor(rand()*40)},()=>alphabet[Math.floor(rand()*alphabet.length)]),b=[...a];
  for(let j=0;j<1+Math.floor(rand()*4);j++)b.splice(Math.floor(rand()*(b.length+1)),rand()<.65?1:0,alphabet[Math.floor(rand()*alphabet.length)]);
  const x=a.join(''),y=b.join('');
  for(const [name,fn]of Object.entries(candidates)) {
    const diff=fn(x,y);validate(x,y,diff);fuzzRuns++;
    let split=false;
    for(const [side,s]of [['left',x],['right',y]]) {const safe=boundaries(s);if(ranges(diff,side).some(([s,e])=>!safe.has(s)||!safe.has(e)))split=true;}
    if(split){fuzzBoundaryCounts[name]++;if(fuzzExamples.length<8)fuzzExamples.push({name,x,y});}
  }
}
function aggregate(rows) {
  return Object.fromEntries(Object.keys(candidates).map(name=>[name,{
    cases:rows.length,expectedCases:rows.filter(r=>r.expected).length,
    expectedMatches:rows.filter(r=>r.results[name].expectedMatch).length,
    changedChars:rows.reduce((n,r)=>n+r.results[name].changedChars,0),
    tinyInternalIslands:rows.reduce((n,r)=>n+r.results[name].islands,0),
    asymmetricCases:rows.filter(r=>!r.results[name].symmetric).length,
    graphemeSplitCases:rows.filter(r=>r.results[name].splitGraphemes.length).map(r=>r.id)
  }]));
}
const timing={};
const perfCases=[...fixtures.filter(c=>Math.max(c.left.length,c.right.length)<=500),...corpus];
for(const [name,fn]of Object.entries(candidates)) {
  for(const c of perfCases.slice(0,30))fn(c.left,c.right);
  const times=[];for(let round=0;round<5;round++)for(const c of perfCases){const t=performance.now();fn(c.left,c.right);times.push(performance.now()-t);}
  times.sort((a,b)=>a-b);
  timing[name]={calls:times.length,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1)};
}
const sensitivity=[];
for(const island of [2,3,4])for(const retained of [.35,.5,.65]) {
  let differing=0;
  for(const c of [...fixtures,...corpus]) {
    const result=refine(c.left,c.right,(a,b)=>smart(a,b,island,retained));
    const base=candidates.smart(c.left,c.right);
    if(['left','right'].some(s=>renderText(result,s)!==renderText(base,s)))differing++;
  }
  sensitivity.push({minIsland:island,minRetained:retained,changedCasesFromDefault:differing});
}
// Make sure an inline-only prototype leaves blocks, alignment and scroll inputs unchanged.
const integration={};
for(const [name,engine]of Object.entries(engines).filter(([n])=>n!=='baseline')) {
  let checked=0;
  for(const c of [...fixtures,...corpus.slice(0,150)]) {
    const args=[`anchor before\n${c.left}\nanchor after`,`anchor before\n${c.right}\nanchor after`,{timeoutMs:3000}];
    const before=engines.baseline.buildTwoWayDiffModel(...args),after=engine.buildTwoWayDiffModel(...args);
    for(const field of ['rows','blocks','reflows','quality'])assert.deepEqual(after[field],before[field]);
    for(const side of ['leftLines','rightLines'])for(const line of after[side])if(line.segments)assert.equal(line.segments.map(s=>s.text).join(''),line.content);
    checked++;
  }
  integration[name]={checked,passed:true};
}
const summary={manifest,fixtureCount:fixtures.length,corpusCount:corpus.length,qualifyingHunks:hunks,regressions,validations,fuzzRuns,fuzzBoundaryCounts,fuzzExamples,fixtures:aggregate(fixtureResults),corpus:aggregate(corpusResults),timing,sensitivity,integration};
fs.writeFileSync(work+'/results.json',JSON.stringify({summary,fixtures:fixtureResults,corpus:corpusResults},null,2));
fs.writeFileSync(work+'/summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
