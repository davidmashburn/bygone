#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const packageJson = require('../package.json');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Bygone ${packageJson.version}

Usage:
  bygone --diff <left> <right>
  bygone --diff3 <left> <middle> <right>
  bygone --dir <left-dir> <right-dir>
  bygone --history <file>
  bygone --merge <base> <left> <right>
  bygone --test
  bygone [<left> <right>]

Notes:
  - Two positional paths auto-select file diff or directory compare.
  - In the standalone app, drop 1 file for history, 2 for diff, or 3 for merge.
`);
    process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${packageJson.version}\n`);
    process.exit(0);
}

const packageRoot = path.join(__dirname, '..');
const electronBinary = process.platform === 'win32'
    ? '.\\node_modules\\.bin\\electron.cmd'
    : './node_modules/.bin/electron';
const appEntry = './out/standalone-main.js';

const child = spawn(electronBinary, [appEntry, ...args], {
    cwd: packageRoot,
    stdio: 'inherit'
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
