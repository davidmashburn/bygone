// Research adapter: use engine labels as hypotheses, independently recover
// complete declaration ranges. Missing columns are never treated as offsets.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const Diff=require('diff');
const {createHash}=require('node:crypto');
const dir=__dirname;
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'semantic-corpus/manifest.json')));
const run=JSON.parse(fs.readFileSync(path.join(dir,'results/semantic-eval-2026-10-22.json')));
function declarations(files){
 const entries=[],errors=[];
 for(const [file,text] of Object.entries(files)){
  const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  if(sf.parseDiagnostics.length){errors.push({file,parseErrors:sf.parseDiagnostics.length});continue;}
  function add(node,name,kind){
   const start=node.getStart(sf),end=node.end;
   entries.push({path:file,name,kind,start,end,startLine:sf.getLineAndCharacterOfPosition(start).line+1,
    endLine:sf.getLineAndCharacterOfPosition(end-1).line+1,
    textDigest:createHash('sha256').update(text.slice(start,end)).digest('hex'),text:text.slice(start,end)});
  }
  for(const node of sf.statements){
   if(ts.isFunctionDeclaration(node)&&node.body)add(node,node.name?.text||'default','function');
   else if(ts.isClassDeclaration(node))add(node,node.name?.text||'default','class');
   else if(ts.isVariableStatement(node))for(const decl of node.declarationList.declarations){
    if(ts.isIdentifier(decl.name)&&decl.initializer&&(ts.isArrowFunction(decl.initializer)||ts.isFunctionExpression(decl.initializer)))add(decl,decl.name.text,'function');
   }
  }
 }
 return {entries,errors};
}
const operationType=t=>/^(Move Method|Move And Rename Method|Move And Inline Method|Extract And Move Method|Extract Method|Inline Method|Move Class)$/.test(t);
const normalized={manifestSha256:run.manifestSha256,engineRevision:run.engineRevision,coordinateContract:'zero-based UTF-16 half-open offsets independently recovered from pinned source; native hints retained',cases:[]};
for(const c of manifest.cases){
 const r=run.rounds[0].results.find(r=>r.id===c.id);if(!r)continue;
 const before=Object.fromEntries(Object.entries(c.before).filter(([p])=>r.inputPaths.before.includes(p)));
 const after=Object.fromEntries(Object.entries(c.after).filter(([p])=>r.inputPaths.after.includes(p)));
 const inventories={before:declarations(before),after:declarations(after)};
 const groups=[];
 for(const ref of r.parsed?.refactorings||[]){
  if(!operationType(ref.type))continue;
  const endpoints={},unresolved=[];
  for(const [side,field]of[['before','leftSideLocations'],['after','rightSideLocations']]){
   endpoints[side]=[];
   for(const native of ref[field]){
    if(!['METHOD_DECLARATION','TYPE_DECLARATION'].includes(native.codeElementType))continue;
    const kind=native.codeElementType==='TYPE_DECLARATION'?'class':'function';
    const matches=inventories[side].entries.filter(e=>e.path===native.filePath&&e.kind===kind&&e.startLine===native.startLine&&e.endLine===native.endLine);
    if(matches.length!==1){unresolved.push({side,native,reason:'no unique declaration at engine line span'});continue;}
    endpoints[side].push({...matches[0],native});
   }
  }
  const comparisons=[];
  // A single source/destination group can expose the complete local diff.
  // Inline/extract groups retain multiple declarations instead of flattening.
  if(endpoints.before.length===1&&endpoints.after.length===1){
   const a=endpoints.before[0],b=endpoints.after[0];
   comparisons.push({source:{path:a.path,name:a.name},destination:{path:b.path,name:b.name},
    rawEqual:a.text===b.text,changes:Diff.diffLines(a.text,b.text)});
  }
  groups.push({type:ref.type,description:ref.description,endpoints,unresolved,comparisons,behavior:'unassessed'});
 }
 normalized.cases.push({id:c.id,status:inventories.before.errors.length||inventories.after.errors.length?'partial':'complete',
  engineStatus:r.parsed?.status,parseErrors:[...inventories.before.errors,...inventories.after.errors],groups});
}
const score={cases:[],totals:{expected:0,engineFound:0,baselineFound:0,unionFound:0,engineExtraGroups:0}};
for(const c of manifest.cases){
 const n=normalized.cases.find(n=>n.id===c.id),r=run.rounds[0].results.find(r=>r.id===c.id);
 const wanted=c.expectedPairs.filter(p=>p.operation!=='continuation');
 const supported=(g,p)=>g.endpoints.before.some(e=>e.path===p.sourcePath&&e.name===p.sourceName)&&g.endpoints.after.some(e=>e.path===p.destinationPath&&e.name===p.destinationName);
 const exact=p=>r.baseline.matches.some(m=>m.source.path===p.sourcePath&&m.source.name===p.sourceName&&m.destination.path===p.destinationPath&&m.destination.name===p.destinationName);
 const engine=p=>n.groups.some(g=>supported(g,p));
 const found=wanted.filter(engine),extras=n.groups.filter(g=>!wanted.some(p=>supported(g,p)));
 const row={id:c.id,split:c.split,expected:wanted.length,engineFound:found.length,baselineFound:wanted.filter(exact).length,
  unionFound:wanted.filter(p=>engine(p)||exact(p)).length,engineExtraGroups:extras.length,
  missed:wanted.filter(p=>!engine(p)),extras,normalizationUnresolved:n.groups.flatMap(g=>g.unresolved).length};
 score.cases.push(row);
 for(const k of Object.keys(score.totals))score.totals[k]+=row[k];
}
normalized.score=score;
fs.writeFileSync(path.join(dir,'results/semantic-normalized-2026-10-22.json'),JSON.stringify(normalized,null,2)+'\n');
console.log(JSON.stringify(score.totals));
console.log('Unresolved normalized declaration hints:',score.cases.reduce((n,c)=>n+c.normalizationUnresolved,0));
console.log('Raw engine says ok but independent parser says partial:',normalized.cases.filter(c=>c.status==='partial'&&c.engineStatus==='ok').map(c=>c.id));
