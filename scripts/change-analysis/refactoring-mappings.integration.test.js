const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileBridge, analyzeWithBridge } = require('./run-refactoring-mappings');
const config = compileBridge({ java: process.env.MAPPING_JAVA, jar: process.env.MAPPING_JAR, expectedJarSha256: process.env.MAPPING_JAR_SHA256 });
test.after(() => fs.rmSync(config.buildDir, { recursive: true, force: true }));
const code = 'export function price(n) { return n + 1; }\n';
const next = code.replace('+ 1', '+ 2');
const before = { 'a.ts': code + 'export function anchorA() { return "source"; }' , 'b.ts': 'export function anchorB() { return 991; }' };
const after = { 'a.ts': 'export function anchorA() { return "source"; }', 'b.ts': next + 'export function anchorB() { return 991; }' };

test('actual JVM timeout preserves inventory and returns an explicit failure', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { timeoutMs: 1 } });
    assert.equal(result.native.reason, 'engine-timeout');
    assert.equal(result.analysis.status, 'partial');
    assert(result.analysis.inventories.before.entries.length > 0);
    assert(result.analysis.relations.every(r => !r.producers.includes('refactoring-miner')));
});

test('export budget marks partial evidence rather than promoting candidates', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { maxRecords: 1 } });
    assert.equal(result.native.status, 'partial'); assert.equal(result.native.truncated, true);
    assert.equal(result.analysis.status, 'partial');
    assert(result.analysis.relations.every(r => !r.producers.includes('refactoring-miner') || r.producers.includes('exact-declaration')));
});

test('bounded stdout overflow preserves independent inventory', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { maxOutputBytes: 128 } });
    assert.equal(result.native.status, 'unavailable');
    assert.equal(result.native.reason, 'engine-process: ENOBUFS');
    assert.equal(result.analysis.inventories.after.documents.length, 2);
});

test('actual engine arrow statement ranges bind edited JS declarations', () => {
    const before = { 'a.js': 'export const price = n => n + 1;\n' };
    const after = { 'a.js': 'export const price = n => n + 2;\n' };
    const result = analyzeWithBridge(before, after, config);
    assert.equal(result.analysis.status, 'complete');
    assert.equal(result.analysis.relations.length, 1);
    const r = result.analysis.relations[0];
    assert(r.producers.includes('refactoring-miner'));
    assert.equal(r.rawEqual, false);
    assert(r.localDiff.some(p => p.added && p.value.includes('+ 2')));
});

test('real module rewrite retains the removed assessment validation as visible evidence', () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../test/fixtures/correspondence-module-split.json')));
    const result = analyzeWithBridge(fixture.before, fixture.after, config);
    const a = result.analysis;
    const entries = new Map([...a.inventories.before.entries, ...a.inventories.after.entries].map(e => [e.id, e]));
    const moved = a.relations.filter(r => r.pathChanged && entries.get(r.sourceId).callable && r.producers.includes('refactoring-miner'));
    assert.equal(moved.length, 6);
    const r = moved.find(r => entries.get(r.sourceId).name === 'validateChangeTourDetails');
    assert(r); assert.equal(r.rawEqual, false); assert.equal(r.behavior, 'unassessed');
    const removed = r.localDiff.filter(p => p.removed).map(p => p.value).join('');
    assert(removed.includes('validateAssessment(value.assessment'));
    assert(r.evidence.some(e => e.unmappedBefore.some(s => s.text.includes('validateAssessment(value.assessment'))));
});

test('native local duplicate-body edits survive unchanged omissions through artifact reload', () => {
    const next = code.replace('+ 1', '+ 2');
    const before = { 'a.ts': code, 'b.ts': code, 'c.ts': next, 'd.ts': next };
    const after = { 'a.ts': code, 'b.ts': next, 'c.ts': code, 'd.ts': next };
    const analysis = analyzeWithBridge(before, after, config).analysis;
    assert.equal(analysis.status, 'partial');
    assert.equal(analysis.relations.length, 4);
    const { correspondenceFixture } = require('../../test/correspondenceFixture');
    const { importChangeCorrespondence, validateChangeCorrespondence } = require('../../out/changeCorrespondence');
    const fixture = correspondenceFixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(fixture.root, { analysis }, fixture.range);
        const loaded = validateChangeCorrespondence(fixture.root, JSON.parse(JSON.stringify(artifact)), fixture.range);
        assert.equal(loaded.status, 'partial');
        assert.equal(loaded.relations.length, 4);
        assert.equal(loaded.relations.filter(relation => !relation.rawEqual && relation.coverage === 'complete').length, 2);
    } finally { fixture.dispose(); }
});

test('native registration fragments cannot claim newly inventoried registration containers', () => {
    const fixture = require('./benchmark/frozen-js-ts.json').cases.find(c => c.id === 'mixed-08');
    const result = analyzeWithBridge(fixture.before, fixture.after, config);
    for (const side of ['before', 'after']) {
        const registration = result.analysis.inventories[side].entries.find(entry => entry.name === 'Query');
        assert(registration);
        assert(result.analysis[side === 'before' ? 'unmatchedBefore' : 'unmatchedAfter'].includes(registration.id));
    }
    assert.equal(result.native.status, 'complete');
});


test('Git command generates a fresh pinned artifact accepted by the feature consumer', () => {
    const { correspondenceFixture } = require('../../test/correspondenceFixture');
    const { analyzeGit } = require('./analyze-git');
    const { loadChangeCorrespondence } = require('../../out/changeCorrespondence');
    const fixture = correspondenceFixture();
    const file = path.join(fixture.root, 'generated.json');
    try {
        const args = [fixture.range.headOid, '--base', fixture.range.baseOid, '--output', file,
            '--repo', fixture.root, '--java', config.java, '--jar', config.jar, '--jar-sha256', config.jarSha256];
        analyzeGit(args, fixture.root, { write() {} });
        const artifact = loadChangeCorrespondence(fixture.root, file, fixture.range);
        const moved = artifact.relations.filter(r => r.pathChanged && artifact.symbols.before.find(s => s.id === r.sourceId).kind === 'function');
        assert.equal(moved.length, 6);
        const changed = moved.find(r => artifact.symbols.before.find(s => s.id === r.sourceId).name === 'validateChangeTourDetails');
        assert(changed.localDiff.some(p => p.removed && p.value.includes('validateAssessment(value.assessment')));
        assert(artifact.limitations.some(s => s.includes(config.jarSha256)));
        assert.throws(() => analyzeGit(args, fixture.root, { write() {} }), /EEXIST/);
        assert.throws(() => analyzeGit([...args.slice(0, -1), '0'.repeat(64)], fixture.root, { write() {} }), /digest-mismatch/);
    } finally { fixture.dispose(); }
});

test('native Python decorated async ranges preserve CRLF, Unicode and terminal comments', () => {
    const code = '# 😀\r\n@(\r\n    register("π")\r\n)\r\nasync def price(n):\r\n    return n + 1  # final 😀\r\n    # suite comment\r\n';
    const result = analyzeWithBridge({ 'a.py': code }, { 'a.py': code.replace('+ 1', '+ 2') }, config);
    assert.equal(result.native.status, 'complete'); assert.equal(result.analysis.status, 'complete');
    assert.equal(result.analysis.relations.length, 1);
    const a = result.analysis, r = a.relations[0];
    assert(r.producers.includes('refactoring-miner')); assert.equal(r.rawEqual, false);
    const slice = r.localDiff.filter(p => !p.added).map(p => p.value).join('');
    assert.equal(slice, code.slice(code.indexOf('@('), -2));
    assert(slice.includes('# suite comment')); assert(slice.includes('register("π")'));
    assert(a.rejected.every(r => r.source.name.endsWith('__module__')));
});

test('native Python matches edited moves and renames without claiming additions', () => {
    for (const rename of [false, true]) {
        const code = 'def price(n):\n    return n + 1\n';
        const result = analyzeWithBridge({ 'a.py': code }, { 'b.py': code.replace('+ 1', '+ 2').replace('price', rename ? 'cost' : 'price') + '\ndef added():\n    return 91\n' }, config);
        const a = result.analysis, r = a.relations.find(r => a.inventories.before.entries.find(e => e.id === r.sourceId).name === 'price');
        assert(r); assert.equal(r.pathChanged, true); assert.equal(r.nameChanged, rename);
        assert.equal(r.rawEqual, false); assert(r.producers.includes('refactoring-miner'));
        assert(a.unmatchedAfter.some(id => a.inventories.after.entries.find(e => e.id === id).name === 'added'));
    }
});

test('native Python classes and nested methods keep full decorated slices', () => {
    const code = '@register\nclass Box:\n    @staticmethod\n    def price(n):\n        def inner():\n            return 1\n        return n + 1\n    # class comment\n';
    const a = analyzeWithBridge({ 'a.py': code }, { 'a.py': code.replace('+ 1', '+ 2') }, config).analysis;
    assert.equal(a.status, 'complete');
    for (const name of ['Box', 'Box.price', 'Box.price.inner']) {
        const entry = a.inventories.before.entries.find(e => e.qualifiedName === name);
        assert(entry); assert(a.relations.some(r => r.sourceId === entry.id));
    }
    const box = a.inventories.before.entries.find(e => e.name === 'Box');
    assert.equal(code.slice(box.start, box.end), code.trimEnd());
});

test('Python Git artifacts load with pinned source validation and report stub engine limits', () => {
    const { correspondenceFixture } = require('../../test/correspondenceFixture');
    const { analyzeGit } = require('./analyze-git');
    const { loadChangeCorrespondence } = require('../../out/changeCorrespondence');
    const fixture = correspondenceFixture({ before: { 'a.py': '@register\ndef price(n):\n    return n + 1\n' },
        after: { 'b.py': '@register\ndef cost(n):\n    return n + 2\n', 'types.pyi': 'def cost(n: int) -> int: ...\n' } });
    try {
        const file = path.join(fixture.root, 'python.json');
        fs.writeFileSync(path.join(fixture.root, 'b.py'), 'dirty worktree');
        // Stub coverage stays partial without suppressing a validated match
        // between analyzed implementation declarations.
        const stubbed = analyzeGit([fixture.range.headOid, '--base', fixture.range.baseOid, '--output', file,
            '--repo', fixture.root, '--java', config.java, '--jar', config.jar, '--jar-sha256', config.jarSha256], fixture.root, { write() {} });
        const loaded = loadChangeCorrespondence(fixture.root, file, fixture.range);
        assert.equal(loaded.status, 'partial'); assert.equal(stubbed.status, 'partial');
        assert(loaded.symbols.after.some(s => s.name === 'cost'));
        assert.equal(loaded.relations.length, 1);
        assert.equal(loaded.relations[0].pathChanged, true);
        assert.equal(loaded.relations[0].nameChanged, true);
        assert(loaded.limitations.some(l => l.includes('cpython@')));
        assert(loaded.limitations.some(l => l.includes('producer issues')));
        assert(loaded.limitations.some(l => l.includes('stub declarations accept only independent exact matches')));
    } finally { fixture.dispose(); }
});

test('Python decorator-only edits remain visible even when engine body ranges are equal', () => {
    const code = '@register("one")\ndef price(n):\n    return n + 1\n';
    const a = analyzeWithBridge({ 'a.py': code }, { 'a.py': code.replace('"one"', '"two"') }, config).analysis;
    assert.equal(a.status, 'complete');
    assert.equal(a.relations.length, 1); assert.equal(a.relations[0].rawEqual, false);
    assert(a.relations[0].localDiff.some(p => p.removed && p.value.includes('@register("one")')));
    assert(a.relations[0].localDiff.some(p => p.added && p.value.includes('@register("two")')));
});
