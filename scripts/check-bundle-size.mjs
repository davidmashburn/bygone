import { stat } from 'node:fs/promises';

const budgets = [
    // Includes union/focus highlighting, visible-panel preservation, and panel reordering.
    { path: 'media/webview.js', maxBytes: 4_000_000 },
    // Includes the embedded dependency graph dialog and its controls.
    { path: 'media/webview.css', maxBytes: 378_000 },
    { path: 'media/editor.worker.js', maxBytes: 320_000 },
    // Includes whitespace ranges, paragraph alignment, scroll anchors, and named-anchor highlighting.
    { path: 'media/diff.worker.js', maxBytes: 27_000 },
    // Includes the tour options menu, provenance, and strict coverage details.
    // This build measures approximately 323 KB; keep modest headroom for fixes.
    { path: 'web/web-host.js', maxBytes: 330_000 },
    { path: 'web/presenter.css', maxBytes: 59_000 }
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
