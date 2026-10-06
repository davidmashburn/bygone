const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { createHash } = require('node:crypto');
const { exportTour, materializeTour } = require('../cli/tourExport');
const { exportFixture } = require('./exportFixture');
const { pinTourSource } = require('../out/changeTour');
const historyModule = import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [path.resolve(__dirname, '../web/exportHistory.js')], bundle: true, write: false, format: 'esm' }).outputFiles[0].contents).toString('base64'));
function hydrate(data) {
    return JSON.parse(JSON.stringify(data), (_key, value) => value && typeof value.$text === 'string' ? data.texts[value.$text] : value);
}

test('Minimal captures all authored modes, Full retains bounded history including reverted paths', async () => {
    const f = exportFixture();
    try {
        const before = fs.readFileSync(f.sourcePath, 'utf8');
        const minimal = materializeTour(f.sourcePath, 'minimal');
        assert.equal(minimal.history, undefined);
        assert.equal(minimal.manifest.repository, undefined);
        assert.ok(minimal.manifest.tours.historical && minimal.manifest.tours.deconstructed);
        assert.ok(!JSON.stringify(minimal).includes(f.root), 'No local repository binding is exported');
        for (const [id, text] of Object.entries(minimal.texts)) assert.equal(createHash('sha256').update(text).digest('hex'), id);
        assert.equal(materializeTour(f.sourcePath, 'minimal').contentId, minimal.contentId, 'Build time does not change evidence identity');
        const full = materializeTour(f.sourcePath, 'full');
        assert.equal(full.history.commits.length, 3);
        assert.ok(!full.history.snapshots[f.outside]);
        assert.ok(full.history.paths.includes('transient.txt'));
        const { createExportHistory } = await historyModule;
        const history = createExportHistory(hydrate(full));
        const delta = await history('diff', { commit: f.middle, path: 'app.txt' });
        assert.equal(delta.leftContent, 'alpha\nbeta\n');
        assert.equal(delta.rightContent, 'alpha\nintermediate\n');
        await assert.rejects(history('diff', { commit: f.base, path: 'app.txt' }), /outside/);
        await assert.rejects(history('diff', { commit: f.head, path: 'binary.dat' }), /Binary/);
        await assert.rejects(history('diff', { commit: f.head, path: 'large.txt' }), /2 MiB/);
        await assert.rejects(history('compare-many', { commits: [f.base, f.outside] }), /outside/);
        const comparison = await history('compare-many', { commits: [f.base, f.middle, f.head] });
        const changed = await history('changed-files', { commits: [f.base, f.middle, f.head] });
        assert.deepEqual(changed.paths, comparison.files.map(file => file.path));
        assert.deepEqual((await history('changed-files', { commits: [f.head, f.head] })).paths, []);
        assert.ok(!(await history('changed-files', { commits: [f.base, f.head] })).paths.includes('transient.txt'));
        await assert.rejects(history('changed-files', { commits: [f.base, f.outside] }), /outside/);
        assert.deepEqual(comparison.files.find(file => file.path === 'transient.txt').comparisonPanels.map(panel => panel.content), ['', 'only in history\n', '']);
        assert.equal(comparison.files.find(file => file.path === 'old.txt').changeKind, 'deleted');
        assert.equal(comparison.files.find(file => file.path === 'new.txt').changeKind, 'added');
        const minHistory = createExportHistory(hydrate(minimal));
        await assert.rejects(minHistory('list', {}), /not included/);
        await assert.rejects(minHistory('compare-many', { commits: [f.base, f.head], path: 'not-packaged' }), /outside/);
        await assert.rejects(minHistory('compare-many', { commits: [f.head, f.base] }), /fixed/);
        const endpoints = await minHistory('compare-many', { commits: [f.base, f.head] });
        assert.equal(endpoints.files.find(file => file.path === 'app.txt').comparisonPanels[1].content, 'alpha\nBETA\n');
        assert.equal(fs.readFileSync(f.sourcePath, 'utf8'), before);
        f.git('branch', '-f', 'export-head', f.middle);
        assert.equal(hydrate(minimal).manifest.range.headOid, f.head, 'An export is independent of subsequently moved refs');
    } finally { f.dispose(); }
});

test('HTML is safely serialized, pinned and protected from accidental overwrite', () => {
    const f = exportFixture();
    try {
        const output = path.join(f.root, 'tour.html');
        const packageRoot = path.resolve(__dirname, '..');
        exportTour(f.sourcePath, output, packageRoot);
        const html = fs.readFileSync(output, 'utf8');
        assert.match(html, /Export &lt;fixture&gt;/);
        assert.ok(!html.includes('Read </script> safely.'));
        assert.match(html, /connect-src 'none'/);
        assert.match(html, /Full file contents, including surrounding\/deleted code/);
        const temporary = `${output}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, 'another writer');
        assert.throws(() => exportTour(f.sourcePath, output, packageRoot, { overwrite: true }), /EEXIST/);
        assert.equal(fs.readFileSync(temporary, 'utf8'), 'another writer');
        fs.unlinkSync(temporary);
        const payload = JSON.parse(html.match(/<script id="bygone-export-data" type="application\/json">(.*?)<\/script>/s)[1]);
        assert.equal(payload.profile, 'minimal');
        assert.ok(payload.assets.every(asset => asset.base64 && /^sha256-/.test(asset.integrity)));
        assert.throws(() => exportTour(f.sourcePath, output, packageRoot), /Output exists/);
        assert.throws(() => exportTour(f.sourcePath, f.sourcePath, packageRoot, { overwrite: true }), /authored source/);
        const alias = path.join(f.root, 'alias.bygone');
        fs.symlinkSync(f.sourcePath, alias);
        assert.throws(() => exportTour(alias, f.sourcePath, packageRoot, { overwrite: true }), /authored source/);
        assert.throws(() => exportTour(f.sourcePath, output, packageRoot, { runtime: 'cdn' }), /published/);
        assert.throws(() => exportTour(f.sourcePath, output, packageRoot, { runtime: 'cdn', runtimeBase: 'https://cdn.jsdelivr.net/npm/@davmash/bygone@999.0.0/' }), /match/);
    } finally { f.dispose(); }
});

test('pinning reuses one mapping across authored modes and leaves the source untouched', () => {
    const f = exportFixture();
    try {
        const source = JSON.parse(JSON.stringify(f.source));
        const stack = { id: 'stack', kind: 'stacked-diff', stack: [{ id: 'a', ref: 'export-base' }, { id: 'b', ref: 'export-head' }] };
        source.chapters[0].scenes = [stack];
        source.tours.historical.chapters[0].scenes = [JSON.parse(JSON.stringify(stack))];
        const pinned = pinTourSource(source, f.root, new Map([['export-base', f.base], ['export-head', f.head]]), f.base, f.head);
        assert.equal(pinned.chapters[0].scenes[0].stack[1].ref, f.head);
        assert.equal(pinned.tours.historical.chapters[0].scenes[0].stack[1].ref, f.head);
        assert.equal(source.chapters[0].scenes[0].stack[1].ref, 'export-head');
    } finally { f.dispose(); }
});


test('Full export retains both merge parents and compares the first-parent snapshot', async () => {
    const f = exportFixture();
    try {
        f.git('checkout', '-b', 'side', f.middle);
        fs.writeFileSync(path.join(f.root, 'side.txt'), 'side evidence\n');
        f.git('add', 'side.txt'); f.git('commit', '-m', 'Side branch');
        const side = f.git('rev-parse', 'HEAD');
        f.git('checkout', '--detach', f.head); f.git('merge', '--no-ff', 'side', '-m', 'Merge side');
        const merge = f.git('rev-parse', 'HEAD');
        f.git('branch', '-f', 'export-head', merge);
        delete f.source.tours.deconstructed;
        fs.writeFileSync(f.sourcePath, JSON.stringify(f.source));
        const full = materializeTour(f.sourcePath, 'full');
        assert.deepEqual(full.history.commits.find(commit => commit.oid === merge).parents, [f.head, side]);
        const { createExportHistory } = await historyModule;
        const history = createExportHistory(hydrate(full));
        const delta = await history('diff', { commit: merge, path: 'side.txt' });
        assert.equal(delta.leftContent, '');
        assert.equal(delta.rightContent, 'side evidence\n');
        assert.ok((await history('list', {})).entries.some(commit => commit.oid === side));
    } finally { f.dispose(); }
});
