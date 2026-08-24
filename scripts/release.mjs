import { createHash } from 'crypto';
import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const version = packageJson.version;
const args = new Set(process.argv.slice(2));
const shouldPublish = args.has('--publish');
const skipDmg = args.has('--skip-dmg');
const skipWindows = args.has('--skip-windows');
const homebrewTapRoot = path.resolve(
    process.env.BYGONE_HOMEBREW_TAP || path.join(repoRoot, '..', 'homebrew-bygone')
);

const env = {
    ...process.env,
    HOMEBREW_CACHE: process.env.HOMEBREW_CACHE || path.join('/tmp', 'bygone-homebrew-cache'),
    PATH: await buildReleasePath()
};

if (shouldPublish) {
    await preflightRepositoryState();
    await preflightPublish();
    await pushMainAndWaitForCi();
}

const buildSteps = [
    ['npm', ['test']],
    ['npm', ['run', 'package:vsix']],
    ['npm', ['run', 'package:npm']],
    ['npm', ['run', 'package:npm:dry-run']],
    ...(skipDmg ? [] : [['npm', ['run', 'package:desktop:mac']]]),
    ['npm', ['run', 'package:desktop:mac:zip']],
    ['npm', ['run', 'package:desktop:linux']],
    ...(skipWindows ? [] : [['npm', ['run', 'package:desktop:win']]])
];

for (const [command, commandArgs] of buildSteps) {
    await run(command, commandArgs);
}

const canInstallCurrentDesktop = !(process.platform === 'darwin' && skipDmg)
    && !(process.platform === 'win32' && skipWindows);
if (canInstallCurrentDesktop) {
    await run('npm', ['run', 'reinstall']);
} else {
    console.log('\nSkipped local install because the current platform desktop artifact was not built.');
}

if (shouldPublish) {
    await publishArtifacts();
} else {
    console.log('');
    console.log(`Built Bygone ${version} artifacts without publishing.`);
    console.log('Pass --publish to publish npm, GitHub desktop artifacts, and a Homebrew tap update.');
    console.log('Publish the VS Code extension from the Visual Studio Marketplace publisher page.');
}

async function publishArtifacts() {
    const npmPackagePath = path.join(repoRoot, 'dist', 'npm-package');
    const desktopArtifacts = await findDesktopArtifacts();

    requireFile(path.join(npmPackagePath, 'package.json'), 'staged npm package');

    if (!(await isPublishedNpmVersion(npmPackagePath))) {
        await run('npm', ['publish', npmPackagePath, '--access', 'public']);
    } else {
        console.log(`\n$ npm publish ${npmPackagePath} --access public`);
        console.log(`npm ${version} is already published, skipping npm publish and continuing with the remaining release steps.`);
    }
    await run('gh', [
        'release',
        'create',
        `v${version}`,
        ...desktopArtifacts,
        '--title',
        `Bygone ${version}`,
        '--notes-file',
        'CHANGELOG.md'
    ]);

    await publishHomebrewTap();
}

async function preflightRepositoryState() {
    const status = await runCapture('git', ['status', '--porcelain']);
    if (status) {
        throw new Error('Release publishing requires a clean worktree. Commit or discard local changes first.');
    }

    const branch = await runCapture('git', ['branch', '--show-current']);
    if (branch !== 'main') {
        throw new Error(`Release publishing requires the main branch; current branch is ${branch || '<detached>'}.`);
    }
}

async function pushMainAndWaitForCi() {
    const headOid = await runCapture('git', ['rev-parse', 'HEAD']);
    await run('git', ['push', 'origin', 'main']);
    const runId = await waitForReleaseCheckRun(headOid);
    await run('gh', ['run', 'watch', runId, '--exit-status']);
}

async function waitForReleaseCheckRun(headOid) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        const output = await runCapture('gh', [
            'run', 'list',
            '--commit', headOid,
            '--workflow', 'Release Check',
            '--limit', '1',
            '--json', 'databaseId'
        ]);
        const runs = JSON.parse(output);
        if (runs[0]?.databaseId) {
            return String(runs[0].databaseId);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for the Release Check workflow for ${headOid}.`);
}

async function isPublishedNpmVersion(packagePath) {
    const pkg = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
    const packageName = pkg.name;
    const manifest = JSON.parse(await runCapture('npm', ['view', packageName, 'versions', '--json']));
    const versions = Array.isArray(manifest) ? manifest : (manifest ? [manifest] : []);
    return versions.includes(pkg.version);
}

async function preflightPublish() {
    if (skipDmg) {
        throw new Error('Publishing requires a DMG because the Homebrew cask hash is computed from it. Remove --skip-dmg before publishing.');
    }

    if (!existsSync(path.join(homebrewTapRoot, '.git'))) {
        throw new Error(`Homebrew tap checkout not found: ${homebrewTapRoot}. Set BYGONE_HOMEBREW_TAP to override it.`);
    }

    await run('npm', ['whoami']);
    await run('gh', ['auth', 'status']);
}

async function publishHomebrewTap() {
    const formulaDir = path.join(homebrewTapRoot, 'Formula');
    const caskDir = path.join(homebrewTapRoot, 'Casks');
    const npmTarball = await packNpmTarball();
    const dmgPath = path.join(repoRoot, 'dist', `Bygone-${version}-arm64.dmg`);

    requireFile(npmTarball, 'npm tarball for Homebrew formula hash');
    requireFile(dmgPath, 'macOS DMG for Homebrew cask hash');

    await mkdir(formulaDir, { recursive: true });
    await mkdir(caskDir, { recursive: true });

    const formula = await readFile(path.join(repoRoot, 'packaging', 'homebrew', 'bygone.rb'), 'utf8');
    const cask = await readFile(path.join(repoRoot, 'packaging', 'homebrew', 'bygone-desktop.rb'), 'utf8');

    await writeFile(
        path.join(formulaDir, 'bygone.rb'),
        renderHomebrewDefinition(formula, await sha256(npmTarball)),
        'utf8'
    );
    await writeFile(
        path.join(caskDir, 'bygone-desktop.rb'),
        renderHomebrewDefinition(cask, await sha256(dmgPath)),
        'utf8'
    );

    await run('brew', ['style', path.join(formulaDir, 'bygone.rb'), path.join(caskDir, 'bygone-desktop.rb')]);
    await run('git', ['-C', homebrewTapRoot, 'add', 'Formula/bygone.rb', 'Casks/bygone-desktop.rb']);
    await run('git', ['-C', homebrewTapRoot, 'commit', '-m', `Update Bygone to ${version}`]);
    await run('git', ['-C', homebrewTapRoot, 'push']);
}

function renderHomebrewDefinition(contents, digest) {
    return contents
        .replace(/(bygone-)[^/"]+(\.tgz")/, `$1${version}$2`)
        .replace(/version "[^"]+"/, `version "${version}"`)
        .replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${digest}"`);
}

async function packNpmTarball() {
    await run('npm', ['pack', './dist/npm-package', '--pack-destination', './dist']);
    const files = await readdir(path.join(repoRoot, 'dist'));
    const tarballName = files.find((file) => file === `davmash-bygone-${version}.tgz`);
    return tarballName ? path.join(repoRoot, 'dist', tarballName) : null;
}

async function findDesktopArtifacts() {
    const artifactNames = [
        `Bygone-${version}-arm64.dmg`,
        `Bygone-${version}-arm64-mac.zip`,
        `Bygone-${version}-arm64-mac.zip.blockmap`,
        `Bygone-${version}-arm64.AppImage`,
        `Bygone Setup ${version}.exe`,
        `Bygone Setup ${version}.exe.blockmap`,
        `Bygone ${version}.exe`,
        'latest-mac.yml',
        'latest-linux-arm64.yml',
        'latest.yml'
    ];

    return artifactNames
        .map((artifactName) => path.join(repoRoot, 'dist', artifactName))
        .filter((artifactPath) => existsSync(artifactPath));
}

async function buildReleasePath() {
    const pathParts = [];
    const shimDir = path.join('/tmp', 'bygone-release-bin');
    const python3 = firstExisting(['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']);

    if (python3) {
        await rm(shimDir, { recursive: true, force: true });
        await mkdir(shimDir, { recursive: true });
        await symlink(python3, path.join(shimDir, 'python'));
        pathParts.push(shimDir);
    }

    for (const candidate of ['/opt/homebrew/bin', '/usr/local/bin']) {
        if (existsSync(candidate)) {
            pathParts.push(candidate);
        }
    }

    pathParts.push(process.env.PATH || '');
    return pathParts.join(path.delimiter);
}

function firstExisting(candidates) {
    return candidates.find((candidate) => existsSync(candidate));
}

function requireFile(filePath, description) {
    if (!filePath || !existsSync(filePath)) {
        throw new Error(`Missing ${description}: ${filePath}`);
    }
}

async function sha256(filePath) {
    const contents = await readFile(filePath);
    return createHash('sha256').update(contents).digest('hex');
}

function run(command, commandArgs) {
    console.log(`\n$ ${[command, ...commandArgs].join(' ')}`);
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: repoRoot,
            env,
            stdio: 'inherit'
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
        });
    });
}

function runCapture(command, commandArgs) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, {
            cwd: repoRoot,
            env,
            stdio: ['ignore', 'pipe', 'inherit']
        });

        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            output += chunk;
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve(output.trim());
                return;
            }

            reject(new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${code}`));
        });
    });
}
