// Shared classifier for the refactor-decomposition spike.
// classifyCommit(files) partitions every raw changed line of a set of
// {path, left, right} pairs into formatting / semanticWs / rename / moved /
// lineLevel / residual, plus a crossFile estimate over residual lines.
const W = require('path').resolve(__dirname, '../..');
const Diff = require('diff');
const { buildTwoWayDiffModel } = require(W + '/out/diffEngine');
const { analyzeMoves } = require(W + '/out/moveTracking');

const TOKEN = /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|[\p{L}_$][\p{L}\p{N}_$]*|\p{N}[\p{L}\p{N}_.]*|==|!=|<=|>=|=>|->|\*\*|\/\/|[+\-*/%&|^]=|&&|\|\||\?\?|\.\.\.|::|\S/gu;
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const KEYWORDS = new Set('if else elif for while return function const let var class def import from export async await try except catch finally with as in is not and or new this self None null undefined true false True False type interface lambda yield pass break continue raise throw'.split(' '));
const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);

// Equivalent spellings: quote style for simple strings (not template literals).
function canonical(t) {
    let m = /^("""|''')([\s\S]*)\1$/.exec(t);
    if (m && !/["'\\]/.test(m[2])) return `"""${m[2]}"""`;
    m = /^(["'])((?:[^"'\\\n]|\\[^"'\n])*)\1$/.exec(t);
    if (m) return `"${m[2]}"`;
    return t;
}

function analyzeFile(text, path = '') {
    const python = /\.pyi?$/.test(path);
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
    const lineOf = pos => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
    const toks = [];
    for (const m of text.matchAll(TOKEN)) toks.push({ t: canonical(m[0]), start: lineOf(m.index), end: lineOf(m.index + m[0].length - 1), drop: false });
    // Insignificant trailing commas: always before ] or }, before ) only if the group has another comma.
    const stack = [];
    toks.forEach((tok, i) => {
        if (OPEN[tok.t]) stack.push({ close: OPEN[tok.t], commas: 0 });
        else if (tok.t === ',' && stack.length) stack[stack.length - 1].commas++;
        else if (CLOSE.has(tok.t)) {
            const g = stack.pop();
            const prev = toks[i - 1];
            // Python `(x,)` is a one-element tuple; elsewhere a trailing comma before `)` is insignificant.
            if (g && prev?.t === ',' && (tok.t !== ')' || !python || g.commas > 1)) prev.drop = true;
        }
    });
    // Redundant grouping parentheses around a whole expression (formatters add these when
    // wrapping). Only after an expression-start token, never around a tuple, and only
    // when the closing paren ends the expression, so precedence cannot change.
    // `if (...)` / `while (...)` parentheses are syntax outside Python.
    const PRECEDE = new Set(['=', 'return', '(', '[', '{', ',', ':', 'yield', 'await', '=>', ...(python ? ['assert', 'if', 'elif', 'while', 'in'] : [])]);
    const TERMINATE = new Set([',', ')', ']', '}', ';', ':']);
    const CONTINUES = /^([.([\]+\-*/%&|^<>!?@~]|==|!=|<=|>=|\*\*|\/\/|&&|\|\||\?\?|and|or|if|else|in|not|is|for)$/;
    const parenStack = [];
    toks.forEach((tok, i) => {
        if (OPEN[tok.t]) parenStack.push({ i, commas: 0 });
        else if (tok.t === ',' && parenStack.length) parenStack[parenStack.length - 1].commas++;
        else if (CLOSE.has(tok.t)) {
            const g = parenStack.pop();
            if (!g || tok.t !== ')' || toks[g.i].t !== '(') return;
            const before = toks[g.i - 1];
            const after = toks[i + 1];
            const hasTopComma = g.commas > 0 && !(g.commas === 1 && toks[i - 1]?.t === ',' && toks[i - 1].drop);
            if (hasTopComma || g.i + 1 === i) return;
            const startsExpr = !before || PRECEDE.has(before.t);
            const ends = !after || TERMINATE.has(after.t) || (after.start > tok.end && !CONTINUES.test(after.t));
            if (startsExpr && ends) { toks[g.i].drop = true; tok.drop = true; }
        }
    });
    if (!python) toks.forEach((tok, i) => {
        const prev = toks[i - 1], next = toks[i + 1];
        // Leading `|` / `&` in a TypeScript union or intersection.
        if ((tok.t === '|' || tok.t === '&') && prev && ['=', '(', '<', ',', ':', '|', '&'].includes(prev.t)) tok.drop = true;
        // Separator before a closing brace (`{ a: string; }` vs `{ a: string }`).
        if (tok.t === ';' && next?.t === '}') tok.drop = true;
    });
    // Bracket depth at the start of each line, for continuation detection.
    const lines = text.split('\n');
    const depthAt = new Array(lines.length).fill(0);
    let depth = 0, ti = 0;
    for (let line = 0; line < lines.length; line++) {
        depthAt[line] = depth;
        while (ti < toks.length && toks[ti].start === line) {
            if (OPEN[toks[ti].t]) depth++; else if (CLOSE.has(toks[ti].t)) depth = Math.max(0, depth - 1);
            ti++;
        }
    }
    const firstTokenStartsHere = new Array(lines.length).fill(false);
    const coveredByString = new Array(lines.length).fill(false);
    for (const tok of toks) {
        for (let l = tok.start + 1; l <= tok.end; l++) coveredByString[l] = true;
    }
    for (const tok of toks) if (!coveredByString[tok.start]) firstTokenStartsHere[tok.start] = true;
    const logicalStart = lines.map((line, i) => firstTokenStartsHere[i] && depthAt[i] === 0 && !(i > 0 && /\\\s*$/.test(lines[i - 1])));
    const perLine = lines.map(() => []);
    for (const tok of toks) if (!tok.drop) perLine[tok.start].push(tok.t.replace(/\n/g, '\\n'));
    return { toks, lines, logicalStart, perLine };
}

// Tokens overlapping [a, b) lines, so an edit inside a multi-line string counts.
function blockTokens(info, a, b) {
    return info.toks.filter(tok => !tok.drop && tok.end >= a && tok.start < b).map(tok => tok.t);
}

function tokenDiff(a, b) {
    const ids = new Map(); const id = t => { if (!ids.has(t)) ids.set(t, ids.size); return ids.get(t); };
    return Diff.diffArrays(a.map(id), b.map(id), { timeout: 2000 });
}

const indentKind = path => /\.(py|pyi)$/.test(path) ? 'python' : /\.ya?ml$/.test(path) ? 'yaml' : null;
const lead = line => line.match(/^[ \t]*/)[0];

function classifyCommit(rawFiles, { renames = true, minRenameVotes = 2 } = {}) {
    const files = [];
    for (const f of rawFiles) {
        const left = f.left.replace(/\r\n/g, '\n'), right = f.right.replace(/\r\n/g, '\n');
        const model = buildTwoWayDiffModel(left, right, { timeoutMs: 3000 });
        if (model.quality !== 'exact' && left && right) return null;
        files.push({ path: f.path, left, right, model, L: analyzeFile(left, f.path), R: analyzeFile(right, f.path) });
    }
    const raw = files.reduce((s, f) => s + f.model.leftLines.filter(l => l.kind === 'removed').length + f.model.rightLines.filter(l => l.kind === 'added').length, 0);

    // Commit-wide consistent identifier map from equal-length substitutions inside hunks.
    const votes = new Map();
    if (renames) for (const f of files) for (const block of f.model.blocks) {
        const lt = blockTokens(f.L, block.leftStart, block.leftEnd), rt = blockTokens(f.R, block.rightStart, block.rightEnd);
        if (lt.length > 20000 || rt.length > 20000) continue;
        const ch = tokenDiff(lt, rt); if (!ch) continue;
        let li = 0, ri = 0;
        for (let k = 0; k < ch.length; k++) {
            const c = ch[k];
            if (c.removed && ch[k + 1]?.added && ch[k + 1].count === c.count) {
                for (let q = 0; q < c.count; q++) {
                    const from = lt[li + q], to = rt[ri + q];
                    if (IDENT.test(from) && IDENT.test(to) && !KEYWORDS.has(from) && !KEYWORDS.has(to)) {
                        const v = votes.get(from) || new Map(); v.set(to, (v.get(to) || 0) + 1); votes.set(from, v);
                    }
                }
                li += c.count; ri += c.count; k++; continue;
            }
            if (c.removed) li += c.count; else if (c.added) ri += c.count; else { li += c.count; ri += c.count; }
        }
    }
    const renameMap = new Map();
    for (const [from, v] of votes) {
        if (v.size !== 1) continue;
        const [[to, n]] = [...v];
        // The old name must be gone from every new snapshot in the commit.
        if (n < minRenameVotes || files.some(f => f.R.toks.some(tok => tok.t === from))) continue;
        renameMap.set(from, to);
    }
    const rename = toks => toks.map(t => renameMap.get(t) ?? t);

    const counts = { raw, formatting: 0, semanticWs: 0, rename: 0, moved: 0, lineLevel: 0, residual: 0, crossFile: 0 };
    const residualLines = [];
    const perFile = [];
    for (const f of files) {
        const leftState = f.model.leftLines.map(l => l.kind === 'removed' ? 'residual' : null);
        const rightState = f.model.rightLines.map(l => l.kind === 'added' ? 'residual' : null);
        const kind = indentKind(f.path);
        // Merge hunks separated only by blank or punctuation-only context lines.
        const regions = [];
        for (const b of f.model.blocks) {
            const prev = regions[regions.length - 1];
            if (prev) {
                const gap = f.model.leftLines.slice(prev.leftEnd, b.leftStart);
                if (gap.length <= 3 && gap.every(l => !/[\p{L}\p{N}]/u.test(l.content))) { prev.leftEnd = b.leftEnd; prev.rightEnd = b.rightEnd; continue; }
            }
            regions.push({ ...b });
        }
        for (const block of regions) {
            const lt = blockTokens(f.L, block.leftStart, block.leftEnd), rt = blockTokens(f.R, block.rightStart, block.rightEnd);
            let label = null;
            const same = lt.join('\u0000') === rt.join('\u0000');
            const renamed = !same && renameMap.size && rename(lt).join('\u0000') === rt.join('\u0000');
            if (same || renamed) {
                let indentOk = true;
                if (kind) {
                    const seq = (info, a, b) => {
                        const out = [];
                        for (let i = a; i < b; i++) {
                            if (!info.lines[i].trim()) continue;
                            if (kind === 'yaml' || info.logicalStart[i]) out.push(lead(info.lines[i]));
                        }
                        return out;
                    };
                    const ls = seq(f.L, block.leftStart, block.leftEnd), rs = seq(f.R, block.rightStart, block.rightEnd);
                    indentOk = ls.length === rs.length && ls.every((x, i) => x === rs[i]);
                }
                label = !indentOk ? 'semanticWs' : same ? 'formatting' : 'rename';
            }
            if (!label) continue;
            for (let i = block.leftStart; i < block.leftEnd; i++) if (leftState[i]) leftState[i] = label;
            for (let i = block.rightStart; i < block.rightEnd; i++) if (rightState[i]) rightState[i] = label;
        }
        // Moves on normalized lines (canonical tokens, renames applied to the old side); 1:1 with raw lines.
        if (f.left && f.right) {
            const nl = f.L.perLine.map(t => rename(t).join(' ')).join('\n');
            const nr = f.R.perLine.map(t => t.join(' ')).join('\n');
            for (const rel of analyzeMoves(nl, nr).relations.filter(r => r.kind === 'move')) {
                for (let i = rel.source.start; i < rel.source.end; i++) if (leftState[i] === 'residual') leftState[i] = 'moved';
                for (let i = rel.destination.start; i < rel.destination.end; i++) if (rightState[i] === 'residual') rightState[i] = 'moved';
            }
        }
        // Optimistic: residual lines fully token-matched within their own hunk.
        for (const block of f.model.blocks) {
            const lIdx = [], rIdx = [];
            for (let i = block.leftStart; i < block.leftEnd; i++) if (leftState[i] === 'residual') lIdx.push(i);
            for (let i = block.rightStart; i < block.rightEnd; i++) if (rightState[i] === 'residual') rIdx.push(i);
            if (!lIdx.length || !rIdx.length) continue;
            const lTok = [], lOwner = [], rTok = [], rOwner = [];
            for (const i of lIdx) for (const t of rename(f.L.perLine[i])) { lTok.push(t); lOwner.push(i); }
            for (const i of rIdx) for (const t of f.R.perLine[i]) { rTok.push(t); rOwner.push(i); }
            if (!lTok.length || !rTok.length || lTok.length > 20000 || rTok.length > 20000) continue;
            const ch = tokenDiff(lTok, rTok); if (!ch) continue;
            const lMiss = new Set(), rMiss = new Set(); let li = 0, ri = 0;
            for (const c of ch) {
                if (c.removed) { for (let q = 0; q < c.count; q++) lMiss.add(lOwner[li + q]); li += c.count; }
                else if (c.added) { for (let q = 0; q < c.count; q++) rMiss.add(rOwner[ri + q]); ri += c.count; }
                else { li += c.count; ri += c.count; }
            }
            for (const i of lIdx) if (!lMiss.has(i) && f.L.perLine[i].length) leftState[i] = 'lineLevel';
            for (const i of rIdx) if (!rMiss.has(i) && f.R.perLine[i].length) rightState[i] = 'lineLevel';
        }
        const fileCounts = { path: f.path, left: leftState, right: rightState };
        perFile.push(fileCounts);
        leftState.forEach((s, i) => { if (s) { counts[s]++; if (s === 'residual') residualLines.push({ side: 'left', path: f.path, text: f.model.leftLines[i].content }); } });
        rightState.forEach((s, i) => { if (s) { counts[s]++; if (s === 'residual') residualLines.push({ side: 'right', path: f.path, text: f.model.rightLines[i].content }); } });
    }
    const bySide = { left: new Map(), right: new Map() };
    for (const r of residualLines) {
        const k = r.text.trim(); if (k.replace(/[^\p{L}\p{N}]/gu, '').length < 12) continue;
        bySide[r.side].set(k, (bySide[r.side].get(k) || new Set()).add(r.path));
    }
    for (const r of residualLines) {
        const other = bySide[r.side === 'left' ? 'right' : 'left'].get(r.text.trim());
        if (other && [...other].some(p => p !== r.path)) counts.crossFile++;
    }
    return { counts, renameMap, residualLines, perFile, files };
}

module.exports = { classifyCommit, analyzeFile };
