const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { exportFixture } = require('./exportFixture');
const { buildManifestForTourSource } = require('../cli/tourFile');
const { materializeTour } = require('../cli/tourExport');
const { parseChangeTourManifest } = require('../out/changeTour');
const { buildTourCoverageReport } = require('../out/tourCoverage');
const modules = import('data:text/javascript;base64,' + Buffer.from(buildSync({
    stdin: { contents: "export * from './web/tourCompleteCoverage.js'; export * from './src/tourCompleteCoverage.ts'; export * from './src/tourOptions.ts';", resolveDir: path.resolve(__dirname, '..') },
    bundle: true, write: false, format: 'esm', platform: 'browser'
}).outputFiles[0].contents).toString('base64'));

test('strict coverage survives compilation and both export profiles; mismatched ranges and inconsistent counts are rejected', async () => {
    const { TourStyle, TourDepth, TourAudience, TourFamiliarity, TourCoverage, StrictTourCoverageStatus } = await modules;
    const fixture = exportFixture();
    try {
        const source = structuredClone(fixture.source);
        source.version = 8;
        delete source.tours;
        source.options = { style: TourStyle.Final, depth: TourDepth.Guided, audience: TourAudience.Peer, familiarity: TourFamiliarity.Some, coverage: TourCoverage.Complete, paths: ['app.txt'] };
        source.anchors.before = { file: 'app.txt', revision: 'base', contains: 'beta' };
        source.chapters[0].scenes[0].steps.unshift({ id: 'before', title: 'Before', body: 'The original value is replaced.', focus: 'before' });
        const manifest = buildManifestForTourSource(fixture.root, source);
        const report = manifest.authoringCoverage.complete.tour;
        assert.equal(report.status, StrictTourCoverageStatus.Complete);
        assert.deepEqual(report.scope.requestedPaths, ['app.txt']);
        assert.equal(report.range.baseOid, fixture.base);
        assert.equal(report.range.headOid, fixture.head);
        assert.deepEqual(parseChangeTourManifest(manifest).authoringCoverage.complete.tour, report);
        const repeatedScope = structuredClone(source);
        repeatedScope.options.paths.push('app.txt');
        const repeatedManifest = buildManifestForTourSource(fixture.root, repeatedScope);
        assert.deepEqual(parseChangeTourManifest(repeatedManifest).authoringCoverage.complete.tour.scope.requestedPaths, ['app.txt', 'app.txt']);
        fs.writeFileSync(fixture.sourcePath, JSON.stringify(source));
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(fixture.sourcePath, profile);
            assert.deepEqual(exported.manifest.authoringCoverage.complete.tour, report);
            const hydrate = value => {
                if (Array.isArray(value)) return value.map(hydrate);
                if (!value || typeof value !== 'object') return value;
                if (value.$text) return exported.texts[value.$text];
                return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, hydrate(child)]));
            };
            assert.doesNotThrow(() => parseChangeTourManifest(hydrate(exported.manifest), { exported: true }));
        }
        for (const mutate of [
            value => { value.authoringCoverage.complete.tour.range.headOid = 'a'.repeat(40); },
            value => { value.authoringCoverage.complete.tour.coveredHunks = 0; },
            value => { value.authoringCoverage.complete.tour.scope.requestedPaths = ['other.txt']; },
            value => { value.authoringCoverage.complete.tour.outstandingPaths = ['unexplained.bin']; }
        ]) {
            const invalid = structuredClone(manifest);
            mutate(invalid);
            assert.throws(() => parseChangeTourManifest(invalid), /strict coverage/i);
        }
        const overrideSource = structuredClone(source);
        overrideSource.anchors.changed.contains = 'intermediate';
        const overridden = buildManifestForTourSource(fixture.root, overrideSource, { headRef: fixture.middle });
        assert.equal(overridden.authoringCoverage.complete.tour.range.headOid, fixture.middle);
    } finally { fixture.dispose(); }
});

test('coverage details distinguish a request, complete evidence, and non-textual accounting', async () => {
    const { renderCompleteCoverage, StrictTourCoverageStatus, TourCoverage } = await modules;
    const document = { createElement(tag) { return { tag, textContent: '', children: [], append(...children) { this.children.push(...children); } }; } };
    const host = document.createElement('section');
    host.ownerDocument = document;
    const content = node => [node.textContent, ...node.children.map(content)].join(' ');
    renderCompleteCoverage(host, undefined, { coverage: TourCoverage.Complete });
    assert.match(content(host), /requested · not verified/);
    assert.doesNotMatch(content(host), /coverage verified/);
    host.children = [];
    const report = { status: StrictTourCoverageStatus.NoTextualChanges, coveredHunks: 0, totalHunks: 0, accountedFiles: [{ path: '<asset>.png', reason: 'Replaced icon' }], outstandingPaths: [], scope: { requestedPaths: [] }, range: { baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40) }, uncoveredHunks: [], exclusions: [], limitations: [] };
    renderCompleteCoverage(host, report);
    assert.match(content(host), /No textual changes to score/);
    assert.match(content(host), /<asset>.png: Replaced icon/);
    assert.doesNotMatch(content(host), /100% main-path coverage · compiler report/);
    host.children = [];
    renderCompleteCoverage(host, { ...report, status: StrictTourCoverageStatus.Complete, coveredHunks: 1, totalHunks: 1 });
    assert.match(content(host), /100% main-path coverage · compiler report/);
    assert.match(content(host), /viewer does not re-run coverage/);
});

test('root deconstructed coverage remains visible in generated modes without borrowing another authored mode report', async () => {
    const { completeCoverageForMode, renderCompleteCoverage, StrictTourCoverageMode, StrictTourCoverageStatus, TOUR_PRESETS, TourPreset } = await modules;
    const fixture = exportFixture();
    try {
        const source = structuredClone(fixture.source);
        source.version = 8;
        source.options = { ...TOUR_PRESETS.find(preset => preset.id === TourPreset.Complete).options, paths: ['app.txt'] };
        source.chapters = source.tours.deconstructed.chapters;
        delete source.tours;
        source.chapters[0].scenes[0].stack = [{ id: 'base', ref: fixture.base }, { id: 'head', ref: fixture.head }];
        source.anchors.before = { file: 'app.txt', revision: 'base', contains: 'beta' };
        source.chapters[0].scenes[0].steps = [
            { id: 'before', title: 'Before', body: 'The original value is replaced.', focus: 'before' },
            { id: 'after', title: 'After', body: 'The replacement is uppercase.', focus: 'changed' }
        ];
        const manifest = buildManifestForTourSource(fixture.root, source);
        const reports = manifest.authoringCoverage.complete;
        assert.equal(reports.tour.status, StrictTourCoverageStatus.Complete);
        assert.ok(manifest.tours.deconstructed);
        for (const mode of [StrictTourCoverageMode.Historical, StrictTourCoverageMode.Deconstructed]) {
            const report = completeCoverageForMode(reports, mode);
            assert.equal(report, reports.tour);
            const document = { createElement() { return { textContent: '', children: [], append(...children) { this.children.push(...children); } }; } };
            const host = document.createElement();
            host.ownerDocument = document;
            renderCompleteCoverage(host, report, source.options);
            assert.equal(host.children[0].children[0].textContent, '100% main-path coverage · compiler report');
        }
        const historicalOnly = { [StrictTourCoverageMode.Historical]: reports.tour };
        assert.equal(completeCoverageForMode(historicalOnly, StrictTourCoverageMode.Deconstructed), undefined);
        assert.equal(completeCoverageForMode(historicalOnly, StrictTourCoverageMode.Historical), reports.tour);
        assert.equal(completeCoverageForMode(reports, 'compare'), undefined);
    } finally { fixture.dispose(); }
});

test('optional evidence, partial hunks, and unaccounted binary or rename entries cannot earn complete coverage', async () => {
    const { TOUR_PRESETS, TourPreset, StrictTourCoverageStatus } = await modules;
    const fixture = exportFixture();
    try {
        const source = structuredClone(fixture.source);
        source.version = 8;
        delete source.tours;
        source.options = { ...TOUR_PRESETS.find(preset => preset.id === TourPreset.Complete).options, paths: ['app.txt'] };
        source.anchors.before = { file: 'app.txt', revision: 'base', contains: 'beta' };
        const step = source.chapters[0].scenes[0].steps[0];
        step.branches = [{ id: 'why-before', title: 'What was there before?', steps: [{ id: 'before', title: 'Before', body: 'The old value.', focus: 'before' }] }];
        assert.equal(buildTourCoverageReport(fixture.root, source).complete.tour.status, StrictTourCoverageStatus.Incomplete);
        source.chapters[0].scenes[0].steps.push(step.branches[0].steps[0]);
        delete step.branches;
        source.options.paths = ['app.txt', 'binary.dat', 'new.txt'];
        let report = buildTourCoverageReport(fixture.root, source).complete.tour;
        assert.deepEqual(report.outstandingPaths, ['binary.dat', 'new.txt']);
        source.coverage = { exclusions: [], accountedFiles: [
            { path: 'binary.dat', reason: 'Adds the binary resource.' },
            { path: 'new.txt', reason: 'Renames old.txt without changing content.' }
        ] };
        assert.equal(buildTourCoverageReport(fixture.root, source).complete.tour.status, StrictTourCoverageStatus.Complete);
        source.coverage.accountedFiles.push({ path: 'absent.txt', reason: 'Not actually changed.' });
        assert.throws(() => buildTourCoverageReport(fixture.root, source), /does not match a changed file/);
        delete source.coverage;
        source.options.paths = ['app.txt'];
        fs.writeFileSync(path.join(fixture.root, 'app.txt'), 'A\nB\nC\n');
        fixture.git('add', 'app.txt');
        fixture.git('commit', '-qm', 'Extend textual change');
        source.range.head = fixture.git('rev-parse', 'HEAD');
        source.anchors.changed.contains = 'A';
        report = buildTourCoverageReport(fixture.root, source).complete.tour;
        assert.equal(report.coveredHunks, 0, 'intersecting one line on both sides is not a whole hunk');
        assert.deepEqual(report.uncoveredHunks[0].missingSides, ['base', 'head']);
        source.anchors.before.contains = 'alpha\nbeta';
        source.anchors.changed.contains = 'A\nB\nC';
        assert.equal(buildTourCoverageReport(fixture.root, source).complete.tour.status, StrictTourCoverageStatus.Complete);
    } finally { fixture.dispose(); }
});
