#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');

const args = process.argv.slice(2);
const cliCwd = process.cwd();

if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Bygone ${packageJson.version}

Usage:
  bygone
  bygone <file-or-directory>
  bygone <left> <right>
  bygone --diff <left> <right>
  bygone --diff3 <left> <middle> <right>
  bygone --dir <left-dir> <right-dir>
  bygone --dir3 <left-dir> <middle-dir> <right-dir>
  bygone --history <file>
  bygone --dir-history <directory>
  bygone --test

Notes:
  - No args opens Git directory history for the current directory.
  - One positional path opens file history or Git directory history.
  - Two positional paths auto-select file diff or directory compare.
  - In the standalone app, drop 1 file for history, 2 files/directories for compare, or 3 files/directories for 3-panel compare.
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
const forwardedArgs = ['--cwd', cliCwd, ...args];
const installedApp = findInstalledApp();

const child = installedApp && process.env.BYGONE_FORCE_BUNDLED !== '1'
    ? spawnInstalledApp(installedApp, forwardedArgs)
    : spawn(electronBinary, [appEntry, ...forwardedArgs], {
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

function findInstalledApp() {
    if (process.platform === 'darwin') {
        const candidates = [
            '/Applications/Bygone.app',
            path.join(process.env.HOME || '', 'Applications', 'Bygone.app')
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (!localAppData) {
            return undefined;
        }

        const candidates = [
            path.join(localAppData, 'Programs', 'Bygone', 'Bygone.exe'),
            path.join(localAppData, 'Bygone', 'Bygone.exe')
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    const candidates = [
        '/opt/Bygone/bygone',
        '/opt/Bygone/Bygone',
        '/usr/local/bin/bygone-desktop',
        path.join(process.env.HOME || '', '.local', 'bin', 'bygone-desktop')
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
}

function spawnInstalledApp(installedApp, launchArgs) {
    if (process.platform === 'darwin') {
        return spawn('open', ['-W', installedApp, '--args', ...launchArgs], {
            stdio: 'inherit'
        });
    }

    return spawn(installedApp, launchArgs, {
        stdio: 'inherit'
    });
}
