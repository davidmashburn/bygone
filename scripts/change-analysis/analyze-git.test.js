const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { correspondenceFixture } = require('../../test/correspondenceFixture');
const { resolveBranchReviewRange } = require('../../out/gitComparison');
const { readSnapshots, parseArgs } = require('./analyze-git');
const { LIMITS } = require('./run-refactoring-mappings');

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

test('development command requires an explicit comparison and output', () => {
    assert.throws(() => parseArgs([]), /correspondence:analyze/);
    assert.throws(() => parseArgs(['HEAD', '--base', 'main', '--output']), /requires a value/);
    assert.throws(() => parseArgs(['--base', 'main', '--output', 'a', '--unknown']), /Unknown option/);
    assert.equal(parseArgs(['--base', 'main', '--output', 'a']).head, 'HEAD');
});
