import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

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
if (unexpected.length || missing.length) {
    throw new Error([
        unexpected.length ? `Unexpected VSIX files:\n${unexpected.join('\n')}` : '',
        missing.length ? `Missing VSIX files:\n${missing.join('\n')}` : ''
    ].filter(Boolean).join('\n\n'));
}
process.stdout.write(`VSIX contents verified (${files.length} files).\n`);
