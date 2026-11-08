const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');

function loadSourceModule(fileName) {
    const output = buildSync({
        entryPoints: [path.join(__dirname, '..', 'src', fileName)],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        target: 'node18',
        write: false,
        logLevel: 'silent'
    }).outputFiles[0].text;
    const modulePath = path.join(os.tmpdir(), `bygone-complete-${process.pid}-${fileName.replace(/[^a-z0-9]/gi, '-')}.cjs`);
    fs.writeFileSync(modulePath, output, 'utf8');
    return require(modulePath);
}

const coverage = loadSourceModule('tourCoverage.ts');
const tour = loadSourceModule('changeTour.ts');
const { TourStyle, TourDepth, TourAudience, TourFamiliarity, TourCoverage } = loadSourceModule('tourOptions.ts');
const { StrictTourCoverageStatus, StrictTourCoverageMode } = coverage;

function gitRepository(initialFiles, changedFiles, configure = () => {}) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-complete-')));
    const git = (...args) => execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Bygone complete coverage');
    for (const [file, text] of Object.entries(initialFiles)) writeFile(root, file, text);
    git('add', '.');
    git('commit', '-qm', 'base');
    git('branch', '-M', 'main');
    git('checkout', '-qb', 'feature');
    for (const [file, text] of Object.entries(changedFiles)) writeFile(root, file, text);
    configure({ root, git });
    git('add', '.');
    git('commit', '-qm', 'feature');
    return { root, git };
}

function writeFile(root, file, text) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (Buffer.isBuffer(text)) fs.writeFileSync(target, text);
    else fs.writeFileSync(target, text, 'utf8');
}

function noChangeRepository() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-complete-empty-')));
    const git = (...args) => execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Bygone complete coverage');
    writeFile(root, 'unchanged.txt', 'one\ntwo\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('branch', '-M', 'main');
    git('checkout', '-qb', 'feature');
    return { root, git };
}

function completeOptions(paths) {
    return {
        style: TourStyle.Final,
        depth: TourDepth.Guided,
        audience: TourAudience.Peer,
        familiarity: TourFamiliarity.Some,
        coverage: TourCoverage.Complete,
        ...(paths === undefined ? {} : { paths })
    };
}

function narrative(text) {
    return { summary: text, bullets: [], tags: ['test'], takeaway: text };
}

function walkthrough(id, steps) {
    return {
        id,
        kind: 'walkthrough',
        title: id,
        ...narrative(`Narration for ${id}.`),
        steps
    };
}

function step(id, focus, body = `Narration for ${id}.`) {
    return { id, title: id, body, focus };
}

function sourceForApp(inventory, steps, overrides = {}) {
    return {
        version: 8,
        range: { base: 'main', head: 'feature' },
        options: completeOptions(),
        anchors: {
            base: { file: 'app.txt', revision: 'base', contains: 'beta' },
            head: { file: 'app.txt', revision: 'head', contains: 'BETA' }
        },
        connections: [],
        chapters: [{ id: 'root', title: 'Root', scenes: [walkthrough('root-walkthrough', steps)] }],
        coverage: { exclusions: [], ...(overrides.coverage ? overrides.coverage : {}) },
        ...overrides
    };
}

function buildReport(source, root) {
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const manifest = tour.buildChangeTourManifest(root, { source });
    const complete = coverage.buildCompleteTourCoverage(root, source, inventory, manifest);
    assert.ok(complete, 'the fixture requests COMPLETE coverage');
    return { inventory, manifest, complete };
}

function appRepository() {
    return gitRepository(
        { 'app.txt': 'alpha\nbeta\ngamma\n' },
        { 'app.txt': 'alpha\nBETA\ngamma\n' }
    );
}

test('full hunk coverage requires narrated evidence on both sides', () => {
    const { root } = appRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = sourceForApp(inventory, [step('base-step', 'base'), step('head-step', 'head')]);
    const { complete } = buildReport(source, root);
    const report = complete.tour;
    assert.equal(report.status, StrictTourCoverageStatus.Complete);
    assert.equal(report.totalHunks, 1);
    assert.equal(report.includedHunks, 1);
    assert.equal(report.coveredHunks, 1);
    assert.deepEqual(report.uncoveredHunks, []);
    coverage.validateStrictTourCoverageMap(complete);
    const integrated = coverage.buildTourCoverageReport(root, source);
    assert.equal(integrated.complete.tour.status, StrictTourCoverageStatus.Complete);
});

test('a partial anchor cannot cover a changed hunk on the other side', () => {
    const { root } = appRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = sourceForApp(inventory, [step('head-only', 'head')]);
    const { complete } = buildReport(source, root);
    const report = complete.tour;
    assert.equal(report.status, StrictTourCoverageStatus.Incomplete);
    assert.equal(report.coveredHunks, 0);
    assert.deepEqual(report.uncoveredHunks[0].missingSides, ['base']);
});

test('duplicate anchors are unioned without inflating hunk counts', () => {
    const { root } = appRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = sourceForApp(inventory, [
        step('base-one', 'base'),
        step('base-two', 'base'),
        step('head-one', 'head'),
        step('head-two', 'head')
    ]);
    const { complete } = buildReport(source, root);
    const report = complete.tour;
    assert.equal(report.totalHunks, 1);
    assert.equal(report.coveredHunks, 1);
    assert.equal(report.uncoveredHunks.length, 0);
});

test('exclusions remain a blocking limitation even when all selected hunks are excluded', () => {
    const { root } = appRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const hunk = inventory.files[0].units[0].id;
    const source = sourceForApp(inventory, [step('base', 'base'), step('head', 'head')], {
        coverage: { exclusions: [{ path: 'app.txt', hunks: [hunk], reason: 'Generated fixture hunk.' }] }
    });
    const { complete } = buildReport(source, root);
    const report = complete.tour;
    assert.equal(report.totalHunks, 1);
    assert.equal(report.inventory.excludedHunks, 1);
    assert.equal(report.includedHunks, 0);
    assert.equal(report.coveredHunks, 0);
    assert.equal(report.status, StrictTourCoverageStatus.Incomplete);
    assert.equal(report.exclusions.length, 1);
});

test('root and independent mode scopes use effective options and keep evidence separate', () => {
    const { root } = gitRepository(
        { 'historical.txt': 'old historical\n', 'deconstructed.txt': 'old deconstructed\n' },
        { 'historical.txt': 'new historical\n', 'deconstructed.txt': 'new deconstructed\n' }
    );
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const historicalHunk = inventory.files.find((file) => file.path === 'historical.txt').units[0].id;
    const deconstructedHunk = inventory.files.find((file) => file.path === 'deconstructed.txt').units[0].id;
    const source = {
        version: 8,
        range: { base: 'main', head: 'feature' },
        options: completeOptions(['historical.txt']),
        anchors: {
            historicalBase: { file: 'historical.txt', revision: 'base', contains: 'old historical' },
            historicalHead: { file: 'historical.txt', revision: 'head', contains: 'new historical' },
            deconstructedBase: { file: 'deconstructed.txt', revision: 'base', contains: 'old deconstructed' },
            deconstructedHead: { file: 'deconstructed.txt', revision: 'head', contains: 'new deconstructed' }
        },
        connections: [],
        chapters: [{
            id: 'root',
            title: 'Root',
            scenes: [walkthrough('root', [step('root-historical-base', 'historicalBase'), step('root-historical-head', 'historicalHead')])]
        }],
        tours: {
            historical: {
                options: completeOptions(['historical.txt']),
                chapters: [{ id: 'historical', title: 'Historical', scenes: [walkthrough('historical', [
                    step('historical-base', 'historicalBase'), step('historical-head', 'historicalHead')
                ])] }]
            },
            deconstructed: {
                options: completeOptions(['deconstructed.txt']),
                chapters: [{ id: 'deconstructed', title: 'Deconstructed', scenes: [
                    {
                        id: 'stages',
                        kind: 'deconstructed-diff',
                        title: 'Stages',
                        ...narrative('Synthetic stages explain the selected hunk.'),
                        stages: [{
                            id: 'stage-one',
                            title: 'Introduce the line',
                            narration: 'Introduce the changed line in a deliberate stage.',
                            changes: [
                                { file: 'historical.txt', hunks: [historicalHunk] },
                                { file: 'deconstructed.txt', hunks: [deconstructedHunk] }
                            ]
                        }]
                    },
                    walkthrough('deconstructed', [
                        step('deconstructed-base', 'deconstructedBase'),
                        step('deconstructed-head', 'deconstructedHead')
                    ])
                ] }]
            }
        },
        coverage: { exclusions: [] }
    };
    const { complete } = buildReport(source, root);
    assert.deepEqual(Object.keys(complete).sort(), [StrictTourCoverageMode.Deconstructed, StrictTourCoverageMode.Historical]);
    assert.deepEqual(complete.historical.scope.requestedPaths, ['historical.txt']);
    assert.deepEqual(complete.historical.scope.resolvedPaths, ['historical.txt']);
    assert.equal(complete.historical.status, StrictTourCoverageStatus.Complete);
    assert.deepEqual(complete.deconstructed.scope.requestedPaths, ['deconstructed.txt']);
    assert.equal(complete.deconstructed.status, StrictTourCoverageStatus.Complete);
    assert.equal(complete.deconstructed.coveredHunks, 1);
    assert.equal(complete.deconstructed.uncoveredHunks.length, 0);
    assert.equal(historicalHunk !== deconstructedHunk, true);
});

test('root scope is reported for a legacy/root tour without authored modes', () => {
    const { root } = gitRepository(
        { 'app.txt': 'old\n', 'other.txt': 'old other\n' },
        { 'app.txt': 'new\n', 'other.txt': 'new other\n' }
    );
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const appSource = {
        ...sourceForApp(inventory, [step('app-base', 'base'), step('app-head', 'head')]),
        options: completeOptions(['app.txt']),
        anchors: {
            base: { file: 'app.txt', revision: 'base', contains: 'old' },
            head: { file: 'app.txt', revision: 'head', contains: 'new' }
        }
    };
    const { complete } = buildReport(appSource, root);
    assert.deepEqual(Object.keys(complete), [StrictTourCoverageMode.Tour]);
    assert.deepEqual(complete.tour.scope.resolvedPaths, ['app.txt']);
    assert.equal(complete.tour.totalHunks, 1);
    assert.equal(complete.tour.status, StrictTourCoverageStatus.Complete);
});

test('file-only empty changes require accounting and do not claim vacuous completion', () => {
    const { root } = gitRepository({ 'seed.txt': 'seed\n' }, { 'empty.txt': '' });
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = {
        version: 8,
        range: { base: 'main', head: 'feature' },
        options: completeOptions(),
        coverage: { exclusions: [], accountedFiles: [{ path: 'empty.txt', reason: 'An intentionally empty marker file.' }] }
    };
    const manifest = tour.buildChangeTourManifest(root);
    const complete = coverage.buildCompleteTourCoverage(root, source, inventory, manifest);
    assert.equal(complete.tour.totalHunks, 0);
    assert.equal(complete.tour.coveredHunks, 0);
    assert.equal(complete.tour.status, StrictTourCoverageStatus.NoTextualChanges);
    assert.deepEqual(complete.tour.outstandingPaths, []);
    assert.deepEqual(complete.tour.accountedFiles, [{ path: 'empty.txt', reason: 'An intentionally empty marker file.' }]);
});

test('an empty inventory is no-textual-changes, never 100 percent complete', () => {
    const { root } = noChangeRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = {
        version: 8,
        range: { base: 'main', head: 'feature' },
        options: completeOptions(),
        coverage: { exclusions: [] }
    };
    const manifest = tour.buildChangeTourManifest(root);
    const complete = coverage.buildCompleteTourCoverage(root, source, inventory, manifest);
    assert.equal(complete.tour.status, StrictTourCoverageStatus.NoTextualChanges);
    assert.equal(complete.tour.totalHunks, 0);
    assert.equal(complete.tour.coveredHunks, 0);
});

test('a source base that is not the inventory merge-base is incomplete', () => {
    const repository = appRepository();
    repository.git('checkout', '-q', 'main');
    writeFile(repository.root, 'main-only.txt', 'main commit\n');
    repository.git('add', '.');
    repository.git('commit', '-qm', 'main advances independently');
    repository.git('checkout', '-q', 'feature');
    const inventory = tour.buildChangeInventory(repository.root, { baseRef: 'main', headRef: 'feature' });
    const source = sourceForApp(inventory, [step('base', 'base'), step('head', 'head')]);
    const { complete } = buildReport(source, repository.root);
    const report = complete.tour;
    assert.equal(report.status, StrictTourCoverageStatus.Incomplete);
    assert.equal(report.range.mergeBaseMatchesRequestedBase, false);
    assert.match(report.limitations.join('\n'), /merge-base/);
});

test('an unknown scope path is a limitation rather than an empty success', () => {
    const { root } = appRepository();
    const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'feature' });
    const source = sourceForApp(inventory, [step('head', 'head')], {
        options: completeOptions(['does-not-exist'])
    });
    const { complete } = buildReport(source, root);
    const report = complete.tour;
    assert.equal(report.status, StrictTourCoverageStatus.Incomplete);
    assert.equal(report.inventory.selectedEntries, 0);
    assert.match(report.limitations.join('\n'), /does not match a changed file/);
});

test('omitted ranges use the compiled endpoints for independent deconstructed coverage', () => {
    const { root, git } = appRepository();
    try {
        git('commit', '--allow-empty', '-qm', 'Later revision');
        const inventory = tour.buildChangeInventory(root, { baseRef: 'main', headRef: 'HEAD' });
        const source = sourceForApp(inventory, [step('before', 'base'), step('after', 'head')]);
        delete source.range;
        source.tours = { deconstructed: { chapters: [{ id: 'stages', title: 'Stages', scenes: [{
            id: 'change', kind: 'deconstructed-diff', title: 'Explain the change',
            ...narrative('The original value is replaced.'),
            stages: [{ id: 'replace', title: 'Replace value', narration: 'Replace the value.',
                changes: [{ file: 'app.txt', hunks: inventory.files.find(file => file.path === 'app.txt').units.map(unit => unit.id) }] }],
            steps: [step('stage-before', 'base'), step('stage-after', 'head')]
        }] }] } };
        const original = JSON.stringify(source);
        const implicit = coverage.buildTourCoverageReport(root, source).complete.deconstructed;
        const explicit = coverage.buildTourCoverageReport(root, { ...source, range: { base: 'main', head: 'HEAD' } }).complete.deconstructed;
        assert.equal(implicit.status, StrictTourCoverageStatus.Complete);
        assert.equal(implicit.coveredHunks, explicit.coveredHunks);
        assert.deepEqual(implicit.limitations, []);
        assert.equal(implicit.range.baseOid, inventory.range.baseOid);
        assert.equal(JSON.stringify(source), original);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
