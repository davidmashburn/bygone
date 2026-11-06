const assert = require('node:assert/strict');
const { test } = require('node:test');
const sourceSchema = require('../schemas/change-tour-source.schema.json');
const Ajv = require('ajv/dist/2020');
const {
    buildChangeTourManifest,
    parseChangeTourManifest,
    parseChangeTourSource
} = require('../out/changeTour.js');
const { exportFixture } = require('./exportFixture');

const validateSourceSchema = new Ajv({ allErrors: true, strict: false }).compile(sourceSchema);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function branchSource(fixture) {
    const source = clone(fixture.source);
    source.version = 7;
    delete source.tours;
    source.anchors.early = { file: 'nested/early.txt', revision: 'head', contains: 'new' };
    source.anchors.late = { file: 'nested/deep/late.txt', revision: 'head', contains: 'added' };
    source.chapters[0].scenes[0].steps = [
        {
            id: 'main',
            title: 'State the outcome',
            body: 'The main path establishes the changed behavior.',
            focus: 'changed',
            branches: [{
                id: 'optional',
                title: 'Inspect supporting evidence',
                steps: [{
                    id: 'optional-one',
                    title: 'Read the earlier evidence',
                    body: 'The optional path follows the change into its earlier revision.',
                    focus: 'early',
                    branches: [{
                        id: 'nested',
                        title: 'Follow the nested consequence',
                        steps: [{
                            id: 'optional-two',
                            title: 'Read the endpoint evidence',
                            body: 'The nested path reaches the endpoint file.',
                            focus: 'late'
                        }]
                    }]
                }, {
                    id: 'optional-sibling',
                    title: 'Return to the bounded explanation',
                    body: 'This sibling remains in the same optional branch.',
                    focus: 'changed'
                }]
            }]
        },
        {
            id: 'main-end',
            title: 'Complete the main path',
            body: 'The reader can stop without opening the optional evidence.',
            focus: 'changed'
        }
    ];
    return source;
}

test('nested optional branches compile to flat preorder steps with evidence and metadata', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const source = branchSource(fixture);
        const manifest = buildChangeTourManifest(fixture.root, { source });
        const scene = manifest.scenes.find((candidate) => candidate.id === 'scene');
        assert.equal(manifest.version, 7);
        assert.deepEqual(scene.steps.map((step) => step.id), [
            'main', 'optional-one', 'optional-two', 'optional-sibling', 'main-end'
        ]);
        assert.equal(scene.steps[0].branch, undefined);
        assert.equal(scene.steps[4].branch, undefined);
        assert.deepEqual(scene.steps.slice(1, 4).map((step) => step.branch), [
            { id: 'optional', title: 'Inspect supporting evidence', parentStepId: 'main' },
            { id: 'nested', title: 'Follow the nested consequence', parentStepId: 'optional-one' },
            { id: 'optional', title: 'Inspect supporting evidence', parentStepId: 'main' }
        ]);
        assert.deepEqual(scene.steps.slice(1, 4).map((step) => ({
            id: step.id,
            focus: step.focus.id,
            path: step.diff.path,
            excerpt: step.focus.excerpt
        })), [
            { id: 'optional-one', focus: 'early', path: 'nested/early.txt', excerpt: 'new' },
            { id: 'optional-two', focus: 'late', path: 'nested/deep/late.txt', excerpt: 'added' },
            { id: 'optional-sibling', focus: 'changed', path: 'app.txt', excerpt: 'BETA' }
        ]);
        assert.doesNotThrow(() => parseChangeTourManifest(clone(manifest)));
        assert.equal(validateSourceSchema(source), true);
    } finally {
        fixture.dispose();
    }
});

test('v6 remains accepted but cannot contain source or compiled branches', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const legacy = clone(fixture.source);
        legacy.version = 6;
        delete legacy.tours;
        assert.doesNotThrow(() => parseChangeTourSource(legacy));
        assert.equal(validateSourceSchema(legacy), true);

        const branched = branchSource(fixture);
        branched.version = 6;
        assert.throws(() => parseChangeTourSource(branched), /source version 7/);
        assert.equal(validateSourceSchema(branched), false);

        const compiled = buildChangeTourManifest(fixture.root, { source: branchSource(fixture) });
        compiled.version = 6;
        assert.throws(() => parseChangeTourManifest(compiled), /manifest version 7/);
    } finally {
        fixture.dispose();
    }
});

test('source branches reject duplicate IDs, unknown evidence, and malformed branch members', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const source = branchSource(fixture);

        const duplicateStep = clone(source);
        duplicateStep.chapters[0].scenes[0].steps[0].branches[0].steps[0].id = 'main-end';
        assert.throws(() => parseChangeTourSource(duplicateStep), /Duplicate step or branch id/);

        const duplicateBranch = clone(source);
        duplicateBranch.chapters[0].scenes[0].steps[0].branches[0].id = 'main';
        assert.throws(() => parseChangeTourSource(duplicateBranch), /Duplicate step or branch id/);

        const unknownEvidence = clone(source);
        unknownEvidence.chapters[0].scenes[0].steps[0].branches[0].steps[0].mysteryEvidence = true;
        assert.throws(() => parseChangeTourSource(unknownEvidence), /unknown field/);
        assert.equal(validateSourceSchema(unknownEvidence), false);

        for (const malformed of [
            (value) => { value.chapters[0].scenes[0].steps[0].branches = []; },
            (value) => { value.chapters[0].scenes[0].steps[0].branches[0].steps = []; },
            (value) => { value.chapters[0].scenes[0].steps[0].branches[0].unexpected = true; },
            (value) => { delete value.chapters[0].scenes[0].steps[0].branches[0].title; }
        ]) {
            const candidate = clone(source);
            malformed(candidate);
            assert.throws(() => parseChangeTourSource(candidate));
            assert.equal(validateSourceSchema(candidate), false);
        }
    } finally {
        fixture.dispose();
    }
});

test('manifest branch metadata rejects unknown parents, inconsistency, cycles, and mainless scenes', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const manifest = buildChangeTourManifest(fixture.root, { source: branchSource(fixture) });
        const unknownParent = clone(manifest);
        sceneFrom(unknownParent).steps[1].branch.parentStepId = 'missing';
        sceneFrom(unknownParent).steps[3].branch.parentStepId = 'missing';
        assert.throws(() => parseChangeTourManifest(unknownParent), /unknown parent step/);

        const inconsistent = clone(manifest);
        sceneFrom(inconsistent).steps[3].branch.title = 'Different branch title';
        assert.throws(() => parseChangeTourManifest(inconsistent), /inconsistent metadata/);

        const unknownBranchKey = clone(manifest);
        sceneFrom(unknownBranchKey).steps[1].branch.extra = true;
        assert.throws(() => parseChangeTourManifest(unknownBranchKey), /unknown field/);

        const cyclic = clone(manifest);
        sceneFrom(cyclic).steps[1].branch = { id: 'first', title: 'First', parentStepId: 'optional-two' };
        sceneFrom(cyclic).steps[2].branch = { id: 'second', title: 'Second', parentStepId: 'optional-one' };
        assert.throws(() => parseChangeTourManifest(cyclic), /cyclic branch parent chain/);

        const selfReferential = clone(manifest);
        sceneFrom(selfReferential).steps[1].branch.parentStepId = 'optional-one';
        assert.throws(() => parseChangeTourManifest(selfReferential), /cannot reference the step itself/);

        const mainless = clone(manifest);
        for (const step of sceneFrom(mainless).steps) {
            step.branch = {
                id: `branch-${step.id}`,
                title: 'No main path',
                parentStepId: step.id === 'main' ? 'main-end' : 'main'
            };
        }
        assert.throws(() => parseChangeTourManifest(mainless), /at least one main step/);
    } finally {
        fixture.dispose();
    }
});

test('stack branches flatten and force inclusion of optional referenced files', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const source = clone(fixture.source);
        source.version = 7;
        delete source.tours;
        source.chapters[0].scenes[0] = {
            id: 'stack',
            kind: 'stacked-diff',
            title: 'Read the revisions',
            summary: 'The stack contains an optional file explanation.',
            bullets: [],
            tags: [],
            takeaway: 'The optional file remains available.',
            stack: [
                { id: 'base', ref: 'export-base' },
                { id: 'head', ref: 'export-head' }
            ],
            files: ['app.txt'],
            steps: [{
                id: 'stack-main',
                title: 'Read the changed app',
                body: 'The main stack step names the endpoint change.',
                file: 'app.txt',
                pair: ['base', 'head'],
                branches: [{
                    id: 'stack-detail',
                    title: 'Inspect supporting context',
                    steps: [{
                        id: 'stack-optional',
                        title: 'Read the untouched context',
                        body: 'This file is referenced only from the optional branch.',
                        file: 'nested/untouched.txt',
                        pair: ['base', 'head']
                    }]
                }]
            }]
        };
        const manifest = buildChangeTourManifest(fixture.root, { source });
        const scene = manifest.scenes.find((candidate) => candidate.id === 'stack');
        assert.deepEqual(scene.steps.map((step) => step.id), ['stack-main', 'stack-optional']);
        assert.deepEqual(scene.steps[1].branch, {
            id: 'stack-detail', title: 'Inspect supporting context', parentStepId: 'stack-main'
        });
        assert.ok(scene.files.some((file) => file.path === 'nested/untouched.txt'));
    } finally {
        fixture.dispose();
    }
});

function sceneFrom(manifest) {
    return manifest.scenes.find((candidate) => candidate.id === 'scene');
}
