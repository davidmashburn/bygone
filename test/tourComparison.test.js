const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeTourComparisonSelection } = require('../out/tourComparison.js');

const chronological = ['oldest', 'middle', 'newest'];

test('comparison selections are validated, deduplicated, and ordered chronologically', () => {
    assert.deepEqual(
        normalizeTourComparisonSelection({ commits: ['newest', 'oldest', 'middle', 'oldest'], path: 'src/a.ts' }, chronological),
        { commits: chronological, path: 'src/a.ts' }
    );
    assert.deepEqual(
        normalizeTourComparisonSelection({ from: 'newest', to: 'oldest' }, chronological),
        { commits: ['oldest', 'newest'] }
    );
});

test('comparison selections reject unknown and undersized input', () => {
    assert.throws(() => normalizeTourComparisonSelection({ commits: ['oldest', 'unknown'] }, chronological), /at least two/);
    assert.throws(() => normalizeTourComparisonSelection({ commits: 'oldest' }, chronological), /at least two/);
});
