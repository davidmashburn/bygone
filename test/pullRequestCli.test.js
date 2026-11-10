const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parsePresentArgs } = require('../cli/present');
const { parseTourArgs } = require('../cli/tour');
const { parseReviewArguments, PullRequestState } = require('../out/pullRequest');
const { correspondenceFixture } = require('./correspondenceFixture');

const url = 'https://example.test/owner/repo/pull/17/files#discussion-1';

test('explicit review, present and context commands accept numbers and PR links', () => {
    for (const input of ['17', '#17', 'owner/repo#17', url]) {
        assert.equal(parseReviewArguments([input]).pullRequest.number, 17);
        assert.equal(parsePresentArgs([input]).pullRequestRef.number, 17);
        assert.equal(parseTourArgs(['context', input]).pullRequestRef.number, 17);
        for (const flag of ['--pr', '--pull-request']) {
            assert.equal(parseReviewArguments([flag, input]).pullRequest.number, 17);
            assert.equal(parsePresentArgs([flag, input]).pullRequestRef.number, 17);
            assert.equal(parseTourArgs(['context', flag, input]).pullRequestRef.number, 17);
        }
    }
    assert.equal(parseReviewArguments(['--branch', '17']).branch, '17');
    assert.equal(parseReviewArguments(['-b', 'feature', '-m', 'main'], false).mainRef, 'main');
    assert.equal(parsePresentArgs(['feature']).headRef, 'feature');
    assert.equal(parseTourArgs(['context', 'feature']).headRef, 'feature');
});

test('PR selections reject conflicting ranges and duplicate inputs', () => {
    const parsers = [parseReviewArguments, parsePresentArgs, args => parseTourArgs(['context', ...args])];
    for (const parse of parsers) {
        for (const args of [[url, '--base', 'main'], ['feature', url], [url, '18'], ['--pr'], ['--pr', 'nope']]) {
            assert.throws(() => parse(args));
        }
    }
    assert.throws(() => parsePresentArgs([url, '--tour', 'review.bygone']), /cannot be combined/);
    assert.throws(() => parseReviewArguments(['--unknown']), /Unknown review option/);
    assert.throws(() => parseReviewArguments(['--base']), /requires a Git ref/);
});

test('a PR outside a clone feeds context, dependencies, and the presentation server', {
    skip: process.platform === 'win32' ? 'Executable gh fixture uses a POSIX shebang' : false
}, () => {
    const fixture = correspondenceFixture({ before: { 'a.ts': 'export const value = 1;\n' }, after: { 'a.ts': 'export const value = 2;\n' } });
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-pr-cli-'));
    try {
        const git = (...args) => execFileSync('git', args, { cwd: fixture.root, stdio: 'pipe' });
        const baseTree = git('rev-parse', `${fixture.range.baseOid}^{tree}`).toString().trim();
        const destinationOid = execFileSync('git', ['commit-tree', baseTree, '-p', fixture.range.baseOid], {
            cwd: fixture.root, input: 'Destination advanced independently\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        git('update-ref', 'refs/heads/main', destinationOid);
        git('update-ref', 'refs/pull/17/head', fixture.range.headOid);
        const metadata = { number: 17, title: 'Explain the value change', body: 'Make the value two.',
            author: { login: 'fixture' }, url: url.split('/files')[0], state: PullRequestState.Open,
            baseRefName: 'main', headRefName: 'feature', baseRefOid: fixture.range.baseOid,
            headRefOid: fixture.range.headOid, isCrossRepository: true };
        const gh = path.join(scratch, 'gh');
        fs.writeFileSync(gh, `#!${process.execPath}\nif (process.argv[2] !== 'pr') process.exit(1);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(metadata))});\n`, { mode: 0o755 });
        const config = path.join(scratch, 'gitconfig');
        execFileSync('git', ['config', '--file', config, `url.file://${fixture.root}.insteadOf`, 'https://example.test/owner/repo.git']);
        const packageRoot = path.resolve(__dirname, '..');
        const script = `
            const assert = require('node:assert/strict');
            const { runTourCommand } = require(${JSON.stringify(path.join(packageRoot, 'cli/tour'))});
            const { startPresentation } = require(${JSON.stringify(path.join(packageRoot, 'cli/present'))});
            const { parseChangeTourManifest, buildChangeTourManifest } = require(${JSON.stringify(path.join(packageRoot, 'out/changeTour'))});
            (async () => {
                const cwd = process.cwd();
                const result = runTourCommand(['context', ${JSON.stringify(url)}, '--dependencies', '--output', 'context.json'], cwd, ${JSON.stringify(packageRoot)}, { write() {} });
                assert.equal(result.context.pullRequest.body, 'Make the value two.');
                assert.equal(result.context.range.headOid, ${JSON.stringify(fixture.range.headOid)});
                assert.equal(result.context.range.baseRef, ${JSON.stringify(destinationOid)});
                assert.equal(result.context.range.mergeBaseOid, ${JSON.stringify(fixture.range.baseOid)});
                assert.equal(result.context.range.dirtyWorkingTreeExcluded, false);
                assert.equal(result.context.files.length, 1);
                assert.ok(result.context.dependencies);
                assert.equal(require('node:fs').existsSync('context.json'), true);
                const presentation = await startPresentation([${JSON.stringify(url)}], cwd, ${JSON.stringify(packageRoot)}, { open: false, announce: false, ignoreEnvironment: true });
                try {
                    const response = await fetch(new URL('/tour.json', presentation.url));
                    const manifest = await response.json();
                    assert.equal(manifest.title, 'Explain the value change');
                    assert.equal(manifest.sourceUrl, ${JSON.stringify(metadata.url)});
                    assert.equal(manifest.pullRequest.author, 'fixture');
                    assert.equal(manifest.range.headOid, ${JSON.stringify(fixture.range.headOid)});
                    parseChangeTourManifest(manifest);
                    assert.throws(() => parseChangeTourManifest({ ...manifest, pullRequest: { ...manifest.pullRequest, state: 'UNKNOWN' } }));
                    const explicit = buildChangeTourManifest(${JSON.stringify(fixture.root)}, {
                        headRef: ${JSON.stringify(fixture.range.headOid)}, baseRef: ${JSON.stringify(fixture.range.baseOid)},
                        pullRequest: manifest.pullRequest, title: 'Explicit title', sourceUrl: 'https://example.test/intent'
                    });
                    assert.equal(explicit.title, 'Explicit title');
                    assert.equal(explicit.sourceUrl, 'https://example.test/intent');
                } finally { presentation.server.closeAllConnections(); await new Promise(resolve => presentation.server.close(resolve)); }
            })().catch(error => { console.error(error); process.exitCode = 1; });
        `;
        execFileSync(process.execPath, ['-e', script], { cwd: scratch, timeout: 30000, stdio: 'pipe',
            env: { ...process.env, BYGONE_GH_PATH: gh, BYGONE_CACHE_DIR: path.join(scratch, 'cache'),
                GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
    } finally {
        fixture.dispose();
        fs.rmSync(scratch, { recursive: true, force: true });
    }
});
