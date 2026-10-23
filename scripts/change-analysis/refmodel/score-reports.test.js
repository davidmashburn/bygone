const { test } = require('node:test');
const assert = require('node:assert/strict');
const { score } = require('./score-reports');

test('upstream labels come from headings, not explanatory mentions or negative prose', () => {
    const runs = [{ caseId: 'x', arm: 'upstream', status: 'complete', response: {
        response: '- **Move Method** — moved.\n\nNo Rename Method is evident.\n- **Extract Method**\n'
    } }];
    const [result] = score({ runs }, [{ id: 'x' }], {});
    assert.deepEqual(result.labels, ['Move Method']);
    assert.deepEqual(result.otherHeadings, ['Extract Method']);
});

test('invalid grounded evidence cannot become a source-valid operation', () => {
    const operation = { type: 'Move Method', sourceIds: ['b0'], destinationIds: ['a0'], explanation: 'moved',
        evidence: [{ side: 'before', path: 'x.js', quote: 'invented' }] };
    const runs = [{ caseId: 'x', arm: 'grounded', status: 'complete', response: {
        response: JSON.stringify({ operations: [operation], additionalEdits: [], uncertainties: [], behavior: 'unassessed' })
    } }];
    const fixture = { id: 'x', before: { 'x.js': 'old' }, after: { 'y.js': 'new' } };
    const evidence = { x: { inventory: { before: [{ id: 'b0' }], after: [{ id: 'a0' }] }, correspondences: [], groups: [] } };
    const [result] = score({ runs }, [fixture], evidence);
    assert.equal(result.validation.valid, false);
    assert.ok(result.validation.errors.includes('operation-0:quote-not-found'));
});
