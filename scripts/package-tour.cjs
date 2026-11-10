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
const PACKAGE_VERSION = Object.freeze({ LEGACY: 1, REVIEW: 2 });
const REVIEW_ARTIFACT = Object.freeze({ EVIDENCE: 'review.json', REPORT: 'report.json', MARKDOWN: 'report.md' });
const REVIEW_ARTIFACTS = Object.values(REVIEW_ARTIFACT);
const REVIEW_VERSION = 2;
const REPORT_VERSION = 1;
const REPORT_KIND = 'advisory-review';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024 }).trim();
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertReviewInventory(value) {
    if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...REVIEW_ARTIFACTS].sort())) {
        throw new Error('Review artifacts require exactly review.json, report.json and report.md');
    }
}
function validateReviewContent(directory, evidence) {
    // These are portable records, not an approval or a re-execution of the review.
    const records = {};
    for (const name of [REVIEW_ARTIFACT.EVIDENCE, REVIEW_ARTIFACT.REPORT]) {
        records[name] = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (!isRecord(records[name])) {
            throw new Error(`Review artifact must contain a JSON object: ${name}`);
        }
    }
    const review = records[REVIEW_ARTIFACT.EVIDENCE], report = records[REVIEW_ARTIFACT.REPORT];
    if (review.version !== REVIEW_VERSION || review.base !== evidence.base || review.head !== evidence.head) {
        throw new Error('Imported review does not match package evidence');
    }
    if (report.schemaVersion !== REPORT_VERSION || report.kind !== REPORT_KIND || !isRecord(report.capture)
        || report.capture.mergeBase !== evidence.base || report.capture.head !== evidence.head
        || typeof report.capture.base !== 'string' || !/^[0-9a-f]{40}$/.test(report.capture.base)) {
        throw new Error('Advisory report does not match package evidence');
    }
    if (!fs.readFileSync(path.join(directory, REVIEW_ARTIFACT.MARKDOWN), 'utf8').trim()) {
        throw new Error('Review Markdown must not be empty');
    }
}
function verifyPackage(directory) {
    const manifestPath = path.join(directory, 'manifest.json');
    if (!fs.lstatSync(manifestPath).isFile()) throw new Error('Not a regular manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    const { digest, ...identity } = manifest;
    if (!Object.values(PACKAGE_VERSION).includes(manifest.schemaVersion) || sha256(JSON.stringify(identity)) !== digest) throw new Error('Package identity mismatch');
    if (manifest.schemaVersion === PACKAGE_VERSION.REVIEW) assertReviewInventory(manifest.reviewArtifacts);
    else if (Object.hasOwn(manifest, 'reviewArtifacts')) throw new Error('Review artifacts require package schemaVersion 2');
    if (JSON.stringify(Object.keys(manifest.artifacts).sort()) !== JSON.stringify([...ARTIFACTS].sort())) throw new Error('Unexpected artifact inventory');
    const inventory = { ...manifest.artifacts, ...(manifest.reviewArtifacts || {}) };
    for (const [name, expected] of Object.entries(inventory)) {
        const file = path.join(directory, name);
        if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular artifact: ${name}`);
        const bytes = fs.readFileSync(file);
        if (!isRecord(expected) || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Artifact integrity mismatch: ${name}`);
    }
    if (!isRecord(manifest.evidence) || JSON.stringify(Object.keys(manifest.evidence).sort()) !== JSON.stringify(['base', 'head']) || !Object.values(manifest.evidence).every(ref => typeof ref === 'string' && /^[0-9a-f]{40}$/.test(ref))) throw new Error('Evidence requires pinned endpoints');
    if (manifest.schemaVersion === PACKAGE_VERSION.REVIEW) validateReviewContent(directory, manifest.evidence);
    const validation = JSON.parse(fs.readFileSync(path.join(directory, 'validation.json')));
    if (validation.result !== 'passed' || validation.range.base !== manifest.evidence.base || validation.range.head !== manifest.evidence.head) throw new Error('Validation does not match evidence');
    return manifest;
}
function buildPackage(sourcePath, bundlePath, metadata, destination, options = {}) {
    const { reviewArtifacts } = options;
    if (fs.existsSync(destination)) throw new Error('Output exists; build a new version or a temporary directory');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Metadata must be an object');
    if (reviewArtifacts !== undefined) assertReviewInventory(reviewArtifacts);
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
        let reviewInventory;
        if (reviewArtifacts !== undefined) {
            reviewInventory = Object.fromEntries(REVIEW_ARTIFACTS.map(name => {
                const file = reviewArtifacts[name];
                if (typeof file !== 'string' || !fs.lstatSync(file).isFile()) throw new Error(`Not a regular review artifact: ${name}`);
                const bytes = fs.readFileSync(file);
                fs.writeFileSync(path.join(stage, name), bytes);
                return [name, { bytes: bytes.length, sha256: sha256(bytes) }];
            }));
            validateReviewContent(stage, source.range);
        }
        const identity = { schemaVersion: reviewInventory ? PACKAGE_VERSION.REVIEW : PACKAGE_VERSION.LEGACY, title: source.title, provenance: metadata,
            evidence: { base: source.range.base, head: source.range.head },
            exporter: { version: require('../package.json').version,
                implementationSha256: sha256(fs.readFileSync(path.join(root, 'cli/tourExport.js'))),
                runtimeManifestSha256: sha256(fs.readFileSync(path.join(root, 'web/export-runtime.json'))) },
            artifacts, ...(reviewInventory ? { reviewArtifacts: reviewInventory } : {}) };
        fs.writeFileSync(path.join(stage, 'manifest.json'), json({ ...identity, digest: sha256(JSON.stringify(identity)) }));
        verifyPackage(stage);
        // Never replace an existing version, even if another builder finished first.
        fs.mkdirSync(destination);
        for (const name of [...ARTIFACTS, ...Object.keys(reviewInventory || {}), 'manifest.json']) fs.renameSync(path.join(stage, name), path.join(destination, name));
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
        else if (action === 'build' && [4, 5].includes(args.length)) result = buildPackage(path.resolve(args[0]), path.resolve(args[1]), JSON.parse(fs.readFileSync(args[2])), path.resolve(args[3]), args[4] ? { reviewArtifacts: Object.fromEntries(REVIEW_ARTIFACTS.map(name => [name, path.resolve(args[4], name)])) } : {});
        else throw new Error('Usage: node scripts/package-tour.cjs build SOURCE BUNDLE METADATA_JSON NEW_OUTPUT_DIR [REVIEW_DIR] | verify DIR');
        console.log(json({ digest: result.digest, evidence: result.evidence, artifacts: result.artifacts }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildPackage, verifyPackage };
