const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
    buildChangeInventory,
    buildChangeTourManifest,
    parseChangeTourManifest,
    parseChangeTourSource
} = require('../out/changeTour.js');
const { buildTourCoverageReport } = require('../out/tourCoverage.js');
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

test('v5 audience details survive compilation and remain independent by mode', () => {
    const { root } = makeRepository();
    try {
        const source = makeDetailedSource(buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' }));
        const manifest = buildChangeTourManifest(root, { source });
        assert.deepEqual(manifest.details, source.details);
        for (const mode of ['historical', 'deconstructed']) {
            assert.deepEqual(manifest.tours[mode].details, source.tours[mode].details);
        }
        assert.deepEqual(clone(parseChangeTourManifest(clone(manifest))), clone(manifest));
        delete source.tours.historical.details;
        assert.equal(buildChangeTourManifest(root, { source }).tours.historical.details, undefined,
            'Independent mode does not inherit root audience');
        delete source.tours;
        assert.deepEqual(buildChangeTourManifest(root, { source }).tours.historical.details, source.details,
            'Exact root fallback retains its audience');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('source, manifest, and schema enforce audience details and version boundaries', () => {
    const { root } = makeRepository();
    try {
        const source = makeDetailedSource(buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' }));
        const manifest = buildChangeTourManifest(root, { source });
        const validate = new Ajv({ strict: false }).compile(sourceSchema);
        assert.equal(validate(source), true, JSON.stringify(validate.errors));
        for (const [field, value] of [
            ['codebase', 'expert'], ['language', 'native'], ['readingDemand', 'easy'],
            ['purpose', 'approval'], ['scope', '  '], ['domain', ['  ']],
            ['estimatedMinutes', 0], ['unexpected', true]
        ]) {
            for (const mode of [null, 'historical', 'deconstructed']) {
                const invalidSource = clone(source);
                const invalidManifest = clone(manifest);
                const sourceDetails = mode ? invalidSource.tours[mode].details : invalidSource.details;
                const manifestDetails = mode ? invalidManifest.tours[mode].details : invalidManifest.details;
                sourceDetails.audience[field] = value;
                manifestDetails.audience[field] = value;
                assert.throws(() => parseChangeTourSource(invalidSource), undefined, field);
                assert.throws(() => parseChangeTourManifest(invalidManifest), undefined, field);
                assert.equal(validate(invalidSource), false, field);
            }
        }
        const scored = clone(source);
        scored.details.assessment = {};
        assert.throws(() => parseChangeTourSource(scored), /unknown.*assessment/);
        assert.equal(validate(scored), false);
        for (const version of [1, 2, 4]) {
            assert.throws(() => parseChangeTourSource({ ...source, version }));
            assert.throws(() => parseChangeTourManifest({ ...manifest, version }));
            assert.equal(validate({ ...source, version }), false);
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sources without audience details remain valid', () => {
    const { root } = makeRepository();
    try {
        const source = makeSource(buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' }));
        for (const version of [4, 5]) {
            source.version = version;
            const manifest = buildChangeTourManifest(root, { source });
            assert.equal(manifest.details, undefined);
            assert.doesNotThrow(() => parseChangeTourManifest(manifest));
        }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
