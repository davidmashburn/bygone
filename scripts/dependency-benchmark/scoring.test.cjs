const test = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('./run.cjs');
const edge = { file: 'a.ts', specifier: './b', relationship: 'import', phase: 'module-init', loading: 'eager', resolution: 'resolved', target: 'b.ts' };
test('scoring rejects wrong endpoints, phases and unknowns rather than rewarding syntax alone', () => {
    for (const override of [{ target: 'c.ts' }, { phase: 'invocation' }, { resolution: 'unresolved', target: undefined }]) {
        const result = compare([edge], [{ ...edge, ...override }]);
        assert.equal(result.correct, 0);
        assert.equal(result.missing.length, 1);
        assert.equal(result.unexpected.length, 1);
    }
});
test('scoring counts duplicate sites and unexpected edges and leaves empty ratios undefined', () => {
    const result = compare([edge, edge], [edge]);
    assert.equal(result.correct, 1);
    assert.equal(result.recall, 0.5);
    assert.equal(compare([edge], [edge, edge]).precision, 0.5);
    assert.equal(compare([], []).precision, null);
    assert.equal(compare([], []).recall, null);
});
