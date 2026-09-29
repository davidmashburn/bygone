const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { createWorkspaceHistory } = require('../out/workspaceHistory.js');

function git(repoRoot, args) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function write(repoRoot, relativePath, content) {
    const target = path.join(repoRoot, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function commit(repoRoot, summary) {
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-qm', summary]);
    return git(repoRoot, ['rev-parse', 'HEAD']);
}

function makeBranchFixture(t) {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-history-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));

    git(repoRoot, ['init', '-q']);
    git(repoRoot, ['config', 'user.email', 'workspace-history@example.test']);
    git(repoRoot, ['config', 'user.name', 'Workspace History']);

    write(repoRoot, 'tracked.txt', 'base\n');
    write(repoRoot, 'old.txt', 'old\n');
    const base = commit(repoRoot, 'base');
    const mainBranch = git(repoRoot, ['symbolic-ref', '--short', 'HEAD']);

    git(repoRoot, ['checkout', '-qb', 'side']);
    write(repoRoot, 'tracked.txt', 'side\n');
    write(repoRoot, 'side.txt', 'side\n');
    const side = commit(repoRoot, 'side change');

    git(repoRoot, ['checkout', '-q', mainBranch]);
    write(repoRoot, 'other.txt', 'other\n');
    const main = commit(repoRoot, 'unrelated main change');
    fs.renameSync(path.join(repoRoot, 'old.txt'), path.join(repoRoot, 'new.txt'));
    const rename = commit(repoRoot, 'rename old file');

    return { repoRoot, base, side, main, rename };
}

function rootContext(fixture, revisions, activeRevision, paths = []) {
    return {
        repoRoot: fixture.repoRoot,
        paths,
        revisions,
        headOid: fixture.rename,
        activeRevision
    };
}

test('builds a deterministic all-commit axis and historical path union', (t) => {
    const fixture = makeBranchFixture(t);
    const context = rootContext(
        fixture,
        [fixture.rename, fixture.side],
        fixture.rename
    );

    const history = createWorkspaceHistory(context);
    const secondHistory = createWorkspaceHistory(context);
    const commits = history.entries.map((entry) => entry.commit);
    assert.deepEqual(commits, secondHistory.entries.map((entry) => entry.commit));
    assert.deepEqual(new Set(commits), new Set([fixture.base, fixture.side, fixture.main, fixture.rename]));
    assert.ok(commits.indexOf(fixture.rename) < commits.indexOf(fixture.main));
    assert.ok(commits.indexOf(fixture.main) < commits.indexOf(fixture.base));
    assert.ok(commits.indexOf(fixture.side) < commits.indexOf(fixture.base));
    assert.equal(history.entries.find((entry) => entry.commit === fixture.main).summary, 'unrelated main change');
    assert.equal(history.entries.find((entry) => entry.commit === fixture.base).parentCommit, null);

    assert.deepEqual(history.files, ['new.txt', 'old.txt', 'other.txt', 'side.txt', 'tracked.txt']);
    assert.deepEqual(history.changedCommits('tracked.txt'), [fixture.base, fixture.side]);
    assert.deepEqual(history.read('tracked.txt', fixture.main), { content: 'base\n', exists: true });
    assert.deepEqual(history.read('old.txt', fixture.base), { content: 'old\n', exists: true });
    assert.deepEqual(history.read('old.txt', fixture.rename), { content: '', exists: false });
    assert.deepEqual(history.read('new.txt', fixture.rename), { content: 'old\n', exists: true });
});

test('keeps explicit file scopes, absent paths, and a read-only public surface', (t) => {
    const fixture = makeBranchFixture(t);
    const focused = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename], fixture.rename),
        paths: [{ path: 'new.txt', type: 'file' }]
    });

    assert.deepEqual(focused.files, ['new.txt']);
    assert.deepEqual(focused.read('new.txt', fixture.rename), { content: 'old\n', exists: true });
    assert.throws(() => focused.read('old.txt', fixture.rename), /outside.*scope/i);
    assert.deepEqual(focused.read('new.txt', 'EMPTY'), { content: '', exists: false });
    assert.throws(() => focused.read('new.txt', 'not-a-revision'), /unknown history revision/i);
    assert.deepEqual(Object.keys(focused).sort(), ['changedCommits', 'entries', 'files', 'read']);
    assert.equal(typeof focused.write, 'undefined');

    const missingFile = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename], fixture.rename),
        paths: [{ path: 'never-created.txt', type: 'file' }]
    });
    assert.deepEqual(missingFile.files, ['never-created.txt']);
    assert.deepEqual(missingFile.read('never-created.txt', fixture.rename), { content: '', exists: false });
    assert.throws(() => missingFile.read('../outside.txt', fixture.rename), /safe relative|outside/i);
    assert.throws(() => missingFile.read('/outside.txt', fixture.rename), /safe relative|outside/i);
});

test('exposes only requested local states and roots them at the pinned head', (t) => {
    const fixture = makeBranchFixture(t);
    write(fixture.repoRoot, 'tracked.txt', 'working tree\n');
    write(fixture.repoRoot, 'staged.txt', 'index\n');
    git(fixture.repoRoot, ['add', 'staged.txt']);

    const local = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename, 'WORKTREE', 'INDEX'], 'WORKTREE')
    });
    assert.deepEqual(local.entries.slice(0, 2).map((entry) => [entry.commit, entry.parentCommit]), [
        ['WORKTREE', 'INDEX'],
        ['INDEX', fixture.rename]
    ]);
    assert.deepEqual(local.read('tracked.txt', 'WORKTREE'), { content: 'working tree\n', exists: true });
    assert.deepEqual(local.read('staged.txt', 'INDEX'), { content: 'index\n', exists: true });
    assert.deepEqual(local.read('staged.txt', 'WORKTREE'), { content: 'index\n', exists: true });
    assert.ok(local.files.includes('staged.txt'));
    assert.ok(local.changedCommits('tracked.txt').includes('WORKTREE'));
    assert.ok(local.changedCommits('staged.txt').includes('INDEX'));
    assert.deepEqual(local.changedCommits('tracked.txt'), local.changedCommits('tracked.txt'));

    const explicitIndexWithoutOption = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename, 'INDEX'], 'INDEX')
    });
    assert.equal(explicitIndexWithoutOption.entries[0].commit, 'INDEX');
    assert.deepEqual(explicitIndexWithoutOption.read('staged.txt', 'INDEX'), { content: 'index\n', exists: true });

    const committedOnly = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.side], fixture.side)
    }, { includeStaged: true });
    assert.deepEqual(committedOnly.entries.map((entry) => entry.commit), [fixture.side, fixture.base]);
    assert.equal(committedOnly.files.includes('staged.txt'), false);
    assert.throws(() => committedOnly.read('tracked.txt', 'WORKTREE'), /not available/i);

    // A mixed axis must retain the resolver-pinned head even when the
    // explicitly selected committed root belongs to another branch.
    const mixed = createWorkspaceHistory({
        ...rootContext(fixture, [fixture.side, 'WORKTREE'], 'WORKTREE')
    });
    assert.equal(mixed.entries[0].commit, 'WORKTREE');
    assert.equal(mixed.entries.some((entry) => entry.commit === fixture.rename), true);
    assert.deepEqual(mixed.read('other.txt', fixture.rename), { content: 'other\n', exists: true });
});

test('omits binary and oversized content and rejects escaping working-tree paths', (t) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-history-safety-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    git(repoRoot, ['init', '-q']);
    git(repoRoot, ['config', 'user.email', 'workspace-history@example.test']);
    git(repoRoot, ['config', 'user.name', 'Workspace History']);
    write(repoRoot, 'text.txt', 'text\n');
    fs.writeFileSync(path.join(repoRoot, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(repoRoot, 'large.dat'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    const head = commit(repoRoot, 'safety fixtures');

    const committed = createWorkspaceHistory({
        repoRoot,
        paths: [],
        revisions: [head],
        headOid: head,
        activeRevision: head
    });
    const binary = committed.read('binary.dat', head);
    assert.equal(binary.exists, true);
    assert.match(binary.reason, /binary/i);
    const large = committed.read('large.dat', head);
    assert.equal(large.exists, true);
    assert.match(large.reason, /large|2 MiB/i);

    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-history-outside-'));
    t.after(() => fs.rmSync(outsideRoot, { recursive: true, force: true }));
    const outsideFile = path.join(outsideRoot, 'outside.txt');
    fs.writeFileSync(outsideFile, 'secret\n');
    fs.symlinkSync(outsideFile, path.join(repoRoot, 'escape.txt'));
    const escaping = createWorkspaceHistory({
        repoRoot,
        paths: [{ path: 'escape.txt', type: 'file' }],
        revisions: [head, 'WORKTREE'],
        headOid: head,
        activeRevision: 'WORKTREE'
    });
    assert.throws(() => escaping.read('escape.txt', 'WORKTREE'), /escapes/i);

    const nested = path.join(repoRoot, 'nested');
    fs.mkdirSync(nested);
    git(nested, ['init', '-q']);
    write(nested, 'child.txt', 'nested\n');
    const nestedHistory = createWorkspaceHistory({
        repoRoot,
        paths: [{ path: 'nested/child.txt', type: 'file' }],
        revisions: [head, 'WORKTREE'],
        headOid: head,
        activeRevision: 'WORKTREE'
    });
    assert.throws(() => nestedHistory.read('nested/child.txt', 'WORKTREE'), /nested repository boundary/i);
});

test('validates full commit OIDs and active-axis membership', (t) => {
    const fixture = makeBranchFixture(t);
    assert.throws(() => createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename], fixture.rename),
        headOid: 'deadbeef'
    }), /invalid head OID/i);
    assert.throws(() => createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename], fixture.side),
        activeRevision: fixture.side
    }), /not on the selected axis/i);
    assert.throws(() => createWorkspaceHistory({
        ...rootContext(fixture, [fixture.rename], fixture.rename),
        activeRevision: 'WORKTREE'
    }), /not available|not included/i);
});
