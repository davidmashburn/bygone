const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('dev iterations preserve the release tuple and cannot enter release builds', async () => {
    const { nextDevVersion, assertReleaseVersion } = await import('../scripts/dev-version.mjs');
    assert.equal(nextDevVersion('0.9.9'), '0.9.9+dev.1');
    assert.equal(nextDevVersion('0.9.9+dev.9'), '0.9.9+dev.10');
    assert.equal(nextDevVersion('0.9.10'), '0.9.10+dev.1');
    for (const value of ['0.9.9.1', '0.9.9-beta.1', '0.09.9', '0.9.9+dev.9007199254740991']) {
        assert.throws(() => nextDevVersion(value));
    }
    assert.doesNotThrow(() => assertReleaseVersion('0.9.9'));
    assert.throws(() => assertReleaseVersion('0.9.9+dev.1'), /plain major.minor.patch/);
    // Exercise the installed packager's validation, not a second hand-written parser.
    assert.equal(require('@vscode/vsce/out/validation').validateVersion('0.9.9+dev.1'), '0.9.9+dev.1');
});

test('dirty builds increment both manifests; clean release builds stay clean', async () => {
    const { prepareDevVersion } = await import('../scripts/dev-version.mjs');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bygone-dev-version-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const read = file => fs.readFile(path.join(root, file), 'utf8').then(JSON.parse);
    try {
        git('init');
        git('config', 'user.name', 'Version test');
        git('config', 'user.email', 'version@example.test');
        await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'version-fixture', version: '0.9.9' }));
        await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.9.9', packages: { '': { version: '0.9.9' } } }));
        await fs.writeFile(path.join(root, '.gitignore'), 'out/\n');
        git('add', '.'); git('commit', '-m', 'test: create fixture');
        await fs.mkdir(path.join(root, 'out'));
        await fs.writeFile(path.join(root, 'out', 'bundle.js'), 'generated');
        assert.equal(await prepareDevVersion(root), '0.9.9');
        assert.equal(git('status', '--porcelain'), '');
        await fs.writeFile(path.join(root, 'new.js'), 'uncommitted');
        assert.equal(await prepareDevVersion(root), '0.9.9+dev.1');
        git('add', 'new.js');
        assert.equal(await prepareDevVersion(root), '0.9.9+dev.2');
        assert.equal((await read('package.json')).version, '0.9.9+dev.2');
        const lock = await read('package-lock.json');
        assert.equal(lock.version, '0.9.9+dev.2');
        assert.equal(lock.packages[''].version, lock.version);
        const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }));
        assert.equal(packed[0].version, '0.9.9+dev.2');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
