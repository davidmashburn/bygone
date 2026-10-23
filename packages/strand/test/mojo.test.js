const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');
const pairs = analysis => analysis.relations.map(r => [
    analysis.inventories.before.entries.find(e => e.id === r.sourceId).qualifiedName,
    analysis.inventories.after.entries.find(e => e.id === r.destinationId).qualifiedName
]);
const code = 'def price(items: List[Int]) -> Int:\n    var total = 0\n    for item in items:\n        total += item * 9 + 1\n    return total\n';

test('Mojo edited moves and renames use the shared Strand matcher', () => {
    const { analysis } = analyzeStrand({ 'a.mojo': code }, { 'b.🔥': code.replace('price(', 'cost(').replace('+ 1', '+ 2') });
    assert.equal(analysis.status, 'complete');
    assert.deepEqual(pairs(analysis), [['price', 'cost']]);
    assert(analysis.relations[0].producers.includes('bygone-strand'));
    assert.equal(analysis.relations[0].rawEqual, false);
});

test('Mojo inventories decorated generic structs, traits, methods, aliases and bindings with Unicode CRLF ranges', () => {
    const text = '# 😀\r\n@value\r\nstruct Box[T: AnyType]:\r\n    var name: String\r\n    def cost(self, x: Int) -> Int:\r\n        return x * 2 + 1\r\ntrait Priced:\r\n    def price(self) -> Int:\r\n        pass\r\nalias Count = Int\r\ncomptime LIMIT = 9\r\n';
    const inv = inventorySnapshot({ 'a.mojo': text }, 'before', { strandFeatures: true });
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => [e.qualifiedName, e.kind]), [['Box', 'class'], ['Box.name', 'property'], ['Box.cost', 'method'], ['Priced', 'interface'], ['Priced.price', 'method'], ['Count', 'type'], ['LIMIT', 'variable']]);
    assert(text.slice(inv.entries[0].start).startsWith('@value'));
    for (const entry of inv.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
        assert.equal(entry.endLine, text.slice(0, entry.end - 1).split('\n').length);
    }
});

test('Mojo parent moves retain nested method scope and reject unrelated owners', () => {
    const old = 'struct Box:\n    def price(self, x: Int) -> Int:\n        return x * 2 + 1\n';
    const next = old.replace('Box', 'Container').replace('+ 1', '+ 2');
    const moved = analyzeStrand({ 'a.mojo': old }, { 'b.mojo': next });
    assert.deepEqual(pairs(moved.analysis), [['Box', 'Container'], ['Box.price', 'Container.price']]);
    const before = 'struct Left:\n    def price(self, x: Int) -> Int:\n        return x * 2 + 1\nstruct Right:\n    pass\n';
    const after = 'struct Left:\n    pass\nstruct Right:\n    def price(self, x: Int) -> Int:\n        return x * 2 + 2\n';
    assert(!pairs(analyzeStrand({ 'a.mojo': before }, { 'a.mojo': after }).analysis).some(([source]) => source === 'Left.price'));
});

test('Mojo invalid syntax and copy ambiguity cannot become confident matches', () => {
    const invalid = analyzeStrand({ 'a.mojo': code }, { 'b.mojo': 'def bad(:\n    return 1\n' });
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    assert.equal(invalid.analysis.relations.length, 0);
    const ambiguous = analyzeStrand({ 'a.mojo': code, 'b.mojo': code }, { 'c.mojo': code, 'd.mojo': code });
    assert.equal(ambiguous.analysis.relations.length, 0);
    assert(ambiguous.native.unresolved.length > 0);
});

test('Mojo reports exclusions for local/computed bindings and grammar recovery syntax', () => {
    const text = 'var a, b = pair()\nclass Unsupported:\n    pass\n' + code;
    const inv = inventorySnapshot({ 'a.mojo': text }, 'before');
    assert.equal(inv.documents[0].status, 'complete');
    assert(inv.exclusions.some(e => e.reason === 'mojo-destructured-or-computed-binding'));
    assert(inv.exclusions.some(e => e.reason === 'mojo-local-bindings'));
    assert(inv.exclusions.some(e => e.reason === 'mojo-class-recovery-syntax'));
});

test('Mojo pinned enum and parameterized alias syntax retains nested ownership', () => {
    const text = '__enum Result[T: Movable]:\n    case success(T)\n    case failure\n    def ready(self) -> Bool:\n        return True\ncomptime Vector[T: AnyType] = List[T]\n';
    const inv = inventorySnapshot({ 'a.mojo': text }, 'before', { strandFeatures: true });
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => [e.qualifiedName, e.kind]), [
        ['Result', 'enum'], ['Result.success', 'property'], ['Result.failure', 'property'],
        ['Result.ready', 'method'], ['Vector', 'type']
    ]);
});
