const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
    buildChangeInventory,
    buildChangeTourManifest,
    hashChangeTourSource,
    parseChangeTourManifest,
    parseChangeTourSource
} = require('../out/changeTour.js');
const { buildTourCoverageReport } = require('../out/tourCoverage.js');
const { runTourCommand } = require('../cli/tour.js');
const sourceSchema = require('../schemas/change-tour-source.schema.json');
const Ajv = require('ajv/dist/2020');

function narrative(summary) {
    return { summary, bullets: [], tags: ['test'], takeaway: summary };
}

function makeRepository() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-authored-modes-')));
    const git = (...args) => execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Bygone test');
    fs.writeFileSync(path.join(root, 'app.txt'), 'alpha\nbeta\n', 'utf8');
    git('add', '.');
    git('commit', '-m', 'base');
    git('branch', '-M', 'main');
    git('checkout', '-b', 'feature');
    fs.writeFileSync(path.join(root, 'app.txt'), 'alpha\nBETA\n', 'utf8');
    git('add', '.');
    git('commit', '-m', 'feature');
    return { root, git };
}

function makeSource(inventory) {
    const hunk = inventory.files.find((file) => file.path === 'app.txt').units[0].id;
    const stacked = {
        id: 'historical-stack',
        kind: 'stacked-diff',
        title: 'Read the real revision',
        ...narrative('The two endpoint revisions remain real Git panels.'),
        stack: [
            { id: 'base', ref: 'main', label: 'Base' },
            { id: 'head', ref: 'feature', label: 'Head' }
        ],
        files: ['app.txt'],
        steps: [{
            id: 'revision-step',
            title: 'Read the changed line',
            body: 'The endpoint stack shows the committed change.',
            file: 'app.txt',
            pair: ['base', 'head'],
            side: 'right'
        }]
    };
    const deconstructed = {
        id: 'synthetic-explanation',
        kind: 'deconstructed-diff',
        title: 'Explain the changed line',
        ...narrative('The stage panel is constructed from the authored hunk.'),
        stages: [{
            id: 'stage-one',
            title: 'Introduce the behavior',
            narration: 'Apply the changed hunk in a teaching order.',
            changes: [{ file: 'app.txt', hunks: [hunk] }]
        }]
    };
    return {
        version: 4,
        range: { base: 'main', head: 'feature' },
        anchors: {
            root: { file: 'app.txt', revision: 'head', contains: 'alpha' },
            historical: { file: 'app.txt', revision: 'head', contains: 'BETA' }
        },
        connections: [],
        chapters: [{
            id: 'root',
            title: 'Root fallback',
            scenes: [{
                id: 'root-walkthrough',
                kind: 'walkthrough',
                title: 'Root walkthrough',
                ...narrative('The compatibility tour is kept at the root.'),
                steps: [{
                    id: 'root-step',
                    title: 'Read the unchanged context',
                    body: 'This anchor deliberately does not cover the changed hunk.',
                    focus: 'root'
                }]
            }]
        }],
        tours: {
            historical: {
                chapters: [{
                    id: 'historical',
                    title: 'Historical mode',
                    scenes: [
                        stacked,
                        {
                            id: 'historical-walkthrough',
                            kind: 'walkthrough',
                            title: 'Read the historical narration',
                            ...narrative('The explicit Historical tour keeps its own narration.'),
                            steps: [{
                                id: 'historical-step',
                                title: 'Read the changed line',
                                body: 'This authored endpoint walkthrough covers the changed hunk.',
                                focus: 'historical'
                            }]
                        }
                    ]
                }]
            },
            deconstructed: {
                chapters: [{ id: 'deconstructed', title: 'Deconstructed mode', scenes: [deconstructed] }]
            }
        }
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function passage(summary) {
    return { title: summary, summary, bullets: [] };
}

function makeDetailedSource(inventory) {
    const source = makeSource(inventory);
    const staleHash = '0'.repeat(64);
    source.version = 5;
    source.opening = passage('Root opening');
    source.conclusion = passage('Root conclusion');
    source.details = {
        audience: {
            codebase: 'some',
            language: 'fluent',
            domain: ['payments'],
            readingDemand: 'technical',
            purpose: 'review',
            scope: 'The root tour explains the changed behavior.',
            estimatedMinutes: 12
        },
        assessment: {
            reviewer: 'author',
            method: 'self-review',
            assessedAt: '2026-10-12T00:00:00.000Z',
            contentHash: staleHash,
            ratings: {
                purpose: {
                    score: 2,
                    reason: 'The root purpose is explicit.',
                    references: ['opening', 'root-walkthrough/root-step']
                }
            },
            blockers: ['none']
        }
    };
    source.tours.historical.opening = passage('Historical opening');
    source.tours.historical.details = {
        audience: {
            codebase: 'some',
            language: 'fluent',
            readingDemand: 'technical',
            purpose: 'review',
            scope: 'The historical tour explains endpoint revisions.'
        },
        assessment: {
            reviewer: 'reader',
            method: 'simulated-reader',
            assessedAt: '2026-10-12T00:01:00Z',
            contentHash: staleHash,
            ratings: {
                evidence: {
                    score: 3,
                    reason: 'The endpoint evidence is directly shown.',
                    references: ['historical-walkthrough/historical-step']
                }
            }
        }
    };
    source.tours.deconstructed.conclusion = passage('Deconstructed conclusion');
    source.tours.deconstructed.details = {
        audience: {
            codebase: 'maintainer',
            language: 'advanced',
            readingDemand: 'specialist',
            purpose: 'explanation',
            scope: 'The synthetic tour explains the hunk sequence.'
        },
        assessment: {
            reviewer: 'human',
            method: 'human-reader',
            assessedAt: '2026-10-12T00:02:00+00:00',
            contentHash: staleHash,
            ratings: {
                reasoning: {
                    score: 1,
                    reason: 'The stage sequence needs another transition.',
                    references: ['synthetic-explanation', 'synthetic-explanation/stage-one']
                }
            }
        }
    };
    return source;
}

test('independent authored tours compile and coverage uses each mode explicitly', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });

        assert.equal(manifest.version, 4);
        assert.equal(manifest.scenes[0].kind, 'walkthrough');
        assert.deepEqual(Object.keys(manifest.tours), ['historical', 'deconstructed']);
        assert.deepEqual(manifest.tours.historical.scenes.map((scene) => scene.kind), ['stacked-diff', 'walkthrough']);
        assert.equal(manifest.tours.historical.scenes[0].stack.length, 2);
        assert.equal(manifest.tours.historical.scenes[0].steps[0].body, 'The endpoint stack shows the committed change.');
        assert.equal(manifest.tours.deconstructed.scenes[0].kind, 'deconstructed-diff');
        assert.equal(manifest.tours.deconstructed.scenes[0].panels.length, 2);
        assert.deepEqual(parseChangeTourManifest(manifest).tours, manifest.tours);

        const coverage = buildTourCoverageReport(root, source);
        assert.equal(coverage.version, 2);
        assert.equal(coverage.totals.coveredUnits, 1);
        assert.deepEqual(coverage.explanationAssignments.map((assignment) => assignment.sceneId), ['synthetic-explanation']);
        assert.equal(coverage.explanationAssignments[0].assignedUnits, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('v4 root deconstruction falls back to exact authored mode tours', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const scene = source.tours.deconstructed.chapters[0].scenes[0];
        const fallbackSource = {
            ...source,
            tours: undefined,
            chapters: [{
                id: 'root-deconstructed',
                title: 'Root deconstruction',
                scenes: [{
                    ...scene,
                    stack: [
                        { id: 'base', ref: 'main' },
                        { id: 'head', ref: 'feature' }
                    ],
                    steps: [{
                        id: 'endpoint-step',
                        title: 'Read the endpoint',
                        body: 'This explicit walkthrough is the Historical fallback.',
                        focus: 'historical'
                    }]
                }]
            }]
        };
        const manifest = buildChangeTourManifest(root, { source: fallbackSource });
        assert.equal(manifest.tours.deconstructed.scenes[0].kind, 'deconstructed-diff');
        assert.equal(manifest.tours.historical.scenes[0].kind, 'walkthrough');
        assert.equal(manifest.tours.historical.scenes[0].steps[0].id, 'endpoint-step');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('mode source validation preserves v1 root deconstruction and rejects invalid mode assignments', () => {
    const source = {
        version: 1,
        anchors: { root: { file: 'app.txt', revision: 'head', contains: 'line' } },
        connections: [],
        chapters: [{
            id: 'root',
            title: 'Root',
            scenes: [{
                id: 'synthetic',
                kind: 'deconstructed-diff',
                title: 'Synthetic',
                ...narrative('Synthetic explanation.'),
                stages: [{
                    id: 'stage',
                    title: 'Stage',
                    narration: 'Narrate the stage.',
                    changes: [{ file: 'app.txt', hunks: ['hunk'] }]
                }]
            }]
        }]
    };
    assert.doesNotThrow(() => parseChangeTourSource(source));
    assert.throws(() => parseChangeTourSource({ ...source, tours: { deconstructed: { chapters: source.chapters } } }), /require version 4/);
    const syntheticChapters = source.chapters;
    source.version = 2;
    source.chapters = [{ id: 'root', title: 'Root', scenes: [{ id: 'root', kind: 'walkthrough', title: 'Root', ...narrative('Root.'), steps: [{ id: 'step', title: 'Step', body: 'Body', focus: 'root' }] }] }];
    assert.throws(() => parseChangeTourSource({ ...source, tours: { deconstructed: { chapters: syntheticChapters } } }), /require version 4/);
    source.version = 4;
    assert.throws(() => parseChangeTourSource({ ...source, tours: {} }), /tours must contain/);
    assert.throws(() => parseChangeTourSource({
        ...source,
        tours: {
            historical: { chapters: syntheticChapters }
        }
    }), /cannot contain a deconstructed/);
    assert.throws(() => parseChangeTourSource({
        ...source,
        tours: {
            deconstructed: {
                chapters: [{
                    id: 'walkthrough',
                    title: 'Walkthrough',
                    scenes: [{
                        id: 'walkthrough',
                        kind: 'walkthrough',
                        title: 'Walkthrough',
                        ...narrative('Walkthrough.'),
                        steps: [{ id: 'step', title: 'Step', body: 'Body', focus: 'root' }]
                    }]
                }]
            }
        }
    }), /at least one deconstructed-diff/);
});

test('v4 retires v3 and rejects Review Notes in sources and compiled manifests', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });
        const retiredVersion = /version 3 is retired.*Remove the review block.*version to 4.*recompile/;

        assert.equal(parseChangeTourSource(source).version, 4);
        assert.equal(parseChangeTourManifest(manifest).version, 4);
        assert.equal(Object.hasOwn(manifest, 'review'), false);
        assert.throws(() => parseChangeTourSource({ ...source, version: 3 }), retiredVersion);
        assert.throws(() => parseChangeTourManifest({ ...manifest, version: 3 }), retiredVersion);

        for (const review of [{ items: [] }, undefined]) {
            assert.throws(() => parseChangeTourSource({ ...source, review }), /unknown.*review/i);
            assert.throws(() => buildChangeTourManifest(root, { source: { ...source, review } }), /unknown.*review/i);
            assert.throws(() => parseChangeTourManifest({ ...manifest, review }), /do not support the review field/);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('v5 authored details survive source parsing, compilation, and manifest round-trip', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });

        assert.match(manifest.contentHash, /^[0-9a-f]{64}$/);
        assert.notEqual(manifest.contentHash, '0'.repeat(64));
        assert.equal(manifest.tours.historical.contentHash, manifest.contentHash);
        assert.equal(manifest.tours.deconstructed.contentHash, manifest.contentHash);
        assert.equal(manifest.details.assessment.contentHash, '0'.repeat(64));
        assert.equal(manifest.tours.historical.details.assessment.contentHash, '0'.repeat(64));
        assert.equal(manifest.tours.deconstructed.details.assessment.contentHash, '0'.repeat(64));
        assert.equal(manifest.tours.historical.details.audience.scope, source.tours.historical.details.audience.scope);
        assert.equal(manifest.tours.historical.details.assessment.ratings.purpose, undefined);
        assert.equal(manifest.tours.deconstructed.details.assessment.ratings.reasoning.score, 1);
        assert.deepEqual(
            JSON.parse(JSON.stringify(parseChangeTourManifest(clone(manifest)))),
            JSON.parse(JSON.stringify(manifest))
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('v5 details reject unsupported scores, stale provenance shape, and cross-mode references', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);

        const invalidScore = clone(source);
        invalidScore.details.assessment.ratings.purpose.score = 4;
        assert.throws(() => parseChangeTourSource(invalidScore), /score/);

        for (const edit of [
            rating => { rating.reason = '   '; },
            rating => { rating.references = []; }
        ]) {
            const invalid = clone(source);
            edit(invalid.details.assessment.ratings.purpose);
            assert.throws(() => parseChangeTourSource(invalid), /non-empty/);
        }

        const invalidHash = clone(source);
        invalidHash.details.assessment.contentHash = 'A'.repeat(64);
        assert.throws(() => parseChangeTourSource(invalidHash), /lowercase SHA-256/);

        for (const assessedAt of ['2026-02-30T12:00:00Z', '2026-02-29T12:00:00-05:00']) {
            const invalidDate = clone(source);
            invalidDate.details.assessment.assessedAt = assessedAt;
            assert.throws(() => parseChangeTourSource(invalidDate), /ISO timestamp/);
        }
        const leapDate = clone(source);
        leapDate.details.assessment.assessedAt = '2024-02-29T23:30:00-05:00';
        assert.doesNotThrow(() => parseChangeTourSource(leapDate));

        const invalidReference = clone(source);
        invalidReference.details.assessment.ratings.purpose.references = ['not-a-tour-location'];
        assert.throws(() => parseChangeTourSource(invalidReference), /unknown scene or step reference/);

        const ambiguous = clone(source);
        const original = ambiguous.tours.historical.chapters[0].scenes[0];
        const duplicate = clone(original);
        duplicate.id += '-copy';
        ambiguous.tours.historical.chapters[0].scenes.push(duplicate);
        const rating = ambiguous.tours.historical.details.assessment.ratings.evidence;
        rating.references = [original.steps[0].id];
        assert.throws(() => parseChangeTourSource(ambiguous), /ambiguous/);
        rating.references = [`${original.id}/${original.steps[0].id}`];
        assert.doesNotThrow(() => parseChangeTourSource(ambiguous));

        const crossModeReference = clone(source);
        crossModeReference.tours.historical.details.assessment.ratings.evidence.references = ['synthetic-explanation'];
        assert.throws(() => parseChangeTourSource(crossModeReference), /unknown scene or step reference/);

        const legacy = makeSource(inventory);
        legacy.version = 4;
        legacy.details = source.details;
        assert.throws(() => parseChangeTourSource(legacy), /details requires version 5/);

        const manifest = buildChangeTourManifest(root, { source });
        const invalidManifestReference = clone(manifest);
        invalidManifestReference.tours.historical.details.assessment.ratings.evidence.references = ['synthetic-explanation'];
        assert.throws(() => parseChangeTourManifest(invalidManifestReference), /unknown scene or step reference/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('content fingerprints change for authored content but exclude assessment blocks', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);
        const baseline = hashChangeTourSource(parseChangeTourSource(source));

        const assessmentOnly = clone(source);
        assessmentOnly.details.assessment.reviewer = 'another reviewer';
        assessmentOnly.details.assessment.ratings.purpose.score = 3;
        assessmentOnly.tours.historical.details.assessment.blockers = ['re-read the stack'];
        assert.equal(hashChangeTourSource(parseChangeTourSource(assessmentOnly)), baseline);

        for (const [label, edit] of [
            ['prose', value => { value.chapters[0].scenes[0].summary = 'A different explanation.'; }],
            ['anchor', value => { value.anchors.root.contains = 'beta'; }],
            ['range', value => { value.range.base = 'main~1'; }],
            ['audience', value => { value.details.audience.scope = 'A narrower tour.'; }]
        ]) {
            const changed = clone(source);
            edit(changed);
            assert.notEqual(hashChangeTourSource(parseChangeTourSource(changed)), baseline, `${label} edit changes the fingerprint`);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('legacy sources without details still compile without fingerprints', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const parsed = parseChangeTourSource(source);
        const manifest = buildChangeTourManifest(root, { source });

        assert.equal(parsed.details, undefined);
        assert.equal(Object.hasOwn(manifest, 'details'), false);
        assert.equal(Object.hasOwn(manifest, 'contentHash'), false);
        assert.doesNotThrow(() => parseChangeTourManifest(manifest));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('source schema accepts v5 details and rejects details on legacy sources', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);
        const validate = new Ajv({ strict: false }).compile(sourceSchema);
        assert.equal(validate(source), true, JSON.stringify(validate.errors));

        const legacy = makeSource(inventory);
        legacy.details = source.details;
        assert.equal(validate(legacy), false);
        assert.match(JSON.stringify(validate.errors), /details/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('tour validate JSON exposes the current content fingerprint', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);
        const sourcePath = path.join(root, 'authored.bygone.json');
        fs.writeFileSync(sourcePath, JSON.stringify(source), 'utf8');
        const manifest = buildChangeTourManifest(root, { source });
        let stdout = '';
        runTourCommand(['validate', sourcePath, '--json'], root, path.resolve(__dirname, '..'), {
            write(chunk) { stdout += chunk; }
        });
        assert.equal(JSON.parse(stdout).contentHash, manifest.contentHash);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});


test('first assessment preserves fingerprints and exact root fallback retains details', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeDetailedSource(inventory);
        delete source.details;
        delete source.tours.historical.details;
        delete source.tours.deconstructed.details;
        const baseline = buildChangeTourManifest(root, { source });
        const assessment = { reviewer: 'Reviewer', method: 'self-review', assessedAt: '2026-10-12T00:00:00Z', contentHash: baseline.contentHash, ratings: {} };
        source.details = { assessment };
        source.tours.historical.details = { assessment };
        const assessed = buildChangeTourManifest(root, { source });
        assert.equal(assessed.contentHash, baseline.contentHash);
        assert.equal(assessed.tours.deconstructed.details, undefined, 'Independent mode does not inherit root ratings');
        delete source.tours;
        const fallback = buildChangeTourManifest(root, { source });
        assert.deepEqual(fallback.tours.historical.details, source.details);
        execFileSync('git', ['commit', '--allow-empty', '-m', 'advance branch'], { cwd: root, stdio: 'pipe' });
        assert.notEqual(buildChangeTourManifest(root, { source }).contentHash, fallback.contentHash, 'Moving refs invalidates assessment');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
