const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { materializeTour } = require('../cli/tourExport');
const { buildManifestForTourSource } = require('../cli/tourFile');
const { resolveDocumentFocus } = require('../out/deepLink');
const { buildAllTourReadingItems, buildTourReadingItems } = require('../out/tourReading');
const { buildTourCoverageReport } = require('../out/tourCoverage');
const { exportFixture } = require('./exportFixture');

function hydrate(data) {
    return JSON.parse(JSON.stringify(data), (_key, value) => (
        value && typeof value.$text === 'string' ? data.texts[value.$text] : value
    ));
}

function branchSource(fixture) {
    const source = JSON.parse(JSON.stringify(fixture.source));
    source.version = 7;
    delete source.tours;
    source.anchors.branchEarly = {
        file: 'nested/early.txt',
        revision: 'head',
        contains: 'new'
    };
    source.anchors.branchLate = {
        file: 'nested/deep/late.txt',
        revision: 'head',
        contains: 'added'
    };
    source.chapters[0].scenes[0].steps[0].branches = [{
        id: 'diagnostics',
        title: 'Why does the changed file need a closer look?',
        steps: [{
            id: 'early-evidence',
            title: 'Which earlier edit establishes the boundary?',
            body: 'The nested file records the boundary that the main route only names.',
            focus: 'branchEarly',
            branches: [{
                id: 'follow-up',
                title: 'What further evidence confirms the consequence?',
                steps: [{
                    id: 'late-evidence',
                    title: 'Where does the consequence appear?',
                    body: 'The added nested file shows the consequence in the endpoint tree.',
                    focus: 'branchLate'
                }]
            }]
        }]
    }];
    return source;
}

function sceneFor(manifest) {
    return manifest.scenes.find((scene) => scene.id === 'scene');
}

test('v7 optional branch evidence survives export and deep links use its physical flat step', () => {
    const fixture = exportFixture({ nestedFiles: true });
    try {
        const source = branchSource(fixture);
        fs.writeFileSync(fixture.sourcePath, JSON.stringify(source));

        const manifest = buildManifestForTourSource(fixture.root, source);
        const scene = sceneFor(manifest);
        assert.deepEqual(scene.steps.map((step) => step.id), ['step', 'early-evidence', 'late-evidence']);
        assert.deepEqual(scene.steps.map((step) => step.branch), [
            undefined,
            { id: 'diagnostics', title: 'Why does the changed file need a closer look?', parentStepId: 'step' },
            { id: 'follow-up', title: 'What further evidence confirms the consequence?', parentStepId: 'early-evidence' }
        ]);
        assert.deepEqual(scene.steps.slice(1).map((step) => step.diff.path), [
            'nested/early.txt',
            'nested/deep/late.txt'
        ]);
        assert.deepEqual(scene.steps.slice(1).map((step) => ({
            focus: step.focus.id,
            path: step.focus.path,
            excerpt: step.focus.excerpt
        })), [
            { focus: 'branchEarly', path: 'nested/early.txt', excerpt: 'new' },
            { focus: 'branchLate', path: 'nested/deep/late.txt', excerpt: 'added' }
        ]);

        const focus = resolveDocumentFocus(manifest, 'historical', {
            part: 'step',
            scene: 'scene',
            step: 'late-evidence'
        });
        assert.deepEqual(focus, {
            key: 'step:scene:late-evidence',
            sceneIndex: 0,
            stepIndex: 2
        });

        const defaultItems = buildTourReadingItems(manifest.tours.historical);
        assert.deepEqual(defaultItems.filter((item) => item.kind === 'step').map((item) => item.key), [
            'step:scene:step'
        ]);
        const allItems = buildAllTourReadingItems(manifest.tours.historical);
        assert.deepEqual(allItems.filter((item) => item.kind === 'step').map(({ key, stepIndex }) => ({ key, stepIndex })), [
            { key: 'step:scene:step', stepIndex: 0 },
            { key: 'step:scene:early-evidence', stepIndex: 1 },
            { key: 'step:scene:late-evidence', stepIndex: 2 }
        ]);
        assert.deepEqual(buildTourReadingItems(manifest.tours.historical, {
            sceneIndex: 0,
            branchId: 'diagnostics'
        }).filter((item) => item.kind === 'step').map((item) => item.key), [
            'step:scene:early-evidence'
        ]);
        assert.deepEqual(buildTourReadingItems(manifest.tours.historical, {
            sceneIndex: 0,
            branchId: 'follow-up'
        }).filter((item) => item.kind === 'step').map((item) => item.key), [
            'step:scene:late-evidence'
        ]);

        const coverage = buildTourCoverageReport(fixture.root, source);
        const earlyCoverage = coverage.files.find((file) => file.path === 'nested/early.txt');
        const lateCoverage = coverage.files.find((file) => file.path === 'nested/deep/late.txt');
        assert.ok(earlyCoverage && earlyCoverage.coveredUnits > 0,
            'coverage includes evidence authored only in the first optional branch');
        assert.ok(lateCoverage && lateCoverage.coveredUnits > 0,
            'coverage includes evidence authored only in the nested optional branch');

        const minimal = materializeTour(fixture.sourcePath, 'minimal');
        const full = materializeTour(fixture.sourcePath, 'full');
        const roundTripped = hydrate(minimal);
        const exportedScene = sceneFor(roundTripped.manifest);
        assert.deepEqual(exportedScene.steps.map((step) => step.id), scene.steps.map((step) => step.id));
        assert.deepEqual(exportedScene.steps.slice(1).map((step) => ({
            id: step.id,
            branch: step.branch,
            focus: step.focus.id,
            path: step.diff.path,
            rightContent: step.diff.rightContent
        })), [
            {
                id: 'early-evidence',
                branch: { id: 'diagnostics', title: 'Why does the changed file need a closer look?', parentStepId: 'step' },
                focus: 'branchEarly',
                path: 'nested/early.txt',
                rightContent: 'new\n'
            },
            {
                id: 'late-evidence',
                branch: { id: 'follow-up', title: 'What further evidence confirms the consequence?', parentStepId: 'early-evidence' },
                focus: 'branchLate',
                path: 'nested/deep/late.txt',
                rightContent: 'added\n'
            }
        ]);
        assert.deepEqual(buildAllTourReadingItems(roundTripped.manifest.tours.historical)
            .filter((item) => item.kind === 'step').map((item) => item.key), [
            'step:scene:step', 'step:scene:early-evidence', 'step:scene:late-evidence'
        ]);
        for (const [id, text] of Object.entries(minimal.texts)) {
            assert.equal(createHash('sha256').update(text).digest('hex'), id);
        }
        const earlyTextId = Object.entries(full.texts).find(([, text]) => text === 'new\n')?.[0];
        const lateTextId = Object.entries(full.texts).find(([, text]) => text === 'added\n')?.[0];
        assert.ok(earlyTextId && lateTextId, 'full export retains branch-only evidence text');
        assert.equal(full.history.snapshots[fixture.head]['nested/early.txt'].blob, earlyTextId);
        assert.equal(full.history.snapshots[fixture.head]['nested/deep/late.txt'].blob, lateTextId);
        assert.equal(materializeTour(fixture.sourcePath, 'minimal').contentId, minimal.contentId);
    } finally {
        fixture.dispose();
    }
});

test('legacy v6 authored sources remain compilable without optional branches', () => {
    const fixture = exportFixture();
    try {
        const source = JSON.parse(JSON.stringify(fixture.source));
        source.version = 6;
        assert.equal(buildManifestForTourSource(fixture.root, source).version, 6);
    } finally {
        fixture.dispose();
    }
});
