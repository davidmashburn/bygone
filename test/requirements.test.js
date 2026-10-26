const test = require('node:test');
const assert = require('node:assert/strict');
const { digest, parseReview, inspect, fingerprint, requirementFingerprint, correspondenceEvidence, refresh: refreshCore } = require('../out/requirements');
const { pinSourceRef: pin } = require('bygone-strand/source-references');
const oid = n => String(n).repeat(40);
const analysis = (base, head, extra = {}) => ({ base, head, producer: 'fixture', status: 'complete', scope: ['Supplied fixture files only'], limitations: [], artifactDigest: digest('fixture artifact'), ...extra });
const refresh = (review, before, after, pairs, requirements) => refreshCore(review, before, after,
    pairs.length ? { pairs, analysis: analysis(before.revision, after.revision) } : undefined, requirements);
const association = (review, requirement) => ({ requirement, fingerprint: requirementFingerprint(review, requirement), scope: 'The fixture predicate returns the expected value' });
function fixture() {
    const base = { repository: 'synthetic', revision: oid(1), files: { 'a.js': 'function ok() { return false; }' } };
    const head = { ...base, revision: oid(2), files: { 'a.js': 'function ok() { return true; }', 'extra.css': 'a {}' } };
    const review = parseReview({ version: 2, repository: 'synthetic', base: base.revision, head: head.revision,
        requirements: [{ id: 'R1', text: 'Return true', sources: [{ title: 'Fixture', text: 'Return true', quote: 'Return true' }] },
            { id: 'R2', text: 'Log decisions', sources: [{ title: 'Fixture', text: 'Log decisions', quote: 'Log decisions' }] }],
        links: [{ id: 'L1', requirement: 'R1', role: 'implementation', rationale: 'Author supplied rationale', ref: pin(head, 'a.js', 0, head.files['a.js'].length) }],
        runs: [], decisions: [], questions: [], analyses: [] });
    review.decisions.push({ requirement: 'R1', fingerprint: fingerprint(review, 'R1'), note: 'Previously inspected' });
    return { base, head, review };
}
test('coverage reports links, missing evidence, and unlinked files without claiming fulfillment', () => {
    const { base, head, review } = fixture(), report = inspect(review, base, head);
    assert.equal(report.requirements[0].implementationLinked, true);
    assert.equal(report.requirements[0].testLinked, false);
    assert.equal(report.requirements[0].verification, 'not-recorded');
    assert.equal(report.requirements[0].reviewer, 'inspected');
    assert.equal(report.requirements[1].implementationLinked, false);
    assert.deepEqual(report.changedPathsWithoutLinks, ['extra.css']);
    assert.equal('fulfilled' in report.requirements[0], false);
});
test('runtime input rejects forged quotation, duplicate IDs, unknown requirement, and unsafe refs', () => {
    for (const mutate of [
        r => { r.requirements[0].sources[0].quote = 'Invented'; },
        r => { r.requirements.push(r.requirements[0]); },
        r => { r.links[0].requirement = 'R99'; },
        r => { r.links[0].ref.path = '../secret'; },
        r => { r.links[0].ref.start = -1; },
        r => { r.links[0].ref.revision = 'HEAD'; },
        r => { r.links[0].ref.digest = 'not-a-hash'; }
    ]) { const { review } = fixture(); mutate(review); assert.throws(() => parseReview(review)); }
});
test('digest failures do not count as evidence or preserve inspection; foreign snapshots fail', () => {
    const { base, head, review } = fixture();
    const tampered = { ...head, files: { ...head.files, 'a.js': head.files['a.js'].replace('true', 'null') } };
    const report = inspect(review, base, tampered);
    assert.equal(report.requirements[0].implementationLinked, false);
    assert.equal(report.requirements[0].reviewer, 'needs-review');
    assert.throws(() => inspect(review, base, { ...head, repository: 'other' }), /mismatch/);
});
test('whole declaration relocation retains note and old review but requires renewed inspection', () => {
    const { base, head, review } = fixture();
    const next = { ...head, revision: oid(3), files: { 'moved.js': head.files['a.js'] } };
    const pairs = [{ before: review.links[0].ref, after: pin(next, 'moved.js', 0, next.files['moved.js'].length) }];
    const result = refresh(review, head, next, pairs);
    assert.equal(result.transitions[0].status, 'relocated');
    const report = inspect(result.review, base, next);
    assert.equal(report.requirements[0].implementationLinked, true);
    assert.equal(report.requirements[0].reviewer, 'needs-review');
    assert.equal(report.requirements[0].note, 'Previously inspected');
    assert.equal(review.head, head.revision);
    assert.equal(review.links[0].ref.path, 'a.js');
});
test('edited correspondence changes evidence; old test runs do not verify a new head', () => {
    const { base, head, review } = fixture();
    review.runs.push({ revision: head.revision, requirements: [association(review, 'R1')], command: 'node test.js', outcome: 'passed', outputDigest: digest('pass') });
    const next = { ...head, revision: oid(3), files: { 'a.js': head.files['a.js'].replace('true', 'null') } };
    const result = refresh(review, head, next, [{ before: review.links[0].ref, after: pin(next, 'a.js', 0, next.files['a.js'].length) }]);
    assert.equal(result.transitions[0].status, 'changed');
    assert.equal(inspect(result.review, base, next).requirements[0].verification, 'not-recorded');
    result.review.runs.push({ revision: next.revision, requirements: [association(result.review, 'R1')], command: 'node test.js', outcome: 'failed', outputDigest: digest('fail') });
    assert.equal(inspect(result.review, base, next).requirements[0].verification, 'recorded-failure');
});
test('no match preserves historical evidence as unresolved; duplicate and forged pairs reject', () => {
    const { base, head, review } = fixture();
    const next = { ...head, revision: oid(3), files: {} };
    const result = refresh(review, head, next, []);
    assert.equal(result.transitions[0].status, 'unresolved');
    assert.equal(result.review.links[0].ref.revision, head.revision);
    assert.equal(inspect(result.review, base, next).requirements[0].implementationLinked, false);
    const pair = { before: review.links[0].ref, after: { ...review.links[0].ref, revision: next.revision } };
    assert.throws(() => refresh(review, head, next, [pair]), /endpoint/);
    assert.throws(() => refresh(review, head, next, [pair, pair]), /Duplicate/);
});
test('source edits and rationale edits invalidate decisions even with identical code', () => {
    const { base, head, review } = fixture();
    review.requirements[0].sources[0].text += '\nAdditional constraint';
    assert.equal(inspect(review, base, head).requirements[0].reviewer, 'needs-review');
    review.decisions[0].fingerprint = fingerprint(review, 'R1');
    review.links[0].rationale = 'Revised claim';
    assert.equal(inspect(review, base, head).requirements[0].reviewer, 'needs-review');
});
test('unchanged local bytes still require review on a new revision', () => {
    const { base, head, review } = fixture();
    const next = { ...head, revision: oid(3), files: { ...head.files, 'caller.js': 'throw Error();' } };
    const result = refresh(review, head, next, []);
    assert.equal(result.transitions[0].status, 'unchanged');
    assert.equal(inspect(result.review, base, next).requirements[0].reviewer, 'needs-review');
});
test('UTF-16 ranges preserve Unicode and CRLF; test source is not an executed test', () => {
    const { base, head, review } = fixture();
    head.files['unicode.js'] = '// 🧪\r\nfunction testIt() {}\r\n';
    review.links.push({ id: 'T1', requirement: 'R1', role: 'test', rationale: 'Test declaration only', ref: pin(head, 'unicode.js', 7, head.files['unicode.js'].length) });
    const report = inspect(review, base, head);
    assert.equal(report.requirements[0].testLinked, true);
    assert.equal(report.requirements[0].verification, 'not-recorded');
    assert.equal(report.requirements[0].links[1].resolution.text, 'function testIt() {}\r\n');
});

test('Bygone preserves baseline evidence while Strand relocates current evidence', () => {
    const { base, head, review } = fixture();
    review.links.unshift({ id: 'B1', requirement: 'R1', role: 'context', rationale: 'Original behavior', ref: pin(base, 'a.js', 0, base.files['a.js'].length) });
    const next = { ...head, revision: oid(3), files: { 'moved.js': head.files['a.js'] } };
    const result = refresh(review, head, next, [{ before: review.links[1].ref, after: pin(next, 'moved.js', 0, next.files['moved.js'].length) }]);
    assert.deepEqual(result.transitions.map(t => [t.link, t.status]), [['B1', 'base-evidence'], ['L1', 'relocated']]);
    assert.deepEqual(result.review.links[0], review.links[0]);
    assert.equal(inspect(result.review, base, next).requirements[0].links[0].resolution.status, 'valid');
    assert.throws(() => refresh(review, head, { ...next, repository: 'other' }, []), /mismatch/);
    assert.throws(() => refresh(review, head, { ...next, revision: 'snapshot:three' }, []), /Git revision/);
});

function expandSnapshots(...snapshots) {
    const unrelated = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`unrelated-${i}.txt`, 'unchanged']));
    unrelated['large-unrelated.txt'] = 'x'.repeat(1048577);
    return snapshots.map(snapshot => ({ ...snapshot, files: { ...snapshot.files, ...unrelated } }));
}

test('inspection ignores unrelated snapshot limits but retains full changed-file coverage', () => {
    const fixtureData = fixture();
    const [base, head] = expandSnapshots(fixtureData.base, fixtureData.head);
    head.files['unrelated-59.txt'] = 'changed';
    const report = inspect(fixtureData.review, base, head);
    assert.equal(report.requirements[0].implementationLinked, true);
    assert.equal(report.requirements[0].reviewer, 'inspected');
    assert.deepEqual(report.changedPathsWithoutLinks, ['extra.css', 'unrelated-59.txt']);
});

test('refresh scopes snapshots to references and all accepted endpoints, including unused pairs', () => {
    const { base, head, review } = fixture();
    for (const moved of [false, true]) {
        const path = moved ? 'moved.js' : 'a.js';
        const next = { ...head, revision: oid(3), files: { [path]: head.files['a.js'] } };
        const pair = { before: review.links[0].ref, after: pin(next, path, 0, next.files[path].length) };
        const [expandedHead, expandedNext] = expandSnapshots(head, next);
        const result = refresh(review, expandedHead, expandedNext, moved ? [pair] : []);
        assert.equal(result.transitions[0].status, moved ? 'relocated' : 'unchanged');
        assert.equal(inspect(result.review, base, expandedNext).requirements[0].implementationLinked, true);
        const unused = { before: pin(head, 'extra.css', 0, head.files['extra.css'].length), after: { ...pair.after, path: 'missing.css' } };
        assert.throws(() => refresh(review, expandedHead, expandedNext, [pair, unused]), /endpoint/);
    }
});

test('same-head requirement updates invalidate inspection while retaining evidence, notes, and runs', () => {
    const { base, head, review } = fixture();
    review.runs.push({ revision: head.revision, requirements: [association(review, 'R1')], command: 'node test.js', outcome: 'passed', outputDigest: digest('pass') });
    review.decisions[0].fingerprint = fingerprint(review, 'R1');
    const original = JSON.stringify(review);
    const [expandedHead] = expandSnapshots(head);
    const noop = refresh(review, expandedHead, expandedHead, []);
    assert.equal(inspect(noop.review, base, expandedHead).requirements[0].reviewer, 'inspected');
    const requirements = review.requirements.map(r => r.id === 'R1' ? { ...r, text: r.text + ' and log the result' } : r);
    const result = refresh(review, expandedHead, expandedHead, [], requirements);
    const report = inspect(result.review, base, expandedHead);
    assert.equal(result.transitions[0].status, 'unchanged');
    assert.deepEqual(result.review.links, review.links);
    assert.deepEqual(result.review.runs, review.runs);
    assert.equal(report.requirements[0].reviewer, 'needs-review');
    assert.equal(report.requirements[0].verification, 'needs-reassessment');
    assert.equal(report.requirements[0].runs[0].outcome, 'passed');
    assert.equal(report.requirements[0].runs[0].applicability, 'stale-requirement');
    assert.equal(report.requirements[0].note, 'Previously inspected');
    assert.equal(JSON.stringify(review), original);
});

test('same-head refresh does not promote broken evidence or ignore supplied correspondence', () => {
    const { head, review } = fixture();
    const broken = { ...head, files: {} };
    assert.equal(refresh(review, head, broken, []).transitions[0].status, 'unresolved');
    assert.equal(refresh(review, broken, head, []).transitions[0].status, 'unresolved');
    assert.throws(() => refresh(review, head, head, [{ before: review.links[0].ref, after: review.links[0].ref }]), /Same-revision/);
});

function disputedQuestion(review) {
    return { id: 'Q1', requirement: 'R1', text: 'Must every caller return true?', status: 'open', alternatives: [
        { text: 'All callers', sources: review.requirements[0].sources },
        { text: 'Only explicit requests', sources: [{ title: 'Discussion', text: 'Only explicit requests', quote: 'explicit requests' }] }
    ] };
}
test('conflicting provenance and open/resolved questions round-trip without choosing an interpretation', () => {
    const { base, head, review } = fixture();
    review.questions.push(disputedQuestion(review));
    review.requirements[0].sources.push(review.questions[0].alternatives[1].sources[0]);
    const parsed = parseReview(JSON.parse(JSON.stringify(review)));
    assert.deepEqual(parsed, review);
    assert.deepEqual(inspect(parsed, base, head).requirements[0].questions, review.questions);
    const key = requirementFingerprint(parsed, 'R1');
    parsed.questions[0] = { ...parsed.questions[0], status: 'resolved', resolution: 'Author clarified: explicit requests only' };
    assert.notEqual(requirementFingerprint(parsed, 'R1'), key);
    assert.equal(parseReview(parsed).questions[0].resolution, 'Author clarified: explicit requests only');
    assert.throws(() => requirementFingerprint(parsed, 'absent'), /Unknown/);
});
test('version 2 rejects legacy guarantees, malformed questions, unscoped runs, and analysis receipts', () => {
    for (const mutate of [
        r => { r.version = 1; },
        r => { r.requirements[0].sources = []; },
        r => { r.questions[0].requirement = 'absent'; },
        r => { r.questions.push(r.questions[0]); },
        r => { r.questions[0].alternatives[1].sources[0].quote = 'fabricated'; },
        r => { r.questions[0].resolution = 'silently resolved'; },
        r => { r.questions[0].status = 'resolved'; },
        r => { r.runs[0].requirements = ['R1']; },
        r => { r.runs[0].requirements[0].scope = ''; },
        r => { r.runs[0].requirements[0].fingerprint = 'HEAD'; },
        r => { r.runs[0].requirements.push(r.runs[0].requirements[0]); },
        r => { r.analyses[0].scope = []; },
        r => { r.analyses[0].artifactDigest = 'missing'; },
        r => { r.analyses[0].status = 'success'; }
    ]) {
        const { review } = fixture();
        review.questions.push(disputedQuestion(review));
        review.runs.push({ revision: review.head, requirements: [association(review, 'R1')], command: 'node test.js', outcome: 'passed', outputDigest: digest('pass') });
        review.analyses.push(analysis(review.base, review.head));
        mutate(review);
        assert.throws(() => parseReview(review));
    }
});
test('test applicability follows requirement meaning independently of execution results or other requirements', () => {
    for (const outcome of ['passed', 'failed']) {
        const { base, head, review } = fixture();
        review.runs.push({ revision: head.revision, requirements: [association(review, 'R1')], command: 'node test.js', outcome, outputDigest: digest(outcome) });
        const expected = outcome === 'passed' ? 'recorded-pass' : 'recorded-failure';
        review.requirements[1].text += ' and persist';
        assert.equal(inspect(review, base, head).requirements[0].verification, expected);
        review.questions.push(disputedQuestion(review));
        const stale = inspect(review, base, head).requirements[0];
        assert.equal(stale.verification, 'needs-reassessment');
        assert.equal(stale.runs[0].outcome, outcome);
        assert.equal(stale.runs[0].association.scope, 'The fixture predicate returns the expected value');
        // An explicit new association is needed; the old result is not rewritten.
        review.runs.push({ ...review.runs[0], requirements: [association(review, 'R1')] });
        const reassessed = inspect(review, base, head).requirements[0];
        assert.equal(reassessed.verification, expected);
        assert.deepEqual(reassessed.runs.map(r => r.applicability), ['stale-requirement', 'current']);
        review.questions[0] = { ...review.questions[0], status: 'resolved', resolution: 'All callers' };
        assert.equal(inspect(review, base, head).requirements[0].verification, 'needs-reassessment');
    }
});
test('source revisions invalidate test applicability even when the requirement text is unchanged', () => {
    const { base, head, review } = fixture();
    review.runs.push({ revision: head.revision, requirements: [association(review, 'R1')], command: 'node test.js', outcome: 'passed', outputDigest: digest('pass') });
    review.requirements[0].sources[0].text += '\nExcept for the default caller';
    assert.equal(inspect(review, base, head).requirements[0].verification, 'needs-reassessment');
});
test('partial analysis limits survive complete incremental analysis without implying whole-PR completeness', () => {
    const { base, head, review } = fixture();
    review.analyses.push(analysis(base.revision, head.revision, { status: 'partial', limitations: ['budget-max-candidates: 100'] }));
    review.decisions[0].fingerprint = fingerprint(review, 'R1');
    review.analyses[0].limitations.push('Unsupported syntax omitted');
    assert.equal(inspect(review, base, head).requirements[0].reviewer, 'needs-review');
    const next = { ...head, revision: oid(3) };
    const result = refreshCore(review, head, next, { pairs: [], analysis: analysis(head.revision, next.revision) });
    const report = inspect(parseReview(JSON.parse(JSON.stringify(result.review))), base, next);
    assert.deepEqual(report.analyses.map(a => [a.status, a.relevance]), [['partial', 'historical'], ['complete', 'current-head-delta']]);
    assert.deepEqual(report.analyses[0].limitations, ['budget-max-candidates: 100', 'Unsupported syntax omitted']);
    assert.deepEqual(report.analyses[1].scope, ['Supplied fixture files only']);
    assert.equal(inspect(review, base, head).analyses[0].relevance, 'current-comparison');
    assert.deepEqual(inspect(fixture().review, base, head).analyses, []);
    assert.throws(() => refreshCore(review, head, next, []), /object/);
    assert.throws(() => refreshCore(review, head, next, { pairs: [], analysis: analysis(base.revision, next.revision) }), /comparison/);
    assert.throws(() => refreshCore(review, head, next, { pairs: [review.links[0]], analysis: analysis(head.revision, next.revision, { status: 'unavailable' }) }), /Unavailable/);
});
test('correspondence adapter retains scope, budget warnings, digest, and accepted endpoints together', () => {
    const { base, head, review } = fixture();
    const b = pin(base, 'a.js', 0, base.files['a.js'].length), a = review.links[0].ref;
    const artifact = { range: { baseOid: base.revision, headOid: head.revision }, producer: 'fixture', status: 'partial',
        symbols: { before: [{ id: 'before', ...b }], after: [{ id: 'after', ...a }] },
        relations: [{ sourceId: 'before', destinationId: 'after' }], limitations: ['budget-max-candidates'],
        diagnostics: { scope: ['Repository-wide origins were not searched'] } };
    const evidence = correspondenceEvidence(artifact, ['Changed supported files']);
    assert.deepEqual(evidence.pairs, [{ before: b, after: a }]);
    assert.deepEqual(evidence.analysis.scope, ['Changed supported files', 'Repository-wide origins were not searched']);
    assert.deepEqual(evidence.analysis.limitations, artifact.limitations);
    assert.equal(evidence.analysis.artifactDigest, digest(JSON.stringify(artifact)));
    assert.equal(evidence.analysis.status, 'partial');
});
