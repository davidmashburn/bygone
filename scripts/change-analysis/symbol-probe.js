// Research baseline, not a semantic-equivalence checker or production matcher.
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function inventory(files) {
  const entries = [], diagnostics = [], unsupported = [];
  for (const [path, text] of Object.entries(files)) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (sf.parseDiagnostics.length) {
      diagnostics.push({ path, count: sf.parseDiagnostics.length });
      continue; // Recovered syntax must not silently supply accepted matches.
    }
    function shape(node, omitted) {
      if (node === omitted) return ['declaration-name'];
      const children = [];
      ts.forEachChild(node, child => { children.push(shape(child, omitted)); });
      return [ts.SyntaxKind[node.kind], children.length ? children : node.getText(sf)];
    }
    function add(node, name, body, kind, context = []) {
      const start = node.getStart(sf), end = node.end;
      entries.push({ path, name: name.text, kind, start, end,
        startLine: sf.getLineAndCharacterOfPosition(start).line,
        endLine: sf.getLineAndCharacterOfPosition(end - 1).line + 1,
        shape: hash([context, shape(node, name)]), body: hash(shape(body)),
        raw: hash(text.slice(start, end)) });
    }
    for (const node of sf.statements) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) {
        add(node, node.name, node.body, 'function');
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer &&
              (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            add(decl, decl.name, decl.initializer.body, 'function-variable',
              [node.declarationList.flags, (node.modifiers || []).map(m => m.getText(sf))]);
          } else unsupported.push({ path, kind: ts.SyntaxKind[decl.kind] });
        }
      } else unsupported.push({ path, kind: ts.SyntaxKind[node.kind] });
    }
  }
  return { entries, diagnostics, unsupported };
}

function analyze(before, after) {
  const left = inventory(before), right = inventory(after);
  const matches = [], unresolved = [], usedLeft = new Set(), usedRight = new Set();
  const bucket = (items, key) => {
    const map = new Map();
    for (const item of items) { const k = key(item); map.set(k, [...(map.get(k) || []), item]); }
    return map;
  };
  const identity = e => `${e.path}\0${e.kind}\0${e.name}`;
  const oldNames = bucket(left.entries, identity), newNames = bucket(right.entries, identity);
  const oldShapes = bucket(left.entries, e => e.shape), newShapes = bucket(right.entries, e => e.shape);
  function accept(a, b, evidence) {
    usedLeft.add(a); usedRight.add(b);
    matches.push({ source: a, destination: b, evidence,
      pathChanged: a.path !== b.path, nameChanged: a.name !== b.name,
      bodySyntaxEqual: a.body === b.body, declarationSyntaxEqual: a.shape === b.shape,
      rawEqual: a.raw === b.raw, behavior: 'unassessed' });
  }
  for (const [key, a] of oldNames) {
    const b = newNames.get(key);
    if (a.length === 1 && b?.length === 1) accept(a[0], b[0], 'same-path-kind-name');
  }
  for (const b of right.entries) {
    if (usedRight.has(b)) continue;
    const a = oldShapes.get(b.shape) || [], destinations = newShapes.get(b.shape);
    // Include already paired occurrences in ambiguity checks: recurring idioms
    // cannot become unique just because a retained source was consumed first.
    if (a.length === 1 && destinations.length === 1 && !usedLeft.has(a[0])) {
      accept(a[0], b, 'unique-declaration-syntax-excluding-name');
    } else if (a.length) unresolved.push({ destination: b, sources: a,
      reason: 'repeated-or-retained-equivalent-syntax' });
  }
  return { status: left.diagnostics.length || right.diagnostics.length ? 'partial' : 'complete',
    scope: 'supplied-files; top-level named functions and function variables only',
    matches, unresolved, unmatchedLeft: left.entries.filter(e => !usedLeft.has(e)),
    unmatchedRight: right.entries.filter(e => !usedRight.has(e)),
    diagnostics: { before: left.diagnostics, after: right.diagnostics },
    unsupported: { before: left.unsupported.length, after: right.unsupported.length },
    inventory: { before: left.entries.length, after: right.entries.length } };
}

function history(repo, ref, limit) {
  const git = args => execFileSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 }).toString();
  const head = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const commits = git(['log', '--no-merges', '--format=%H', `-n${limit}`, head]).trim().split('\n');
  const records = [];
  for (const commit of commits) {
    const parents = git(['rev-list', '--parents', '-n1', commit]).trim().split(' ');
    if (parents.length !== 2) { records.push({ commit, status: 'skipped-root' }); continue; }
    const paths = git(['diff', '--name-only', '-z', '--no-renames', parents[1], commit]).split('\0')
      .filter(p => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(p) && !/(?:^|\/)(?:out|dist|node_modules)\/|\.min\.|\.d\.ts$/.test(p));
    if (paths.length > 80) { records.push({ commit, status: 'skipped-file-budget' }); continue; }
    const before = {}, after = {};
    let bytes = 0, oversized = false;
    for (const [rev, files] of [[parents[1], before], [commit, after]]) {
      const tree = new Map(git(['ls-tree', '-r', '-z', rev]).split('\0').filter(Boolean).map(row => {
        const tab = row.indexOf('\t'); return [row.slice(tab + 1), row.slice(0, tab).split(' ')[2]];
      }));
      for (const path of paths) {
        const oid = tree.get(path);
        if (!oid) continue;
        const size = Number(git(['cat-file', '-s', oid])); bytes += size;
        if (size > 1024 * 1024 || bytes > 4 * 1024 * 1024) { oversized = true; break; }
        const text = git(['cat-file', 'blob', oid]);
        if (!text.includes('\0')) files[path] = text;
      }
      if (oversized) break;
    }
    if (oversized) { records.push({ commit, status: 'skipped-byte-budget' }); continue; }
    const result = analyze(before, after);
    records.push({ commit, parent: parents[1], paths, ...result,
      matches: result.matches.filter(m => m.pathChanged || m.nameChanged || !m.rawEqual || !m.declarationSyntaxEqual),
      allMatches: result.matches.length });
  }
  return { version: 'symbol-probe-v0', typescript: ts.version, head, limit,
    policy: { maxFiles: 80, maxBlobBytes: 1048576, maxCommitBytes: 4194304 }, records };
}
module.exports = { inventory, analyze };
if (require.main === module) {
  const [repo, ref = 'HEAD', count = '60'] = process.argv.slice(2);
  if (!repo || !/^\d+$/.test(count) || Number(count) < 1 || Number(count) > 1000) {
    throw new Error('Usage: node symbol-probe.js <repo> [ref] [1..1000 commits]');
  }
  console.log(JSON.stringify(history(repo, ref, Number(count)), null, 2));
}
