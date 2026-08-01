import { chmod, cp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repoRoot, 'dist', 'npm-package');
const rootPackageJson = await readJson(path.join(repoRoot, 'package.json'));

const npmPackageJson = {
    name: '@davmash/bygone',
    version: rootPackageJson.version,
    description: 'See how change happened. Visual diff and file history.',
    author: rootPackageJson.author,
    license: rootPackageJson.license,
    homepage: rootPackageJson.homepage,
    repository: rootPackageJson.repository,
    bugs: rootPackageJson.bugs,
    bin: {
        bygone: './bin/bygone.js'
    },
    main: './out/standalone-main.js',
    files: [
        'bin/',
        'cli/',
        'completions/',
        'out/',
        'media/',
        'web/',
        'standalone/',
        'docs/',
        'examples/',
        'README.md',
        'LICENSE.txt',
        'CHANGELOG.md'
    ],
    keywords: [
        'diff',
        'git',
        'history',
        'visual',
        'electron'
    ],
    dependencies: {
        electron: rootPackageJson.devDependencies.electron,
        'electron-updater': rootPackageJson.dependencies['electron-updater'],
        'js-yaml': rootPackageJson.dependencies['js-yaml']
    }
};

await rm(packageRoot, { recursive: true, force: true });
await mkdir(packageRoot, { recursive: true });

await copyFile('README.md');
await copyFile('LICENSE.txt');
await copyFile('CHANGELOG.md');
await copyFile('docs/change-tour-format.md');
await copyFile('examples');
await copyFile('bin/bygone.js');
await copyFile('cli');
await copyFile('completions');
await copyFile('out/standalone-main.js');
await copyFile('out/standalone-preload.js');
await copyFile('out/changeTour.js');
await copyFile('standalone/index.html');
await copyFile('web/index.html');
await copyFile('web/presenter.css');
await copyFile('web/web-host.js');
await copyMediaRuntime();
await writeFile(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify(npmPackageJson, null, 2)}\n`,
    'utf8'
);
await chmod(path.join(packageRoot, 'bin', 'bygone.js'), 0o755);

console.log(`Staged npm package ${npmPackageJson.name}@${npmPackageJson.version} in ${path.relative(repoRoot, packageRoot)}`);
console.log(`Validate with: npm pack --dry-run ./${path.relative(repoRoot, packageRoot)}`);

async function copyFile(relativePath) {
    await cp(
        path.join(repoRoot, relativePath),
        path.join(packageRoot, relativePath),
        { recursive: true }
    );
}

async function copyMediaRuntime() {
    const mediaFiles = [
        'media/webview.css',
        'media/webview.js',
        'media/editor.worker.js',
        'media/icon.png',
        'media/bygone-screenshot.png'
    ];

    for (const mediaFile of mediaFiles) {
        await copyFile(mediaFile);
    }
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}
