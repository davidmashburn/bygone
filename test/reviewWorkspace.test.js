const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const workspace = require('../out/reviewWorkspace');
const core = require('../out/requirements');
const { inspectDependencies } = require('../out/reviewDependencies');
const { buildDependencyGraph } = require('../out/dependencyGraph');
const { buildDependencyEvidence } = require('../out/dependencyEvidence');
const { runEvidenceCommand } = require('../cli/evidence');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-evidence-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
    const commit = message => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
    fs.writeFileSync(path.join(root, 'code.ts'), '// 😀\r\nexport function value() { return 1; }\r\n');
    fs.writeFileSync(path.join(root, 'dep.ts'), 'export const one = 1; export const two = 2;\n');
    fs.writeFileSync(path.join(root, 'consumer.ts'), 'import { one } from "./dep";\nconsole.log(one);\n');
    const base = commit('base');
    const source = '// 😀\r\nexport function value() { return 2; }\r\n';
    fs.writeFileSync(path.join(root, 'code.ts'), source);
    fs.writeFileSync(path.join(root, 'consumer.ts'), 'import { two } from "./dep";\nconsole.log(two);\n');
    fs.writeFileSync(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    const head = commit('head');
    const ref = workspace.lineReference(root, head, 'code.ts', 2, 2);
    const review = core.parseReview({ version: 2, repository: 'synthetic', base, head,
        requirements: [{ id: 'R1', text: 'Return two', sources: [{ title: 'Synthetic requirement', text: 'Return two', quote: 'Return two' }] }],
        questions: [], links: [{ id: 'L1', requirement: 'R1', role: 'implementation', rationale: 'Inspect the return value', ref }], runs: [], analyses: [], decisions: [] });
    return { root, git, commit, base, head, source, ref, review };
}
test('pinned inspection validates UTF-16/CRLF anchors, excludes dirty content, and includes binary coverage gaps', t => {
    const f = fixture(t);
    assert.equal(f.ref.start, '// 😀\r\n'.length);
    assert.equal(workspace.sourceText(f.root, f.ref), f.source);
    fs.writeFileSync(path.join(f.root, 'code.ts'), 'dirty');
    const report = workspace.inspectWorkspace(f.root, f.review);
    assert.equal(report.requirements[0].links[0].resolution.status, 'valid');
    assert.deepEqual(report.changedPathsWithoutLinks, ['binary', 'consumer.ts']);
    assert.throws(() => workspace.sourceText(f.root, { ...f.ref, digest: '0'.repeat(64) }), /validates/);
    assert.throws(() => workspace.readPinnedFile(f.root, f.head, '../escape'), /path/);
    assert.throws(() => workspace.readPinnedFile(f.root, 'HEAD', 'code.ts'), /immutable/);
    assert.throws(() => workspace.lineReference(f.root, f.head, 'code.ts', 2, 3), /exceeds/);
});
test('refresh keeps historical review and invalidates inspection after code or requirement changes', t => {
    const f = fixture(t);
    f.review.decisions = [{ requirement: 'R1', fingerprint: core.fingerprint(f.review, 'R1'), note: 'Inspected the fixture' }];
    fs.writeFileSync(path.join(f.root, 'code.ts'), f.source.replace('2;', '3;'));
    const next = f.commit('changed');
    const refreshed = workspace.refreshWorkspace(f.root, f.review, next);
    assert.equal(refreshed.transitions[0].status, 'unresolved');
    assert.equal(refreshed.review.links[0].ref.revision, f.head);
    assert.equal(workspace.inspectWorkspace(f.root, refreshed.review).requirements[0].reviewer, 'needs-review');
    assert.equal(f.review.head, f.head);
    const changed = workspace.refreshWorkspace(f.root, f.review, f.head, undefined, [{ ...f.review.requirements[0], text: 'Return three' }]);
    assert.equal(workspace.inspectWorkspace(f.root, changed.review).requirements[0].reviewer, 'needs-review');
    const output = path.join(f.root, 'review.json');
    workspace.writeReview(output, f.review);
    assert.throws(() => workspace.writeReview(output, refreshed.review), /EEXIST/);
});
test('dependency navigation checks exact blobs/ranges and exposes unchanged-edge blind spot', t => {
    const f = fixture(t);
    const graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    assert.equal(graph.changes.added.length, 0);
    assert.equal(graph.changes.removed.length, 0);
    const report = inspectDependencies(f.root, f.review, graph);
    assert.ok(report.links.length);
    assert.match(report.limitations.join('\n'), /do not prove unchanged imported bindings/);
    const changed = { ...f.review, base: f.head };
    fs.writeFileSync(path.join(f.root, 'dep.ts'), 'export const one = 3; export const two = 4;\n');
    changed.head = f.commit('dependency changed');
    const updated = inspectDependencies(f.root, changed, buildDependencyGraph(f.root, { baseRef: changed.base, headRef: changed.head }));
    assert.ok(updated.links.some(l => l.title.includes('consumer.ts — import "./dep" → dep.ts') && l.loading === 'eager'));
    const tampered = structuredClone(graph);
    tampered.head.edges[0].source.blobOid = '0'.repeat(40);
    assert.throws(() => inspectDependencies(f.root, f.review, tampered), /blob mismatch/);
    assert.throws(() => inspectDependencies(f.root, { ...f.review, head: f.base }, graph), /does not match/);
});
test('v2 dependency evidence is pinned, bounded, and honest about static coverage', t => {
    const f = fixture(t);
    const report = buildDependencyEvidence(f.root, { baseRef: f.base });
    const inspection = inspectDependencies(f.root, f.review, report);
    assert.ok(inspection.links.length);
    assert.match(inspection.limitations.join('\n'), /Static phase labels describe syntax/);
    assert.match(inspection.limitations.join('\n'), /Resolution labels identify only source targets/);
    assert.match(inspection.limitations.join('\n'), /base: .*files indexed/);

    const schema = structuredClone(report);
    schema.extra = true;
    assert.throws(() => inspectDependencies(f.root, f.review, schema), /unknown field/);

    const digest = structuredClone(report);
    digest.head.sites[0].source.digest = '0'.repeat(64);
    assert.throws(() => inspectDependencies(f.root, f.review, digest), /digest mismatch/);

    const membership = structuredClone(report);
    membership.head.sites[0].owner = membership.head.nodes.find(node => node.source.file !== membership.head.sites[0].source.file).id;
    assert.throws(() => inspectDependencies(f.root, f.review, membership), /membership mismatch/);

    const budget = structuredClone(report);
    budget.limits.maxBytes = 1;
    assert.throws(() => inspectDependencies(f.root, f.review, budget), /coverage exceeds declared limits/);
});
test('CLI imports with no carried decisions and produces a validated pinned tour', t => {
    const f = fixture(t), input = path.join(f.root, 'input.json'), output = path.join(f.root, 'import.json');
    f.review.decisions = [{ requirement: 'R1', fingerprint: core.fingerprint(f.review, 'R1'), note: 'Old checklist' }];
    workspace.writeReview(input, f.review);
    let printed = '';
    const write = process.stdout.write; process.stdout.write = text => { printed += text; return true; }; t.after(() => { process.stdout.write = write; });
    runEvidenceCommand(['import', input, '--output', output], f.root);
    assert.deepEqual(workspace.loadReview(f.root, output).decisions, []);
    assert.equal(JSON.parse(printed).report.requirements[0].reviewer, 'unreviewed');
    const tour = path.join(f.root, 'evidence.bygone');
    runEvidenceCommand(['tour', output, '--output', tour], f.root);
    assert.deepEqual(JSON.parse(fs.readFileSync(tour)).range, { base: f.base, head: f.head });
});
test('refresh rejects divergent heads and foreign requirement provenance', t => {
    const f = fixture(t), input = path.join(f.root, 'input.json'), foreign = path.join(f.root, 'foreign.json');
    workspace.writeReview(input, f.review);
    workspace.writeReview(foreign, { ...f.review, repository: 'another-repository' });
    assert.throws(() => runEvidenceCommand(['refresh', input, '--head', f.head, '--requirements', foreign, '--output', path.join(f.root, 'out.json')], f.root), /original repository/);
    f.git('checkout', '--detach', f.base);
    fs.writeFileSync(path.join(f.root, 'side.ts'), 'export const side = 1;\n');
    const side = f.commit('side branch');
    assert.throws(() => workspace.refreshWorkspace(f.root, f.review, side), /descendant/);
});
test('dependency inventory respects the combined per-snapshot record budget', t => {
    const f = fixture(t), graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    graph.limits.maxRecords = 1;
    assert.throws(() => inspectDependencies(f.root, f.review, graph), /declared limits/);
});
test('Git rename pairs preserve before/after paths for pinned and working navigation', t => {
    const f = fixture(t);
    f.git('mv', 'code.ts', 'renamed.ts');
    assert.deepEqual(workspace.comparisonPaths(f.root, f.head, undefined, 'code.ts'), { before: 'code.ts', after: 'renamed.ts' });
    const head = f.commit('rename');
    assert.deepEqual(workspace.comparisonPaths(f.root, f.head, head, 'renamed.ts'), { before: 'code.ts', after: 'renamed.ts' });
});

test('dependency summaries preserve relationship, phase, and loading identity', t => {
    const f = fixture(t), graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    for (const field of ['relationship', 'phase', 'loading']) {
        const tampered = structuredClone(graph);
        const edge = structuredClone(tampered.head.edges[0]);
        edge[field] = 'forged';
        tampered.unchangedConsumers.head = [edge];
        assert.throws(() => inspectDependencies(f.root, f.review, tampered), /unknown inventory/);
    }
});
test('dependency source budgets reject understated coverage and declared input bounds', t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, 'second.ts'), 'import { two } from "./dep"; console.log(two);\n');
    f.head = f.commit('second consumer'); f.review.head = f.head;
    const graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    for (const field of ['maxFiles', 'maxFileBytes', 'maxBytes']) {
        const tampered = structuredClone(graph);
        tampered.limits[field] = 1;
        for (const side of ['base', 'head']) {
            if (field === 'maxFiles') {
                tampered[side].coverage.indexedFiles = 1;
                tampered[side].coverage.omittedFiles = tampered[side].coverage.candidateFiles - 1;
                tampered[side].coverage.indexComplete = false;
            }
            if (field === 'maxBytes') tampered[side].coverage.readBytes = 1;
        }
        assert.throws(() => inspectDependencies(f.root, f.review, tampered), /sources exceed declared/);
    }
    const tampered = structuredClone(graph);
    tampered.head.coverage.indexedFiles = 0;
    tampered.head.coverage.omittedFiles = tampered.head.coverage.candidateFiles;
    tampered.head.coverage.indexComplete = false;
    assert.throws(() => inspectDependencies(f.root, f.review, tampered), /sources exceed declared/);
});
test('dependency coverage accounts for every candidate and unresolved inventory edge', t => {
    const f = fixture(t), graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    for (const side of ['base', 'head']) {
        for (const field of ['candidateFiles', 'omittedFiles', 'unresolvedEdges']) {
            const tampered = structuredClone(graph);
            tampered[side].coverage[field]++;
            assert.throws(() => inspectDependencies(f.root, f.review, tampered), /coverage exceeds declared limits/);
        }
    }
    const partial = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head, limits: { maxFiles: 1 } });
    assert.ok(inspectDependencies(f.root, f.review, partial).limitations.some(s => s.includes('index partial')));
});
test('dependency validation stops at its deadline, including Git reads', t => {
    const f = fixture(t), graph = buildDependencyGraph(f.root, { baseRef: f.base, headRef: f.head });
    graph.limits.timeoutMs = 1;
    let now = 100;
    t.mock.method(Date, 'now', () => now++);
    assert.throws(() => inspectDependencies(f.root, f.review, graph), /time budget exhausted/);
    assert.throws(() => workspace.readPinnedFile(f.root, f.head, 'code.ts', 100), /time budget exhausted/);
});

test('file-level coverage treats a Git rename as one before/after transition', t => {
    const f = fixture(t);
    f.git('mv', 'code.ts', 'renamed.ts');
    const head = f.commit('rename source');
    const review = { ...f.review, base: f.head, head, links: [{ ...f.review.links[0], ref: workspace.lineReference(f.root, head, 'renamed.ts', 2, 2) }] };
    assert.deepEqual(workspace.inspectWorkspace(f.root, review).changedPathsWithoutLinks, []);
    assert.deepEqual(workspace.inspectWorkspace(f.root, { ...review, links: [] }).changedPathsWithoutLinks, ['code.ts', 'renamed.ts']);
});

test('dependency validation accepts two individually bounded snapshots above 16 MiB combined', t => {
    const f = fixture(t);
    const padding = '// ' + 'x'.repeat(950 * 1024) + '\n';
    for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(f.root, `large-${i}.ts`), padding + 'import { one } from "./dep";\n');
    const base = f.commit('large base');
    fs.writeFileSync(path.join(f.root, 'dep.ts'), 'export const one = 3; export const two = 4;\n');
    const head = f.commit('large head');
    const graph = buildDependencyGraph(f.root, { baseRef: base, headRef: head });
    assert.ok(graph.base.coverage.indexComplete && graph.head.coverage.indexComplete);
    assert.ok(graph.base.coverage.readBytes + graph.head.coverage.readBytes > 16 * 1024 * 1024);
    const result = inspectDependencies(f.root, { ...f.review, base, head }, graph);
    assert.equal(result.links.filter(l => l.title.includes('large-')).length, 18);
});


test('v2 imports accept empty modules and partial declaration inventories without overstating coverage', t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, '__init__.py'), '');
    fs.writeFileSync(path.join(f.root, 'many.py'), Array.from({length: 12}, (_, i) => `def f${i}():\n    pass\n`).join('\n'));
    f.head = f.commit('empty and large modules'); f.review.head = f.head;
    const report = buildDependencyEvidence(f.root, { baseRef: f.base });
    assert.ok(report.head.nodes.some(n => n.source.file === '__init__.py' && n.source.end === 0));
    assert.doesNotThrow(() => inspectDependencies(f.root, f.review, report));
    const partial = buildDependencyEvidence(f.root, { baseRef: f.base, limits: { maxRecords: 6 } });
    assert.equal(partial.head.coverage.indexComplete, false);
    assert.ok(new Set(partial.head.nodes.map(n => n.source.file)).size > partial.head.coverage.indexedFiles);
    const inspection = inspectDependencies(f.root, f.review, partial);
    assert.match(inspection.limitations.join('\n'), /index partial/);
    const forged = structuredClone(report);
    const node = forged.head.nodes.find(n => n.kind === 'function');
    node.source.end = node.source.start;
    assert.throws(() => inspectDependencies(f.root, f.review, forged), /Invalid dependency/);
});
