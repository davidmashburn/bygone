const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { correspondenceFixture } = require('./correspondenceFixture');
const { importChangeCorrespondence } = require('../out/changeCorrespondence');
const { normalizeMappings } = require('../scripts/change-analysis/refactoring-mappings');
const {
    buildTourRevisionImpactReport: build,
    TOUR_REVISION_IMPACT_STATUS: Status,
    TOUR_REVISION_IMPACT_REASON: Reason,
    TOUR_REVISION_IMPACT_REFERENCE_SCOPE: Scope,
    TOUR_REVISION_IMPACT_REFERENCE_ROLE: Role,
    TOUR_REVISION_IMPACT_MODE: Mode
} = require('../out/tourRevisionImpact');

const anchor = (file, excerpt, line = 1) => ({ path: file, revision: 'head', startLine: line, endLine: line, excerpt });
const step = (id, focus, connection) => ({ id, focus, ...(connection ? { connection } : {}) });
const scene = steps => ({ id: 'explanation', kind: 'walkthrough', steps });
const manifest = (f, steps) => ({ range: { mergeBaseOid: f.range.baseOid, headOid: f.range.baseOid }, scenes: [scene(steps)] });
const report = (f, doc, options = {}) => build(doc, f.root, { newHeadRef: f.range.headOid, ...options });
const hash = text => createHash('sha256').update(text).digest('hex');

function correspondence(f, before, after, mappings) {
    const span = (files, file, name) => ({ path: file, name, start: 0, end: files[file].length,
        text: files[file], sha256: hash(files[file]), valid: true });
    const analysis = normalizeMappings(before, after, { status: 'complete', mappers: mappings.map(([oldFile, newFile, name], index) => ({
        id: `mapping-${index}`, origins: ['continuation'], source: span(before, oldFile, name), destination: span(after, newFile, name)
    })) });
    const artifact = importChangeCorrespondence(f.root, { analysis }, f.range);
    assert.equal(artifact.relations.length, mappings.length);
    const file = path.join(f.root, 'correspondence.json');
    fs.writeFileSync(file, JSON.stringify(artifact));
    return file;
}

test('unchanged evidence stays pinned; supporting changes and uncovered hunks remain independent', () => {
    const before = { 'focus.ts': 'function focus() { return 1; }', 'support.txt': 'old\n', 'multi.txt': 'first\n' + 'gap\n'.repeat(12) + 'last\n' };
    const after = { ...before, 'support.txt': 'new\n', 'multi.txt': 'FIRST\n' + 'gap\n'.repeat(12) + 'LAST\n', 'new.txt': 'new work\n' };
    const f = correspondenceFixture({ before, after });
    try {
        const focus = anchor('focus.ts', 'return 1');
        const doc = manifest(f, [step('focus', focus, { from: focus, to: anchor('support.txt', 'old') }),
            step('first', anchor('multi.txt', 'first')), step('overlap', focus)]);
        const original = JSON.stringify(doc);
        const result = report(f, doc);
        const refs = result.observations[0].references;
        assert.equal(refs[0].status, Status.UNCHANGED);
        assert.equal(refs[0].newRef.revision, f.range.headOid);
        assert.equal(refs[2].role, Role.CONNECTION_TO);
        assert.equal(refs[2].status, Status.INCOMPLETE);
        assert.equal(refs[2].reason, Reason.NO_ACCEPTED_CORRESPONDENCE);
        assert.equal(result.observations[0].incomplete, true);
        assert.equal(result.observations[2].references[0].status, Status.UNCHANGED);
        assert.deepEqual(result.uncoveredChanges.map(change => change.path).sort(), ['multi.txt', 'new.txt']);
        assert.equal(result.uncoveredChanges.find(change => change.path === 'multi.txt').hunks.length, 1);
        assert.equal(result.uncoveredChanges.find(change => change.path === 'multi.txt').hunks[0].baseStart, 14);
        assert.equal(JSON.stringify(doc), original);
        assert.deepEqual(report(f, doc), result);
        assert.equal(result.needsRenewedInspection, true);
    } finally { f.dispose(); }
});

test('validated exact correspondence distinguishes moves and edits, including coverage at the new path', () => {
    const before = { 'old.ts': 'function moved() { return 1; }', 'edit.ts': 'function edited() { return 1; }' };
    const after = { 'new.ts': before['old.ts'], 'edit.ts': 'function edited() { return 2; }' };
    const f = correspondenceFixture({ before, after });
    try {
        const correspondencePath = correspondence(f, before, after, [['old.ts', 'new.ts', 'moved'], ['edit.ts', 'edit.ts', 'edited']]);
        const result = report(f, manifest(f, [step('move', anchor('old.ts', before['old.ts'])), step('edit', anchor('edit.ts', before['edit.ts']))]), { correspondencePath });
        const [moved, edited] = result.observations.map(item => item.references[0]);
        assert.equal(moved.status, Status.RELOCATED);
        assert.equal(moved.newRef.path, 'new.ts');
        assert.equal(moved.newRef.digest, moved.oldRef.digest);
        assert.equal(edited.status, Status.CHANGED);
        assert.notEqual(edited.oldRef.digest, edited.newRef.digest);
        assert.equal(result.uncoveredChanges.length, 0);
        assert.equal(result.correspondence.acceptedPairs, 2);
        assert.equal(result.needsRenewedInspection, true);
    } finally { f.dispose(); }
});

test('deleted evidence is missing; unavailable and mismatched evidence is explicitly incomplete', () => {
    const f = correspondenceFixture({ before: { 'gone.txt': 'gone', 'keep.txt': 'keep' }, after: { 'keep.txt': 'keep', 'new.txt': 'new' } });
    try {
        const result = report(f, manifest(f, [step('deleted', anchor('gone.txt', 'gone')), step('absent', anchor('absent.txt', 'absent')),
            step('mismatch', anchor('keep.txt', 'wrong')), step('range', anchor('keep.txt', 'keep', 10))]));
        assert.equal(result.observations[0].references[0].status, Status.MISSING);
        assert.equal(result.observations[0].references[0].newRef, undefined);
        assert.deepEqual(result.observations.slice(1).map(item => item.references[0].reason),
            [Reason.MISSING_SOURCE, Reason.EXCERPT_MISMATCH, Reason.INVALID_LINE_RANGE]);
        assert.ok(result.incomplete.every(item => item.mode === Mode.HISTORICAL && item.sceneId && item.stepId));
        assert.equal(result.uncoveredChanges.some(change => change.path === 'gone.txt'), false);
    } finally { f.dispose(); }
});

test('authored modes keep historical and synthetic evidence separate with stable step links', () => {
    const f = correspondenceFixture({ before: { 'a.txt': 'old' }, after: { 'a.txt': 'new' } });
    try {
        const doc = manifest(f, [step('ignored-root', anchor('a.txt', 'old'))]);
        const historical = step('history', { ...anchor('a.txt', 'old'), revision: 'base' });
        doc.tours = { [Mode.HISTORICAL]: { scenes: [scene([historical])] }, [Mode.DECONSTRUCTED]: { scenes: [{
            id: 'synthetic', kind: 'deconstructed-diff', panels: [{ id: 'a' }, { id: 'b' }],
            files: [{ path: 'a.txt', panels: [{ exists: true }, { exists: true }] }],
            steps: [{ id: 'reason', file: 'a.txt', pairIndex: 0, side: 'right', startLine: 1, endLine: 1 }]
        }] } };
        const result = report(f, doc);
        assert.deepEqual(result.observations.map(item => item.mode), [Mode.HISTORICAL, Mode.DECONSTRUCTED]);
        assert.equal(result.observations[0].references[0].scope, Scope.BASELINE);
        assert.equal(result.observations[0].references[0].newRef, undefined);
        assert.equal(result.observations[1].references[0].scope, Scope.SYNTHETIC);
        assert.equal(result.observations[1].references[0].reason, Reason.SYNTHETIC_REFERENCE);
        assert.match(result.observations[1].fragment, /reason/);
    } finally { f.dispose(); }
});

test('same-head checks preserve the snapshot and invalid or non-descendant revisions fail closed', () => {
    const f = correspondenceFixture({ before: { 'a.txt': 'old' }, after: { 'a.txt': 'new' } });
    try {
        const doc = manifest(f, [step('same', anchor('a.txt', 'old'))]);
        const same = build(doc, f.root, { newHeadRef: f.range.baseOid });
        assert.equal(same.observations[0].references[0].status, Status.UNCHANGED);
        assert.deepEqual(same.uncoveredChanges, []);
        const later = { ...doc, range: { mergeBaseOid: f.range.baseOid, headOid: f.range.headOid } };
        assert.throws(() => build(later, f.root, { newHeadRef: f.range.baseOid }), /must descend/);
        assert.throws(() => build(doc, f.root, { newHeadRef: '0'.repeat(40) }));
        assert.throws(() => report(f, { ...doc, range: { ...doc.range, headOid: 'HEAD' } }), /full Git commit ID/);
    } finally { f.dispose(); }
});

test('relocation budgets preserve pinned observations and report incomplete analysis', () => {
    const before = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`file${index}.txt`, 'same text']));
    const f = correspondenceFixture({ before, after: { ...before, 'new.txt': 'new evidence' } });
    try {
        const doc = manifest(f, Object.keys(before).map((path, index) => step(`step${index}`, anchor(path, before[path]))));
        const original = JSON.stringify(doc);
        const result = report(f, doc);
        assert.equal(result.observations.length, 51);
        for (const [index, observation] of result.observations.entries()) {
            assert.equal(observation.stepId, `step${index}`);
            assert.equal(observation.incomplete, true);
            const reference = observation.references[0];
            assert.equal(reference.status, Status.INCOMPLETE);
            assert.equal(reference.reason, Reason.REFERENCE_RELOCATION_UNAVAILABLE);
            assert.equal(reference.oldRef.revision, f.range.baseOid);
            assert.equal(reference.newRef, undefined);
        }
        assert.equal(result.incomplete.length, 51);
        assert.deepEqual(result.uncoveredChanges.map(change => change.path), ['new.txt']);
        assert.equal(JSON.stringify(doc), original);
    } finally { f.dispose(); }
});

test('replacement refs cannot hide uncovered changes in the pinned comparison', () => {
    const f = correspondenceFixture({
        before: { 'keep.txt': 'same', 'change.txt': 'old' },
        after: { 'keep.txt': 'same', 'change.txt': 'new' }
    });
    try {
        const doc = manifest(f, [step('keep', anchor('keep.txt', 'same'))]);
        const expected = report(f, doc);
        assert.deepEqual(expected.uncoveredChanges.map(change => change.path), ['change.txt']);
        assert.equal(expected.uncoveredChanges[0].hunks.length, 1);
        execFileSync('git', ['replace', f.range.baseOid, f.range.headOid], { cwd: f.root });
        assert.deepEqual(report(f, doc), expected);
    } finally { f.dispose(); }
});
