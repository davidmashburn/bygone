const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDependencyEvidence } = require('../out/dependencyEvidence');
const { correspondenceFixture } = require('./correspondenceFixture');

const noisyArguments = Array.from({ length: 80 }, (_, index) => `missing_${index}`).join(', ');
const pressureFiles = {
    'a/noisy.py': `def noisy():\n    sink(${noisyArguments})\n`,
    'z/target.py': 'def target():\n    return 1\n\ndef caller():\n    target()\n\ncaller()\n'
};

test('declaration pressure retains late file inventory and reports partial files accurately', () => {
    const before = {
        'a.py': Array.from({ length: 3000 }, (_, i) => `def a${i}(): pass`).join('\n'),
        'z.py': 'def last(): pass\n'
    };
    const fixture = correspondenceFixture({ before, after: { ...before, 'z.py': before['z.py'] + '# changed\n' } });
    try {
        const snapshot = evidence(fixture, { maxRecords: 8 }).head;
        assert.equal(snapshot.nodes.length, 8);
        assert.ok(snapshot.nodes.some(n => n.name === 'last'));
        assert.equal(snapshot.coverage.indexedFiles, 1);
        assert.equal(snapshot.coverage.omittedFiles, 1);
        assert.equal(snapshot.coverage.indexComplete, false);
    } finally { fixture.dispose(); }
});

function fixtureFor(before) {
    return correspondenceFixture({ before, after: { ...before, 'z/target.py': `${before['z/target.py']}\n# changed\n` } });
}

function evidence(fixture, limits) {
    return buildDependencyEvidence(fixture.root, { baseRef: fixture.range.baseOid, limits });
}

test('declaration inventory protects late target nodes from early reference pressure', () => {
    const fixture = fixtureFor(pressureFiles);
    try {
        const report = evidence(fixture, { maxRecords: 8 });
        const snapshot = report.head;
        const nodeFiles = new Set(snapshot.nodes.map(node => node.source.file));
        assert.ok(nodeFiles.has('z/target.py'));
        assert.ok(snapshot.nodes.some(node => node.source.file === 'z/target.py' && node.name === 'target'));
        assert.ok(snapshot.sites.some(site => site.source.file === 'z/target.py' && site.relation === 'call'));
        assert.ok(snapshot.sites.every(site => site.relation !== 'reference'));
        assert.ok(snapshot.nodes.length + snapshot.sites.length <= 8);
        assert.equal(snapshot.coverage.indexComplete, false);
        assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'record-budget'));
    } finally { fixture.dispose(); }
});

test('calls and constructions outrank references after declarations are inventoried', () => {
    const before = {
        'main.py': [
            'class Widget:',
            '    pass',
            '',
            'def target():',
            '    pass',
            '',
            'def run():',
            '    Widget()',
            '    target()',
            `    sink(${Array.from({ length: 20 }, (_, index) => `missing_${index}`).join(', ')})`,
            '',
            'run()',
            ''
        ].join('\n')
    };
    const fixture = correspondenceFixture({ before, after: { ...before, 'main.py': `${before['main.py']}\n# changed\n` } });
    try {
        const snapshot = evidence(fixture, { maxRecords: 7 }).head;
        assert.ok(snapshot.sites.some(site => site.relation === 'construct'));
        assert.ok(snapshot.sites.some(site => site.relation === 'call'));
        assert.ok(snapshot.sites.every(site => site.relation !== 'reference'));
        assert.equal(snapshot.nodes.length + snapshot.sites.length, 7);
        assert.equal(snapshot.coverage.indexComplete, false);
        assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'record-budget'));
    } finally { fixture.dispose(); }
});

test('bounded allocation is deterministic and reports record omissions honestly', () => {
    const fixture = fixtureFor(pressureFiles);
    try {
        const first = evidence(fixture, { maxRecords: 9 });
        const second = evidence(fixture, { maxRecords: 9 });
        assert.deepEqual(first, second);
        for (const side of ['base', 'head']) {
            const snapshot = first[side];
            assert.ok(snapshot.nodes.length + snapshot.sites.length <= 9);
            const nodeIds = new Set(snapshot.nodes.map(node => node.id));
            for (const site of snapshot.sites) {
                assert.ok(nodeIds.has(site.owner));
                if (site.resolution === 'resolved') assert.ok(nodeIds.has(site.target));
                for (const candidate of site.candidates ?? []) assert.ok(nodeIds.has(candidate));
            }
            assert.equal(snapshot.coverage.indexComplete, false);
            assert.ok(snapshot.diagnostics.some(diagnostic => diagnostic.code === 'record-budget'));
            assert.equal(snapshot.coverage.indexedFiles + snapshot.coverage.omittedFiles, snapshot.coverage.candidateFiles);
        }
    } finally { fixture.dispose(); }
});
