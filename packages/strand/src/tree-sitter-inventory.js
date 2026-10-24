const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { boundedProcessOptions } = require('./input');
function treeSitterInventory(files, options) {
    const processOptions = boundedProcessOptions(options, 'treeSitterTimeoutMs', 'treeSitterMaxOutputBytes', 30000);
    const result = processOptions ? spawnSync(process.execPath, [path.join(__dirname, 'tree-sitter-worker.js')], {
        input: JSON.stringify({ files, strandFeatures: options.strandFeatures === true }), encoding: 'utf8', windowsHide: true,
        ...processOptions
    }) : { error: { code: 'invalid-tree-sitter-parser-options' } };
    let reason = !processOptions ? 'invalid-tree-sitter-parser-options' : result.error?.code === 'ETIMEDOUT' ? 'tree-sitter-parser-timeout'
        : result.error ? 'tree-sitter-parser-process' : result.status !== 0 ? 'tree-sitter-parser-exit' : 'invalid-tree-sitter-output';
    if (!result.error && result.status === 0) {
        try {
            const parsed = JSON.parse(result.stdout);
            if (!parsed.parser?.startsWith('web-tree-sitter@0.27.1') || !parsed.documents
                || Object.keys(files).some(p => !parsed.documents[p] || !['complete', 'invalid'].includes(parsed.documents[p].status)
                    || !Array.isArray(parsed.documents[p].entries) || !Array.isArray(parsed.documents[p].exclusions))) throw new Error();
            return parsed;
        } catch { reason = 'invalid-tree-sitter-output'; }
    }
    return { parser: 'web-tree-sitter@unavailable', documents: Object.fromEntries(Object.keys(files).map(p => [p,
        { status: 'invalid', diagnostics: [{ message: reason }], entries: [], exclusions: [] }])) };
}
module.exports = { treeSitterInventory };
