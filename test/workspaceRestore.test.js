const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { normalizeWindowState } = require('../standalone/windowState.js');

const FIRST = 'a'.repeat(40);
const SECOND = 'b'.repeat(40);
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'standalone', 'main.js'), 'utf8');

test('window-state normalization retains read-only capability and materialized Git pins', () => {
    const state = normalizeWindowState({
        version: 1,
        main: {
            source: {
                kind: 'git-refs',
                repoRoot: '/tmp/project',
                refs: ['moving', 'WORKTREE', 'HEAD'],
                readOnly: true,
                resolvedRevisions: [FIRST, 'WORKTREE', SECOND]
            }
        },
        tours: []
    });

    assert.deepEqual(state.main.source, {
        kind: 'git-refs',
        repoRoot: '/tmp/project',
        refs: ['moving', 'WORKTREE', 'HEAD'],
        readOnly: true,
        resolvedRevisions: [FIRST, 'WORKTREE', SECOND]
    });
});

test('invalid persisted pins do not become an implicit ref selection', () => {
    const state = normalizeWindowState({
        version: 1,
        main: {
            source: {
                kind: 'branch-review',
                repoRoot: '/tmp/project',
                headRef: 'feature',
                baseRef: 'main',
                resolvedRevisions: ['moving']
            }
        },
        tours: []
    });

    assert.equal(state, null);
});

test('Git restore and refresh paths distinguish pins from symbolic refs', () => {
    assert.match(mainSource, /const refs = Array\.isArray\(source\.resolvedRevisions\)/);
    assert.match(mainSource, /resolvedRevisions: resolved\.map\(\(revision\) =>/);
    assert.match(mainSource, /const pinned = Array\.isArray\(source\.resolvedRevisions\)/);
    assert.match(mainSource, /resolveBranchReviewRange\(source\.repoRoot, pinned\[1\], pinned\[0\]\)/);
    assert.match(mainSource, /resolvedRevisions: \[review\.mergeBaseOid, review\.headOid\]/);
    assert.match(mainSource, /if \(source\.kind === 'git-refs' \|\| source\.kind === 'branch-review'\) \{[\s\S]{0,220}delete source\.resolvedRevisions;/);
});
