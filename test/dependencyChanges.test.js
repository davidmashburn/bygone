const test = require('node:test');
const assert = require('node:assert/strict');
const { compareDependencyEvidence } = require('../out/dependencyChanges');

const range = { baseOid: 'base', headOid: 'head' };
const source = (file, start, end, digest, revision) => ({
    file, revision, oid: revision, blobOid: `${revision}-blob`, start, end, line: 1, column: start + 1, digest,
    link: `bygone:${revision}:${file}:${start}`
});
const node = (id, file, start, end, digest, revision, name = id) => ({
    id, name, kind: 'function', language: 'typescript', source: source(file, start, end, digest, revision)
});
const site = (id, owner, target, file, start, end, digest, revision, name = 'call') => ({
    id, owner, relation: 'call', name, phase: 'invocation', resolution: 'resolved', target,
    evidence: 'static', producer: 'fixture', source: source(file, start, end, digest, revision)
});
const unresolvedSite = (id, owner, file, start, end, digest, revision, resolution = 'ambiguous') => ({
    id, owner, relation: 'call', name: 'call', phase: 'invocation', resolution, candidates: [],
    evidence: 'static', producer: 'fixture', source: source(file, start, end, digest, revision)
});
const snapshot = (oid, nodes, sites, indexComplete = true) => ({
    oid, nodes, sites, producers: [], diagnostics: [], coverage: {
        candidateFiles: nodes.length, indexedFiles: nodes.length, omittedFiles: 0, readBytes: 0,
        indexComplete, unresolvedSites: sites.filter(item => item.resolution !== 'resolved').length, omittedDiagnostics: 0
    }
});
const report = (baseNodes, baseSites, headNodes, headSites, baseComplete = true, headComplete = true) => ({
    version: 2, kind: 'dependency-evidence', range, configuration: { pythonRoots: [], scopes: [] }, limits: {}, assumptions: [],
    base: snapshot('base', baseNodes, baseSites, baseComplete), head: snapshot('head', headNodes, headSites, headComplete)
});
const symbol = (id, path, start, end, digest, text = id) => ({
    id, path, name: id, kind: 'function', start, end, digest, startLine: 1, endLine: 1, text
});
const correspondence = (relations, before, after, status = 'complete', unresolved = []) => ({
    version: 1, range, producer: 'fixture', status,
    documents: { before: [], after: [] }, symbols: { before, after }, relations, unresolved, limitations: []
});
const relation = (id, sourceId, destinationId) => ({
    id, sourceId, destinationId, producers: ['bygone-strand'], pathChanged: false, nameChanged: false,
    rawEqual: false, behavior: 'unassessed', localDiff: []
});

test('pairs exact correspondence anchors and reports an added call with navigable refs', () => {
    const before = [
        node('consumer-before', 'consumer.ts', 0, 20, 'consumer-before-digest', 'base', 'run'),
        node('target-a-before', 'lib.ts', 0, 10, 'a-before-digest', 'base', 'a'),
        node('target-b-before', 'lib.ts', 20, 30, 'b-before-digest', 'base', 'b'),
        node('target-c-before', 'lib.ts', 40, 50, 'c-before-digest', 'base', 'c')
    ];
    const after = [
        node('consumer-after', 'consumer.ts', 0, 24, 'consumer-after-digest', 'head', 'run'),
        node('target-a-after', 'lib.ts', 0, 12, 'a-after-digest', 'head', 'a'),
        node('target-b-after', 'lib.ts', 20, 32, 'b-after-digest', 'head', 'b'),
        node('target-c-after', 'lib.ts', 40, 52, 'c-after-digest', 'head', 'c')
    ];
    const artifact = correspondence([
        relation('consumer-continuation', 'consumer-symbol-before', 'consumer-symbol-after'),
        relation('a-continuation', 'a-symbol-before', 'a-symbol-after'),
        relation('b-continuation', 'b-symbol-before', 'b-symbol-after'),
        relation('c-continuation', 'c-symbol-before', 'c-symbol-after')
    ], [
        symbol('consumer-symbol-before', 'consumer.ts', 0, 20, 'consumer-before-digest'),
        symbol('a-symbol-before', 'lib.ts', 0, 10, 'a-before-digest'),
        symbol('b-symbol-before', 'lib.ts', 20, 30, 'b-before-digest'),
        symbol('c-symbol-before', 'lib.ts', 40, 50, 'c-before-digest')
    ], [
        symbol('consumer-symbol-after', 'consumer.ts', 0, 24, 'consumer-after-digest'),
        symbol('a-symbol-after', 'lib.ts', 0, 12, 'a-after-digest'),
        symbol('b-symbol-after', 'lib.ts', 20, 32, 'b-after-digest'),
        symbol('c-symbol-after', 'lib.ts', 40, 52, 'c-after-digest')
    ]);
    const result = compareDependencyEvidence(
        report(before, [
            site('call-a-before', 'consumer-before', 'target-a-before', 'consumer.ts', 12, 15, 'call-a-before', 'base'),
            site('call-c-before', 'consumer-before', 'target-c-before', 'consumer.ts', 16, 19, 'call-c-before', 'base')
        ],
            after, [
                site('call-a-after', 'consumer-after', 'target-a-after', 'consumer.ts', 12, 15, 'call-a-after', 'head'),
                site('call-b-after', 'consumer-after', 'target-b-after', 'consumer.ts', 18, 21, 'call-b-after', 'head')
            ]),
        artifact
    );

    assert.equal(result.continuations.length, 4);
    assert.equal(result.unknownContinuations.length, 0);
    assert.equal(result.changes.removed.length, 1);
    assert.equal(result.changes.removed[0].site.id, 'call-c-before');
    assert.equal(result.changes.added.length, 1);
    assert.equal(result.changes.added[0].site.id, 'call-b-after');
    assert.equal(result.changes.added[0].consumer.source.file, 'consumer.ts');
    assert.equal(result.changes.added[0].target.source.file, 'lib.ts');
    assert.match(result.changes.added[0].site.source.link, /^bygone:/);
    assert.equal(result.affectedConsumers.length, 1);
    assert.equal(result.affectedConsumers[0].added[0].site.id, 'call-b-after');
    assert.equal(result.affectedConsumers[0].removed[0].site.id, 'call-c-before');
});

test('uses exact unchanged source identity as fallback, never names alone', () => {
    const stableBase = node('stable-before', 'stable.ts', 0, 10, 'stable', 'base', 'run');
    const stableHead = node('stable-after', 'stable.ts', 0, 10, 'stable', 'head', 'run');
    const changedBase = node('changed-before', 'changed.ts', 0, 10, 'changed-before', 'base', 'run');
    const changedHead = node('changed-after', 'changed.ts', 0, 12, 'changed-after', 'head', 'run');
    const targetBase = node('target-before', 'target.ts', 0, 10, 'target', 'base', 'target');
    const targetHead = node('target-after', 'target.ts', 0, 10, 'target', 'head', 'target');
    const result = compareDependencyEvidence(
        report(
            [stableBase, changedBase, targetBase],
            [
                site('stable-call-before', stableBase.id, targetBase.id, 'stable.ts', 5, 8, 'stable-call', 'base'),
                site('changed-call-before', changedBase.id, targetBase.id, 'changed.ts', 5, 8, 'changed-call', 'base')
            ],
            [stableHead, changedHead, targetHead],
            []
        )
    );

    assert.equal(result.continuations.length, 2);
    assert.ok(result.continuations.some(item => item.basis === 'unchanged-source'));
    assert.equal(result.changes.removed.length, 1);
    assert.equal(result.changes.removed[0].consumer.source.file, 'stable.ts');
    assert.equal(result.changes.unknown.length, 1);
    assert.equal(result.changes.unknown[0].reason, 'consumer-continuation-unknown');
    assert.ok(result.unknownContinuations.some(item => item.node.source.file === 'changed.ts'));

    const renamedNameOnly = compareDependencyEvidence(report(
        [node('before', 'old.ts', 0, 10, 'same', 'base', 'run')], [],
        [node('after', 'new.ts', 0, 10, 'same', 'head', 'run')], []
    ));
    assert.equal(renamedNameOnly.continuations.length, 0);
    assert.equal(renamedNameOnly.changes.added.length, 0);
    assert.equal(renamedNameOnly.changes.removed.length, 0);
});

test('suppresses absence conclusions when the opposite snapshot has an unknown call', () => {
    const baseConsumer = node('consumer-before', 'consumer.ts', 0, 10, 'consumer', 'base', 'run');
    const headConsumer = node('consumer-after', 'consumer.ts', 0, 10, 'consumer', 'head', 'run');
    const baseTarget = node('target-before', 'target.ts', 0, 10, 'target', 'base', 'target');
    const headTarget = node('target-after', 'target.ts', 0, 10, 'target', 'head', 'target');
    const removedButUnknown = compareDependencyEvidence(report(
        [baseConsumer, baseTarget], [site('known-before', baseConsumer.id, baseTarget.id, 'consumer.ts', 5, 8, 'call', 'base')],
        [headConsumer, headTarget], [unresolvedSite('unknown-after', headConsumer.id, 'consumer.ts', 5, 8, 'call', 'head')]
    ));
    assert.equal(removedButUnknown.changes.removed.length, 0);
    assert.equal(removedButUnknown.changes.unknown.length, 1);
    assert.equal(removedButUnknown.changes.unknown[0].side, 'head');
    assert.equal(removedButUnknown.changes.unknown[0].reason, 'target-unresolved');

    const addedButUnknown = compareDependencyEvidence(report(
        [baseConsumer, baseTarget], [unresolvedSite('unknown-before', baseConsumer.id, 'consumer.ts', 5, 8, 'call', 'base')],
        [headConsumer, headTarget], [site('known-after', headConsumer.id, headTarget.id, 'consumer.ts', 5, 8, 'call', 'head')]
    ));
    assert.equal(addedButUnknown.changes.added.length, 0);
    assert.equal(addedButUnknown.changes.unknown.length, 1);
    assert.equal(addedButUnknown.changes.unknown[0].side, 'base');
    assert.equal(addedButUnknown.changes.unknown[0].reason, 'target-unresolved');
});

test('uses exact call-site identity and marks repeated-call leftovers ambiguous', () => {
    const baseConsumer = node('consumer-before', 'consumer.ts', 0, 10, 'consumer', 'base', 'run');
    const headConsumer = node('consumer-after', 'consumer.ts', 0, 10, 'consumer', 'head', 'run');
    const baseTarget = node('target-before', 'target.ts', 0, 10, 'target', 'base', 'target');
    const headTarget = node('target-after', 'target.ts', 0, 10, 'target', 'head', 'target');
    const baseFirst = site('base-first', baseConsumer.id, baseTarget.id, 'consumer.ts', 5, 8, 'first', 'base');
    const baseSecond = site('base-second', baseConsumer.id, baseTarget.id, 'consumer.ts', 10, 13, 'second', 'base');

    const exact = compareDependencyEvidence(report(
        [baseConsumer, baseTarget], [baseFirst, baseSecond],
        [headConsumer, headTarget], [site('head-first', headConsumer.id, headTarget.id, 'consumer.ts', 5, 8, 'first', 'head')]
    ));
    assert.equal(exact.changes.removed.length, 1);
    assert.equal(exact.changes.removed[0].site.id, 'base-second');
    assert.equal(exact.changes.unknown.length, 0);

    const moved = compareDependencyEvidence(report(
        [baseConsumer, baseTarget], [baseFirst, baseSecond],
        [headConsumer, headTarget], [site('head-moved', headConsumer.id, headTarget.id, 'consumer.ts', 20, 23, 'moved', 'head')]
    ));
    assert.equal(moved.changes.removed.length, 0);
    assert.deepEqual(moved.changes.unknown.filter(item => item.side === 'base').map(item => item.site.id).sort(), ['base-first', 'base-second']);
    assert.ok(moved.changes.unknown.filter(item => item.side === 'base').every(item => item.reason === 'ambiguous-call-identity'));

    const addedMoved = compareDependencyEvidence(report(
        [baseConsumer, baseTarget], [site('base-only', baseConsumer.id, baseTarget.id, 'consumer.ts', 5, 8, 'base-only', 'base')],
        [headConsumer, headTarget], [site('head-first', headConsumer.id, headTarget.id, 'consumer.ts', 10, 13, 'head-first', 'head'),
            site('head-second', headConsumer.id, headTarget.id, 'consumer.ts', 20, 23, 'head-second', 'head')]
    ));
    assert.equal(addedMoved.changes.added.length, 0);
    assert.deepEqual(addedMoved.changes.unknown.filter(item => item.side === 'head').map(item => item.site.id).sort(), ['head-first', 'head-second']);
    assert.ok(addedMoved.changes.unknown.filter(item => item.side === 'head').every(item => item.reason === 'ambiguous-call-identity'));
});

test('retains a known different-target switch as a removal and addition', () => {
    const baseConsumer = node('consumer-before', 'consumer.ts', 0, 10, 'consumer', 'base', 'run');
    const headConsumer = node('consumer-after', 'consumer.ts', 0, 10, 'consumer', 'head', 'run');
    const baseA = node('a-before', 'a.ts', 0, 10, 'a', 'base', 'a');
    const headA = node('a-after', 'a.ts', 0, 10, 'a', 'head', 'a');
    const baseB = node('b-before', 'b.ts', 0, 10, 'b', 'base', 'b');
    const headB = node('b-after', 'b.ts', 0, 10, 'b', 'head', 'b');
    const result = compareDependencyEvidence(report(
        [baseConsumer, baseA, baseB], [site('switch-before', baseConsumer.id, baseA.id, 'consumer.ts', 5, 8, 'old-call', 'base')],
        [headConsumer, headA, headB], [site('switch-after', headConsumer.id, headB.id, 'consumer.ts', 5, 8, 'new-call', 'head')]
    ));
    assert.equal(result.changes.removed.length, 1);
    assert.equal(result.changes.removed[0].target.id, 'a-before');
    assert.equal(result.changes.added.length, 1);
    assert.equal(result.changes.added[0].target.id, 'b-after');
    assert.equal(result.changes.unknown.length, 0);
});

test('does not assert removals when correspondence or snapshot coverage is partial', () => {
    const baseConsumer = node('consumer-before', 'consumer.ts', 0, 10, 'consumer-before', 'base', 'run');
    const headConsumer = node('consumer-after', 'consumer.ts', 0, 12, 'consumer-after', 'head', 'run');
    const baseTarget = node('target-before', 'target.ts', 0, 10, 'target-before', 'base', 'target');
    const headTarget = node('target-after', 'target.ts', 0, 12, 'target-after', 'head', 'target');
    const baseSites = [site('call-before', baseConsumer.id, baseTarget.id, 'consumer.ts', 5, 8, 'call-before', 'base')];
    const partialCorrespondence = correspondence([], [
        symbol('consumer-before-symbol', 'consumer.ts', 0, 10, 'consumer-before'),
        symbol('target-before-symbol', 'target.ts', 0, 10, 'target-before')
    ], [
        symbol('consumer-after-symbol', 'consumer.ts', 0, 12, 'consumer-after'),
        symbol('target-after-symbol', 'target.ts', 0, 12, 'target-after')
    ], 'partial', [{ reason: 'competing origins', sourceIds: ['consumer-before-symbol'], destinationIds: ['consumer-after-symbol'] }]);

    const partialCorrespondenceResult = compareDependencyEvidence(
        report([baseConsumer, baseTarget], baseSites, [headConsumer, headTarget], []), partialCorrespondence
    );
    assert.equal(partialCorrespondenceResult.changes.removed.length, 0);
    assert.ok(partialCorrespondenceResult.unknownContinuations.length > 0);
    assert.ok(partialCorrespondenceResult.limitations.some(item => /partial/.test(item)));

    const mapped = correspondence([
        relation('consumer', 'consumer-before-symbol', 'consumer-after-symbol'),
        relation('target', 'target-before-symbol', 'target-after-symbol')
    ], partialCorrespondence.symbols.before, partialCorrespondence.symbols.after);
    const incompleteReportResult = compareDependencyEvidence(
        report([baseConsumer, baseTarget], baseSites, [headConsumer, headTarget], [], false, true), mapped
    );
    assert.equal(incompleteReportResult.changes.removed.length, 0);
    assert.equal(incompleteReportResult.changes.unknown[0].reason, 'snapshot-coverage-incomplete');
});

test('rejects forged correspondence endpoints instead of falling back through them', () => {
    const base = node('before', 'consumer.ts', 0, 10, 'real-before', 'base', 'run');
    const head = node('after', 'consumer.ts', 0, 10, 'real-head', 'head', 'run');
    const artifact = correspondence([
        relation('forged', 'before-symbol', 'after-symbol')
    ], [symbol('before-symbol', 'consumer.ts', 0, 10, 'wrong-before')],
        [symbol('after-symbol', 'consumer.ts', 0, 10, 'real-head')]);
    const result = compareDependencyEvidence(report([base], [], [head], []), artifact);

    assert.equal(result.continuations.length, 0);
    assert.equal(result.unknownContinuations.length, 2);
    assert.ok(result.unknownContinuations.some(item => item.reason === 'ambiguous-correspondence'));
    assert.ok(result.unknownContinuations.some(item => item.reason === 'no-trusted-continuation'));
});
