const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTwoWayDiffModel, scoreReplacementLinePair, alignReplacementLines } = require('../out/diffEngine');
const { yamlDiffFixture } = require('./yamlDiffFixture');
const { proseDiffFixture } = require('./proseDiffFixture');
const { mapLinePosition, mapMultiPanelLinePositions, scrollTopToModelLinePosition, modelLinePositionToScrollTop } = require('../media/scrollMapping');

function assertPreserved(model, left, right) {
    for (let index = 1; index < model.blocks.length; index++) {
        const previous = model.blocks[index - 1];
        const current = model.blocks[index];
        const touching = previous.leftEnd === current.leftStart && previous.rightEnd === current.rightStart;
        assert.ok(!touching || previous.kind === 'replace' || current.kind === 'replace'
            || previous.kind === current.kind, 'Touching opposite one-sided blocks must form a replacement');
    }
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

test('an edited condition wrapped across lines keeps word highlights in both directions', () => {
    const before = ['    if item.ready is None and self.now >= item.cutoff:'];
    const after = ['    if (', '        item.ready is None',
        '        and item.cutoff <= self.now', '        <= item.cutoff + GRACE', '    ):'];
    for (const reverse of [false, true]) {
        const [left, right] = reverse ? [after, before] : [before, after];
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
        assertPreserved(model, left, right);
        assert.deepEqual(model.blocks.map(block => block.kind), ['replace']);
        assert.deepEqual(model.reflows, [], 'Inline emphasis must not introduce reflow scroll anchors');
        assert.ok(model.rows.every(row => row.left.kind === 'placeholder' || row.right.kind === 'placeholder'),
            'Inline emphasis must not invent physical line pairs');
        const wrapped = reverse ? model.leftLines : model.rightLines;
        const single = (reverse ? model.rightLines : model.leftLines)[0];
        const emphasized = line => (line.segments || []).filter(s => s.emphasis).map(s => s.text).join('');
        assert.match(emphasized(wrapped[3]), /\+ GRACE/);
        assert.match(emphasized(single), />=/);
        const unchanged = wrapped[1].segments.filter(s => !s.emphasis).map(s => s.text).join('');
        assert.ok(unchanged.includes('item.ready is None'), 'Shared condition words remain unhighlighted');
        assert.equal(wrapped[3].segments.filter(s => !s.emphasis).map(s => s.text).join('').trim(), 'item.cutoff');
    }
});

test('wrapped inline comparison handles rewrites and explicitly marks oversized replacements', () => {
    for (const [before, after] of [
        ['delete obsolete records', 'render fresh widgets\nlaunch colorful rockets'],
        ['if ready and enabled:', `if (\n${' '.repeat(20_001)}ready and enabled\n):`]
    ]) {
        for (const [left, right] of [[before, after], [after, before]]) {
            const model = buildTwoWayDiffModel(left, right);
            assertPreserved(model, left.split('\n'), right.split('\n'));
            if (Math.max(left.length, right.length) < 20_000) {
                assert.ok([...model.leftLines, ...model.rightLines].every(line => line.segments && !line.inlineDetail));
                continue;
            }
            assert.ok([...model.leftLines, ...model.rightLines].every(line => !line.segments));
            for (const block of model.blocks.filter(block => block.kind === 'replace')) {
                for (const side of ['left', 'right']) {
                    assert.ok(model[`${side}Lines`].slice(block[`${side}Start`], block[`${side}End`])
                        .every(line => line.inlineDetail === 'omitted'));
                }
            }
        }
    }
});

test('small prose documents retain detailed edits through long paragraphs and expanded instructions', () => {
    const { before, feedback, revision } = proseDiffFixture();
    assert.ok(before[2].length > 500);
    for (const [first, second, expected] of [
        [before, feedback, ['laminated', 'purple', 'replacement parts', 'Monday']],
        [feedback, revision, ['digital', 'orang', 'Tues']]
    ]) {
        for (const reverse of [false, true]) {
            const [left, right] = reverse ? [second, first] : [first, second];
            const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
            assertPreserved(model, left, right);
            assert.equal(model.hasChanges, true);
            assert.equal(model.quality, 'exact');
            assert.ok([...model.leftLines, ...model.rightLines].every(line => !line.inlineDetail),
                'A small prose document must not omit detailed comparison');
            const edited = reverse ? model.leftLines : model.rightLines;
            for (const text of expected) {
                const line = edited.find(line => line.content.includes(text));
                const start = line.content.indexOf(text);
                const ranges = emphasizedRanges(line);
                for (let index = 0; index < text.length; index++) {
                    if (/\s/.test(text[index])) continue;
                    assert.ok(ranges.some(([a, b]) => a <= start + index && b > start + index), `Missing highlight for ${text}`);
                }
            }
            const paragraph = edited[2];
            assert.ok(paragraph.segments.some(s => !s.emphasis && s.text.includes('neighborhood workshop')),
                'Shared prose must remain unhighlighted');
            const instruction = expected.includes('laminated') && edited.find(line => line.content.includes('compare the reserved benches'));
            if (instruction) {
                assert.ok(instruction.segments.some(s => s.emphasis && s.text.includes('reserved benches')));
                assert.ok(instruction.segments.some(s => !s.emphasis && s.text.includes('Check the register')));
            }
        }
    }
});

test('long sparse edits get word highlights; bounded-out replacements get explicit markers', () => {
    for (const length of [501, 2001, 9000, 20_001]) {
        const shared = 'A workshop volunteer checks the equipment. '.repeat(Math.ceil(length / 42)).slice(0, length);
        const left = `${shared} old label`;
        const right = `${shared} new label`;
        for (const pair of [[left, right], [right, left]]) {
            const model = buildTwoWayDiffModel(...pair);
            assertPreserved(model, [pair[0]], [pair[1]]);
            assert.equal(model.hasChanges, true);
            for (const line of [...model.leftLines, ...model.rightLines]) {
                if (length > 20_000) {
                    assert.equal(line.inlineDetail, 'omitted');
                    assert.equal(line.segments, undefined);
                } else {
                    assert.equal(line.inlineDetail, undefined);
                    assert.deepEqual(emphasizedRanges(line), [[shared.length + 1, shared.length + 4]]);
                }
            }
        }
    }
});

test('line-diff timeout preserves change status and exposes omitted word detail', () => {
    const model = buildTwoWayDiffModel('First task\nSecond task', 'Different task\nAnother task', { timeoutMs: -1 });
    assert.equal(model.quality, 'fallback');
    assert.equal(model.hasChanges, true);
    assert.ok([...model.leftLines, ...model.rightLines].every(line => line.inlineDetail === 'omitted'));
});

test('word-diff work limits cannot silently erase highlighting', () => {
    // Below the character cap, but beyond the word edit-distance budget.
    const left = Array.from({ length: 1100 }, (_, index) => `old${index}`).join(' ');
    const right = Array.from({ length: 1100 }, (_, index) => `new${index}`).join(' ');
    const model = buildTwoWayDiffModel(left, right);
    assertPreserved(model, [left], [right]);
    assert.equal(model.quality, 'exact', 'The line diff itself still completed');
    assert.equal(model.hasChanges, true);
    assert.ok([...model.leftLines, ...model.rightLines].every(line => line.inlineDetail === 'omitted'));
});

test('a pure insertion does not label the unchanged side as having skipped detail', () => {
    const model = buildTwoWayDiffModel('Bring paper.', 'Bring blue paper.');
    assert.deepEqual(emphasizedRanges(model.leftLines[0]), []);
    assert.equal(model.leftLines[0].inlineDetail, undefined);
    assert.ok(model.leftLines[0].segments.every(s => s.kind === 'context'));
});

test('line endings and final newlines cannot be reported as identical', () => {
    for (const [before, after, changedLines] of [
        ['First\nLast', 'First\nLast\n', [2]],
        ['First\nLast\n', 'First\r\nLast\r\n', [1, 2]],
        ['First\nLast\n', 'First\r\nLast\n', [1]],
        ['\n', '\r\n', [1]]
    ]) {
        for (const pair of [[before, after], [after, before]]) {
            const model = buildTwoWayDiffModel(...pair);
            assert.equal(model.hasChanges, true);
            assert.equal(model.formattingOnly, true);
            assert.ok(model.blocks.length > 0, 'Formatting-only changes must be navigable');
            for (const lines of [model.leftLines, model.rightLines]) {
                assert.deepEqual(lines.filter(line => line.inlineDetail === 'line-ending').map(line => line.lineNumber), changedLines);
            }
        }
        assert.equal(buildTwoWayDiffModel(before, before).hasChanges, false);
    }
});

// Brackets specify the product policy, including deliberately broad highlights
// when two edits surround an unchanged middle. Check both comparison directions.
for (const [left, right, expectedLeft, expectedRight] of [
    ['freeze', 'freezeSet', 'freeze', 'freeze[Set]'],
    ['userStatisticsThing', 'userMetricsThing', 'user[Statist]icsThing', 'user[Metr]icsThing'],
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
        for (const [prefix, suffix] of [['', ''], ['const value = ', ';']]) {
            for (const reverse of [false, true]) {
                const values = reverse ? [right, left] : [left, right];
                const expected = reverse ? [expectedRight, expectedLeft] : [expectedLeft, expectedRight];
                const sources = values.map(value => `${prefix}${value}${suffix}`);
                const model = buildTwoWayDiffModel(...sources);
                assert.deepEqual(model.blocks.map(block => block.kind), left === right ? [] : ['replace']);
                assertPreserved(model, [sources[0]], [sources[1]]);
                for (const [index, side] of ['left', 'right'].entries()) {
                    const line = model[`${side}Lines`][0];
                    const marked = line.segments?.map(segment => segment.emphasis ? `[${segment.text}]` : segment.text).join('') ?? line.content;
                    assert.equal(marked, `${prefix}${expected[index]}${suffix}`);
                }
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
        assert.deepEqual(unrelated.blocks.map(block => block.kind), ['replace']);
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
    assert.deepEqual(alignReplacementLines([left], [right]), [{left}, {right}]);
    assert.deepEqual(buildTwoWayDiffModel(left, right).blocks.map(block => block.kind), ['replace']);
});

test('unrelated multiline edits share a blue block without inventing line matches', () => {
    for (const reverse of [false, true]) {
        const sides = [['alpha', 'bravo'], ['12345', '67890', '09876']];
        const [left, right] = reverse ? sides.reverse() : sides;
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
        assertPreserved(model, left, right);
        assert.deepEqual(model.blocks, [{kind: 'replace', leftStart: 0, leftEnd: left.length, rightStart: 0, rightEnd: right.length}]);
        assert.ok(model.rows.every(row => row.left.lineNumber === null || row.right.lineNumber === null));
        assert.ok([...model.leftLines, ...model.rightLines].every(line => line.segments?.some(s => s.emphasis)
            && !line.inlineDetail), 'Even an unmatched many-to-many rewrite receives exact word comparison');
    }
});

test('matching context separates one-sided green blocks', () => {
    for (const reverse of [false, true]) {
        const sides = [['removed', 'anchor'], ['anchor', 'inserted']];
        const [left, right] = reverse ? sides.reverse() : sides;
        const model = buildTwoWayDiffModel(left.join('\n'), right.join('\n'));
        assertPreserved(model, left, right);
        assert.deepEqual(model.blocks.map(block => block.kind), reverse ? ['insert', 'delete'] : ['delete', 'insert']);
    }
});


test('multi-panel paint unions overlapping spans without shading unchanged gaps', () => {
    const { unionChangeDecorations } = require('../media/decorationUtils');
    const inline = (line, start, end) => ({ range: { startLineNumber: line, startColumn: start,
        endLineNumber: line, endColumn: end }, options: { inlineClassName: 'bygone-inline-blue' } });
    const line = (start, end, options = { isWholeLine: true, className: 'bygone-paired-line' }) => ({
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 100 }, options });
    const marker = line(3, 4, { blockClassName: 'bygone-active-diff-outline' });
    const input = [inline(1, 7, 10), inline(1, 3, 6), inline(1, 3, 6), inline(1, 5, 8), inline(1, 4, 5),
        inline(1, 12, 14), inline(2, 1, 3), inline(2, 3, 4), line(3, 5), line(4, 7), line(8, 8),
        line(10, 11), marker];
    const saved = JSON.stringify(input);
    const output = unionChangeDecorations(input);
    assert.equal(JSON.stringify(input), saved, 'Union must not mutate pair-owned input');
    assert.deepEqual(output.filter(d => d.options.inlineClassName).map(d => d.range),
        [inline(1, 3, 10), inline(1, 12, 14), inline(2, 1, 4)].map(d => d.range));
    assert.deepEqual(output.filter(d => d.options.isWholeLine).map(d => d.range),
        [line(3, 8), line(10, 11)].map(d => d.range));
    assert.ok(output.includes(marker), 'Active change outlines retain their own ranges');
    const outline = { blockClassName: 'bygone-paired-line-outline', blockDoesNotCollapse: true };
    assert.deepEqual(unionChangeDecorations([line(2, 5, outline), line(3, 4, outline), line(5, 7, outline)]),
        [line(2, 7, outline)]);
    const annotation = inline(1, 3, 6);
    annotation.options = { inlineClassName: 'tour-highlight' };
    assert.deepEqual(unionChangeDecorations([annotation, inline(1, 2, 8)]), [annotation, inline(1, 2, 8)]);
    assert.deepEqual(unionChangeDecorations([]), []);
});


test('uniform fallback replaces other change fills while preserving markers and annotations', () => {
    const { unionChangeDecorations } = require('../media/decorationUtils');
    const paint = (start, end, options) => ({ range: { startLineNumber: start, startColumn: 1,
        endLineNumber: end, endColumn: Number.MAX_SAFE_INTEGER }, options });
    const uniform = paint(3, 3, { className: 'bygone-uniform-line', isWholeLine: true });
    const paired = paint(2, 4, { className: 'bygone-paired-line', isWholeLine: true });
    const green = paint(1, 5, { className: 'bygone-one-sided-line', isWholeLine: true });
    const word = paint(3, 3, { inlineClassName: 'bygone-inline-blue' });
    const marker = paint(3, 3, { linesDecorationsClassName: 'bygone-inline-omitted' });
    const tour = paint(3, 3, { className: 'bygone-tour-anchor' });
    const input = [paired, green, uniform, uniform, word, marker, tour];
    const saved = JSON.stringify(input);
    const output = unionChangeDecorations(input);
    assert.equal(JSON.stringify(input), saved);
    for (let line = 1; line <= 5; line++) {
        const fills = output.filter(d => /bygone-(paired|one-sided|uniform)-line$/.test(d.options.className)
            && d.range.startLineNumber <= line && d.range.endLineNumber >= line);
        assert.equal(fills.length, 1, `Line ${line} has one change fill`);
        assert.equal(fills[0].options.className, line === 3 ? 'bygone-uniform-line'
            : line === 2 || line === 4 ? 'bygone-paired-line' : 'bygone-one-sided-line');
    }
    assert.ok(!output.some(d => d.options.inlineClassName === 'bygone-inline-blue'));
    assert.ok(output.includes(marker) && output.includes(tour));
    assert.deepEqual(unionChangeDecorations([paired, word]), [paired, word], 'Pair focus restores precise detail');
});

test('multi-panel union preserves green blocks and resolves only replacement overlaps to blue', () => {
    const { unionChangeDecorations } = require('../media/decorationUtils');
    const paint = (start, end, color, outline = false) => ({
        range: { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: Number.MAX_SAFE_INTEGER },
        options: outline ? { blockClassName: `bygone-${color}-line-outline` }
            : { className: `bygone-${color}-line`, isWholeLine: true }
    });
    const input = [paint(2, 8, 'one-sided'), paint(5, 10, 'one-sided'),
        paint(2, 10, 'one-sided', true), paint(4, 5, 'paired'), paint(8, 8, 'paired'),
        paint(4, 5, 'paired', true), paint(8, 8, 'paired', true), paint(12, 12, 'one-sided')];
    const saved = JSON.stringify(input);
    const output = unionChangeDecorations(input);
    assert.equal(JSON.stringify(input), saved);
    for (const outline of [false, true]) {
        const key = outline ? 'blockClassName' : 'className';
        const suffix = outline ? '-outline' : '';
        assert.deepEqual(output.filter(d => d.options[key] === `bygone-one-sided-line${suffix}`),
            [[2, 3], [6, 7], [9, 10], ...(!outline ? [[12, 12]] : [])].map(([a, b]) => paint(a, b, 'one-sided', outline)));
        assert.deepEqual(output.filter(d => d.options[key] === `bygone-paired-line${suffix}`),
            [paint(4, 5, 'paired', outline), paint(8, 8, 'paired', outline)]);
    }
    assert.deepEqual(unionChangeDecorations([paint(3, 4, 'one-sided'), paint(2, 6, 'paired')]),
        [paint(2, 6, 'paired')], 'Fully covered green paint disappears');
    assert.deepEqual(unionChangeDecorations([paint(2, 3, 'one-sided'), paint(3, 5, 'one-sided')]),
        [paint(2, 5, 'one-sided')], 'Overlapping green paint is unioned too');
    assert.deepEqual(unionChangeDecorations([paint(2, 3, 'one-sided'), paint(4, 5, 'paired')]),
        [paint(2, 3, 'one-sided'), paint(4, 5, 'paired')], 'Touching different colors stay separate');
});
