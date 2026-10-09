const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { createHash } = require('node:crypto');
const { exportTour, materializeTour } = require('../cli/tourExport');
const { exportFixture } = require('./exportFixture');
const { pinTourSource } = require('../out/changeTour');
const { createWorkspaceHistory } = require('../out/workspaceHistory');
const { createTourHistory } = require('../cli/tourHistory');
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
        const overview = await history('changed-files', { commits: [f.base, f.middle, f.head], includeEntries: true });
        assert.deepEqual(overview.entries.find(entry => entry.relativePath === 'transient.txt').sides, [false, true, false]);
        assert.ok(overview.entries.some(entry => entry.relativePath === 'binary.dat'), 'Binary changes remain visible in the overview');
        assert.deepEqual(comparison.entries, overview.entries, 'Compare uses the selected revisions for its directory overview');
        assert.deepEqual((await history('compare-many', { commits: [f.base, f.middle, f.head], path: 'app.txt' })).entries.map(entry => entry.relativePath), ['app.txt']);
        const revisions = [f.base, f.middle, f.head];
        const desktop = createWorkspaceHistory({ repoRoot: f.root, paths: [{ path: '', type: 'directory' }],
            revisions, headOid: f.head, activeRevision: f.head });
        const liveTour = createTourHistory({ ...hydrate(full).manifest, repository: { root: f.root } });
        assert.deepEqual(desktop.directoryEntries(revisions), overview.entries, 'Desktop and export use the same overview contract');
        assert.deepEqual(liveTour.changedFiles({ commits: revisions, includeEntries: true }).entries, overview.entries,
            'Live and exported tours use the same overview contract');
        const liveComparison = liveTour.compareMany({ commits: revisions });
        assert.deepEqual(liveComparison.entries.find(entry => entry.relativePath === 'new.txt').sides, [true, true, true],
            'Live Compare follows the rename under its final path');
        assert.deepEqual(liveComparison.entries.find(entry => entry.relativePath === 'transient.txt').sides, [false, true, false]);
        const minHistory = createExportHistory(hydrate(minimal));
        await assert.rejects(minHistory('list', {}), /not included/);
        await assert.rejects(minHistory('compare-many', { commits: [f.base, f.head], path: 'not-packaged' }), /outside/);
        await assert.rejects(minHistory('compare-many', { commits: [f.head, f.base] }), /fixed/);
        const endpoints = await minHistory('compare-many', { commits: [f.base, f.head] });
        assert.equal(endpoints.files.find(file => file.path === 'app.txt').comparisonPanels[1].content, 'alpha\nBETA\n');
        assert.deepEqual(endpoints.entries.find(entry => entry.relativePath === 'new.txt').sides, [true, true], 'Minimal Compare follows the exported rename');
        assert.deepEqual(endpoints.entries.find(entry => entry.relativePath === 'binary.dat').sides, [false, true]);
        assert.ok(endpoints.entries.some(entry => entry.relativePath === 'binary.dat'));
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

test('image steps embed pinned Git PNGs in both export profiles and ignore dirty files', () => {
    const f = exportFixture();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
    try {
        fs.writeFileSync(path.join(f.root, 'screen.png'), png);
        f.git('add', 'screen.png'); f.git('commit', '-m', 'Add screenshot');
        const imageHead = f.git('rev-parse', 'HEAD');
        const source = JSON.parse(JSON.stringify(f.source));
        source.range.head = imageHead;
        delete source.tours;
        source.chapters[0].scenes[0].steps[0].image = { file: 'screen.png', revision: 'head', alt: 'A one pixel test screenshot' };
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        fs.writeFileSync(path.join(f.root, 'screen.png'), 'dirty non-image');
        for (const profile of ['minimal', 'full']) {
            const data = hydrate(materializeTour(f.sourcePath, profile));
            const image = data.manifest.scenes[0].steps[0].image;
            assert.equal(image.revision, imageHead);
            assert.equal(image.dataUrl, `data:image/png;base64,${png.toString('base64')}`);
            assert.deepEqual(data.manifest.tours.historical.scenes[0].steps[0].image, image);
        }
        const step = source.chapters[0].scenes[0].steps[0];
        for (const file of ['../screen.png', '/screen.png', 'C:\\screen.png', 'https://example.test/screen.png']) {
            step.image.file = file;
            fs.writeFileSync(f.sourcePath, JSON.stringify(source));
            assert.throws(() => materializeTour(f.sourcePath, 'minimal'), /repository-relative/);
        }
        step.image.file = 'screen.png'; step.image.revision = 'base';
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        assert.throws(() => materializeTour(f.sourcePath, 'minimal'), /screen.png/);
        source.range.base = imageHead;
        fs.writeFileSync(path.join(f.root, 'app.txt'), 'alpha\nNEW\n');
        fs.writeFileSync(path.join(f.root, 'screen.png'), 'x'.repeat(100));
        f.git('add', 'app.txt', 'screen.png'); f.git('commit', '-m', 'Change screenshot and prose');
        source.range.head = f.git('rev-parse', 'HEAD');
        source.anchors.changed.contains = 'NEW';
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        assert.equal(hydrate(materializeTour(f.sourcePath, 'minimal')).manifest.scenes[0].steps[0].image.revision, imageHead);
        step.image.revision = 'head';
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        assert.throws(() => materializeTour(f.sourcePath, 'minimal'), /PNG/);
        fs.writeFileSync(path.join(f.root, 'screen.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
        f.git('add', 'screen.png'); f.git('commit', '-m', 'Oversized screenshot');
        source.range.head = f.git('rev-parse', 'HEAD');
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        assert.throws(() => materializeTour(f.sourcePath, 'minimal'), /8 MiB/);
    } finally { f.dispose(); }
});

test('compiled image evidence rejects remote URLs, non-PNG data and excessive dimensions', () => {
    const { buildChangeTourManifest, parseChangeTourManifest } = require('../out/changeTour');
    const f = exportFixture();
    try {
        const manifest = buildChangeTourManifest(f.root, { source: f.source });
        const step = manifest.scenes[0].steps[0];
        step.image = { path: 'screen.png', revision: f.head, alt: 'Screenshot', dataUrl: 'https://example.test/image.png' };
        assert.throws(() => parseChangeTourManifest(manifest), /embedded PNG/);
        step.image.dataUrl = 'data:image/png;base64,' + Buffer.alloc(36).toString('base64');
        assert.throws(() => parseChangeTourManifest(manifest), /IHDR/);
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=', 'base64');
        png.writeUInt32BE(16385, 16);
        step.image.dataUrl = 'data:image/png;base64,' + png.toString('base64');
        assert.throws(() => parseChangeTourManifest(manifest), /dimension/);
    } finally { f.dispose(); }
});
