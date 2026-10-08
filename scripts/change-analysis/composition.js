const { execFileSync } = require('child_process');
const { classifyCommit } = require('./classify');
const [repo, limit = '40'] = process.argv.slice(2);
const git = (args, input) => execFileSync('git', args, { cwd: repo, input, maxBuffer: 1 << 30 });
const commits = git(['log', '--no-merges', '--format=%H %s', '-n', '20000', '--', '.', ':!.repos']).toString().trim().split('\n').filter(l => /^refactor/i.test(l.slice(41))).slice(0, +limit);
const SKIP = /(lock|\.min\.|\.map$|^out\/|dist\/|\.svg$|\.png$|\.jpg$|\.ipynb$|webview\.js|\.lock$|generated|__snapshots__|\.snap$|^\.repos\/)/;
const t = { added: 0, deleted: 0, renamedFile: 0, modified: 0, modExplained: 0, modXfile: 0, xfileAddDel: 0, commits: 0, examples: [] };
for (const e of commits) {
  const [c] = e.split(' ');
  const pairs = git(['diff-tree', '-r', '-M', '--no-commit-id', c]).toString().trim().split('\n').filter(Boolean).map(l => { const [m, ...p] = l.split('\t'); const [, , o, n, st] = m.split(' '); return { path: p[p.length - 1], o, n, st: st[0] }; }).filter(p => !SKIP.test(p.path));
  const files = []; let skip = false;
  for (const p of pairs) {
    const left = /^0+$/.test(p.o) ? '' : git(['cat-file', 'blob', p.o]).toString(), right = /^0+$/.test(p.n) ? '' : git(['cat-file', 'blob', p.n]).toString();
    if (left.includes('\0') || right.includes('\0')) continue;
    if (left.split('\n').length > 5000 || right.split('\n').length > 5000) { skip = true; break; }
    files.push({ path: p.path, left, right, st: p.st });
  }
  if (skip) continue;
  const r = classifyCommit(files); if (!r || !r.counts.raw || r.counts.raw > 20000) continue;
  t.commits++;
  r.perFile.forEach((pf, i) => {
    const st = files[i].st;
    const n = pf.left.filter(Boolean).length + pf.right.filter(Boolean).length;
    if (st === 'A') t.added += n; else if (st === 'D') t.deleted += n;
    else { if (st === 'R') t.renamedFile += n; t.modified += n; t.modExplained += [...pf.left, ...pf.right].filter(s => ['formatting', 'rename', 'moved'].includes(s)).length; }
  });
}
const tot = t.added + t.deleted + t.modified;
const pct = x => Math.round(100 * x / tot) + '%';
console.log(repo.split('/').pop().padEnd(9), 'commits', t.commits, 'changed lines', tot, '| added files', pct(t.added), '| deleted files', pct(t.deleted), '| modified files', pct(t.modified), `(of which explained ${Math.round(100 * t.modExplained / Math.max(1, t.modified))}%)`);
