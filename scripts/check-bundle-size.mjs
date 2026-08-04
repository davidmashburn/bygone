import { stat } from 'node:fs/promises';

const budgets = [
    { path: 'media/webview.js', maxBytes: 2_900_000 },
    { path: 'media/webview.css', maxBytes: 375_000 },
    { path: 'media/editor.worker.js', maxBytes: 320_000 },
    { path: 'media/diff.worker.js', maxBytes: 12_000 },
    { path: 'web/web-host.js', maxBytes: 33_000 },
    { path: 'web/presenter.css', maxBytes: 15_000 }
];

let failed = false;

for (const budget of budgets) {
    const { size } = await stat(budget.path);
    const percent = Math.round((size / budget.maxBytes) * 100);
    console.log(`${budget.path}: ${formatBytes(size)} / ${formatBytes(budget.maxBytes)} (${percent}%)`);

    if (size > budget.maxBytes) {
        failed = true;
    }
}

if (failed) {
    throw new Error('One or more renderer bundles exceed their size budget.');
}

function formatBytes(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}
