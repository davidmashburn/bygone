const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Homebrew launcher resolves direct paths and symlink chains, preserving arguments and exit status', {
    skip: process.platform === 'win32'
}, t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone launcher ')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const resources = path.join(root, 'Custom Applications', 'Bygone.app', 'Contents', 'Resources');
    const macos = path.join(resources, '..', 'MacOS');
    const bin = path.join(root, 'bin');
    for (const directory of [resources, macos, bin]) fs.mkdirSync(directory, { recursive: true });
    const launcher = path.join(resources, 'bygone-launcher.sh');
    fs.copyFileSync(path.join(__dirname, '..', 'packaging', 'homebrew', 'bygone-launcher.sh'), launcher);
    fs.chmodSync(launcher, 0o755);
    const executable = path.join(macos, 'Bygone');
    fs.writeFileSync(executable, '#!/bin/bash\nprintf "%s\\n" "$0" "$@"\nexit 23\n', { mode: 0o755 });
    const absoluteLink = path.join(bin, 'bygone');
    const relativeLink = path.join(bin, 'relative');
    const chainLink = path.join(bin, 'chain');
    fs.symlinkSync(launcher, absoluteLink);
    fs.symlinkSync(path.relative(bin, launcher), relativeLink);
    fs.symlinkSync('relative', chainLink);
    const args = ['--help', 'a file with spaces', '', '$literal*'];
    for (const entry of [launcher, absoluteLink, relativeLink, chainLink, './chain']) {
        const result = spawnSync(entry, args, { cwd: bin, encoding: 'utf8' });
        assert.equal(result.error, undefined);
        assert.equal(result.status, 23, `${entry}: ${result.stderr}`);
        assert.equal(result.stderr, '');
        assert.equal(result.stdout, [executable, ...args, ''].join('\n'));
    }
});
