const assert = require('node:assert/strict');
const { buildTwoWayDiffModel, mergeText } = require('../out/diffEngine.js');

function testTwoWayDiffAlignsInsertions() {
    const model = buildTwoWayDiffModel('a\nb\nc\n', 'a\nx\nb\nc\n');

    assert.equal(model.hasChanges, true);
    assert.equal(model.rows.length, 4);
    assert.equal(model.rows[1].left.kind, 'placeholder');
    assert.equal(model.rows[1].right.kind, 'added');
    assert.equal(model.rows[1].right.content, 'x');
    assert.equal(model.rightLines[1].segments, undefined);
}

function testInlineHighlightsSingleWordReplacement() {
    const model = buildTwoWayDiffModel('const value = oldName;\n', 'const value = newName;\n');

    assert.deepEqual(
        model.leftLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'removed', text: 'oldName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'added', text: 'newName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
}

function testInlineHighlightsPunctuationChange() {
    const model = buildTwoWayDiffModel('call(foo)\n', 'call(foo, bar)\n');

    assert.equal(model.leftLines[0].segments?.some((segment) => segment.emphasis), false);
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'call(foo', emphasis: false },
            { kind: 'added', text: ', bar', emphasis: true },
            { kind: 'context', text: ')', emphasis: false }
        ]
    );
}

function testInlineHighlightsWhitespaceSensitiveChange() {
    const model = buildTwoWayDiffModel('return foo + bar;\n', 'return foo+bar;\n');

    assert.equal(model.leftLines[0].segments, undefined);
    assert.equal(model.rightLines[0].segments, undefined);
}

function testInlineHighlightsOnlyPairedReplaceLines() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha changed\nbeta changed\ngamma\n');

    assert.equal(model.blocks[0].kind, 'replace');
    assert.ok(model.leftLines[0].segments);
    assert.ok(model.leftLines[1].segments);
    assert.equal(model.rightLines[2].segments, undefined);
}

function testPureDeleteHasNoInlineSegments() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha\n');

    assert.equal(model.blocks[0].kind, 'delete');
    assert.equal(model.leftLines[1].segments, undefined);
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
    testInlineHighlightsSingleWordReplacement();
    testInlineHighlightsPunctuationChange();
    testInlineHighlightsWhitespaceSensitiveChange();
    testInlineHighlightsOnlyPairedReplaceLines();
    testPureDeleteHasNoInlineSegments();
    testMergeAcceptsOneSidedChange();
    testMergeAcceptsMatchingChanges();
    testMergeCreatesConflictForDivergentEdits();
    console.log('All tests passed.');
}

run();
