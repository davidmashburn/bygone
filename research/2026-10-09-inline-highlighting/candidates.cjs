const Diff = require('/Users/davmash/code/bygone/node_modules/diff');
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = text => Array.from(segmenter.segment(text), part => part.segment);
const chars = (a, b) => Diff.diffArrays(graphemes(a), graphemes(b)).map(c => ({ ...c, value: c.value.join('') }));
function compact(changes) {
  const result = [];
  for (const c of changes) {
    if (!c.value) continue;
    const p = result.at(-1);
    if (p && !!p.added === !!c.added && !!p.removed === !!c.removed) p.value += c.value;
    else result.push({value:c.value, ...(c.added ? {added:true} : {}), ...(c.removed ? {removed:true} : {})});
  }
  // Normalize each replacement run: adjacent emphasized pieces on either
  // side must be one segment even if the edit script interleaves operations.
  const normalized=[];
  for(let i=0;i<result.length;){
    if(!result[i].added&&!result[i].removed){normalized.push(result[i++]);continue;}
    let left='',right='';
    while(i<result.length&&(result[i].added||result[i].removed)){
      const c=result[i++];if(c.removed)left+=c.value;else right+=c.value;
    }
    if(left)normalized.push({value:left,removed:true});
    if(right)normalized.push({value:right,added:true});
  }
  return normalized;
}
function affix(a, b) {
  const x = graphemes(a), y = graphemes(b);
  let p = 0, s = 0;
  while (p < Math.min(x.length, y.length) && x[p] === y[p]) p++;
  while (s < Math.min(x.length, y.length) - p && x[x.length - s - 1] === y[y.length - s - 1]) s++;
  return compact([{value:x.slice(0,p).join('')}, {value:x.slice(p,x.length-s).join(''),removed:true},
    {value:y.slice(p,y.length-s).join(''),added:true}, {value:s ? x.slice(-s).join('') : ''}]);
}
function refine(a, b, fn) {
  const words = Diff.diffWordsWithSpace(a, b), result = [];
  for (let i = 0; i < words.length;) {
    if (!words[i].added && !words[i].removed) { result.push(words[i++]); continue; }
    let left = '', right = '';
    while (i < words.length && (words[i].added || words[i].removed)) {
      const c = words[i++];
      if (c.removed) left += c.value;
      if (c.added) right += c.value;
    }
    result.push(...(left && right ? fn(left,right) : [
      {value:left,removed:true}, {value:right,added:true}
    ]));
  }
  return compact(result);
}
function smart(a, b, minIsland = 3, minRetained = .5) {
  let changes = chars(a,b);
  // Discard small internal matching islands; keep edge matches.
  changes = compact(changes.flatMap((c,i) => !c.added && !c.removed && i > 0 && i < changes.length-1
    && graphemes(c.value).length < minIsland
    ? [{value:c.value,removed:true},{value:c.value,added:true}] : [c]));
  const retained = changes.filter(c => !c.added && !c.removed).reduce((n,c) => n+graphemes(c.value).length,0);
  return 2*retained / (graphemes(a).length+graphemes(b).length) >= minRetained
    ? changes : [{value:a,removed:true},{value:b,added:true}];
}
function anchored(a, b, minIsland=3) {
  const x=graphemes(a), y=graphemes(b);
  let p=0,s=0;
  while(p<Math.min(x.length,y.length)&&x[p]===y[p])p++;
  while(s<Math.min(x.length,y.length)-p&&x[x.length-s-1]===y[y.length-s-1])s++;
  const middle=Diff.diffArrays(x.slice(p,x.length-s),y.slice(p,y.length-s)).map(c=>({...c,value:c.value.join('')}));
  return compact([{value:x.slice(0,p).join('')},...middle.flatMap(c=>!c.added&&!c.removed&&graphemes(c.value).length<minIsland
    ? [{value:c.value,removed:true},{value:c.value,added:true}] : [c]),{value:s?x.slice(-s).join(''):''}]);
}
function safeBoundaries(a,b,changes) {
  const cuts=text=>{let n=0;return new Set([0,...graphemes(text).map(g=>n+=g.length)])};
  const leftCuts=cuts(a),rightCuts=cuts(b),out=[];
  let l=0,r=0,group=[];
  for(const c of changes){
    group.push(c);if(!c.added)l+=c.value.length;if(!c.removed)r+=c.value.length;
    if(leftCuts.has(l)&&rightCuts.has(r)){
      if(group.length===1)out.push(c);
      else out.push(...affix(group.filter(c=>!c.added).map(c=>c.value).join(''),group.filter(c=>!c.removed).map(c=>c.value).join('')));
      group=[];
    }
  }
  if(group.length)throw new Error('Unclosed grapheme repair');
  return compact(out);
}
function boundedAnchored(a,b) {
  // The current reflow path accepts up to 20k characters. Avoid a quadratic
  // search for a huge replaced token; edge trimming remains useful and linear.
  return a.length*b.length>250000 ? affix(a,b) : anchored(a,b);
}
function subwords(a,b) {
  if(a.length*b.length>250000)return affix(a,b);
  // Preserve text exactly; camel-case/acronym boundaries are the only new anchors.
  const tokenize=s=>s.split(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})|(?<=_)(?=[^_])|(?<=[^_])(?=_)/u);
  const changes=Diff.diffArrays(tokenize(a),tokenize(b)).map(c=>({...c,value:c.value.join('')}));
  const out=[];
  for(let i=0;i<changes.length;){
    if(!changes[i].added&&!changes[i].removed){out.push(changes[i++]);continue;}
    let left='',right='';
    while(i<changes.length&&(changes[i].added||changes[i].removed)){
      const c=changes[i++];if(c.removed)left+=c.value;else right+=c.value;
    }
    out.push(...affix(left,right));
  }
  return compact(out);
}
const candidates = {
  words: (a,b) => compact(Diff.diffWordsWithSpace(a,b)),
  characters: (a,b) => compact(chars(a,b)),
  affixes: (a,b) => refine(a,b,affix),
  wordCharacters: (a,b) => refine(a,b,chars),
  smart: (a,b) => refine(a,b,smart),
  anchored: (a,b) => refine(a,b,anchored),
  subwords: (a,b) => safeBoundaries(a,b,refine(a,b,subwords)),
  bounded: (a,b) => safeBoundaries(a,b,refine(a,b,boundedAnchored))
};
module.exports = {candidates, graphemes, compact, refine, smart, anchored, safeBoundaries};
