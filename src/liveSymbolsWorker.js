// Runs existing Strand in a bounded worker, leaving the Extension Host responsive.
const { parentPort } = require('node:worker_threads');
const { inventorySnapshot, digest } = require('../packages/strand/src/symbol-inventory');
const { matchJavaScript } = require('../packages/strand/src/js-correspondence');
parentPort.on('message', ({ leftPath, rightPath, left, right }) => {
    const before = { [leftPath]: left }, after = { [rightPath]: right };
    const inventories = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
    const result = matchJavaScript(before, after, inventories, { timeoutMs: 300, maxCandidates: 20000, maxRecords: 2000 });
    parentPort.postMessage({ leftDigest: digest(left), rightDigest: digest(right),
        left: inventories.before.entries, right: inventories.after.entries,
        status: result.status, reason: result.reason, pairs: result.mappers || [],
        diagnostics: result.unresolved || [] });
});
