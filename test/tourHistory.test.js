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
        git('commit', '-m', 'Create file');
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
        const list = history.list({ path: 'after.txt', commit: unrelated });
        assert.equal(list.selectedCommit, rename);
        assert.match(list.fallback, /preceding/);
        assert.deepEqual(list.entries.map(entry => entry.commit), [rename, first]);
        assert.equal(list.entries[0].previousPath, 'before.txt');
        assert.equal(list.entries[1].path, 'before.txt');
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
