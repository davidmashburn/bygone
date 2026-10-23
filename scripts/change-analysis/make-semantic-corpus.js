// Fixed research cases. Expected links are authored here, never derived from a matcher.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const base = '9d56b1121d33d0e3ab6b3ec42f51e93e183247ce';
const cases = [];
const anchorA = '\nexport function originMarker() { return "origin-only"; }\n';
const anchorB = '\nexport function destinationMarker() { return 991; }\n';
const bill = 'export function invoiceTotal(rows) {\n  let total = 0;\n  for (const row of rows) total += row.price * row.quantity;\n  return total;\n}\n';
const moved = (oldText, newText = oldText, extraBefore = '', extraAfter = '') => ({
  before: { 'src/cart.js': extraBefore + oldText + anchorA, 'src/billing.js': anchorB },
  after: { 'src/cart.js': anchorA, 'src/billing.js': extraAfter + newText + anchorB }
});
const pair = (sourcePath, sourceName, destinationPath, destinationName, operation = 'move', edited = false) =>
  ({ sourcePath, sourceName, destinationPath, destinationName, operation, edited });
const billPair = (name = 'invoiceTotal', operation = 'move', edited = false) => pair('src/cart.js', 'invoiceTotal', 'src/billing.js', name, operation, edited);
function add(id, group, input, expectedPairs = [], obligations = [], notes = '') {
  const split = (group === 'history' && Number(id.slice(-2)) > 5) || (group === 'mixed' && Number(id.slice(-2)) > 5) ? 'held-out' : 'development';
  cases.push({ id, group, split, ...input, expectedPairs, obligations, notes, ...(id === 'mixed-10' ? { excludeUnchanged: true } : {}) });
}
add('control-01','control',moved(bill),[billPair()]);
add('control-02','control',moved(bill,bill.replace('invoiceTotal','subtotal')),[billPair('subtotal','move-and-rename')]);
add('control-03','control',moved(bill,bill.replace('let total = 0','let total = 5')),[billPair('invoiceTotal','move',true)],['literal edit visible']);
add('control-04','control',{ before: {'src/cart.js':bill+anchorA},after:{'src/cart.js':bill+anchorA,'src/billing.js':bill+anchorB}},[],['retained source; no automatic move'], 'Equivalent new occurrence is not proof of copy history.');
add('control-05','control',{before:{'src/a.js':bill,'src/b.js':bill},after:{'src/c.js':bill}},[],['ambiguous origins; no automatic move']);
add('control-06','control',{before:{'src/cart.js':bill+anchorA},after:{'src/cart.js':'\n\n// inserted header\n'+bill+anchorA}},[],['line shift is not a move']);
add('control-07','control',moved(bill,'export function invoiceTotal(rows) { return fetch("/invoices"); }\n'),[],['unrelated replacement must not become exact move']);
add('control-08','control',{before:{'old/math.js':bill},after:{'new/math.js':bill}},[pair('old/math.js','invoiceTotal','new/math.js','invoiceTotal','file-relocation')]);
const arrow = 'export const discount = (amount) => amount * 0.8;\n';
add('control-09','control',moved(arrow),[pair('src/cart.js','discount','src/billing.js','discount')]);
add('control-10','control',moved(bill,'export function invoiceTotal( {'),[],['parse failure visible; no automatic move']);
const extractedBefore = 'export function checkout(rows) {\n let result = 0;\n for (const row of rows) result += row.price * row.quantity;\n save(result);\n return result;\n}\n';
const extractedAfter = 'export function checkout(rows) {\n const result = invoiceTotal(rows);\n save(result);\n return result;\n}\n';
add('mixed-01','mixed',{before:{'src/cart.js':extractedBefore+anchorA,'src/billing.js':anchorB},after:{'src/cart.js':extractedAfter+anchorA,'src/billing.js':bill+anchorB}},[pair('src/cart.js','checkout','src/billing.js','invoiceTotal','extract')],['container continuation and changed call sites retained']);
add('mixed-02','mixed',{before:{'src/cart.js':extractedAfter+anchorA,'src/billing.js':bill+anchorB},after:{'src/cart.js':extractedBefore+anchorA,'src/billing.js':anchorB}},[pair('src/billing.js','invoiceTotal','src/cart.js','checkout','inline')],['container body edits retained']);
const klass='export class PriceBook {\n constructor(rate) { this.rate = rate; }\n price(value) { return value * this.rate; }\n}\n';
add('mixed-03','mixed',moved(klass,klass.replace('value * this.rate','value * this.rate + 1')),[pair('src/cart.js','PriceBook','src/billing.js','PriceBook','move',true)],['nested method edit visible','baseline class extraction unsupported']);
add('mixed-04','mixed',moved(bill,'// amounts include handling\n'+bill.replace('invoiceTotal','amountDue').replace('let total = 0','let total = 3')),[billPair('amountDue','move-and-rename',true)],['comment and literal edit retained']);
const context='export function localPrice(value) { return value * rate; }\n';
add('mixed-05','mixed',moved(context,context,'const rate = 1;\n','const rate = 2;\n'),[pair('src/cart.js','localPrice','src/billing.js','localPrice')],['different lexical binding; behavior unassessed']);
add('mixed-06','mixed',moved('export function label(value) { return `商品:${value}`; }\n','export function caption(value) { return `品物:${value}`; }\n'),[pair('src/cart.js','label','src/billing.js','caption','move-and-rename',true)],['Unicode literal edit visible']);
add('mixed-07','mixed',moved('export default function (value) { return value / 100; }\n'),[pair('src/cart.js','default','src/billing.js','default')],['anonymous default coverage explicit']);
add('mixed-08','mixed',moved('registerType("Query", { resolve() { return 1; } });\n','registerType("Query", { resolve() { return 2; } });\n'),[pair('src/cart.js','Query','src/billing.js','Query','registration-relocation',true)],['registration extraction explicit; body edit visible']);
const imported='import { rate } from "./rates.js";\n';
add('mixed-09','mixed',moved(context,context,imported,imported.replace('./rates.js','./promotions.js')),[pair('src/cart.js','localPrice','src/billing.js','localPrice')],['changed import resolution; behavior unassessed']);
add('mixed-10','mixed',{before:{'src/unchanged.js':bill,'src/billing.js':anchorB},after:{'src/unchanged.js':bill,'src/billing.js':bill+anchorB}},[],['scope excludes unchanged origin; no automatic move'], 'Only src/billing.js is supplied to the detector; full pair is retained as scope evidence.');
// Historical selection is chronological, before engine execution, independent
// of detector success: first <=180-line changed src JS/TS file per commit.
const repo=process.argv[2];
if (!repo) throw new Error('Usage: node make-semantic-corpus.js <bygone repo>');
const git=args=>execFileSync('git',args,{cwd:repo,maxBuffer:8*1024*1024}).toString();
const commits=git(['log','--no-merges','--format=%H','-n60',base]).trim().split('\n');
let n=0;
for (const commit of commits) {
  const parent=git(['rev-parse',commit+'^']).trim();
  const paths=git(['diff','--name-only','--no-renames',parent,commit]).trim().split('\n')
    .filter(p=>/^src\/.+\.[jt]s$/.test(p)).sort();
  for (const file of paths) {
    const get=rev=>{const result=execFileSync('git',['ls-tree',rev,'--',file],{cwd:repo}).toString();return result?git(['show',`${rev}:${file}`]):null;};
    const a=get(parent),b=get(commit);
    if (Math.max((a||'').split('\n').length,(b||'').split('\n').length)>180) continue;
    const id='history-'+String(++n).padStart(2,'0');
    add(id,'history',{before:a===null?{}:{[file]:a},after:b===null?{}:{[file]:b},source:{commit,parent,file}},[],['historical inventory requires manual annotation'], 'Single-file historical scope: no cross-file recall claim.');
    break;
  }
  if(n===10)break;
}
if(n!==10)throw new Error(`Only ${n} eligible historical comparisons`);
// Hand annotations from the full historical source files and inspected diffs.
const deepNames = ['required','validateRelativePath','validateFields','validateLocalFileUrl','parseDocumentFocus','parseDeepLink','serializeDeepLink','authoredModeTour','resolveDocumentFocus','serializeDocumentFragment','parseDocumentFragment'];
const hashNames = ['hashChangeTourSource','canonicalize','isRecord'];
const orientNames = ['tourLanding','resolveTourEvidenceContext','resolveTourRangeEvidenceContext','describeTourComparison','describeTourTransition','realLabel'];
const historyNames = {
 'history-01':[[],[]],
 'history-02':[[],['moveComparisonPanel','applyComparisonOrder','movedPanelPairIndex']],
 'history-03':[deepNames,deepNames],
 'history-04':[['captureTourFeedback','buildTourFeedbackRequest'],['captureTourFeedback','buildTourFeedbackRequest']],
 'history-05':[hashNames,[]], 'history-06':[[],hashNames],
 'history-07':[orientNames,[...orientNames,'buildTourRoute','describeSceneRoute','describeStepOrientation']],
 'history-08':[deepNames,deepNames],
 'history-09':[[],['revisionFileTarget','revisionFileNavigation','revisionFileAction','revisionDirectoryView','revisionPanelPairs','revisionPanelsView','revisionRailItems']],
 'history-10':[[],['buildHistoryDirectoryEntries']]
};
const editedHistory = { 'history-03':['resolveDocumentFocus'], 'history-04':['buildTourFeedbackRequest'], 'history-07':['describeTourTransition'], 'history-08':['parseDocumentFocus','resolveDocumentFocus'] };
for (const c of cases.filter(c=>c.group==='history')) {
 const [a,b]=historyNames[c.id];
 c.expectedInventory={before:a.map(name=>({path:c.source.file,name,kind:'function'})),after:b.map(name=>({path:c.source.file,name,kind:'function'}))};
 c.expectedPairs=a.filter(name=>b.includes(name)).map(name=>pair(c.source.file,name,c.source.file,name,'continuation',(editedHistory[c.id]||[]).includes(name)));
 c.obligations=['single-file search scope explicit; no cross-file absence claim',...(editedHistory[c.id]||[]).map(name=>name+' body edit visible')];
 c.annotation='Names and continuations checked against pinned file definitions and diff before engine execution; declarations without bodies excluded from this inventory denominator.';
}
const manifest={version:1,base,policy:{tuned:false,scope:'supplied files',historicalSelection:'first eligible src JS/TS path per nonmerge commit, descending, <=180 lines, last 60 commits'},cases};
const destination=path.join(__dirname,'semantic-corpus','manifest.json');
fs.writeFileSync(destination,JSON.stringify(manifest,null,2)+'\n');
console.log(createHash('sha256').update(fs.readFileSync(destination)).digest('hex'),destination);
for(const c of cases.filter(c=>c.group==='history'))console.log(c.id,c.source.commit.slice(0,10),c.source.file,c.split);
