const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOutput } = require('./validate-output');
const before = { 'a.ts': 'function f() { return 1; }' }, after = { 'b.ts': 'function f() { return 2; }' };
const evidence = { inventory: { before: [{ id: 'b0', path: 'a.ts', start: 0, end: 26 }], after: [{ id: 'a0', path: 'b.ts', start: 0, end: 26 }] }, correspondences: [{ source: 'b0', destination: 'a0' }], groups: [] };
const valid = () => ({ behavior: 'unassessed', operations: [{ type: 'Move Method', sourceIds: ['b0'], destinationIds: ['a0'], explanation: 'Moved with a literal edit.', evidence: [{ side: 'before', path: 'a.ts', quote: 'return 1;', symbolId: 'b0' }, { side: 'after', path: 'b.ts', quote: 'return 2;', symbolId: 'a0' }] }], additionalEdits: [], uncertainties: [] });
test('valid evidence remains a proposal with mapping support, not a proof of the label', () => {
    const r = validateOutput(JSON.stringify(valid()), before, after, evidence);
    assert.equal(r.valid, true); assert.equal(r.proposals[0].hasMappingSupport, true);
});
test('invented quote, ID, or file outside search scope is rejected', () => {
    for (const mutation of [v => v.operations[0].evidence[0].quote = 'return 9;', v => v.operations[0].sourceIds = ['b999'], v => v.operations[0].evidence[0].path = 'unseen.ts']) {
        const v = valid(); mutation(v); assert.equal(validateOutput(JSON.stringify(v), before, after, evidence).valid, false);
    }
});
test('well-cited endpoints without a matching hint remain unsupported proposals', () => {
    const r = validateOutput(JSON.stringify(valid()), before, after, { ...evidence, correspondences: [] });
    assert.equal(r.valid, true); assert.equal(r.proposals[0].hasMappingSupport, false);
});
test('noncatalog label, behavior claim, malformed JSON and ambiguous quotes are rejected', () => {
    const v = valid(); v.operations[0].type = 'Extract Method'; v.behavior = 'preserved';
    assert.equal(validateOutput(JSON.stringify(v), before, after, evidence).valid, false);
    assert.equal(validateOutput('```json\n{}\n```', before, after, evidence).valid, false);
    const repeated = { 'a.ts': before['a.ts'] + before['a.ts'] };
    assert.equal(validateOutput(JSON.stringify(valid()), repeated, after, evidence).valid, false);
});
