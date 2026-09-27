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

function narrative(summary) {
    return { summary, bullets: [], tags: ['test'], takeaway: summary };
}

function makeRepository() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-overview-')));
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
    return { root };
}

function makeSource(inventory) {
    const hunk = inventory.files.find((file) => file.path === 'app.txt').units[0].id;
    const walkthrough = {
        id: 'root-walkthrough',
        kind: 'walkthrough',
        title: 'Root walkthrough',
        ...narrative('The authored walkthrough frames the endpoint change.'),
        overview: { kind: 'directory-diff' },
        steps: [{
            id: 'root-step',
            title: 'Read the changed line',
            body: 'The endpoint walkthrough focuses the changed line.',
            focus: 'changed-line'
        }]
    };
    const stacked = {
        id: 'historical-stack',
        kind: 'stacked-diff',
        title: 'Read the real revisions',
        ...narrative('The selected panels are real Git revisions.'),
        overview: {
            kind: 'directory-diff',
            path: 'web',
            comparison: { from: 'base', to: 'head' }
        },
        stack: [
            { id: 'base', ref: 'main', label: 'Base' },
            { id: 'head', ref: 'feature', label: 'Head' }
        ],
        files: ['app.txt'],
        steps: [{
            id: 'revision-step',
            title: 'Read the endpoint change',
            body: 'The stack shows the committed change.',
            file: 'app.txt',
            pair: ['base', 'head'],
            side: 'right'
        }]
    };
    const deconstructed = {
        id: 'synthetic-explanation',
        kind: 'deconstructed-diff',
        title: 'Explain the changed line',
        ...narrative('The explanation stages are synthetic teaching panels.'),
        overview: {
            kind: 'directory-diff',
            path: 'src',
            comparison: { from: 'explanation-baseline', to: 'explanation-stage-stage-one' }
        },
        stack: [
            { id: 'base', ref: 'main', label: 'Base' },
            { id: 'head', ref: 'feature', label: 'Head' }
        ],
        steps: [{
            id: 'endpoint-step',
            title: 'Read the endpoint',
            body: 'The endpoint walkthrough anchors the real change.',
            focus: 'changed-line'
        }],
        stages: [{
            id: 'stage-one',
            title: 'Introduce the behavior',
            narration: 'Apply the changed hunk in a teaching order.',
            changes: [{ file: 'app.txt', hunks: [hunk] }]
        }]
    };
    return {
        version: 3,
        range: { base: 'main', head: 'feature' },
        anchors: {
            'changed-line': { file: 'app.txt', revision: 'head', contains: 'BETA' }
        },
        connections: [],
        chapters: [{
            id: 'root',
            title: 'Root tour',
            scenes: [walkthrough, stacked, deconstructed]
        }]
    };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

test('compile preserves directory overviews for real and synthetic scenes and fallbacks', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const manifest = buildChangeTourManifest(root, { source: makeSource(inventory) });
        const rootScenes = new Map(manifest.scenes.map((scene) => [scene.id, scene]));

        assert.deepEqual(rootScenes.get('root-walkthrough').overview, { kind: 'directory-diff' });
        assert.deepEqual(rootScenes.get('historical-stack').overview, {
            kind: 'directory-diff', path: 'web', comparison: { from: 'base', to: 'head' }
        });
        assert.deepEqual(rootScenes.get('synthetic-explanation').overview, {
            kind: 'directory-diff', path: 'src',
            comparison: { from: 'explanation-baseline', to: 'explanation-stage-stage-one' }
        });

        const historical = new Map(manifest.tours.historical.scenes.map((scene) => [scene.id, scene]));
        const deconstructed = new Map(manifest.tours.deconstructed.scenes.map((scene) => [scene.id, scene]));
        assert.deepEqual(historical.get('synthetic-explanation').overview, { kind: 'directory-diff', path: 'src' });
        assert.deepEqual(deconstructed.get('synthetic-explanation').overview, {
            kind: 'directory-diff', path: 'src',
            comparison: { from: 'explanation-baseline', to: 'explanation-stage-stage-one' }
        });
        assert.deepEqual(manifest.zoom.revisions.find((scene) => scene.id === 'synthetic-explanation').overview,
            { kind: 'directory-diff', path: 'src' });
        assert.deepEqual(parseChangeTourManifest(manifest).tours, manifest.tours);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('explicit authored modes preserve directory overviews through compilation', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        const v2WithOverview = clone(source);
        v2WithOverview.version = 2;
        assert.throws(() => parseChangeTourSource(v2WithOverview), /overview requires version 3/);
        const [walkthrough, stacked, deconstructed] = source.chapters[0].scenes;
        const modeSource = {
            ...source,
            chapters: [{ id: 'root', title: 'Root tour', scenes: [walkthrough] }],
            tours: {
                historical: { chapters: [{ id: 'historical', title: 'Historical', scenes: [stacked] }] },
                deconstructed: { chapters: [{ id: 'deconstructed', title: 'Deconstructed', scenes: [deconstructed] }] }
            }
        };
        const manifest = buildChangeTourManifest(root, { source: modeSource });

        assert.deepEqual(manifest.tours.historical.scenes[0].overview, {
            kind: 'directory-diff', path: 'web', comparison: { from: 'base', to: 'head' }
        });
        assert.deepEqual(manifest.tours.deconstructed.scenes[0].overview, {
            kind: 'directory-diff', path: 'src',
            comparison: { from: 'explanation-baseline', to: 'explanation-stage-stage-one' }
        });
        assert.deepEqual(manifest.zoom.final.scenes[0].overview, { kind: 'directory-diff' });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('directory overview paths reject unsafe values and legacy scenes remain unchanged', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);
        for (const unsafePath of ['/tmp', '../outside', 'src/../../outside', 'src\\web', 'C:/outside']) {
            const invalid = clone(source);
            invalid.chapters[0].scenes[0].overview.path = unsafePath;
            assert.throws(() => parseChangeTourSource(invalid), /relative|traversal|backslashes/);
        }

        const manifest = buildChangeTourManifest(root, { source });
        const v2ManifestWithOverview = clone(manifest);
        v2ManifestWithOverview.version = 2;
        delete v2ManifestWithOverview.tours;
        assert.throws(() => parseChangeTourManifest(v2ManifestWithOverview), /overview requires manifest version 3/);
        const invalidManifest = clone(manifest);
        invalidManifest.scenes[0].overview.path = '../outside';
        assert.throws(() => parseChangeTourManifest(invalidManifest), /relative|traversal/);

        const legacy = clone(source);
        legacy.version = 1;
        legacy.chapters = [{ id: 'legacy', title: 'Legacy', scenes: [legacy.chapters[0].scenes[0]] }];
        delete legacy.chapters[0].scenes[0].overview;
        const parsedLegacy = parseChangeTourSource(legacy);
        assert.deepEqual(parsedLegacy, legacy);
        const legacyManifest = buildChangeTourManifest(root, { source: legacy });
        assert.equal(Object.hasOwn(legacyManifest.scenes[0], 'overview'), false);
        assert.equal(legacyManifest.tours, undefined);
        assert.equal(Object.hasOwn(parseChangeTourManifest(legacyManifest).scenes[0], 'overview'), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('directory overview comparisons require distinct authored endpoints', () => {
    const { root } = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeSource(inventory);

        const unknown = clone(source);
        unknown.chapters[0].scenes[1].overview.comparison = { from: 'missing', to: 'head' };
        assert.throws(() => parseChangeTourSource(unknown), /comparison|endpoint|defined|unknown/i);

        const duplicate = clone(source);
        duplicate.chapters[0].scenes[1].overview.comparison = { from: 'base', to: 'base' };
        assert.throws(() => parseChangeTourSource(duplicate), /distinct|comparison/i);

        const walkthroughComparison = clone(source);
        walkthroughComparison.chapters[0].scenes[0].overview.comparison = { from: 'base', to: 'head' };
        assert.throws(() => parseChangeTourSource(walkthroughComparison), /walkthrough|base-to-head|comparison/i);

        const manifest = buildChangeTourManifest(root, { source });
        const invalidManifest = clone(manifest);
        invalidManifest.scenes.find((scene) => scene.id === 'historical-stack').overview.comparison = {
            from: 'missing', to: 'head'
        };
        assert.throws(() => parseChangeTourManifest(invalidManifest), /comparison|endpoint|defined|unknown/i);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
