const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWorkspacePrompt } = require('../out/workspacePrompt.js');

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

test('exact two-revision context includes a safely quoted bounded command', () => {
    const prompt = buildWorkspacePrompt('historical', {
        repository: "/tmp/repo with spaces/it's-a-repo",
        paths: ['src/index.ts', 'docs/tour.md'],
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });

    assert.match(prompt, /Repository: \/tmp\/repo with spaces\/it's-a-repo/);
    assert.match(prompt, /Selected paths\/directories: src\/index\.ts, docs\/tour\.md/);
    assert.match(prompt, /cd -- '\/tmp\/repo with spaces\/it'\\''s-a-repo'/);
    assert.match(prompt, new RegExp(`bygone tour context ${HEAD} --base ${BASE}`));
    assert.match(prompt, /known ancestor of head/);
    assert.match(prompt, /has no path filter/);
    assert.match(prompt, /bygone tour schema/);
    assert.match(prompt, /bygone tour validate <file\.bygone> --json/);
});

test('exact status without a repository or full OIDs withholds context execution', () => {
    const prompt = buildWorkspacePrompt('historical', {
        revisions: ['short-base', HEAD],
        rangeStatus: 'exact'
    });

    assert.doesNotMatch(prompt, /bygone tour context .*--base/);
    assert.match(prompt, /exactly two full OIDs and a repository/);
    assert.match(prompt, /Choose revisions in Compare/);
});

test('multiple revisions remain visible and require a deliberate Compare choice', () => {
    const third = 'c'.repeat(40);
    const prompt = buildWorkspacePrompt('deconstructed', {
        repository: '/repo',
        paths: ['src/feature.ts'],
        revisions: [BASE, HEAD, third],
        rangeStatus: 'multiple'
    });

    assert.match(prompt, new RegExp(`Reported revisions: ${BASE}, ${HEAD}, ${third}`));
    assert.match(prompt, /do not silently drop intermediate or unrelated revisions/);
    assert.match(prompt, /synthetic explanatory stages/);
    assert.match(prompt, /Never present a synthetic stage as a commit/);
    assert.doesNotMatch(prompt, /bygone tour context .*--base/);
});

test('an explicitly resolved repository with an empty path list names the repository root', () => {
    const prompt = buildWorkspacePrompt('historical', {
        repository: '/repo',
        paths: [],
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });

    assert.match(prompt, /Selected paths\/directories: \. \(repository root; full requested scope\)/);
});

test('an empty path list without a repository stays unresolved', () => {
    const prompt = buildWorkspacePrompt('historical', {
        paths: [],
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });

    assert.match(prompt, /Selected paths\/directories: \(not supplied; keep the requested scope explicit\)/);
});

for (const rangeStatus of ['none', 'uncommitted', 'reversed', 'divergent', 'unavailable']) {
    test(`missing range status ${rangeStatus} keeps placeholders and names Compare`, () => {
        const prompt = buildWorkspacePrompt('historical', {
            repository: '/repo',
            paths: ['src/app.ts'],
            revisions: [BASE, HEAD],
            rangeStatus,
            reason: 'host could not prove the requested range'
        });

        assert.doesNotMatch(prompt, /bygone tour context .*--base/);
        assert.match(prompt, /placeholders|committed boundaries|endpoints|WORKTREE|ancestor/);
        assert.match(prompt, /Choose revisions in Compare/);
    });
}
