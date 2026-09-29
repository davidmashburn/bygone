const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { resolveWorkspaceGit, resolveWorkspaceRange } = require('../out/workspaceGit.js');

const temporaryRoots = new Set();

test.afterEach(() => {
    for (const root of temporaryRoots) {
        fs.rmSync(root, { recursive: true, force: true });
        temporaryRoots.delete(root);
    }
});

test('local files follow realpath ownership and retain duplicate logical paths', () => {
    const repo = createRepo();
    const file = path.join(repo, 'src', 'app.txt');
    const alias = path.join(repo, 'src', 'alias.txt');
    fs.symlinkSync(file, alias);

    const result = resolveWorkspaceGit({ kind: 'files', paths: [file, alias] });

    assert.equal(result.kind, 'ready');
    assert.equal(result.repoRoot, fs.realpathSync(repo));
    assert.equal(result.commonDir, fs.realpathSync(path.join(repo, '.git')));
    assert.equal(result.worktreeRoot, fs.realpathSync(repo));
    assert.deepEqual(result.paths, [
        { path: 'src/app.txt', type: 'file' },
        { path: 'src/app.txt', type: 'file' }
    ]);
    assert.deepEqual(result.revisions, ['WORKTREE']);
    assert.equal(result.activeRevision, 'WORKTREE');
    assert.equal(result.headOid, git(repo, ['rev-parse', 'HEAD']));
});

test('mixed clones fail even when their configured remotes match', () => {
    const first = createRepo();
    const second = createRepo();
    const remote = 'https://example.invalid/shared.git';
    git(first, ['remote', 'add', 'origin', remote]);
    git(second, ['remote', 'add', 'origin', remote]);

    const result = resolveWorkspaceGit({
        kind: 'files',
        paths: [path.join(first, 'src', 'app.txt'), path.join(second, 'src', 'app.txt')]
    });

    assert.equal(result.kind, 'unavailable');
    assert.match(result.reason, /different Git repositories|common director/i);
    assert.match(result.reason, /same remote/i);
});

test('linked worktrees keep their own live root and cannot be combined', () => {
    const repo = createRepo();
    const linked = makeTempDirectory('bygone-linked-');
    git(repo, ['worktree', 'add', '-q', '-b', 'linked', linked]);
    const mainFile = path.join(repo, 'src', 'app.txt');
    const linkedFile = path.join(linked, 'src', 'app.txt');

    const mixed = resolveWorkspaceGit({ kind: 'files', paths: [mainFile, linkedFile] });
    assert.equal(mixed.kind, 'unavailable');
    assert.match(mixed.reason, /multiple originating Git worktrees/i);

    const single = resolveWorkspaceGit({ kind: 'files', paths: [linkedFile] });
    assert.equal(single.kind, 'ready');
    assert.equal(single.repoRoot, fs.realpathSync(linked));
    assert.equal(single.worktreeRoot, fs.realpathSync(linked));
    assert.equal(single.commonDir, fs.realpathSync(path.join(repo, '.git')));
});

test('nested repositories and submodules are separate provenance boundaries', () => {
    const outer = createRepo();
    const nested = path.join(outer, 'nested');
    fs.mkdirSync(nested);
    initializeRepo(nested, 'nested.txt');

    const nestedResult = resolveWorkspaceGit({
        kind: 'files',
        paths: [path.join(outer, 'src', 'app.txt'), path.join(nested, 'nested.txt')]
    });
    assert.equal(nestedResult.kind, 'unavailable');
    assert.match(nestedResult.reason, /different Git repositories|common director/i);

    const submoduleRepo = createRepo();
    // macOS often exposes os.tmpdir() through /var -> /private/var; Git
    // rejects a submodule target whose absolute path contains that symlink.
    const submodulePath = path.join(fs.realpathSync(outer), 'submodule');
    git(outer, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', submoduleRepo, submodulePath]);
    git(outer, ['commit', '-qm', 'add submodule']);
    const submoduleResult = resolveWorkspaceGit({
        kind: 'files',
        paths: [path.join(outer, 'src', 'app.txt'), path.join(submodulePath, 'src', 'app.txt')]
    });
    assert.equal(submoduleResult.kind, 'unavailable');
    assert.match(submoduleResult.reason, /different Git repositories|common director/i);
});

test('untracked files suggest their containing directory without broadening scope', () => {
    const repo = createRepo();
    const untracked = path.join(repo, 'src', 'draft.txt');
    fs.writeFileSync(untracked, 'draft\n');

    const result = resolveWorkspaceGit({ kind: 'files', paths: [untracked] });

    assert.equal(result.kind, 'unavailable');
    assert.match(result.reason, /Untracked file/);
    assert.match(result.reason, /containing directory/);
    assert.doesNotMatch(result.reason, /automatically selected|auto-select/i);
});

test('unborn repositories are unavailable instead of being treated as working-tree history', () => {
    const repo = makeTempDirectory('bygone-unborn-');
    initializeGit(repo);
    const file = path.join(repo, 'draft.txt');
    fs.writeFileSync(file, 'draft\n');

    const result = resolveWorkspaceGit({ kind: 'files', paths: [file] });

    assert.equal(result.kind, 'unavailable');
    assert.match(result.reason, /unborn|no commit/i);
});

test('pinned revisions remain stable after a movable ref advances', () => {
    const repo = createRepo();
    const first = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['branch', 'moving']);
    fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'second\n');
    git(repo, ['add', 'src/app.txt']);
    git(repo, ['commit', '-qm', 'second']);
    const second = git(repo, ['rev-parse', 'HEAD']);
    const source = { kind: 'git-refs', repoRoot: repo, refs: ['moving', 'HEAD'] };

    const initial = resolveWorkspaceGit(source);
    assert.equal(initial.kind, 'ready');
    assert.deepEqual(initial.revisions, [first, second]);

    fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'third\n');
    git(repo, ['add', 'src/app.txt']);
    git(repo, ['commit', '-qm', 'third']);
    git(repo, ['branch', '-f', 'moving', 'HEAD']);

    const moved = resolveWorkspaceGit(source);
    assert.equal(moved.kind, 'ready');
    assert.notDeepEqual(moved.revisions, initial.revisions);

    const pinned = resolveWorkspaceGit(source, { pinnedRevisions: initial.revisions });
    assert.equal(pinned.kind, 'ready');
    assert.deepEqual(pinned.revisions, [first, second]);
    assert.equal(pinned.activeRevision, second);
    assert.equal(pinned.headOid, second);

    const fromSourcePin = resolveWorkspaceGit({ ...source, resolvedRevisions: initial.revisions });
    assert.equal(fromSourcePin.kind, 'ready');
    assert.deepEqual(fromSourcePin.revisions, [first, second]);
});

test('workspace range resolution reports only an exact ascending pair', () => {
    const repo = createRepo();
    const base = git(repo, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(repo, 'src', 'app.txt'), 'second\n');
    git(repo, ['add', 'src/app.txt']);
    git(repo, ['commit', '-qm', 'second']);
    const head = git(repo, ['rev-parse', 'HEAD']);

    const exact = resolveWorkspaceRange(repo, [base, head]);
    assert.equal(exact.status, 'exact');
    assert.equal(exact.fromOid, base);
    assert.equal(exact.toOid, head);
    assert.deepEqual(exact.revisions, [base, head]);
    assert.equal(resolveWorkspaceRange(repo, [head, base]).status, 'reversed');
    assert.equal(resolveWorkspaceRange(repo, [base, 'WORKTREE']).status, 'uncommitted');
    assert.equal(resolveWorkspaceRange(repo, [base]).status, 'none');
    assert.equal(resolveWorkspaceRange(repo, [base, head, head]).status, 'multiple');
});

function createRepo() {
    const root = makeTempDirectory('bygone-repo-');
    initializeRepo(root, 'src/app.txt');
    return root;
}

function initializeRepo(root, relativeFile) {
    initializeGit(root);
    const file = path.join(root, relativeFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'first\n');
    git(root, ['add', relativeFile]);
    git(root, ['commit', '-qm', 'initial']);
}

function initializeGit(root) {
    fs.mkdirSync(root, { recursive: true });
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'bygone-tests@example.invalid']);
    git(root, ['config', 'user.name', 'Bygone Tests']);
}

function makeTempDirectory(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryRoots.add(root);
    return root;
}

function git(cwd, args) {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}
