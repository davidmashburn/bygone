const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTwoWayDiffModel, scoreReplacementLinePair, alignReplacementLines } = require('../out/diffEngine');
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

// Brackets specify the product policy, including deliberately broad highlights
// when two edits surround an unchanged middle. Check both comparison directions.
for (const [left, right, expectedLeft, expectedRight] of [
    ['oldName', 'newName', '[old]Name', '[new]Name'],
    ['nameOld', 'nameNew', 'name[Old]', 'name[New]'],
    ['userCount', 'usersCount', 'userCount', 'user[s]Count'],
    ['Name', 'NewName', 'Name', '[New]Name'],
    ['name', 'names', 'name', 'name[s]'],
    ['userStatisticalCount', 'userMetricsCount', 'user[Statistical]Count', 'user[Metrics]Count'],
    ['customer', 'invoice', '[customer]', '[invoice]'],
    ['receive', 'retrieve', 're[cei]ve', 're[trie]ve'],
    ['timeoutMs', 'timeoutSeconds', 'timeout[M]s', 'timeout[Second]s'],
    ['oldNameOld', 'newNameNew', '[oldNameOld]', '[newNameNew]'],
    ['prefixOldMiddleOldSuffix', 'prefixNewMiddleNewSuffix', 'prefix[OldMiddleOld]Suffix', 'prefix[NewMiddleNew]Suffix'],
    ['aaaa', 'aaa', 'aaa[a]', 'aaa'],
    ['1', '10', '1', '1[0]'],
    ['sameName', 'sameName', 'sameName', 'sameName'],
    ['cafe', 'cafe\u0301', 'caf[e]', 'caf[e\u0301]'],
    ['cafe\u0301', 'cafe\u0300', 'caf[e\u0301]', 'caf[e\u0300]'],
    ['👩‍💻Count', '👩‍🔬Count', '[👩‍💻]Count', '[👩‍🔬]Count'],
    ['👍Count', '👍🏽Count', '[👍]Count', '[👍🏽]Count'],
    ['oldName oldCount', 'newName newCount', '[old]Name [old]Count', '[new]Name [new]Count']
]) {
    test(`inline edge trimming: ${left} → ${right}`, () => {
        for (const reverse of [false, true]) {
            const values = reverse ? [right, left] : [left, right];
            const expected = reverse ? [expectedRight, expectedLeft] : [expectedLeft, expectedRight];
            const sources = values.map(value => `const value = ${value};`);
            const model = buildTwoWayDiffModel(...sources);
            assertPreserved(model, [sources[0]], [sources[1]]);
            for (const [index, side] of ['left', 'right'].entries()) {
                const line = model[`${side}Lines`][0];
                const marked = line.segments?.map(segment => segment.emphasis ? `[${segment.text}]` : segment.text).join('') ?? line.content;
                assert.equal(marked, `const value = ${expected[index]};`);
            }
        }
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
        assert.deepEqual(model.reflows, expected);
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

test('edited reflow retains substantive inline highlights', () => {
    const model = buildTwoWayDiffModel('body: alpha beta gamma delta', 'body: alpha beta\n  CHANGED delta');
    assert.equal(model.blocks[0].kind, 'replace');
    assert.ok(model.rightLines.some(line => line.segments?.some(segment => segment.emphasis && segment.text.includes('CHANGED'))));
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
    test(`touching blue regions merge while retaining separate scroll anchors (${name})`, () => {
        const left = ['body: alpha beta gamma delta', 'body: one two three four five six', 'end: unchanged'];
        const right = ['  body: alpha beta', '    gamma delta', '  body: one two', '    three four', '    five six', 'end: unchanged'];
        const model = buildTwoWayDiffModel(left.join(newline) + (trailing ? newline : ''), right.join(newline) + (trailing ? newline : ''));
        assert.deepEqual(model.blocks, [{kind: 'replace', leftStart: 0, leftEnd: 2, rightStart: 0, rightEnd: 5}]);
        assert.deepEqual(model.reflows, [
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

for (const reverse of [false, true]) {
    test(`edited YAML paragraphs pair across physical wrapping without absorbing new items (${reverse})`, () => {
        const prose = Array.from({length: 45}, (_, i) => `The sensor ${i} records temperature and humidity before sending its readings to the station.`).join(' ');
        const edited = prose.replace('sensor 22', 'instrument 22');
        const wrap = text => text.match(/.{1,75}(?:\s|$)/g).map(line => `      ${line.trim()}`);
        const before = ['anchor', `  summary: ${prose}`, `  - Existing measurement description with stable context and original details.`, 'end'];
        const after = ['anchor', `    summary: ${wrap(edited).shift().trim()}`, ...wrap(edited).slice(1),
            '    - Brand new unrelated appendix.', '      Extra instructions for the appendix.',
            '    - Existing measurement description with stable context', '      and revised details.', 'end'];
        const [left, right] = reverse ? [after, before] : [before, after];
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
        assertPreserved(model, left, right);
        assert.deepEqual(model.blocks.map(block => block.kind), ['replace', reverse ? 'delete' : 'insert', 'replace']);
        const side = reverse ? 'left' : 'right';
        const summary = model.reflows[0];
        assert.equal(summary[`${side}Start`], 1);
        assert.equal(summary[`${side}End`], 1 + wrap(edited).length);
        assert.equal(mapLinePosition(1.5, reverse ? 'right' : 'left', model), (summary[`${side}Start`] + summary[`${side}End`]) / 2);
        assert.ok(model[`${side}Lines`].some(line => line.segments?.some(segment => segment.emphasis && segment.text.includes('instrument'))));
    });
}

for (const length of [2001, 9000]) {
    test(`long edited lines remain paired at ${length} characters`, () => {
        const before = 'Recorded measurements include temperature, humidity, and pressure. '.repeat(Math.ceil(length / 65)).slice(0, length);
        const after = before.replace('temperature', 'wind speed');
        const model = buildTwoWayDiffModel(before, after);
        assert.deepEqual(model.blocks.map(block => block.kind), ['replace']);
        assertPreserved(model, [before], [after]);
        const unrelated = buildTwoWayDiffModel('abcdefghij '.repeat(length / 10), '9876543210 '.repeat(length / 10));
        assert.deepEqual(unrelated.blocks.map(block => block.kind), ['delete', 'insert']);
    });
}

test('matching paragraph does not absorb removed block-scalar notes or following fields', () => {
    const before = ['anchor', '  summary: Existing overview of temperature measurements and station readings.',
        '  body: |-', '    Retired appendix.', '', '    ## Archived notes', '    Removed historical context.', '  status: pending', 'end'];
    const after = ['anchor', '    summary: Existing overview of temperature measurements', '      and updated station readings.', '    status: pending', 'end'];
    const model = buildTwoWayDiffModel(before.join('\n'), after.join('\n'));
    assertPreserved(model, before, after);
    assert.deepEqual(model.blocks.map(block => block.kind), ['replace', 'delete', 'replace']);
    assert.deepEqual(model.blocks[1], {kind: 'delete', leftStart: 2, leftEnd: 7, rightStart: 3, rightEnd: 3});
});

test('unchanged context keeps blue regions separate', () => {
    const model = buildTwoWayDiffModel('  first: old\nanchor\n  second: old', 'first: revised\nanchor\nsecond: revised');
    assert.equal(model.blocks.length, 2);
    assert.deepEqual(model.blocks.map(block => [block.leftStart, block.leftEnd]), [[0, 1], [2, 3]]);
});

const oldHeading = 'title: Find the right depth without expanding the README';
const newHeading = 'title: Organize the engineering and agent reference';
function titlePairs(model) {
    return model.rows.filter(row => row.left.content.trim() === oldHeading && row.right.content.trim() === newHeading);
}

for (const reverse of [false, true]) {
    test(`field prefixes pair renamed titles in large repeated YAML (${reverse})`, () => {
        const before = [], after = [];
        for (let section = 0; section < 30; section++) {
            before.push(`      - id: section-${section}`, '        kind: walkthrough', `        ${oldHeading}`,
                `        summary: Retained description for section ${section}.`, '        depth: contextualized');
            after.push(`  - id: section-${section}`, '    kind: walkthrough', `    ${newHeading}`,
                `    summary: Retained description for section ${section}.`, '    depth: contextualized');
        }
        const [left, right] = reverse ? [after, before] : [before, after];
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'), {timeoutMs: 3000});
        assertPreserved(model, left, right);
        const pairs = model.rows.filter(row => row.left.content.includes(reverse ? newHeading : oldHeading));
        assert.equal(pairs.length, 30);
        for (const row of pairs) {
            assert.equal(row.right.content.trim(), reverse ? oldHeading : newHeading);
            assert.equal(row.left.lineNumber, row.right.lineNumber, 'Repeated title fields stay within their own scene');
        }
        assert.deepEqual(model.blocks.map(block => block.kind), ['replace']);
    });
}

for (const [name, leftGap, rightGap] of [
    ['repeated labels', [oldHeading, oldHeading], [newHeading, newHeading]],
    ['generic language prefix', ['return first;', 'return second;'], ['return other;', 'return final;']]
]) {
    test(`prefix bonus does not override ${name}`, () => {
        const left = ['    anchor: stable start', ...leftGap.map(line => `    ${line}`), '    end: stable finish'];
        const right = ['  anchor: stable start', ...rightGap.map(line => `  ${line}`), '  end: stable finish'];
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
        assertPreserved(model, left, right);
        assert.equal(titlePairs(model).length, 0);
        if (name === 'generic language prefix') {
            assert.equal(model.rows.filter(row => row.left.content.startsWith('    return') && row.right.lineNumber !== null).length, 0);
        }
    });
}

test('meaningful prefix evidence works independently of neighboring matches', () => {
    const score = scoreReplacementLinePair(oldHeading, newHeading);
    assert.equal(score.eligible, true);
    assert.ok(score.score > 0.52);
    assert.deepEqual(alignReplacementLines([oldHeading], [newHeading]), [{left: oldHeading, right: newHeading}]);
    const model = buildTwoWayDiffModel(`    anchor: stable\n    ${oldHeading}\n    Removed footer`, `  anchor: stable\n  ${newHeading}\n  Added epilogue`);
    assert.equal(titlePairs(model).length, 1);
});

test('different field names do not earn a prefix bonus', () => {
    assert.equal(scoreReplacementLinePair(oldHeading, newHeading.replace('title:', 'caption:')).eligible, false);
});

test('a shared field prefix cannot outweigh unrelated long content', () => {
    const left = 'body: ' + 'abcdefghij '.repeat(300);
    const right = 'body: ' + '9876543210 '.repeat(300);
    assert.equal(scoreReplacementLinePair(left, right).eligible, false);
    assert.deepEqual(buildTwoWayDiffModel(left, right).blocks.map(block => block.kind), ['delete', 'insert']);
});
