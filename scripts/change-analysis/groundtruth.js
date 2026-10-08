// Ground truth for the classifier: known-mechanical transforms of real files
// (expected explained) and one injected real change (must stay residual).
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { classifyCommit, analyzeFile } = require('./classify');

const [repo, ext, count = '30'] = process.argv.slice(2);
const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 30 }).toString();
const all = git(['ls-files', `*.${ext}`, ':!.repos']).trim().split('\n').filter(p => !/(generated|__snapshots__|\.d\.ts$|vendor|migrations)/.test(p));
const picked = [];
for (let i = 0; i < all.length && picked.length < Number(count); i += Math.max(1, Math.floor(all.length / (Number(count) * 3)))) {
    const text = fs.readFileSync(path.join(repo, all[i]), 'utf8');
    const n = text.split('\n').length;
    if (n >= 60 && n <= 800 && !text.includes('\0')) picked.push({ path: all[i], text });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-'));
function format(files) {
    files.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${i}.${ext}`), f));
    try {
        if (ext === 'py') execFileSync('uvx', ['ruff', 'format', '--line-length', '60', '--config', "format.quote-style='single'", dir], { stdio: 'pipe' });
        else execFileSync('npx', ['-y', 'prettier@3', '--print-width', '60', '--single-quote', '--trailing-comma', 'all', '--tab-width', '4', '--write', dir], { stdio: 'pipe' });
    } catch { /* files with syntax errors stay unformatted */ }
    return files.map((_, i) => fs.readFileSync(path.join(dir, `f${i}.${ext}`), 'utf8'));
}

function renameSome(text) {
    const info = analyzeFile(text);
    const counts = new Map();
    for (const tok of info.toks) if (/^[A-Za-z_][A-Za-z0-9_]{3,}$/.test(tok.t)) counts.set(tok.t, (counts.get(tok.t) || 0) + 1);
    const banned = /^(self|return|import|from|const|function|export|class|async|await|string|number|boolean|None|True|False|print|super|default|interface|type|readonly|extends|implements|yield|void|case|true|false|null|undefined|typeof|instanceof|let|var|break|continue|switch|delete|else|finally|for|while|with|this|throw|catch|new|enum|declare|keyof|infer|never|unknown|lambda|pass|raise|elif|except|global|nonlocal|assert|not|and|or|is|in|of|as|if|try|def|del)$/;
    // Only names whose every textual occurrence is an identifier token (not inside strings).
    const names = [...counts].filter(([n, c]) => c >= 3 && !banned.test(n) && (text.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length === c)
        .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
    let out = text;
    for (const n of names) out = out.replace(new RegExp(`\\b${n}\\b`, 'g'), `${n}Renamed`);
    return { text: out, names };
}

function swapTopLevel(text) {
    const lines = text.split('\n');
    const starts = [];
    const head = ext === 'py' ? /^(def |class |async def )/ : /^(export )?(async )?(function |class |const \w+ = (async )?\()/;
    lines.forEach((l, i) => { if (head.test(l)) starts.push(i); });
    const chunks = starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : lines.length]).filter(([a, b]) => b - a >= 5);
    if (chunks.length < 3) return null;
    const [a, c] = [chunks[0], chunks[chunks.length - 1]];
    const A = lines.slice(a[0], a[1]), C = lines.slice(c[0], c[1]);
    const out = [...lines.slice(0, a[0]), ...C, ...lines.slice(a[1], c[0]), ...A, ...lines.slice(c[1])];
    return out.join('\n');
}

function inject(text) {
    // Flip one comparison or change one integer literal on a code line; return the line text.
    const lines = text.split('\n');
    for (let i = Math.floor(lines.length / 3); i < lines.length; i++) {
        const l = lines[i];
        if (/^\s*(#|\/\/|\*)/.test(l)) continue;
        if (l.includes(' == ')) { lines[i] = l.replace(' == ', ' != '); return { text: lines.join('\n'), line: lines[i] }; }
        const m = /\b([1-9]\d*)\b/.exec(l);
        if (m && !/['"`]/.test(l)) { lines[i] = l.slice(0, m.index) + String(Number(m[1]) + 1) + l.slice(m.index + m[1].length); return { text: lines.join('\n'), line: lines[i] }; }
    }
    return null;
}

const share = c => c.raw ? (c.formatting + c.rename + c.moved) / c.raw : 1;
const results = { format: [], rename: [], move: [], combined: [] };
const injected = { total: 0, falselyExplained: 0, byLabel: {} };
const formatted = format(picked.map(f => f.text));
picked.forEach((f, i) => {
    const run = (name, right) => {
        const r = classifyCommit([{ path: f.path, left: f.text, right }]);
        if (r && r.counts.raw) results[name].push({ path: f.path, share: share(r.counts), ...r.counts });
        return r;
    };
    if (formatted[i] !== f.text) run('format', formatted[i]);
    const renamed = renameSome(f.text);
    if (renamed.names.length) run('rename', renamed.text);
    const swapped = swapTopLevel(f.text);
    if (swapped) run('move', swapped);
});
// Combined: move, then rename, then format; then inject a real change.
const combinedSources = picked.map(f => { const s = swapTopLevel(f.text) ?? f.text; return renameSome(s).text; });
const combinedFormatted = format(combinedSources);
picked.forEach((f, i) => {
    const r = classifyCommit([{ path: f.path, left: f.text, right: combinedFormatted[i] }]);
    if (r && r.counts.raw) results.combined.push({ path: f.path, share: share(r.counts), ...r.counts });
    const inj = inject(combinedFormatted[i]);
    if (!inj) return;
    const ri = classifyCommit([{ path: f.path, left: f.text, right: inj.text }]);
    if (!ri) return;
    injected.total++;
    const pf = ri.perFile[0];
    const idx = ri.files[0].model.rightLines.findIndex(l => l.content === inj.line);
    const label = idx >= 0 ? (pf.right[idx] ?? 'context') : 'not-found';
    injected.byLabel[label] = (injected.byLabel[label] || 0) + 1;
    if (!['residual', 'not-found'].includes(label)) { injected.falselyExplained++; injected.examples ??= []; if (injected.examples.length < 5) injected.examples.push({ path: f.path, label, line: inj.line.trim().slice(0, 80) }); }
});
// Formatter canonicalization: format the original too, then classify formatted→formatted.
results.combinedPreformatted = [];
const formattedOriginals = format(picked.map(f => f.text));
picked.forEach((f, i) => {
    const r = classifyCommit([{ path: f.path, left: formattedOriginals[i], right: combinedFormatted[i] }]);
    if (r && r.counts.raw) results.combinedPreformatted.push({ path: f.path, share: share(r.counts), ...r.counts });
});
const summary = {};
for (const [k, v] of Object.entries(results)) {
    const raw = v.reduce((s, x) => s + x.raw, 0);
    const sum = key => v.reduce((s, x) => s + x[key], 0);
    summary[k] = { files: v.length, raw, explained: raw ? +((sum('formatting') + sum('rename') + sum('moved')) / raw).toFixed(3) : null,
        fmt: sum('formatting'), ren: sum('rename'), mv: sum('moved'), semWs: sum('semanticWs'), line: sum('lineLevel'), residual: sum('residual'),
        filesFullyExplained: v.filter(x => x.share >= 0.999).length };
}
console.log(JSON.stringify({ repo: path.basename(repo), ext, sampled: picked.length, summary, injected }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
