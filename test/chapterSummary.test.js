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
const sourceSchema = require('../schemas/change-tour-source.schema.json');
const Ajv = require('ajv/dist/2020');

function narrative(summary) {
    return { summary, bullets: [], tags: ['test'], takeaway: summary };
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function makeRepository() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-chapter-summary-')));
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
    return root;
}

function walkthrough(id, title, focus) {
    return {
        id,
        kind: 'walkthrough',
        title,
        ...narrative(`${title} narrative.`),
        steps: [{
            id: `${id}-step`,
            title: 'Read the changed line',
            body: 'The authored step points at the changed line.',
            focus
        }]
    };
}

function makeIndependentSource(inventory) {
    const hunk = inventory.files.find((file) => file.path === 'app.txt').units[0].id;
    return {
        version: 5,
        range: { base: 'main', head: 'feature' },
        anchors: {
            root: { file: 'app.txt', revision: 'head', contains: 'alpha' },
            historical: { file: 'app.txt', revision: 'head', contains: 'BETA' }
        },
        connections: [],
        chapters: [{
            id: 'root',
            title: 'Root chapter',
            summary: 'Preview the compatibility tour.',
            scenes: [walkthrough('root-scene', 'Root walkthrough', 'root')]
        }],
        tours: {
            historical: {
                chapters: [{
                    id: 'historical',
                    title: 'Historical chapter',
                    summary: 'Preview the historical tour.',
                    scenes: [walkthrough('historical-scene', 'Historical walkthrough', 'historical')]
                }]
            },
            deconstructed: {
                chapters: [{
                    id: 'deconstructed',
                    title: 'Deconstructed chapter',
                    summary: 'Preview the staged explanation.',
                    scenes: [{
                        id: 'deconstructed-scene',
                        kind: 'deconstructed-diff',
                        title: 'Deconstructed explanation',
                        ...narrative('The changed line is introduced in one stage.'),
                        stages: [{
                            id: 'stage-one',
                            title: 'Introduce the changed line',
                            narration: 'Apply the authored hunk in teaching order.',
                            changes: [{ file: 'app.txt', hunks: [hunk] }]
                        }]
                    }]
                }]
            }
        }
    };
}

function makeInheritedDeconstructedSource(inventory) {
    const hunk = inventory.files.find((file) => file.path === 'app.txt').units[0].id;
    return {
        version: 5,
        range: { base: 'main', head: 'feature' },
        anchors: {
            root: { file: 'app.txt', revision: 'head', contains: 'BETA' }
        },
        connections: [],
        chapters: [{
            id: 'explanation',
            title: 'Explanation chapter',
            summary: 'Preview the inherited explanation.',
            scenes: [{
                id: 'root-deconstructed',
                kind: 'deconstructed-diff',
                title: 'Explain the changed line',
                ...narrative('The changed line is built from an authored stage.'),
                base: 'main',
                target: 'feature',
                stack: [
                    { id: 'base', ref: 'main' },
                    { id: 'head', ref: 'feature' }
                ],
                steps: [{
                    id: 'endpoint-step',
                    title: 'Read the endpoint',
                    body: 'The endpoint walkthrough remains available in Historical mode.',
                    focus: 'root'
                }],
                stages: [{
                    id: 'stage-one',
                    title: 'Introduce the changed line',
                    narration: 'Apply the authored hunk in teaching order.',
                    changes: [{ file: 'app.txt', hunks: [hunk] }]
                }]
            }]
        }]
    };
}

test('v5 chapter summaries compile through root, authored modes, and final zoom', () => {
    const root = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeIndependentSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });

        assert.equal(manifest.chapters[0].summary, 'Preview the compatibility tour.');
        assert.equal(manifest.tours.historical.chapters[0].summary, 'Preview the historical tour.');
        assert.equal(manifest.tours.deconstructed.chapters[0].summary, 'Preview the staged explanation.');
        assert.equal(manifest.zoom.final.chapters[0].summary, 'Preview the compatibility tour.');
        assert.deepEqual(parseChangeTourManifest(clone(manifest)), clone(manifest));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('root chapter summaries propagate through inherited Historical, Deconstructed, and final tours', () => {
    const root = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeInheritedDeconstructedSource(inventory);
        const manifest = buildChangeTourManifest(root, { source });
        const expected = 'Preview the inherited explanation.';

        assert.equal(manifest.chapters[0].summary, expected);
        assert.equal(manifest.tours.historical.chapters[0].summary, expected);
        assert.equal(manifest.tours.deconstructed.chapters[0].summary, expected);
        assert.equal(manifest.zoom.final.chapters[0].summary, expected);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('chapter summaries are prose-validated and version-gated in source, manifest, and schema', () => {
    const root = makeRepository();
    try {
        const inventory = buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
        const source = makeIndependentSource(inventory);
        const validate = new Ajv({ strict: false }).compile(sourceSchema);
        assert.equal(validate(source), true, JSON.stringify(validate.errors));

        const oldSource = clone(source);
        oldSource.version = 4;
        for (const chapter of [
            oldSource.chapters[0],
            oldSource.tours.historical.chapters[0],
            oldSource.tours.deconstructed.chapters[0]
        ]) delete chapter.summary;
        assert.doesNotThrow(() => parseChangeTourSource(oldSource));
        assert.equal(validate(oldSource), true, JSON.stringify(validate.errors));

        for (const [label, mutate] of [
            ['root source', (candidate) => { candidate.chapters[0].summary = '  '; }],
            ['historical source', (candidate) => { candidate.tours.historical.chapters[0].summary = '  '; }],
            ['deconstructed source', (candidate) => { candidate.tours.deconstructed.chapters[0].summary = '  '; }]
        ]) {
            const invalid = clone(source);
            mutate(invalid);
            assert.throws(() => parseChangeTourSource(invalid), /non-empty string/, label);
            assert.equal(validate(invalid), false, label);
        }

        const oldWithSummary = clone(oldSource);
        oldWithSummary.chapters[0].summary = 'Legacy summaries are unsupported.';
        assert.throws(() => parseChangeTourSource(oldWithSummary), /requires source version 5/);
        assert.equal(validate(oldWithSummary), false);

        const manifest = buildChangeTourManifest(root, { source });
        for (const [label, mutate] of [
            ['root manifest', (candidate) => { candidate.chapters[0].summary = '  '; }],
            ['historical manifest', (candidate) => { candidate.tours.historical.chapters[0].summary = '  '; }],
            ['deconstructed manifest', (candidate) => { candidate.tours.deconstructed.chapters[0].summary = '  '; }],
            ['final manifest', (candidate) => { candidate.zoom.final.chapters[0].summary = '  '; }]
        ]) {
            const invalid = clone(manifest);
            mutate(invalid);
            assert.throws(() => parseChangeTourManifest(invalid), /non-empty string/, label);
        }

        const oldManifest = clone(manifest);
        oldManifest.version = 4;
        for (const chapter of [
            oldManifest.chapters[0],
            oldManifest.tours.historical.chapters[0],
            oldManifest.tours.deconstructed.chapters[0],
            oldManifest.zoom.final.chapters[0]
        ]) delete chapter.summary;
        assert.doesNotThrow(() => parseChangeTourManifest(oldManifest));

        const oldManifestWithSummary = clone(oldManifest);
        oldManifestWithSummary.zoom.final.chapters[0].summary = 'Legacy summaries are unsupported.';
        assert.throws(() => parseChangeTourManifest(oldManifestWithSummary), /requires manifest version 5/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
