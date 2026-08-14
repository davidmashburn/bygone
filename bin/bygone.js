#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');
const { generateCompletion, SUPPORTED_SHELLS } = require('../cli/completions.js');
const { renderCliHelp, tokenMatches } = require('../cli/commandSpec.js');
const { startPresentation } = require('../cli/present.js');
const { runTourCommand } = require('../cli/tour.js');
const { resolveWorkingDirectory } = require('../cli/workingDirectory.js');

let args;
let cliCwd;
try {
    ({ args, cwd: cliCwd } = resolveWorkingDirectory(process.argv.slice(2), process.cwd()));
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
}
const packageRoot = path.join(__dirname, '..');

if (args.some((arg) => tokenMatches('help', arg))) {
    process.stdout.write(renderCliHelp(packageJson.version));
    process.exit(0);
}

if (args.some((arg) => tokenMatches('version', arg))) {
    process.stdout.write(`${packageJson.version}\n`);
    process.exit(0);
}

if (tokenMatches('completion', args[0])) {
    const shell = args[1];
    if (!SUPPORTED_SHELLS.includes(shell)) {
        process.stderr.write(`Usage: bygone completion <${SUPPORTED_SHELLS.join('|')}>\n`);
        process.exit(2);
    }
    process.stdout.write(generateCompletion(shell));
    process.exit(0);
}

if (tokenMatches('tourCommand', args[0])) {
    try {
        runTourCommand(args.slice(1), cliCwd, packageRoot);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(args.includes('--json')
            ? `${JSON.stringify({ ok: false, error: { message } }, null, 2)}\n`
            : `Could not process change tour: ${message}\n`);
        process.exitCode = 1;
    }
} else if (tokenMatches('present', args[0])) {
    const installedApp = findInstalledApp();
    if (installedApp && process.env.BYGONE_FORCE_BUNDLED !== '1') {
        launchDesktopApp({ waitForExit: false });
    } else {
        startPresentation(args.slice(1), cliCwd, packageRoot).catch((error) => {
            process.stderr.write(`Could not start change tour: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exitCode = 1;
        });
    }
} else {
    launchDesktopApp();
}

function launchDesktopApp({ waitForExit = true } = {}) {
const electronBinary = process.platform === 'win32'
    ? '.\\node_modules\\.bin\\electron.cmd'
    : './node_modules/.bin/electron';
const appEntry = './out/standalone-main.js';
const forwardedArgs = ['--cwd', cliCwd, ...args];
const installedApp = findInstalledApp();

const child = installedApp && process.env.BYGONE_FORCE_BUNDLED !== '1'
    ? spawnInstalledApp(installedApp, forwardedArgs, { waitForExit })
    : spawn(electronBinary, [appEntry, ...forwardedArgs], {
        cwd: packageRoot,
        detached: !waitForExit,
        stdio: waitForExit ? 'inherit' : 'ignore',
        env: electronEnvironment()
    });

if (!waitForExit) {
    child.unref();
    return;
}

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }

    process.exit(code ?? 0);
});
}

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

function spawnInstalledApp(installedApp, launchArgs, { waitForExit = true } = {}) {
    const spawnOptions = {
        detached: !waitForExit,
        stdio: waitForExit ? 'inherit' : 'ignore',
        env: electronEnvironment()
    };

    if (process.platform === 'darwin') {
        const executableName = path.basename(installedApp, '.app');
        const executablePath = path.join(installedApp, 'Contents', 'MacOS', executableName);
        return spawn(executablePath, launchArgs, spawnOptions);
    }

    return spawn(installedApp, launchArgs, spawnOptions);
}

function electronEnvironment() {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    return environment;
}
