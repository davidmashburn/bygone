function render(phases, snapshots) {
    const data = JSON.stringify({ phases, snapshots }).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Requirements evidence experiment</title>
<style>
:root { color-scheme: light dark; } body { margin: 0; color: var(--foreground, #20242b); font: 15px/1.5 var(--font-sans, system-ui); } * { box-sizing: border-box; }
p { margin: 0 0 14px; } .muted, small { color: var(--muted-foreground, #727780); } nav { display:flex; flex-wrap:wrap; gap:8px; margin:16px 0; }
button { font:inherit; cursor:pointer; border:1px solid var(--border, #bbb); border-radius:8px; padding:8px 12px; background:transparent; color:inherit; }
button[aria-pressed=true] { background:var(--primary, #285bb0); color:var(--primary-foreground, white); border-color:transparent; }
article, .queue { border:1px solid var(--border, #bbb); border-radius:var(--radius, 10px); padding:16px; margin:14px 0; }
h3 { font-size:16px; margin:0 0 10px; } .badges { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; } .badge { background:var(--secondary, #e5e9ef); color:var(--secondary-foreground, #343b48); padding:3px 8px; border-radius:5px; font-size:12px; }
.attention { background:var(--warning-surface, #fff0cb); color:var(--warning-foreground, #805600); } .failure { background:var(--destructive-surface, #f9dddd); color:var(--destructive, #a82020); }
details { border-top:1px solid var(--border, #bbb); padding-top:10px; margin-top:10px; } summary { cursor:pointer; overflow-wrap:anywhere; } pre { white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.6 var(--font-mono, monospace); background:var(--code-background, #eff1f4); color:var(--code-foreground, #263144); padding:12px; border-radius:6px; } code { font-family:var(--font-mono, monospace); } .note { font-size:13px; } .location { overflow-wrap:anywhere; }
</style>
<p><strong>Requirements evidence · local experiment</strong><br><span class="muted">Same requirement, three revisions. No model calls. Correspondence comes from Strand; test outcomes come from an executed synthetic test.</span></p>
<nav aria-label="Review revision"></nav><div id="content" aria-live="polite"></div>
<script>
const data = ${data};
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge = (text, style='') => '<span class="badge '+style+'">'+esc(text)+'</span>';
const source = ref => { const s = data.snapshots.find(s => s.revision === ref.revision); return s?.files[ref.path]?.slice(ref.start, ref.end); };
function show(index) {
 const p = data.phases[index];
 document.querySelector('nav').innerHTML = data.phases.map((x,i) => '<button data-index="'+i+'" aria-pressed="'+(i===index)+'">'+esc(x.title)+'</button>').join('');
 document.querySelectorAll('button').forEach(b => b.onclick = () => show(Number(b.dataset.index)));
 const explanation = [
  'The initial test passed. The inspection note is a simulated reviewer decision. R2 has no linked evidence.',
  'Strand relocated the predicate. Its bytes are unchanged, but the new revision needs inspection and has no recorded test run.',
  'Strand tracked the edited predicate. The original note remains historical; the test rerun now fails.'
 ][index];
 document.getElementById('content').innerHTML = '<p>'+explanation+'</p><small>Head <code>'+p.head.slice(0,12)+'</code> · comparison against the fixed baseline</small>'+p.report.requirements.map(r => {
  const v = {'not-recorded':'No verification recorded at this head','needs-reassessment':'Test applicability needs reassessment','recorded-pass':'Test run recorded: passed','recorded-failure':'Test run recorded: failed'}[r.verification];
  const state = {'inspected':'Inspected for this comparison','needs-review':'Needs renewed inspection','unreviewed':'Unreviewed'}[r.reviewer];
  return '<article><h3>'+esc(r.id+' · '+r.text)+'</h3><div class="badges">'+badge(r.implementationLinked?'Implementation linked':'No implementation linked',r.implementationLinked?'':'attention')+badge(r.testLinked?'Test source linked':'No test source linked')+badge(v,r.verification==='recorded-failure'?'failure':'')+badge(state,r.reviewer==='needs-review'?'attention':'')+'</div>'+(r.note?'<p class="note">'+esc(r.note)+'</p>':'')+
  r.links.map(l => { const t = p.transitions.find(t=>t.link===l.id); const oldText = t && source(t.before); return '<details><summary>'+esc(l.role+' · '+l.ref.path)+(t?' · '+esc(t.status):'')+'</summary><p class="note">'+esc(l.rationale)+'</p><small class="location">Pinned '+l.ref.revision.slice(0,12)+' · UTF-16 offsets '+l.ref.start+'–'+l.ref.end+'</small>'+(oldText!==undefined && t.status!=='unchanged'?'<p class="note">Previously linked source</p><pre>'+esc(oldText)+'</pre>':'')+'<p class="note">Current evidence</p><pre>'+esc(l.resolution.status==='valid'?l.resolution.text:l.resolution.reason)+'</pre></details>'; }).join('')+
  r.questions.map(q => '<details open><summary>'+esc(q.status+' question: '+q.text)+'</summary>'+q.alternatives.map(a => '<p>'+esc(a.text)+'</p>'+a.sources.map(s => '<blockquote>'+esc(s.quote)+' <small>'+esc(s.title)+'</small></blockquote>').join('')).join('')+(q.status==='resolved'?'<p>'+esc(q.resolution)+'</p>':'')+'</details>').join('')+
  r.runs.map(run => '<details><summary>'+esc(run.outcome+' · '+run.applicability)+'</summary><p>'+esc(run.association.scope)+'</p><code>'+esc(run.command)+'</code><p class="location">Revision '+esc(run.revision)+' · output '+esc(run.outputDigest)+'</p></details>').join('')+
  '<details><summary>Requirement provenance</summary>'+r.sources.map(s => '<p class="note">'+esc(s.title)+'</p><blockquote>'+esc(s.quote)+'</blockquote>').join('')+'</details></article>';
 }).join('')+'<div class="queue"><strong>Analysis scope and limits</strong>'+(p.report.analyses.length?p.report.analyses.map(a => '<details open><summary>'+esc(a.status+' · '+a.relevance+' · '+a.producer)+'</summary><p>'+esc(a.scope.join('; '))+'</p><p>'+esc(a.limitations.join('; ')||'No limitations recorded')+'</p><small>'+esc(a.base.slice(0,12)+' → '+a.head.slice(0,12))+'</small></details>').join(''):'<p>No analysis recorded</p>')+'<small>Completeness applies to each recorded scope and range only.</small></div><div class="queue"><strong>Changed files with no valid evidence link</strong><p class="location">'+(p.report.changedPathsWithoutLinks.map(esc).join(', ')||'None')+'</p><small>File-level bookkeeping only. A linked file may still contain unexplained edits. This experiment does not determine requirement fulfillment.</small></div>';
}
show(0);
// Exercise all revision render paths before leaving the initial view selected.
for (let i=0;i<data.phases.length;i++) { show(i); if (document.querySelectorAll('article').length!==2) throw Error('Missing requirement card'); }
show(0); console.log('Rendered all three revision states; two requirement cards per state.');
</script></html>`;
}
module.exports = { render };
