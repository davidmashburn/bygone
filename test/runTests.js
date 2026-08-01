const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { load: loadYaml } = require('js-yaml');
const { buildTwoWayDiffModel, mergeText } = require('../out/diffEngine.js');
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
const { CLI_SPEC, renderCliHelp } = require('../cli/commandSpec.js');
const { completionFileName, generateCompletion, SUPPORTED_SHELLS } = require('../cli/completions.js');
const { buildChangeTourContext, buildChangeTourManifest, parseChangeTourManifest, parseChangeTourSource, parseChangeTourStory } = require('../out/changeTour.js');
const { parsePresentArgs } = require('../cli/present.js');
const { parseTourArgs, runTourCommand } = require('../cli/tour.js');

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
    assert.deepEqual(authored.chapters.map((chapter) => chapter.id), ['why', 'model', 'appendix']);
    assert.deepEqual(authored.scenes.map((scene) => scene.kind), ['discussion', 'text-diff', 'text-diff', 'text-diff']);
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
                    connection: 'contractToVersion'
                }]
            }]
        }]
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
    assert.deepEqual(anchored.chapters.map((chapter) => chapter.id), ['flow', 'appendix']);
    assert.throws(() => buildChangeTourManifest(repo, {
        headRef: 'feature/tour', baseRef: 'main', source: {
            ...source,
            anchors: { ...source.anchors, contract: { ...source.anchors.contract, contains: 'missing code' } }
        }
    }), /did not match/);
    assert.throws(() => parseChangeTourSource({ ...source, inventedField: true }), /unknown field: inventedField/);
    assert.throws(() => parseChangeTourSource({ ...source, chapters: [] }), /non-empty array/);
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
    execFileSync('zsh', ['-n', path.join(__dirname, '..', 'completions', '_bygone')]);
    execFileSync('bash', ['-n', path.join(__dirname, '..', 'completions', 'bygone')]);

    const fish = spawnSync('fish', ['-n', path.join(__dirname, '..', 'completions', 'bygone.fish')]);
    if (!fish.error || fish.error.code !== 'ENOENT') {
        assert.equal(fish.status, 0, fish.stderr?.toString() || 'Fish completion syntax failed');
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
        canReturnToDirectory: false,
        canAddPanel: false,
        canRemovePanel: false
    });
    const multi = getMenuCapabilities({
        mode: 'multi-diff',
        multi: { activePanelId: 'middle', files: [{}, {}, {}] },
        returnDirectory: { relativePath: 'a.txt' }
    });
    assert.equal(multi.canAddPanel, true);
    assert.equal(multi.canRemovePanel, true);
    assert.equal(multi.canReturnToDirectory, true);
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

function testMacCliLaunchesASeparateArgumentAwareAppInstance() {
    const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'bygone.js'), 'utf8');
    const standaloneSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');

    assert.match(cliSource, /spawn\('open', \['-W', '-n', installedApp, '--args'/);
    assert.match(standaloneSource, /open -W -n -a "Bygone" --args/);
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
    testLineClickSelectsContainingTwoWayChange();
    testLineClickIgnoresCollapsedSideOfOneSidedChange();
    testLineClickPrefersCurrentAdjacentPair();
    testDirectoryDrilldownNavigationTracksActiveFile();
    testDirectoryHistoryFileNavigationTakesPriorityOverPanelNavigation();
    testGitNameStatusParserPreservesRenameMetadata();
    testCliSpecificationDrivesHelpAndEveryCompletionFormat();
    testCliPrintsGeneratedCompletionsWithoutStartingElectron();
    testChangeTourBuildsPortableNarrativeChapters();
    testPresentArgumentsUseSharedBaseAliases();
    testCheckedInBygoneHistoryTourRemainsReproducible();
    testAgentTourCommandsValidateCompileAndExposeSchema();
    testChangeTourContextPackagesBoundedGitEvidence();
    testGeneratedCompletionScriptsPassAvailableShellSyntaxChecks();
    testReviewPathPairUsesDistinctRenameEndpoints();
    testBinaryComparisonBuildsImagePreviewsAndEquality();
    testBinaryComparisonDetectsGenericBinaryWithoutPreview();
    testMenuCapabilitiesFollowSessionMode();
    testTwoWayDiffAlignsInsertions();
    testInlineHighlightsSingleWordReplacement();
    testInlineHighlightsPunctuationChange();
    testInlineHighlightsWhitespaceSensitiveChange();
    testInlineHighlightsOnlyPairedReplaceLines();
    testPureDeleteHasNoInlineSegments();
    testInlineHighlightsAlignAroundInsertedAndDeletedLines();
    testRendererDoesNotAddActiveOrAdjacentSemanticOverrides();
    testStaticButtonsHaveTooltips();
    testMacCliLaunchesASeparateArgumentAwareAppInstance();
    testDynamicButtonsHaveTooltips();
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
    console.log('All tests passed.');
}

run();
