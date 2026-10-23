const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreCase } = require('./benchmark-correspondence');
const e = (path, name) => ({ path, name });
const a = e('a.js', 'price'), b = e('b.js', 'cost'), added = e('b.js', 'added');
const c = { id: 'scorer', evaluated: { before: [a], after: [b, added] }, expected: [{ source: a, destination: b }] };
const entry = (id, label) => ({ ...label, qualifiedName: label.name, id, start: 0, end: 10 });
function analysis(relations) {
    return { relations, inventories: { before: { entries: [entry('a', a)] }, after: { entries: [entry('b', b), entry('added', added)] } } };
}
test('a wrong guess counts as both an incorrect match and a missed intended match', () => {
    const score = scoreCase(c, analysis([{ sourceId: 'a', destinationId: 'added' }])).continuations;
    assert.deepEqual([score.correct, score.missed, score.incorrect], [0, 1, 1]);
});
test('correct matches and duplicate predictions have distinct counts', () => {
    const p = { sourceId: 'a', destinationId: 'b' };
    const score = scoreCase(c, analysis([p, p])).continuations;
    assert.deepEqual([score.correct, score.missed, score.incorrect], [1, 0, 1]);
});
test('missing inventory is visible and does not shrink the recall denominator', () => {
    const result = analysis([]); result.inventories.after.entries = [];
    const score = scoreCase(c, result);
    assert.equal(score.inventoryGaps.length, 2);
    assert.equal(score.continuations.expected, 1);
    assert.equal(score.continuations.missedPairs[0].reason, 'inventory-gap');
});
test('unlabeled internal declarations are excluded but guesses touching labels count', () => {
    const result = analysis([{ sourceId: 'internal-before', destinationId: 'internal-after' }, { sourceId: 'a', destinationId: 'internal-after' }]);
    result.inventories.before.entries.push(entry('internal-before', e('a.js', 'internal')));
    result.inventories.after.entries.push(entry('internal-after', e('b.js', 'internal')));
    const score = scoreCase(c, result).continuations;
    assert.equal(score.ignored, 1); assert.equal(score.incorrect, 1);
});
test('extraction evidence cannot satisfy a continuation', () => {
    const result = analysis([]); result.groups = [{ sourceId: 'a', destinationId: 'b', kind: 'extract', status: 'inferred' }];
    const score = scoreCase({ ...c, expectedGroups: [{ source: a, destination: b, kind: 'extract' }] }, result);
    assert.equal(score.continuations.missed, 1); assert.equal(score.groups.correct, 1);
});
test('unresolved extraction evidence does not count as an accepted relationship', () => {
    const result = analysis([]); result.groups = [{ sourceId: 'a', destinationId: 'b', kind: 'extract', status: 'unresolved' }];
    const score = scoreCase({ ...c, expectedGroups: [{ source: a, destination: b, kind: 'extract' }] }, result);
    assert.equal(score.groups.correct, 0); assert.equal(score.groups.missed, 1);
});
test('invalid predictions and ambiguous gold selectors fail explicitly', () => {
    assert.throws(() => scoreCase(c, null), /Invalid analysis/);
    assert.throws(() => scoreCase(c, analysis([{ sourceId: 'missing', destinationId: 'b' }])), /missing declaration/);
    const result = analysis([]); result.inventories.before.entries.push(entry('duplicate', a));
    assert.throws(() => scoreCase(c, result), /Ambiguous gold selector/);
});
