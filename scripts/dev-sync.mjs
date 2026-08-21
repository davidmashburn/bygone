import { constants as fsConstants, existsSync } from 'fs';
import { access, chmod, cp, mkdir, readFile, readdir, rm, stat } from 'fs/promises';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const args = new Set(process.argv.slice(2));
const installOnly = args.has('--install-only');
const platform = process.platform;
const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';
const binDir = path.join(repoRoot, 'node_modules', '.bin');
const vsceBin = platform === 'win32' ? path.join(binDir, 'vsce.cmd') : path.join(binDir, 'vsce');
const electronBuilderBin = platform === 'win32'
    ? path.join(binDir, 'electron-builder.cmd')
    : path.join(binDir, 'electron-builder');
const vsixPath = path.join(repoRoot, `bygone-${version}.vsix`);

if (args.has('--help') || args.has('-h')) {
    process.stdout.write(`Bygone ${version}

Usage:
  node ./scripts/dev-sync.mjs
  node ./scripts/dev-sync.mjs --install-only

What it does:
  - builds the repo
  - installs the global CLI from the local checkout
  - installs Zsh, Bash, and Fish completions
  - packages the VSIX
  - packages the desktop app for the current platform
  - auto-installs the VSIX
  - auto-installs the desktop app

Install-only mode reuses the existing VSIX and desktop artifacts and skips
npm install, compilation, and packaging.

Notes:
  - On macOS, the desktop app is installed from the generated DMG into /Applications or ~/Applications.
  - On Linux, the desktop app is installed as ~/Applications/bygone-desktop.
  - On Windows, the generated installer is run silently.
`);
    process.exit(0);
}

if (!installOnly) {
    await run(npmCmd, ['install']);
    await rm(path.join(repoRoot, 'dist'), { recursive: true, force: true });
    await run(npmCmd, ['run', 'compile']);
}
await run(npmCmd, ['install', '-g', '.']);
await installShellCompletions();
if (!installOnly) {
    await run(vsceBin, ['package']);
    await run(electronBuilderBin, desktopPackageArgs());
} else {
    console.log(`Using existing ${version} VSIX and desktop artifacts.`);
}

await installVsix(vsixPath);
await installDesktopApp();

console.log('');
console.log('Dev sync complete.');
console.log(`Global CLI: npm install -g .`);
console.log(`VSIX: ${path.relative(repoRoot, vsixPath)}`);

function desktopPackageArgs() {
    if (platform === 'darwin') {
        return ['--mac', 'dmg', '--publish', 'never'];
    }

    if (platform === 'linux') {
        return ['--linux', 'AppImage', '--publish', 'never'];
    }

    if (platform === 'win32') {
        return ['--win', '--publish', 'never'];
    }

    throw new Error(`Unsupported platform for desktop packaging: ${platform}`);
}

async function installShellCompletions() {
    if (platform === 'win32') {
        return;
    }

    let targets;
    if (platform === 'darwin') {
        try {
            const brewPrefix = await run('brew', ['--prefix'], { stdio: ['ignore', 'pipe', 'inherit'] });
            targets = [
                ['_bygone', path.join(brewPrefix, 'share', 'zsh', 'site-functions', '_bygone')],
                ['bygone', path.join(brewPrefix, 'etc', 'bash_completion.d', 'bygone')],
                ['bygone.fish', path.join(brewPrefix, 'share', 'fish', 'vendor_completions.d', 'bygone.fish')]
            ];
        } catch {
            targets = userCompletionTargets();
        }
    } else {
        targets = userCompletionTargets();
    }

    for (const [sourceName, targetPath] of targets) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await cp(path.join(repoRoot, 'completions', sourceName), targetPath);
        console.log(`Installed shell completion to ${targetPath}`);
    }
}

function userCompletionTargets() {
    return [
        ['_bygone', path.join(os.homedir(), '.local', 'share', 'zsh', 'site-functions', '_bygone')],
        ['bygone', path.join(os.homedir(), '.local', 'share', 'bash-completion', 'completions', 'bygone')],
        ['bygone.fish', path.join(os.homedir(), '.config', 'fish', 'completions', 'bygone.fish')]
    ];
}

async function installVsix(vsixFile) {
    requireFile(vsixFile, 'VSIX package');

    const candidates = vscodeInstallCommands();

    for (const command of candidates) {
        try {
            await run(command, ['--install-extension', vsixFile, '--force']);
            return;
        } catch (error) {
            if (error?.code === 'ENOENT') {
                continue;
            }

            throw error;
        }
    }

    throw new Error(`Could not find a Visual Studio Code CLI. Tried: ${candidates.join(', ')}`);
}

async function installDesktopApp() {
    if (platform === 'darwin') {
        await installMacDesktopApp(await findDesktopArtifact('dmg'));
        return;
    }

    if (platform === 'linux') {
        await installLinuxDesktopApp(await findDesktopArtifact('AppImage'));
        return;
    }

    if (platform === 'win32') {
        await installWindowsDesktopApp(await findDesktopArtifact('exe'));
        return;
    }

    throw new Error(`Unsupported platform for desktop install: ${platform}`);
}

async function installMacDesktopApp(dmgPath) {
    requireFile(dmgPath, 'macOS DMG');

    const mountDir = path.join(os.tmpdir(), `bygone-dmg-${process.pid}-${Date.now()}`);
    await mkdir(mountDir, { recursive: true });
    const targetRoot = await macInstallRoot();
    const targetApp = path.join(targetRoot, 'Bygone.app');

    try {
        await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, dmgPath]);
        const mountedApp = path.join(mountDir, 'Bygone.app');
        requireFile(mountedApp, 'mounted Bygone.app');
        await rm(targetApp, { recursive: true, force: true });
        await mkdir(targetRoot, { recursive: true });
        await cp(mountedApp, targetApp, {
            recursive: true,
            verbatimSymlinks: true,
        });
    } finally {
        await run('hdiutil', ['detach', mountDir]).catch(() => undefined);
        await rm(mountDir, { recursive: true, force: true }).catch(() => undefined);
    }

    console.log(`Installed desktop app to ${targetApp}`);
}

async function macInstallRoot() {
    const systemApplications = '/Applications';
    const homeApplications = path.join(os.homedir(), 'Applications');

    try {
        await access(systemApplications, fsConstants.W_OK);
        return systemApplications;
    } catch {
        await mkdir(homeApplications, { recursive: true });
        return homeApplications;
    }
}

async function installLinuxDesktopApp(appImagePath) {
    requireFile(appImagePath, 'Linux AppImage');

    const targetDir = path.join(os.homedir(), '.local', 'bin');
    const targetPath = path.join(targetDir, 'bygone-desktop');

    await mkdir(targetDir, { recursive: true });
    await rm(targetPath, { force: true });
    await cp(appImagePath, targetPath);
    await chmod(targetPath, 0o755);

    console.log(`Installed desktop app to ${targetPath}`);
}

async function installWindowsDesktopApp(installerPath) {
    requireFile(installerPath, 'Windows installer');
    await run(installerPath, ['/S']);
    console.log(`Ran installer ${path.basename(installerPath)} silently`);
}

function vscodeInstallCommands() {
    const candidates = [
        'code',
        'code-insiders'
    ];

    if (platform === 'darwin') {
        candidates.push(
            '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
            '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
            path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code'),
            path.join(os.homedir(), 'Applications', 'Visual Studio Code - Insiders.app', 'Contents', 'Resources', 'app', 'bin', 'code')
        );
    }

    if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || '';
        candidates.push(
            path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
            path.join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'bin', 'code-insiders.cmd')
        );
    }

    return candidates;
}

async function findDesktopArtifact(kind) {
    const distDir = path.join(repoRoot, 'dist');
    const entries = await readdir(distDir);
    const matches = [];

    for (const entry of entries) {
        if (!matchesArtifactName(entry, kind)) {
            continue;
        }

        const fullPath = path.join(distDir, entry);
        const stats = await stat(fullPath);
        if (stats.isFile()) {
            matches.push({ path: fullPath, mtimeMs: stats.mtimeMs });
        }
    }

    matches.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const newestMatch = matches[0]?.path;
    if (!newestMatch) {
        return undefined;
    }

    return newestMatch;
}

async function run(command, commandArgs, options = {}) {
    console.log(`\n$ ${[command, ...commandArgs].join(' ')}`);
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: options.cwd || repoRoot,
            env: {
                ...process.env,
                ...(options.env || {})
            },
            shell: options.shell ?? shouldUseWindowsShell(command),
            stdio: options.stdio || 'inherit'
        });

        let stdout = '';
        if (child.stdout) {
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', (chunk) => {
                stdout += chunk;
            });
        }

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`${command} exited via signal ${signal}`));
                return;
            }

            if (code === 0) {
                resolve(stdout.trim());
                return;
            }

            reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
        });
    });
}

function requireFile(filePath, description) {
    if (!filePath || !existsSync(filePath)) {
        throw new Error(`Missing ${description}: ${filePath || '<unknown>'}`);
    }
}

function shouldUseWindowsShell(command) {
    return platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat'));
}

function matchesArtifactName(entry, kind) {
    if (kind === 'dmg') {
        return entry === `Bygone-${version}-arm64.dmg`;
    }

    if (kind === 'AppImage') {
        return entry === `Bygone-${version}-arm64.AppImage`;
    }

    if (kind === 'exe') {
        return entry === `Bygone Setup ${version}.exe`;
    }

    return false;
}
