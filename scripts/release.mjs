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

const env = {
    ...process.env,
    HOMEBREW_CACHE: process.env.HOMEBREW_CACHE || path.join('/tmp', 'bygone-homebrew-cache'),
    PATH: await buildReleasePath()
};

const buildSteps = [
    ['npm', ['test']],
    ['npm', ['run', 'package:vsix']],
    ['npm', ['run', 'package:npm']],
    ['npm', ['run', 'package:npm:dry-run']],
    ...(skipDmg ? [] : [['npm', ['run', 'package:desktop:mac']]]),
    ['npm', ['run', 'package:desktop:mac:zip']],
    ['npm', ['run', 'package:desktop:linux']],
    ...(skipWindows ? [] : [['npm', ['run', 'package:desktop:win']]]),
    ...homebrewStyleStep()
];

for (const [command, commandArgs] of buildSteps) {
    await run(command, commandArgs);
}

if (shouldPublish) {
    await publishArtifacts();
} else {
    console.log('');
    console.log(`Built Bygone ${version} artifacts without publishing.`);
    console.log('Pass --publish to publish npm, VS Code Marketplace, GitHub desktop artifacts, and a Homebrew tap update.');
}

async function publishArtifacts() {
    const vsixPath = path.join(repoRoot, `bygone-${version}.vsix`);
    const npmPackagePath = path.join(repoRoot, 'dist', 'npm-package');
    const desktopArtifacts = await findDesktopArtifacts();

    requireFile(vsixPath, 'VSIX package');
    requireFile(path.join(npmPackagePath, 'package.json'), 'staged npm package');

    await run('npm', ['publish', npmPackagePath, '--access', 'public']);
    await run('npx', ['vsce', 'publish', '--packagePath', vsixPath]);
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

async function publishHomebrewTap() {
    const tapRoot = process.env.BYGONE_HOMEBREW_TAP;
    if (!tapRoot) {
        throw new Error('Set BYGONE_HOMEBREW_TAP to a local Homebrew tap checkout before using --publish.');
    }

    const resolvedTapRoot = path.resolve(tapRoot);
    const formulaDir = path.join(resolvedTapRoot, 'Formula');
    const caskDir = path.join(resolvedTapRoot, 'Casks');
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
        formula.replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${await sha256(npmTarball)}"`),
        'utf8'
    );
    await writeFile(
        path.join(caskDir, 'bygone-desktop.rb'),
        cask.replace(/sha256 "[0-9a-f]{64}"/, `sha256 "${await sha256(dmgPath)}"`),
        'utf8'
    );

    await run('brew', ['style', path.join(formulaDir, 'bygone.rb'), path.join(caskDir, 'bygone-desktop.rb')]);
    await run('git', ['-C', resolvedTapRoot, 'add', 'Formula/bygone.rb', 'Casks/bygone-desktop.rb']);
    await run('git', ['-C', resolvedTapRoot, 'commit', '-m', `Update Bygone to ${version}`]);
    await run('git', ['-C', resolvedTapRoot, 'push']);
}

async function packNpmTarball() {
    await run('npm', ['pack', './dist/npm-package', '--pack-destination', './dist']);
    const files = await readdir(path.join(repoRoot, 'dist'));
    const tarballName = files.find((file) => file === `davidmashburn-bygone-${version}.tgz`);
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
    const python3 = firstExisting(['/opt/homebrew/bin/python3', '/usr/local/bin/python3']);

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

function homebrewStyleStep() {
    const brew = firstExisting(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
    return brew ? [[brew, ['style', 'packaging/homebrew/bygone.rb', 'packaging/homebrew/bygone-desktop.rb']]] : [];
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
