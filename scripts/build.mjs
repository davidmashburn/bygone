import { rm } from 'fs/promises';
import { build } from 'esbuild';

const sharedOptions = {
    bundle: true,
    sourcemap: true,
    logLevel: 'info'
};

await rm('out', { recursive: true, force: true });
await rm('media/webview.js', { force: true });
await rm('media/webview.js.map', { force: true });
await rm('media/webview.css', { force: true });
await rm('media/webview.css.map', { force: true });
await rm('media/editor.worker.js', { force: true });
await rm('media/editor.worker.js.map', { force: true });

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
    ...sharedOptions,
    entryPoints: ['media/editor.worker.entry.js'],
    outfile: 'media/editor.worker.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020'
});
