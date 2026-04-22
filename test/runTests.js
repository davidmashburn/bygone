const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildTwoWayDiffModel, mergeText } = require('../out/diffEngine.js');
const { buildDirectoryComparison, buildMultiDirectoryComparison } = require('../out/directoryDiff.js');
const { GitHistoryService } = require('../out/gitHistory.js');

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

function testHistoryIncludesStagedEntryWhenRequested() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);

    const history = new GitHistoryService().buildFileHistory(filePath, true);

    assert.equal(history[0].commit, 'INDEX');
    assert.equal(history[0].parentCommit, runGit(repo, ['rev-parse', 'HEAD']));
    assert.equal(history[0].shortCommit, 'Staged Area');
    assert.equal(history[0].leftLabel, 'example.txt @ HEAD');
    assert.equal(history[0].rightLabel, 'example.txt @ Staged');
    assert.equal(history[0].leftContent, 'one\n');
    assert.equal(history[0].rightContent, 'two\n');
}

function testHistorySplitsStagedAndUnstagedChangesWhenRequested() {
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
    assert.equal(history[0].parentCommit, 'INDEX');
    assert.equal(history[0].leftLabel, 'example.txt @ Staged');
    assert.equal(history[0].rightLabel, 'example.txt @ Working Tree');
    assert.equal(history[0].leftContent, 'two\n');
    assert.equal(history[0].rightContent, 'three\n');

    assert.equal(history[1].commit, 'INDEX');
    assert.equal(history[1].leftContent, 'one\n');
    assert.equal(history[1].rightContent, 'two\n');
}

function testHistorySupportsStagedEntryWithoutHeadCommit() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);

    const history = new GitHistoryService().buildFileHistory(filePath, true);

    assert.equal(history.length, 1);
    assert.equal(history[0].commit, 'INDEX');
    assert.equal(history[0].parentCommit, undefined);
    assert.equal(history[0].leftContent, '');
    assert.equal(history[0].rightContent, 'one\n');
}

function testHistoryDescriptorsMaterializeOnDemand() {
    const repo = createTempGitRepo();
    const filePath = path.join(repo, 'example.txt');

    fs.writeFileSync(filePath, 'one\n', 'utf8');
    runGit(repo, ['add', 'example.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    fs.writeFileSync(filePath, 'two\n', 'utf8');
    runGit(repo, ['commit', '-am', 'second']);

    const historyService = new GitHistoryService();
    const descriptors = historyService.buildFileHistoryDescriptors(filePath);

    assert.ok(descriptors.length > 0);
    assert.notEqual(descriptors[0].commit, 'WORKTREE');
    assert.equal(descriptors[0].leftContent, undefined);
    assert.equal(descriptors[0].rightContent, undefined);

    const entry = historyService.materializeFileHistoryEntry(descriptors[0]);
    assert.equal(entry.leftContent, 'one\n');
    assert.equal(entry.rightContent, 'two\n');
}

function testHistoryHonorsMaxCommitLimit() {
    const originalHistoryLimit = process.env.BYGONE_HISTORY_MAX_COMMITS;
    process.env.BYGONE_HISTORY_MAX_COMMITS = '3';

    try {
        const repo = createTempGitRepo();
        const filePath = path.join(repo, 'example.txt');

        fs.writeFileSync(filePath, 'line 0\n', 'utf8');
        runGit(repo, ['add', 'example.txt']);
        runGit(repo, ['commit', '-m', 'commit 0']);

        for (let index = 1; index <= 8; index += 1) {
            fs.writeFileSync(filePath, `line ${index}\n`, 'utf8');
            runGit(repo, ['add', 'example.txt']);
            runGit(repo, ['commit', '-m', `commit ${index}`]);
        }

        const descriptors = new GitHistoryService().buildFileHistoryDescriptors(filePath);

        assert.equal(descriptors.length, 3);
    } finally {
        if (originalHistoryLimit === undefined) {
            delete process.env.BYGONE_HISTORY_MAX_COMMITS;
        } else {
            process.env.BYGONE_HISTORY_MAX_COMMITS = originalHistoryLimit;
        }
    }
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
    testTwoWayDiffAlignsInsertions();
    testInlineHighlightsSingleWordReplacement();
    testInlineHighlightsPunctuationChange();
    testInlineHighlightsWhitespaceSensitiveChange();
    testInlineHighlightsOnlyPairedReplaceLines();
    testPureDeleteHasNoInlineSegments();
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
    testHistoryIncludesStagedEntryWhenRequested();
    testHistorySplitsStagedAndUnstagedChangesWhenRequested();
    testHistorySupportsStagedEntryWithoutHeadCommit();
    testHistoryDescriptorsMaterializeOnDemand();
    testHistoryHonorsMaxCommitLimit();
    console.log('All tests passed.');
}

run();
