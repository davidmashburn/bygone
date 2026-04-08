#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const packageJson = require('../package.json');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Melden ${packageJson.version}

Usage:
  melden --diff <left> <right>
  melden --history <file>
  melden --merge <base> <left> <right>
  melden --test
  melden [<left> <right>]

Notes:
  - Two positional file paths are treated as --diff.
  - In the standalone app, drop 1 file for history, 2 for diff, or 3 for merge.
`);
    process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${packageJson.version}\n`);
    process.exit(0);
}

const electronCli = require.resolve('electron/cli.js');
const appEntry = path.join(__dirname, '..', 'out', 'standalone-main.js');

const child = spawn(process.execPath, [electronCli, appEntry, ...args], {
    stdio: 'inherit'
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
