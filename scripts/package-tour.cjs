#!/usr/bin/env node
// Build a portable artifact set from pinned evidence. No publication or network writes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { loadTourSource, buildManifestForTourSource } = require('../cli/tourFile');
const { parseChangeTourManifest } = require('../out/changeTour');
const { exportTour } = require('../cli/tourExport');
const root = path.resolve(__dirname, '..');
const ARTIFACTS = ['tour.bygone.yaml', 'tour.json', 'tour.html', 'evidence.bundle', 'validation.json'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 }).trim();
}
function verifyPackage(directory) {
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.lstatSync(manifestPath).isFile()) throw new Error('Not a regular manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    const { digest, ...identity } = manifest;
    if (manifest.schemaVersion !== 1 || sha256(JSON.stringify(identity)) !== digest) throw new Error('Package identity mismatch');
    if (JSON.stringify(Object.keys(manifest.artifacts).sort()) !== JSON.stringify([...ARTIFACTS].sort())) throw new Error('Unexpected artifact inventory');
    for (const name of ARTIFACTS) {
        const file = path.join(directory, name);
        if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular artifact: ${name}`);
        const bytes = fs.readFileSync(file);
        if (bytes.length !== manifest.artifacts[name].bytes || sha256(bytes) !== manifest.artifacts[name].sha256) throw new Error(`Artifact integrity mismatch: ${name}`);
    }
    if (Object.keys(manifest.evidence).sort().join(',') !== 'base,head' || !Object.values(manifest.evidence).every(ref => typeof ref === 'string' && /^[0-9a-f]{40}$/.test(ref))) throw new Error('Evidence requires pinned endpoints');
    const validation = JSON.parse(fs.readFileSync(path.join(directory, 'validation.json')));
    if (validation.result !== 'passed' || validation.range.base !== manifest.evidence.base || validation.range.head !== manifest.evidence.head) throw new Error('Validation does not match evidence');
    return manifest;
}
function buildPackage(sourcePath, bundlePath, metadata, destination) {
    if (fs.existsSync(destination)) throw new Error('Output exists; build a new version or a temporary directory');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Metadata must be an object');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-tour-package-'));
    let stage;
    try {
        const repo = path.join(temp, 'evidence');
        git(temp, 'clone', '--no-checkout', path.resolve(bundlePath), repo);
        const { source } = loadTourSource(path.dirname(sourcePath), sourcePath);
        for (const ref of [source.range.base, source.range.head]) {
            if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('Package endpoints must be exact commit OIDs');
            git(repo, 'cat-file', '-e', `${ref}^{commit}`);
        }
        git(repo, 'checkout', '--detach', source.range.head);
        const localSource = path.join(repo, 'package-tour.bygone.yaml');
        if (fs.existsSync(localSource)) throw new Error('Evidence collides with packaging source path');
        fs.copyFileSync(sourcePath, localSource);
        const compiled = buildManifestForTourSource(repo, source);
        // Host-independent manifests remain ordinary Bygone compiled documents.
        compiled.repository = { root: '.' }; delete compiled.localSource; delete compiled.sourceUrl;
        const generatedAt = git(repo, 'show', '-s', '--format=%cI', source.range.head);
        compiled.generatedAt = generatedAt;
        parseChangeTourManifest(compiled);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        stage = fs.mkdtempSync(path.join(path.dirname(destination), '.tour-build-'));
        fs.copyFileSync(sourcePath, path.join(stage, 'tour.bygone.yaml'));
        fs.copyFileSync(bundlePath, path.join(stage, 'evidence.bundle'));
        fs.writeFileSync(path.join(stage, 'tour.json'), json(compiled));
        const exported = path.join(stage, 'tour.html');
        exportTour(localSource, exported, root, { profile: 'minimal', runtime: 'embedded' });
        // The viewer identity deliberately excludes generatedAt. Pin this display field
        // to evidence time so repeated builds produce identical artifact bytes.
        const html = fs.readFileSync(exported, 'utf8').replace(/(<script id="bygone-export-data" type="application\/json">)([\s\S]*?)(<\/script>)/, (_all, start, body, end) => {
            const payload = JSON.parse(body); payload.manifest.generatedAt = generatedAt;
            return start + JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + end;
        });
        fs.writeFileSync(exported, html);
        const steps = compiled.scenes.reduce((count, scene) => count + (scene.steps?.length || 0), 0);
        fs.writeFileSync(path.join(stage, 'validation.json'), json({
            result: 'passed', checks: ['fresh bundle clone', 'pinned endpoint existence', 'source compilation and anchors', 'portable manifest parsing'],
            steps, files: compiled.files.length, range: source.range,
            notChecked: ['narrative correctness', 'browser behavior', 'publication and hosted access']
        }));
        const artifacts = Object.fromEntries(ARTIFACTS.map(name => {
            const bytes = fs.readFileSync(path.join(stage, name));
            return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
        }));
        const identity = { schemaVersion: 1, title: source.title, provenance: metadata,
            evidence: { base: source.range.base, head: source.range.head },
            exporter: { version: require('../package.json').version,
                implementationSha256: sha256(fs.readFileSync(path.join(root, 'cli/tourExport.js'))),
                runtimeManifestSha256: sha256(fs.readFileSync(path.join(root, 'web/export-runtime.json'))) },
            artifacts };
        fs.writeFileSync(path.join(stage, 'manifest.json'), json({ ...identity, digest: sha256(JSON.stringify(identity)) }));
        verifyPackage(stage);
        // Never replace an existing version, even if another builder finished first.
        fs.mkdirSync(destination);
        for (const name of [...ARTIFACTS, 'manifest.json']) fs.renameSync(path.join(stage, name), path.join(destination, name));
        return verifyPackage(destination);
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
        if (stage) fs.rmSync(stage, { recursive: true, force: true });
    }
}
if (require.main === module) {
    try {
        const [action, ...args] = process.argv.slice(2);
        let result;
        if (action === 'verify' && args.length === 1) result = verifyPackage(path.resolve(args[0]));
        else if (action === 'build' && args.length === 4) result = buildPackage(path.resolve(args[0]), path.resolve(args[1]), JSON.parse(fs.readFileSync(args[2])), path.resolve(args[3]));
        else throw new Error('Usage: node scripts/package-tour.cjs build SOURCE BUNDLE METADATA_JSON NEW_OUTPUT_DIR | verify DIR');
        console.log(json({ digest: result.digest, evidence: result.evidence, artifacts: result.artifacts }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildPackage, verifyPackage };
