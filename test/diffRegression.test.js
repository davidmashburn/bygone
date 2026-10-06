const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTwoWayDiffModel } = require('../out/diffEngine');
const { yamlDiffFixture } = require('./yamlDiffFixture');
const { mapLinePosition, mapMultiPanelLinePositions, scrollTopToModelLinePosition, modelLinePositionToScrollTop } = require('../media/scrollMapping');

function assertPreserved(model, left, right) {
    for (const [side, source] of [['left', left], ['right', right]]) {
        assert.deepEqual(model[`${side}Lines`].map(line => line.content), source);
        assert.deepEqual(model.rows.filter(row => row[side].lineNumber !== null).map(row => row[side].content), source);
        assert.deepEqual(model[`${side}Lines`].map(line => line.lineNumber), source.map((_, index) => index + 1));
        for (const line of model[`${side}Lines`]) {
            if (line.segments) assert.equal(line.segments.map(segment => segment.text).join(''), line.content);
        }
    }
}

function emphasizedRanges(line) {
    let column = 0;
    return (line.segments || []).flatMap(segment => {
        const start = column;
        column += segment.text.length;
        return segment.emphasis ? [[start, column]] : [];
    });
}

// Meld's matcher/tag tests check exact boundaries. VS Code's fixture tests
// check expected mappings and source reconstruction. These are original cases.
for (const [name, left, right, leftRanges, rightRanges] of [
    ['indent', '  key: value', '    key: value', [], [[0, 2]]],
    ['dedent', '    key: value', '  key: value', [[0, 2]], []],
    ['tabs', '\tkey: value', '  key: value', [[0, 1]], [[0, 2]]],
    ['trailing', 'key: value  ', 'key: value', [[10, 12]], []],
    ['internal', 'key: one  two', 'key: one two', [[9, 10]], []],
    ['blank', '   ', '\t', [[0, 3]], [[0, 1]]]
]) {
    test(`whitespace highlights exact changed columns: ${name}`, () => {
        const model = buildTwoWayDiffModel(`anchor before\n${left}\nanchor after`, `anchor before\n${right}\nanchor after`);
        assert.deepEqual(emphasizedRanges(model.leftLines[1]), leftRanges);
        assert.deepEqual(emphasizedRanges(model.rightLines[1]), rightRanges);
    });
}

for (const length of [499, 500, 501, 1999, 2000, 2001, 9000]) {
    test(`long whitespace-only lines remain paired and highlighted at length ${length}`, () => {
        const text = `body: ${'narrative '.repeat(Math.ceil(length / 10))}`.slice(0, length);
        for (const [left, right] of [[text, `  ${text}`], [`  ${text}`, text]]) {
            const model = buildTwoWayDiffModel(left, right);
            assert.deepEqual(model.blocks.map(block => block.kind), ['replace']);
            const changed = left.length > right.length ? model.leftLines[0] : model.rightLines[0];
            assert.deepEqual(emphasizedRanges(changed), [[0, 2]]);
            assertPreserved(model, [left], [right]);
        }
    });
}

for (const reverse of [false, true]) {
    test(`large mixed YAML preserves reflows, real changes, and scroll anchors (${reverse ? 'reverse' : 'forward'})`, () => {
        const fixture = yamlDiffFixture();
        const left = reverse ? fixture.after : fixture.before;
        const right = reverse ? fixture.before : fixture.after;
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'), { timeoutMs: 3000 });
        assert.equal(model.quality, 'exact');
        assert.equal(model.hasChanges, true);
        assertPreserved(model, left, right);
        const expected = fixture.reflows.map(block => reverse ? {
            ...block, leftStart: block.rightStart, leftEnd: block.rightEnd,
            rightStart: block.leftStart, rightEnd: block.leftEnd
        } : block);
        assert.deepEqual(model.blocks.filter(block => block.reflow), expected);
        for (const block of expected) {
            assert.ok(['left', 'right'].some(side => model[`${side}Lines`].slice(block[`${side}Start`], block[`${side}End`]).some(line => line.segments?.some(segment => segment.emphasis))));
            for (const side of ['left', 'right']) {
                const lines = model[`${side}Lines`].slice(block[`${side}Start`], block[`${side}End`]);
                assert.ok(lines.every(line => line.segments.every(segment => !segment.emphasis || /^\s+$/.test(segment.text))));
            }
        }
        const realEdit = model.rightLines.find(line => line.content.includes(reverse ? 'status: pending' : 'status: completed'));
        assert.ok(realEdit.segments.some(segment => segment.emphasis && /\S/.test(segment.text)));
        // Hundreds of lines added later must not accelerate scrolling in the prefix.
        for (const position of [0, 10.25, 90, 150.5]) assert.equal(mapLinePosition(position, 'left', model), position);
        const sourceSuffix = fixture.suffixStart[reverse ? 'right' : 'left'];
        const targetSuffix = fixture.suffixStart[reverse ? 'left' : 'right'];
        assert.equal(mapLinePosition(sourceSuffix + 40.5, 'left', model), targetSuffix + 40.5);
        for (const block of expected) {
            const sourceMid = (block.leftStart + block.leftEnd) / 2;
            const targetMid = (block.rightStart + block.rightEnd) / 2;
            assert.equal(mapLinePosition(sourceMid, 'left', model), targetMid);
            assert.equal(mapLinePosition(targetMid, 'right', model), sourceMid);
        }
    });
}

test('reflow detection never hides substantive changes', () => {
    const model = buildTwoWayDiffModel('body: alpha beta gamma delta', 'body: alpha beta\n  CHANGED delta');
    assert.equal(model.blocks.some(block => block.reflow), false);
    assertPreserved(model, ['body: alpha beta gamma delta'], ['body: alpha beta', '  CHANGED delta']);
});

test('multi-panel scrolling composes adjacent mappings in both directions and uses new models after edits', () => {
    const original = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    const middle = [...original.slice(0, 50), 'inserted', ...original.slice(50)];
    const last = ['first', ...middle];
    const pair = (a, b, i) => ({ leftIndex: i, rightIndex: i + 1, diffModel: buildTwoWayDiffModel(a.join('\n'), b.join('\n')) });
    const pairs = [pair(original, middle, 0), pair(middle, last, 1)];
    assert.deepEqual(mapMultiPanelLinePositions(20.5, 0, 3, pairs), [20.5, 20.5, 21.5]);
    assert.deepEqual(mapMultiPanelLinePositions(61.5, 2, 3, pairs), [59.5, 60.5, 61.5]);
    assert.deepEqual(mapMultiPanelLinePositions(60.5, 1, 3, pairs), [59.5, 60.5, 61.5]);
    pairs[0] = pair(original, original, 0);
    assert.deepEqual(mapMultiPanelLinePositions(59.5, 0, 3, pairs), [59.5, 59.5, 60.5]);
});

test('wrapped and folded visual lines map within the actual model line height', () => {
    const editor = heights => ({
        getModel: () => ({ getLineCount: () => heights.length }),
        getTopForLineNumber: line => heights.slice(0, line - 1).reduce((a, b) => a + b, 0),
        getBottomForLineNumber: line => heights.slice(0, line).reduce((a, b) => a + b, 0)
    });
    const wrapped = editor([20, 200, 20, 0, 0, 20]);
    assert.equal(scrollTopToModelLinePosition(wrapped, 120), 1.5);
    assert.equal(modelLinePositionToScrollTop(wrapped, 1.5), 120);
    assert.equal(scrollTopToModelLinePosition(wrapped, 250), 5.5);
    assert.equal(modelLinePositionToScrollTop(wrapped, 5.5), 250);
});

for (const [name, newline, trailing] of [['LF', '\n', false], ['CRLF', '\r\n', false], ['LF with final newline', '\n', true]]) {
    test(`consecutive reflows retain separate boundaries (${name})`, () => {
        const left = ['body: alpha beta gamma delta', 'body: one two three four five six', 'end: unchanged'];
        const right = ['  body: alpha beta', '    gamma delta', '  body: one two', '    three four', '    five six', 'end: unchanged'];
        const model = buildTwoWayDiffModel(left.join(newline) + (trailing ? newline : ''), right.join(newline) + (trailing ? newline : ''));
        assert.deepEqual(model.blocks, [
            {kind: 'replace', leftStart: 0, leftEnd: 1, rightStart: 0, rightEnd: 2, reflow: true},
            {kind: 'replace', leftStart: 1, leftEnd: 2, rightStart: 2, rightEnd: 5, reflow: true}
        ]);
        assert.equal(mapLinePosition(1, 'left', model), 2);
        assert.equal(mapLinePosition(1.5, 'left', model), 3.5);
        assertPreserved(model, left, right);
    });
}

test('timeout fallback preserves unchanged scroll anchors and remains monotonic', () => {
    const fixture = yamlDiffFixture();
    const model = buildTwoWayDiffModel(fixture.before.join('\n'), fixture.after.join('\n'), {timeoutMs: -1});
    assert.equal(model.quality, 'fallback');
    for (const position of [0, 40.25, 150.5]) assert.equal(mapLinePosition(position, 'left', model), position);
    assert.equal(mapLinePosition(fixture.suffixStart.left + 20.5, 'left', model), fixture.suffixStart.right + 20.5);
    const leftMid = (161 + fixture.suffixStart.left) / 2;
    const rightMid = (161 + fixture.suffixStart.right) / 2;
    assert.equal(mapLinePosition(leftMid, 'left', model), rightMid);
    assert.equal(mapLinePosition(rightMid, 'right', model), leftMid);
    const positions = Array.from({length: fixture.before.length}, (_, index) => mapLinePosition(index, 'left', model));
    assert.ok(positions.every((position, index) => index === 0 || position >= positions[index - 1]));
});
