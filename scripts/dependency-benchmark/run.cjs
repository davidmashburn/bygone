#!/usr/bin/env node
// Reads Git objects only. Never installs dependencies or executes corpus code.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const sha = text => createHash('sha256').update(text).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
const project = e => ({ file: e.source.file, ...(e.specifier === undefined ? {} : { specifier: e.specifier }), relationship: e.relationship, phase: e.phase, loading: e.loading, resolution: e.resolution, ...(e.target === undefined ? {} : { target: e.target }) });
const key = e => JSON.stringify([e.file, e.specifier, e.relationship, e.phase, e.loading, e.resolution, e.target]);
function compare(expected, actual) {
    const remaining = actual.slice();
    const missing = [];
    let correct = 0;
    for (const e of expected) {
        const index = remaining.findIndex(a => key(a) === key(e));
        if (index < 0) missing.push(e);
        else { correct++; remaining.splice(index, 1); }
    }
    return { expected: expected.length, actual: actual.length, correct, missing, unexpected: remaining,
        precision: actual.length ? correct / actual.length : null, recall: expected.length ? correct / expected.length : null };
}
function counts(items, field) {
    return items.reduce((r, x) => { const k = x[field]; r[k] = (r[k] || 0) + 1; return r; }, {});
}
function summarize(s) {
    return { coverage: s.coverage, edges: s.edges.length, initializationSites: s.initialization.length,
        resolution: counts(s.edges, 'resolution'), relationships: counts(s.edges, 'relationship'), phases: counts(s.edges, 'phase'),
        diagnostics: counts(s.diagnostics, 'code'), diagnosticExamples: s.diagnostics.filter((d, i, all) => all.findIndex(x => x.code === d.code && x.message === d.message) === i).slice(0, 12),
        unresolvedExamples: s.edges.filter(e => e.resolution !== 'resolved').slice(0, 5).map(project) };
}
function worker(request) {
    const started = performance.now();
    const { buildDependencyGraph } = require('../../out/dependencyGraph');
    const loaded = performance.now();
    const report = buildDependencyGraph(request.repo, { baseRef: request.base, headRef: request.head });
    const finished = performance.now();
    const result = { moduleLoadMs: loaded - started, analysisMs: finished - loaded, peakRssKiB: process.resourceUsage().maxRSS,
        range: { baseOid: report.range.baseOid, headOid: report.range.headOid }, producer: report.producer,
        base: summarize(report.base), head: summarize(report.head), added: report.changes.added.length,
        removed: report.changes.removed.length, unchangedConsumers: report.unchangedConsumers.head.length };
    if (request.labeled || request.selectedFiles) {
        const selected = e => !request.selectedFiles || request.selectedFiles.includes(e.source.file);
        result.edges = report.head.edges.filter(selected).map(project);
        result.delta = { added: report.changes.added.map(project), removed: report.changes.removed.map(project) };
        result.consumers = report.unchangedConsumers.head.map(project);
        result.initialization = [];
        // Outside the timed interval and RSS sample: verify every source site against committed blobs.
        let verified = 0;
        const blobs = new Map();
        for (const s of [report.base, report.head]) for (const e of [...s.edges, ...s.initialization].filter(selected)) {
            const source = e.source;
            if (!blobs.has(source.blobOid)) blobs.set(source.blobOid, execFileSync('git', ['cat-file', 'blob', source.blobOid], { cwd: request.repo, encoding: 'utf8' }));
            const content = blobs.get(source.blobOid);
            if (s === report.head && e.kind) result.initialization.push({ file: source.file, kind: e.kind, phase: e.phase, text: content.slice(source.start, source.end) });
            const prefix = content.slice(0, source.start);
            if (source.oid !== s.oid || source.blobOid !== git(request.repo, 'rev-parse', `${s.oid}:${source.file}`)
                || source.digest !== sha(content.slice(source.start, source.end))
                || source.line !== prefix.split('\n').length || source.column !== prefix.length - prefix.lastIndexOf('\n')) throw new Error(`Invalid source evidence: ${source.file}`);
            if (source.link) {
                const { parseDeepLink } = require('../../out/deepLink');
                const link = parseDeepLink(source.link);
                if (link.revision !== s.oid || link.file !== source.file || link.line !== source.line) throw new Error('Invalid source link');
            }
            verified++;
        }
        result.verifiedSourceSites = verified;
    }
    return result;
}
function run(request) {
    const start = performance.now();
    const result = JSON.parse(execFileSync(process.execPath, [__filename, '--worker', JSON.stringify(request)], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 90000 }));
    return { ...result, processWallMs: performance.now() - start };
}
function scale(size) {
    const files = { 'tsconfig.json': '{"compilerOptions":{"moduleResolution":"node"}}' };
    for (let i = 0; i < size; i++) files[`m${String(i).padStart(4, '0')}.ts`] = `import { value as next } from './m${String((i + 1) % size).padStart(4, '0')}';\nexport const value = ${i};\nexport const read = () => next;\n`;
    return { before: files, after: { ...files, 'm0000.ts': files['m0000.ts'].replace('value = 0', 'value = 9999') } };
}
function main() {
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('Usage: node scripts/dependency-benchmark/run.cjs --output report.json [--repos local-manifest.json]');
    const cases = require('./cases.cjs');
    const { correspondenceFixture } = require('../../test/correspondenceFixture');
    const files = ['src/moduleDependencies.ts', 'src/dependencyGraph.ts', 'src/gitComparison.ts', 'out/dependencyGraph.js', 'scripts/dependency-benchmark/run.cjs', 'scripts/dependency-benchmark/cases.cjs', 'scripts/dependency-benchmark/public-labels.cjs'];
    const result = { generatedAt: new Date().toISOString(), implementationCommit: git(root, 'rev-parse', 'HEAD'),
        hashes: Object.fromEntries(files.filter(f => fs.existsSync(path.join(root, f))).map(f => [f, sha(fs.readFileSync(path.join(root, f)))])),
        environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30 },
        methodology: 'Hand-labeled HEAD edge multisets; optional delta/consumer labels. Three fresh Node processes per scale/public input, sequential; first observed run and subsequent OS-cache-warm runs, not controlled cold-cache trials. Analysis includes Git range discovery and both snapshots, excludes module loading. RSS is whole-process high-water KiB, including parser. No target code executed. Public repositories have no accuracy oracle. Review-task comparisons are qualitative source inspections, not human or timed trials.',
        cases: [], scale: [], repositories: [] };
    for (const c of cases) {
        const f = correspondenceFixture(c);
        try {
            const sample = run({ repo: f.root, base: f.range.baseOid, head: f.range.headOid, labeled: true });
            const score = compare(c.expected, sample.edges);
            const byRelationship = Object.fromEntries(['import', 'reexport', 'require', 'dynamic-import'].map(r => [r, compare(c.expected.filter(e => e.relationship === r), sample.edges.filter(e => e.relationship === r))]));
            const checks = {};
            if (c.added) checks.added = compare(c.added, sample.delta.added);
            if (c.removed) checks.removed = compare(c.removed, sample.delta.removed);
            if (c.consumers) checks.consumers = compare(c.consumers, sample.consumers);
            const initializationCheck = c.expectedInitialization ? {
                expected: c.expectedInitialization, actual: sample.initialization,
                passed: JSON.stringify(c.expectedInitialization) === JSON.stringify(sample.initialization)
            } : undefined;
            delete sample.edges; delete sample.delta; delete sample.consumers;
            delete sample.initialization;
            result.cases.push({ id: c.id, kind: c.kind || 'contract', score, byRelationship, checks, initializationCheck, reviewTask: c.reviewTask,
                baselineChangedFiles: git(f.root, 'diff', '--name-only', f.range.baseOid, f.range.headOid).split('\n'), sample });
        } finally { f.dispose(); }
    }
    for (const size of [100, 500, 1500, 2500]) {
        const f = correspondenceFixture(scale(size));
        try {
            const samples = Array.from({ length: 3 }, () => run({ repo: f.root, base: f.range.baseOid, head: f.range.headOid }));
            const indexed = Math.min(size, 1999); // One config consumes a slot in the 2,000-input budget.
            const passed = samples.every(s => [s.base, s.head].every(x => x.coverage.indexedFiles === indexed
                && x.coverage.omittedFiles === size - indexed && x.coverage.indexComplete === (size <= 1999)
                && x.edges === indexed && x.resolution.resolved === indexed));
            result.scale.push({ sourceFiles: size, passed, samples });
        }
        finally { f.dispose(); }
    }
    const repoIndex = process.argv.indexOf('--repos');
    if (repoIndex >= 0) for (const r of JSON.parse(fs.readFileSync(process.argv[repoIndex + 1], 'utf8'))) {
        const base = git(r.path, 'rev-parse', r.base);
        const head = git(r.path, 'rev-parse', r.head);
        const measured = { name: r.name, url: r.url, base, head, samples: Array.from({ length: 3 }, () => run({ repo: r.path, base, head })) };
        const labels = require('./public-labels.cjs')[r.name];
        if (labels && labels.head === head) {
            const probe = run({ repo: r.path, base, head, selectedFiles: labels.files });
            measured.selectedFileOracle = { files: labels.files, score: compare(labels.expected, probe.edges),
                resolvedEndpoints: compare(labels.expected.filter(e => e.resolution === 'resolved'), probe.edges.filter(e => e.resolution === 'resolved')),
                verifiedSourceSites: probe.verifiedSourceSites };
        }
        result.repositories.push(measured);
    }
    const scores = result.cases.flatMap(c => [c.score, ...Object.values(c.checks)]);
    result.passed = scores.every(s => !s.missing.length && !s.unexpected.length) && result.scale.every(s => s.passed)
        && result.cases.every(c => !c.initializationCheck || c.initializationCheck.passed);
    fs.writeFileSync(path.resolve(process.argv[outputIndex + 1]), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, expectedEdges: result.cases.reduce((n, c) => n + c.score.expected, 0), mismatches: result.cases.filter(c => [c.score, ...Object.values(c.checks)].some(s => s.missing.length || s.unexpected.length)).map(c => c.id) }));
    if (!result.passed) process.exitCode = 1;
}
module.exports = { compare, scale };
if (require.main === module) {
    if (process.argv[2] === '--worker') process.stdout.write(JSON.stringify(worker(JSON.parse(process.argv[3]))));
    else main();
}
