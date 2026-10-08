const { execFileSync } = require('child_process');
const W = require('path').resolve(__dirname, '../..');
const { buildTwoWayDiffModel } = require(W + '/out/diffEngine');
const { analyzeMoves } = require(W + '/out/moveTracking');
const [repo, limit = '400'] = process.argv.slice(2);
const git = (args) => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 30 }).toString();
const r = { commits: 0, commitsWithMove: 0, commitsWithCopy: 0, moves: 0, copies: 0, unresolved: 0, movedLines: 0, copiedLines: 0, topCommitShare: 0, perCommit: [] };
for (const c of git(['log', '--no-merges', '--format=%H', '-n', limit]).trim().split('\n')) {
  r.commits++; let mv = 0, cp = 0;
  for (const line of git(['diff-tree', '-r', '--no-commit-id', '--diff-filter=M', c]).trim().split('\n').filter(Boolean)) {
    const [meta, p] = line.split('\t'); const [, , o, n] = meta.split(' ');
    if (/(lock|\.min\.|\.map$|^out\/|dist\/|\.svg$|\.png$|\.ipynb$|webview\.js)/.test(p)) continue;
    const a = git(['cat-file', 'blob', o]), b = git(['cat-file', 'blob', n]);
    if (a.includes('\0') || a.length > 400000) continue;
    const m = buildTwoWayDiffModel(a, b, { timeoutMs: 2000 }); if (m.quality !== 'exact') continue;
    const an = analyzeMoves(a, b, { model: m });
    for (const x of an.relations) { const len = x.destination.end - x.destination.start;
      if (x.kind === 'move') { mv++; r.moves++; r.movedLines += len; } else { cp++; r.copies++; r.copiedLines += len; } }
    r.unresolved += an.unresolved.length;
  }
  if (mv) r.commitsWithMove++; if (cp) r.commitsWithCopy++; if (mv + cp) r.perCommit.push(mv + cp);
}
r.perCommit.sort((x, y) => y - x);
const total = r.perCommit.reduce((s, x) => s + x, 0);
r.topCommitShare = total ? +(r.perCommit.slice(0, Math.ceil(r.perCommit.length * 0.2)).reduce((s, x) => s + x, 0) / total).toFixed(2) : 0;
r.perCommit = r.perCommit.slice(0, 10);
console.log(JSON.stringify(r));
