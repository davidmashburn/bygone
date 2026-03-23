const assert = require('node:assert/strict');
const { buildTwoWayDiffModel, mergeText } = require('../out/diffEngine.js');

function testTwoWayDiffAlignsInsertions() {
    const model = buildTwoWayDiffModel('a\nb\nc\n', 'a\nx\nb\nc\n');

    assert.equal(model.hasChanges, true);
    assert.equal(model.rows.length, 4);
    assert.equal(model.rows[1].left.kind, 'placeholder');
    assert.equal(model.rows[1].right.kind, 'added');
    assert.equal(model.rows[1].right.content, 'x');
}

function testMergeAcceptsOneSidedChange() {
    const result = mergeText('a\nb\nc\n', 'a\nleft\nc\n', 'a\nb\nc\n');

    assert.equal(result.conflictCount, 0);
    assert.deepEqual(result.resultLines, ['a', 'left', 'c']);
}

function testMergeAcceptsMatchingChanges() {
    const result = mergeText('a\nb\nc\n', 'a\nshared\nc\n', 'a\nshared\nc\n');

    assert.equal(result.conflictCount, 0);
    assert.deepEqual(result.resultLines, ['a', 'shared', 'c']);
}

function testMergeCreatesConflictForDivergentEdits() {
    const result = mergeText('a\nb\nc\n', 'a\nleft\nc\n', 'a\nright\nc\n');

    assert.equal(result.conflictCount, 1);
    assert.deepEqual(result.resultLines, [
        'a',
        '<<<<<<< LEFT',
        'left',
        '=======',
        'right',
        '>>>>>>> RIGHT',
        'c'
    ]);
}

function run() {
    testTwoWayDiffAlignsInsertions();
    testMergeAcceptsOneSidedChange();
    testMergeAcceptsMatchingChanges();
    testMergeCreatesConflictForDivergentEdits();
    console.log('All tests passed.');
}

run();
