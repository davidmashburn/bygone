// For each truncated exact move, ask: is there an equally long alignment in
// which the boundary line(s) are unmatched (and so can join the move)?
// LCS(left minus line li, right minus line ri) === LCS(full) answers it.
const { execFileSync } = require('child_process');
const Diff = require('diff');
const W = require('path').resolve(__dirname, '../..');
const { buildTwoWayDiffModel } = require(W + '/out/diffEngine');
const { analyzeMoves, DEFAULT_MOVE_POLICY } = require(W + '/out/moveTracking');
const [repo, limit = '400'] = process.argv.slice(2);
const git = (args) => execFileSync('git', args, { cwd: repo, maxBuffer: 1 << 30 }).toString();
const lcs = (a, b) => { const ch = Diff.diffArrays(a, b, { timeout: 5000 }); if (!ch) throw new Error('lcs-timeout'); return ch.filter(c => !c.added && !c.removed).reduce((s, c) => s + c.value.length, 0); };
const INFO = /[\p{L}\p{N}]/gu;
const passes = lines => lines.filter(l => l.trim()).length >= DEFAULT_MOVE_POLICY.minNonblankLines && lines.reduce((s, l) => s + (l.match(INFO)?.length ?? 0), 0) >= DEFAULT_MOVE_POLICY.minInformativeChars;
const relaxed = { minNonblankLines: 1, minInformativeChars: 1, singleLineMinChars: 1 };
const res = { truncatedMoves: 0, extendableAtEqualCost: 0, linesRecovered: 0, costsAtLeastOne: 0, gatedBefore: 0, gatedAfter: 0, examples: [] };
for (const c of git(['log', '--no-merges', '--format=%H', '-n', limit]).trim().split('\n')) {
  for (const line of git(['diff-tree', '-r', '--no-commit-id', '--diff-filter=M', c]).trim().split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t'); const [, , o, n] = meta.split(' ');
    if (/(lock|\.min\.|\.map$|^out\/|dist\/|\.svg$|\.png$|\.ipynb$|webview\.js)/.test(path)) continue;
    const l = git(['cat-file', 'blob', o]), r = git(['cat-file', 'blob', n]);
    if (l.includes('\0') || l.split('\n').length > 3000 || r.split('\n').length > 3000) { res.skippedLarge = (res.skippedLarge || 0) + 1; continue; }
    const m = buildTwoWayDiffModel(l, r, { timeoutMs: 2000 }); if (m.quality !== 'exact') continue;
    const L = m.leftLines.map(x => x.content), R = m.rightLines.map(x => x.content);
    let base; try { base = lcs(L, R); } catch { res.timeouts = (res.timeouts || 0) + 1; continue; }
    for (const x of analyzeMoves(l, r, { model: m, policy: relaxed }).relations.filter(x => x.kind === 'move')) {
      let s = x.source.start, e = x.source.end, d = x.destination.start, d2 = x.destination.end;
      const isTrunc = (li, ri) => li >= 0 && ri >= 0 && li < L.length && ri < R.length && L[li] === R[ri] && (m.leftLines[li].kind === 'context' || m.rightLines[ri].kind === 'context');
      if (!isTrunc(e, d2) && !isTrunc(s - 1, d - 1)) continue;
      res.truncatedMoves++;
      const before = passes(L.slice(s, e)); if (before) res.gatedBefore++;
      // Greedily extend while an equal-cost alignment frees the next boundary pair.
      const freedL = new Set(), freedR = new Set(); let gained = 0, blocked = false;
      for (let guard = 0; guard < 6; guard++) {
        let li, ri, after;
        if (e < L.length && d2 < R.length && L[e] === R[d2]) { li = e; ri = d2; after = true; }
        else if (s > 0 && d > 0 && L[s - 1] === R[d - 1]) { li = s - 1; ri = d - 1; after = false; }
        else break;
        freedL.add(li); freedR.add(ri);
        let cost; try { cost = base - lcs(L.filter((_, i) => !freedL.has(i)), R.filter((_, i) => !freedR.has(i))); } catch { cost = NaN; }
        if (cost !== 0) { freedL.delete(li); freedR.delete(ri); blocked = true; break; }
        gained++; if (after) { e++; d2++; } else { s--; d--; }
      }
      if (gained) { res.extendableAtEqualCost++; res.linesRecovered += gained; }
      if (blocked && !gained) res.costsAtLeastOne++;
      if (passes(L.slice(s, e))) res.gatedAfter++;
      if (gained && res.examples.length < 8) res.examples.push(`${c.slice(0, 8)} ${path} L${x.source.start + 1}-${x.source.end} → L${s + 1}-${e} (+${gained})${!before && passes(L.slice(s, e)) ? ' NOW REPORTABLE' : ''}`);
    }
  }
}
console.log(JSON.stringify(res, null, 1));
