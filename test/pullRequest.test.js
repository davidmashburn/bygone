const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    PullRequestState,
    ensurePullRequestWorkspace,
    isPullRequestInput,
    parsePullRequestRef,
    requirePullRequestRef,
    resolveGitHubCliCommand,
    resolvePullRequest,
    formatPullRequestRepository
} = require('../out/pullRequest.js');

const temporaryRoots = new Set();

test.afterEach(() => {
    for (const root of temporaryRoots) {
        fs.rmSync(root, { recursive: true, force: true });
        temporaryRoots.delete(root);
    }
});

test('parses pull request URLs, qualified refs, enterprise hosts, and bare numbers safely', () => {
    const cases = [
        [
            'https://github.com/acme/widgets/pull/17/files?plain=1',
            { host: 'github.com', owner: 'acme', repo: 'widgets', number: 17 }
        ],
        [
            'https://ghe.example.invalid/acme/widgets/pulls/18#discussion',
            { host: 'ghe.example.invalid', owner: 'acme', repo: 'widgets', number: 18 }
        ],
        [
            'acme/widgets#19',
            { owner: 'acme', repo: 'widgets', number: 19 }
        ],
        [
            'ghe.example.invalid/acme/widgets#20',
            { host: 'ghe.example.invalid', owner: 'acme', repo: 'widgets', number: 20 }
        ],
        ['21', { number: 21 }],
        ['#22', { number: 22 }]
    ];

    for (const [input, expected] of cases) {
        const actual = parsePullRequestRef(input);
        assert.ok(actual, input);
        assert.equal(actual.host, expected.host, input);
        assert.equal(actual.owner, expected.owner, input);
        assert.equal(actual.repo, expected.repo, input);
        assert.equal(actual.number, expected.number, input);
    }
    assert.equal(formatPullRequestRepository(parsePullRequestRef('acme/widgets#19')), 'acme/widgets');
    assert.equal(
        formatPullRequestRepository(parsePullRequestRef('ghe.example.invalid/acme/widgets#20')),
        'ghe.example.invalid/acme/widgets'
    );
    assert.equal(isPullRequestInput('acme/widgets#19'), true);
    assert.equal(isPullRequestInput('https://github.com/acme/widgets/pull/17'), true);
    assert.equal(isPullRequestInput('21'), false);
    assert.equal(isPullRequestInput('#22'), false);

    const invalid = [
        '',
        '0',
        '#0',
        'acme/widgets#0',
        'acme/../widgets#1',
        'acme/widgets/..#1',
        'https://github.com/../widgets/pull/1',
        'https://github.com/acme/../pull/1',
        'https://.github.com/acme/widgets/pull/1',
        'https://github.com/acme/widgets/pull/9007199254740992'
    ];
    for (const input of invalid) {
        assert.equal(parsePullRequestRef(input), undefined, input);
        assert.throws(
            () => requirePullRequestRef(input),
            /Could not read/,
            input
        );
    }
});

test('resolves GitHub metadata through an injected gh runner', () => {
    const root = makeTemporaryDirectory('bygone-pr-gh-');
    const ref = {
        host: 'ghe.example.invalid',
        owner: 'acme',
        repo: 'widgets',
        number: 7
    };
    const payload = {
        number: 7,
        title: 'Improve widgets',
        body: 'Use the upstream implementation.',
        author: { login: 'reviewer' },
        url: 'https://ghe.example.invalid/acme/widgets/pull/7',
        state: 'OPEN',
        baseRefName: 'main',
        headRefName: 'feature/widgets',
        baseRefOid: 'a'.repeat(40),
        headRefOid: 'b'.repeat(40),
        isCrossRepository: true
    };
    const calls = [];
    const metadata = resolvePullRequest(
        ref,
        root,
        (command, args, cwd) => {
            calls.push({ command, args: [...args], cwd });
            return JSON.stringify(payload);
        },
        { command: '/test/bin/gh' }
    );

    assert.deepEqual(metadata, {
        number: 7,
        title: payload.title,
        body: payload.body,
        author: 'reviewer',
        url: payload.url,
        state: PullRequestState.Open,
        baseRefName: payload.baseRefName,
        headRefName: payload.headRefName,
        baseRefOid: payload.baseRefOid,
        headRefOid: payload.headRefOid,
        isCrossRepository: true
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, '/test/bin/gh');
    assert.equal(calls[0].cwd, root);
    assert.deepEqual(calls[0].args.slice(0, 3), ['pr', 'view', '7']);
    assert.ok(calls[0].args.includes('--json'));
    assert.deepEqual(calls[0].args.slice(-2), ['--repo', 'ghe.example.invalid/acme/widgets']);

    const bareMetadata = resolvePullRequest(
        { number: 7 },
        root,
        (command, args, cwd) => {
            calls.push({ command, args: [...args], cwd });
            return JSON.stringify(payload);
        },
        { command: '/test/bin/gh' }
    );
    assert.equal(bareMetadata.number, 7);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.includes('--repo'), false);
    resolvePullRequest({ ...ref, host: 'github.com' }, root, (_command, args) => {
        assert.deepEqual(args.slice(-2), ['--repo', 'github.com/acme/widgets']);
        return JSON.stringify({ ...payload, url: 'https://github.com/acme/widgets/pull/7' });
    });
});

test('discovers gh from an explicit path, PATH, fixed candidates, and a login shell', () => {
    const executableOnPath = path.join('/custom/bin', process.platform === 'win32' ? 'gh.exe' : 'gh');
    const fallback = path.join('/fallback/bin', process.platform === 'win32' ? 'gh.exe' : 'gh');
    const executableFromLoginShell = path.join('/login/bin', process.platform === 'win32' ? 'gh.exe' : 'gh');

    assert.equal(
        resolveGitHubCliCommand({
            env: { BYGONE_GH_PATH: '/explicit/gh', PATH: '' },
            candidates: [fallback],
            isExecutable: () => false,
            readLoginShellPath: () => '/login/bin'
        }),
        '/explicit/gh'
    );
    assert.equal(
        resolveGitHubCliCommand({
            env: { PATH: `/empty${path.delimiter}/custom/bin` },
            candidates: [fallback],
            isExecutable: candidate => candidate === executableOnPath || candidate === fallback,
            readLoginShellPath: () => '/login/bin'
        }),
        executableOnPath
    );
    assert.equal(
        resolveGitHubCliCommand({
            env: { PATH: '/empty' },
            candidates: [fallback],
            isExecutable: candidate => candidate === fallback,
            readLoginShellPath: () => '/login/bin'
        }),
        fallback
    );
    assert.equal(
        resolveGitHubCliCommand({
            env: { PATH: '/empty' },
            candidates: [],
            isExecutable: candidate => candidate === executableFromLoginShell,
            readLoginShellPath: () => '/login/bin'
        }),
        executableFromLoginShell
    );
    assert.equal(
        resolveGitHubCliCommand({
            env: { PATH: '/empty' },
            candidates: [],
            isExecutable: () => false,
            readLoginShellPath: () => undefined
        }),
        'gh'
    );
});

test('fetches matching upstream PR refs without changing dirty user files or config', () => {
    const root = makeTemporaryDirectory('bygone-pr-local-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    const userRepo = cloneRepository(root, 'user', upstream.bare);
    const dirtyFile = path.join(userRepo, 'sample.txt');
    const untrackedFile = path.join(userRepo, 'local-notes.txt');
    fs.writeFileSync(dirtyFile, 'user edits must survive\n');
    fs.writeFileSync(untrackedFile, 'untracked user file\n');
    runGit(userRepo, ['config', '--local', 'bygone.test-setting', 'keep']);
    const beforeConfig = fs.readFileSync(path.join(userRepo, '.git', 'config'));
    const beforeStatus = runGit(userRepo, ['status', '--porcelain=v1', '--untracked-files=normal']);
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const ref = parsePullRequestRef(metadata.url);
    const command = makeIdentityCommand(userRepo, {
        origin: 'https://github.com/acme/widgets.git'
    });

    const workspace = ensurePullRequestWorkspace(ref, metadata, userRepo, {
        runCommand: command.runCommand
    });

    assert.equal(workspace.provisioned, false);
    assert.equal(workspace.repoRoot, fs.realpathSync(userRepo));
    assertWorkspaceOids(workspace, metadata, userRepo);
    assert.equal(fs.readFileSync(dirtyFile, 'utf8'), 'user edits must survive\n');
    assert.equal(fs.readFileSync(untrackedFile, 'utf8'), 'untracked user file\n');
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'config')), beforeConfig);
    assert.equal(
        runGit(userRepo, ['status', '--porcelain=v1', '--untracked-files=normal']),
        beforeStatus
    );
});

test('uses an upstream remote when origin is a fork and fetches the PR ref from it', () => {
    const root = makeTemporaryDirectory('bygone-pr-fork-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    const fork = createPullRequestRemote(root, 'fork', 'fork head');
    const userRepo = cloneRepository(root, 'user', fork.bare);
    runGit(userRepo, ['remote', 'add', 'upstream', upstream.bare]);
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const ref = { number: 7 };
    const command = makeIdentityCommand(userRepo, {
        origin: 'https://github.com/contributor/widgets.git',
        upstream: 'https://github.com/acme/widgets.git'
    });

    const workspace = ensurePullRequestWorkspace(ref, metadata, userRepo, {
        runCommand: command.runCommand
    });

    assert.equal(workspace.provisioned, false);
    assertWorkspaceOids(workspace, metadata, userRepo);
    assert.notEqual(workspace.headRef, fork.head);
    const fetch = command.calls.find(call => call.command === 'git' && call.args.includes('fetch'));
    assert.ok(fetch, 'expected an actual git fetch');
    const fetchIndex = fetch.args.indexOf('fetch');
    assert.equal(fetch.args[fetchIndex + 3], 'upstream');
});

test('separates hosts, provisions a clean cache, persists its helper, and refreshes refs by OID', () => {
    const root = makeTemporaryDirectory('bygone-pr-cache-');
    const upstream = createPullRequestRemote(root, 'upstream', 'first upstream head');
    const fork = createPullRequestRemote(root, 'fork', 'different host head');
    const userRepo = cloneRepository(root, 'user', fork.bare);
    const dirtyFile = path.join(userRepo, 'sample.txt');
    fs.writeFileSync(dirtyFile, 'leave this user file alone\n');
    runGit(userRepo, ['config', '--local', 'bygone.test-setting', 'keep']);
    const beforeConfig = fs.readFileSync(path.join(userRepo, '.git', 'config'));
    const beforeFile = fs.readFileSync(dirtyFile);
    const cacheRoot = path.join(root, 'empty-cache');
    assert.equal(fs.existsSync(cacheRoot), false);
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const ref = parsePullRequestRef(metadata.url);
    const command = makeIdentityCommand(userRepo, {
        origin: 'https://ghe.example.invalid/acme/widgets.git'
    });
    const options = {
        cacheRoot,
        remoteUrl: upstream.bare,
        partialCloneFilter: false,
        runCommand: command.runCommand
    };

    const first = ensurePullRequestWorkspace(ref, metadata, userRepo, options);
    const cacheRepo = path.join(cacheRoot, 'github.com', 'acme', 'widgets');

    assert.equal(first.provisioned, true);
    assert.equal(first.repoRoot, fs.realpathSync(cacheRepo));
    assertWorkspaceOids(first, metadata, cacheRepo);
    assert.equal(runGit(cacheRepo, ['status', '--porcelain']), '');
    assert.equal(runGit(cacheRepo, ['remote', 'get-url', 'origin']), upstream.bare);
    const firstHelpers = readCredentialHelpers(cacheRepo);
    assert.equal(firstHelpers.length, 1);
    assert.match(firstHelpers[0], /auth git-credential/);
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'config')), beforeConfig);
    assert.deepEqual(fs.readFileSync(dirtyFile), beforeFile);

    const secondHead = advancePullRequestHead(upstream, 'second upstream head');
    const refreshedMetadata = { ...metadata, headRefOid: secondHead };
    const second = ensurePullRequestWorkspace(ref, refreshedMetadata, userRepo, options);

    assert.equal(first.headRef, metadata.headRefOid);
    assert.equal(second.headRef, secondHead);
    assert.equal(second.baseRef, metadata.baseRefOid);
    assert.notEqual(first.headRef, second.headRef);
    assert.equal(runGit(cacheRepo, ['rev-parse', 'refs/bygone/pr/7^{commit}']), secondHead);
    assert.equal(readCredentialHelpers(cacheRepo).length, 1);
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'config')), beforeConfig);
    assert.deepEqual(fs.readFileSync(dirtyFile), beforeFile);
});

test('uses a filesystem-safe cache key for an enterprise host with a port', () => {
    const root = makeTemporaryDirectory('bygone-pr-host-port-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    const metadata = metadataFor(upstream, 'https://ghe.example.invalid:8443/acme/widgets/pull/7');
    const command = makeIdentityCommand(root, {});
    const ref = parsePullRequestRef(metadata.url);
    assert.equal(formatPullRequestRepository(ref), 'ghe.example.invalid:8443/acme/widgets');
    const workspace = ensurePullRequestWorkspace(ref, metadata, root, {
        cacheRoot: path.join(root, 'cache'), remoteUrl: upstream.bare,
        partialCloneFilter: false, runCommand: command.runCommand
    });
    assert.equal(workspace.repoRoot, path.join(root, 'cache', 'ghe.example.invalid%3A8443', 'acme', 'widgets'));
    assert.equal(workspace.headRef, metadata.headRefOid);
    const config = fs.readFileSync(path.join(workspace.repoRoot, '.git', 'config'), 'utf8');
    assert.match(config, /credential "https:\/\/ghe\.example\.invalid:8443"/);
});

test('leaves user partial-clone configuration intact and uses an owned cache for lazy reads', () => {
    const root = makeTemporaryDirectory('bygone-pr-partial-user-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    const userRepo = cloneRepository(root, 'user', upstream.bare);
    runGit(userRepo, ['config', '--local', 'remote.origin.promisor', 'true']);
    runGit(userRepo, ['config', '--local', 'remote.origin.partialclonefilter', 'blob:none']);
    const beforeConfig = fs.readFileSync(path.join(userRepo, '.git', 'config'));
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const command = makeIdentityCommand(userRepo, { origin: 'https://github.com/acme/widgets.git' });
    const workspace = ensurePullRequestWorkspace({ number: 7 }, metadata, userRepo, {
        cacheRoot: path.join(root, 'cache'),
        remoteUrl: upstream.bare,
        partialCloneFilter: false,
        runCommand: command.runCommand
    });
    assert.equal(workspace.provisioned, true);
    assert.notEqual(workspace.repoRoot, userRepo);
    assert.equal(workspace.headRef, metadata.headRefOid);
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'config')), beforeConfig);
});

test('uses complete cache history when the matching user clone is shallow', () => {
    const root = makeTemporaryDirectory('bygone-pr-shallow-user-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    runGit(upstream.work, ['checkout', '--quiet', 'main']);
    fs.writeFileSync(path.join(upstream.work, 'destination.txt'), 'destination advance\n');
    runGit(upstream.work, ['add', 'destination.txt']);
    runGit(upstream.work, ['commit', '--quiet', '--message', 'advance destination']);
    runGit(upstream.work, ['push', '--quiet', 'origin', 'main']);
    const userRepo = path.join(root, 'shallow');
    runGit(root, ['clone', '--quiet', '--depth=1', `file://${upstream.bare}`, userRepo]);
    assert.equal(runGit(userRepo, ['rev-parse', '--is-shallow-repository']), 'true');
    const beforeShallow = fs.readFileSync(path.join(userRepo, '.git', 'shallow'));
    const beforeConfig = fs.readFileSync(path.join(userRepo, '.git', 'config'));
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const command = makeIdentityCommand(userRepo, { origin: 'https://github.com/acme/widgets.git' });
    const workspace = ensurePullRequestWorkspace({ number: 7 }, metadata, userRepo, {
        cacheRoot: path.join(root, 'cache'), remoteUrl: upstream.bare,
        partialCloneFilter: false, runCommand: command.runCommand
    });
    const { resolveBranchReviewRange } = require('../out/gitComparison');
    const range = resolveBranchReviewRange(workspace.repoRoot, workspace.headRef, workspace.baseRef);
    assert.equal(workspace.provisioned, true);
    assert.equal(range.mergeBaseOid, upstream.base);
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'shallow')), beforeShallow);
    assert.deepEqual(fs.readFileSync(path.join(userRepo, '.git', 'config')), beforeConfig);
});

test('rejects a moved PR head but pins the current destination despite historical base metadata', () => {
    const root = makeTemporaryDirectory('bygone-pr-oid-');
    const upstream = createPullRequestRemote(root, 'upstream', 'upstream head');
    const userRepo = cloneRepository(root, 'user', upstream.bare);
    const metadata = metadataFor(upstream, 'https://github.com/acme/widgets/pull/7');
    const ref = parsePullRequestRef(metadata.url);
    const command = makeIdentityCommand(userRepo, {
        origin: 'https://github.com/acme/widgets.git'
    });

    assert.throws(
        () => ensurePullRequestWorkspace(ref, { ...metadata, headRefOid: metadata.baseRefOid }, userRepo, {
            runCommand: command.runCommand
        }),
        /fetched pull request.*does not match.*commit.*GitHub/i
    );
    runGit(upstream.work, ['checkout', '--quiet', 'main']);
    fs.writeFileSync(path.join(upstream.work, 'destination.txt'), 'main moved independently\n');
    runGit(upstream.work, ['add', 'destination.txt']);
    runGit(upstream.work, ['commit', '--quiet', '--message', 'advance destination']);
    const currentBase = runGit(upstream.work, ['rev-parse', 'HEAD']);
    runGit(upstream.work, ['push', '--quiet', 'origin', 'main']);
    const workspace = ensurePullRequestWorkspace(ref, metadata, userRepo, {
        runCommand: command.runCommand
    });
    assert.equal(workspace.headRef, metadata.headRefOid);
    assert.equal(workspace.baseRef, currentBase);
    assert.notEqual(workspace.baseRef, metadata.baseRefOid);
});

function makeTemporaryDirectory(prefix) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    temporaryRoots.add(root);
    return root;
}

function runGit(cwd, args, env) {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`);
    }
    return result.stdout.trimEnd();
}

function createPullRequestRemote(root, name, headContents) {
    const work = path.join(root, `${name}-work`);
    const bare = path.join(root, `${name}.git`);
    fs.mkdirSync(work);
    runGit(work, ['init', '--quiet']);
    runGit(work, ['config', 'user.name', 'Synthetic Reviewer']);
    runGit(work, ['config', 'user.email', 'review@example.invalid']);
    fs.writeFileSync(path.join(work, 'sample.txt'), 'base\n');
    runGit(work, ['add', 'sample.txt']);
    runGit(work, ['commit', '--quiet', '--message', 'base']);
    runGit(work, ['branch', '--move', 'main']);
    const base = runGit(work, ['rev-parse', 'HEAD']);
    runGit(work, ['checkout', '--quiet', '-b', 'feature']);
    fs.writeFileSync(path.join(work, 'sample.txt'), `${headContents}\n`);
    runGit(work, ['commit', '--quiet', '--all', '--message', 'head']);
    const head = runGit(work, ['rev-parse', 'HEAD']);

    runGit(root, ['init', '--bare', '--quiet', bare]);
    runGit(work, ['remote', 'add', 'origin', bare]);
    runGit(work, ['push', '--quiet', 'origin', 'main']);
    runGit(work, ['push', '--quiet', 'origin', 'feature']);
    runGit(bare, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    runGit(bare, ['update-ref', 'refs/pull/7/head', head]);
    return { work, bare, base, head };
}

function advancePullRequestHead(remote, contents) {
    fs.writeFileSync(path.join(remote.work, 'sample.txt'), `${contents}\n`);
    runGit(remote.work, ['commit', '--quiet', '--all', '--message', 'refresh head']);
    const head = runGit(remote.work, ['rev-parse', 'HEAD']);
    runGit(remote.work, ['push', '--quiet', 'origin', 'feature']);
    runGit(remote.bare, ['update-ref', 'refs/pull/7/head', head]);
    remote.head = head;
    return head;
}

function cloneRepository(root, name, remote) {
    const destination = path.join(root, name);
    runGit(root, ['clone', '--quiet', remote, destination]);
    return destination;
}

function metadataFor(remote, url) {
    return {
        number: 7,
        title: 'Synthetic pull request',
        body: 'Synthetic body',
        author: 'synthetic',
        url,
        state: PullRequestState.Open,
        baseRefName: 'main',
        headRefName: 'feature',
        baseRefOid: remote.base,
        headRefOid: remote.head,
        isCrossRepository: false
    };
}

function makeIdentityCommand(userRepo, identities) {
    const calls = [];
    const runCommand = (command, args, cwd, env) => {
        const copiedArgs = [...args];
        calls.push({ command, args: copiedArgs, cwd });
        if (
            command === 'git'
            && copiedArgs[0] === 'remote'
            && copiedArgs[1] === 'get-url'
            && path.resolve(cwd) === path.resolve(userRepo)
        ) {
            const identity = identities[copiedArgs[2]];
            if (!identity) throw new Error(`No synthetic identity for remote ${copiedArgs[2]}`);
            return identity;
        }
        return runGit(cwd, copiedArgs, env);
    };
    return { calls, runCommand };
}

function assertWorkspaceOids(workspace, metadata, repoRoot) {
    assert.equal(workspace.headRef, metadata.headRefOid);
    assert.equal(workspace.baseRef, metadata.baseRefOid);
    assert.equal(runGit(repoRoot, ['rev-parse', 'refs/bygone/pr/7^{commit}']), metadata.headRefOid);
    assert.equal(runGit(repoRoot, ['rev-parse', 'refs/bygone/base/7^{commit}']), metadata.baseRefOid);
}

function readCredentialHelpers(repoRoot) {
    return runGit(repoRoot, [
        'config',
        '--local',
        '--get-all',
        'credential.https://github.com.helper'
    ]).split('\n').filter(Boolean);
}
