// Summarize refactor-spike.js outputs saved as <dir>/spike-<label>-<group>.json.
// Usage: node summarize.js <dir>
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) throw new Error('Usage: node summarize.js <dir>');
const groups = ['mechanical', 'refactor', 'control'];
const pct = (a, b) => b ? `${Math.round(100 * a / b)}%` : '-';
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const runs = fs.readdirSync(dir).map(name => /^spike-(.+)-(mechanical|refactor|control)\.json$/.exec(name)).filter(Boolean)
    .map(([name, label, group]) => ({ label, group, file: path.join(dir, name) }))
    .filter(run => fs.statSync(run.file).size)
    .sort((a, b) => a.label.localeCompare(b.label) || groups.indexOf(a.group) - groups.indexOf(b.group));
const all = {};
console.log('label      group       commits  raw     fmt   ren   mv    explained  +line  +xfile  semWs  medianCommitExpl');
for (const { label, group, file } of runs) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const g = all[group] ??= { commits: 0, raw: 0, formatting: 0, rename: 0, moved: 0, lineLevel: 0, crossFile: 0, semanticWs: 0, per: [] };
    for (const k of ['commits', 'raw', 'formatting', 'rename', 'moved', 'lineLevel', 'crossFile', 'semanticWs']) g[k] += j[k];
    g.per.push(...j.perCommit);
    const ex = j.formatting + j.rename + j.moved;
    console.log(label.padEnd(10), group.padEnd(11), String(j.commits).padStart(7), String(j.raw).padStart(7), pct(j.formatting, j.raw).padStart(5), pct(j.rename, j.raw).padStart(5), pct(j.moved, j.raw).padStart(5),
        pct(ex, j.raw).padStart(10), pct(j.lineLevel, j.raw).padStart(6), pct(j.crossFile, j.raw).padStart(7), pct(j.semanticWs, j.raw).padStart(6), String(median(j.perCommit.map(c => c.explained))).padStart(8));
}
console.log('\nAll inputs (lineLevel and crossFile are optimistic estimates, not explanations):');
for (const [group, g] of Object.entries(all)) {
    const ex = g.formatting + g.rename + g.moved;
    const buckets = [0.9, 0.5, 0.2].map(t => `${pct(g.per.filter(c => c.explained >= t).length, g.per.length)} ≥${t * 100}%`).join(', ');
    console.log(`${group.padEnd(11)} commits ${g.commits}, raw ${g.raw}: explained ${pct(ex, g.raw)} (fmt ${pct(g.formatting, g.raw)}, rename ${pct(g.rename, g.raw)}, moved ${pct(g.moved, g.raw)}); +line ${pct(g.lineLevel, g.raw)} +xfile ${pct(g.crossFile, g.raw)}; semantic-ws ${pct(g.semanticWs, g.raw)}; commits explained ${buckets}`);
}
