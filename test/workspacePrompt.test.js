const assert = require('node:assert/strict');
const test = require('node:test');
const { buildWorkspacePrompt } = require('../out/workspacePrompt.js');

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

test('exact range produces a compact prompt with a local skill reference', () => {
    const prompt = buildWorkspacePrompt('historical', {
        repository: '/tmp/repo',
        paths: ['src/index.ts', 'docs/tour.md'],
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    }, { path: '/tmp/bygone-tour-skill.md' });

    assert.equal(prompt.split('\n').length, 7);
    assert.match(prompt, /Read and follow the Bygone tour skill at "\/tmp\/bygone-tour-skill\.md"\./);
    assert.match(prompt, /Create a v4 historical tour\./);
    assert.match(prompt, /Repository: "\/tmp\/repo"/);
    assert.match(prompt, /Selected paths: \["src\/index\.ts","docs\/tour\.md"\]/);
    assert.match(prompt, new RegExp(`Base: "${BASE}"`));
    assert.match(prompt, new RegExp(`Head: "${HEAD}"`));
    assert.match(prompt, /Additional context: \(optional\)/);
    assert.doesNotMatch(prompt, /bygone tour context|tour schema|tour validate|synthetic explanatory/);
});

test('missing skill path uses the attached default or supplied filename', () => {
    const defaultPrompt = buildWorkspacePrompt('deconstructed', {});
    const namedPrompt = buildWorkspacePrompt('deconstructed', {}, { name: 'tour-skill.md' });

    assert.match(defaultPrompt, /Read and follow the Bygone tour skill in attached "bygone-tour-skill\.md"\./);
    assert.match(namedPrompt, /Read and follow the Bygone tour skill in attached "tour-skill\.md"\./);
    assert.match(defaultPrompt, /Create a v4 deconstructed tour\./);
});

test('repository and scope paths are JSON-quoted without newline ambiguity', () => {
    const repository = '/tmp/repo with "quotes"/line\nbreak ';
    const paths = ['src/odd name.ts ', 'docs/line\nbreak.md'];
    const prompt = buildWorkspacePrompt('historical', {
        repository,
        paths,
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });

    assert.match(prompt, new RegExp(`Repository: ${escapeRegExp(JSON.stringify(repository))}`));
    assert.match(prompt, new RegExp(`Selected paths: ${escapeRegExp(JSON.stringify(paths))}`));
    assert.doesNotMatch(prompt, /Repository: .*line\nbreak/);
});

test('explicit repository root scope is distinct from unknown scope', () => {
    const rootPrompt = buildWorkspacePrompt('historical', {
        repository: '/repo',
        paths: [],
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });
    const unknownPrompt = buildWorkspacePrompt('historical', {
        repository: '/repo',
        revisions: [BASE, HEAD],
        rangeStatus: 'exact'
    });

    assert.match(rootPrompt, /Selected paths: \["\."\]/);
    assert.match(unknownPrompt, /Selected paths: null/);
    assert.notEqual(rootPrompt, unknownPrompt);
});

for (const rangeStatus of ['none', 'multiple', 'uncommitted', 'reversed', 'divergent', 'unavailable']) {
    test(`nonexact status ${rangeStatus} warns and reports all revisions`, () => {
        const revisions = [BASE, HEAD, 'third-revision'];
        const prompt = buildWorkspacePrompt('historical', {
            repository: '/repo',
            paths: ['src/app.ts'],
            revisions,
            rangeStatus
        });

        assert.equal(prompt.split('\n').length, 9);
        assert.match(prompt, new RegExp(`Warning: range status "${rangeStatus}"`));
        assert.match(prompt, /choose revisions in Compare/);
        assert.match(prompt, /merge-base/);
        assert.match(prompt, /swap endpoints/);
        assert.match(prompt, /drop revisions/);
        assert.match(prompt, new RegExp(`All revisions: ${escapeRegExp(JSON.stringify(revisions))}`));
        assert.match(prompt, /Base: null/);
        assert.match(prompt, /Head: null/);
    });
}

test('exact status is still nonexact when repository or full OIDs are missing', () => {
    const cases = [
        { repository: undefined, revisions: [BASE, HEAD] },
        { repository: '/repo', revisions: ['short-base', HEAD] },
        { repository: '/repo', revisions: [BASE, HEAD, 'extra'] }
    ];

    for (const { repository, revisions } of cases) {
        const prompt = buildWorkspacePrompt('historical', {
            repository,
            revisions,
            rangeStatus: 'exact'
        });

        assert.match(prompt, /Warning: range status "exact"/);
        assert.match(prompt, /choose revisions in Compare/);
        assert.match(prompt, /Base: null/);
        assert.match(prompt, /Head: null/);
        assert.match(prompt, new RegExp(`All revisions: ${escapeRegExp(JSON.stringify(revisions))}`));
    }
});

test('missing range status also withholds guessed endpoints', () => {
    const prompt = buildWorkspacePrompt('historical', {
        repository: '/repo',
        paths: ['src/app.ts'],
        revisions: [BASE, HEAD]
    });

    assert.match(prompt, /Warning: range status "unavailable"/);
    assert.match(prompt, /choose revisions in Compare/);
    assert.match(prompt, /All revisions: \["[a-f]{40}","[b]{40}"\]/);
    assert.match(prompt, /Base: null/);
    assert.match(prompt, /Head: null/);
});

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
