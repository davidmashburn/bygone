const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { correspondenceFixture } = require('./correspondenceFixture');
const { buildNativeDependencyView, dependencySource } = require('../cli/dependency-native');

test('native analysis pins the selected endpoints even when they are not ancestor commits', async () => {
    const f = correspondenceFixture({ before: { 'app.py': 'def before():\n    pass\n' }, after: { 'app.py': 'def after():\n    pass\n' } });
    try {
        execFileSync('git', ['checkout', '-b', 'sibling', f.range.baseOid], { cwd: f.root });
        fs.writeFileSync(path.join(f.root, 'app.py'), 'def sibling():\n    pass\n');
        execFileSync('git', ['commit', '-am', 'sibling'], { cwd: f.root });
        const sibling = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.root, encoding: 'utf8' }).trim();
        const { report, html, changes } = await buildNativeDependencyView(f.root, { baseOid: sibling, headOid: f.range.headOid, focus: { file: 'app.py' } });
        assert.equal(report.base.oid, sibling);
        assert.equal(report.head.oid, f.range.headOid);
        assert.ok(report.base.nodes.some(n => n.name === 'sibling'));
        assert.ok(report.head.nodes.some(n => n.name === 'after'));
        assert.ok(changes);
        assert.match(html, /dependencySource/);
        const anchor = report.head.nodes[0].source;
        assert.equal(dependencySource(report, { ...anchor, link: 'file:///etc/passwd', line: 900 }), anchor);
        assert.equal(dependencySource(report, { ...anchor, oid: sibling }), undefined);
        assert.equal(dependencySource(report, { ...anchor, file: '../secret' }), undefined);
        assert.equal(dependencySource(report, { ...anchor, digest: 'forged' }), undefined);
        await assert.rejects(buildNativeDependencyView(f.root, { baseOid: 'WORKTREE', headOid: sibling }), /pinned commit/);
    } finally { f.dispose(); }
});

test('native view joins pinned correspondence to changed calls and affected consumers', async () => {
    const { dependencyIntegrationFixture } = require('./dependencyIntegrationFixture');
    const f = await dependencyIntegrationFixture();
    try {
        assert.deepEqual(f.changes.changes.added.map(c => [c.consumer.name, c.target.name]), [['run', 'beta']]);
        assert.deepEqual(f.changes.changes.removed.map(c => [c.consumer.name, c.target.name]), [['run', 'alpha']]);
        assert.ok(f.changes.affectedConsumers.some(c => c.after?.name === 'run' && c.added.length === 1 && c.removed.length === 1));
        const data = JSON.parse(f.html.match(/<script id="settings" type="application\/json">(.*?)<\/script>/s)[1]);
        assert.equal(data.changes.changes.added[0].target.name, 'beta');
        assert.equal(data.focus.file, 'app.ts');
    } finally { f.dispose(); }
});

test('native analysis ignores Git replacement objects and cancels pending workers', async () => {
    const f = correspondenceFixture({ before: { 'app.py': 'def original():\n    pass\n' }, after: { 'app.py': 'def replacement():\n    pass\n' } });
    try {
        execFileSync('git', ['replace', f.range.baseOid, f.range.headOid], { cwd: f.root });
        const options = { baseOid: f.range.baseOid, headOid: f.range.headOid };
        const { report } = await buildNativeDependencyView(f.root, options);
        assert.ok(report.base.nodes.some(n => n.name === 'original'));
        assert.ok(!report.base.nodes.some(n => n.name === 'replacement'));
        const { readPinnedFile } = require('../out/reviewWorkspace');
        const pinned = readPinnedFile(f.root, f.range.baseOid, 'app.py');
        assert.equal(report.base.nodes[0].source.blobOid, pinned.blob);
        const controller = new AbortController();
        const pending = buildNativeDependencyView(f.root, { ...options, signal: controller.signal });
        controller.abort();
        await assert.rejects(pending, /cancelled/);
        await assert.rejects(buildNativeDependencyView(f.root, { ...options, signal: controller.signal }), /cancelled/);
    } finally { f.dispose(); }
});


test('tour dependency context and legacy graph ignore replacement history and source bytes', () => {
    const f = correspondenceFixture({ before: { 'app.py': 'def original():\n    pass\n' }, after: { 'app.py': 'def replacement():\n    pass\n' } });
    try {
        const { runTourCommand } = require('../cli/tour');
        const { buildDependencyGraph } = require('../out/dependencyGraph');
        const context = () => runTourCommand(['context', '--base', f.range.baseOid, '--dependencies'], f.root, path.resolve(__dirname, '..'), { write() {} }).context;
        const before = context();
        const graphBefore = buildDependencyGraph(f.root, { baseRef: f.range.baseOid });
        execFileSync('git', ['replace', f.range.baseOid, f.range.headOid], { cwd: f.root });
        const after = context();
        assert.deepEqual(after.range, before.range);
        assert.deepEqual(after.files, before.files);
        assert.deepEqual(after.commits, before.commits);
        assert.deepEqual(after.dependencies.base.nodes, before.dependencies.base.nodes);
        assert.deepEqual(after.dependencies.head.nodes, before.dependencies.head.nodes);
        const graphAfter = buildDependencyGraph(f.root, { baseRef: f.range.baseOid });
        assert.deepEqual(graphAfter.base, graphBefore.base);
        assert.deepEqual(graphAfter.head, graphBefore.head);
    } finally { f.dispose(); }
});


test('desktop graph server restricts routes and script hashes and closes its listener', async () => {
    const { serveDependencyHtml } = require('../cli/dependency-server');
    const html = '<!doctype html><script>document.title="graph";</script>';
    const served = await serveDependencyHtml(html);
    try {
        const response = await fetch(served.url);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), html);
        assert.match(response.headers.get('content-security-policy'), /script-src 'sha256-/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await fetch(new URL('/wrong', served.url))).status, 404);
        assert.equal((await fetch(served.url, { method: 'POST' })).status, 404);
        const wrongHostStatus = await new Promise((resolve, reject) => {
            require('node:http').get(served.url, { headers: { Host: 'example.test' } }, response => {
                response.resume(); resolve(response.statusCode);
            }).on('error', reject);
        });
        assert.equal(wrongHostStatus, 404);
    } finally { served.dispose(); }
    await assert.rejects(fetch(served.url));
});
