const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTourHistory, validatePath } = require('../cli/tourHistory.js');

test('v2 history follows renames, renders creation/deletion, and lands before an unrelated commit', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-tour-history-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    try {
        git('init');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        fs.writeFileSync(path.join(root, 'before.txt'), 'original\n');
        git('add', '.');
        git('commit', '-m', 'Create file', '-m', 'Full message body\nwith a second line\tand a tab.');
        const first = git('rev-parse', 'HEAD');
        git('mv', 'before.txt', 'after.txt');
        git('commit', '-m', 'Rename file');
        const rename = git('rev-parse', 'HEAD');
        fs.writeFileSync(path.join(root, 'unrelated.txt'), 'other\n');
        git('add', '.');
        git('commit', '-m', 'Unrelated change');
        const unrelated = git('rev-parse', 'HEAD');
        git('rm', 'after.txt');
        git('commit', '-m', 'Delete file');
        const deletion = git('rev-parse', 'HEAD');
        const history = createTourHistory({ version: 2, repository: { root }, range: { headOid: deletion, mergeBaseOid: first } });
        assert.deepEqual(history.changedFiles({ commits: [rename, unrelated] }).paths, ['unrelated.txt']);
        assert.deepEqual(history.changedFiles({ commits: [unrelated, deletion] }).paths, ['after.txt']);
        assert.deepEqual(history.changedFiles({ commits: [null, first] }).paths, ['before.txt']);
        assert.deepEqual(history.changedFiles({ commits: [first, rename] }).paths, ['after.txt', 'before.txt']);
        assert.deepEqual(history.changedFiles({ commits: [first, first] }).paths, []);
        const list = history.list({ path: 'after.txt', commit: unrelated });
        assert.equal(list.selectedCommit, rename);
        assert.match(list.fallback, /preceding/);
        assert.deepEqual(list.entries.map(entry => entry.commit), [rename, first]);
        assert.equal(list.entries[0].previousPath, 'before.txt');
        assert.equal(list.entries[1].path, 'before.txt');
        const all = history.list({ commit: deletion });
        assert.deepEqual(all.entries.map(entry => entry.commit), [deletion, unrelated, rename, first]);
        assert.deepEqual(all.entries[0].parents, [unrelated]);
        assert.deepEqual(all.entries.at(-1).parents, []);
        assert.equal(all.entries.at(-1).author, 'Test');
        assert.equal(all.entries.at(-1).authorEmail, 'test@example.com');
        assert.equal(all.entries.at(-1).message, 'Create file\n\nFull message body\nwith a second line\tand a tab.');
        assert.equal(list.entries.at(-1).message, all.entries.at(-1).message);
        const unchanged = history.diff({ path: 'after.txt', commit: unrelated, head: deletion });
        assert.equal(unchanged.rightContent, 'original\n');
        assert.equal(unchanged.leftContent, unchanged.rightContent);
        const beforeRename = history.diff({ path: 'after.txt', commit: first, head: deletion });
        assert.equal(beforeRename.path, 'before.txt');
        assert.equal(beforeRename.rightContent, 'original\n');
        const beforeCreation = history.diff({ path: 'unrelated.txt', commit: first, head: deletion });
        assert.equal(beforeCreation.rightContent, '');
        assert.equal(beforeCreation.leftContent, '');
        const renamed = history.diff({ path: 'after.txt', commit: rename });
        assert.equal(renamed.leftContent, 'original\n');
        assert.equal(renamed.rightContent, 'original\n');
        const created = history.diff({ path: 'before.txt', commit: first });
        assert.equal(created.leftContent, '');
        assert.equal(created.rightContent, 'original\n');
        const deleted = history.diff({ path: 'after.txt', commit: deletion });
        assert.equal(deleted.leftContent, 'original\n');
        assert.equal(deleted.rightContent, '');
        assert.equal(history.list({ path: 'after.txt', commit: deletion }).entries[0].commit, deletion);
        assert.throws(() => history.diff({ path: '../secrets', commit: first }), /relative/);
        assert.throws(() => history.list({ path: 'before.txt', commit: '--all' }), /commit ID/);
        assert.throws(() => createTourHistory({ version: 2, repository: { root: `${root}/missing` }, range: {} }), /originating/);
        assert.equal(createTourHistory({ version: 1 }), null);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('history paths reject traversal and accept literal pathspec characters', () => {
    for (const value of ['/etc/passwd', '../secret', 'a/../b', 'a\\b', 'a\0b', '', 'a//b']) {
        assert.throws(() => validatePath(value), /relative/);
    }
    assert.equal(validatePath(':(glob)*.txt'), ':(glob)*.txt');
});

test('commit comparisons cover whole trees, scoped unchanged files, reverse endpoints, and bounded content', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-tour-compare-')));
    const git = (...args) => execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    const literalPath = ':(glob)*.txt';
    try {
        git('init');
        git('config', 'user.email', 'test@example.com');
        git('config', 'user.name', 'Test');
        fs.writeFileSync(path.join(root, 'old.txt'), 'first line\nsecond line\n');
        fs.writeFileSync(path.join(root, 'delete-me.txt'), 'remove this\n');
        fs.writeFileSync(path.join(root, 'same.txt'), 'unchanged\n');
        fs.writeFileSync(path.join(root, literalPath), 'literal before\n');
        fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
        fs.writeFileSync(path.join(root, 'large.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 97));
        git('add', '.');
        git('commit', '-m', 'Root snapshot');
        const rootCommit = git('rev-parse', 'HEAD');

        git('mv', 'old.txt', 'renamed.txt');
        fs.writeFileSync(path.join(root, 'renamed.txt'), 'first line\nsecond line\nrenamed\n');
        fs.writeFileSync(path.join(root, 'created.txt'), 'new file\n');
        fs.writeFileSync(path.join(root, literalPath), 'literal after\n');
        fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 3]));
        git('rm', 'delete-me.txt');
        git('add', '--all');
        git('commit', '-m', 'Change snapshot');
        const changedCommit = git('rev-parse', 'HEAD');

        const history = createTourHistory({
            version: 2,
            repository: { root },
            range: { headOid: changedCommit, mergeBaseOid: rootCommit }
        });

        const wholeTree = history.compare({ from: rootCommit, to: changedCommit });
        assert.deepEqual(wholeTree.from, rootCommit);
        assert.deepEqual(wholeTree.to, changedCommit);
        const filesByPath = new Map(wholeTree.files.map(file => [file.path, file]));
        assert.deepEqual([...filesByPath.keys()].sort(), [
            literalPath,
            'binary.bin',
            'created.txt',
            'delete-me.txt',
            'renamed.txt'
        ].sort());
        assert.equal(filesByPath.get('renamed.txt').kind, 'text-diff');
        assert.equal(filesByPath.get('renamed.txt').changeKind, 'renamed');
        assert.equal(filesByPath.get('renamed.txt').previousPath, 'old.txt');
        assert.equal(filesByPath.get('renamed.txt').leftPath, 'old.txt');
        assert.equal(filesByPath.get('renamed.txt').rightPath, 'renamed.txt');
        assert.equal(filesByPath.get('renamed.txt').leftContent, 'first line\nsecond line\n');
        assert.equal(filesByPath.get('renamed.txt').rightContent, 'first line\nsecond line\nrenamed\n');
        assert.equal(filesByPath.get('renamed.txt').additions, 1);
        assert.equal(filesByPath.get('renamed.txt').deletions, 0);
        assert.equal(filesByPath.get('created.txt').changeKind, 'added');
        assert.equal(filesByPath.get('created.txt').leftContent, '');
        assert.equal(filesByPath.get('created.txt').rightContent, 'new file\n');
        assert.equal(filesByPath.get('created.txt').additions, 1);
        assert.equal(filesByPath.get('created.txt').deletions, 0);
        assert.equal(filesByPath.get('delete-me.txt').changeKind, 'deleted');
        assert.equal(filesByPath.get('delete-me.txt').leftContent, 'remove this\n');
        assert.equal(filesByPath.get('delete-me.txt').rightContent, '');
        assert.equal(filesByPath.get('delete-me.txt').additions, 0);
        assert.equal(filesByPath.get('delete-me.txt').deletions, 1);
        assert.equal(filesByPath.get(literalPath).rightContent, 'literal after\n');
        assert.equal(filesByPath.get('binary.bin').kind, 'omitted');
        assert.match(filesByPath.get('binary.bin').reason, /Binary/);

        const unchanged = history.compare({ from: rootCommit, to: changedCommit, path: 'same.txt' });
        assert.equal(unchanged.files.length, 1);
        assert.equal(unchanged.files[0].changeKind, 'unchanged');
        assert.equal(unchanged.files[0].leftPath, 'same.txt');
        assert.equal(unchanged.files[0].rightPath, 'same.txt');
        assert.equal(unchanged.files[0].leftContent, 'unchanged\n');
        assert.equal(unchanged.files[0].rightContent, 'unchanged\n');

        const literal = history.compare({ from: rootCommit, to: changedCommit, path: literalPath });
        assert.equal(literal.files.length, 1);
        assert.equal(literal.files[0].path, literalPath);
        assert.equal(literal.files[0].rightContent, 'literal after\n');

        const oversized = history.compare({ from: rootCommit, to: changedCommit, path: 'large.txt' });
        assert.equal(oversized.files.length, 1);
        assert.equal(oversized.files[0].kind, 'omitted');
        assert.match(oversized.files[0].reason, /too large/);

        fs.writeFileSync(path.join(root, 'renamed.txt'), 'first line\nsecond line\nrenamed again\n');
        git('add', 'renamed.txt');
        git('commit', '-m', 'Change renamed file again');
        const thirdCommit = git('rev-parse', 'HEAD');
        const many = history.compareMany({ commits: [rootCommit, changedCommit, thirdCommit], path: 'renamed.txt' });
        assert.deepEqual(many.commits, [rootCommit, changedCommit, thirdCommit]);
        assert.equal(many.files.length, 1);
        assert.deepEqual(many.files[0].comparisonPanels.map(panel => panel.path), ['old.txt', 'renamed.txt', 'renamed.txt']);
        assert.deepEqual(many.files[0].comparisonPanels.map(panel => panel.content), [
            'first line\nsecond line\n',
            'first line\nsecond line\nrenamed\n',
            'first line\nsecond line\nrenamed again\n'
        ]);

        const reverse = history.compare({ from: changedCommit, to: rootCommit });
        const reverseByPath = new Map(reverse.files.map(file => [file.path, file]));
        assert.equal(reverseByPath.get('old.txt').changeKind, 'renamed');
        assert.equal(reverseByPath.get('old.txt').previousPath, 'renamed.txt');
        assert.equal(reverseByPath.get('old.txt').leftContent, 'first line\nsecond line\nrenamed\n');
        assert.equal(reverseByPath.get('old.txt').rightContent, 'first line\nsecond line\n');
        assert.equal(reverseByPath.get('created.txt').changeKind, 'deleted');
        assert.equal(reverseByPath.get('delete-me.txt').changeKind, 'added');
        assert.deepEqual(history.compare({ from: rootCommit, to: rootCommit }).files, []);

        const revisions = history.revisions({ commit: rootCommit });
        assert.equal(revisions.entries[0].commit, rootCommit);
        assert.equal(history.list({ commit: changedCommit }).entries[0].commit, changedCommit);
        assert.throws(() => history.compare({ from: '--all', to: changedCommit }), /full Git commit ID/);
        assert.throws(() => history.compare({ from: rootCommit, to: '0'.repeat(40) }), /could not be resolved/);
        assert.throws(() => history.compare({ from: rootCommit, to: changedCommit, path: '../secret' }), /relative/);
        assert.throws(() => history.compareMany({ commits: [rootCommit] }), /at least two/);
        assert.throws(() => history.compareMany({ commits: [rootCommit, rootCommit] }), /unique/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
