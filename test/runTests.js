const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { load: loadYaml } = require('js-yaml');
const {
    alignReplacementLines,
    buildTwoWayDiffModel,
    mergeText,
    scoreReplacementLinePair
} = require('../out/diffEngine.js');
const { buildDirectoryComparison, buildMultiDirectoryComparison } = require('../out/directoryDiff.js');
const { GitHistoryService } = require('../out/gitHistory.js');
const { buildBinaryComparison, classifyFile } = require('../out/binaryComparison.js');
const {
    materializeBranchReviewTrees,
    parseNameStatusZ,
    resolveBranchReviewRange,
    resolveReviewPathPair
} = require('../out/gitComparison.js');
const { dedupeDecorations } = require('../media/decorationUtils.js');
const {
    buildBlockChanges,
    buildDirectoryNavigationState,
    findChangeIndexAtLine,
    resolveFileNavigationAction
} = require('../media/navigationUtils.js');
const { getMenuCapabilities } = require('../standalone/menuUtils.js');
const { dispatchFindCommand, resolveFindTarget, runFindCommand } = require('../media/findController.js');
const {
    WORD_WRAP_STORAGE_KEY,
    applyWordWrap,
    readWordWrapPreference,
    writeWordWrapPreference
} = require('../media/wrapController.js');
const { getCliArgsFromArgv, getForwardedLaunchArgs } = require('../standalone/launchArgs.js');
const {
    createBranchReviewSource,
    createDirectoriesSource,
    createDirectoryHistorySource,
    createFileHistorySource,
    createFilesSource,
    createGitRefsSource,
    isRefreshableSource,
    sessionSourcesEqual
} = require('../standalone/sessionSource.js');
const { CLI_SPEC, renderCliHelp } = require('../cli/commandSpec.js');
const { completionFileName, generateCompletion, SUPPORTED_SHELLS } = require('../cli/completions.js');
const {
    buildChangeTourContext,
    buildChangeTourManifest,
    buildDeconstructedScene,
    compileDeconstructedScene,
    parseChangeTourManifest,
    parseChangeTourSource,
    parseChangeTourStory
} = require('../out/changeTour.js');
const { buildChangeInventory, materializeChangeUnits, parsePatchUnits } = require('../out/changeInventory.js');
const { buildTourCoverageReport } = require('../out/tourCoverage.js');
const { parsePresentArgs } = require('../cli/present.js');
const { parseTourArgs, runTourCommand } = require('../cli/tour.js');
const { getLinearTourTarget, getTourFileTarget, resolveTourPosition } = require('../out/tourNavigation.js');

function testTourLinearNavigationTraversesStepsAndScenes() {
    const scenes = [
        { id: 'intro', kind: 'discussion' },
        { id: 'walkthrough', kind: 'walkthrough', steps: [{ id: 'one' }, { id: 'two' }] },
        { id: 'appendix', kind: 'text-diff' }
    ];

    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 0, stepIndex: 0 }, 1), { sceneIndex: 1, stepIndex: 0 });
    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 1, stepIndex: 0 }, 1), { sceneIndex: 1, stepIndex: 1 });
    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 1, stepIndex: 1 }, 1), { sceneIndex: 2, stepIndex: 0 });
    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 2, stepIndex: 0 }, -1), { sceneIndex: 1, stepIndex: 1 });
    assert.equal(getLinearTourTarget(scenes, { sceneIndex: 0, stepIndex: 0 }, -1), null);
    assert.equal(getLinearTourTarget(scenes, { sceneIndex: 2, stepIndex: 0 }, 1), null);
}

function testDeconstructedTourNavigationTraversesExplanationStages() {
    const scenes = [
        { id: 'intro', kind: 'discussion' },
        { id: 'deconstructed', kind: 'deconstructed-diff', steps: [{ id: 'model' }, { id: 'behavior' }] },
        { id: 'appendix', kind: 'text-diff' }
    ];

    assert.deepEqual(resolveTourPosition(scenes, 'deconstructed', 'behavior'), { sceneIndex: 1, stepIndex: 1 });
    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 1, stepIndex: 0 }, 1), { sceneIndex: 1, stepIndex: 1 });
    assert.deepEqual(getLinearTourTarget(scenes, { sceneIndex: 2, stepIndex: 0 }, -1), { sceneIndex: 1, stepIndex: 1 });
}

function testTourPositionRestoresStableSceneAndStepIds() {
    const scenes = [
        { id: 'intro', kind: 'discussion' },
        { id: 'walkthrough', kind: 'walkthrough', steps: [{ id: 'one' }, { id: 'two' }] }
    ];

    assert.deepEqual(resolveTourPosition(scenes, 'walkthrough', 'two'), { sceneIndex: 1, stepIndex: 1 });
    assert.deepEqual(resolveTourPosition(scenes, 'walkthrough', 'missing'), { sceneIndex: 1, stepIndex: 0 });
    assert.deepEqual(resolveTourPosition(scenes, 'missing', 'two'), { sceneIndex: 0, stepIndex: 0 });
}

function testTourFileNavigationUsesCompleteRenderableFileIndex() {
    const files = [
        { id: 'a', kind: 'text-diff', path: 'src/a.ts' },
        { id: 'generated', kind: 'omitted', path: 'src/generated.js.map' },
        { id: 'b', kind: 'text-diff', path: 'src/b.ts' },
        { id: 'c', kind: 'text-diff', path: 'src/c.ts' }
    ];

    assert.deepEqual(getTourFileTarget(files, 'src/a.ts', 1), {
        fileIndex: 2,
        path: 'src/b.ts'
    });
    assert.deepEqual(getTourFileTarget(files, 'src/b.ts', -1), {
        fileIndex: 0,
        path: 'src/a.ts'
    });
    assert.deepEqual(getTourFileTarget(files, 'src/b.ts', 1), {
        fileIndex: 3,
        path: 'src/c.ts'
    });
    assert.equal(getTourFileTarget(files, 'src/a.ts', -1), null);
    assert.equal(getTourFileTarget(files, 'src/c.ts', 1), null);
    assert.equal(getTourFileTarget(files, null, 1), null);
}

function testWebTourHostSeparatesFileAndNarrativeNavigation() {
    const hostSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'host.js'), 'utf8');
    const webMarkup = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
    const providerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'diffViewProvider.ts'), 'utf8');
    const presenterSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'presenter.css'), 'utf8');

    assert.match(hostSource, /message\.type === 'navigateFile'[\s\S]{0,180}showTourFile/);
    assert.doesNotMatch(hostSource, /message\.type === 'navigateFile'[\s\S]{0,180}showTourLinear/);
    assert.match(hostSource, /function showTourFileAtIndex[\s\S]{0,300}emitDiffScene\(file\)/);
    assert.doesNotMatch(hostSource, /function showTourFile[\s\S]{0,500}showTourScene/);
    assert.match(hostSource, /getTourFileTarget\(tour\.files, state\.activeTourFilePath, direction\)/);
    assert.match(hostSource, /tourFocusFilePath/);
    assert.match(hostSource, /function returnToTourFocus/);
    assert.match(hostSource, /function renderMultiPanelStep/);
    assert.match(hostSource, /scene\.kind === 'deconstructed-diff'/);
    assert.match(hostSource, /scene\.stageLabel/);
    assert.match(hostSource, /getMultiPanelDefinitions/);
    assert.match(hostSource, /type: 'showMultiDiff'/);
    assert.match(webMarkup, /id="tour-files"/);
    assert.match(webMarkup, /id="tour-return-focus"/);
    assert.match(presenterSource, /\.tour-rail-sections[\s\S]{0,180}grid-template-rows/);
    assert.match(hostSource, /tourPrevious\?\.addEventListener\('click', \(\) => showTourLinear\(-1\)\)/);
    for (const markup of [webMarkup, providerSource]) {
        assert.match(markup, /id="next-file" class="change-button icon-button"/);
        assert.doesNotMatch(markup, /id="next-file" class="[^"]*change-button-primary/);
    }
    assert.match(hostSource, /parameters\.get\('step'\)/);
    assert.match(hostSource, /parameters\.set\('step', scene\.steps\[state\.activeStepIndex\]\.id\)/);
    assert.match(hostSource, /isInteractiveKeyTarget\(event\.target\)/);
    assert.match(presenterSource, /@media \(max-width: 720px\)[\s\S]+--tour-rail-height/);
    assert.match(presenterSource, /@media \(max-width: 720px\)[\s\S]+grid-template-columns: minmax\(190px/);
}

function testTourAnnotationPersistsAcrossChangeNavigation() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const hostSource = fs.readFileSync(path.join(__dirname, '..', 'web', 'host.js'), 'utf8');

    assert.match(rendererSource, /let currentTourAnnotations = \[\];/);
    assert.match(rendererSource, /currentTwoWayComparisonKey = comparisonKey;\s+currentTourAnnotations = tourAnnotations;/);
    assert.match(rendererSource, /function setActiveDiffIndex[\s\S]{0,300}applyDiffDecorations\(currentDiffModel, currentTourAnnotations\)/);
    assert.match(rendererSource, /className: tourAnnotation\.active \? 'bygone-tour-anchor' : undefined/);
    assert.match(rendererSource, /linesDecorationsClassName: 'bygone-tour-anchor-gutter'/);
    assert.match(hostSource, /scene\.steps\s+\.filter\(\(candidate\) => candidate\.diff\.path === step\.diff\.path\)/);
    assert.match(hostSource, /active: candidate\.id === step\.id/);
}

function testStandaloneMenusExposeProductAreasAndReplace() {
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');
    const findSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'findController.js'), 'utf8');

    for (const label of ['Git', 'Present', 'Navigate', 'View', 'Window']) {
        assert.match(standaloneSource, new RegExp(`label: '${label}'`));
    }
    assert.match(standaloneSource, /label: 'Explore Current Branch Change'/);
    assert.match(standaloneSource, /label: 'Open Authored Tour…'/);
    assert.match(standaloneSource, /label: 'Replace…'[\s\S]{0,220}postFindCommand\('replace'\)/);
    assert.match(standaloneSource, /label: 'Replace All'[\s\S]{0,220}postFindCommand\('replaceAll'\)/);
    assert.match(standaloneSource, /const isDevelopment = !app\.isPackaged/);
    assert.match(findSource, /replace: 'editor\.action\.startFindReplaceAction'/);
    assert.match(findSource, /replaceAll: 'editor\.action\.replaceAll'/);
}

function testTextPanelsExposeMutabilityProvenance() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    assert.match(rendererSource, /panel\.editable \? 'Writable file' : 'Read-only snapshot'/);
    assert.match(rendererSource, /button\.textContent = !hasEditableSide \? 'Read-only snapshot'/);
}

function testVsCodeSurfaceHandsLargeWorkToDesktopAndPackagesOnlyRuntime() {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
    const launcherSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktopLauncher.ts'), 'utf8');
    const packageCheck = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-vsix-contents.mjs'), 'utf8');

    assert.ok(!packageJson.activationEvents.includes('onCommand:bygone.compareTestFiles'));
    assert.ok(!packageJson.contributes.commands.some((entry) => entry.command === 'bygone.compareTestFiles'));
    for (const command of ['bygone.exploreBranchInDesktop', 'bygone.presentBranchInDesktop', 'bygone.openTourInDesktop']) {
        assert.ok(packageJson.contributes.commands.some((entry) => entry.command === command));
        assert.match(extensionSource, new RegExp(command.replaceAll('.', '\\.')));
    }
    assert.match(launcherSource, /spawn\(executable, args,[\s\S]{0,180}shell: false/);
    assert.match(launcherSource, /getConfiguration\('bygone'\).*desktopExecutable/);
    assert.match(packageJson.scripts['package:vsix'], /check-vsix-contents/);
    assert.match(packageCheck, /Unexpected VSIX files/);
}

function testLineClickSelectsContainingTwoWayChange() {
    const model = buildTwoWayDiffModel('one\ntwo\nthree\nfour\n', 'one\nTWO\nthree\nFOUR\n');
    const rightChanges = buildBlockChanges(model.blocks, 'right');

    assert.equal(findChangeIndexAtLine(rightChanges, 2), 0);
    assert.equal(findChangeIndexAtLine(rightChanges, 4), 1);
    assert.equal(findChangeIndexAtLine(rightChanges, 3), -1);
}

function testLineClickIgnoresCollapsedSideOfOneSidedChange() {
    const model = buildTwoWayDiffModel('one\nthree\n', 'one\ntwo\nthree\n');

    assert.equal(findChangeIndexAtLine(buildBlockChanges(model.blocks, 'left'), 2), -1);
    assert.equal(findChangeIndexAtLine(buildBlockChanges(model.blocks, 'right'), 2), 0);
}

function testLineClickPrefersCurrentAdjacentPair() {
    const changes = [
        { start: 4, end: 6, pairIndex: 0 },
        { start: 4, end: 6, pairIndex: 1 }
    ];

    assert.equal(findChangeIndexAtLine(changes, 5, 1), 1);
    assert.equal(findChangeIndexAtLine(changes, 5, 0), 0);
}

function testDirectoryDrilldownNavigationTracksActiveFile() {
    const navigation = buildDirectoryNavigationState([
        { relativePath: 'folder/', isDirectory: true, status: 'modified' },
        { relativePath: 'same.txt', isDirectory: false, status: 'same' },
        { relativePath: 'a.txt', isDirectory: false, status: 'modified' },
        { relativePath: 'b.txt', isDirectory: false, status: 'partial' },
        { relativePath: 'c.txt', isDirectory: false, status: 'right-only' }
    ], 'b.txt');

    assert.deepEqual(navigation.fileNavigation, { canGoPrevious: true, canGoNext: true });
    assert.deepEqual(
        navigation.directoryNavigation.rail.itemsByTab['directory-files'].map((item) => [item.relativePath, item.active]),
        [['a.txt', false], ['b.txt', true], ['c.txt', false]]
    );
}

function testDirectoryHistoryFileNavigationTakesPriorityOverPanelNavigation() {
    assert.deepEqual(resolveFileNavigationAction({
        direction: 'previous',
        mode: 'multi-way',
        fileNavigation: { canGoPrevious: true, canGoNext: true },
        panelIds: ['older', 'newer'],
        activePanelId: 'newer'
    }), { kind: 'host-file' });
}

function testGitNameStatusParserPreservesRenameMetadata() {
    assert.deepEqual(parseNameStatusZ('M\u0000src/current.ts\u0000R087\u0000old name.ts\u0000new name.ts\u0000'), [
        { kind: 'modified', path: 'src/current.ts' },
        {
            kind: 'renamed',
            path: 'new name.ts',
            previousPath: 'old name.ts',
            similarity: 87
        }
    ]);
}

function testCliSpecificationDrivesHelpAndEveryCompletionFormat() {
    const help = renderCliHelp('test-version');
    assert.match(help, /^Bygone test-version/);

    for (const entry of CLI_SPEC.entries) {
        for (const token of entry.tokens) {
            assert.ok(help.includes(token), `help is missing ${token}`);
        }
    }

    for (const shell of SUPPORTED_SHELLS) {
        const generated = generateCompletion(shell);
        const checkedIn = fs.readFileSync(
            path.join(__dirname, '..', 'completions', completionFileName(shell)),
            'utf8'
        );
        assert.equal(checkedIn, generated, `${shell} completion is stale`);
        assert.match(generated, /git for-each-ref/);
        assert.match(generated, /INDEX/);
        assert.match(generated, /WORKTREE/);
        for (const entry of CLI_SPEC.entries) {
            for (const token of entry.tokens) {
                const renderedToken = shell === 'fish' && token.startsWith('--')
                    ? `-l ${token.slice(2)}`
                    : shell === 'fish' && token.startsWith('-')
                        ? `-s ${token.slice(1)}`
                        : token;
                assert.ok(generated.includes(renderedToken), `${shell} completion is missing ${token}`);
            }
        }
    }
}

function testCliPrintsGeneratedCompletionsWithoutStartingElectron() {
    const output = execFileSync(process.execPath, [
        path.join(__dirname, '..', 'bin', 'bygone.js'),
        'completion',
        'zsh'
    ], { encoding: 'utf8' });
    assert.equal(output, generateCompletion('zsh'));

    const invalid = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'bin', 'bygone.js'),
        'completion',
        'powershell'
    ], { encoding: 'utf8' });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /zsh\|bash\|fish/);
}

function testChangeTourBuildsPortableNarrativeChapters() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-tour-'));
    runGit(repo, ['init']);
    runGit(repo, ['config', 'user.email', 'tour@example.com']);
    runGit(repo, ['config', 'user.name', 'Tour Test']);
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'architecture.md'), 'Original architecture\n');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'models.ts'), 'export const version = 1;\n');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/tour']);
    fs.appendFileSync(path.join(repo, 'docs', 'architecture.md'), 'New event flow\n');
    fs.writeFileSync(path.join(repo, 'src', 'models.ts'), 'export const version = 2;\nexport interface Event {}\n');
    fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'tests', 'models.test.ts'), 'it("works", () => {});\n');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'feat: explain event flow']);

    const manifest = buildChangeTourManifest(repo, {
        headRef: 'feature/tour',
        baseRef: 'main',
        title: 'Event flow tour',
        generatedAt: '2026-08-01T00:00:00.000Z'
    });

    assert.equal(manifest.title, 'Event flow tour');
    assert.equal(manifest.summary.changedFiles, 3);
    assert.equal(manifest.summary.includedScenes, 3);
    assert.deepEqual(manifest.chapters.map((chapter) => chapter.id), ['context', 'contracts', 'proof']);
    assert.deepEqual(manifest.scenes.map((scene) => scene.path), [
        'docs/architecture.md',
        'src/models.ts',
        'tests/models.test.ts'
    ]);
    assert.deepEqual(manifest.files.map((file) => file.path), [
        'docs/architecture.md',
        'src/models.ts',
        'tests/models.test.ts'
    ]);
    assert.equal(parseChangeTourManifest(JSON.parse(JSON.stringify(manifest))).version, 1);
    assert.throws(() => parseChangeTourManifest({ version: 1 }), /title must be a string/);

    const story = parseChangeTourStory({
        title: 'Authored event flow',
        scenes: [
            {
                kind: 'discussion',
                chapterId: 'why',
                chapterTitle: 'Why',
                title: 'Why change this?',
                summary: 'The old flow hid causality.',
                bullets: ['Preserve the decision trail.'],
                tags: ['context'],
                takeaway: 'Make the change explainable.'
            },
            {
                kind: 'file',
                chapterId: 'model',
                chapterTitle: 'Model',
                path: 'src/models.ts',
                summary: 'The model carries explicit event identity.',
                bullets: ['Consumers receive a stable contract.'],
                tags: ['contract'],
                takeaway: 'Identity is explicit.',
                focusChangeIndex: 0
            }
        ]
    });
    const authored = buildChangeTourManifest(repo, {
        headRef: 'feature/tour',
        baseRef: 'main',
        generatedAt: '2026-08-01T00:00:00.000Z',
        story
    });
    assert.equal(authored.title, 'Authored event flow');
    assert.deepEqual(authored.chapters.map((chapter) => chapter.id), ['why', 'model']);
    assert.deepEqual(authored.scenes.map((scene) => scene.kind), ['discussion', 'text-diff']);
    assert.equal(authored.files.length, 3);
    assert.equal(authored.scenes[1].kind === 'text-diff' ? authored.scenes[1].focusChangeIndex : undefined, 0);
    assert.throws(() => parseChangeTourStory({ scenes: [{ kind: 'discussion' }] }), /chapterId/);

    const source = parseChangeTourSource({
        version: 1,
        title: 'Anchored event flow',
        anchors: {
            contract: { file: 'src/models.ts', revision: 'head', contains: 'export interface Event {}' },
            version: { file: 'src/models.ts', revision: 'head', contains: 'export const version = 2;' }
        },
        connections: {
            contractToVersion: { from: 'contract', to: 'version', label: 'The contract ships with version two.' }
        },
        chapters: [{
            id: 'flow',
            title: 'Flow',
            scenes: [{
                id: 'walkthrough',
                title: 'Walk through the contract',
                summary: 'Follow exact code.',
                bullets: [],
                tags: ['contract'],
                takeaway: 'Anchors survive hunk reordering.',
                steps: [{
                    id: 'contract-step',
                    title: 'Add the contract',
                    body: 'The new interface is the reviewer focus.',
                    focus: 'contract',
                    connection: 'contractToVersion',
                    depth: 'contextualized'
                }]
            }]
        }],
        coverage: {
            exclusions: [{ path: 'docs/architecture.md', reason: 'Narrative documentation is reviewed separately.' }]
        }
    });
    const anchored = buildChangeTourManifest(repo, {
        headRef: 'feature/tour',
        baseRef: 'main',
        generatedAt: '2026-08-01T00:00:00.000Z',
        source
    });
    assert.equal(anchored.scenes[0].kind, 'walkthrough');
    assert.equal(anchored.scenes[0].kind === 'walkthrough' ? anchored.scenes[0].steps[0].focus.startLine : 0, 2);
    assert.equal(anchored.scenes[0].kind === 'walkthrough' ? anchored.scenes[0].steps[0].connection?.from.startLine : 0, 2);
    assert.deepEqual(anchored.chapters.map((chapter) => chapter.id), ['flow']);
    assert.equal(anchored.files.length, 3);
    assert.equal(anchored.scenes[0].kind === 'walkthrough' ? anchored.scenes[0].steps[0].depth : undefined, 'contextualized');
    const coverage = buildTourCoverageReport(repo, source);
    assert.equal(coverage.version, 1);
    assert.equal(coverage.totals.originalUnits, 3);
    assert.equal(coverage.totals.excludedUnits, 1);
    assert.equal(coverage.totals.includedUnits, 2);
    assert.equal(coverage.totals.coveredUnits, 1);
    assert.equal(coverage.totals.coveragePercent, 50);
    assert.deepEqual(coverage.depth, { mentioned: 0, explained: 0, contextualized: 1 });
    assert.equal(coverage.files.find((file) => file.path === 'tests/models.test.ts').uncoveredHunks.length, 1);
    assert.throws(() => buildChangeTourManifest(repo, {
        headRef: 'feature/tour', baseRef: 'main', source: {
            ...source,
            anchors: { ...source.anchors, contract: { ...source.anchors.contract, contains: 'missing code' } }
        }
    }), /did not match/);
    assert.throws(() => parseChangeTourSource({ ...source, inventedField: true }), /unknown field: inventedField/);
    assert.throws(() => parseChangeTourSource({ ...source, chapters: [] }), /non-empty array/);

    fs.mkdirSync(path.join(repo, 'web'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'web', 'app.js.map'), `${'A'.repeat(70 * 1024)}\n`, 'utf8');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'build: add generated source map']);
    const guarded = buildChangeTourManifest(repo, {
        headRef: 'feature/tour',
        baseRef: 'main',
        generatedAt: '2026-08-01T00:00:00.000Z'
    });
    assert.equal(guarded.summary.changedFiles, 4);
    assert.equal(guarded.summary.includedScenes, 3);
    assert.deepEqual(guarded.summary.omittedFiles, ['web/app.js.map']);
    assert.equal(guarded.files.length, 4);
    assert.equal(guarded.files.find((file) => file.path === 'web/app.js.map')?.kind, 'omitted');
    assert.equal(guarded.scenes.some((scene) => scene.kind === 'text-diff' && scene.path === 'web/app.js.map'), false);
}

function testStackedTourBuildsOrderedRevisionPanelsAndRenameAliases() {
    const repo = createTempGitRepo();
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'base.ts'), 'export const base = true;\n', 'utf8');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'stack/model']);
    fs.writeFileSync(path.join(repo, 'src', 'model.ts'), 'export interface Event {}\n', 'utf8');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'add model']);
    runGit(repo, ['checkout', '-b', 'stack/behavior']);
    runGit(repo, ['mv', 'src/model.ts', 'src/event.ts']);
    fs.appendFileSync(path.join(repo, 'src', 'event.ts'), 'export const emit = () => true;\n');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'add behavior']);

    const source = parseChangeTourSource({
        version: 1,
        title: 'Stacked event tour',
        range: { base: 'main', head: 'stack/behavior' },
        anchors: {},
        connections: [],
        chapters: [{
            id: 'stack',
            title: 'Stack',
            scenes: [{
                id: 'event-stack',
                kind: 'stacked-diff',
                title: 'Build the event stack',
                summary: 'Follow the event API through two layers.',
                bullets: [],
                tags: ['stack'],
                takeaway: 'Each layer remains independently reviewable.',
                stack: [
                    { id: 'base', ref: 'main', label: 'Main' },
                    { id: 'model', ref: 'stack/model', label: 'Model' },
                    { id: 'behavior', ref: 'stack/behavior', label: 'Behavior' }
                ],
                files: ['src/event.ts'],
                steps: [
                    { id: 'model-step', title: 'Model', body: 'Introduce the contract.', file: 'src/event.ts', pair: ['base', 'model'], side: 'right', lines: [1, 1] },
                    { id: 'behavior-step', title: 'Behavior', body: 'Extend the contract.', file: 'src/event.ts', pair: ['model', 'behavior'], side: 'right', lines: [2, 2] }
                ]
            }]
        }]
    });
    const manifest = buildChangeTourManifest(repo, { source, baseRef: 'main', headRef: 'stack/behavior' });
    const scene = manifest.scenes[0];
    assert.equal(scene.kind, 'stacked-diff');
    assert.equal(scene.stack.length, 3);
    assert.equal(scene.files.length, 1);
    assert.equal(scene.files[0].panels[0].exists, false);
    assert.equal(scene.files[0].panels[1].path, 'src/model.ts');
    assert.equal(scene.files[0].panels[2].path, 'src/event.ts');
    assert.equal(scene.steps[0].pairIndex, 0);
    assert.equal(scene.steps[1].pairIndex, 1);
    assert.equal(parseChangeTourManifest(JSON.parse(JSON.stringify(manifest))).scenes[0].kind, 'stacked-diff');
    const automaticSource = {
        ...source,
        chapters: [{
            ...source.chapters[0],
            scenes: [{ ...source.chapters[0].scenes[0], files: undefined }]
        }]
    };
    const automaticManifest = buildChangeTourManifest(repo, {
        source: automaticSource,
        baseRef: 'main',
        headRef: 'stack/behavior'
    });
    assert.deepEqual(automaticManifest.scenes[0].files.map((file) => file.path), ['src/event.ts']);

    assert.throws(() => parseChangeTourSource({
        ...source,
        chapters: [{ ...source.chapters[0], scenes: [{ ...source.chapters[0].scenes[0], steps: [
            { id: 'bad', title: 'Bad', body: 'Bad pair.', file: 'src/event.ts', pair: ['base', 'behavior'] }
        ] }] }]
    }), /adjacent stack entries/);
}

function testPresentArgumentsUseSharedBaseAliases() {
    assert.deepEqual(parsePresentArgs(['feature/tour', '--base', 'origin/main']), {
        headRef: 'feature/tour',
        baseRef: 'origin/main',
        tourPath: undefined,
        explicitHeadRef: 'feature/tour'
    });
    assert.deepEqual(parsePresentArgs(['-m', 'main', '--tour', 'review.bygone.yaml']), {
        headRef: 'HEAD', baseRef: 'main', tourPath: 'review.bygone.yaml', explicitHeadRef: undefined
    });
    assert.throws(() => parsePresentArgs(['--unknown']), /Unknown present option/);
}

function testCheckedInBygoneHistoryTourRemainsReproducible() {
    const source = parseChangeTourSource(loadYaml(fs.readFileSync(
        path.join(__dirname, '..', 'examples', 'bygone-history.bygone.yaml'),
        'utf8'
    )));
    assert.equal(source.range?.base, '292fe9248c5c49f762489dc688296fc100d120bc');
    assert.equal(source.range?.head, '75b6d7c0303124ec314aa790d6b808c4a9d9ea0e');
    const manifest = buildChangeTourManifest(path.join(__dirname, '..'), {
        baseRef: source.range?.base,
        headRef: source.range?.head,
        source,
        generatedAt: '2026-08-01T00:00:00.000Z'
    });
    assert.equal(manifest.scenes[0].kind, 'walkthrough');
    assert.equal(manifest.scenes[0].kind === 'walkthrough' ? manifest.scenes[0].steps.length : 0, 5);
    assert.equal(manifest.range.mergeBaseOid, source.range?.base);
}

function testAdvancedTourExamplesRemainReproducible() {
    for (const [fileName, expectedKind] of [
        ['stacked-diff.bygone.yaml', 'stacked-diff'],
        ['deconstructed-diff.bygone.yaml', 'deconstructed-diff']
    ]) {
        const source = parseChangeTourSource(loadYaml(fs.readFileSync(
            path.join(__dirname, '..', 'examples', fileName),
            'utf8'
        )));
        const manifest = buildChangeTourManifest(path.join(__dirname, '..'), { source });
        assert.equal(manifest.scenes[0].kind, expectedKind);
        assert.equal(manifest.scenes[0].steps.length, 3);
    }
}

function testVersionTourChangelogRemainsReproducible() {
    const source = parseChangeTourSource(loadYaml(fs.readFileSync(
        path.join(__dirname, '..', 'tours', 'v0.6.bygone.yaml'),
        'utf8'
    )));
    assert.equal(source.range?.base, '18fa9dda779309663c290ea8a3efff6217ea5757');
    assert.equal(source.range?.head, 'e6e3e0554e480be319b645293eaab5348a2c55fe');
    assert.equal(source.chapters.length, 3);
    assert.equal(source.chapters.flatMap((chapter) => chapter.scenes).length, 5);
    assert.equal(source.chapters.flatMap((chapter) => chapter.scenes.flatMap((scene) => scene.steps)).length, 28);

    const manifest = buildChangeTourManifest(path.join(__dirname, '..'), {
        baseRef: source.range?.base,
        headRef: source.range?.head,
        source,
        generatedAt: '2026-08-04T00:00:00.000Z'
    });
    assert.equal(manifest.summary.changedFiles, 105);
    assert.equal(manifest.files.length, 105);
    assert.equal(manifest.summary.includedScenes, 5);
    assert.equal(manifest.summary.omittedFiles.length, 18);
}

function testAgentTourCommandsValidateCompileAndExposeSchema() {
    assert.deepEqual(parseTourArgs(['validate', 'review.bygone.yaml', '--json']), {
        action: 'validate', sourcePath: 'review.bygone.yaml', outputPath: undefined, json: true
    });
    assert.deepEqual(parseTourArgs(['compile', 'review.bygone.yaml', '-o', 'tour.json']), {
        action: 'compile', sourcePath: 'review.bygone.yaml', outputPath: 'tour.json', json: false
    });
    assert.deepEqual(parseTourArgs(['context', 'feature/tour', '--base', 'main', '--max-patch-bytes', '4096']), {
        action: 'context', headRef: 'feature/tour', baseRef: 'main', outputPath: undefined,
        maxPatchBytes: 4096, maxTotalPatchBytes: undefined
    });
    assert.deepEqual(parseTourArgs(['coverage', 'review.bygone.yaml', '--json', '--minimum-coverage', '75']), {
        action: 'coverage', sourcePath: 'review.bygone.yaml', outputPath: undefined, json: true, minimumCoverage: 75
    });
    assert.throws(() => parseTourArgs(['validate']), /requires a \.bygone\.yaml/);
    assert.throws(() => parseTourArgs(['compile', 'review.bygone.yaml', '--json']), /only valid with tour validate/);

    const repoRoot = path.join(__dirname, '..');
    const sourcePath = 'examples/bygone-history.bygone.yaml';
    let validationOutput = '';
    const validation = runTourCommand(['validate', sourcePath, '--json'], repoRoot, repoRoot, {
        write(chunk) { validationOutput += chunk; }
    });
    assert.equal(validation.ok, true);
    assert.equal(JSON.parse(validationOutput).walkthroughSteps, 5);

    const outputPath = path.join(os.tmpdir(), `bygone-tour-${process.pid}.json`);
    runTourCommand(['compile', sourcePath, '--output', outputPath], repoRoot, repoRoot, { write() {} });
    assert.equal(parseChangeTourManifest(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).version, 1);
    fs.rmSync(outputPath, { force: true });

    let schemaOutput = '';
    runTourCommand(['schema'], repoRoot, repoRoot, { write(chunk) { schemaOutput += chunk; } });
    const schema = JSON.parse(schemaOutput);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(schema.required, ['version', 'anchors', 'connections', 'chapters']);
}

function testChangeTourContextPackagesBoundedGitEvidence() {
    const repo = createTempGitRepo();
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'old-name.ts'), [
        'export function calculate() {',
        '    return 1;',
        '}',
        '// stable context',
        '// more stable context',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 2]));
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/context']);
    runGit(repo, ['mv', 'src/old-name.ts', 'src/new-name.ts']);
    fs.writeFileSync(path.join(repo, 'src', 'new-name.ts'), [
        'export function calculate() {',
        '    return 2;',
        '}',
        '// stable context',
        '// more stable context',
        ''
    ].join('\n'));
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 3]));
    fs.mkdirSync(path.join(repo, 'tests'));
    fs.writeFileSync(path.join(repo, 'tests', 'calculate.test.ts'), 'it("calculates", () => {});\n');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'feat: change calculation']);

    const context = buildChangeTourContext(repo, {
        headRef: 'HEAD', baseRef: 'main', generatedAt: '2026-08-01T00:00:00.000Z'
    });
    assert.equal(context.version, 1);
    assert.equal(context.summary.changedFiles, 3);
    assert.equal(context.summary.binaryFiles, 1);
    const binary = context.files.find((file) => file.path === 'asset.bin');
    assert.equal(binary?.patchOmittedReason, 'binary');
    const renamed = context.files.find((file) => file.path === 'src/new-name.ts');
    assert.equal(renamed?.previousPath, 'src/old-name.ts');
    assert.match(renamed?.patch || '', /return 2/);
    assert.ok(renamed?.changedRanges.length);
    assert.deepEqual(renamed?.symbolHints.map((symbol) => symbol.name), ['calculate']);
    assert.equal(context.files.find((file) => file.path.includes('calculate.test'))?.role, 'test');

    const bounded = buildChangeTourContext(repo, {
        headRef: 'HEAD', baseRef: 'main', maxPatchBytes: 1
    });
    assert.equal(bounded.files.find((file) => file.path === 'src/new-name.ts')?.patchOmittedReason, 'too-large');
    assert.ok(bounded.files.find((file) => file.path === 'src/new-name.ts')?.changedRanges.length);
    const totalBounded = buildChangeTourContext(repo, {
        headRef: 'HEAD', baseRef: 'main', maxTotalPatchBytes: 1
    });
    assert.ok(totalBounded.files.some((file) => file.patchOmittedReason === 'total-budget'));
    assert.equal(totalBounded.summary.includedPatchBytes, 0);
}

function testGeneratedCompletionScriptsPassAvailableShellSyntaxChecks() {
    const checks = [
        ['zsh', path.join(__dirname, '..', 'completions', '_bygone')],
        ['bash', path.join(__dirname, '..', 'completions', 'bygone')],
        ['fish', path.join(__dirname, '..', 'completions', 'bygone.fish')]
    ];

    for (const [shell, completionPath] of checks) {
        const result = spawnSync(shell, ['-n', completionPath]);
        if (result.error?.code === 'ENOENT') {
            continue;
        }
        if (result.error) {
            throw result.error;
        }
        assert.equal(result.status, 0, result.stderr?.toString() || `${shell} completion syntax failed`);
    }
}

function testReviewPathPairUsesDistinctRenameEndpoints() {
    assert.deepEqual(resolveReviewPathPair([{
        kind: 'renamed',
        previousPath: 'src/old-name.ts',
        path: 'src/new-name.ts',
        similarity: 92
    }], 'src/old-name.ts'), {
        key: 'src/new-name.ts',
        leftPath: 'src/old-name.ts',
        rightPath: 'src/new-name.ts',
        kind: 'renamed',
        similarity: 92,
        summary: 'Renamed src/old-name.ts → src/new-name.ts · 92% similarity'
    });
}

function testBinaryComparisonBuildsImagePreviewsAndEquality() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-binary-test-'));
    const left = path.join(root, 'left.png');
    const right = path.join(root, 'right.png');
    const onePixelPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
    );
    fs.writeFileSync(left, onePixelPng);
    fs.writeFileSync(right, onePixelPng);

    const same = buildBinaryComparison(left, right, 'left image', 'right image');
    assert.equal(same?.kind, 'image');
    assert.equal(same?.identical, true);
    assert.match(same?.left.dataUrl ?? '', /^data:image\/png;base64,/);

    fs.appendFileSync(right, Buffer.from([1]));
    const different = buildBinaryComparison(left, right);
    assert.equal(different?.identical, false);
}

function testBinaryComparisonDetectsGenericBinaryWithoutPreview() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-binary-test-'));
    const left = path.join(root, 'left.data');
    const right = path.join(root, 'right.data');
    fs.writeFileSync(left, Buffer.from([1, 0, 2]));
    fs.writeFileSync(right, Buffer.from([1, 0, 3]));

    assert.equal(classifyFile(left), 'binary');
    const comparison = buildBinaryComparison(left, right);
    assert.equal(comparison?.kind, 'binary');
    assert.equal(comparison?.identical, false);
    assert.equal(comparison?.left.dataUrl, undefined);
}

function testMenuCapabilitiesFollowSessionMode() {
    assert.deepEqual(getMenuCapabilities({ mode: 'empty' }), {
        isMultiDiff: false,
        isTwoWayDiff: false,
        isHistory: false,
        canFind: false,
        canRefreshSession: false,
        canReturnToDirectory: false,
        canAddPanel: false,
        canRemovePanel: false
    });
    const multi = getMenuCapabilities({
        mode: 'multi-diff',
        source: createFilesSource(['/tmp/left', '/tmp/right']),
        multi: {
            activePanelId: 'middle',
            files: [{ path: '/tmp/left' }, { path: '/tmp/middle' }, { path: '/tmp/right' }]
        },
        returnDirectory: { relativePath: 'a.txt' }
    });
    assert.equal(multi.canAddPanel, true);
    assert.equal(multi.canRemovePanel, true);
    assert.equal(multi.canReturnToDirectory, true);
    assert.equal(multi.canRefreshSession, true);
    assert.equal(multi.canFind, true);
}

function createFindEditor(name, actionLog, available = true) {
    return {
        getModel: () => available ? { name } : null,
        focus: () => actionLog.push(`${name}:focus`),
        getAction: (actionId) => ({ run: () => actionLog.push(`${name}:${actionId}`) })
    };
}

function testFindControllerTargetsOneActiveEditor() {
    const actions = [];
    const left = createFindEditor('left', actions);
    const right = createFindEditor('right', actions);
    const middle = createFindEditor('middle', actions);

    assert.equal(resolveFindTarget({
        mode: 'two-way', activePaneSide: 'left', leftEditor: left, rightEditor: right
    }), left);
    assert.equal(resolveFindTarget({
        mode: 'two-way', activePaneSide: 'right', leftEditor: left, rightEditor: right
    }), right);
    assert.equal(resolveFindTarget({
        mode: 'multi-way',
        activeMultiPanelId: 'middle',
        multiPanels: [{ id: 'left' }, { id: 'middle' }],
        multiEditors: [left, middle]
    }), middle);
    assert.equal(resolveFindTarget({ mode: 'directory', leftEditor: left, rightEditor: right }), null);
    assert.equal(resolveFindTarget({
        mode: 'two-way',
        activePaneSide: 'left',
        leftEditor: createFindEditor('disposed', actions, false),
        rightEditor: right
    }), right);

    assert.equal(dispatchFindCommand(left, 'open'), true);
    assert.deepEqual(actions, ['left:focus', 'left:actions.find']);
    actions.length = 0;
    assert.equal(runFindCommand({
        mode: 'two-way', activePaneSide: 'right', leftEditor: left, rightEditor: right
    }, 'previous'), true);
    assert.deepEqual(actions, ['right:focus', 'right:editor.action.previousMatchFindAction']);
    assert.equal(runFindCommand({ mode: 'binary' }, 'next'), false);
}

function testFindCommandsUseRendererRatherThanPageSearch() {
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');

    assert.match(standaloneSource, /label: 'Find'[\s\S]{0,100}accelerator: 'CmdOrCtrl\+F'/);
    assert.match(standaloneSource, /label: 'Find Next'[\s\S]{0,100}accelerator: 'F3'/);
    assert.match(standaloneSource, /label: 'Find Previous'[\s\S]{0,100}accelerator: 'Shift\+F3'/);
    assert.match(standaloneSource, /postToRenderer\(\{ type: 'find', command \}\)/);
    assert.doesNotMatch(standaloneSource, /findInPage/);
    assert.match(rendererSource, /message\.type === 'find'/);
    assert.match(rendererSource, /runActiveEditorFindCommand\(message\.command\)/);
}

function testFindShortcutCapturesControlAndCommandBeforeEditors() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const entrySource = fs.readFileSync(path.join(__dirname, '..', 'media', 'webview-entry.js'), 'utf8');

    assert.match(entrySource, /contrib\/find\/browser\/findController\.js/);
    assert.match(rendererSource, /\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]{0,180}event\.key\.toLowerCase\(\) === 'f'/);
    assert.match(rendererSource, /runActiveEditorFindCommand\('open'\);[\s\S]{0,40}\}, true\);/);
    assert.match(rendererSource, /event\.stopPropagation\(\)/);
}

function testSidebarsExposeResizeCollapseAndRestoreControls() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const styleSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'style.css'), 'utf8');
    for (const relativePath of ['standalone/index.html', 'web/index.html', 'src/diffViewProvider.ts']) {
        const markup = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        assert.match(markup, /id="show-navigation-sidebar"[^>]+title="Show navigation sidebar"/);
    }
    assert.match(rendererSource, /data-rail-collapse/);
    assert.match(rendererSource, /data-rail-resizer/);
    assert.match(styleSource, /--history-rail-width/);

    const presenterMarkup = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
    const presenterHost = fs.readFileSync(path.join(__dirname, '..', 'web', 'host.js'), 'utf8');
    assert.match(presenterMarkup, /id="tour-sidebar-hide"/);
    assert.match(presenterMarkup, /id="tour-sidebar-show"/);
    assert.match(presenterMarkup, /id="tour-sidebar-resizer"[^>]+role="separator"/);
    assert.match(presenterHost, /TOUR_SIDEBAR_STORAGE_KEY/);
}

function testWordWrapControllerPersistsAndAppliesPreference() {
    const values = new Map();
    const storage = {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value)
    };
    assert.equal(readWordWrapPreference(storage), false);
    assert.equal(writeWordWrapPreference(storage, true), true);
    assert.equal(values.get(WORD_WRAP_STORAGE_KEY), 'true');
    assert.equal(readWordWrapPreference(storage), true);

    const options = [];
    assert.equal(applyWordWrap([
        { updateOptions: (value) => options.push(value) },
        null,
        { updateOptions: (value) => options.push(value) }
    ], true), 2);
    assert.deepEqual(options, [{ wordWrap: 'on' }, { wordWrap: 'on' }]);
    assert.equal(applyWordWrap([{ updateOptions: () => { throw new Error('disposed'); } }], false), 0);
    assert.equal(readWordWrapPreference({ getItem: () => { throw new Error('blocked'); } }), false);
}

function testWordWrapUsesSharedRendererAndStandaloneMenu() {
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const standaloneMarkup = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'index.html'), 'utf8');

    assert.match(standaloneSource, /label: 'Wrap Long Lines'[\s\S]{0,120}accelerator: 'Alt\+Z'/);
    assert.match(standaloneSource, /postToRenderer\(\{ type: 'toggleWordWrap' \}\)/);
    assert.match(rendererSource, /wordWrap: wordWrapEnabled \? 'on' : 'off'/);
    assert.match(rendererSource, /KeyMod\.Alt \| monacoInstance\.KeyCode\.KeyZ/);
    assert.match(standaloneMarkup, /id="toggle-word-wrap"[^>]+aria-pressed="false"/);
}

function testSessionSourcesRetainRefreshIntent() {
    const files = createFilesSource(['relative-left.txt', 'relative-right.txt']);
    assert.deepEqual(files.paths, [
        path.resolve('relative-left.txt'),
        path.resolve('relative-right.txt')
    ]);
    assert.equal(isRefreshableSource(files), true);
    assert.equal(isRefreshableSource({ kind: 'blank' }), false);
    assert.equal(sessionSourcesEqual(files, createFilesSource(['relative-left.txt', 'relative-right.txt'])), true);
    assert.equal(sessionSourcesEqual(files, createFilesSource(['relative-right.txt', 'relative-left.txt'])), false);

    assert.deepEqual(createDirectoriesSource(['/tmp/left', '/tmp/right'], ['Old', 'New']).labels, ['Old', 'New']);
    assert.deepEqual(createFileHistorySource('/tmp/file.txt', true, false), {
        kind: 'file-history',
        path: '/tmp/file.txt',
        includeStaged: true,
        skipUnchanged: false
    });
    assert.deepEqual(createDirectoryHistorySource('/tmp/project', false, true), {
        kind: 'directory-history',
        path: '/tmp/project',
        includeStaged: false,
        skipUnchanged: true
    });
    assert.deepEqual(createGitRefsSource('/tmp/repo', ['main', 'INDEX', 'WORKTREE']), {
        kind: 'git-refs',
        repoRoot: '/tmp/repo',
        refs: ['main', 'INDEX', 'WORKTREE']
    });
    assert.deepEqual(createBranchReviewSource('/tmp/repo', 'feature', 'main'), {
        kind: 'branch-review',
        repoRoot: '/tmp/repo',
        headRef: 'feature',
        baseRef: 'main'
    });
}

function testRefreshSessionUsesSemanticRendererAndMenuCommands() {
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const standaloneMarkup = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'index.html'), 'utf8');

    assert.match(standaloneSource, /label: 'Refresh Session'[\s\S]{0,120}accelerator: 'CmdOrCtrl\+R'/);
    assert.match(standaloneSource, /async function refreshSession\(options = \{\}\)/);
    assert.match(standaloneSource, /buildSessionFromSource\(source\)/);
    assert.match(standaloneSource, /computeSourceFingerprint\(session\.source\)/);
    assert.match(standaloneSource, /options\.reason === 'automatic'/);
    assert.doesNotMatch(standaloneSource, /\{ role: 'reload' \}/);
    assert.match(rendererSource, /host\.postMessage\(\{ type: 'refreshSession' \}\)/);
    assert.match(rendererSource, /message\.type === 'refreshState'/);
    assert.match(rendererSource, /message\.type === 'captureNavigationState'/);
    assert.match(rendererSource, /message\.type === 'restoreNavigationState'/);
    assert.match(rendererSource, /Changes available/);
    assert.match(standaloneMarkup, /id="refresh-session"[^>]+title="Refresh Session \(Cmd\/Ctrl\+R\)"/);
}

function testTwoWayDiffAlignsInsertions() {
    const model = buildTwoWayDiffModel('a\nb\nc\n', 'a\nx\nb\nc\n');

    assert.equal(model.hasChanges, true);
    assert.equal(model.rows.length, 4);
    assert.equal(model.rows[1].left.kind, 'placeholder');
    assert.equal(model.rows[1].right.kind, 'added');
    assert.equal(model.rows[1].right.content, 'x');
    assert.equal(model.rightLines[1].segments, undefined);
}

function testReplacementMatchingRejectsLowInformationLines() {
    assert.equal(scoreReplacementLinePair('},', '});').eligible, false);
    assert.equal(scoreReplacementLinePair('   ', '\t').eligible, false);

    const aligned = alignReplacementLines(['},'], ['});']);
    assert.equal(aligned.some((row) => row.left !== undefined && row.right !== undefined), false);
}

function testReplacementMatchingUsesPositionForInformativeSingletonHunks() {
    assert.deepEqual(
        alignReplacementLines(['left a'], ['right a']),
        [{ left: 'left a', right: 'right a' }]
    );
    assert.deepEqual(
        alignReplacementLines(['foo'], ['bar']),
        [{ left: 'foo' }, { right: 'bar' }]
    );
}

function testReplacementMatchingLeavesAmbiguousBoilerplateUnpaired() {
    const aligned = alignReplacementLines(
        ['return first;', 'return second;'],
        ['return other;', 'return final;']
    );
    const repeated = alignReplacementLines(
        ['const item = oldValue;', 'const item = oldValue;'],
        ['const item = newValue;', 'const item = newValue;']
    );

    assert.equal(aligned.some((row) => row.left !== undefined && row.right !== undefined), false);
    assert.equal(repeated.some((row) => row.left !== undefined && row.right !== undefined), false);
}

function testReplacementMatchingPairsDistinctiveLinesAcrossUnevenHunks() {
    const aligned = alignReplacementLines(
        ['const one = 1;', 'const two = 2;', 'const three = 3;'],
        ['const zero = 0;', 'const one = 10;', 'const three = 30;']
    );
    const pairs = aligned
        .filter((row) => row.left !== undefined && row.right !== undefined)
        .map((row) => [row.left, row.right]);

    assert.deepEqual(pairs, [
        ['const one = 1;', 'const one = 10;'],
        ['const three = 3;', 'const three = 30;']
    ]);
}

function testReplacementMatchingUsesUniqueDeclarationAnchors() {
    const aligned = alignReplacementLines(
        [
            'def encode_record(',
            '    value: LegacyRecord,',
            ') -> dict[str, object]:',
            '    return legacy_encoder(value)',
        ],
        [
            'logger.debug("encoding")',
            'def encode_record(record: CurrentRecord) -> EncodedRecord:',
            '    validate_record(record)',
            '    return encoder.encode(record)',
            'metrics.increment("records.encoded")',
        ]
    );

    assert.equal(aligned.some((row) => (
        row.left === 'def encode_record('
        && row.right === 'def encode_record(record: CurrentRecord) -> EncodedRecord:'
    )), true);
}

function testReplacementMatchingDoesNotConfuseDeclarationsWithCalls() {
    assert.deepEqual(
        alignReplacementLines(
            ['encoded = encode_record(legacy_record)'],
            ['def encode_record(record: CurrentRecord) -> EncodedRecord:']
        ),
        [
            { left: 'encoded = encode_record(legacy_record)' },
            { right: 'def encode_record(record: CurrentRecord) -> EncodedRecord:' }
        ]
    );
}

function testReplacementMatchingUsesDeclarationAnchorsInLargeHunks() {
    const left = [
        'def render_report(source: LegacySource) -> str:',
        ...Array.from({ length: 100 }, (_value, index) => `legacy step ${index}`)
    ];
    const right = [
        ...Array.from({ length: 100 }, (_value, index) => `current stage ${index}`),
        'def render_report(source: CurrentSource, format: OutputFormat) -> RenderedReport:'
    ];
    const aligned = alignReplacementLines(left, right);

    assert.equal(left.length * right.length > 10_000, true);
    assert.equal(aligned.some((row) => (
        row.left === 'def render_report(source: LegacySource) -> str:'
        && row.right === 'def render_report(source: CurrentSource, format: OutputFormat) -> RenderedReport:'
    )), true);
}

function testReplacementMatchingUsesStrongNeighborForWeakContext() {
    const aligned = alignReplacementLines(
        [
            'def validate_record(value: LegacyRecord) -> bool:',
            '    Malformed identifiers can corrupt record matching.',
        ],
        [
            'def validate_record(record: CurrentRecord, strict: bool = True) -> ValidationResult:',
            '    Validation prevents malformed values from corrupting matches.',
        ]
    );

    assert.deepEqual(aligned, [
        {
            left: 'def validate_record(value: LegacyRecord) -> bool:',
            right: 'def validate_record(record: CurrentRecord, strict: bool = True) -> ValidationResult:'
        },
        {
            left: '    Malformed identifiers can corrupt record matching.',
            right: '    Validation prevents malformed values from corrupting matches.'
        }
    ]);
}

function testReplacementMatchingUsesConsecutiveWeakContextAfterInsertion() {
    const aligned = alignReplacementLines(
        [
            'Malformed identifiers can corrupt record matching.',
            'The next pass then rebuilds the cached result.',
            'This behavior keeps downstream reads consistent.',
        ],
        [
            'def validate_record(record: CurrentRecord) -> ValidationResult:',
            '    """Create the validator dependency graph.',
            '',
            'Validation prevents malformed values from corrupting matches.',
            'The following pass rebuilds its cached result.',
            'This keeps later reads consistent.',
        ]
    );

    assert.equal(aligned.some((row) => (
        row.left === 'Malformed identifiers can corrupt record matching.'
        && row.right === 'Validation prevents malformed values from corrupting matches.'
    )), true);
    assert.equal(aligned.some((row) => (
        row.left === 'The next pass then rebuilds the cached result.'
        && row.right === 'The following pass rebuilds its cached result.'
    )), true);
}

function testReplacementMatchingKeepsUnsupportedWeakOverlapUnpaired() {
    const aligned = alignReplacementLines(
        [
            'Malformed identifiers can corrupt record matching.',
            'return cached_record;',
        ],
        [
            'initialize the record cache;',
            'Validation prevents malformed values from corrupting matches.',
            'flush pending metrics;',
        ]
    );

    assert.equal(aligned.some((row) => (
        row.left === 'Malformed identifiers can corrupt record matching.'
        && row.right === 'Validation prevents malformed values from corrupting matches.'
    )), false);
}

function testReplacementMatchingUsesBoundedLargeHunkAlignment() {
    const left = Array.from({ length: 101 }, (_value, index) => `const item${index} = oldValue${index};`);
    const right = [
        'unrelated setup line',
        ...Array.from({ length: 101 }, (_value, index) => `const item${index} = newValue${index};`)
    ];
    const aligned = alignReplacementLines(left, right);
    const pairs = aligned.filter((row) => row.left !== undefined && row.right !== undefined);

    assert.equal(left.length * right.length > 10_000, true);
    assert.deepEqual(aligned.find((row) => row.right === 'unrelated setup line'), { right: 'unrelated setup line' });
    assert.equal(pairs.length, 101);
    assert.deepEqual(pairs[0], { left: 'const item0 = oldValue0;', right: 'const item0 = newValue0;' });
    assert.deepEqual(pairs[100], { left: 'const item100 = oldValue100;', right: 'const item100 = newValue100;' });
}

function testReplacementMatchingFallsBackConservativelyWhenAnchorBudgetIsExceeded() {
    const left = Array.from({ length: 2_001 }, (_value, index) => `const item${index} = oldValue${index};`);
    const right = [
        'unrelated setup line',
        ...Array.from({ length: 2_001 }, (_value, index) => `const item${index} = newValue${index};`)
    ];
    const aligned = alignReplacementLines(left, right);

    assert.equal(aligned.some((row) => row.left !== undefined && row.right !== undefined), false);
    assert.equal(aligned.length, left.length + right.length);
}

function testReplacementMatchingStaysConsistentAcrossThreePanels() {
    const first = ['const account = loadLegacyAccount();', 'return account;'];
    const middle = ['const account = loadAccount();', 'validate(account);', 'return account;'];
    const last = ['const account = await loadAccount();', 'validateAccount(account);', 'return account;'];
    const leftPairs = alignReplacementLines(first, middle);
    const rightPairs = alignReplacementLines(middle, last);

    assert.equal(leftPairs.some((row) => row.left === first[0] && row.right === middle[0]), true);
    assert.equal(rightPairs.some((row) => row.left === middle[0] && row.right === last[0]), true);
    assert.equal(rightPairs.some((row) => row.left === middle[1] && row.right === last[1]), true);
}

function testInlineHighlightsSingleWordReplacement() {
    const model = buildTwoWayDiffModel('const value = oldName;\n', 'const value = newName;\n');

    assert.deepEqual(
        model.leftLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'removed', text: 'oldName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'added', text: 'newName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
}

function testInlineHighlightsPunctuationChange() {
    const model = buildTwoWayDiffModel('call(foo)\n', 'call(foo, bar)\n');

    assert.equal(model.leftLines[0].segments?.some((segment) => segment.emphasis), false);
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'call(foo', emphasis: false },
            { kind: 'added', text: ', bar', emphasis: true },
            { kind: 'context', text: ')', emphasis: false }
        ]
    );
}

function testInlineHighlightsWhitespaceSensitiveChange() {
    const model = buildTwoWayDiffModel('return foo + bar;\n', 'return foo+bar;\n');

    assert.equal(model.leftLines[0].segments, undefined);
    assert.equal(model.rightLines[0].segments, undefined);
}

function testInlineHighlightsOnlyPairedReplaceLines() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha changed\nbeta changed\ngamma\n');

    assert.equal(model.blocks[0].kind, 'replace');
    assert.ok(model.leftLines[0].segments);
    assert.ok(model.leftLines[1].segments);
    assert.equal(model.rightLines[2].segments, undefined);
}

function testPureDeleteHasNoInlineSegments() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha\n');

    assert.equal(model.blocks[0].kind, 'delete');
    assert.equal(model.leftLines[1].segments, undefined);
}

function testInlineHighlightsAlignAroundInsertedAndDeletedLines() {
    const model = buildTwoWayDiffModel(
        'const one = 1;\nconst two = 2;\nconst three = 3;\n',
        'const zero = 0;\nconst one = 10;\nconst three = 30;\n'
    );

    assert.equal(model.rows.length, 4);
    assert.equal(model.rows[0].left.kind, 'placeholder');
    assert.equal(model.rows[0].right.content, 'const zero = 0;');
    assert.equal(model.rows[1].left.content, 'const one = 1;');
    assert.equal(model.rows[1].right.content, 'const one = 10;');
    assert.equal(model.rows[2].left.content, 'const two = 2;');
    assert.equal(model.rows[2].right.kind, 'placeholder');
    assert.equal(model.rows[3].left.content, 'const three = 3;');
    assert.equal(model.rows[3].right.content, 'const three = 30;');
    assert.equal(model.rightLines[0].segments, undefined);
    assert.equal(model.leftLines[1].segments, undefined);
    assert.deepEqual(
        model.leftLines[0].segments?.filter((segment) => segment.emphasis).map((segment) => segment.text),
        ['1']
    );
    assert.deepEqual(
        model.rightLines[1].segments?.filter((segment) => segment.emphasis).map((segment) => segment.text),
        ['10']
    );
}

function testRendererDoesNotAddActiveOrAdjacentSemanticOverrides() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const connectorSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'connectors.js'), 'utf8');

    assert.doesNotMatch(rendererSource, /addActiveBlockDecorations|addAdjacentEdgeDecorations/);
    assert.doesNotMatch(connectorSource, /getActiveBlockColor/);
}

function testStaticButtonsHaveTooltips() {
    for (const relativePath of ['standalone/index.html', 'web/index.html', 'src/diffViewProvider.ts']) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        const buttons = source.match(/<button\b[\s\S]*?<\/button>/g) || [];
        assert.ok(buttons.length > 0, `${relativePath} should contain buttons`);
        buttons.forEach((button) => {
            const openingTag = button.match(/<button\b[^>]*>/)?.[0] || '';
            assert.match(openingTag, /\btitle="[^"]+"/, `${relativePath} has a button without a tooltip: ${openingTag}`);
        });
    }
}

function testMacCliRoutesThroughCentralAppInstance() {
    const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'bygone.js'), 'utf8');
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');

    assert.match(cliSource, /path\.join\(installedApp, 'Contents', 'MacOS', executableName\)/);
    assert.doesNotMatch(cliSource, /spawn\('open', \['-W', '-n'/);
    assert.match(standaloneSource, /app\.isPackaged && !smokeTestMode && !captureMode/);
    assert.match(standaloneSource, /requestSingleInstanceLock\(\{ launchArgs: getCliArgs\(\) \}\)/);
    assert.match(standaloneSource, /targetWindow\.show\(\);/);
    assert.match(standaloneSource, /shellQuote\(process\.execPath\)/);
    assert.doesNotMatch(standaloneSource, /open -W -n -a "Bygone" --args/);
}

function testToursRouteThroughAnAppOwnedWindowAndServer() {
    const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'bygone.js'), 'utf8');
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

    assert.match(cliSource, /tokenMatches\('present', args\[0\]\)[\s\S]{0,300}launchDesktopApp\(\{ waitForExit: false \}\)/);
    assert.match(standaloneSource, /kind: 'tour', args: filteredArgs\.slice\(1\), cwd/);
    assert.match(standaloneSource, /startPresentation\(args, cwd, packageRoot, \{[\s\S]{0,100}open: false/);
    assert.match(standaloneSource, /const tourPresentations = new Map\(\)/);
    assert.match(standaloneSource, /async function showTourWindow\(url, server\)[\s\S]{0,500}const tourWindow = new BrowserWindow/);
    assert.match(standaloneSource, /tourPresentations\.set\(tourWindow, \{ server, origin: tourOrigin \}\)/);
    assert.match(standaloneSource, /tourWindow\.on\('closed',[\s\S]{0,180}tourPresentations\.delete\(tourWindow\);[\s\S]{0,80}closeTourServer\(server\)/);
    assert.doesNotMatch(standaloneSource, /previousServer|await tourWindow\.loadURL\(url\)[\s\S]{0,120}closeTourServer\(previousServer\)/);
    assert.ok(packageJson.build.files.includes('web/**'));
}

function testForwardedLaunchArgumentsPreferValidatedAdditionalData() {
    const fallbackArgv = ['/Applications/Bygone.app/Contents/MacOS/Bygone', '--cwd', '/fallback', 'review', 'fallback'];
    const forwardedArgs = ['--cwd', '/repo', 'review', 'feature/tour', '--base', 'main'];

    assert.deepEqual(getForwardedLaunchArgs(fallbackArgv, { launchArgs: forwardedArgs }), forwardedArgs);
    assert.deepEqual(getForwardedLaunchArgs(fallbackArgv, { launchArgs: [42] }), fallbackArgv.slice(1));
    assert.deepEqual(getForwardedLaunchArgs(fallbackArgv, null), fallbackArgv.slice(1));
    assert.deepEqual(getCliArgsFromArgv(['electron', 'out/standalone-main.js', '--test'], { defaultApp: true }), ['--test']);
}

function testDynamicButtonsHaveTooltips() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');
    const directorySource = fs.readFileSync(path.join(__dirname, '..', 'media', 'dom.js'), 'utf8');

    assert.match(rendererSource, /multi-pane-title-wrap[^`]+title=/);
    assert.match(rendererSource, /multi-gutter[^`]+title=/);
    assert.match(rendererSource, /history-rail-tab[^`]+title=/);
    assert.match(rendererSource, /history-rail-item[^`]+title=/);
    assert.match(directorySource, /return `<button class="dir-entry[\s\S]{0,300}title=/);
}

function testMultiDiffShellCreatesHorizontalOverflow() {
    const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');

    assert.match(rendererSource, /const MULTI_PANE_MIN_WIDTH = 360/);
    assert.match(rendererSource, /columns\.push\(`minmax\(\$\{MULTI_PANE_MIN_WIDTH\}px, 1fr\)`\)/);
    assert.match(rendererSource, /min-width:max\(100%, \$\{minimumTrackWidth\}px\)/);
    assert.match(rendererSource, /scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/);
    assert.match(rendererSource, /closest\('\.multi-pane-content'\)[\s\S]{0,100}overEditor && !event\.shiftKey/);
    assert.doesNotMatch(rendererSource, /multi-gutter-title/);
    assert.doesNotMatch(rendererSource, /multi-gutter-header/);
    assert.match(rendererSource, /function revealFirstMultiPanelChanges\(\)/);
    assert.match(rendererSource, /revealFirstChangeInEachPanel[\s\S]{0,200}revealFirstMultiPanelChanges\(\)/);
}

function testDirectoryRowsUseFileKindAffordancesWithoutStatusBadges() {
    const source = fs.readFileSync(path.join(__dirname, '..', 'media', 'dom.js'), 'utf8');
    assert.match(source, /dir-file-kind-icon/);
    assert.match(source, /dir-reviewed/);
    assert.doesNotMatch(source, /dir-review-status/);
}

function testDuplicateMultiPanelDecorationsRenderOnce() {
    const duplicate = {
        range: { startLineNumber: 2, startColumn: 7, endLineNumber: 2, endColumn: 12 },
        options: { inlineClassName: 'bygone-inline-blue' }
    };
    const distinct = {
        range: { startLineNumber: 2, startColumn: 14, endLineNumber: 2, endColumn: 18 },
        options: { inlineClassName: 'bygone-inline-blue' }
    };

    assert.deepEqual(dedupeDecorations([duplicate, duplicate, distinct]), [duplicate, distinct]);
}

function testDirectoryDiffDetectsModifiedFiles() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');

    fs.mkdirSync(path.join(left, 'src'), { recursive: true });
    fs.mkdirSync(path.join(right, 'src'), { recursive: true });
    fs.writeFileSync(path.join(left, 'src', 'app.js'), 'const value = 1;\n', 'utf8');
    fs.writeFileSync(path.join(right, 'src', 'app.js'), 'const value = 2;\n', 'utf8');
    fs.writeFileSync(path.join(left, 'only-left.txt'), 'left\n', 'utf8');

    const entries = buildDirectoryComparison(left, right);
    const appEntry = entries.find((entry) => entry.relativePath === 'src/app.js');
    const srcEntry = entries.find((entry) => entry.relativePath === 'src/');
    const leftOnlyEntry = entries.find((entry) => entry.relativePath === 'only-left.txt');

    assert.equal(appEntry?.status, 'modified');
    assert.deepEqual(appEntry?.sides, [true, true]);
    assert.equal(srcEntry?.status, 'modified');
    assert.equal(leftOnlyEntry?.status, 'left-only');
}

function testMultiDirectoryDiffDetectsPartialAndModifiedFiles() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const dirs = ['left', 'middle', 'right'].map((name) => path.join(root, name));

    for (const dir of dirs) {
        fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    }

    fs.writeFileSync(path.join(dirs[0], 'src', 'app.js'), 'const value = 1;\n', 'utf8');
    fs.writeFileSync(path.join(dirs[1], 'src', 'app.js'), 'const value = 2;\n', 'utf8');
    fs.writeFileSync(path.join(dirs[2], 'src', 'app.js'), 'const value = 3;\n', 'utf8');
    fs.writeFileSync(path.join(dirs[0], 'left-only.txt'), 'left\n', 'utf8');

    const entries = buildMultiDirectoryComparison(dirs);
    const appEntry = entries.find((entry) => entry.relativePath === 'src/app.js');
    const partialEntry = entries.find((entry) => entry.relativePath === 'left-only.txt');

    assert.equal(appEntry?.status, 'modified');
    assert.deepEqual(appEntry?.sides, [true, true, true]);
    assert.equal(partialEntry?.status, 'partial');
    assert.deepEqual(partialEntry?.sides, [true, false, false]);
}

function testDirectoryDiffLeavesIdenticalFilesSame() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');

    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    fs.writeFileSync(path.join(left, 'same.txt'), 'same\n', 'utf8');
    fs.writeFileSync(path.join(right, 'same.txt'), 'same\n', 'utf8');

    const entries = buildDirectoryComparison(left, right);

    assert.equal(entries.find((entry) => entry.relativePath === 'same.txt')?.status, 'same');
}

function testDirectoryDiffHandlesLargeModifiedFiles() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    const largeLeft = 'a'.repeat(300000);
    const largeRight = `${'a'.repeat(299999)}b`;

    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    fs.writeFileSync(path.join(left, 'large.txt'), `${largeLeft}\n`, 'utf8');
    fs.writeFileSync(path.join(right, 'large.txt'), `${largeRight}\n`, 'utf8');

    const entries = buildDirectoryComparison(left, right);

    assert.equal(entries.find((entry) => entry.relativePath === 'large.txt')?.status, 'modified');
}

function testDirectoryDiffKeepsLargeIdenticalFilesSame() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    const largeContent = `${'z'.repeat(420000)}\n`;

    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    fs.writeFileSync(path.join(left, 'large-same.txt'), largeContent, 'utf8');
    fs.writeFileSync(path.join(right, 'large-same.txt'), largeContent, 'utf8');

    const entries = buildDirectoryComparison(left, right);
    assert.equal(entries.find((entry) => entry.relativePath === 'large-same.txt')?.status, 'same');
}

function testDirectoryDiffUsesSameInodeShortcut() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    const shared = path.join(root, 'shared.bin');
    const leftFile = path.join(left, 'hardlink.bin');
    const rightFile = path.join(right, 'hardlink.bin');

    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    fs.writeFileSync(shared, `${'k'.repeat(320000)}\n`, 'utf8');

    try {
        fs.linkSync(shared, leftFile);
        fs.linkSync(shared, rightFile);
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
        if (code === 'EPERM' || code === 'EXDEV' || code === 'EACCES' || code === 'ENOTSUP') {
            return;
        }
        throw error;
    }

    const originalReadFileSync = fs.readFileSync;
    const originalReadSync = fs.readSync;

    fs.readFileSync = () => {
        throw new Error('readFileSync should not run for same-inode comparison');
    };
    fs.readSync = () => {
        throw new Error('readSync should not run for same-inode comparison');
    };

    try {
        const entries = buildDirectoryComparison(left, right);
        assert.equal(entries.find((entry) => entry.relativePath === 'hardlink.bin')?.status, 'same');
    } finally {
        fs.readFileSync = originalReadFileSync;
        fs.readSync = originalReadSync;
    }
}

function testDirectoryDiffHandlesLargeTreeComparisons() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-directory-test-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');

    for (let directoryIndex = 0; directoryIndex < 14; directoryIndex += 1) {
        for (let fileIndex = 0; fileIndex < 12; fileIndex += 1) {
            const relativeDir = path.join(`module-${directoryIndex}`, `segment-${fileIndex % 3}`);
            const fileName = `item-${fileIndex}.txt`;
            const leftPath = path.join(left, relativeDir, fileName);
            const rightPath = path.join(right, relativeDir, fileName);
            fs.mkdirSync(path.dirname(leftPath), { recursive: true });
            fs.mkdirSync(path.dirname(rightPath), { recursive: true });

            const base = `dir=${directoryIndex} file=${fileIndex}\n${'a'.repeat(1024)}\n`;
            fs.writeFileSync(leftPath, base, 'utf8');
            fs.writeFileSync(
                rightPath,
                (directoryIndex + fileIndex) % 11 === 0 ? `${base}delta\n` : base,
                'utf8'
            );
        }
    }

    const entries = buildDirectoryComparison(left, right);
    const modifiedFiles = entries.filter((entry) => !entry.isDirectory && entry.status === 'modified');
    const sameFiles = entries.filter((entry) => !entry.isDirectory && entry.status === 'same');

    assert.ok(modifiedFiles.length > 0);
    assert.ok(sameFiles.length > modifiedFiles.length);
    assert.equal(entries.find((entry) => entry.relativePath === 'module-0/segment-0/item-0.txt')?.status, 'modified');
}

function testInlineHighlightsSkipVeryLongLines() {
    const left = `const value = ${'a'.repeat(520)};\n`;
    const right = `const value = ${'a'.repeat(519)}b;\n`;
    const model = buildTwoWayDiffModel(left, right);

    assert.equal(model.blocks[0]?.kind, 'replace');
    assert.equal(model.leftLines[0]?.segments, undefined);
    assert.equal(model.rightLines[0]?.segments, undefined);
}

function testMergeAcceptsOneSidedChange() {
    const result = mergeText('a\nb\nc\n', 'a\nleft\nc\n', 'a\nb\nc\n');

    assert.equal(result.conflictCount, 0);
    assert.deepEqual(result.resultLines, ['a', 'left', 'c']);
}

function testMergeAcceptsMatchingChanges() {
    const result = mergeText('a\nb\nc\n', 'a\nshared\nc\n', 'a\nshared\nc\n');

    assert.equal(result.conflictCount, 0);
    assert.deepEqual(result.resultLines, ['a', 'shared', 'c']);
}

function testMergeCreatesConflictForDivergentEdits() {
    const result = mergeText('a\nb\nc\n', 'a\nleft\nc\n', 'a\nright\nc\n');

    assert.equal(result.conflictCount, 1);
    assert.deepEqual(result.resultLines, [
        'a',
        '<<<<<<< LEFT',
        'left',
        '=======',
        'right',
        '>>>>>>> RIGHT',
        'c'
    ]);
}

function testHistoryOmitsCleanWorkingTree() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['commit', '-am', 'second']);

    const history = new GitHistoryService().buildFileHistory(filePath);

    assert.equal(history[0].shortCommit, shortCommit(repo, 'HEAD'));
    assert.notEqual(history[0].commit, 'WORKTREE');
}

function testHistoryPrependsDirtyWorkingTree() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['commit', '-am', 'second']);
    fs.writeFileSync(filePath, 'three\n', 'utf8');

    const history = new GitHistoryService().buildFileHistory(filePath);

    assert.equal(history[0].commit, 'WORKTREE');
    assert.equal(history[0].shortCommit, 'Working Tree');
    assert.equal(history[0].leftLabel, 'example.txt @ HEAD');
    assert.equal(history[0].rightLabel, 'example.txt @ Working Tree');
    assert.equal(history[0].leftContent, 'two\n');
    assert.equal(history[0].rightContent, 'three\n');
    assert.equal(history[1].shortCommit, shortCommit(repo, 'HEAD'));
}

function testHistoryIncludeStagedSplitsIndexAndWorkingTree() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    fs.writeFileSync(filePath, 'three\n', 'utf8');

    const history = new GitHistoryService().buildFileHistory(filePath, true);

    assert.equal(history[0].commit, 'WORKTREE');
    assert.equal(history[0].leftLabel, 'example.txt @ Staged');
    assert.equal(history[0].rightLabel, 'example.txt @ Working Tree');
    assert.equal(history[0].leftContent, 'two\n');
    assert.equal(history[0].rightContent, 'three\n');
    assert.equal(history[1].commit, 'INDEX');
    assert.equal(history[1].leftLabel, 'example.txt @ HEAD');
    assert.equal(history[1].rightLabel, 'example.txt @ Staged');
    assert.equal(history[1].leftContent, 'one\n');
    assert.equal(history[1].rightContent, 'two\n');
}

function testHistoryIncludeStagedShowsIndexWhenNoUnstagedChanges() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);

    const history = new GitHistoryService().buildFileHistory(filePath, true);

    assert.equal(history[0].commit, 'INDEX');
    assert.equal(history[0].leftContent, 'one\n');
    assert.equal(history[0].rightContent, 'two\n');
    assert.notEqual(history[0].commit, 'WORKTREE');
}

function testBranchReviewUsesMergeBaseAndDetectsDefaultBase() {
    const repo = createTempGitRepo();
    const firstPath = path.join(repo, 'first.txt');
    const secondPath = path.join(repo, 'second.txt');

    fs.writeFileSync(firstPath, 'base\n', 'utf8');
    runGit(repo, ['add', 'first.txt']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    const baseOid = runGit(repo, ['rev-parse', 'HEAD']);

    runGit(repo, ['checkout', '-b', 'feature/review']);
    fs.writeFileSync(firstPath, 'feature\n', 'utf8');
    runGit(repo, ['commit', '-am', 'change first']);
    fs.writeFileSync(secondPath, 'second\n', 'utf8');
    runGit(repo, ['add', 'second.txt']);
    runGit(repo, ['commit', '-m', 'add second']);

    const range = resolveBranchReviewRange(repo);

    assert.equal(range.baseRef, 'main');
    assert.equal(range.headRef, 'HEAD');
    assert.equal(range.mergeBaseOid, baseOid);
    assert.equal(range.commits.length, 2);
    assert.deepEqual(
        range.changedPaths.map((entry) => [entry.kind, entry.path]),
        [['modified', 'first.txt'], ['added', 'second.txt']]
    );
    assert.equal(range.dirty, false);
}

function testBranchReviewPreservesMergeCommitParents() {
    const repo = createTempGitRepo();
    fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n', 'utf8');
    runGit(repo, ['add', 'base.txt']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);

    runGit(repo, ['checkout', '-b', 'feature/merge']);
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n', 'utf8');
    runGit(repo, ['add', 'feature.txt']);
    runGit(repo, ['commit', '-m', 'feature']);

    runGit(repo, ['checkout', 'main']);
    fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n', 'utf8');
    runGit(repo, ['add', 'main.txt']);
    runGit(repo, ['commit', '-m', 'main change']);

    runGit(repo, ['checkout', 'feature/merge']);
    runGit(repo, ['merge', '--no-ff', 'main', '-m', 'merge main']);

    const range = resolveBranchReviewRange(repo, 'HEAD', 'main');
    const mergeCommit = range.commits.find((commit) => commit.summary === 'merge main');

    assert.equal(mergeCommit?.parentOids.length, 2);
}

function testBranchReviewMaterializesRenameEndpointsAsOneReviewPair() {
    const repo = createTempGitRepo();
    const oldPath = path.join(repo, 'src', 'old-name.txt');
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, 'alpha\nbeta\ngamma\ndelta\n', 'utf8');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/rename']);
    runGit(repo, ['mv', 'src/old-name.txt', 'src/new-name.txt']);
    fs.appendFileSync(path.join(repo, 'src', 'new-name.txt'), 'epsilon\n', 'utf8');
    runGit(repo, ['commit', '-am', 'rename file']);

    const range = resolveBranchReviewRange(repo, 'HEAD', 'main');
    const rename = range.changedPaths.find((entry) => entry.kind === 'renamed');
    assert.equal(rename?.previousPath, 'src/old-name.txt');
    assert.equal(rename?.path, 'src/new-name.txt');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-rename-review-'));
    const left = path.join(root, 'left');
    const right = path.join(root, 'right');
    fs.mkdirSync(left, { recursive: true });
    fs.mkdirSync(right, { recursive: true });
    materializeBranchReviewTrees(range, left, right);

    assert.equal(fs.readFileSync(path.join(left, 'src', 'old-name.txt'), 'utf8'), 'alpha\nbeta\ngamma\ndelta\n');
    assert.equal(fs.readFileSync(path.join(right, 'src', 'new-name.txt'), 'utf8'), 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
    assert.equal(fs.existsSync(path.join(left, 'src', 'new-name.txt')), false);
    assert.equal(fs.existsSync(path.join(right, 'src', 'old-name.txt')), false);
}

function testChangeInventoryBuildsStableTextUnitsAndClassifiesBinaryFiles() {
    const repo = createTempGitRepo();
    fs.writeFileSync(path.join(repo, 'app.txt'), 'alpha\nbeta\ngamma\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 2]));
    fs.writeFileSync(path.join(repo, 'invalid-utf8.txt'), Buffer.from([0xc3, 0x28]));
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/inventory']);
    fs.writeFileSync(path.join(repo, 'app.txt'), 'alpha\nchanged\ngamma\ndelta\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 3]));
    fs.writeFileSync(path.join(repo, 'invalid-utf8.txt'), Buffer.from([0xc3, 0x29]));
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'change files']);

    const first = buildChangeInventory(repo, { headRef: 'HEAD', baseRef: 'main' });
    const second = buildChangeInventory(repo, { headRef: 'HEAD', baseRef: 'main' });
    assert.equal(first.version, 2);
    assert.equal(first.summary.changedFiles, 3);
    assert.equal(first.summary.textualFiles, 1);
    assert.equal(first.summary.binaryFiles, 2);
    assert.equal(first.summary.changeUnits, 2);
    const textFile = first.files.find((file) => file.path === 'app.txt');
    assert.equal(textFile.material, 'text');
    assert.equal(textFile.units[0].additions, 1);
    assert.equal(textFile.units[0].deletions, 1);
    assert.equal(textFile.units[0].oldText, 'beta\n');
    assert.equal(textFile.units[0].newText, 'changed\n');
    assert.match(textFile.units[0].id, /^hunk-[0-9a-f]{12}$/);
    assert.equal(textFile.units[0].id, second.files.find((file) => file.path === 'app.txt').units[0].id);
    assert.equal(
        materializeChangeUnits('alpha\nbeta\ngamma\n', textFile.units, textFile.units.map((unit) => unit.id)),
        'alpha\nchanged\ngamma\ndelta\n'
    );
    assert.equal(first.files.find((file) => file.path === 'asset.bin').material, 'binary');
    assert.equal(first.files.find((file) => file.path === 'invalid-utf8.txt').material, 'binary');
}

function testPatchUnitIdsUseContentAndDisambiguateDuplicates() {
    const patch = [
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '@@ -10 +10 @@',
        '-old',
        '+new'
    ].join('\n');
    const units = parsePatchUnits(patch, { kind: 'modified', path: 'same.txt' });
    assert.equal(units.length, 2);
    assert.match(units[0].id, /^hunk-[0-9a-f]{12}$/);
    assert.equal(units[1].id, `${units[0].id}-2`);
}

function testChangeUnitsMaterializeIndependentCumulativeStates() {
    const base = 'alpha\nbeta\ngamma\ndelta\n';
    const patch = [
        '@@ -2 +2 @@',
        '-beta',
        '+BETA',
        '@@ -4 +4,2 @@',
        '-delta',
        '+DELTA',
        '+omega',
        ''
    ].join('\n');
    const units = parsePatchUnits(patch, { kind: 'modified', path: 'app.txt' });

    assert.equal(units.length, 2);
    assert.equal(
        materializeChangeUnits(base, units, [units[0].id]),
        'alpha\nBETA\ngamma\ndelta\n'
    );
    assert.equal(
        materializeChangeUnits(base, units, [units[1].id]),
        'alpha\nbeta\ngamma\nDELTA\nomega\n'
    );
    assert.equal(
        materializeChangeUnits(base, units, units.map((unit) => unit.id)),
        'alpha\nBETA\ngamma\nDELTA\nomega\n'
    );
    assert.throws(() => materializeChangeUnits(base, units, ['missing']), /Unknown change unit/);
    assert.throws(() => materializeChangeUnits('stale\n', units, [units[0].id]), /invalid base range|no longer matches/);
}

function testChangeUnitsPreserveWhitespaceAndFinalNewlines() {
    const replacement = parsePatchUnits([
        '@@ -1 +1 @@',
        '-old  ',
        '\\ No newline at end of file',
        '+new\t ',
        '\\ No newline at end of file',
        ''
    ].join('\n'), { kind: 'modified', path: 'spacing.txt' });
    assert.equal(replacement[0].oldText, 'old  ');
    assert.equal(replacement[0].newText, 'new\t ');
    assert.equal(materializeChangeUnits('old  ', replacement, [replacement[0].id]), 'new\t ');

    const addition = parsePatchUnits([
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        ''
    ].join('\n'), { kind: 'added', path: 'added.txt' });
    assert.equal(materializeChangeUnits('', addition, [addition[0].id]), 'one\ntwo\n');

    const deletion = parsePatchUnits([
        '@@ -1,2 +0,0 @@',
        '-one',
        '-two',
        '\\ No newline at end of file',
        ''
    ].join('\n'), { kind: 'deleted', path: 'deleted.txt' });
    assert.equal(materializeChangeUnits('one\ntwo', deletion, [deletion[0].id]), '');
}

function testDeconstructedStagesValidateAndMaterializeCumulativeFiles() {
    const repo = createTempGitRepo();
    fs.writeFileSync(path.join(repo, 'app.txt'), 'alpha\nbeta\ngamma\ndelta\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'delete.txt'), 'remove me\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'rename.txt'), 'same content\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 2]));
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/deconstructed']);
    fs.writeFileSync(path.join(repo, 'app.txt'), 'alpha\nBETA\ngamma\nDELTA\n', 'utf8');
    fs.writeFileSync(path.join(repo, 'added.txt'), 'introduced\n', 'utf8');
    fs.rmSync(path.join(repo, 'delete.txt'));
    fs.renameSync(path.join(repo, 'rename.txt'), path.join(repo, 'renamed.txt'));
    fs.writeFileSync(path.join(repo, 'asset.bin'), Buffer.from([1, 0, 3]));
    runGit(repo, ['add', '-A']);
    runGit(repo, ['commit', '-m', 'deconstruct this change']);

    const inventory = buildChangeInventory(repo, { headRef: 'HEAD', baseRef: 'main' });
    const app = inventory.files.find((file) => file.path === 'app.txt');
    const added = inventory.files.find((file) => file.path === 'added.txt');
    const deleted = inventory.files.find((file) => file.path === 'delete.txt');
    assert.equal(app.units.length, 2);
    assert.equal(added.units.length, 1);
    assert.equal(deleted.units.length, 1);

    const source = parseChangeTourSource({
        version: 1,
        title: 'Deconstructed example',
        range: { base: 'main', head: 'HEAD' },
        anchors: {},
        connections: [],
        chapters: [{
            id: 'explanation',
            title: 'Explanation',
            scenes: [{
                id: 'build-feature',
                kind: 'deconstructed-diff',
                title: 'Build the feature',
                summary: 'Explain the change in conceptual order.',
                bullets: [],
                tags: ['deconstructed'],
                takeaway: 'The real target is reconstructed exactly.',
                base: 'main',
                target: 'HEAD',
                stages: [{
                    id: 'model',
                    title: 'Introduce the model',
                    narration: 'Start with the first behavior and the new file.',
                    changes: [
                        { file: 'app.txt', hunks: [app.units[0].id] },
                        { file: 'added.txt', hunks: [added.units[0].id] }
                    ]
                }, {
                    id: 'behavior',
                    title: 'Finish the behavior',
                    narration: 'Apply the remaining text changes.',
                    changes: [
                        { file: 'app.txt', hunks: [app.units[1].id] },
                        { file: 'delete.txt', hunks: [deleted.units[0].id] }
                    ]
                }],
                exclusions: [
                    { file: 'asset.bin', reason: 'Binary material is explained separately.' },
                    { file: 'renamed.txt', reason: 'Path transitions are not supported yet.' }
                ]
            }]
        }]
    });
    const scene = source.chapters[0].scenes[0];
    assert.equal(scene.kind, 'deconstructed-diff');
    const compiled = compileDeconstructedScene(inventory, scene);
    const built = buildDeconstructedScene(repo, scene);
    const manifest = buildChangeTourManifest(repo, {
        source,
        generatedAt: '2026-08-08T00:00:00.000Z'
    });
    const manifestScene = manifest.scenes.find((candidate) => candidate.id === 'build-feature');

    assert.equal(compiled.stages.length, 2);
    assert.equal(built.targetOid, inventory.range.headOid);
    assert.equal(manifestScene.kind, 'deconstructed-diff');
    assert.equal(manifestScene.stageLabel, 'Explanation stages');
    assert.equal(manifestScene.panels.length, 3);
    assert.deepEqual(manifestScene.panels.map((panel) => panel.role), ['baseline', 'stage', 'stage']);
    assert.equal('oid' in manifestScene.panels[1], false);
    assert.equal('ref' in manifestScene.panels[1], false);
    assert.equal(manifestScene.realRange.baseOid, inventory.range.baseOid);
    assert.equal(manifestScene.steps[1].pairIndex, 1);
    assert.equal(manifestScene.files.find((file) => file.path === 'delete.txt').panels[2].exists, false);
    assert.equal(compiled.excludedFiles.length, 2);
    assert.equal(compiled.baselineFiles.find((file) => file.path === 'added.txt').exists, false);
    assert.equal(compiled.baselineFiles.find((file) => file.path === 'delete.txt').exists, true);
    assert.equal(compiled.stages[0].files.find((file) => file.path === 'app.txt').content, 'alpha\nBETA\ngamma\ndelta\n');
    assert.equal(compiled.stages[0].files.find((file) => file.path === 'added.txt').exists, true);
    assert.equal(compiled.stages[1].files.find((file) => file.path === 'app.txt').content, 'alpha\nBETA\ngamma\nDELTA\n');
    assert.equal(compiled.stages[1].files.find((file) => file.path === 'delete.txt').exists, false);

    const excludedCompiled = compileDeconstructedScene(inventory, {
        ...scene,
        stages: [{
            ...scene.stages[0],
            changes: scene.stages[0].changes.filter((change) => change.file !== 'app.txt')
        }, scene.stages[1]],
        exclusions: [
            ...(scene.exclusions || []),
            { file: 'app.txt', hunks: [app.units[0].id], reason: 'Established setup shown without a dedicated stage.' }
        ]
    });
    assert.equal(excludedCompiled.baselineFiles.find((file) => file.path === 'app.txt').content, 'alpha\nBETA\ngamma\ndelta\n');
    assert.equal(excludedCompiled.stages[1].files.find((file) => file.path === 'app.txt').content, 'alpha\nBETA\ngamma\nDELTA\n');
}

function testDeconstructedStagesRejectInvalidAssignments() {
    const repo = createTempGitRepo();
    fs.writeFileSync(path.join(repo, 'app.txt'), 'one\ntwo\nthree\nfour\n', 'utf8');
    runGit(repo, ['add', '.']);
    runGit(repo, ['commit', '-m', 'base']);
    runGit(repo, ['branch', '-M', 'main']);
    runGit(repo, ['checkout', '-b', 'feature/invalid-deconstruction']);
    fs.writeFileSync(path.join(repo, 'app.txt'), 'ONE\ntwo\nthree\nFOUR\n', 'utf8');
    runGit(repo, ['commit', '-am', 'two units']);
    const inventory = buildChangeInventory(repo, { headRef: 'HEAD', baseRef: 'main' });
    const units = inventory.files[0].units;
    const baseScene = {
        id: 'invalid',
        kind: 'deconstructed-diff',
        title: 'Invalid assignments',
        summary: 'Exercise validation.',
        bullets: [],
        tags: [],
        takeaway: 'Invalid ownership fails.',
        stages: [{
            id: 'one',
            title: 'One',
            narration: 'Only one unit.',
            changes: [{ file: 'app.txt', hunks: [units[0].id] }]
        }]
    };

    assert.throws(() => compileDeconstructedScene(inventory, baseScene), /Unassigned change unit/);
    assert.throws(() => compileDeconstructedScene(inventory, {
        ...baseScene,
        stages: [{ ...baseScene.stages[0], changes: [{ file: 'app.txt', hunks: [units[0].id, units[0].id] }] }]
    }), /assigned to both/);
    assert.throws(() => compileDeconstructedScene(inventory, {
        ...baseScene,
        stages: [{ ...baseScene.stages[0], changes: [{ file: 'app.txt', hunks: ['hunk-missing'] }] }]
    }), /unknown hunk/);
    assert.throws(() => parseChangeTourSource({
        version: 1,
        anchors: {},
        connections: [],
        chapters: [{ id: 'chapter', title: 'Chapter', scenes: [{ ...baseScene, stages: [
            baseScene.stages[0],
            { ...baseScene.stages[0] }
        ] }] }]
    }), /Duplicate deconstructed stage id/);
}

function createTempGitRepo() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-history-test-'));

    runGit(repo, ['init']);
    runGit(repo, ['config', 'user.name', 'Bygone Test']);
    runGit(repo, ['config', 'user.email', 'bygone-test@example.com']);

    return repo;
}

function runGit(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd();
}

function shortCommit(repo, rev) {
    return runGit(repo, ['rev-parse', '--short', rev]);
}

function run() {
    testTourLinearNavigationTraversesStepsAndScenes();
    testDeconstructedTourNavigationTraversesExplanationStages();
    testTourPositionRestoresStableSceneAndStepIds();
    testTourFileNavigationUsesCompleteRenderableFileIndex();
    testWebTourHostSeparatesFileAndNarrativeNavigation();
    testTourAnnotationPersistsAcrossChangeNavigation();
    testStandaloneMenusExposeProductAreasAndReplace();
    testTextPanelsExposeMutabilityProvenance();
    testVsCodeSurfaceHandsLargeWorkToDesktopAndPackagesOnlyRuntime();
    testLineClickSelectsContainingTwoWayChange();
    testLineClickIgnoresCollapsedSideOfOneSidedChange();
    testLineClickPrefersCurrentAdjacentPair();
    testDirectoryDrilldownNavigationTracksActiveFile();
    testDirectoryHistoryFileNavigationTakesPriorityOverPanelNavigation();
    testGitNameStatusParserPreservesRenameMetadata();
    testCliSpecificationDrivesHelpAndEveryCompletionFormat();
    testCliPrintsGeneratedCompletionsWithoutStartingElectron();
    testChangeTourBuildsPortableNarrativeChapters();
    testStackedTourBuildsOrderedRevisionPanelsAndRenameAliases();
    testPresentArgumentsUseSharedBaseAliases();
    testCheckedInBygoneHistoryTourRemainsReproducible();
    testAdvancedTourExamplesRemainReproducible();
    testVersionTourChangelogRemainsReproducible();
    testAgentTourCommandsValidateCompileAndExposeSchema();
    testChangeTourContextPackagesBoundedGitEvidence();
    testGeneratedCompletionScriptsPassAvailableShellSyntaxChecks();
    testReviewPathPairUsesDistinctRenameEndpoints();
    testBinaryComparisonBuildsImagePreviewsAndEquality();
    testBinaryComparisonDetectsGenericBinaryWithoutPreview();
    testMenuCapabilitiesFollowSessionMode();
    testFindControllerTargetsOneActiveEditor();
    testFindCommandsUseRendererRatherThanPageSearch();
    testFindShortcutCapturesControlAndCommandBeforeEditors();
    testSidebarsExposeResizeCollapseAndRestoreControls();
    testWordWrapControllerPersistsAndAppliesPreference();
    testWordWrapUsesSharedRendererAndStandaloneMenu();
    testSessionSourcesRetainRefreshIntent();
    testRefreshSessionUsesSemanticRendererAndMenuCommands();
    testTwoWayDiffAlignsInsertions();
    testReplacementMatchingRejectsLowInformationLines();
    testReplacementMatchingUsesPositionForInformativeSingletonHunks();
    testReplacementMatchingLeavesAmbiguousBoilerplateUnpaired();
    testReplacementMatchingPairsDistinctiveLinesAcrossUnevenHunks();
    testReplacementMatchingUsesUniqueDeclarationAnchors();
    testReplacementMatchingDoesNotConfuseDeclarationsWithCalls();
    testReplacementMatchingUsesDeclarationAnchorsInLargeHunks();
    testReplacementMatchingUsesStrongNeighborForWeakContext();
    testReplacementMatchingUsesConsecutiveWeakContextAfterInsertion();
    testReplacementMatchingKeepsUnsupportedWeakOverlapUnpaired();
    testReplacementMatchingUsesBoundedLargeHunkAlignment();
    testReplacementMatchingFallsBackConservativelyWhenAnchorBudgetIsExceeded();
    testReplacementMatchingStaysConsistentAcrossThreePanels();
    testInlineHighlightsSingleWordReplacement();
    testInlineHighlightsPunctuationChange();
    testInlineHighlightsWhitespaceSensitiveChange();
    testInlineHighlightsOnlyPairedReplaceLines();
    testPureDeleteHasNoInlineSegments();
    testInlineHighlightsAlignAroundInsertedAndDeletedLines();
    testRendererDoesNotAddActiveOrAdjacentSemanticOverrides();
    testStaticButtonsHaveTooltips();
    testMacCliRoutesThroughCentralAppInstance();
    testToursRouteThroughAnAppOwnedWindowAndServer();
    testForwardedLaunchArgumentsPreferValidatedAdditionalData();
    testDynamicButtonsHaveTooltips();
    testMultiDiffShellCreatesHorizontalOverflow();
    testDirectoryRowsUseFileKindAffordancesWithoutStatusBadges();
    testDuplicateMultiPanelDecorationsRenderOnce();
    testDirectoryDiffDetectsModifiedFiles();
    testMultiDirectoryDiffDetectsPartialAndModifiedFiles();
    testDirectoryDiffLeavesIdenticalFilesSame();
    testDirectoryDiffHandlesLargeModifiedFiles();
    testDirectoryDiffKeepsLargeIdenticalFilesSame();
    testDirectoryDiffUsesSameInodeShortcut();
    testDirectoryDiffHandlesLargeTreeComparisons();
    testInlineHighlightsSkipVeryLongLines();
    testMergeAcceptsOneSidedChange();
    testMergeAcceptsMatchingChanges();
    testMergeCreatesConflictForDivergentEdits();
    testHistoryOmitsCleanWorkingTree();
    testHistoryPrependsDirtyWorkingTree();
    testHistoryIncludeStagedSplitsIndexAndWorkingTree();
    testHistoryIncludeStagedShowsIndexWhenNoUnstagedChanges();
    testBranchReviewUsesMergeBaseAndDetectsDefaultBase();
    testBranchReviewPreservesMergeCommitParents();
    testBranchReviewMaterializesRenameEndpointsAsOneReviewPair();
    testChangeInventoryBuildsStableTextUnitsAndClassifiesBinaryFiles();
    testPatchUnitIdsUseContentAndDisambiguateDuplicates();
    testChangeUnitsMaterializeIndependentCumulativeStates();
    testChangeUnitsPreserveWhitespaceAndFinalNewlines();
    testDeconstructedStagesValidateAndMaterializeCumulativeFiles();
    testDeconstructedStagesRejectInvalidAssignments();
    console.log('All tests passed.');
}

run();
