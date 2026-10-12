const assert = require('node:assert/strict');
const { test } = require('node:test');
const { exportFixture } = require('./exportFixture');
const { buildChangeTourManifest, parseChangeTourSource } = require('../out/changeTour');
const { captureTourFeedback, buildTourFeedbackRequest } = require('../out/tourFeedback');

test('feedback freezes the reading position and distinguishes authored from explored evidence', () => {
    const f = exportFixture({ multipleFocuses: true });
    try {
        f.source.tours.historical.opening = { title: 'Expected behavior', summary: 'Update the changed line while preserving other lines.', bullets: [] };
        f.source.tours.deconstructed.opening = { title: 'Stage expectation', summary: 'Explain how the endpoint is constructed.', bullets: [] };
        f.source.tours.historical.chapters[0].scenes[0].steps[0].requirement = { id: 'expected', text: 'Preserve the changed behavior', status: 'fulfilled' };
        f.source.tours.historical.chapters[0].scenes[0].overview = { kind: 'directory-diff', purpose: 'Show why the line changed.' };
        const manifest = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        const tour = { ...manifest, ...manifest.tours.historical };
        const item = { kind: 'step', sceneIndex: 0, stepIndex: 0, key: 'step:scene:step' };
        const snapshot = captureTourFeedback(tour, item, {
            mode: 'historical', location: 'https://example.test/#part=step',
            displayedEvidence: { kind: 'real', comparisonKey: '["real","other","head"]', labels: ['other', 'head'], scope: 'elsewhere.txt', scopeKey: 'elsewhere.txt', overview: false }
        });
        const captured = JSON.parse(snapshot);
        assert.deepEqual(captured.section, { kind: 'step', chapter: 'chapter', scene: 'scene', step: 'step' });
        assert.deepEqual(captured.opening, tour.opening);
        tour.opening.summary = 'Changed later';
        assert.equal(captured.focus.excerpt, 'BETA');
        assert.equal(captured.passage.requirement.text, 'Preserve the changed behavior');
        assert.equal(captured.sceneContext.title, 'Scene');
        assert.equal(captured.authoredEvidence.scope, 'app.txt');
        assert.equal(captured.displayedEvidence.scope, 'elsewhere.txt');
        assert.equal(captured.range.headOid, f.head);
        const sceneContext = JSON.parse(captureTourFeedback(tour, { ...item, kind: 'scene' }, { mode: 'historical', location: 'test' }));
        assert.equal(sceneContext.passage.overview.purpose, 'Show why the line changed.');
        assert.ok(!snapshot.includes('leftContent'), 'Full source snapshots are not copied');
        tour.scenes[0].steps[0].body = 'Changed later';
        const request = buildTourFeedbackRequest('question', 'Why is this safe?', snapshot);
        assert.match(request, /Why is this safe/);
        assert.ok(!request.includes('Changed later'));
        assert.match(request, /existing task authorization/);
        for (const kind of ['title', 'conclusion']) {
            const context = JSON.parse(captureTourFeedback(tour, { kind, key: kind, sceneIndex: 0, stepIndex: 0 }, { mode: 'historical', location: 'test' }));
            assert.equal(context.section.scene, undefined);
            assert.equal(context.focus, undefined);
            assert.equal(context.authoredEvidence, null);
        }
        const synthetic = { ...manifest, ...manifest.tours.deconstructed };
        const context = JSON.parse(captureTourFeedback(synthetic, item, { mode: 'deconstructed', location: 'test' }));
        assert.deepEqual(context.opening, synthetic.opening);
        assert.notEqual(context.opening.summary, captured.opening.summary);
        assert.equal(context.authoredEvidence.kind, 'synthetic');
        assert.equal(context.focus.path, 'app.txt');
        assert.deepEqual(context.sceneRange, synthetic.scenes[0].realRange);
        const continuation = JSON.parse(captureTourFeedback(synthetic, { ...item, stepIndex: 1 }, { mode: 'deconstructed', location: 'test' }));
        assert.equal(continuation.stageExplanation.body, synthetic.scenes[0].steps[0].body);
        assert.equal(continuation.section.step, synthetic.scenes[0].steps[1].id);
        tour.scenes[0].steps[0].image = { path: 'diagram.png', revision: f.head, alt: 'The changed flow', dataUrl: 'data:image/png;base64,omitted' };
        const imageContext = JSON.parse(captureTourFeedback(tour, item, { mode: 'historical', location: 'test', imageVisible: true, displayedEvidence: null }));
        assert.deepEqual(imageContext.image, { path: 'diagram.png', revision: f.head, alt: 'The changed flow', displayed: true });
        assert.equal(imageContext.displayedEvidence, null);
        assert.ok(!JSON.stringify(imageContext).includes('base64'), 'Image bytes are not copied');
    } finally { f.dispose(); }
});
