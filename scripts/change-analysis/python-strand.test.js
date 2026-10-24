const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeStrand, ENGINE } = require('./run-javascript-mappings');
const { correspondenceFixture } = require('../../test/correspondenceFixture');
const { analyzeGit } = require('./analyze-git');
const { importChangeCorrespondence, validateChangeCorrespondence, loadChangeCorrespondence } = require('../../out/changeCorrespondence');

const body = 'def price(items):\n    return [item.cost + 1 for item in items]\n';
const pairs = analysis => analysis.relations.map(r => [
    analysis.inventories.before.entries.find(e => e.id === r.sourceId).qualifiedName,
    analysis.inventories.after.entries.find(e => e.id === r.destinationId).qualifiedName
]);

test('Strand Python Git artifacts preserve decorated async Unicode/CRLF edited moves on reload', () => {
    const code = '# 😀\r\n@(\r\n    register("π")\r\n)\r\nasync def price(items):\r\n    return [item.cost + 1 for item in items]  # final 😀\r\n    # suite comment\r\n';
    const next = code.replace('price(', 'cost(').replace('+ 1', '* 2');
    const f = correspondenceFixture({ before: { 'a.py': code }, after: { 'b.py': next } });
    try {
        fs.writeFileSync(path.join(f.root, 'b.py'), 'dirty worktree');
        const file = path.join(f.root, 'analysis.json');
        const artifact = analyzeGit(['--base', f.range.baseOid, '--output', file, '--engine', ENGINE.producer],
            f.root, { write() {} }, { MAPPING_JAVA: '/missing/java' });
        const loaded = loadChangeCorrespondence(f.root, file, f.range);
        assert.deepEqual(loaded, artifact);
        assert.equal(loaded.status, 'complete');
        assert.equal(loaded.relations.length, 1);
        assert(loaded.relations[0].producers.includes(ENGINE.producer));
        assert.equal(loaded.relations[0].nameChanged, true);
        assert.equal(loaded.relations[0].rawEqual, false);
        assert.equal(loaded.relations[0].localDiff.filter(p => !p.removed).map(p => p.value).join(''), next.slice(next.indexOf('@')).trimEnd());
        assert(loaded.limitations.some(l => l.includes('Python features SHA-256')));
        assert(!JSON.stringify(loaded).includes('strandFeatures'));
    } finally { f.dispose(); }
});

test('Strand matches Python classes, decorated methods and nested functions through immediate parents', () => {
    const code = '@register\nclass Box:\n    @staticmethod\n    def price(items):\n        def inner(value):\n            return value + 1\n        return [inner(item.cost) for item in items]\n';
    const result = analyzeStrand({ 'a.py': code }, { 'b.py': code.replace('Box', 'Container').replace('+ 1', '+ 2') });
    assert.equal(result.analysis.status, 'complete');
    assert.deepEqual(pairs(result.analysis), [['Box', 'Container'], ['Box.price', 'Container.price'], ['Box.price.inner', 'Container.price.inner']]);
    assert(result.analysis.relations.every(r => !r.rawEqual));
    const moved = 'def outer():\n    def left():\n        def inner(items):\n            return [item.cost + 1 for item in items]\n    def right():\n        pass\n';
    const after = 'def outer():\n    def left():\n        pass\n    def right():\n        def renamed(items):\n            return [item.cost + 2 for item in items]\n';
    const blocked = analyzeStrand({ 'a.py': moved }, { 'a.py': after });
    assert(!pairs(blocked.analysis).some(([a]) => a.endsWith('.inner')));
});

test('Python retained origins remain competitors and ambiguity survives artifact reload', () => {
    const before = { 'a.py': body, 'b.py': body };
    const after = { 'a.py': body, 'c.py': body.replace('price', 'copied_price') };
    const result = analyzeStrand(before, after), { analysis } = result;
    const retained = analysis.inventories.before.entries.find(e => e.path === 'a.py');
    assert(analysis.relations.some(r => r.sourceId === retained.id));
    const group = analysis.unresolved.find(g => g.reason === 'ambiguous-python-candidates');
    assert(group);
    assert(!group.sources.includes(retained.id));
    assert(group.competingSources.includes(retained.id));
    assert(!pairs(analysis).some(([, b]) => b === 'copied_price'));
    const f = correspondenceFixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(f.root, result, f.range);
        const loaded = validateChangeCorrespondence(f.root, JSON.parse(JSON.stringify(artifact)), f.range);
        assert.deepEqual(loaded, artifact);
        assert(loaded.diagnostics.records.some(d => d.reason === group.reason && d.locations.some(l => l.symbolId === retained.id)));
    } finally { f.dispose(); }
});

test('Python duplicate parents and trivial cross-file coincidences stay unmatched', () => {
    const code = 'def outer():\n    def inner(items):\n        return [item.cost + 1 for item in items]\n';
    const duplicate = analyzeStrand({ 'a.py': code + code }, { 'b.py': (code + code).replaceAll('outer', 'renamed') });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.analysis.unresolved.some(g => g.reason === 'ambiguous-python-candidates'));
    const distinct = 'def outer():\n    def left(items):\n        return [item.cost + 1 for item in items]\n'
        + 'def outer():\n    def right(items):\n        return {item.name: item.cost * 2 for item in items}\n';
    const distinctDuplicate = analyzeStrand({ 'a.py': distinct }, {
        'b.py': distinct.replaceAll('outer', 'renamed').replace('+ 1', '+ 3').replace('* 2', '* 4')
    });
    assert(distinctDuplicate.native.mappers.every(m => m.source.name === 'outer'));
    assert(pairs(distinctDuplicate.analysis).every(([name]) => !name.includes('.')));
    const trivial = analyzeStrand({ 'a.py': 'def old():\n    return 1\n' }, { 'b.py': 'def new():\n    return 1\n' });
    assert.equal(trivial.analysis.relations.length, 0);
});

test('Python parse, runtime and search-budget failures cannot promote edited inferred pairs', () => {
    const before = { 'a.py': body }, after = { 'b.py': body.replace('+ 1', '+ 2') };
    for (const result of [analyzeStrand(before, { 'b.py': 'def price(:\n    return 2\n' }),
        analyzeStrand(before, after, { python: '/missing/python' }),
        analyzeStrand(before, after, { limits: { maxTokensPerSymbol: 2 } }),
        analyzeStrand({ 'a.py': body + body.replace('price', 'other') }, after, { limits: { maxCandidates: 1 } })]) {
        assert.notEqual(result.analysis.status, 'complete');
        assert.equal(result.analysis.relations.filter(r => !r.rawEqual).length, 0);
    }
});

test('Python stubs keep exact-only partial coverage without suppressing complete implementation pairs', () => {
    const stub = 'def price(items: list) -> list: ...\n';
    const before = { 'a.py': body, 'types.pyi': stub };
    const after = { 'b.py': body.replace('price', 'cost').replace('+ 1', '+ 2'), 'types.pyi': stub };
    const result = analyzeStrand(before, after);
    assert.equal(result.analysis.status, 'partial');
    assert.deepEqual(pairs(result.analysis), [['price', 'cost'], ['price', 'price']]);
    assert(result.analysis.issues.some(d => d.reason === 'engine-skipped-document' && d.path === 'types.pyi'));
    const f = correspondenceFixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(f.root, result, f.range);
        const loaded = validateChangeCorrespondence(f.root, JSON.parse(JSON.stringify(artifact)), f.range);
        assert.equal(loaded.relations.length, 2);
        assert(loaded.relations.some(r => r.coverage === 'complete' && !r.rawEqual));
    } finally { f.dispose(); }
    const editedStub = analyzeStrand({ 'types.pyi': stub }, { 'types.pyi': stub.replace('list', 'tuple') });
    assert.equal(editedStub.analysis.relations.length, 0);
    assert.notEqual(editedStub.analysis.status, 'complete');
});

test('Strand keeps JS and Python candidate domains separate in mixed comparisons', () => {
    const before = { 'a.js': 'function price(items) { return items.map(item => item.cost + 1); }', 'a.py': body };
    const after = { 'b.js': before['a.js'].replace('price', 'cost').replace('+ 1', '+ 2'), 'b.py': body.replace('price', 'cost').replace('+ 1', '+ 2') };
    const { analysis } = analyzeStrand(before, after);
    assert.equal(analysis.status, 'complete');
    assert.equal(analysis.relations.length, 2);
    for (const r of analysis.relations) {
        const a = analysis.inventories.before.entries.find(e => e.id === r.sourceId);
        const b = analysis.inventories.after.entries.find(e => e.id === r.destinationId);
        assert.equal(path.extname(a.path), path.extname(b.path));
    }
});

test('Python decorator-only edits retain changed bytes and compound-suite declarations', () => {
    const code = 'if enabled:\n    @register("one")\n    def price(items):\n        return [item.cost + 1 for item in items]\n';
    const { analysis } = analyzeStrand({ 'a.py': code }, { 'a.py': code.replace('"one"', '"two"') });
    assert.equal(analysis.relations.length, 1);
    assert.equal(analysis.relations[0].rawEqual, false);
    assert(analysis.relations[0].localDiff.some(p => p.added && p.value.includes('two')));
});
