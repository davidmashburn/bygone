const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { correspondenceFixture } = require('./correspondenceFixture');
const { buildDependencyGraph } = require('../out/dependencyGraph');
const { parseDeepLink } = require('../out/deepLink');
const { runDependenciesCommand, renderDependencyReport } = require('../cli/dependencies');
const { runTourCommand } = require('../cli/tour');

function analyze(t, before, after, options = {}) {
    const fixture = correspondenceFixture({ before, after });
    t.after(() => fixture.dispose());
    const report = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid, ...options });
    return { fixture, report };
}

test('snapshot config retargeting changes edges of unchanged consumers; working tree cannot override it', t => {
    const source = 'import { value } from "@lib";\nexport const result = value;';
    const common = { 'consumer.ts': source, 'a.ts': 'export const value = 1;', 'b.ts': 'export const value = 2;' };
    const config = target => JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib': [target] } } });
    const { fixture, report } = analyze(t, { ...common, 'tsconfig.json': config('a.ts') }, { ...common, 'tsconfig.json': config('b.ts'), 'b.ts': 'export const value = 3;' });
    assert.equal(report.base.edges[0].target, 'a.ts');
    assert.equal(report.head.edges[0].target, 'b.ts');
    assert.equal(report.changes.removed[0].target, 'a.ts');
    assert.equal(report.changes.added[0].target, 'b.ts');
    assert.equal(report.unchangedConsumers.head[0].source.file, 'consumer.ts');
    fs.writeFileSync(path.join(fixture.root, 'tsconfig.json'), config('a.ts'));
    fs.writeFileSync(path.join(fixture.root, 'consumer.ts'), 'throw new Error("must not execute");');
    const again = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid });
    assert.deepEqual(again.head.edges, report.head.edges);
    assert.equal(again.range.dirtyWorkingTreeExcluded, true);
});

test('source evidence pins exact UTF16 ranges, digest, blob and navigation revision', t => {
    const before = { 'entry.ts': 'const emoji = "🦕";\nimport "./a";', 'a.ts': 'export const n = 1;' };
    const after = { ...before, 'entry.ts': 'const emoji = "🦕";\nimport "./b";', 'b.ts': 'export const n = 2;' };
    const { fixture, report } = analyze(t, before, after);
    for (const snapshot of [report.base, report.head]) {
        for (const edge of snapshot.edges) {
            const source = edge.source;
            const blob = execFileSync('git', ['cat-file', 'blob', source.blobOid], { cwd: fixture.root, encoding: 'utf8' });
            const span = blob.slice(source.start, source.end);
            assert.match(span, /import "\.\/[ab]"/);
            assert.equal(source.digest, createHash('sha256').update(span).digest('hex'));
            assert.equal(source.line, 2);
            const link = parseDeepLink(source.link);
            assert.equal(link.file, 'entry.ts');
            assert.equal(link.revision, snapshot.oid);
            assert.equal(link.line, 2);
        }
    }
});

test('Git renames align module identity without inventing an edge delta', t => {
    const lib = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;';
    const { report } = analyze(t,
        { 'lib.ts': lib, 'consumer.ts': 'import { a } from "./lib";\nexport { a };' },
        { 'moved.ts': lib, 'consumer.ts': 'import { a } from "./moved";\nexport { a };' });
    assert.equal(report.base.edges[0].target, 'lib.ts');
    assert.equal(report.head.edges[0].target, 'moved.ts');
    assert.deepEqual(report.changes, { added: [], removed: [] });
});

test('eager-to-lazy import changes phase and loading; unknown imports stay visible', t => {
    const shared = { 'lib.ts': 'export const value = 1;' };
    const { report } = analyze(t,
        { ...shared, 'consumer.ts': 'import "./lib";' },
        { ...shared, 'consumer.ts': 'export const load = () => import("./lib");\nimport(name);\nimport "external-package";' });
    assert.equal(report.changes.removed[0].phase, 'module-init');
    const lazy = report.changes.added.find(e => e.target === 'lib.ts');
    assert.equal(lazy.phase, 'invocation');
    assert.equal(lazy.loading, 'deferred');
    assert.ok(report.head.edges.some(e => e.resolution === 'computed'));
    assert.ok(report.head.edges.some(e => e.specifier === 'external-package' && e.resolution === 'unresolved'));
    assert.equal(report.head.coverage.unresolvedEdges, 2);
});

test('nearest config inherits committed extends and respects separate nested config', t => {
    const common = {
        'config/base.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@lib': ['a.ts'] } } }),
        'tsconfig.json': JSON.stringify({ extends: './config/base.json' }),
        'sub/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@lib': ['b.ts'] } } }),
        'root.ts': 'import "@lib";', 'sub/index.ts': 'import "@lib";',
        'a.ts': 'export {};', 'b.ts': 'export {};'
    };
    const { report } = analyze(t, common, { ...common, 'a.ts': 'export const change = 1;' });
    assert.equal(report.head.edges.find(e => e.source.file === 'root.ts').target, 'a.ts');
    assert.equal(report.head.edges.find(e => e.source.file === 'sub/index.ts').target, 'b.ts');
});

test('invalid configs and budgets do not silently become complete results', t => {
    const before = { 'a.ts': 'import "./b";', 'b.ts': 'export {};' };
    const { fixture } = analyze(t, before, { ...before, 'tsconfig.json': '{ "compilerOptions": { "moduleResolution": "not-a-mode" } }' });
    const invalid = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid });
    assert.equal(invalid.head.edges[0].resolution, 'invalid-config');
    assert.ok(invalid.head.diagnostics.some(d => d.code === 'config-invalid'));
    assert.equal(invalid.head.coverage.indexComplete, false);
    assert.match(renderDependencyReport(invalid), /PARTIAL/);
    const limited = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid, limits: { maxFiles: 1 } });
    assert.equal(limited.head.coverage.indexComplete, false);
    assert.ok(limited.head.coverage.omittedFiles > 0);
    assert.match(renderDependencyReport(limited), /PARTIAL/);
    assert.throws(() => buildDependencyGraph(fixture.root, { limits: { maxFiles: 0 } }), /maxFiles/);
});

test('throwing config parser failures remain partial evidence on either revision', t => {
    const files = { 'a.ts': 'import "./b";', 'b.ts': 'export {};' };
    const invalid = { ...files, 'tsconfig.json': '{"references":[null]}' };
    for (const [before, after, side] of [[invalid, files, 'base'], [files, invalid, 'head']]) {
        const { report } = analyze(t, before, after);
        assert.equal(report[side].edges[0].resolution, 'invalid-config');
        assert.equal(report[side].coverage.indexComplete, false);
        assert.ok(report[side].diagnostics.some(d => d.code === 'config-invalid' && d.file === 'tsconfig.json'));
        assert.equal(report[side === 'base' ? 'head' : 'base'].edges[0].target, 'b.ts');
        assert.match(renderDependencyReport(report), /PARTIAL/);
    }
});

test('omitted package metadata makes coverage partial even when all source files are indexed', t => {
    const files = { 'a.ts': 'import "./b";', 'b.ts': 'export {};', 'package.json': JSON.stringify({ description: 'x'.repeat(100) }) };
    const { report } = analyze(t, files, { ...files, 'b.ts': 'export const n = 1;' }, { limits: { maxFileBytes: 50 } });
    assert.equal(report.head.coverage.omittedFiles, 0);
    assert.equal(report.head.coverage.indexComplete, false);
    assert.ok(report.head.diagnostics.some(d => d.code === 'file-omitted' && d.file === 'package.json'));
});

test('dependency time budget includes Git range discovery', t => {
    const fixture = correspondenceFixture({ before: { 'a.ts': 'export {};' }, after: { 'a.ts': 'export const n = 1;' } });
    t.after(() => fixture.dispose());
    let elapsed = 0;
    const clock = t.mock.method(Date, 'now', () => { elapsed += 10; return elapsed; });
    try {
        assert.throws(() => buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid, limits: { timeoutMs: 10 } }), /time budget exhausted during Git range discovery/);
    } finally { clock.mock.restore(); }
});

test('CLI and tour context opt in to dependency evidence without changing ordinary context', t => {
    const { fixture } = analyze(t,
        { 'a.ts': 'export const n = 1;', 'consumer.ts': 'import "./a";' },
        { 'a.ts': 'export const n = 2;', 'consumer.ts': 'import "./a";' });
    let output = '';
    const stream = { write: text => { output += text; } };
    runDependenciesCommand(['--base', fixture.range.baseOid, '--json'], fixture.root, stream);
    assert.equal(JSON.parse(output).unchangedConsumers.head.length, 1);
    output = '';
    const ordinary = runTourCommand(['context', '--base', fixture.range.baseOid], fixture.root, path.resolve(__dirname, '..'), stream).context;
    output = '';
    const gitCalls = [];
    const gitMock = t.mock.method(require('node:child_process'), 'execFileSync', (command, args, options) => {
        if (command === 'git') gitCalls.push(args);
        return execFileSync(command, args, options);
    });
    const enhanced = runTourCommand(['context', '--base', fixture.range.baseOid, '--dependencies'], fixture.root, path.resolve(__dirname, '..'), stream).context;
    gitMock.mock.restore();
    assert.equal(gitCalls.filter(args => args[0] === '--no-replace-objects' && args[1] === 'rev-parse' && args[2] === '--show-toplevel').length, 1);
    assert.equal(ordinary.dependencies, undefined);
    assert.equal(enhanced.dependencies.range.headOid, ordinary.range.headOid);
    assert.equal(enhanced.dependencies.version, 2);
    assert.equal(enhanced.dependencyChanges.version, 1);
    assert.deepEqual(enhanced.dependencyChanges.range, {
        baseOid: fixture.range.baseOid,
        headOid: fixture.range.headOid
    });
    assert.ok(Array.isArray(enhanced.dependencyChanges.changes.added));
    assert.ok(Array.isArray(enhanced.dependencyChanges.changes.removed));
    assert.ok(Array.isArray(enhanced.dependencyChanges.changes.unknown));
    assert.deepEqual(enhanced.files, ordinary.files);
    assert.throws(() => runDependenciesCommand(['--unknown'], fixture.root, stream), /Unexpected/);
});


test('symlinks are never followed and malformed source makes indexing partial', t => {
    const before = { 'entry.ts': 'import "./linked";', 'broken.ts': 'export {};' };
    const { fixture } = analyze(t, before, { ...before, 'broken.ts': 'const x = ;' });
    fs.symlinkSync(path.join(fixture.root, 'broken.ts'), path.join(fixture.root, 'linked.ts'));
    execFileSync('git', ['add', 'linked.ts'], { cwd: fixture.root });
    execFileSync('git', ['commit', '-m', 'Symlink fixture'], { cwd: fixture.root, stdio: 'pipe' });
    const report = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid });
    assert.equal(report.head.edges[0].resolution, 'unresolved');
    assert.equal(report.head.coverage.omittedFiles, 1);
    assert.equal(report.head.coverage.indexComplete, false);
    assert.ok(report.head.diagnostics.some(d => d.code === 'file-omitted' && d.file === 'linked.ts'));
    assert.ok(report.head.diagnostics.some(d => d.code.startsWith('ts-')));
});

test('record limits retain diagnostics and report incomplete indexing even within the last file', t => {
    const { report } = analyze(t, { 'entry.ts': 'import "a";' }, { 'entry.ts': 'import "a"; import "b"; import "c";' }, { limits: { maxRecords: 1 } });
    assert.equal(report.head.edges.length, 1);
    assert.equal(report.head.coverage.indexComplete, false);
    assert.ok(report.head.diagnostics.some(d => d.code === 'record-or-time-budget'));
});

test('NodeNext resolution reads committed package mode and substitutes explicit JavaScript extensions', t => {
    const files = {
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } }),
        'entry.ts': 'import "./lib"; import "./lib.js";', 'lib.ts': 'export {};'
    };
    const { report } = analyze(t,
        { ...files, 'package.json': '{"type":"commonjs"}' },
        { ...files, 'package.json': '{"type":"module"}' });
    assert.equal(report.base.edges[0].target, 'lib.ts');
    assert.equal(report.head.edges[0].resolution, 'unresolved');
    assert.equal(report.head.edges[1].target, 'lib.ts');
});

test('modern bundler options and using syntax retain committed internal targets', t => {
    const files = {
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', noUncheckedSideEffectImports: true } }),
        'entry.ts': 'import { resource } from "./lib";\nusing value = resource();',
        'lib.ts': 'export const resource = () => null;'
    };
    const { report } = analyze(t, files, { ...files, 'lib.ts': 'export const resource = () => undefined;' });
    assert.equal(report.head.edges[0].target, 'lib.ts');
    assert.equal(report.head.coverage.indexComplete, true);
    assert.deepEqual(report.head.diagnostics, []);
});

test('unrelated JSON does not consume source and resolver input budgets', t => {
    const files = { 'entry.ts': 'import "./lib";', 'lib.ts': 'export {};', 'package-lock.json': 'x'.repeat(1000), 'data.json': 'x'.repeat(1000) };
    const { report } = analyze(t, files, { ...files, 'lib.ts': 'export const n = 1;' }, { limits: { maxFiles: 2, maxFileBytes: 50, maxBytes: 100 } });
    assert.equal(report.head.coverage.indexComplete, true);
    assert.equal(report.head.edges[0].target, 'lib.ts');
    assert.deepEqual(report.head.diagnostics, []);
});

test('relative config inheritance loads transitive and array parents within bounds', t => {
    const files = {
        'tsconfig.json': '{"extends":["./config/first","./config/second.json"]}',
        'config/first.json': '{"extends":"./ancestor"}',
        'config/ancestor.json': '{"compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}',
        'config/second.json': '{"compilerOptions":{"baseUrl":"..","paths":{"@lib":["lib.ts"]}}}',
        'entry.ts': 'import "@lib";', 'lib.ts': 'export {};'
    };
    const { fixture, report } = analyze(t, files, { ...files, 'lib.ts': 'export const n = 1;' });
    assert.equal(report.head.coverage.indexComplete, true);
    assert.equal(report.head.edges[0].target, 'lib.ts');
    const bounded = buildDependencyGraph(fixture.root, { baseRef: fixture.range.baseOid, limits: { maxFiles: 3 } });
    assert.equal(bounded.head.coverage.indexComplete, false);
});

test('malformed package metadata cannot silently invent CommonJS resolution', t => {
    const files = { 'entry.ts': 'import "./lib";\nimport "./lib.js";', 'lib.ts': 'export {};', 'package.json': '{"type":"module"}',
        'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}' };
    for (const invalid of ['{"type":', 'null', '[]']) {
        const { report } = analyze(t, files, { ...files, 'package.json': invalid });
        assert.equal(report.head.coverage.indexComplete, false);
        assert.ok(report.head.diagnostics.some(d => d.code === 'package-invalid'));
        assert.ok(report.head.edges.every(e => e.resolution === 'invalid-config' && e.target === undefined));
    }
});

test('unrelated package metadata does not displace sources; directory-import metadata is loaded on demand', t => {
    const files = { 'entry.ts': 'import "./lib";', 'lib.ts': 'export {};', 'unrelated/package.json': '{"invalid":' };
    const { report } = analyze(t, files, { ...files, 'lib.ts': 'export const n = 1;' }, { limits: { maxFiles: 2 } });
    assert.equal(report.head.coverage.indexComplete, true);
    assert.equal(report.head.coverage.indexedFiles, 2);
    const directory = { ...files, 'entry.ts': 'import "./adapter";', 'adapter/package.json': '{"main":"../lib.ts"}' };
    const { report: resolved } = analyze(t, directory, { ...directory, 'lib.ts': 'export const n = 1;' });
    assert.equal(resolved.head.edges[0].target, 'lib.ts');
    const { report: limited } = analyze(t, directory, { ...directory, 'lib.ts': 'export const n = 1;' }, { limits: { maxFiles: 2 } });
    assert.equal(limited.head.coverage.indexComplete, false);
    assert.equal(limited.head.edges[0].resolution, 'invalid-config');
    assert.equal(limited.head.edges[0].target, undefined);
});
