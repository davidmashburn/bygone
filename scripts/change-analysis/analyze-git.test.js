const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { correspondenceFixture } = require('../../test/correspondenceFixture');
const { createGitRunner, materializeBranchReviewTrees, resolveBranchReviewRange } = require('../../out/gitComparison');
const { readSnapshots, parseArgs, analyzeGit } = require('./analyze-git');
const { loadChangeCorrespondence } = require('../../out/changeCorrespondence');
const { analyzeWithBridge, LIMITS } = require('./run-refactoring-mappings');

test('Git snapshots preserve committed bytes across renames, additions, deletion and dirty edits', () => {
    const code = '/* 📦 */\r\nexport function price(n) { return n + 1; }\r\n';
    const fixture = correspondenceFixture({ before: { 'old name.ts': code, 'gone.js': 'const gone = 1;', 'README.md': 'old' },
        after: { 'new name.ts': code, 'added.ts': 'export const added = 2;', 'README.md': 'new' } });
    try {
        fs.writeFileSync(path.join(fixture.root, 'new name.ts'), 'dirty worktree');
        const range = resolveBranchReviewRange(fixture.root, fixture.range.headOid, fixture.range.baseOid);
        const snapshots = readSnapshots(range);
        assert.equal(snapshots.before['old name.ts'], code);
        assert.equal(snapshots.after['new name.ts'], code);
        assert.equal(snapshots.before['gone.js'], 'const gone = 1;');
        assert.equal(snapshots.after['added.ts'], 'export const added = 2;');
        assert(!Object.hasOwn(snapshots.before, 'new name.ts'));
        assert(!Object.hasOwn(snapshots.after, 'gone.js'));
        assert.deepEqual(snapshots.excluded, [{ path: 'README.md', reason: 'unsupported-language' }]);
        assert.throws(() => readSnapshots(range, { ...LIMITS, maxFiles: 1 }), /file-budget/);
        assert.throws(() => readSnapshots(range, { ...LIMITS, maxFileBytes: 1 }), /file-byte-budget/);
        assert.throws(() => readSnapshots(range, { ...LIMITS, maxBytes: 1 }), /comparison-byte-budget/);
    } finally { fixture.dispose(); }
});

test('binary source bytes are refused before parsing or JVM execution', () => {
    const fixture = correspondenceFixture({ before: { 'a.ts': 'const a = 1;' }, after: { 'a.ts': 'a\0b' } });
    try {
        const range = resolveBranchReviewRange(fixture.root, fixture.range.headOid, fixture.range.baseOid);
        assert.throws(() => readSnapshots(range), /non-text-source/);
    } finally { fixture.dispose(); }
});

test('bridge process budgets are capped and unsafe integers fail closed', () => {
    const before = { 'a.ts': 'const a = 1;\n' };
    const after = { 'a.ts': 'const a = 2;\n' };
    const originalSpawnSync = childProcess.spawnSync;
    const calls = [];
    childProcess.spawnSync = (executable, args, options) => {
        calls.push({ executable, args, options });
        return { status: 0, stdout: JSON.stringify({ version: 1, status: 'complete', mappers: [] }), stderr: '' };
    };
    try {
        const result = analyzeWithBridge(before, after, {
            java: 'java', jar: 'engine.jar', buildDir: 'build',
            limits: { timeoutMs: Number.MAX_SAFE_INTEGER, maxOutputBytes: Number.MAX_SAFE_INTEGER }
        });
        assert.equal(result.native.status, 'complete');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.timeout, LIMITS.timeoutMs);
        assert.equal(calls[0].options.maxBuffer, LIMITS.maxOutputBytes);
    } finally {
        childProcess.spawnSync = originalSpawnSync;
    }

    for (const limits of [
        { timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
        { maxOutputBytes: Number.MAX_SAFE_INTEGER + 1 }
    ]) {
        assert.equal(analyzeWithBridge(before, after, { limits }).analysis.reason, 'invalid-limits');
    }
});

test('Git snapshot commands use a finite timeout and surface a simulated timeout', () => {
    const originalExecFileSync = childProcess.execFileSync;
    const calls = [];
    childProcess.execFileSync = (executable, args, options) => {
        calls.push({ executable, args, options });
        throw Object.assign(new Error('simulated git timeout'), { code: 'ETIMEDOUT' });
    };
    try {
        assert.throws(() => readSnapshots({ repoRoot: process.cwd(), mergeBaseOid: 'base', headOid: 'head' }), /simulated git timeout/);
    } finally {
        childProcess.execFileSync = originalExecFileSync;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeout, 30_000);
});

test('git comparison subprocesses use a finite timeout for resolution and blob reads', () => {
    const originalExecFileSync = childProcess.execFileSync;
    const calls = [];
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bygone-git-timeout-'));
    try {
        childProcess.execFileSync = (executable, args, options) => {
            calls.push({ executable, args, options });
            assert.equal(args[0], '--no-replace-objects');
            args = args.slice(1);
            if (args[0] === 'status') throw Object.assign(new Error('simulated git timeout'), { code: 'ETIMEDOUT' });
            if (args[0] === 'ls-tree') return '100644 blob abc\tfile.txt\0';
            if (args[0] === 'show') return Buffer.from('content\n');
            throw new Error(`Unexpected git command: ${args.join(' ')}`);
        };

        assert.throws(() => createGitRunner()(['status'], root), /simulated git timeout/);
        assert.equal(calls[0].options.timeout, 30_000);
        calls.length = 0;

        const left = path.join(root, 'left');
        const right = path.join(root, 'right');
        materializeBranchReviewTrees({
            repoRoot: root,
            mergeBaseOid: 'base',
            headOid: 'head',
            changedPaths: [{ kind: 'modified', path: 'file.txt' }]
        }, left, right);
        assert.equal(fs.readFileSync(path.join(left, 'file.txt'), 'utf8'), 'content\n');
        assert.equal(fs.readFileSync(path.join(right, 'file.txt'), 'utf8'), 'content\n');
        assert.ok(calls.length >= 4);
        assert(calls.every(call => call.options.timeout === 30_000));
    } finally {
        childProcess.execFileSync = originalExecFileSync;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('development command requires an explicit comparison and output', () => {
    assert.throws(() => parseArgs([]), /correspondence:analyze/);
    assert.throws(() => parseArgs(['HEAD', '--base', 'main', '--output']), /requires a value/);
    assert.throws(() => parseArgs(['--base', 'main', '--output', 'a', '--unknown']), /Unknown option/);
    assert.equal(parseArgs(['--base', 'main', '--output', 'a']).head, 'HEAD');
    assert.throws(() => parseArgs(['--base', 'main', '--output', 'a', '--exact-only', '--java', 'java']), /cannot be combined/);
    assert.throws(() => parseArgs(['--base', 'main', '--output', 'a', '--exact-only', '--exact-only']), /Repeated option/);
});

test('Git analysis without Java writes a consumable partial artifact and does not guess edited moves', () => {
    const code = 'export function price(n) { return n + 1; }\n';
    const fixture = correspondenceFixture({ before: { 'a.ts': code, 'edited.ts': code },
        after: { 'a.ts': '// shifted\n' + code, 'moved.ts': code.replace('+ 1', '+ 2') } });
    const file = path.join(fixture.root, 'exact.json');
    const args = [fixture.range.headOid, '--base', fixture.range.baseOid, '--repo', fixture.root, '--output', file];
    let message = '';
    try {
        const generated = analyzeGit(args, fixture.root, { write(text) { message += text; } }, {});
        const artifact = loadChangeCorrespondence(fixture.root, file, fixture.range);
        assert.equal(artifact.status, 'partial');
        assert.equal(generated.relations.length, 1);
        assert.equal(artifact.relations.length, 1);
        assert(artifact.relations[0].rawEqual);
        assert(artifact.limitations.some(s => s.includes('engine-not-configured')));
        assert(artifact.limitations.some(s => s.includes('unmatched symbols do not prove')));
        assert(!artifact.limitations.some(s => s.includes('Engine SHA-256:')));
        assert.match(message, /Exact-only coverage/);
        assert.throws(() => analyzeGit(args, fixture.root, { write() {} }, {}), /EEXIST/);
    } finally { fixture.dispose(); }
});

test('explicit exact-only ignores ambient Java configuration; incomplete configuration fails without output', () => {
    const fixture = correspondenceFixture({ before: { 'a.js': 'const a = 1;' }, after: { 'a.js': '// shifted\nconst a = 1;' } });
    const file = path.join(fixture.root, 'exact.json');
    const args = ['--base', fixture.range.baseOid, '--output', file];
    try {
        for (const env of [{ MAPPING_JAVA: '/missing/java' }, { MAPPING_JAR: '/missing/engine.jar' },
            { MAPPING_JAR_SHA256: '0'.repeat(64) }, { MAPPING_JAVA: '/missing/java', MAPPING_JAR: '/missing/engine.jar', MAPPING_JAR_SHA256: 'invalid' }]) {
            assert.throws(() => analyzeGit(args, fixture.root, { write() {} }, env), /Incomplete Java engine configuration/);
            assert(!fs.existsSync(file));
        }
        const artifact = analyzeGit([...args, '--exact-only'], fixture.root, { write() {} }, { MAPPING_JAVA: '/missing/java' });
        assert.equal(artifact.relations.length, 1);
        assert.equal(artifact.status, 'partial');
    } finally { fixture.dispose(); }
});
