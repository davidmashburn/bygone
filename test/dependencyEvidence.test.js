const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { correspondenceFixture } = require('./correspondenceFixture');
const { buildDependencyEvidence } = require('../out/dependencyEvidence');
const { renderMermaid, renderEvidenceHtml } = require('../cli/dependency-view');
const input = {
    'app.py': 'def target():\r    return "🐍"\r\rdef run():\r    target()\r\rrun()\r',
    'app.ts': 'export function target() { return "🐍"; }\nexport function run() { target(); }\nrun();\n',
    'go.mod': 'module example.test/demo\n\ngo 1.22\n',
    'app.go': 'package main\nfunc target() {}\nfunc main() { target() }\n',
    'app.rs': 'fn target() {}\nfn main() { target(); }\n',
    'app.mojo': 'def target():\n    pass\n\ndef main():\n    target()\n'
};
const fixture = () => correspondenceFixture({ before: input, after: { ...input, 'app.py': input['app.py'] + '# changed\n' } });
test('scopes bound the committed inventory, preserve unknown targets, and respect path boundaries', () => {
    const before = { 'src/app.py': 'from lib import target\ntarget()\n', 'lib.py': 'def target():\n    pass\n',
        'src-extra/other.py': 'pass\n', 'extra/one.py': 'pass\n' };
    const f = correspondenceFixture({ before, after: { ...before, 'src/app.py': before['src/app.py'] + '# changed\n' } });
    try {
        const cli = path.resolve(__dirname, '../bin/bygone.js');
        const report = JSON.parse(execFileSync(process.execPath, [cli, 'dependencies', '--base', f.range.baseOid,
            '--scope', './src/', '--scope', 'extra/one.py', '--json'], { cwd: f.root, encoding: 'utf8' }));
        assert.deepEqual(report.configuration.scopes, ['src', 'extra/one.py']);
        assert.equal(report.head.coverage.candidateFiles, 2);
        assert.equal(report.head.coverage.indexedFiles, 2);
        assert.deepEqual(new Set(report.head.nodes.map(n => n.source.file)), new Set(['src/app.py', 'extra/one.py']));
        assert.notEqual(report.head.sites.find(s => s.relation === 'call').resolution, 'resolved');
        for (const scope of ['../src', '/src', 'C:/src', 'src\\app.py']) {
            assert.throws(() => buildDependencyEvidence(f.root, { baseRef: f.range.baseOid, scopes: [scope] }), /repository-relative/);
        }
        const empty = buildDependencyEvidence(f.root, { baseRef: f.range.baseOid, scopes: ['missing'] });
        assert.equal(empty.head.coverage.candidateFiles, 0);
        assert.equal(empty.head.nodes.length, 0);
    } finally { f.dispose(); }
});
test('multilingual graph keeps committed source anchors and resolved targets valid', () => {
    const f = fixture();
    try {
        fs.writeFileSync(path.join(f.root, 'app.py'), 'raise RuntimeError("working tree must not run")\n');
        const report = buildDependencyEvidence(f.root, { baseRef: f.range.baseOid });
        assert.equal(report.version, 2);
        assert.equal(report.range.dirtyWorkingTreeExcluded, true);
        assert.deepEqual(report.configuration.pythonRoots, ['', 'src']);
        for (const side of ['base', 'head']) {
            const s = report[side];
            assert.equal(s.coverage.indexedFiles, 5, JSON.stringify(s.diagnostics));
            assert.equal(s.coverage.indexComplete, true, JSON.stringify(s.diagnostics));
            assert.deepEqual(new Set(s.nodes.map(n => n.language)), new Set(['python', 'typescript', 'go', 'rust', 'mojo']));
            const pythonEntry = s.sites.find(site => site.source.file === 'app.py' && site.relation === 'call' && site.name === 'run');
            assert.equal(pythonEntry.source.line, 7);
            assert.equal(pythonEntry.source.column, 1);
            const ids = new Set(s.nodes.map(n => n.id));
            for (const item of [...s.nodes, ...s.sites]) {
                const source = item.source;
                const content = execFileSync('git', ['cat-file', 'blob', source.blobOid], { cwd: f.root, encoding: 'utf8' });
                assert.equal(source.oid, s.oid);
                assert.equal(source.digest, createHash('sha256').update(content.slice(source.start, source.end)).digest('hex'));
                assert.ok(source.link?.startsWith('bygone:'));
            }
            for (const site of s.sites) {
                assert.ok(ids.has(site.owner));
                if (site.resolution === 'resolved') assert.ok(ids.has(site.target));
                assert.equal(site.evidence, 'static');
            }
            for (const language of ['python', 'typescript', 'go', 'rust', 'mojo']) {
                const owners = new Set(s.nodes.filter(n => n.language === language).map(n => n.id));
                assert.ok(s.sites.some(site => owners.has(site.owner) && site.relation === 'call' && site.resolution === 'resolved'), language);
            }
        }
    } finally { f.dispose(); }
});
test('omitted sources and record budgets are explicit', () => {
    const f = fixture();
    try {
        const report = buildDependencyEvidence(f.root, { baseRef: f.range.baseOid, limits: { maxFiles: 2, maxRecords: 4 } });
        assert.equal(report.head.coverage.indexComplete, false);
        assert.ok(report.head.coverage.omittedFiles > 0);
        assert.ok(report.head.nodes.length + report.head.sites.length <= 4);
        const ids = new Set(report.head.nodes.map(n => n.id));
        for (const site of report.head.sites) if (site.target) assert.ok(ids.has(site.target));
    } finally { f.dispose(); }
});
test('graph CLI formats are usable and preserve default v1 JSON', () => {
    const f = fixture();
    try {
        const cli = path.resolve(__dirname, '../bin/bygone.js');
        const run = flags => execFileSync(process.execPath, [cli, 'dependencies', '--base', f.range.baseOid, ...flags], { cwd: f.root, encoding: 'utf8' });
        assert.equal(JSON.parse(run(['--json'])).version, 1);
        assert.equal(JSON.parse(run(['--graph', '--json'])).version, 2);
        assert.match(run(['--mermaid']), /^flowchart LR/);
        run(['--html', '--output', 'graph.html']);
        assert.match(fs.readFileSync(path.join(f.root, 'graph.html'), 'utf8'), /Dependency evidence/);
    } finally { f.dispose(); }
});
test('renderers encode repository-controlled markup and disclose visual limits', () => {
    const node = { id: 'id', name: '</script><script>alert(1)</script>', source: { file: 'evil"<file>.py', line: 1, column: 1 }, language: 'python' };
    const snapshot = { nodes: [node], sites: [], producers: [], diagnostics: [], coverage: { indexComplete: false, candidateFiles: 1, indexedFiles: 1, unresolvedSites: 0 } };
    const report = { range: { baseOid: 'abc', headOid: 'def' }, assumptions: [], base: snapshot, head: snapshot };
    const html = renderEvidenceHtml(report);
    assert.ok(!html.includes(node.name));
    assert.match(html, /\\u003c\/script\\u003e/);
    const json = /<script id="report" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
    assert.equal(JSON.parse(json).head.nodes[0].name, node.name);
    const mermaid = renderMermaid(report);
    assert.ok(!mermaid.includes('<script>'));
    assert.match(mermaid, /PARTIAL/);
});

test('malformed source is omitted with partial coverage while other languages survive', () => {
    const before = { 'bad.ts': 'function broken( {', 'good.py': 'def target():\n    pass\ntarget()\n' };
    const f = correspondenceFixture({ before, after: { ...before, 'good.py': before['good.py'] + '# changed\n' } });
    try {
        const report = buildDependencyEvidence(f.root, { baseRef: f.range.baseOid });
        assert.equal(report.head.coverage.indexComplete, false);
        assert.equal(report.head.coverage.indexedFiles, 1);
        assert.equal(report.head.coverage.omittedFiles, 1);
        assert.ok(report.head.diagnostics.some(d => d.file === 'bad.ts' && d.code === 'document-invalid'));
        assert.ok(report.head.sites.some(s => s.relation === 'call' && s.resolution === 'resolved'));
        assert.ok(report.head.nodes.every(n => n.source.file === 'good.py'));
    } finally { f.dispose(); }
});

test('CLI Python roots replace defaults and retain committed cross-file target evidence', () => {
    const before = { 'custom/lib.py': 'def compute():\n    return 1\n', 'main.py': 'from lib import compute\ncompute()\n' };
    const f = correspondenceFixture({ before, after: { ...before, 'main.py': before['main.py'] + '# changed\n' } });
    try {
        const cli = path.resolve(__dirname, '../bin/bygone.js');
        const report = JSON.parse(execFileSync(process.execPath, [cli, 'dependencies', '--base', f.range.baseOid, '--python-root', 'custom', '--json'], { cwd: f.root, encoding: 'utf8' }));
        assert.equal(report.version, 2);
        assert.deepEqual(report.configuration.pythonRoots, ['custom']);
        const call = report.head.sites.find(s => s.relation === 'call' && s.name === 'compute');
        assert.equal(call.resolution, 'resolved');
        assert.equal(report.head.nodes.find(n => n.id === call.target).source.file, 'custom/lib.py');
        assert.throws(() => buildDependencyEvidence(f.root, { baseRef: f.range.baseOid, pythonRoots: ['../outside'] }), /repository-relative/);
    } finally { f.dispose(); }
});
