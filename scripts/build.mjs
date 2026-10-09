import { rm, readFile, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { build } from 'esbuild';

const sharedOptions = {
    bundle: true,
    sourcemap: true,
    logLevel: 'info'
};

const browserOptions = {
    ...sharedOptions,
    loader: { '.md': 'text' },
    minify: true,
    legalComments: 'none'
};

await rm('out', { recursive: true, force: true });
await rm('media/webview.js', { force: true });
await rm('media/webview.js.map', { force: true });
await rm('media/webview.css', { force: true });
await rm('media/webview.css.map', { force: true });
await rm('media/editor.worker.js', { force: true });
await rm('media/editor.worker.js.map', { force: true });
await rm('media/diff.worker.js', { force: true });
await rm('media/diff.worker.js.map', { force: true });
await rm('out/standalone-main.js', { force: true });
await rm('out/standalone-main.js.map', { force: true });
await rm('out/standalone-preload.js', { force: true });
await rm('out/standalone-preload.js.map', { force: true });
await rm('web/web-host.js', { force: true });
await rm('web/web-host.js.map', { force: true });

for (const name of ['workspaceGit', 'workspaceHistory', 'historyDirectory', 'revisionView', 'workspacePrompt', 'tourReading', 'tourOrientation', 'deepLink', 'deepLinkResolver']) {
    await build({ ...sharedOptions, entryPoints: [`src/${name}.ts`], outfile: `out/${name}.js`, platform: 'node', format: 'cjs', target: 'node18' });
}

await build({
    ...sharedOptions,
    entryPoints: ['src/extension.ts'],
    outfile: 'out/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    external: ['vscode']
});

await build({
    ...sharedOptions,
    entryPoints: ['src/diffEngine.ts'],
    outfile: 'out/diffEngine.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/gitHistory.ts'],
    outfile: 'out/gitHistory.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/gitComparison.ts'],
    outfile: 'out/gitComparison.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/binaryComparison.ts'],
    outfile: 'out/binaryComparison.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/directoryDiff.ts'],
    outfile: 'out/directoryDiff.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/repositorySearch.ts'],
    outfile: 'out/repositorySearch.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/repositoryReplace.ts'],
    outfile: 'out/repositoryReplace.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/changeSetSearch.ts'],
    outfile: 'out/changeSetSearch.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/gitHistorySearch.ts'],
    outfile: 'out/gitHistorySearch.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/changeTour.ts'],
    outfile: 'out/changeTour.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/changeInventory.ts'],
    outfile: 'out/changeInventory.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourCoverage.ts'],
    outfile: 'out/tourCoverage.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourNavigation.ts'],
    outfile: 'out/tourNavigation.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourZoomSession.ts'],
    outfile: 'out/tourZoomSession.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourComparison.ts'],
    outfile: 'out/tourComparison.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourNarration.ts'],
    outfile: 'out/tourNarration.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourNarrationPlayback.ts'],
    outfile: 'out/tourNarrationPlayback.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourSearch.ts'],
    outfile: 'out/tourSearch.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourAnnotations.ts'],
    outfile: 'out/tourAnnotations.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/tourDocument.ts'],
    outfile: 'out/tourDocument.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...sharedOptions,
    entryPoints: ['src/windowTitle.ts'],
    outfile: 'out/windowTitle.js',
    platform: 'node',
    format: 'cjs',
    target: 'node16'
});

await build({
    ...browserOptions,
    entryPoints: ['media/webview-entry.js'],
    outfile: 'media/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    loader: {
        ...browserOptions.loader,
        '.ttf': 'dataurl'
    }
});

await build({
    ...browserOptions,
    entryPoints: ['media/editor.worker.entry.js'],
    outfile: 'media/editor.worker.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020'
});

await build({
    ...browserOptions,
    entryPoints: ['media/diff.worker.entry.js'],
    outfile: 'media/diff.worker.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020'
});

await build({
    ...sharedOptions,
    entryPoints: ['standalone/main.js'],
    outfile: 'out/standalone-main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron']
});

await build({
    ...browserOptions,
    entryPoints: ['web/host.js'],
    outfile: 'web/web-host.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020'
});

await build({
    ...sharedOptions,
    entryPoints: ['standalone/preload.js'],
    outfile: 'out/standalone-preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron']
});

// The hashes are shipped with the exporter, independently of CDN responses.
const runtimeAssets = ['web/presenter.css', 'media/webview.css', 'web/web-host.js', 'media/webview.js', 'media/editor.worker.js', 'media/diff.worker.js'];
const runtimeVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const assetHashes = {};
for (const name of runtimeAssets) assetHashes[name] = `sha256-${createHash('sha256').update(await readFile(name)).digest('base64')}`;
await writeFile('web/export-runtime.json', JSON.stringify({ schema: 1, version: runtimeVersion, assets: assetHashes }, null, 2) + '\n');
const licenses = [];
for (const name of ['LICENSE.txt', 'node_modules/monaco-editor/LICENSE', 'node_modules/diff/LICENSE']) {
    licenses.push(`${name}\n${await readFile(name, 'utf8')}`);
}
await writeFile('web/export-licenses.txt', licenses.join('\n\n'));
