const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');
const { TextDecoder } = require('util');
const { buildManifestForTourSource, loadTourSource } = require('./tourFile');
const { discoverAuthoredTourDocument } = require('../out/tourDocument');

const ASSETS = ['web/presenter.css', 'media/webview.css', 'web/web-host.js', 'media/webview.js', 'media/editor.worker.js', 'media/diff.worker.js'];
const MAX_BYTES = 128 * 1024 * 1024;
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function json(value) { return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
function html(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function git(root, args, binary = false) {
    return execFileSync('git', args, { cwd: root, encoding: binary ? undefined : 'utf8', maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
}
function buildHistory(root, manifest, texts) {
    const base = manifest.range.mergeBaseOid;
    const head = manifest.range.headOid;
    const refs = new Set([head, ...git(root, ['rev-list', '--topo-order', `${base}..${head}`, '--']).trim().split('\n').filter(Boolean), base]);
    function collect(value) {
        if (!value || typeof value !== 'object') return;
        if (value.kind === 'stacked-diff') value.stack.forEach(panel => refs.add(panel.oid));
        if (value.kind === 'deconstructed-diff') value.panels.forEach(panel => { if (panel.oid) refs.add(panel.oid); });
        Object.values(value).forEach(child => { if (Array.isArray(child)) child.forEach(collect); else if (child && typeof child === 'object') collect(child); });
    }
    collect(manifest);
    if (refs.size > 256) throw new Error('Full export exceeds the initial 256-revision safety limit. Narrow the tour range.');
    const paths = new Set(manifest.files.flatMap(file => [file.path, file.previousPath].filter(Boolean)));
    function collectPaths(value) {
        if (!value || typeof value !== 'object') return;
        if (typeof value.path === 'string' && value.kind !== 'directory-diff') paths.add(value.path);
        Object.values(value).forEach(child => { if (Array.isArray(child)) child.forEach(collectPaths); else if (child && typeof child === 'object') collectPaths(child); });
    }
    collectPaths(manifest.scenes); collectPaths(manifest.tours); collectPaths(manifest.zoom);
    const commits = [...refs].map(oid => {
        const [parents, summary, timestamp, author, authorEmail] = git(root, ['show', '-s', '--format=%P%x00%s%x00%cI%x00%an%x00%ae', oid, '--']).trimEnd().split('\0');
        const parentIds = parents.split(' ').filter(Boolean);
        // Include changes that disappear in the final endpoint diff, and rename predecessors.
        if (oid !== base) for (const name of git(root, ['diff-tree', '--root', '-m', '--no-commit-id', '-r', '--name-only', '-z', oid, '--']).split('\0').filter(Boolean)) paths.add(name);
        return { oid, commit: oid, parents: parentIds, parentCommit: parentIds[0] || null, shortCommit: oid.slice(0, 7), summary, timestamp, author, authorEmail, message: summary };
    });
    if (paths.size > 4096) throw new Error('Full export exceeds the initial 4096-path safety limit. Narrow the tour.');
    const snapshots = {};
    for (const oid of refs) {
        const tree = new Map(git(root, ['ls-tree', '-r', '-z', oid]).split('\0').filter(Boolean).map(record => {
            const split = record.indexOf('\t');
            const [mode, type, object] = record.slice(0, split).split(' ');
            return [record.slice(split + 1), { mode, type, object }];
        }));
        snapshots[oid] = Object.create(null);
        for (const name of paths) {
            const record = tree.get(name);
            if (!record) { snapshots[oid][name] = null; continue; }
            if (record.type !== 'blob') { snapshots[oid][name] = { omitted: 'Submodule content is not packaged.' }; continue; }
            if (Number(git(root, ['cat-file', '-s', record.object]).trim()) > 2 * 1024 * 1024) { snapshots[oid][name] = { omitted: 'File exceeds 2 MiB.' }; continue; }
            const bytes = git(root, ['cat-file', 'blob', record.object], true);
            let text;
            try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (bytes.includes(0)) throw new Error('binary'); }
            catch { snapshots[oid][name] = { omitted: 'Binary or non-UTF-8 content.' }; continue; }
            if (text.startsWith('version https://git-lfs.github.com/spec/v1\n')) { snapshots[oid][name] = { omitted: 'Git LFS object is not packaged.' }; continue; }
            if (text.split('\n').some(line => Buffer.byteLength(line) > 64 * 1024)) { snapshots[oid][name] = { omitted: 'A line exceeds 64 KiB.' }; continue; }
            const blob = digest(text); texts[blob] = text;
            snapshots[oid][name] = { blob, mode: record.mode, gitBlob: record.object };
        }
        if (Buffer.byteLength(JSON.stringify(texts)) > MAX_BYTES) throw new Error('Export evidence exceeds 128 MiB. Narrow the tour.');
    }
    return { commits, paths: [...paths].sort(), snapshots, comparison: 'Exact paths; renames appear as deletion and addition. Parents outside the included set are unavailable.' };
}
function materializeTour(sourcePath, profile) {
    const document = discoverAuthoredTourDocument(sourcePath);
    const originalBytes = fs.readFileSync(document.documentPath);
    const { source } = loadTourSource(document.repoRoot, document.documentPath);
    const manifest = buildManifestForTourSource(document.repoRoot, source);
    const texts = {};
    const history = profile === 'full' ? buildHistory(document.repoRoot, manifest, texts) : undefined;
    delete manifest.repository;
    delete manifest.localSource;
    // A source URL is optional provenance and may carry credentials or local bindings.
    delete manifest.sourceUrl;
    const contentKeys = new Set(['leftContent', 'rightContent', 'content']);
    function pack(value) {
        if (Array.isArray(value)) return value.map(pack);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).map(([key, child]) => {
            if (contentKeys.has(key) && typeof child === 'string') {
                const id = digest(child); texts[id] = child; return [key, { $text: id }];
            }
            return [key, pack(child)];
        }));
    }
    if (!fs.readFileSync(document.documentPath).equals(originalBytes)) throw new Error('The tour source changed during export. Retry from the saved document.');
    const packed = pack(manifest);
    const identity = { profile, manifest: { ...packed, generatedAt: undefined }, texts, history };
    return { version: 1, profile, contentId: digest(JSON.stringify(identity)), sourceFingerprint: digest(originalBytes), manifest: packed, texts, ...(history ? { history } : {}) };
}
function exportTour(sourcePath, outputPath, packageRoot, options = {}) {
    const profile = options.profile || 'minimal';
    const runtime = options.runtime || 'embedded';
    if (!['minimal', 'full'].includes(profile)) throw new Error('Export profile must be minimal or full.');
    if (!['embedded', 'cdn'].includes(runtime)) throw new Error('Export runtime must be embedded or cdn.');
    const data = materializeTour(sourcePath, profile);
    const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
    const runtimeManifestPath = path.join(packageRoot, 'web', 'export-runtime.json');
    if (!fs.existsSync(runtimeManifestPath)) throw new Error('Export runtime assets are missing. Rebuild Bygone first.');
    const runtimeManifest = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
    if (runtimeManifest.version !== version || runtimeManifest.schema !== 1) throw new Error('Export runtime does not match this Bygone build.');
    if (runtime === 'cdn' && !options.runtimeBase) throw new Error('CDN export requires a published, verified export runtime. Use --runtime embedded until the export-enabled release is published.');
    if (options.runtimeBase && !/^https:\/\/cdn\.jsdelivr\.net\/npm\/@davmash\/bygone@\d+\.\d+\.\d+(?:-[\w.-]+)?\/$/.test(options.runtimeBase)) throw new Error('Runtime base must pin an exact Bygone release on jsDelivr.');
    if (runtime === 'cdn' && options.runtimeBase !== `https://cdn.jsdelivr.net/npm/@davmash/bygone@${version}/`) throw new Error('CDN runtime version must match this exact Bygone build.');
    const assets = ASSETS.map(name => {
        const bytes = fs.readFileSync(path.join(packageRoot, name));
        const integrity = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
        if (runtimeManifest.assets[name] !== integrity) throw new Error(`Runtime integrity mismatch: ${name}. Rebuild Bygone.`);
        return { name, integrity, ...(runtime === 'embedded' ? { base64: bytes.toString('base64') } : { url: options.runtimeBase + name }) };
    });
    const payload = { ...data, runtimeVersion: version, assets };
    const summary = `${profile === 'full' ? 'Full' : 'Minimal'} snapshot · ${Object.keys(data.texts).length} unique texts · ${Buffer.byteLength(JSON.stringify(data.texts))} evidence bytes${data.history ? ` · ${data.history.commits.length} revisions · ${data.history.paths.length} paths` : ' · no browsable Git history'}. Full file contents, including surrounding/deleted code, are included.`;
    let shell = fs.readFileSync(path.join(packageRoot, 'web', 'index.html'), 'utf8')
        .replace(/<link href="\/(?:media|web)\/[^"]+" rel="stylesheet">/g, '')
        .replace(/<script src="\/(?:web|media)\/[^"]+"><\/script>/g, '')
        .replace('<title>Bygone Tour</title>', `<title>${html(data.manifest.title)} — Bygone export</title>`);
    const network = runtime === 'cdn' ? ' https://cdn.jsdelivr.net' : '';
    const policy = `default-src 'none'; script-src 'unsafe-inline' blob:${network}; style-src 'unsafe-inline' blob:${network}; font-src data:; img-src data: blob:; worker-src blob:; connect-src${network || " 'none'"}; frame-src 'none'; base-uri 'none'; form-action 'none'`;
    shell = shell.replace('<meta charset="UTF-8">', `<meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`)
        .replace('<body class="web-host">', `<body class="web-host"><div id="export-loading" role="status">Loading ${html(data.manifest.title)}… ${runtime === 'cdn' ? 'Internet required to load the Bygone viewer.' : 'Embedded viewer; no internet required.'} If loading fails, reopen the file or obtain a new export.</div><noscript>This interactive tour requires JavaScript.</noscript>`)
        .replace('<summary>Tour details</summary>', `<summary>Tour details</summary><p class="export-notice">${html(summary)} ${runtime === 'cdn' ? 'Internet required to load the Bygone viewer.' : 'Embedded viewer; no internet required.'} ${html(data.history?.comparison || '')}</p>`);
    const bootstrap = fs.readFileSync(path.join(packageRoot, 'web', 'export-bootstrap.js'), 'utf8');
    const licenses = fs.readFileSync(path.join(packageRoot, 'web', 'export-licenses.txt'), 'utf8');
    shell = shell.replace('</body>', `<script id="bygone-export-data" type="application/json">${json(payload)}</script><script>${bootstrap}</script><details class="export-notice"><summary>Runtime licenses</summary><pre>${html(licenses)}</pre></details></body>`);
    if (Buffer.byteLength(shell) > MAX_BYTES) throw new Error('HTML export exceeds the 128 MiB safety limit. Narrow the tour.');
    if (fs.existsSync(outputPath) && !options.overwrite) throw new Error('Output exists. Choose another path or pass --overwrite.');
    if (path.resolve(sourcePath) === path.resolve(outputPath)
        || (fs.existsSync(outputPath) && fs.realpathSync(sourcePath) === fs.realpathSync(outputPath))) throw new Error('Cannot overwrite the authored source.');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    let created = false;
    try {
        fs.writeFileSync(temporary, shell, { flag: 'wx', mode: 0o600 });
        created = true;
        if (options.overwrite) fs.renameSync(temporary, outputPath);
        else fs.linkSync(temporary, outputPath); // Fail atomically if another writer creates the destination.
    }
    finally { if (created) fs.rmSync(temporary, { force: true }); }
    return { outputPath, contentId: data.contentId, profile, runtime, bytes: Buffer.byteLength(shell), summary };
}
module.exports = { exportTour, materializeTour, ASSETS };
