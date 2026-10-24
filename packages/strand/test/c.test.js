const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot, digest } = require('..');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');
const code = 'int price(int *items, int count) { int total = 0; for (int i = 0; i < count; i++) total += items[i] * 9 + 1; return total; }';

test('C edited function moves and renames share Strand evidence', () => {
    const result = analyzeStrand({ 'a.c': code }, { 'b.c': code.replace('price(', 'cost(').replace('+ 1', '+ 2') });
    assert.equal(result.analysis.status, 'complete');
    assert.equal(result.analysis.relations.length, 1);
    assert.equal(result.analysis.inventories.after.entries[0].name, 'cost');
    assert.equal(result.analysis.relations[0].rawEqual, false);
});

test('C named types, fields, aliases, globals and prototypes preserve exact Unicode CRLF ranges', () => {
    const text = '// 😀\r\nstruct Box { int value; };\r\nunion Data { int number; };\r\nenum State { READY = 1 };\r\ntypedef int Count;\r\nint total = 2;\r\nchar *label(int index);\r\n';
    const inv = inventorySnapshot({ 'a.c': text }, 'before', { strandFeatures: true });
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => e.qualifiedName), ['Box', 'Box.value', 'Data', 'Data.number', 'State', 'State.READY', 'Count', 'total', 'label']);
    for (const entry of inv.entries) {
        assert(text.slice(entry.start, entry.end).includes(entry.name));
        assert.equal(entry.digest, digest(text.slice(entry.start, entry.end)));
        assert.equal(entry.startLine, text.slice(0, entry.start).split('\n').length - 1);
    }
});

test('C excludes preprocessor branches, local bindings and complex or multiple declarators', () => {
    const text = '#define RATE 9\n#if ENABLED\nint hidden(int x) { return x; }\n#endif\nint a, b;\nint (*callback)(int);\ntypedef struct { int field; } Record;\n' + code;
    const inv = inventorySnapshot({ 'a.c': text }, 'before');
    assert.equal(inv.documents[0].status, 'complete');
    assert.deepEqual(inv.entries.map(e => e.name), ['Record', 'price']);
    for (const reason of ['c-preprocessor-not-expanded', 'c-multiple-or-anonymous-declarators', 'c-complex-declarator', 'c-local-bindings']) {
        assert(inv.exclusions.some(e => e.reason === reason), reason);
    }
    assert.equal(inventorySnapshot({ 'ambiguous.h': code }, 'before').documents[0].status, 'unsupported');
});

test('C invalid input and duplicate copies cannot become confident relations', () => {
    const invalid = analyzeStrand({ 'a.c': code }, { 'b.c': 'int broken( {' });
    assert.equal(invalid.native.reason, 'parse-preflight-failed');
    assert.equal(invalid.analysis.relations.length, 0);
    const duplicate = analyzeStrand({ 'a.c': code, 'b.c': code }, { 'c.c': code, 'd.c': code });
    assert.equal(duplicate.analysis.relations.length, 0);
    assert(duplicate.native.unresolved.length > 0);
});

test('C fields do not borrow continuations across unrelated type owners', () => {
    const result = analyzeStrand({ 'a.c': 'struct Left { int value; }; struct Right { int other; };' },
        { 'a.c': 'struct Left { int other; }; struct Right { int value; };' });
    const before = result.analysis.inventories.before.entries;
    const after = result.analysis.inventories.after.entries;
    assert(!result.analysis.relations.some(r => before.find(e => e.id === r.sourceId).qualifiedName === 'Left.value'
        && after.find(e => e.id === r.destinationId).qualifiedName === 'Right.value'));
});
