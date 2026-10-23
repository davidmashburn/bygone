const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { digest } = require('./symbol-inventory');
const { validateSpan } = require('./refactoring-mappings');
const root = __dirname;
let relations = 0, mappings = 0;
for (const [manifestName, reportName] of [
    ['manifest.json', 'refactoring-mappings-corpus-2026-10-22.json'],
    ['diagnostics.json', 'refactoring-mappings-diagnostics-2026-10-22.json']
]) {
    const input = fs.readFileSync(path.join(root, 'semantic-corpus', manifestName));
    const manifest = JSON.parse(input);
    const report = JSON.parse(fs.readFileSync(path.join(root, 'results', reportName)));
    assert.equal(report.manifestSha256, digest(input));
    assert.equal(report.bridgeSha256, digest(fs.readFileSync(path.join(root, 'refactoring-miner/BygoneMappingsBridge.java'), 'utf8')));
    assert.equal(report.cases.length, manifest.cases.length);
    for (const c of report.cases) {
        const fixture = manifest.cases.find(f => f.id === c.id), a = c.analysis;
        const entries = new Map([...a.inventories.before.entries, ...a.inventories.after.entries].map(e => [e.id, e]));
        const sourceIds = new Set(), destinationIds = new Set();
        for (const side of ['before', 'after']) for (const e of a.inventories[side].entries) {
            assert.equal(e.digest, digest(fixture[side][e.path].slice(e.start, e.end)));
        }
        for (const r of a.relations) {
            assert.equal(r.behavior, 'unassessed');
            assert(!sourceIds.has(r.sourceId)); sourceIds.add(r.sourceId);
            assert(!destinationIds.has(r.destinationId)); destinationIds.add(r.destinationId);
            const source = entries.get(r.sourceId), destination = entries.get(r.destinationId);
            assert.equal(r.localDiff.filter(p => !p.added).map(p => p.value).join(''), fixture.before[source.path].slice(source.start, source.end));
            assert.equal(r.localDiff.filter(p => !p.removed).map(p => p.value).join(''), fixture.after[destination.path].slice(destination.start, destination.end));
            relations++;
            for (const evidence of r.evidence) {
                assert(validateSpan(evidence.source, fixture.before)); assert(validateSpan(evidence.destination, fixture.after));
                for (const mapping of evidence.mappings) {
                    assert(validateSpan(mapping.source, fixture.before)); assert(validateSpan(mapping.destination, fixture.after)); mappings++;
                }
                for (const span of evidence.unmappedBefore) assert(validateSpan(span, fixture.before));
                for (const span of evidence.unmappedAfter) assert(validateSpan(span, fixture.after));
            }
        }
        assert.equal(sourceIds.size + a.unmatchedBefore.length, a.inventories.before.entries.length);
        assert.equal(destinationIds.size + a.unmatchedAfter.length, a.inventories.after.entries.length);
        for (const group of a.groups) {
            assert.equal(group.behavior, 'unassessed');
            assert(entries.has(group.sourceId)); assert(entries.has(group.destinationId));
        }
        assert.equal(a.issues.length, 0, c.id);
        if (c.id === 'control-10') { assert.equal(a.status, 'partial'); assert.equal(c.native.reason, 'parse-preflight-failed'); }
        if (['control-04', 'control-05', 'control-06', 'control-07', 'mixed-10'].includes(c.id)) {
            assert.equal(a.relations.filter(r => r.pathChanged || r.nameChanged).length, 0, c.id);
        }
    }
}
console.log(`32 comparisons reconcile; ${relations} local diffs reconstruct both slices; ${mappings} attached statement mappings validate against input bytes`);
