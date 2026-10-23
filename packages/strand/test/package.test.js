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
