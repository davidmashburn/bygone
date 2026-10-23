// Temporary local MCP client: no app/server configuration is installed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { analyze } = require('./symbol-probe');
const manifestPath = process.env.SEMANTIC_MANIFEST || path.join(__dirname,'semantic-corpus/manifest.json');
const rawManifest = fs.readFileSync(manifestPath), manifest = JSON.parse(rawManifest);
const output = process.env.SEMANTIC_REPORT || path.join(__dirname,'results/semantic-eval-2026-10-22.json');
const java = process.argv[2], jar = process.argv[3];
const report = { version:1, manifestSha256:crypto.createHash('sha256').update(rawManifest).digest('hex'),
  engineRevision:'e7b8db328e7d678bc474ebf4b61739b6d6c85b7f',
  machine:{cpu:'Apple M1',memoryBytes:17179869184,arch:process.arch,node:process.version},
  limits:{requestTimeoutMs:30000,maxFiles:50,maxBytesPerFile:1048576,maxRefactorings:1000,jvmMaxHeapMiB:2048},
  javaVersion:'Temurin 21.0.13+9-LTS; macOS aarch64; checksum-verified temporary JDK',
  jarSha256:crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),
  rounds:[],protocol:[],stderr:'' };
const save = ()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
let child, seq=0;
const pending = new Map();
function start() {
  if (!java || !jar) throw new Error('Usage: node run-semantic-eval.js <java executable> <RM-fat.jar>');
  child = spawn('/usr/bin/time',['-l',java,'-Xmx2g','-jar',jar,'mcp'],{stdio:['pipe','pipe','pipe'],detached:true});
  child.stderr.on('data',buf=>{report.stderr+=buf;});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    let msg;try{msg=JSON.parse(line);}catch{report.protocol.push({nonJson:line});return;}
    const waiting=pending.get(msg.id);
    if(waiting){clearTimeout(waiting.timer);pending.delete(msg.id);msg.error?waiting.reject(new Error(JSON.stringify(msg.error))):waiting.resolve(msg.result);}
    else report.protocol.push(msg);
  });
  child.on('exit',(code,signal)=>{
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(`engine exit ${code}/${signal}`));}
    pending.clear();
  });
}
function request(method,params) {
  const id=++seq;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('request-timeout'));stop();},30000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
}
function stop(){if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{ /* already exited */ }}}
function supplied(c) {
  if(!c.excludeUnchanged)return {before:c.before,after:c.after};
  const paths=new Set([...Object.keys(c.before),...Object.keys(c.after)]);
  const keep=[...paths].filter(p=>c.before[p]!==c.after[p]);
  return {before:Object.fromEntries(keep.filter(p=>p in c.before).map(p=>[p,c.before[p]])),after:Object.fromEntries(keep.filter(p=>p in c.after).map(p=>[p,c.after[p]]))};
}
function parseTool(result) {
  if(result.structuredContent)return result.structuredContent;
  const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  try{return JSON.parse(text);}catch{return {status:'unparsed-tool-output',text};}
}
(async()=>{
  start();
  try {
    const started=performance.now();
    report.initialize=await request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'bygone-semantic-research',version:'0.1'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    report.tools=await request('tools/list',{});
    report.startupMs=performance.now()-started;save();
    // Fixed manifest order; second pass measures warm repetitions without tuning.
    for (let round=0;round<Number(process.env.SEMANTIC_ROUNDS || 2);round++) {
      const results=[];report.rounds.push({round,results});
      for (const c of manifest.cases) {
        const input=supplied(c),begin=performance.now();
        const baseline=analyze(input.before,input.after),baselineMs=performance.now()-begin;
        let response,parsed,error;const engineBegin=performance.now();
        try{
          response=await request('tools/call',{name:'refactoringminer_analyze',arguments:{source:{type:'fileContents',beforeFiles:input.before,afterFiles:input.after,maxFiles:50,maxBytesPerFile:1048576},maxRefactorings:1000}});
          parsed=parseTool(response);
        }catch(e){error=e.message;}
        results.push({id:c.id,split:c.split,inputPaths:{before:Object.keys(input.before),after:Object.keys(input.after)},baseline,baselineMs,engineMs:performance.now()-engineBegin,response,parsed,error});save();
        if(error)throw new Error(`${c.id}: ${error}`);
      }
    }
  }catch(e){report.failure=e.message;process.exitCode=1;}
  finally{
    child.stdin.end();
    // Upstream waits on a latch after EOF. Signal only its JVM, allowing
    // /usr/bin/time to reap it and write resource statistics.
    try {
      const pids=execFileSync('pgrep',['-P',String(child.pid)],{encoding:'utf8'}).trim().split(/\s+/).filter(Boolean);
      for(const pid of pids)process.kill(Number(pid),'SIGTERM');
    }catch { /* fallback handles already-exited JVMs */ }
    const guard=setTimeout(stop,3000);guard.unref();
    child.on('close',()=>{clearTimeout(guard);save();});save();
  }
})().catch(e=>{stop();report.failure=e.message;save();process.exitCode=1;});
