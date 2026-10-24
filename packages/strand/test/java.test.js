const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');
const pairs = analysis => analysis.relations.map(r => [
    analysis.inventories.before.entries.find(e => e.id === r.sourceId).qualifiedName,
    analysis.inventories.after.entries.find(e => e.id === r.destinationId).qualifiedName
]);
const code = 'class Cart { int price(Item[] items) { int total = 0; for (Item item : items) total += item.cost + 1; return total; } }';

test('Java edited class and method moves share Strand evidence', () => {
    const next = code.replace('Cart', 'Basket').replace('price(', 'cost(').replace('+ 1', '* 2');
    const { analysis } = analyzeStrand({ 'a.java': code }, { 'b.java': next });
    assert.equal(analysis.status, 'complete');
    assert.deepEqual(pairs(analysis), [['Cart', 'Basket'], ['Cart.price', 'Basket.cost']]);
    assert(analysis.relations.every(r => r.producers.includes('bygone-strand') && !r.rawEqual));
});

test('Java inventory preserves annotations, records, fields, constructors and Unicode CRLF ranges', () => {
    const text = '// 😀\r\n@Deprecated\r\nrecord Box(String name) {\r\n static final String π = "😀";\r\n Box { if (name == null) throw new IllegalArgumentException(); }\r\n int value() { return π.length(); }\r\n}\r\n';
    const inventory = inventorySnapshot({ 'a.java': text }, 'before', { strandFeatures: true });
    assert.equal(inventory.documents[0].status, 'complete');
    assert.deepEqual(inventory.entries.map(e => [e.qualifiedName, e.kind]), [['Box', 'class'], ['Box.π', 'property'], ['Box.Box', 'constructor'], ['Box.value', 'method']]);
    for (const entry of inventory.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
        assert.equal(entry.engineRanges[0].start, entry.start);
    }
    assert(text.slice(inventory.entries[0].start).startsWith('@Deprecated'));
});

test('Java rejects malformed syntax and reports excluded constructs', () => {
    const invalid = analyzeStrand({ 'a.java': code }, { 'b.java': 'class Cart { int nope( {' });
    assert.equal(invalid.analysis.relations.length, 0);
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    const inv = inventorySnapshot({ 'a.java': 'class Cart { int a, b; void run() { Runnable r = () -> { }; new Object() { void hidden() {} }; } }' }, 'before');
    assert.equal(inv.documents[0].status, 'complete');
    assert(inv.exclusions.some(e => e.reason === 'java-multiple-field-declarators'));
    assert(inv.exclusions.some(e => e.reason === 'java-local-bindings'));
    assert(inv.exclusions.some(e => e.reason === 'java-anonymous-class'));
    assert(!inv.entries.some(e => e.name === 'hidden'));
});

test('Java duplicate copies remain ambiguous and never borrow children across unmatched parents', () => {
    const result = analyzeStrand({ 'a.java': code, 'b.java': code }, { 'c.java': code, 'd.java': code });
    assert.equal(result.analysis.relations.length, 0);
    assert(result.native.unresolved.length > 0);
    const before = { 'a.java': 'class Left { int price(int x) { return x * 9 + 2; } } class Right {}' };
    const after = { 'a.java': 'class Left {} class Right { int price(int x) { return x * 9 + 3; } }' };
    const blocked = analyzeStrand(before, after);
    assert(!pairs(blocked.analysis).some(([source]) => source === 'Left.price'));
});

test('Java Git artifacts reload against committed Unicode sources without Java', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const { correspondenceFixture } = require('../../../test/correspondenceFixture');
    const { analyzeGit } = require('../../../scripts/change-analysis/analyze-git');
    const { loadChangeCorrespondence } = require('../../../out/changeCorrespondence');
    const before = '// 😀\r\n' + code;
    const next = before.replace('price(', 'cost(').replace('+ 1', '+ 2');
    const f = correspondenceFixture({ before: { 'a.java': before }, after: { 'b.java': next } });
    try {
        fs.writeFileSync(path.join(f.root, 'b.java'), 'dirty worktree');
        const file = path.join(f.root, 'analysis.json');
        const artifact = analyzeGit(['--base', f.range.baseOid, '--output', file, '--engine', 'bygone-strand'],
            f.root, { write() {} }, { MAPPING_JAVA: '/missing/java' });
        assert.deepEqual(loadChangeCorrespondence(f.root, file, f.range), artifact);
        assert.equal(artifact.status, 'complete');
        assert.equal(artifact.relations.length, 2);
        assert(!JSON.stringify(artifact).includes('strandFeatures'));
        assert(artifact.limitations.some(l => l.includes('java@')));
    } finally { f.dispose(); }
});
