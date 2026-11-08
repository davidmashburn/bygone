const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

const modulePath = process.env.BYGONE_TOUR_RELATED_MODULE
    || path.join(__dirname, '../out/tourRelated.js');
const {
    createTourRelatedIndex,
    getTourRelatedAuthoredModes,
    queryTourRelated,
    resolveTourRelatedTarget,
    TOUR_RELATED_QUERY_KIND,
    TOUR_RELATED_RESULT_KIND,
    TOUR_RELATED_TARGET_RESULT_KIND,
    TOUR_RELATED_UNAVAILABLE_REASON,
    TOUR_RELATED_UNSUPPORTED_REASON
} = require(modulePath);

const BASE_OID = 'base-oid';
const HEAD_OID = 'head-oid';

function anchor(pathname, revision, startLine, endLine) {
    return { id: `${pathname}:${revision}:${startLine}`, path: pathname, revision, startLine, endLine, excerpt: 'line' };
}

function walkthroughStep(id, focus, extra = {}) {
    return {
        id,
        title: extra.title || `Step ${id}`,
        body: extra.body || `Explanation for ${id}.`,
        focus,
        diff: {},
        ...extra
    };
}

function stackPanel(id, oid, label = id) {
    return { id, ref: id, oid, label };
}

function filePanel(id, pathname, exists = true) {
    return { id, label: id, path: pathname, content: '', exists };
}

function baseManifest(overrides = {}) {
    return {
        version: 7,
        title: 'Related explanations fixture',
        generatedAt: '2026-11-07T00:00:00.000Z',
        repository: { root: 'repo/document' },
        range: {
            baseRef: 'base',
            headRef: 'head',
            mergeBaseOid: BASE_OID,
            headOid: HEAD_OID
        },
        summary: { changedFiles: 0, includedScenes: 0, additions: 0, deletions: 0, commitCount: 0, omittedFiles: [] },
        commits: [],
        files: [],
        chapters: [],
        scenes: [],
        ...overrides
    };
}

function chapter(id, title, sceneIds) {
    return { id, title, summary: `${title} summary`, sceneIds };
}

function fixtureManifest() {
    const walkthrough = {
        id: 'walkthrough',
        kind: 'walkthrough',
        title: 'Walkthrough title',
        summary: 'Walkthrough summary',
        bullets: [],
        takeaway: '',
        steps: [
            walkthroughStep('old-side', anchor('src/renamed.ts', 'base', 10, 12), {
                title: 'Old-side explanation'
            }),
            walkthroughStep('connection-step', anchor('src/new.ts', 'head', 20, 22), {
                title: 'Connection explanation',
                connection: {
                    id: 'connection',
                    label: 'Secondary connection evidence',
                    from: anchor('src/old.ts', 'base', 30, 31),
                    to: anchor('src/new.ts', 'head', 40, 42)
                }
            }),
            walkthroughStep('optional-step', anchor('src/new.ts', 'head', 50, 51), {
                title: 'Optional explanation',
                branch: { id: 'branch', title: 'Optional path', parentStepId: 'connection-step' }
            }),
            walkthroughStep('backslash-path', anchor('a\\b', 'head', 7, 8), {
                title: 'Backslash path explanation'
            })
        ]
    };
    const stack = {
        id: 'stack',
        kind: 'stacked-diff',
        title: 'Stack title',
        summary: 'Stack summary',
        bullets: [],
        takeaway: '',
        stack: [stackPanel('stack-base', 'stack-base-oid'), stackPanel('stack-head', 'stack-head-oid')],
        files: [{
            path: 'src/renamed.ts',
            panels: [filePanel('stack-file-base', 'src/old.ts'), filePanel('stack-file-head', 'src/new.ts')]
        }, {
            path: 'src/absent.ts',
            panels: [filePanel('absent-base', 'src/absent.ts', false), filePanel('absent-head', 'src/absent.ts')]
        }],
        steps: [
            { id: 'stack-step', title: 'Stack explanation', body: 'Stack body', file: 'src/renamed.ts', pairIndex: 0, side: 'right', startLine: 60, endLine: 62 },
            { id: 'absent-step', title: 'Absent side', body: 'Should not index', file: 'src/absent.ts', pairIndex: 0, side: 'left', startLine: 70, endLine: 72 },
            { id: 'unbounded-step', title: 'Unbounded file step', body: 'Should not match whole file', file: 'src/renamed.ts', pairIndex: 0, side: 'right' }
        ]
    };
    const synthetic = {
        id: 'synthetic',
        kind: 'deconstructed-diff',
        title: 'Synthetic title',
        summary: 'Synthetic summary',
        bullets: [],
        takeaway: '',
        stageLabel: 'Explanation stages',
        realRange: { baseRef: 'base', targetRef: 'head', baseOid: BASE_OID, targetOid: HEAD_OID },
        panels: [
            { id: 'synthetic-base', label: 'Baseline', role: 'baseline' },
            { id: 'synthetic-stage', label: 'Stage', role: 'stage', stageId: 'stage-1' }
        ],
        files: [{
            path: 'src/synthetic.ts',
            panels: [filePanel('synthetic-file-base', 'src/synthetic.ts'), filePanel('synthetic-file-stage', 'src/synthetic.ts')]
        }, {
            path: 'src/synthetic-absent.ts',
            panels: [filePanel('synthetic-absent-base', 'src/synthetic-absent.ts'), filePanel('synthetic-absent-stage', 'src/synthetic-absent.ts', false)]
        }],
        steps: [
            { id: 'synthetic-step', title: 'Synthetic explanation', body: 'Synthetic body', file: 'src/synthetic.ts', pairIndex: 0, side: 'right', startLine: 80, endLine: 82, introducedHunks: [] },
            { id: 'synthetic-absent-step', title: 'Absent synthetic side', body: 'Should not index', file: 'src/synthetic-absent.ts', pairIndex: 0, side: 'right', startLine: 90, endLine: 92, introducedHunks: [] }
        ]
    };
    const historical = {
        title: 'Historical',
        chapters: [chapter('chapter-one', 'Chapter One', ['walkthrough', 'stack'])],
        scenes: [walkthrough, stack]
    };
    const deconstructed = {
        title: 'Deconstructed',
        chapters: [chapter('chapter-two', 'Chapter Two', ['synthetic'])],
        scenes: [synthetic]
    };
    return baseManifest({
        scenes: [walkthroughStep('ignored-root', anchor('ignored.ts', 'head', 1, 1))],
        tours: { historical, deconstructed }
    });
}

function queryReal(panePath, commit, side, startLine, endLine) {
    return { panePath, commit, side, startLine, endLine };
}

function querySynthetic(panePath, mode, sceneId, panelId, side, startLine, endLine) {
    return { panePath, synthetic: { mode, sceneId, panelId }, side, startLine, endLine };
}

test('indexes authored modes, exact source identity, connections, branches, and real stacks', () => {
    const manifest = fixtureManifest();
    const index = createTourRelatedIndex(manifest);
    assert.deepEqual(getTourRelatedAuthoredModes(manifest), ['historical', 'deconstructed']);
    assert.equal(createTourRelatedIndex(manifest), index, 'same loaded manifest reuses its index');
    assert.equal(index.steps.some(step => step.stepId === 'ignored-root'), false, 'explicit tours hide generated root scenes');

    const oldSide = queryTourRelated(index, queryReal('src/renamed.ts', BASE_OID, 'left', 12, 12));
    assert.equal(oldSide.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.deepEqual(oldSide.matches.map(match => match.stepId), ['old-side']);
    assert.match(oldSide.matches[0].label, /historical.*Chapter One.*Walkthrough title.*Old-side explanation/);
    const optional = index.steps.find(step => step.stepId === 'optional-step');
    assert.match(optional.label, /Optional path/);
    assert.equal(optional.preview, 'Explanation for optional-step.');

    const connection = queryTourRelated(index, queryReal('src/old.ts', BASE_OID, 'left', 30, 30));
    assert.equal(connection.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.equal(connection.matches.length, 1, 'secondary connection evidence still returns one step');
    assert.equal(connection.matches[0].evidence.kind, TOUR_RELATED_QUERY_KIND.REAL);
    assert.equal(connection.matches[0].references.some(reference => reference.role === 'connection-from'), true);

    const wrongOid = queryTourRelated(index, queryReal('src/renamed.ts', HEAD_OID, 'left', 10, 12));
    assert.equal(wrongOid.kind, TOUR_RELATED_RESULT_KIND.NO_MATCH, 'equal lines on another OID do not match');
    const wrongSeparator = queryTourRelated(index, queryReal('a/b', HEAD_OID, 'right', 7, 8));
    assert.equal(wrongSeparator.kind, TOUR_RELATED_RESULT_KIND.NO_MATCH, 'backslash and slash paths stay distinct');
    const exactBackslash = queryTourRelated(index, queryReal('a\\b', HEAD_OID, 'right', 8, 8));
    assert.equal(exactBackslash.kind, TOUR_RELATED_RESULT_KIND.MATCHES);

    const stack = queryTourRelated(index, queryReal('src/new.ts', 'stack-head-oid', 'right', 61, 61));
    assert.equal(stack.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.deepEqual(stack.matches.map(match => match.stepId), ['stack-step']);

    const absent = queryTourRelated(index, queryReal('src/absent.ts', 'stack-base-oid', 'left', 70, 72));
    assert.equal(absent.kind, TOUR_RELATED_RESULT_KIND.NO_MATCH, 'absent stack file panels are not evidence');
    const unbounded = queryTourRelated(index, queryReal('src/new.ts', 'stack-head-oid', 'right', 1, 1000));
    assert.equal(unbounded.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.equal(unbounded.matches.some(match => match.stepId === 'unbounded-step'), false, 'unbounded stack steps have no whole-file fallback');
});

test('matches synthetic source identity without a commit and rejects mixed identity', () => {
    const manifest = fixtureManifest();
    const index = createTourRelatedIndex(manifest);
    const synthetic = queryTourRelated(index, querySynthetic(
        'src/synthetic.ts', 'deconstructed', 'synthetic', 'synthetic-stage', 'right', 82, 82
    ));
    assert.equal(synthetic.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.deepEqual(synthetic.matches.map(match => match.target), [{
        mode: 'deconstructed', sceneId: 'synthetic', stepId: 'synthetic-step'
    }]);
    assert.equal(synthetic.matches[0].evidence.kind, TOUR_RELATED_QUERY_KIND.SYNTHETIC);

    const mixed = queryTourRelated(index, {
        ...querySynthetic('src/synthetic.ts', 'deconstructed', 'synthetic', 'synthetic-stage', 'right', 80, 82),
        commit: HEAD_OID
    });
    assert.deepEqual(mixed, { kind: TOUR_RELATED_RESULT_KIND.UNSUPPORTED, reason: TOUR_RELATED_UNSUPPORTED_REASON.SYNTHETIC_COMMIT });

    const absent = queryTourRelated(index, querySynthetic(
        'src/synthetic-absent.ts', 'deconstructed', 'synthetic', 'synthetic-stage', 'right', 90, 92
    ));
    assert.equal(absent.kind, TOUR_RELATED_RESULT_KIND.NO_MATCH, 'absent synthetic file panels are not evidence');
});

test('resolves stable targets after retitle/reorder and exposes optional parent navigation', () => {
    const manifest = fixtureManifest();
    const target = { mode: 'historical', sceneId: 'walkthrough', stepId: 'optional-step' };
    const resolved = resolveTourRelatedTarget(manifest, target);
    assert.equal(resolved.kind, TOUR_RELATED_TARGET_RESULT_KIND.RESOLVED);
    assert.equal(resolved.readingKey, 'step:walkthrough:optional-step');
    assert.deepEqual(resolved.parentTarget, {
        mode: 'historical', sceneId: 'walkthrough', stepId: 'connection-step'
    });
    assert.equal(resolved.branch.title, 'Optional path');

    const refreshed = structuredClone(manifest);
    refreshed.tours.historical.scenes[0].title = 'Retitled walkthrough';
    refreshed.tours.historical.scenes[0].steps.reverse();
    const moved = resolveTourRelatedTarget(refreshed, target);
    assert.equal(moved.kind, TOUR_RELATED_TARGET_RESULT_KIND.RESOLVED);
    assert.equal(moved.stepIndex, 1, 'stable step id survives authored reorder');
    assert.equal(moved.sceneIndex, 0);
    assert.equal(resolveTourRelatedTarget(refreshed, { mode: 'historical', sceneId: 'missing', stepId: 'x' }).kind,
        TOUR_RELATED_TARGET_RESULT_KIND.UNAVAILABLE);
});

test('distinguishes stale, unavailable, unsupported, and no-range queries', () => {
    const manifest = fixtureManifest();
    const index = createTourRelatedIndex(manifest);
    const refreshed = structuredClone(manifest);
    assert.deepEqual(queryTourRelated(index, queryReal('src/renamed.ts', BASE_OID, 'left', 10, 12), {
        currentManifest: refreshed
    }), { kind: TOUR_RELATED_RESULT_KIND.UNAVAILABLE, reason: TOUR_RELATED_UNAVAILABLE_REASON.STALE_INDEX });
    assert.deepEqual(queryTourRelated(index, { panePath: 'src/renamed.ts', commit: BASE_OID, side: 'left' }), {
        kind: TOUR_RELATED_RESULT_KIND.UNAVAILABLE,
        reason: TOUR_RELATED_UNAVAILABLE_REASON.MISSING_RANGE
    });
    assert.deepEqual(queryTourRelated(index, { panePath: 'src/renamed.ts', side: 'left', startLine: 10, endLine: 12 }), {
        kind: TOUR_RELATED_RESULT_KIND.UNAVAILABLE,
        reason: TOUR_RELATED_UNAVAILABLE_REASON.MISSING_COMMIT
    });
    assert.deepEqual(queryTourRelated(index, {
        panePath: 'src/renamed.ts', commit: BASE_OID, side: 'left', startLine: 12, endLine: 10
    }), { kind: TOUR_RELATED_RESULT_KIND.UNAVAILABLE, reason: TOUR_RELATED_UNAVAILABLE_REASON.INVALID_RANGE });
});

test('returns every matching step instead of silently capping a large authored tour', () => {
    const steps = Array.from({ length: 5001 }, (_, index) => walkthroughStep(
        `bulk-${index}`, anchor('bulk.ts', 'head', index + 1, index + 1)
    ));
    const scene = {
        id: 'bulk', kind: 'walkthrough', title: 'Bulk scene', summary: 'Bulk summary', bullets: [], takeaway: '', steps
    };
    const manifest = baseManifest({
        scenes: [],
        tours: { historical: { title: 'Historical', chapters: [chapter('bulk-chapter', 'Bulk', ['bulk'])], scenes: [scene] } }
    });
    const index = createTourRelatedIndex(manifest);
    const result = queryTourRelated(index, queryReal('bulk.ts', HEAD_OID, 'right', 1, 5001));
    assert.equal(result.kind, TOUR_RELATED_RESULT_KIND.MATCHES);
    assert.equal(result.matches.length, 5001);
});
