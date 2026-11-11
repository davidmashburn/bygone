const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { exportFixture } = require('./exportFixture');
const { buildPackage, verifyPackage } = require('../scripts/package-tour.cjs');
const { createHash } = require('node:crypto');

function assertSiteRetainsPackage(directory, temporary) {
    const root = path.join(temporary, 'site-fixture');
    const release = path.join(root, 'docs/tours/product/1.0.0');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs/tours/site'), { recursive: true });
    fs.cpSync(directory, release, { recursive: true });
    fs.writeFileSync(path.join(release, 'README.md'), 'Restore the pinned package.\n');
    const manifest = verifyPackage(directory);
    fs.writeFileSync(path.join(root, 'docs/tours/releases.json'), JSON.stringify({ current: '1.0.0', versions: [{ version: '1.0.0', digest: manifest.digest }] }));
    fs.writeFileSync(path.join(root, 'docs/tours/site/index.html'), '<h1>Fixture</h1>');
    fs.copyFileSync(path.join(__dirname, '../scripts/build-tour-site.cjs'), path.join(root, 'scripts/build-tour-site.cjs'));
    fs.symlinkSync(path.join(__dirname, '../scripts/package-tour.cjs'), path.join(root, 'scripts/package-tour.cjs'));
    const output = path.join(temporary, 'built-site');
    execFileSync(process.execPath, [path.join(root, 'scripts/build-tour-site.cjs'), output], { stdio: 'pipe' });
    assert.equal(verifyPackage(path.join(output, 'tours/product/1.0.0')).digest, manifest.digest);
}

test('portable packages rebuild identically, restore without the author checkout, and reject corruption', () => {
    const f = exportFixture();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-package-check-'));
    try {
        f.source.range = { base: f.base, head: f.head };
        fs.writeFileSync(f.sourcePath, JSON.stringify(f.source));
        const bundle = path.join(temp, 'evidence.bundle');
        f.git('bundle', 'create', bundle, '--all');
        const first = path.join(temp, 'first'), second = path.join(temp, 'second');
        const metadata = { evidenceKind: 'synthetic test', scope: 'Package restoration' };
        const a = buildPackage(f.sourcePath, bundle, metadata, first);
        const b = buildPackage(path.join(first, 'tour.bygone.yaml'), path.join(first, 'evidence.bundle'), metadata, second);
        assert.equal(a.digest, b.digest);
        assert.deepEqual(a.artifacts, b.artifacts);
        assertSiteRetainsPackage(first, temp);
        assert.equal(JSON.parse(fs.readFileSync(path.join(first, 'tour.json'))).repository.root, '.');
        assert.throws(() => buildPackage(f.sourcePath, bundle, metadata, first), /Output exists/);
        const restored = path.join(temp, 'restored');
        execFileSync('git', ['clone', path.join(first, 'evidence.bundle'), restored], { stdio: 'pipe' });
        assert.equal(execFileSync('git', ['rev-parse', `${f.head}^{commit}`], { cwd: restored, encoding: 'utf8' }).trim(), f.head);
        fs.appendFileSync(path.join(second, 'tour.html'), 'tampered');
        assert.throws(() => verifyPackage(second), /integrity mismatch/);
        assert.equal(verifyPackage(first).digest, a.digest);
        fs.renameSync(path.join(first, 'manifest.json'), path.join(first, 'manifest-original.json'));
        fs.symlinkSync('manifest-original.json', path.join(first, 'manifest.json'));
        assert.throws(() => verifyPackage(first), /regular manifest/);
    } finally { f.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
});

test('v2 review packages bind exact evidence and retain immutable portable reports', () => {
    const f = exportFixture();
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tour-review-package-'));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    try {
        f.source.range = { base: f.base, head: f.head };
        fs.writeFileSync(f.sourcePath, JSON.stringify(f.source));
        const bundle = path.join(temp, 'evidence.bundle');
        f.git('bundle', 'create', bundle, '--all');
        const content = {
            'review.json': JSON.stringify({ version: 2, base: f.base, head: f.head, requirements: [{ quote: 'Preserve the source quotation' }] }),
            'report.json': JSON.stringify({ schemaVersion: 1, kind: 'advisory-review', capture: { base: 'c'.repeat(40), mergeBase: f.base, head: f.head }, missingInputs: ['Live CI'], verification: [] }),
            'report.md': '# Review\n\nLive CI is unknown.\n'
        };
        const reviewArtifacts = Object.fromEntries(Object.entries(content).map(([name, bytes]) => {
            const file = path.join(temp, name); fs.writeFileSync(file, bytes); return [name, file];
        }));
        const first = path.join(temp, 'first');
        const manifest = buildPackage(f.sourcePath, bundle, {}, first, { reviewArtifacts });
        assert.equal(manifest.schemaVersion, 2);
        assert.deepEqual(Object.keys(manifest.reviewArtifacts).sort(), Object.keys(content).sort());
        assertSiteRetainsPackage(first, temp);
        for (const [name, bytes] of Object.entries(content)) assert.equal(fs.readFileSync(path.join(first, name), 'utf8'), bytes);
        fs.writeFileSync(reviewArtifacts['report.md'], '# Revised narration\n\nLive CI remains unknown.\n');
        const second = path.join(temp, 'second');
        const newer = buildPackage(f.sourcePath, bundle, {}, second, { reviewArtifacts });
        assert.notEqual(newer.digest, manifest.digest);
        assert.deepEqual(newer.evidence, manifest.evidence);
        assert.equal(verifyPackage(first).digest, manifest.digest);
        fs.appendFileSync(path.join(second, 'report.json'), ' ');
        assert.throws(() => verifyPackage(second), /integrity mismatch/);

        // Re-sign mutations to exercise validation beyond digest/integrity checks.
        const writeIdentity = identity => fs.writeFileSync(path.join(first, 'manifest.json'), JSON.stringify({ ...identity, digest: hash(JSON.stringify(identity)) }));
        const { digest, ...identity } = manifest;
        void digest;
        writeIdentity({ ...identity, schemaVersion: 1 });
        assert.throws(() => verifyPackage(first), /schemaVersion 2/);
        writeIdentity({ ...identity, reviewArtifacts: { 'report.json': manifest.reviewArtifacts['report.json'] } });
        assert.throws(() => verifyPackage(first), /exactly/);
        writeIdentity({ ...identity, reviewArtifacts: { ...manifest.reviewArtifacts, '../escape': {} } });
        assert.throws(() => verifyPackage(first), /exactly/);
        const combined = 'report.json,report.md,review.json';
        fs.writeFileSync(path.join(first, combined), 'unrelated');
        writeIdentity({ ...identity, reviewArtifacts: { [combined]: { bytes: 9, sha256: hash('unrelated') } } });
        assert.throws(() => verifyPackage(first), /exactly/);
        writeIdentity({ ...identity, evidence: { 'base,head': f.head } });
        assert.throws(() => verifyPackage(first), /pinned endpoints/);
        const wrongReport = JSON.stringify({ schemaVersion: 1, kind: 'advisory-review', capture: { base: f.base, mergeBase: f.base, head: 'e'.repeat(40) } });
        fs.writeFileSync(path.join(first, 'report.json'), wrongReport);
        writeIdentity({ ...identity, reviewArtifacts: { ...identity.reviewArtifacts, 'report.json': { bytes: Buffer.byteLength(wrongReport), sha256: hash(wrongReport) } } });
        assert.throws(() => verifyPackage(first), /report does not match/);
        fs.rmSync(path.join(first, 'review.json'));
        fs.symlinkSync(reviewArtifacts['review.json'], path.join(first, 'review.json'));
        assert.throws(() => verifyPackage(first), /regular artifact/);
        assert.throws(() => buildPackage(f.sourcePath, bundle, {}, path.join(temp, 'invalid'), { reviewArtifacts: {} }), /exactly/);
        // Integration harness can retain a genuine v2 package for a second consumer.
        if (process.env.TOUR_PACKAGE_FIXTURE_OUTPUT) {
            fs.copyFileSync(reviewArtifacts['report.json'], path.join(second, 'report.json'));
            fs.mkdirSync(process.env.TOUR_PACKAGE_FIXTURE_OUTPUT, { recursive: true });
            for (const name of fs.readdirSync(second)) {
                fs.writeFileSync(path.join(process.env.TOUR_PACKAGE_FIXTURE_OUTPUT, name), fs.readFileSync(path.join(second, name)));
            }
        }
    } finally { f.dispose(); fs.rmSync(temp, { recursive: true, force: true }); }
});
