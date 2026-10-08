// For each exact move found with gates relaxed, find the retained lines it
// crosses. Retaining the move instead would trade those C lines for its L
// lines; LCS optimality guarantees C >= L, so margin = C - L (0 = tie).
const { execFileSync } = require('child_process');
const W = require('path').resolve(__dirname, '../..');
const { buildTwoWayDiffModel } = require(W + '/out/diffEngine');
const { analyzeMoves, DEFAULT_MOVE_POLICY } = require(W + '/out/moveTracking');
const [repo, limit = '400'] = process.argv.slice(2);
const git = (args, input) => execFileSync('git', args, { cwd: repo, input, maxBuffer: 1 << 30 });
const commits = git(['log', '--no-merges', '--format=%H', '-n', limit]).toString().trim().split('\n');
const pairs = [];
for (const c of commits) {
  for (const line of git(['diff-tree', '-r', '--no-commit-id', '--diff-filter=M', c]).toString().trim().split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t');
    const [, , oldBlob, newBlob] = meta.split(' ');
    if (/(lock|\.min\.|\.map$|^out\/|dist\/|\.svg$|\.png$|\.ipynb$|webview\.js|\.lock$)/.test(path)) continue;
    pairs.push({ c, path, oldBlob, newBlob });
  }
}
const raw = git(['cat-file', '--batch'], pairs.flatMap(p => [p.oldBlob, p.newBlob]).join('\n') + '\n');
const blobs = new Map(); let pos = 0;
while (pos < raw.length) {
  const nl = raw.indexOf(10, pos); const [sha, , size] = raw.slice(pos, nl).toString().split(' ');
  blobs.set(sha, raw.slice(nl + 1, nl + 1 + Number(size))); pos = nl + 1 + Number(size) + 1;
}
const INFO = /[\p{L}\p{N}]/gu;
const info = lines => ({ nonblank: lines.filter(l => l.trim()).length, chars: lines.reduce((s, l) => s + (l.match(INFO)?.length ?? 0), 0) });
const passes = (lines) => { const i = info(lines); return i.nonblank >= DEFAULT_MOVE_POLICY.minNonblankLines && i.chars >= DEFAULT_MOVE_POLICY.minInformativeChars; };
const relaxed = { minNonblankLines: 1, minInformativeChars: 1, singleLineMinChars: 1 };
const detail = { ties: [], gatedMargins: [], truncatedGated: [] };
const stats = { files: 0, filesWithMoves: 0, moves: 0, tie: 0, near: 0, far: 0, outcomes: {}, truncated: 0, examples: [] };
for (const p of pairs) {
  const a = blobs.get(p.oldBlob), b = blobs.get(p.newBlob);
  if (!a || !b || a.includes(0) || b.includes(0) || a.length > 400000) continue;
  const left = a.toString(), right = b.toString();
  const model = buildTwoWayDiffModel(left, right, { timeoutMs: 2000 });
  if (model.quality !== 'exact') continue;
  stats.files++;
  const analysis = analyzeMoves(left, right, { model, policy: relaxed });
  const moves = analysis.relations.filter(r => r.kind === 'move');
  if (moves.length) stats.filesWithMoves++;
  const ctx = [];
  for (const row of model.rows) {
    if (row.left.kind === 'context') ctx.push([row.left.lineNumber - 1, row.right.lineNumber - 1]);
  }
  const L = model.leftLines.map(l => l.content), R = model.rightLines.map(l => l.content);
  for (const m of moves) {
    const len = m.source.end - m.source.start;
    const crossed = ctx.filter(([l, r]) => (l < m.source.start && r >= m.destination.end) || (l >= m.source.end && r < m.destination.start));
    const margin = crossed.length - len;
    const band = margin === 0 ? 'tie' : margin <= Math.max(2, Math.ceil(len * 0.25)) ? 'near' : 'far';
    stats.moves++; stats[band]++;
    const moverLines = L.slice(m.source.start, m.source.end), crossedLines = crossed.map(([l]) => L[l]);
    const key = `${band}: mover ${passes(moverLines) ? 'passes' : 'fails'} gate, crossed ${passes(crossedLines) ? 'passes' : 'fails'}`;
    stats.outcomes[key] = (stats.outcomes[key] || 0) + 1;
    // A boundary line equal on both sides but kept in the backbone truncates the move.
    if ((m.source.end < L.length && m.destination.end < R.length && L[m.source.end] === R[m.destination.end] && model.leftLines[m.source.end].kind === 'context')
      || (m.source.start > 0 && m.destination.start > 0 && L[m.source.start - 1] === R[m.destination.start - 1] && model.leftLines[m.source.start - 1].kind === 'context')) stats.truncated++;
    const truncLine = (m.source.end < L.length && m.destination.end < R.length && L[m.source.end] === R[m.destination.end] && model.leftLines[m.source.end].kind === 'context') ? L[m.source.end]
      : (m.source.start > 0 && m.destination.start > 0 && L[m.source.start - 1] === R[m.destination.start - 1] && model.leftLines[m.source.start - 1].kind === 'context') ? L[m.source.start - 1] : null;
    if (band === 'tie') detail.ties.push({ len, mover: passes(moverLines), crossed: passes(crossedLines), adjacentSwap: crossed.every(([l]) => l === m.source.start - 1 || l === m.source.end), sample: moverLines[0].trim().slice(0, 50), path: p.path, commit: p.c.slice(0, 8) });
    if (passes(moverLines)) { detail.gatedMargins.push(margin); if (truncLine !== null) detail.truncatedGated.push(JSON.stringify(truncLine.trim())); }
    if (truncLine !== null && !passes(moverLines)) {
      // Would extending across the absorbed boundary line make the move reportable?
      const ext = [...moverLines, truncLine];
      if (passes(ext)) stats.truncatedBelowGateRecoverable = (stats.truncatedBelowGateRecoverable || 0) + 1;
    }
    if (band !== 'far' && !passes(moverLines) && passes(crossedLines) && stats.examples.length < 6)
      stats.examples.push({ commit: p.c.slice(0, 8), path: p.path, mover: moverLines.slice(0, 3), crossed: crossedLines.slice(0, 3), len, crossedLen: crossed.length });
  }
}
const lens = {}; detail.ties.forEach(t => lens[t.len] = (lens[t.len] || 0) + 1);
console.log(JSON.stringify({ tieLens: lens, adjacentSwapTies: detail.ties.filter(t => t.adjacentSwap).length, bothPassTies: detail.ties.filter(t => t.mover && t.crossed), gatedMargins: detail.gatedMargins.sort((a,b)=>a-b), truncatedGated: detail.truncatedGated }));
console.log(JSON.stringify({ repo, commits: commits.length, ...stats }, null, 1));
