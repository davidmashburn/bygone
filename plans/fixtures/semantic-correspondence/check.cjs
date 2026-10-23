// Research fixture checker, not a product matcher or public artifact format.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(process.argv[2] || process.cwd());
const ts = createRequire(path.join(repo, 'package.json'))('typescript');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function inventory(files, side) {
    const entries = [], exclusions = [];
    for (const [file, text] of Object.entries(files)) {
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
        if (source.parseDiagnostics.length) {
            exclusions.push(`${side}:${file}:parse-error`);
            continue;
        }
        for (const node of source.statements) {
            let name, kind;
            if (ts.isFunctionDeclaration(node)) {
                if (!node.name || !node.body) {
                    exclusions.push(`${side}:${file}:unnamed-or-bodyless-function`);
                    continue;
                }
                name = node.name; kind = 'function';
            } else if (ts.isVariableStatement(node)) {
                const declarations = node.declarationList.declarations;
                const functions = declarations.filter(d => d.initializer &&
                    (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
                if (!functions.length) continue;
                if (declarations.length !== 1 || !ts.isIdentifier(functions[0].name) ||
                    !ts.isArrowFunction(functions[0].initializer)) {
                    exclusions.push(`${side}:${file}:unsupported-function-variable`);
                    continue;
                }
                name = functions[0].name; kind = 'arrow';
            } else {
                if (ts.isClassDeclaration(node)) exclusions.push(`${side}:${file}:class`);
                if (ts.isExportAssignment(node)) exclusions.push(`${side}:${file}:anonymous-default`);
                if (ts.isModuleDeclaration(node)) exclusions.push(`${side}:${file}:namespace`);
                continue;
            }
            const start = node.getStart(source), end = node.end;
            const transformed = ts.transform(node, [context => {
                const visit = current => current === name
                    ? ts.factory.createIdentifier('__DECLARATION_NAME__')
                    : ts.visitEachChild(current, visit, context);
                return current => ts.visitNode(current, visit);
            }]);
            const syntax = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source);
            transformed.dispose();
            entries.push({ side, path: file, name: name.text, kind,
                utf16: [start, end],
                bytes: [Buffer.byteLength(text.slice(0, start)), Buffer.byteLength(text.slice(0, end))],
                lines: [source.getLineAndCharacterOfPosition(start).line + 1,
                    source.getLineAndCharacterOfPosition(end).line + 1],
                declaration: text.slice(start, end), syntaxHash: sha(syntax) });
        }
    }
    return { entries, exclusions: exclusions.sort() };
}

function compare(before, after) {
    const b = inventory(before, 'before'), a = inventory(after, 'after');
    const groups = new Map();
    // Keep retained occurrences in the buckets: local pairing cannot create uniqueness.
    for (const entry of [...b.entries, ...a.entries]) {
        const group = groups.get(entry.syntaxHash) || { before: [], after: [] };
        group[entry.side].push(entry);
        groups.set(entry.syntaxHash, group);
    }
    const exact = [], ambiguous = [];
    const endpoint = entry => `${entry.path}#${entry.name}`;
    for (const [syntaxHash, group] of groups) {
        if (!group.before.length || !group.after.length) continue;
        if (group.before.length === 1 && group.after.length === 1) {
            const [old] = group.before, [next] = group.after;
            if (old.path !== next.path) exact.push({
                endpoints: [endpoint(old), endpoint(next)], syntaxHash,
                declarationBytesEqual: old.declaration === next.declaration,
                behavior: 'unassessed'
            });
        } else {
            ambiguous.push({ syntaxHash, before: group.before.map(endpoint), after: group.after.map(endpoint) });
        }
    }
    return { before: b.entries, after: a.entries, exclusions: [...b.exclusions, ...a.exclusions].sort(),
        exact: exact.sort((x, y) => x.endpoints.join().localeCompare(y.endpoints.join())), ambiguous };
}

const controlsText = read('controls.json');
const controls = JSON.parse(controlsText);
const controlResults = controls.cases.map(control => {
    const result = compare(control.before, control.after);
    const actual = [...result.before, ...result.after].map(({ syntaxHash, ...entry }) => entry);
    assert.deepEqual(actual, control.expectedInventory, `${control.id}: inventory/ranges`);
    assert.deepEqual(result.exclusions, [...control.expectedUnsupported].sort(), `${control.id}: exclusions`);
    const emitted = new Set(result.exact.map(x => JSON.stringify(x.endpoints)));
    const expected = new Set(control.expectedExactPairs.map(x => JSON.stringify(x)));
    const falseLinks = [...emitted].filter(pair => !expected.has(pair));
    const missed = [...expected].filter(pair => !emitted.has(pair)).map(pair => JSON.parse(pair));
    assert.equal(falseLinks.length, 0, `${control.id}: false automatic links`);
    return { id: control.id, declarations: actual.length, exact: result.exact,
        missedExactRelationships: missed, falseLinks: falseLinks.length,
        ambiguousGroups: result.ambiguous.length, exclusions: result.exclusions, checks: 'passed' };
});

const historicalText = read('history.json');
const historical = JSON.parse(historicalText);
assert.equal(git(['rev-parse', `${historical.head}^`]).trim(), historical.base);
const changedPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', historical.head])
    .trim().split('\n').filter(file => /\.[cm]?[jt]sx?$/.test(file));
const snapshots = {};
for (const [side, revision] of [['before', historical.base], ['after', historical.head]]) {
    const files = {};
    // A missing path is allowed only when it is absent from the pinned tree.
    const tracked = new Set(git(['ls-tree', '-r', '--name-only', revision]).trim().split('\n'));
    for (const file of changedPaths) if (tracked.has(file)) files[file] = git(['show', `${revision}:${file}`]);
    snapshots[side] = files;
}
const result = compare(snapshots.before, snapshots.after);
assert.deepEqual(result.exact.map(x => x.endpoints).sort(), [...historical.expectedExactPairs].sort());
for (const label of historical.expectedEndpoints) {
    const actual = result[label.side].find(x => x.path === label.path && x.name === label.name);
    assert(actual, `${label.path}#${label.name}`);
    assert.deepEqual(actual.lines, label.lines);
    assert.equal(sha(actual.declaration), label.declarationSha256);
}
for (const label of historical.expectedAmbiguities) {
    assert(result.ambiguous.some(group =>
        JSON.stringify([...group.before].sort()) === JSON.stringify([...label.before].sort()) &&
        JSON.stringify([...group.after].sort()) === JSON.stringify([...label.after].sort())), label.name);
}
console.log(JSON.stringify({
    format: 'bygone-research-observation-v1',
    runtime: { node: process.version, typescript: ts.version, platform: process.platform, architecture: process.arch },
    inputs: { controlsSha256: sha(controlsText), historySha256: sha(historicalText), checkerSha256: sha(read('check.cjs')) },
    controls: controlResults,
    historical: { base: historical.base, head: historical.head, sourceFiles: changedPaths.length,
        beforeOccurrences: result.before.length, afterOccurrences: result.after.length,
        exact: result.exact, ambiguous: result.ambiguous, exclusions: result.exclusions,
        files: Object.fromEntries(Object.entries(snapshots).map(([side, files]) =>
            [side, Object.fromEntries(Object.entries(files).map(([file, text]) => [file, sha(text)]))])) },
    limitations: ['Development controls, not held-out data.', 'One selected historical comparison, not a representative sample.',
        'Only supported top-level declarations are inventoried.', 'No bindings, operation history, or behavior analysis.',
        'Syntax equality excludes the declaration name and comments, and preserves literal token spelling.',
        'No candidate-engine accuracy, latency, memory, or reviewer-benefit measurements.']
}, null, 2));
