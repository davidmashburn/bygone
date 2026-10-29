const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { exportFixture } = require('./exportFixture');
const { buildPackage, verifyPackage } = require('../scripts/package-tour.cjs');

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
