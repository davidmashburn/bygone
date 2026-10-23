const test = require('node:test');
const assert = require('node:assert/strict');
const { inventorySnapshot, matchStrand, inputProblem, LIMITS } = require('..');

test('package consumes source maps without Bygone or Git', () => {
    const before = { 'old.js': 'function total(rows) { return rows.length + 1; }' };
    const after = { 'new.js': 'function count(rows) { return rows.length + 2; }' };
    assert.equal(inputProblem(before, after, LIMITS), null);
    const inventories = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
    const result = matchStrand(before, after, inventories);
    assert.equal(result.status, 'complete');
    assert.equal(result.mappers.length, 1);
    assert.equal(result.mappers[0].source.name, 'total');
    assert.equal(result.mappers[0].destination.name, 'count');
});

test('public inventory rejects invalid maps and enforces input ceilings before parsing', () => {
    for (const files of [null, [], { 'a.js': null }]) assert.throws(() => inventorySnapshot(files, 'before'), TypeError);
    const files = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`${i}.js`, 'function value() {}']));
    assert.throws(() => inventorySnapshot(files, 'before'), /file-budget/);
    assert.equal(inputProblem(files, {}, { ...LIMITS, maxFiles: 1000 }), 'file-budget');
    assert.throws(() => inventorySnapshot({ 'a.js': 'é'.repeat(LIMITS.maxFileBytes / 2 + 1) }, 'before'), /file-byte-budget/);
    const total = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`${i}.js`, ' '.repeat(LIMITS.maxFileBytes)]));
    assert.throws(() => inventorySnapshot(total, 'before'), /comparison-byte-budget/);
});

test('public matcher enforces combined snapshot input budgets', () => {
    const files = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`${i}.js`, ' '.repeat(LIMITS.maxFileBytes)]));
    const result = matchStrand(files, files, { before: { entries: [] }, after: { entries: [] } }, { maxBytes: 100000000 });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'comparison-byte-budget');
});
