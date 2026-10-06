import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const iterationPattern = /^(\d+\.\d+\.\d+)(?:\+dev\.([1-9]\d*))?$/;

export function assertReleaseVersion(version) {
    if (!releasePattern.test(version)) {
        throw new Error(`Release builds require a plain major.minor.patch version; got ${version}. Remove the dev iteration and commit the release version first.`);
    }
}

export function nextDevVersion(version) {
    const match = iterationPattern.exec(version);
    if (!match || !releasePattern.test(match[1])) throw new Error(`Unsupported local build version: ${version}`);
    const iteration = Number(match[2] || 0) + 1;
    if (!Number.isSafeInteger(iteration)) throw new Error('Dev iteration exceeds the safe integer range.');
    return `${match[1]}+dev.${iteration}`;
}

// Keep the package, CLI, export integrity manifest, VSIX, and desktop artifact
// on the same version. Ignored build outputs do not make a checkout dirty.
export async function prepareDevVersion(repoRoot) {
    const packagePath = path.join(repoRoot, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repoRoot, encoding: 'utf8' });
    if (!status.trim()) return packageJson.version;
    const version = nextDevVersion(packageJson.version);
    const lockPath = path.join(repoRoot, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if (!lock.packages?.['']) throw new Error('Dev versioning requires a package-lock with a root package entry.');
    packageJson.version = version;
    lock.version = version;
    lock.packages[''].version = version;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    return version;
}
