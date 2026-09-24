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
        version: 2,
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

test('independent authored tours compile and coverage uses each mode explicitly', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });

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

test('v2 root deconstruction falls back to exact authored mode tours', () => {
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
    assert.throws(() => parseChangeTourSource({ ...source, tours: { deconstructed: { chapters: source.chapters } } }), /require version 2/);
    const syntheticChapters = source.chapters;
    source.version = 2;
    source.chapters = [{ id: 'root', title: 'Root', scenes: [{ id: 'root', kind: 'walkthrough', title: 'Root', ...narrative('Root.'), steps: [{ id: 'step', title: 'Step', body: 'Body', focus: 'root' }] }] }];
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
