const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSourceRef, pinSourceRef, resolveSourceRef, relocateSourceRefs } = require('../source-references');
const { LIMITS } = require('..');

function fixture() {
    const before = { revision: 'snapshot:one', files: { 'a.js': '// 🧪\r\nfunction ok() { return true; }\r\n' } };
    const start = before.files['a.js'].indexOf('function');
    const ref = pinSourceRef(before, 'a.js', start, before.files['a.js'].length);
    return { before, ref };
}

test('public API pins exact UTF-16 slices with opaque revisions and no Git or review model', () => {
    const { before, ref } = fixture();
    assert.equal(require('..').pinSourceRef, pinSourceRef);
    assert.equal(ref.start, 7);
    assert.equal(ref.revision, 'snapshot:one');
    assert.deepEqual(resolveSourceRef(ref, before), { status: 'valid', text: 'function ok() { return true; }\r\n' });
    assert.deepEqual(Object.keys(ref).sort(), ['digest', 'end', 'path', 'revision', 'start']);
    assert.deepEqual(parseSourceRef({ ...ref, requirement: 'ignored' }), ref);
});

test('public boundaries reject malformed ranges, paths, digests, and snapshot maps', () => {
    const { before, ref } = fixture();
    for (const change of [
        { path: '/absolute' }, { path: '../parent' }, { path: 'C:/absolute' }, { path: 'a\\b' },
        { path: 'a\0b' }, { start: -1 }, { start: 0.5 }, { end: ref.start },
        { end: Infinity }, { revision: '' }, { digest: 'bad' }
    ]) {
        assert.throws(() => parseSourceRef({ ...ref, ...change }), TypeError);
        assert.throws(() => resolveSourceRef({ ...ref, ...change }, before), TypeError);
    }
    assert.throws(() => pinSourceRef(before, 'a.js', 0, 1000), /range/);
    assert.throws(() => pinSourceRef(before, 'missing', 0, 1), /unavailable/);
    assert.throws(() => pinSourceRef({ ...before, files: { 'a.js': 42 } }, 'a.js', 0, 1), /invalid-snapshot-text/);
    assert.throws(() => pinSourceRef({ ...before, files: Object.create({ inherited: 'abc' }) }, 'inherited', 0, 1), /unavailable/);
    assert.throws(() => relocateSourceRefs(Array(LIMITS.maxRecords + 1).fill(ref), before, { ...before, revision: 'two' }, []), /bounded/);
    assert.throws(() => resolveSourceRef(ref, { ...before, files: { 'a.js': 'x'.repeat(LIMITS.maxFileBytes + 1) } }), /file-byte-budget/);
});

test('missing, wrong-revision, and tampered evidence resolve as broken', () => {
    const { before, ref } = fixture();
    for (const snapshot of [
        { ...before, revision: 'different' }, { ...before, files: {} },
        { ...before, files: { 'a.js': before.files['a.js'].replace('true', 'null') } }
    ]) assert.equal(resolveSourceRef(ref, snapshot).status, 'broken');
});

test('whole-file equality carries references forward without a correspondence pair', () => {
    const { before, ref } = fixture();
    const after = { ...before, revision: 'snapshot:two' };
    const [transition] = relocateSourceRefs([ref], before, after, []);
    assert.equal(transition.status, 'unchanged');
    assert.deepEqual(transition.after, { ...ref, revision: after.revision });
    assert.equal(ref.revision, before.revision);
    assert.throws(() => relocateSourceRefs([ref], before, before, []), /distinct/);
});

test('accepted exact pairs follow moves and edits without mutating references or pairs', () => {
    const { before, ref } = fixture();
    for (const [suffix, expected] of [['true', 'relocated'], ['null', 'changed']]) {
        const after = { revision: `snapshot:${suffix}`, files: { 'moved.js': '\n' + before.files['a.js'].replace('true', suffix) } };
        const destination = pinSourceRef(after, 'moved.js', ref.start + 1, ref.end + 1);
        const pair = { before: ref, after: destination };
        const original = JSON.stringify(pair);
        const [transition] = relocateSourceRefs([ref], before, after, [pair]);
        assert.equal(transition.status, expected);
        assert.equal(resolveSourceRef(transition.after, after).status, 'valid');
        transition.after.path = 'changed-by-caller';
        transition.before.path = 'also-changed-by-caller';
        assert.equal(JSON.stringify(pair), original);
    }
});

test('unmatched, historical, and subrange references remain unresolved; no text-search fallback', () => {
    const { before, ref } = fixture();
    const after = { revision: 'two', files: { 'moved.js': before.files['a.js'] } };
    const destination = pinSourceRef(after, 'moved.js', ref.start, ref.end);
    const subrange = pinSourceRef(before, 'a.js', ref.start, ref.start + 8);
    assert.equal(relocateSourceRefs([ref], before, after, [])[0].status, 'unresolved');
    const results = relocateSourceRefs([subrange, { ...ref, revision: 'historical' }], before, after, [{ before: ref, after: destination }]);
    assert.deepEqual(results.map(r => r.status), ['unresolved', 'unresolved']);
    assert.equal('after' in results[0], false);
});

test('competing pairs and invalid endpoints are rejected even when no reference consumes them', () => {
    const { before, ref } = fixture();
    const after = { revision: 'two', files: { 'moved.js': before.files['a.js'], 'other.js': before.files['a.js'] } };
    const pair = { before: ref, after: pinSourceRef(after, 'moved.js', ref.start, ref.end) };
    const another = pinSourceRef(before, 'a.js', 0, ref.end);
    for (const pairs of [
        [pair, pair],
        [pair, { before: ref, after: pinSourceRef(after, 'other.js', ref.start, ref.end) }],
        [pair, { before: another, after: pair.after }]
    ]) assert.throws(() => relocateSourceRefs([], before, after, pairs), /Duplicate/);
    assert.throws(() => relocateSourceRefs([], before, after, [{ before: ref, after: { ...pair.after, digest: '0'.repeat(64) } }]), /endpoint/);
});
