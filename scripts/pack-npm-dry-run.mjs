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

process.exit(result.status ?? 1);
