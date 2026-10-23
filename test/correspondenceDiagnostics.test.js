const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const { buildSync } = require('esbuild');
const { correspondenceTreeFixture } = require('./correspondenceTreeFixture');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [resolve(__dirname, '../web/correspondenceDiagnostics.js')], bundle: true, write: false, format: 'esm' }).outputFiles[0].contents).toString('base64'));

test('legacy artifacts distinguish unavailable details from zero and retain navigable ambiguity', async () => {
    const { buildCorrespondenceDiagnostics } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    const groups = buildCorrespondenceDiagnostics(artifact);
    assert.equal(groups.find(g => g.category === 'syntax').count, 'details unavailable');
    const unmatched = groups.find(g => g.category === 'unmatched');
    assert.equal(unmatched.count, '4 symbols · 1 ambiguous groups');
    assert.equal(unmatched.records.filter(r => r.reason === 'no-per-symbol-explanation').length, 2);
    const ambiguous = unmatched.records.at(-1);
    assert.deepEqual(ambiguous.locations.map(l => l.symbolId), ['before-uncertain', 'after-uncertain']);
});

test('structured categories count records independently and preserve supplied unmatched reasons', async () => {
    const { buildCorrespondenceDiagnostics } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    artifact.diagnostics = { version: 1, scope: [], records: [
        { category: 'rejected', reason: 'unresolved-container', locations: [] },
        { category: 'unmatched', reason: 'no-candidate-supplied', locations: [{ symbolId: 'after-fresh_only' }] }
    ] };
    const groups = buildCorrespondenceDiagnostics(artifact);
    assert.equal(groups.find(g => g.category === 'syntax').count, '0 syntax records');
    assert.equal(groups.find(g => g.category === 'rejected').count, '1 engine records');
    const unmatched = groups.find(g => g.category === 'unmatched');
    assert.equal(unmatched.records.find(r => r.locations[0].symbolId === 'after-fresh_only').reason, 'no-candidate-supplied');
    assert.equal(unmatched.records.find(r => r.locations[0].symbolId === 'before-prior_only').reason, 'no-per-symbol-explanation');
});

test('unresolved copies link retained origins without counting accepted bindings as unmatched', async () => {
    const { buildCorrespondenceDiagnostics } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    artifact.unresolved = [{ reason: 'repeated-exact-occurrences', sourceIds: [], destinationIds: ['after-fresh_only'] }];
    const ids = ['before-kept', 'after-kept', 'after-fresh_only'];
    artifact.diagnostics = { version: 1, scope: [], records: [{
        category: 'unmatched', reason: 'repeated-exact-occurrences', message: 'Retained origins are reference points.',
        locations: ids.map(symbolId => ({ symbolId }))
    }] };
    const unmatched = buildCorrespondenceDiagnostics(artifact).find(g => g.category === 'unmatched');
    assert.equal(unmatched.count, '4 symbols · 1 ambiguous groups');
    assert.deepEqual(unmatched.records.at(-1).locations.map(l => l.symbolId), ids);
    assert.equal(unmatched.records.at(-1).message, 'Retained origins are reference points.');
    assert.equal(unmatched.records.slice(0, -1).some(r => r.locations[0].symbolId === 'before-kept'), false);
    assert.equal(unmatched.records.find(r => r.locations[0].symbolId === 'after-fresh_only').reason, 'ambiguous-symbol');
});
