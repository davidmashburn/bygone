const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileBridge, analyzeWithBridge } = require('./run-refactoring-mappings');
const config = compileBridge({ java: process.env.MAPPING_JAVA, jar: process.env.MAPPING_JAR });
const code = 'export function price(n) { return n + 1; }\n';
const next = code.replace('+ 1', '+ 2');
const before = { 'a.ts': code + 'export function anchorA() { return "source"; }' , 'b.ts': 'export function anchorB() { return 991; }' };
const after = { 'a.ts': 'export function anchorA() { return "source"; }', 'b.ts': next + 'export function anchorB() { return 991; }' };

test('actual JVM timeout preserves inventory and returns an explicit failure', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { timeoutMs: 1 } });
    assert.equal(result.native.reason, 'engine-timeout');
    assert.equal(result.analysis.status, 'partial');
    assert(result.analysis.inventories.before.entries.length > 0);
    assert(result.analysis.relations.every(r => !r.producers.includes('refactoring-miner')));
});

test('export budget marks partial evidence rather than promoting candidates', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { maxRecords: 1 } });
    assert.equal(result.native.status, 'partial'); assert.equal(result.native.truncated, true);
    assert.equal(result.analysis.status, 'partial');
    assert(result.analysis.relations.every(r => !r.producers.includes('refactoring-miner') || r.producers.includes('exact-declaration')));
});

test('bounded stdout overflow preserves independent inventory', () => {
    const result = analyzeWithBridge(before, after, { ...config, limits: { maxOutputBytes: 128 } });
    assert.equal(result.native.status, 'unavailable');
    assert.equal(result.native.reason, 'engine-process: ENOBUFS');
    assert.equal(result.analysis.inventories.after.documents.length, 2);
});

test('real module rewrite retains the removed assessment validation as visible evidence', () => {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'results/refactoring-mappings-diagnostics-2026-10-22.json')));
    const result = report.cases.find(c => c.id === 'diagnostic-public-tour-details');
    const a = result.analysis;
    const entries = new Map([...a.inventories.before.entries, ...a.inventories.after.entries].map(e => [e.id, e]));
    const moved = a.relations.filter(r => r.pathChanged && entries.get(r.sourceId).callable && r.producers.includes('refactoring-miner'));
    assert.equal(moved.length, 6);
    const r = moved.find(r => entries.get(r.sourceId).name === 'validateChangeTourDetails');
    assert(r); assert.equal(r.rawEqual, false); assert.equal(r.behavior, 'unassessed');
    const removed = r.localDiff.filter(p => p.removed).map(p => p.value).join('');
    assert(removed.includes('validateAssessment(value.assessment'));
    assert(r.evidence.some(e => e.unmappedBefore.some(s => s.text.includes('validateAssessment(value.assessment'))));
});
