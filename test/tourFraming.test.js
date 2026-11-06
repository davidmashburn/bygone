const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { exportFixture } = require('./exportFixture');
const { materializeTour } = require('../cli/tourExport');
const { parseChangeTourSource, buildChangeTourManifest, parseChangeTourManifest } = require('../out/changeTour');
const { buildTourReadingItems, getTourReadingTarget, resolveTourReadingItem } = require('../out/tourReading');
const { buildReadingNarrationUnit, buildTourNarrationUnit, getTourNarrationCost, normalizeNarrationSpeech } = require('../out/tourNarration');
const { buildTourRoute, describeStepOrientation, tourLanding, resolveTourEvidenceContext, describeTourTransition } = require('../out/tourOrientation');
const { parseDocumentFragment, serializeDocumentFragment, resolveDocumentFocus } = require('../out/deepLink');
const { searchTour } = require('../out/tourSearch');
const passage = title => ({ title, summary: `${title} summary.`, bullets: [`${title} point.`] });
const clone = value => JSON.parse(JSON.stringify(value));

test('inline links speak their labels without dropping surrounding prose or moving highlight offsets', () => {
    assert.equal(normalizeNarrationSpeech('Read [the release](https://example.test/release_(stable)), then continue.'),
        'Read the release, then continue.');
    assert.equal(normalizeNarrationSpeech('[First](https://example.test/a) and [second](https://example.test/b).'), 'First and second.');
    const body = `Read [the release note](https://example.test/${'long-path-'.repeat(80)}) before proceeding. Next sentence.`;
    const tour = { title: 'Tour', range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) },
        chapters: [], scenes: [{ id: 's', kind: 'walkthrough', title: 'Scene',
        summary: '', bullets: [], tags: [], takeaway: '', steps: [{ id: 'a', title: 'Read evidence', body }] }] };
    const item = buildTourReadingItems(tour).find(item => item.kind === 'step');
    for (const entry of ['continuous', 'playback-start']) {
        const segments = buildReadingNarrationUnit(tour, item, { entry }).segments.filter(segment => segment.source.field === 'step-body');
        assert.equal(segments.map(segment => segment.speechText).join(' '), 'Read the release note before proceeding. Next sentence.');
        assert.ok(segments.every(segment => segment.text === body.slice(segment.startOffset, segment.endOffset)), 'highlight offsets still address original Markdown');
        assert.ok(segments.every(segment => segment.speechText.length > 0), 'URL-only segments are omitted');
    }
});

function framedSource(f) {
    const source = clone(f.source);
    source.version = 5;
    source.opening = passage('Root opening');
    source.conclusion = passage('Root conclusion');
    source.tours.historical.opening = passage('Historical opening');
    source.tours.historical.conclusion = passage('Historical conclusion');
    source.tours.deconstructed.conclusion = passage('Synthetic conclusion');
    return source;
}

test('v5 validates bookends and explicit overview purpose without changing legacy sources', () => {
    const f = exportFixture();
    try {
        const source = framedSource(f);
        const parse = input => parseChangeTourSource(input);
        assert.equal(parse(source).version, 5);
        for (const invalid of [null, {}, { title: ' ', summary: 'x' }, { title: 'x', summary: ' ' }, { ...passage('x'), bullets: [' '] }, { ...passage('x'), steps: [] }]) {
            const copy = clone(source); copy.opening = invalid;
            assert.throws(() => parse(copy), /opening/);
        }
        const old = clone(source); old.version = 4;
        assert.throws(() => parse(old), /version 5/);
        const overview = clone(source);
        overview.chapters[0].scenes[0].overview = { kind: 'directory-diff' };
        assert.throws(() => parse(overview), /purpose/);
        overview.chapters[0].scenes[0].overview.purpose = 'Compare the distribution of changes before reading the guard.';
        assert.ok(parse(overview));
        const legacy = clone(f.source); legacy.version = 4;
        delete legacy.tours.historical.opening; delete legacy.tours.historical.conclusion;
        legacy.chapters[0].scenes[0].overview = { kind: 'directory-diff' };
        assert.equal(parse(legacy).version, 4);
        legacy.chapters[0].scenes[0].overview.purpose = 'New field';
        assert.throws(() => parse(legacy), /version 5/);
        const compiled = buildChangeTourManifest(f.root, { source: parse(source) });
        assert.deepEqual(compiled.opening, source.opening);
        const unframed = clone(source);
        for (const narrative of [unframed, ...Object.values(unframed.tours)]) { delete narrative.opening; delete narrative.conclusion; }
        const baseline = buildChangeTourManifest(f.root, { source: parse(unframed) });
        assert.deepEqual(compiled.summary, baseline.summary, 'Bookends add no files or evidence counts');
        const { buildTourCoverageReport } = require('../out/tourCoverage');
        assert.deepEqual(buildTourCoverageReport(f.root, source), buildTourCoverageReport(f.root, unframed));
        assert.deepEqual(compiled.tours.historical.conclusion, source.tours.historical.conclusion);
        assert.equal(compiled.tours.deconstructed.opening, undefined, 'Modes do not inherit another narrative’s opening');
        assert.ok(parseChangeTourManifest(compiled));
        const badManifest = clone(compiled); badManifest.tours.historical.conclusion.summary = '';
        assert.throws(() => parseChangeTourManifest(badManifest), /conclusion.summary/);
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(f.sourcePath, profile);
            assert.deepEqual(exported.manifest.tours.historical.conclusion, source.tours.historical.conclusion);
        }
    } finally { f.dispose(); }
});

test('bookends are reading locations, searchable and linkable, including image-only guides', () => {
    const tour = { title: 'Tour', opening: passage('Welcome'), conclusion: passage('Recap'),
        chapters: [{ id: 'c', title: 'Chapter', summary: 'Preview the images.', sceneIds: ['s'] }], scenes: [{ id: 's', kind: 'walkthrough',
            title: 'Scene', overview: { purpose: 'See the inventory.' }, summary: 'Purpose.', bullets: ['Notice.'], tags: [], takeaway: 'Result.',
            steps: [{ id: 'a', title: 'First', body: 'First evidence.', image: {} }, { id: 'b', title: 'Second', body: 'Second evidence.', image: {} }] }] };
    const items = buildTourReadingItems(tour);
    assert.equal(items.at(-1).kind, 'conclusion');
    assert.equal(getTourReadingTarget(items, 'step:s:b', 1, true).key, 'conclusion');
    assert.equal(getTourReadingTarget(items, 'step:s:a', -1, true).key, 'title');
    assert.equal(getTourReadingTarget(items, 'conclusion', 1), null);
    assert.equal(resolveTourReadingItem(items, -1, 0, 'conclusion').key, 'conclusion');
    const spoken = items.flatMap(item => buildReadingNarrationUnit(tour, item, { entry: 'continuous' }).segments.map(segment => segment.text));
    for (const text of ['Welcome summary.', 'Preview the images.', 'See the inventory.', 'First evidence.', 'Second evidence.', 'Result.', 'Recap summary.']) {
        assert.equal(spoken.filter(value => value === text).length, 1, `${text} is narrated once`);
    }
    const direct = buildReadingNarrationUnit(tour, items.find(item => item.key === 'step:s:b'), { entry: 'playback-start' });
    assert.deepEqual(direct.segments.map(segment => segment.text), ['Scene', 'Second', 'Step 2 of 2.', 'Image: Second.', 'Second evidence.', 'Result.']);
    assert.equal(direct.position, undefined);
    const modeTour = { ...tour, tours: { historical: tour, deconstructed: { ...tour, conclusion: undefined } } };
    const fragment = serializeDocumentFragment('historical', { part: 'conclusion' });
    assert.deepEqual(parseDocumentFragment(fragment).focus, { part: 'conclusion' });
    assert.equal(resolveDocumentFocus(modeTour, 'historical', { part: 'conclusion' }).key, 'conclusion');
    assert.throws(() => resolveDocumentFocus(modeTour, 'deconstructed', { part: 'conclusion' }), /unavailable/);
    assert.equal(searchTour({ ...tour, files: [] }, 'Recap', 'narrative')[0].readingKey, 'conclusion');
    assert.equal(searchTour({ ...tour, files: [] }, 'Preview the images', 'narrative')[0].readingKey, 'chapter:c');
});

test('optional narrative search keys reveal ancestry without changing main matches', () => {
    const tour = {
        chapters: [], files: [], scenes: [{ id: 'scene', kind: 'walkthrough', title: 'Scene', summary: 'Summary', bullets: [], tags: [], takeaway: 'Takeaway', steps: [
            { id: 'main', title: 'Main step', body: 'Main body.', diff: { path: 'main.ts' } },
            { id: 'optional', title: 'Alternate step', body: 'Alternate body.', diff: { path: 'alternate.ts' }, branch: {
                id: 'alternate', title: 'Explore alternate', parentStepId: 'main'
            } }
        ] }]
    };
    const optional = searchTour(tour, 'alternate body', 'narrative').find(match => match.stepIndex === 1);
    assert.equal(optional.readingKey, 'step:scene:optional');
    const main = searchTour(tour, 'main body', 'narrative').find(match => match.stepIndex === 0);
    assert.equal(Object.hasOwn(main, 'readingKey'), false, 'Main search results retain their legacy shape');
});

test('orientation and narration use main counts while optional playback stays branch-local', () => {
    const tour = {
        range: { mergeBaseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), baseRef: 'base', headRef: 'head' },
        chapters: [{ id: 'chapter', title: 'Chapter', sceneIds: ['scene'] }],
        scenes: [{ id: 'scene', kind: 'walkthrough', title: 'Scene', summary: 'Summary', bullets: [], tags: [], takeaway: 'Scene takeaway', steps: [
            { id: 'main-before', title: 'Main before', body: 'Before.', diff: { path: 'main.ts' } },
            { id: 'optional', title: 'Optional', body: 'Optional.', diff: { path: 'optional.ts' }, branch: {
                id: 'optional', title: 'Explore optional', parentStepId: 'main-before'
            } },
            { id: 'main-after', title: 'Main after', body: 'After.', diff: { path: 'main.ts' } }
        ] }]
    };
    const mainItems = buildTourReadingItems(tour);
    const branchItems = buildTourReadingItems(tour, { sceneIndex: 0, branchId: 'optional' });
    const route = buildTourRoute(tour);
    assert.match(route.summary, /2 steps/);
    assert.doesNotMatch(route.scenes[0].evidence, /optional\.ts/);
    assert.match(describeStepOrientation(tour, 0, 2), /^Step 2 of 2\./);
    assert.match(describeStepOrientation(tour, 0, 1), /^Step 1 of 1\./);

    const mainNarration = buildReadingNarrationUnit(tour, mainItems.find(item => item.key === 'step:scene:main-after'), {
        entry: 'continuous', activeItems: mainItems
    });
    assert.equal(mainNarration.segments.some(segment => segment.text === 'Scene takeaway'), true);
    const branchNarration = buildReadingNarrationUnit(tour, branchItems[0], {
        entry: 'continuous', activeItems: branchItems
    });
    assert.equal(branchNarration.segments.some(segment => segment.text === 'Scene takeaway'), false);
    const legacyBranchNarration = buildTourNarrationUnit(tour, { sceneIndex: 0, stepIndex: 1 }, { entry: 'continuous' });
    assert.equal(legacyBranchNarration.segments.some(segment => segment.text === 'Scene takeaway'), false);
});

test('scene landings and transition identity use actual revisions and distinguish synthetic stages', () => {
    const tour = { range: { mergeBaseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), baseRef: 'base', headRef: 'head' },
        files: [], scenes: [{ id: 's', kind: 'walkthrough', steps: [{ diff: { path: 'app.ts' } }] }] };
    const intro = { kind: 'scene', sceneIndex: 0, stepIndex: 0 };
    const step = { ...intro, kind: 'step' };
    assert.equal(tourLanding(tour, intro), 'preview');
    assert.equal(tourLanding(tour, step), 'evidence');
    assert.equal(tourLanding(tour, { kind: 'title' }), 'narrative');
    assert.equal(resolveTourEvidenceContext(tour, { kind: 'conclusion' }), null);
    const initial = resolveTourEvidenceContext(tour, intro);
    tour.scenes[0].steps[0].diff.path = 'other.ts';
    const scopeChange = resolveTourEvidenceContext(tour, intro);
    assert.match(describeTourTransition(initial, scopeChange), /Same revision comparison; file changed from app.ts to other.ts/);
    tour.range.baseRef = 'Different name';
    assert.equal(initial.comparisonKey, resolveTourEvidenceContext(tour, intro).comparisonKey);
    const reversed = clone(tour); [reversed.range.mergeBaseOid, reversed.range.headOid] = [tour.range.headOid, tour.range.mergeBaseOid];
    assert.notEqual(initial.comparisonKey, resolveTourEvidenceContext(reversed, intro).comparisonKey);
    tour.range.headOid = 'c'.repeat(40);
    const changed = resolveTourEvidenceContext(tour, intro);
    assert.notEqual(initial.comparisonKey, changed.comparisonKey, 'Same labels do not hide different OIDs');
    assert.match(describeTourTransition(initial, changed), /Revision comparison changed/);
    assert.doesNotMatch(describeTourTransition(null, changed), /Same|changed/);
    tour.scenes[0].overview = { purpose: 'See the inventory' };
    assert.equal(tourLanding(tour, intro), 'overview');
    const inventory = resolveTourEvidenceContext(tour, intro);
    tour.scenes[0].overview.path = 'src';
    assert.match(describeTourTransition(inventory, resolveTourEvidenceContext(tour, intro)), /Same revision comparison; view changed/);
    tour.scenes[0] = { id: 'stack', kind: 'stacked-diff', stack: [
        { id: 'a', label: 'Base', oid: 'a'.repeat(40) }, { id: 'b', label: 'Middle', oid: 'b'.repeat(40) }, { id: 'c', label: 'Head', oid: 'c'.repeat(40) }
    ], steps: [{ file: 'app.ts', pairIndex: 1 }] };
    assert.match(resolveTourEvidenceContext(tour, intro).labels[0], /Middle/);
    assert.match(resolveTourEvidenceContext(tour, intro, '', 0).labels[0], /Base/);
    assert.notEqual(resolveTourEvidenceContext(tour, intro).comparisonKey, resolveTourEvidenceContext(tour, intro, '', 0).comparisonKey);
    tour.scenes[0] = { ...tour.scenes[0], kind: 'deconstructed-diff', panels: tour.scenes[0].stack };
    const synthetic = resolveTourEvidenceContext(tour, intro, 'deconstructed');
    assert.match(describeTourTransition(changed, synthetic), /Switching to explanation stages/);
    tour.scenes[0].id = 'different-explanation';
    assert.notEqual(synthetic.comparisonKey, resolveTourEvidenceContext(tour, intro, 'deconstructed').comparisonKey);
});


test('the opening route separates topics, files, revision pairs, and constructed stages', () => {
    const tour = { range: { mergeBaseOid: 'a'.repeat(40), headOid: 'c'.repeat(40), baseRef: 'base', headRef: 'head' },
        scenes: [{ id: 's', title: 'Follow the request', kind: 'walkthrough', steps: [
            { id: 'a', title: 'Receive', diff: { path: 'route.ts' } },
            { id: 'b', title: 'Store', diff: { path: 'store.ts' } },
            { id: 'c', title: 'Respond', diff: { path: 'route.ts' } }
        ] }] };
    let route = buildTourRoute(tour);
    assert.match(route.summary, /scenes explain one idea/);
    assert.match(route.scenes[0].evidence, /Files in order: route.ts → store.ts → route.ts/);
    assert.match(route.scenes[0].evidence, /Revisions: base \(aaaaaaa\) → head \(ccccccc\)/);
    assert.doesNotMatch(route.scenes[0].evidence, /then/);
    assert.equal(describeStepOrientation(tour, 0, 1), 'Step 2 of 3. Keep the same revisions. Move from route.ts to store.ts.');
    tour.scenes[0] = { id: 's', title: 'Guard then recover', kind: 'stacked-diff', stack: [
        { id: 'a', label: 'Before', oid: 'a'.repeat(40) }, { id: 'b', label: 'Guard', oid: 'b'.repeat(40) }, { id: 'c', label: 'Recovery', oid: 'c'.repeat(40) }
    ], steps: [{ id: 'a', file: 'route.ts', pairIndex: 0 }, { id: 'b', file: 'route.ts', pairIndex: 1 }] };
    route = buildTourRoute(tour);
    assert.match(route.scenes[0].evidence, /File: route.ts/);
    assert.match(route.scenes[0].evidence, /; then Guard/);
    assert.match(describeStepOrientation(tour, 0, 1), /Switch revisions to Guard.*Continue in route.ts/);
    tour.scenes[0] = { ...tour.scenes[0], kind: 'deconstructed-diff', panels: tour.scenes[0].stack };
    assert.match(buildTourRoute(tour).scenes[0].evidence, /Explanation stages \(constructed, not commits\)/);
    assert.match(describeStepOrientation(tour, 0, 1), /Switch explanation stages/);
    tour.scenes[0] = { id: 'd', title: 'Decide', kind: 'discussion' };
    assert.match(buildTourRoute(tour).scenes[0].evidence, /No code comparison/);
});


test('route titles keep authored wording without outline numbering', () => {
    const tour = { range: { mergeBaseOid: 'a'.repeat(40), headOid: 'c'.repeat(40), baseRef: 'base', headRef: 'head' },
        chapters: [{ id: 'c1', title: 'Request', summary: 'Trace the request through storage.', sceneIds: ['s', 't'] }, { id: 'c2', title: 'Review', sceneIds: ['d'] }],
        scenes: [
            { id: 's', title: 'Receive', summary: 'Trace the input.', kind: 'walkthrough', steps: [{ id: 'a', title: 'Handler', diff: { path: 'route.ts' } }] },
            { id: 't', title: 'Store', summary: 'Trace persistence.', kind: 'stacked-diff', stack: [
                { id: 'a', label: 'Base', oid: 'a'.repeat(40) }, { id: 'b', label: 'Middle', oid: 'b'.repeat(40) }, { id: 'c', label: 'Head', oid: 'c'.repeat(40) }
            ], steps: [{ id: 'b', title: 'Write', file: 'store.ts', pairIndex: 1 }] },
            { id: 'd', title: 'Decide', summary: 'Weigh the tradeoffs.', kind: 'discussion' }
        ] };
    const route = buildTourRoute(tour);
    assert.match(route.summary, /2 chapters → 3 scenes → 2 steps/);
    assert.deepEqual(route.chapters.map(chapter => chapter.title), ['Request', 'Review']);
    assert.deepEqual(route.scenes.map(scene => scene.title), ['Receive', 'Store', 'Decide']);
    assert.equal(route.scenes[1].purpose, 'Trace persistence.');
    assert.match(route.chapters[0].evidence, /Focus files: route.ts, store.ts/);
    assert.match(route.chapters[0].evidence, /base \(aaaaaaa\) → head \(ccccccc\)/);
    assert.match(route.chapters[0].evidence, /Middle \(bbbbbbb\) → Head \(ccccccc\)/);
    assert.doesNotMatch(route.chapters[1].evidence, /Revisions:/);
    const spoken = buildReadingNarrationUnit(tour, { kind: 'chapter', key: 'chapter:c1', chapterId: 'c1', sceneIndex: 0, stepIndex: 0 }, { entry: 'continuous', segmentLimit: 2000 });
    assert.equal(spoken.segments.map(segment => segment.text).join(' '), [route.chapters[0].title, route.chapters[0].summary].join(' '));
    tour.scenes[1] = { ...tour.scenes[1], kind: 'deconstructed-diff', panels: tour.scenes[1].stack };
    assert.match(buildTourRoute(tour).chapters[0].evidence, /Constructed stages: Middle → Head/);
    assert.doesNotMatch(buildTourRoute(tour).chapters[0].evidence, /Revisions: Middle/);
});

test('v7 generator attribution survives compilation and export without adding narration', () => {
    const { optionalBranchesFixture } = require('./optionalBranchesFixture');
    const f = optionalBranchesFixture();
    try {
        const before = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        const generator = { model: 'example-model-1', harness: 'example-agent', effort: 'high' };
        f.source.generatedBy = generator;
        const compiled = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        assert.deepEqual(compiled.generatedBy, generator);
        assert.deepEqual(parseChangeTourManifest(compiled).generatedBy, generator);
        assert.deepEqual(getTourNarrationCost(compiled), getTourNarrationCost(before));
        fs.writeFileSync(f.sourcePath, JSON.stringify(f.source));
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(f.sourcePath, profile);
            assert.deepEqual(exported.manifest.generatedBy, generator);
        }
        for (const invalid of [{}, { model: '' }, { model: 'x', effort: 2 }, { model: 'x', author: 'unknown' }]) {
            assert.throws(() => parseChangeTourSource({ ...f.source, generatedBy: invalid }), /generatedBy/);
            assert.throws(() => parseChangeTourManifest({ ...compiled, generatedBy: invalid }), /generatedBy/);
        }
        assert.throws(() => parseChangeTourSource({ ...f.source, version: 6 }), /generatedBy requires/);
        assert.throws(() => parseChangeTourManifest({ ...compiled, version: 6 }), /generatedBy requires/);
    } finally { f.dispose(); }
});

test('continuous narration costs include framing and count nested optional paths once', () => {
    const { optionalBranchesFixture } = require('./optionalBranchesFixture');
    const f = optionalBranchesFixture();
    try {
        const manifest = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        const tour = { ...manifest, ...manifest.tours.historical };
        const before = getTourNarrationCost(tour);
        assert.equal(before.main.stops, 6, 'title, scene, three main steps, conclusion');
        assert.equal(before.optional.stops, 3, 'two parent detail steps plus one nested detail');
        const expanded = clone(tour);
        expanded.opening.summary += ' Extra opening words.';
        expanded.conclusion.summary += ' Extra conclusion words.';
        const after = getTourNarrationCost(expanded);
        assert.equal(after.main.words, before.main.words + 6);
        assert.deepEqual(after.optional, before.optional);
        const optional = expanded.scenes.flatMap(scene => scene.steps || []).find(step => step.branch);
        optional.body += ' More optional evidence.';
        const detailed = getTourNarrationCost(expanded);
        assert.deepEqual(detailed.main, after.main);
        assert.equal(detailed.optional.words, after.optional.words + 3);
    } finally { f.dispose(); }
});

test('continuous narration omits unchanged orientation but preserves file and revision changes', () => {
    const tour = {
        title: 'Follow the request', chapters: [],
        range: { mergeBaseOid: 'a'.repeat(40), headOid: 'c'.repeat(40), baseRef: 'base', headRef: 'head' },
        scenes: [{ id: 'request', title: 'Request', kind: 'walkthrough', summary: '', bullets: [], steps: [
            { id: 'first', title: 'Receive', body: 'Receive the request.', diff: { path: 'route.ts' } },
            { id: 'second', title: 'Validate', body: 'Validate the request.', diff: { path: 'route.ts' } },
            { id: 'third', title: 'Store', body: 'Store the request.', diff: { path: 'store.ts' } }
        ] }]
    };
    const orientation = (stepIndex, entry = 'continuous') => buildReadingNarrationUnit(tour,
        { kind: 'step', key: `step:request:${tour.scenes[0].steps[stepIndex].id}`, sceneIndex: 0, stepIndex }, { entry })
        .segments.filter(segment => segment.source.field === 'step-orientation').map(segment => segment.speechText).join(' ');
    assert.equal(orientation(0), 'Step 1 of 3. Evidence in route.ts.');
    assert.equal(orientation(1), 'Step 2 of 3.');
    assert.equal(orientation(1, 'playback-start'), 'Step 2 of 3. Keep the same revisions. Continue in route.ts.');
    assert.equal(orientation(2), 'Step 3 of 3. Move from route.ts to store.ts.');
    const changedFileUnit = buildReadingNarrationUnit(tour,
        { kind: 'step', key: 'step:request:third', sceneIndex: 0, stepIndex: 2 }, { entry: 'continuous', segmentLimit: 40 });
    for (const segment of changedFileUnit.segments.filter(segment => segment.source.field === 'step-orientation')) {
        assert.equal(describeStepOrientation(tour, 0, 2).slice(segment.startOffset, segment.endOffset), segment.text,
            'spoken orientation retains offsets into the full visible field');
    }
    assert.equal(describeStepOrientation(tour, 0, 1), 'Step 2 of 3. Keep the same revisions. Continue in route.ts.', 'visual orientation stays complete');
    tour.scenes[0] = { ...tour.scenes[0], kind: 'stacked-diff', stack: [
        { id: 'a', label: 'Before', oid: 'a'.repeat(40) },
        { id: 'b', label: 'Guard', oid: 'b'.repeat(40) },
        { id: 'c', label: 'Recovery', oid: 'c'.repeat(40) }
    ], steps: [
        { id: 'first', title: 'Guard', body: 'Guard.', file: 'route.ts', pairIndex: 0 },
        { id: 'second', title: 'Recover', body: 'Recover.', file: 'route.ts', pairIndex: 1 }
    ] };
    assert.match(orientation(1), /Switch revisions to Guard.*Recovery/);
    assert.doesNotMatch(orientation(1), /Continue in/);
});
