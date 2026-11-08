const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSync } = require('esbuild');
const { resolve } = require('node:path');
const { buildWorkspacePrompt } = require('../out/workspacePrompt.js');
const optionsModule = import('data:text/javascript;base64,' + Buffer.from(buildSync({
    entryPoints: [resolve(__dirname, '../src/tourOptions.ts')], bundle: true, write: false, format: 'esm', platform: 'browser'
}).outputFiles[0].contents).toString('base64'));

test('all presets are valid v8 intents and their promises remain independent', async () => {
    const { TOUR_PRESETS, TourPreset, TourCoverage, TourDepth, validateTourOptions } = await optionsModule;
    assert.equal(TOUR_PRESETS.length, 12);
    for (const { options } of TOUR_PRESETS) assert.doesNotThrow(() => validateTourOptions(options, 8));
    const complete = TOUR_PRESETS.find(item => item.id === TourPreset.Complete).options;
    for (const depth of Object.values(TourDepth)) {
        const options = { ...complete, depth };
        const prompt = buildWorkspacePrompt('historical', {}, {}, options);
        assert.match(prompt, /not verified complete until the strict report/);
        assert.match(prompt, new RegExp(`"depth":"${depth}"`));
        assert.match(prompt, /"coverage":"complete"/);
    }
    const selectedLines = { ...complete, depth: TourDepth.LineByLine, coverage: TourCoverage.KeyChanges };
    const prompt = buildWorkspacePrompt('historical', {}, {}, selectedLines);
    assert.match(prompt, /individual edits/);
    assert.doesNotMatch(prompt, /requested 100% tour/);
});

test('each audience and depth changes concrete guidance without changing range or requested style', async () => {
    const { TOUR_PRESETS, TourAudience, TourDepth, TourStyle } = await optionsModule;
    const context = { repository: '/repo', paths: ['src'], revisions: ['a'.repeat(40), 'b'.repeat(40)], rangeStatus: 'exact' };
    const audiencePrompts = Object.values(TourAudience).map(audience => buildWorkspacePrompt('historical', context, {}, { ...TOUR_PRESETS[0].options, audience, style: TourStyle.Historical }));
    assert.equal(new Set(audiencePrompts).size, 10);
    for (const prompt of audiencePrompts) {
        assert.match(prompt, /"style":"historical"/);
        assert.match(prompt, /Selected paths: \["src"\]/);
        assert.match(prompt, /Base: "a{40}"/);
    }
    assert.equal(new Set(Object.values(TourDepth).map(depth => buildWorkspacePrompt('historical', context, {}, { ...TOUR_PRESETS[0].options, depth }))).size, 5);
});

test('options reject unsupported values, ambiguous metadata, and path traversal at the boundary', async () => {
    const { TOUR_PRESETS, validateTourOptions, TourOptionField } = await optionsModule;
    const options = TOUR_PRESETS[0].options;
    assert.throws(() => validateTourOptions(options, 7), /version 8/);
    for (const bad of [{ ...options, depth: 'automatic' }, { ...options, audience: undefined }, { ...options, extra: true },
        { ...options, inferred: [TourOptionField.Depth, TourOptionField.Depth] }, { ...options, inferred: ['author'] },
        { ...options, emphasis: undefined, inferred: [TourOptionField.Emphasis] },
        { ...options, paths: ['../outside'] }, { ...options, paths: ['/absolute'] }, { ...options, paths: ['src/./x'] },
        { ...options, paths: ['C:\\outside'] }, { ...options, emphasis: ['unknown'] }, { ...options, notes: ' ' }]) {
        assert.throws(() => validateTourOptions(bad, 8));
    }
    assert.doesNotThrow(() => validateTourOptions({ ...options, paths: ['src', 'docs/guide.md'], inferred: [TourOptionField.Depth] }, 8));
    assert.doesNotThrow(() => validateTourOptions({ ...options, emphasis: [], inferred: [TourOptionField.Emphasis] }, 8));
    const prompt = buildWorkspacePrompt('historical');
    assert.match(prompt, /Infer omitted depth, audience, familiarity, coverage, and emphasis/);
    assert.match(prompt, /Explicit user choices take precedence/);
    assert.match(prompt, /Never infer authorship from Git/);
});
