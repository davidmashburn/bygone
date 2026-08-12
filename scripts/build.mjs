import { rm } from 'fs/promises';
import { build } from 'esbuild';

const sharedOptions = {
    bundle: true,
    sourcemap: true,
    logLevel: 'info'
};

const browserOptions = {
    ...sharedOptions,
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
    ...browserOptions,
    entryPoints: ['media/webview-entry.js'],
    outfile: 'media/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    loader: {
        '.ttf': 'file'
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
