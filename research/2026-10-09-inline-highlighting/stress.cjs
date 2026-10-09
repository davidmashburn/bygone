const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
if(process.argv[2]==='worker'){
  const {candidates}=require('./candidates.cjs');const n=+process.argv[4],shape=process.argv[5],fn=candidates[process.argv[3]];
  const a=shape==='camel'?'aA'.repeat(n/2):shape==='unrelated'?'a'.repeat(n):'x'.repeat(n/2)+'a'+'y'.repeat(n/2);
  const b=shape==='camel'?'bB'.repeat(n/2):shape==='unrelated'?'b'.repeat(n):'x'.repeat(n/2)+'b'+'y'.repeat(n/2);
  const t=performance.now();const result=fn(a,b);
  console.log(JSON.stringify({ms:performance.now()-t,segments:result.length}));
}else{
  const results=[];
  for(const n of [500,2000,9990])for(const shape of ['unrelated','local-edit','camel'])for(const name of ['words','characters','affixes','smart','anchored','bounded','subwords']){
    const r=spawnSync(process.execPath,[__filename,'worker',name,String(n),shape],{encoding:'utf8',timeout:2500});
    results.push({name,length:n,shape,...(r.status===0?JSON.parse(r.stdout):{timeout:!!r.error,error:r.error?.code,status:r.status})});
  }
  fs.writeFileSync(__dirname+'/stress.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}
