const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSnapshots } = require('../src/tree-sitter-frontend');
const { languageFor } = require('../src/languages');
const { analyzeStrand } = require('../../../scripts/change-analysis/run-javascript-mappings');

test('shared frontend validates snapshot input and handles empty input', async () => {
    await assert.rejects(parseSnapshots({ 'bad.java': null }), /invalid-snapshot-text/);
    assert.deepEqual(Object.keys((await parseSnapshots({})).documents), []);
});

test('language domains include future adapters and prevent exact cross-language matches', () => {
    assert.deepEqual(['a.java', 'a.go', 'a.rs', 'a.mojo', 'a.🔥'].map(languageFor), ['java', 'go', 'rust', 'mojo', 'mojo']);
    const result = analyzeStrand({ 'a.js': 'function price(items) { return items.length + 1; }' },
        { 'a.py': 'def price(items):\n    return len(items) + 1\n' });
    assert.equal(result.analysis.relations.length, 0);
});
