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

test('structured diagnostics round-trip syntax, rejection endpoints, scope and parser failures without changing mappings', () => {
    const { normalizeMappings } = require('../scripts/change-analysis/refactoring-mappings');
    const before = { 'a.ts': 'const { value } = config;\nregister(() => 1);\nfunction kept() { return 1; }\n' };
    const after = { 'a.ts': before['a.ts'] + 'function fresh() { return 2; }\n' };
    const span = (files, text, name) => ({ path: 'a.ts', name, start: files['a.ts'].indexOf(text),
        end: files['a.ts'].indexOf(text) + text.length, text, sha256: hash(text), valid: true });
    const mapper = { id: 'synthetic-rejection', origins: ['continuation'],
        source: span(before, 'function kept() { return 1; }', 'kept'), destination: span(after, '() => 1', 'anonymous') };
    const analysis = normalizeMappings(before, after, { status: 'complete', mappers: [mapper] });
    analysis.scope.excluded = [{ path: 'README.md', reason: 'unsupported-language' }];
    const f = fixture({ before, after });
    try {
        const artifact = importChangeCorrespondence(f.root, { analysis }, f.range);
        const records = artifact.diagnostics.records;
        assert.equal(artifact.relations.length, analysis.relations.length);
        assert.ok(records.some(r => r.reason === 'destructured-binding' && r.locations[0].line === 1));
        assert.ok(records.some(r => r.reason === 'unmodeled-top-level-statement' && r.locations[0].line === 2));
        assert.ok(records.some(r => r.category === 'outside' && r.locations[0].path === 'README.md'));
        const rejection = records.find(r => r.category === 'rejected');
        assert.equal(rejection.producerId, mapper.id);
        assert.equal(rejection.locations[0].reason, 'resolved-container');
        assert.equal(rejection.locations[1].reason, 'container-name-mismatch');
        assert.equal(rejection.locations[1].line, 2);
        assert.ok(records.some(r => r.reason === 'no-candidate-supplied' && r.locations[0].symbolId === analysis.inventories.after.entries.find(e => e.name === 'fresh').id));
        assert.deepEqual(validateChangeCorrespondence(f.root, clone(artifact), f.range), artifact);
        const issues = clone(analysis);
        issues.issues.push({ reason: 'invalid-statement-range', mapperId: 'bad-statement', mapping: { source: { path: 'a.ts', start: 99999 }, destination: { path: 'a.ts', start: -1 } } },
            { reason: 'invalid-unmapped-range', side: 'before', span: { path: 'a.ts', start: 99999 } });
        const issueRecords = importChangeCorrespondence(f.root, { analysis: issues }, f.range).diagnostics.records.filter(r => r.category === 'problem');
        assert.deepEqual(issueRecords.map(r => r.locations.map(l => [l.side, l.path, l.start])), [
            [['before', 'a.ts', undefined], ['after', 'a.ts', undefined]], [['before', 'a.ts', undefined]]
        ]);
        const forged = clone(artifact); forged.diagnostics.records.find(r => r.category === 'syntax').locations[0].line = 999;
        assert.equal(validateChangeCorrespondence(f.root, forged, f.range).diagnostics.records.find(r => r.category === 'syntax').locations[0].line, 1);
        for (const mutate of [
            d => { d.records[0].locations[0].start = 99999; },
            d => { d.records[0].locations[0].path = '../escape'; },
            d => { d.records[0].locations[0].side = 'other'; },
            d => { d.records[0].locations[0].symbolId = 'unknown'; },
            d => { d.records[0].category = 'invented'; },
            d => { d.records[0].locations = Array(101).fill(d.records[0].locations[0]); }
        ]) { const invalid = clone(artifact); mutate(invalid.diagnostics); assert.throws(() => validateChangeCorrespondence(f.root, invalid, f.range)); }
        const legacy = clone(artifact); delete legacy.diagnostics;
        assert.equal(validateChangeCorrespondence(f.root, legacy, f.range).diagnostics, undefined);
        const excessive = clone(artifact);
        excessive.diagnostics.records = Array(401).fill({ category: 'syntax', reason: 'test', locations: Array(100).fill({ path: 'a.ts', side: 'before', start: before['a.ts'].length }) });
        assert.throws(() => validateChangeCorrespondence(f.root, excessive, f.range), /location budget/);
    } finally { f.dispose(); }
    const brokenAfter = { 'a.ts': 'function broken( {' }, broken = fixture({ before, after: brokenAfter });
    try {
        const partial = normalizeMappings(before, brokenAfter, { status: 'unavailable', reason: 'test-timeout', mappers: [], truncated: true });
        const artifact = importChangeCorrespondence(broken.root, { analysis: partial }, broken.range);
        assert.equal(artifact.status, 'partial');
        assert.ok(artifact.diagnostics.records.some(r => r.reason === 'parser-diagnostic' && r.message));
        assert.ok(artifact.diagnostics.records.some(r => r.reason === 'engine-truncated' && r.message.includes('test-timeout')));
        assert.equal(artifact.relations.length, 0);
    } finally { broken.dispose(); }
});

test('Python parser error locations preserve UTF16 columns after astral characters and CRLF', () => {
    const { normalizeMappings } = require('../scripts/change-analysis/refactoring-mappings');
    const before = { 'broken.py': 'def kept():\r\n    return 1\r\n' };
    const after = { 'broken.py': 'label = "📦"; value = / 2\r\n' };
    const f = fixture({ before, after });
    try {
        const analysis = normalizeMappings(before, after, { status: 'unavailable', reason: 'parse-preflight-failed' });
        const artifact = importChangeCorrespondence(f.root, { analysis }, f.range);
        const diagnostic = artifact.diagnostics.records.find(r => r.reason === 'parser-diagnostic');
        assert.equal(diagnostic.locations[0].start, after['broken.py'].indexOf('/'));
        assert.equal(diagnostic.locations[0].line, 1);
        assert.equal(diagnostic.locations[0].side, 'after');
        assert.equal(artifact.relations.length, 0);
    } finally { f.dispose(); }
});

test('retained variables remain navigable alongside unresolved competing copy origins', () => {
    const { normalizeMappings } = require('../scripts/change-analysis/refactoring-mappings');
    const constant = 'const START_AT = new Date(0);';
    const before = { 'a.js': constant, 'b.js': constant }, after = { 'a.js': constant, 'c.js': constant };
    const f = fixture({ before, after });
    try {
        const analysis = normalizeMappings(before, after, { status: 'complete', mappers: [] });
        const artifact = importChangeCorrespondence(f.root, { analysis }, f.range);
        assert.equal(artifact.relations.length, 1); assert.equal(artifact.unresolved.length, 1);
        assert(!artifact.unresolved[0].sourceIds.includes(artifact.relations[0].sourceId));
        assert(!artifact.unresolved[0].destinationIds.includes(artifact.relations[0].destinationId));
        const unmatched = artifact.diagnostics.records.filter(r => r.category === 'unmatched');
        assert.equal(unmatched.filter(r => r.reason === 'ambiguous-symbol').length, 2);
        const context = unmatched.find(r => r.reason === 'repeated-exact-occurrences');
        assert.equal(context.locations.length, 4);
        assert(context.locations.some(l => l.symbolId === artifact.relations[0].sourceId));
        assert.deepEqual(validateChangeCorrespondence(f.root, artifact, f.range), artifact);
    } finally { f.dispose(); }
});

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
