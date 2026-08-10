import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['pack', '--dry-run', './dist/npm-package'], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        npm_config_cache: path.join(os.tmpdir(), 'bygone-npm-cache')
    },
    stdio: 'inherit'
});

if (result.error) {
    throw result.error;
}

if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const smoke = spawnSync(process.execPath, ['./dist/npm-package/bin/bygone.js', '--version'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
});

if (smoke.error) {
    throw smoke.error;
}

process.exit(smoke.status ?? 1);
