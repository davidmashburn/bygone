import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const vsce = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
const output = execFileSync(vsce, ['ls'], { encoding: 'utf8' });
const files = output.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
const allowed = new Set([
    'package.json',
    'README.md',
    'LICENSE.txt',
    'CHANGELOG.md',
    'out/extension.js',
    'media/webview.js',
    'media/webview.css',
    'media/editor.worker.js',
    'media/icon.png',
    'media/bygone-screenshot.png'
]);
const unexpected = files.filter((file) => !allowed.has(file));
const missing = [...allowed].filter((file) => !files.includes(file));
const maximumBytes = 5 * 1024 * 1024;
const totalBytes = files.reduce((total, file) => total + fs.statSync(path.join(process.cwd(), file)).size, 0);
if (unexpected.length || missing.length) {
    throw new Error([
        unexpected.length ? `Unexpected VSIX files:\n${unexpected.join('\n')}` : '',
        missing.length ? `Missing VSIX files:\n${missing.join('\n')}` : ''
    ].filter(Boolean).join('\n\n'));
}
if (totalBytes > maximumBytes) {
    throw new Error(`VSIX runtime files exceed the ${(maximumBytes / 1024 / 1024).toFixed(1)} MiB budget: ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`);
}
process.stdout.write(`VSIX contents verified (${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB).\n`);
