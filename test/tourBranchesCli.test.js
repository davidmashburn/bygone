const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { optionalBranchesFixture } = require('./optionalBranchesFixture');
const { runTourCommand } = require('../cli/tour');
const { parseTourArgs } = require('../cli/tour');
const { exportFixture } = require('./exportFixture');
const { execFileSync } = require('node:child_process');

test('validation reports the main reading cost separately from optional evidence', () => {
    const fixture = optionalBranchesFixture();
    try {
        let output = '';
        const result = runTourCommand(['validate', fixture.sourcePath, '--json'], fixture.root,
            path.resolve(__dirname, '..'), { write: text => { output += text; } });
        assert.deepEqual(JSON.parse(output).readingCosts, result.readingCosts);
        const cost = result.readingCosts.historical;
        assert.equal(cost.main.steps, 3);
        assert.equal(cost.optional.steps, 3);
        assert.ok(cost.main.words > 0 && cost.optional.words > 0);
        assert.equal(cost.narration.main.stops, 6);
        assert.equal(cost.narration.optional.stops, 3);
        assert.ok(cost.narration.main.words > cost.main.words, 'spoken orientation is included');
        output = '';
        runTourCommand(['validate', fixture.sourcePath], fixture.root,
            path.resolve(__dirname, '..'), { write: text => { output += text; } });
        assert.match(output, /historical: main 3 steps \/ \d+ words; optional 3 steps \/ \d+ words/);
        assert.match(output, /Continuous narration: main 6 stops \/ \d+ words; optional 3 stops \/ \d+ words/);
    } finally { fixture.dispose(); }
});

test('narration exposes the spoken main path in order, with framing but without nested optional evidence', () => {
    const fixture = optionalBranchesFixture();
    try {
        const packageRoot = path.resolve(__dirname, '..');
        const output = execFileSync(process.execPath, [path.join(packageRoot, 'bin/bygone.js'), '-C', fixture.root,
            'tour', 'narration', fixture.sourcePath, '--json'], { encoding: 'utf8' });
        const report = JSON.parse(output);
        const main = report.modes.historical.main;
        assert.equal(report.title, 'Review the change at your own depth');
        assert.deepEqual(main.items.map(item => item.title), [
            'Three claims, optional evidence', 'A concise main path',
            'The changed value is explicit', 'The next main claim stays close',
            'The main path is complete', 'Ready to review'
        ]);
        assert.match(main.items[0].text, /Review the change at your own depth/);
        assert.match(main.items[2].text, /The main path states the result/);
        assert.match(main.items[5].text, /The main path has covered the outcome/);
        assert.doesNotMatch(main.items.map(item => item.text).join('\n'),
            /optional-evidence-marker|This explanation adds|This second explanation step/);
        assert.equal(new Set(main.items.map(item => item.key)).size, 6);
        const validation = runTourCommand(['validate', fixture.sourcePath], fixture.root, packageRoot, { write() {} });
        assert.deepEqual({ stops: main.stops, words: main.words }, validation.readingCosts.historical.narration.main);
        assert.equal(main.words, main.items.reduce((sum, item) => sum + item.words, 0));
        let plain = '';
        runTourCommand(['narration', fixture.sourcePath], fixture.root, packageRoot, { write: text => { plain += text; } });
        assert.match(plain, /optional branches excluded/);
        assert.match(plain, /historical: 6 stops \/ \d+ words/);
        for (const item of main.items) assert.ok(plain.includes(item.text));
    } finally { fixture.dispose(); }
});

test('narration reports authored modes separately', () => {
    const fixture = exportFixture();
    try {
        const result = runTourCommand(['narration', fixture.sourcePath], fixture.root,
            path.resolve(__dirname, '..'), { write() {} });
        assert.deepEqual(Object.keys(result.report.modes).sort(), ['deconstructed', 'historical']);
        const modes = result.report.modes;
        assert.notDeepEqual(modes.historical.main.items, modes.deconstructed.main.items);
        const validation = runTourCommand(['validate', fixture.sourcePath], fixture.root,
            path.resolve(__dirname, '..'), { write() {} });
        for (const [mode, { main }] of Object.entries(modes)) {
            assert.deepEqual({ stops: main.stops, words: main.words }, validation.readingCosts[mode].narration.main);
        }
    } finally { fixture.dispose(); }
});

test('narration rejects compile and coverage options', () => {
    assert.throws(() => parseTourArgs(['narration']), /requires a .bygone source/);
    assert.throws(() => parseTourArgs(['narration', 'review.bygone', '--output', 'tour.json']), /only valid with tour compile/);
    assert.throws(() => parseTourArgs(['narration', 'review.bygone', '--minimum-coverage', '90']), /only valid with tour coverage/);
});
