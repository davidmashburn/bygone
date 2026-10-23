const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { importChangeCorrespondence, validateChangeCorrespondence, loadChangeCorrespondence, readCorrespondenceJson } = require('../out/changeCorrespondence');
const { buildChangeTourContext } = require('../out/changeTour');
const { importCorrespondenceCommand } = require('../cli/correspondence');
const { runTourCommand, parseTourArgs } = require('../cli/tour');
const { startPresentation, parsePresentArgs } = require('../cli/present');
const source = require('./fixtures/correspondence-module-split.json');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const { correspondenceFixture: fixture } = require('./correspondenceFixture');
const silent = { write() {} };

test('real split exposes six moved declarations and complete residual validation changes', () => {
    const f = fixture();
    try {
        const artifact = importChangeCorrespondence(f.root, source, f.range);
        assert.equal(artifact.relations.length, 6);
        assert.ok(artifact.relations.every(r => r.pathChanged && r.behavior === 'unassessed'));
        const id = artifact.symbols.before.find(e => e.name === 'validateChangeTourDetails').id;
        const relation = artifact.relations.find(r => r.sourceId === id);
        assert.match(relation.localDiff.filter(p => p.removed).map(p => p.value).join(''), /validateAssessment\(value.assessment/);
        const a = artifact.symbols.before.find(s => s.id === relation.sourceId).text;
        const b = artifact.symbols.after.find(s => s.id === relation.destinationId).text;
        assert.equal(relation.localDiff.filter(p => !p.added).map(p => p.value).join(''), a);
        assert.equal(relation.localDiff.filter(p => !p.removed).map(p => p.value).join(''), b);
        const file = path.join(f.root, 'artifact.json'); fs.writeFileSync(file, JSON.stringify(artifact));
        const plain = buildChangeTourContext(f.root, { baseRef: f.range.baseOid });
        const context = buildChangeTourContext(f.root, { baseRef: f.range.baseOid, correspondencePath: file });
        assert.deepEqual(context.files, plain.files); assert.deepEqual(context.summary, plain.summary);
        assert.equal(context.correspondence.relations.length, 6);
    } finally { f.dispose(); }
});

test('stale revisions, changed source hashes, forged slices, missing symbols and conflicting continuations fail closed', () => {
    const f = fixture();
    try {
        const original = importChangeCorrespondence(f.root, source, f.range);
        for (const mutate of [
            a => { a.range.headOid = f.range.baseOid; },
            a => { a.documents.before[0].digest = '0'.repeat(64); },
            a => { a.symbols.before[0].start += 1; },
            a => { a.relations[0].destinationId = 'invented'; },
            a => { a.relations.push({ ...a.relations[0], id: 'duplicate-source' }); },
            a => { a.documents.before[0].path = '../outside.ts'; },
            a => { a.documents.before[0].status = 'invalid'; }
        ]) { const artifact = clone(original); mutate(artifact); assert.throws(() => validateChangeCorrespondence(f.root, artifact, f.range)); }
        const altered = clone(original); altered.symbols.before[0].text = 'invented'; altered.relations[0].localDiff = [{ value: 'invented' }];
        const rebuilt = validateChangeCorrespondence(f.root, altered, f.range);
        assert.notEqual(rebuilt.symbols.before[0].text, 'invented');
        assert.notEqual(rebuilt.relations[0].localDiff[0].value, 'invented');
    } finally { f.dispose(); }
});

test('partial results do not promote engine candidates and ambiguity is retained without arbitrary pairing', () => {
    const f = fixture();
    try {
        const input = clone(source); input.analysis.status = 'partial';
        const partial = importChangeCorrespondence(f.root, input, f.range);
        assert.equal(partial.status, 'partial');
        assert.equal(partial.relations.length, 3);
        assert.ok(partial.relations.every(r => r.producers.includes('exact-declaration') && r.rawEqual));
        const ambiguous = clone(source), first = ambiguous.analysis.relations.shift();
        ambiguous.analysis.unresolved = [{ reason: 'competing-origins', sources: [first.sourceId], destinations: [first.destinationId] }];
        const result = importChangeCorrespondence(f.root, ambiguous, f.range);
        assert.deepEqual(result.unresolved[0].sourceIds, [first.sourceId]);
        assert.equal(result.relations.length, 5);
        ambiguous.analysis.relations.push(first);
        assert.throws(() => importChangeCorrespondence(f.root, ambiguous, f.range), /Ambiguous/);
    } finally { f.dispose(); }
});

test('UTF16 ranges preserve CRLF, emoji and exact declaration boundaries', () => {
    const input = clone(source), prefix = '// 😀 boundary\r\n';
    for (const side of ['before', 'after']) {
        const originals = { ...input[side] };
        for (const [name, text] of Object.entries(originals)) input[side][name] = prefix + text.replace(/\n/g, '\r\n');
        for (const doc of input.analysis.inventories[side].documents) doc.digest = hash(input[side][doc.path]);
        for (const entry of input.analysis.inventories[side].entries) {
            const old = originals[entry.path];
            entry.start = prefix.length + old.slice(0, entry.start).replace(/\n/g, '\r\n').length;
            entry.end = prefix.length + old.slice(0, entry.end).replace(/\n/g, '\r\n').length;
            entry.digest = hash(input[side][entry.path].slice(entry.start, entry.end));
        }
    }
    const f = fixture(input);
    try {
        const artifact = importChangeCorrespondence(f.root, input, f.range);
        for (const side of ['before', 'after']) for (const symbol of artifact.symbols[side]) {
            const text = input[side][symbol.path];
            assert.equal(hash(symbol.text), symbol.digest);
            assert.equal(symbol.text, text.slice(symbol.start, symbol.end));
            assert.equal(symbol.startLine, text.slice(0, symbol.start).split('\n').length);
        }
    } finally { f.dispose(); }
});

test('CLI imports an explicitly selected report case and both consumers validate the same artifact', async () => {
    const f = fixture(); let presentation;
    try {
        const report = path.join(f.root, 'report.json'), artifactPath = path.join(f.root, 'artifact.json');
        fs.writeFileSync(report, JSON.stringify({ cases: [{ id: 'split', ...source }] }));
        assert.throws(() => importCorrespondenceCommand(['import', report, '--output', artifactPath], f.root, silent), /--case/);
        importCorrespondenceCommand(['import', report, '--case', 'split', '--base', f.range.baseOid, '--output', artifactPath], f.root, silent);
        assert.equal(loadChangeCorrespondence(f.root, artifactPath, f.range).relations.length, 6);
        assert.equal(parseTourArgs(['context', '--correspondence', artifactPath]).correspondencePath, artifactPath);
        assert.equal(parsePresentArgs(['--correspondence', artifactPath]).correspondencePath, artifactPath);
        const result = runTourCommand(['context', '--base', f.range.baseOid, '--correspondence', artifactPath], f.root, path.resolve(__dirname, '..'), silent);
        assert.equal(result.context.correspondence.relations.length, 6);
        presentation = await startPresentation(['--base', f.range.baseOid, '--correspondence', artifactPath], f.root, path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        const response = await fetch(new URL('/correspondence.json', presentation.url));
        const served = await response.json(); assert.equal(response.status, 200); assert.equal(served.relations.length, 6);
        assert.equal(served.range.headOid, f.range.headOid);
        assert.ok(presentation.url.includes('correspondence=1'));
        const manifest = await (await fetch(new URL('/tour.json', presentation.url))).json();
        assert.equal(manifest.files.length, 2); // Complete raw files remain independently available.
        const html = await (await fetch(presentation.url)).text(); assert.match(html, /correspondence-list/);
    } finally { if (presentation) await new Promise(resolve => presentation.server.close(resolve)); f.dispose(); }
});

test('oversized or malformed artifacts are rejected before any Git lookup', () => {
    const f = fixture();
    try {
        const file = path.join(f.root, 'oversized.json');
        fs.writeFileSync(file, ''); fs.truncateSync(file, 16 * 1024 * 1024 + 1);
        assert.throws(() => readCorrespondenceJson(file), /exceeds 16 MiB/);
        fs.writeFileSync(file, '{'); assert.throws(() => readCorrespondenceJson(file), SyntaxError);
        assert.throws(() => validateChangeCorrespondence(f.root, null, f.range), /Invalid correspondence object/);
        const artifact = importChangeCorrespondence(f.root, source, f.range);
        artifact.documents.before = Array(129).fill(artifact.documents.before[0]);
        assert.throws(() => validateChangeCorrespondence(f.root, artifact, f.range), /over-budget/);
    } finally { f.dispose(); }
});
