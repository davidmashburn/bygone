const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTwoWayDiffModel } = require('../out/diffEngine');
const { analyzeMoves, formatMoveAnalysis } = require('../out/moveTracking');
const corpus = require('./moveTrackingCorpus');

const { textOf } = corpus;
const range = ([start, end]) => ({ start, end });
const shape = analysis => ({
    relations: analysis.relations.map(({ kind, source, destination }) => ({ kind, source, destination })),
    unresolved: analysis.unresolved.map(({ reason, sources, destinations }) => ({ reason, sources, destinations }))
});
const expected = outcome => ({
    relations: outcome.relations.map(r => ({ kind: r.kind, source: range(r.source), destination: range(r.destination) })),
    unresolved: outcome.unresolved.map(u => ({ reason: u.reason, sources: u.sources.map(range), destinations: u.destinations.map(range) }))
});

function assertInvariants(analysis, left, right) {
    const model = buildTwoWayDiffModel(left, right);
    const { raw, interpreted: i } = analysis.accounting;
    assert.equal(i.movedDestination + i.copiedDestination + i.modifiedAdded + i.added + i.unresolvedAdded, raw.added,
        'every raw added line belongs to exactly one interpreted category');
    assert.equal(i.movedSource + i.modifiedRemoved + i.removed + i.unresolvedRemoved, raw.removed,
        'every raw removed line belongs to exactly one interpreted category');
    assert.equal(raw.added, model.rightLines.filter(line => line.kind === 'added').length);
    assert.equal(raw.removed, model.leftLines.filter(line => line.kind === 'removed').length);
    const owned = new Set();
    for (const relation of analysis.relations) {
        for (let line = relation.destination.start; line < relation.destination.end; line++) {
            assert.ok(!owned.has(line), `destination line ${line} has one incoming relation`);
            owned.add(line);
            assert.equal(model.rightLines[line].kind, 'added', 'destinations are raw additions');
        }
        const sourceKinds = new Set(model.leftLines.slice(relation.source.start, relation.source.end).map(line => line.kind));
        assert.deepEqual([...sourceKinds], [relation.kind === 'move' ? 'removed' : 'context'],
            'moves consume removed text; copies reference retained text');
        assert.deepEqual(model.leftLines.slice(relation.source.start, relation.source.end).map(line => line.content),
            model.rightLines.slice(relation.destination.start, relation.destination.end).map(line => line.content),
            'exact relations join identical text');
    }
    const moveSources = analysis.relations.filter(relation => relation.kind === 'move').map(relation => relation.source);
    for (const [index, a] of moveSources.entries()) {
        for (const b of moveSources.slice(index + 1)) assert.ok(a.end <= b.start || b.end <= a.start, 'a removed source has one continuation');
    }
}

for (const testCase of corpus) {
    test(`move corpus: ${testCase.name}`, () => {
        const left = textOf(testCase, 'left');
        const right = textOf(testCase, 'right');
        const analysis = analyzeMoves(left, right);
        assert.equal(analysis.status, 'complete');
        const actual = shape(analysis);
        const options = (testCase.exact.alternatives || [testCase.exact]).map(expected);
        assert.ok(options.some(option => {
            try { assert.deepEqual(actual, option); return true; } catch { return false; }
        }), `unexpected relations:\n${formatMoveAnalysis(analysis)}`);
        assertInvariants(analysis, left, right);
        for (const [key, value] of Object.entries(testCase.accounting || {})) {
            assert.equal(analysis.accounting.interpreted[key], value, `${key} accounting`);
        }
    });
}

test('swapping comparison direction mirrors an exact move', () => {
    const testCase = corpus.find(item => item.name.startsWith('exact move down'));
    const forward = analyzeMoves(textOf(testCase, 'left'), textOf(testCase, 'right'));
    const reverse = analyzeMoves(textOf(testCase, 'right'), textOf(testCase, 'left'));
    assert.deepEqual(reverse.relations.map(r => [r.kind, r.source, r.destination]),
        forward.relations.map(r => [r.kind, r.destination, r.source]));
});

test('identical input yields no relations and no raw changes', () => {
    const text = corpus[0].left.join('\n');
    const analysis = analyzeMoves(text, text);
    assert.deepEqual(analysis.relations, []);
    assert.deepEqual(analysis.accounting.raw, { added: 0, removed: 0 });
});

test('a fallback diff makes move analysis unavailable rather than reporting no moves', () => {
    const testCase = corpus[0];
    const left = textOf(testCase, 'left');
    const right = textOf(testCase, 'right');
    const model = { ...buildTwoWayDiffModel(left, right), quality: 'fallback' };
    const analysis = analyzeMoves(left, right, { model });
    assert.equal(analysis.status, 'unavailable');
    assert.equal(analysis.reason, 'fallback-diff');
    assert.deepEqual(analysis.relations, []);
});

test('exhausting the deterministic work budget is unavailable, not partial evidence', () => {
    const testCase = corpus.find(item => item.name.startsWith('move plus copy'));
    const analysis = analyzeMoves(textOf(testCase, 'left'), textOf(testCase, 'right'), { policy: { maxCandidatePairs: 1 } });
    assert.equal(analysis.status, 'unavailable');
    assert.equal(analysis.reason, 'work-budget');
    assert.equal(analysis.accounting.interpreted.added, analysis.accounting.raw.added);
});

test('relation IDs and output are deterministic for the same input and policy', () => {
    const testCase = corpus.find(item => item.name.startsWith('move plus copy'));
    const run = () => formatMoveAnalysis(analyzeMoves(textOf(testCase, 'left'), textOf(testCase, 'right')));
    assert.equal(run(), run());
    assert.match(run(), /^M1 move L2-5 → R14-17$/m);
    assert.match(run(), /^C2 copy L13-16 → R18-21 \(source retained\)$/m);
});
