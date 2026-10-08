// Real-history refactor spike using the shared classifier.
const { execFileSync } = require('child_process');
const { classifyCommit } = require('./classify');

const [repo, group, limit = '40'] = process.argv.slice(2);
const git = (args, input) => execFileSync('git', args, { cwd: repo, input, maxBuffer: 1 << 30 });
const SUBJECT = {
    refactor: /^refactor/i,
    mechanical: /\b(format(ting|ted)?|prettier|black|ruff format|reformat|rename[sd]?|renaming|move[sd]?|moving|reorder(ed|s)?|sort(ed)? imports|isort)\b/i,
    control: /^(feat|fix)\b/i
}[group];
const commits = git(['log', '--no-merges', '--format=%H %s', '-n', '20000', '--', '.', ':!.repos']).toString().trim().split('\n')
    .filter(line => SUBJECT.test(line.slice(41))).slice(0, Number(limit));
const SKIP = /(lock|\.min\.|\.map$|^out\/|dist\/|\.svg$|\.png$|\.jpg$|\.ipynb$|webview\.js|\.lock$|generated|__snapshots__|\.snap$|^\.repos\/)/;

function readBlobs(shas) {
    const wanted = [...new Set(shas.filter(s => !/^0+$/.test(s)))];
    const map = new Map();
    if (!wanted.length) return map;
    const raw = git(['cat-file', '--batch'], wanted.join('\n') + '\n');
    let pos = 0;
    while (pos < raw.length) {
        const nl = raw.indexOf(10, pos);
        const [sha, type, size] = raw.slice(pos, nl).toString().split(' ');
        if (type === 'missing') { pos = nl + 1; continue; }
        map.set(sha, raw.slice(nl + 1, nl + 1 + Number(size)));
        pos = nl + 1 + Number(size) + 1;
    }
    return map;
}

const totals = { commits: 0, skippedCommits: 0, raw: 0, formatting: 0, semanticWs: 0, rename: 0, moved: 0, lineLevel: 0, residual: 0, crossFile: 0, perCommit: [] };
for (const entry of commits) {
    const [commit, ...subject] = entry.split(' ');
    const pairs = [];
    for (const line of git(['diff-tree', '-r', '-M', '--no-commit-id', commit]).toString().trim().split('\n').filter(Boolean)) {
        const [meta, ...paths] = line.split('\t');
        const [, , oldBlob, newBlob] = meta.split(' ');
        const path = paths[paths.length - 1];
        if (!SKIP.test(path)) pairs.push({ path, oldBlob, newBlob });
    }
    const blobs = readBlobs(pairs.flatMap(p => [p.oldBlob, p.newBlob]));
    const files = [];
    let skip = false;
    for (const p of pairs) {
        const a = blobs.get(p.oldBlob), b = blobs.get(p.newBlob);
        if ((a && a.includes(0)) || (b && b.includes(0))) continue;
        const left = a ? a.toString() : '', right = b ? b.toString() : '';
        if (left.split('\n').length > 5000 || right.split('\n').length > 5000) { skip = true; break; }
        files.push({ path: p.path, left, right });
    }
    const result = skip ? null : classifyCommit(files);
    if (!result || !result.counts.raw || result.counts.raw > 20000) { totals.skippedCommits++; continue; }
    const c = result.counts;
    totals.commits++;
    for (const k of Object.keys(c)) totals[k] += c[k];
    totals.perCommit.push({ commit: commit.slice(0, 8), subject: subject.join(' ').slice(0, 70),
        explained: +((c.formatting + c.rename + c.moved) / c.raw).toFixed(2), ...c,
        renames: [...result.renameMap].slice(0, 4).map(([a, b]) => `${a}→${b}`) });
}
console.log(JSON.stringify({ repo, group, ...totals }));
