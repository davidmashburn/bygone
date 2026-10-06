import { stat } from 'node:fs/promises';

const budgets = [
    { path: 'media/webview.js', maxBytes: 3_910_000 },
    { path: 'media/webview.css', maxBytes: 375_000 },
    { path: 'media/editor.worker.js', maxBytes: 320_000 },
    // Includes whitespace ranges, edited paragraph alignment, and separate scroll anchors.
    { path: 'media/diff.worker.js', maxBytes: 22_000 },
    // Includes the offline authoring skill, semantic links, and portable history adapter.
    { path: 'web/web-host.js', maxBytes: 180_000 },
    { path: 'web/presenter.css', maxBytes: 36_000 }
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
