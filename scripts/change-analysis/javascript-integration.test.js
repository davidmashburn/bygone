const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeJavaScript, ENGINE } = require('./run-javascript-mappings');
const { correspondenceFixture } = require('../../test/correspondenceFixture');
const { analyzeGit, parseArgs } = require('./analyze-git');
const { importChangeCorrespondence, validateChangeCorrespondence, loadChangeCorrespondence } = require('../../out/changeCorrespondence');

test('JS engine Git artifact uses committed bytes, preserves edited move diff and reloads', () => {
    const code = '/* 😀 */\r\nexport function price(items) { return items.reduce((sum, item) => sum + item.cost, 0); }\r\n';
    const next = code.replace('price(', 'cost(').replace('item.cost', 'item.cost * 1.2');
    const f = correspondenceFixture({ before: { 'a.ts': code }, after: { 'b.ts': next } });
    try {
        fs.writeFileSync(path.join(f.root, 'b.ts'), 'dirty worktree');
        const file = path.join(f.root, 'analysis.json');
        let message = '';
        const artifact = analyzeGit(['--base', f.range.baseOid, '--output', file, '--engine', ENGINE.producer],
            f.root, { write(text) { message += text; } }, { MAPPING_JAVA: '/missing/java' });
        const loaded = loadChangeCorrespondence(f.root, file, f.range);
        assert.equal(loaded.producer, `${ENGINE.name} correspondence engine v1`);
        assert.equal(loaded.status, 'complete');
        assert.equal(loaded.relations.length, 1);
        assert.deepEqual(loaded, artifact);
        assert(loaded.relations[0].producers.includes(ENGINE.producer));
        assert.equal(loaded.relations[0].nameChanged, true);
        assert.equal(loaded.relations[0].rawEqual, false);
        assert.equal(loaded.relations[0].localDiff.filter(p => !p.removed).map(p => p.value).join(''), next.trim().slice(next.indexOf('export')));
        assert.match(message, /behavior unassessed/);
        assert(!message.includes('Exact-only coverage'));
    } finally { f.dispose(); }
});

test('Strand mixed-language coverage preserves both JS and Python edits through the consumer', () => {
    const code = 'export function price(items) { return items.reduce((sum, item) => sum + item.cost, 0); }';
    const before = { 'a.ts': code, 'b.py': 'def price(n):\n    return n + 1\n' };
    const after = { 'a.ts': code.replace('item.cost', 'item.cost * 1.2'), 'b.py': 'def price(n):\n    return n + 2\n' };
    const f = correspondenceFixture({ before, after });
    try {
        const result = analyzeJavaScript(before, after);
        assert.equal(result.analysis.status, 'complete');
        const artifact = importChangeCorrespondence(f.root, result, f.range);
        const loaded = validateChangeCorrespondence(f.root, JSON.parse(JSON.stringify(artifact)), f.range);
        assert.equal(loaded.relations.length, 2);
        assert.equal(loaded.status, 'complete');
        assert(loaded.symbols.before.find(s => s.id === loaded.relations[0].sourceId).path.endsWith('.ts'));
        assert(!loaded.diagnostics.records.some(d => d.reason === 'engine-skipped-document'));
    } finally { f.dispose(); }
});

test('JS engine malformed input and resource exhaustion never promote inferred edited pairs', () => {
    const code = 'function price(items) { return items.map(item => item.cost); }';
    for (const result of [analyzeJavaScript({ 'a.js': code }, { 'a.js': 'function price( {' }),
        analyzeJavaScript({ 'a.js': code + '\n' + code.replace('price(', 'cost(') },
            { 'b.js': code.replace('item.cost', 'item.price') + '\n' + code.replace('price(', 'cost(') },
            { limits: { maxCandidates: 1 } })]) {
        assert.notEqual(result.analysis.status, 'complete');
        assert.equal(result.analysis.relations.filter(r => !r.rawEqual).length, 0);
    }
    assert.equal(analyzeJavaScript([], {}).analysis.reason, 'invalid-snapshot-map');
    assert.equal(analyzeJavaScript({}, {}, { limits: { timeoutMs: 0 } }).analysis.reason, 'invalid-limits');
});

test('engine selection rejects conflicting, unknown and repeated flags', () => {
    const args = ['--base', 'main', '--output', 'new.json'];
    for (const extra of [['--engine', 'unknown'], ['--engine', ENGINE.producer, '--exact-only'],
        ['--engine', ENGINE.producer, '--java', 'java'], ['--engine', ENGINE.producer, '--engine', ENGINE.producer]]) {
        assert.throws(() => parseArgs([...args, ...extra]));
    }
});

test('retained continuations stay outside unresolved copy endpoints', () => {
    const code = 'function helper(items) { return items.map(item => item.value + 1).filter(Boolean); }';
    const before = { 'a.js': code, 'b.js': code };
    const after = { 'a.js': code, 'c.js': code.replace('helper', 'copiedHelper') };
    const result = analyzeJavaScript(before, after), { analysis } = result;
    const retained = analysis.inventories.before.entries.find(e => e.path === 'a.js');
    assert(analysis.relations.some(r => r.sourceId === retained.id));
    const ambiguity = analysis.unresolved.find(g => g.reason === 'ambiguous-js-candidates');
    assert(ambiguity);
    assert(!ambiguity.sources.includes(retained.id));
    assert(ambiguity.competingSources.includes(retained.id));
    const f = correspondenceFixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(f.root, result, f.range);
        const loaded = validateChangeCorrespondence(f.root, JSON.parse(JSON.stringify(artifact)), f.range);
        const diagnostic = loaded.diagnostics.records.find(d => d.reason === 'ambiguous-js-candidates');
        assert(diagnostic.locations.some(l => l.symbolId === retained.id && l.side === 'before'));
        assert.deepEqual(loaded, artifact);
    } finally { f.dispose(); }
});

test('direct JS engine records unsupported documents as partial coverage', () => {
    const code = 'function price(items) { return items.map(item => item.cost); }';
    const before = { 'a.js': code, 'README.md': 'Before' };
    const after = { 'a.js': code.replace('item.cost', 'item.cost * 1.2'), 'README.md': 'After' };
    const result = analyzeJavaScript(before, after);
    assert.equal(result.analysis.status, 'partial');
    assert(result.analysis.issues.some(d => d.reason === 'engine-skipped-document' && d.path === 'README.md'));
    const f = correspondenceFixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(f.root, result, f.range);
        const loaded = validateChangeCorrespondence(f.root, JSON.parse(JSON.stringify(artifact)), f.range);
        assert.equal(loaded.status, 'partial');
        assert.equal(loaded.relations.length, 1);
        assert.equal(loaded.relations[0].coverage, 'complete');
        assert(loaded.diagnostics.records.some(d => d.reason === 'unsupported-language'));
    } finally { f.dispose(); }
});
