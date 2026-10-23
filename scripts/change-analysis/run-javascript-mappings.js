const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { digest, inventorySnapshot } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');
const { inputProblem, LIMITS } = require('./run-refactoring-mappings');
const { matchStrand, DEFAULT_LIMITS } = require('./js-correspondence');
const JAVASCRIPT_LIMITS = Object.freeze({ ...LIMITS, ...DEFAULT_LIMITS });

const ENGINE = { name: 'Bygone Strand', producer: 'bygone-strand', version: 1 };

function analyzeStrand(before, after, config = {}) {
    const limits = { ...JAVASCRIPT_LIMITS, ...config.limits };
    const invalidLimits = Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)
        || limits.maxRecords > 100000;
    const problem = invalidLimits ? 'invalid-limits' : inputProblem(before, after, limits);
    if (problem) return { analysis: { version: 1, status: 'unavailable', reason: problem, inventories: null, relations: [],
        scope: { note: 'Inventory not computed because input was invalid or over budget.' } }, native: null };
    const began = performance.now();
    const inventoryOptions = { ...config, strandFeatures: true };
    const inventories = { before: inventorySnapshot(before, 'before', inventoryOptions), after: inventorySnapshot(after, 'after', inventoryOptions) };
    const invalid = ['before', 'after'].some(side => inventories[side].documents.some(d => d.status === 'invalid'));
    let native;
    if (invalid) native = { status: 'unavailable', reason: 'parse-preflight-failed', mappers: [] };
    else {
        try { native = matchStrand(before, after, inventories, limits); }
        catch { native = { status: 'unavailable', reason: 'strand-engine-failed', mappers: [] }; }
    }
    const analysis = normalizeMappings(before, after, native, { inventories, engineProducer: ENGINE.producer });
    if (!Object.keys(before).length && !Object.keys(after).length) {
        analysis.status = 'unavailable'; analysis.engine.status = 'unavailable'; analysis.engine.reason = 'no-supported-documents';
    }
    return { analysis, native, engineMs: performance.now() - began,
        identity: { ...ENGINE, implementationSha256: digest(fs.readFileSync(require.resolve('./js-correspondence'))),
            pythonFeaturesSha256: digest(fs.readFileSync(require.resolve('./python-inventory.py'))),
            runnerSha256: digest(fs.readFileSync(__filename)) } };
}

// Keep the original development API for callers of the JS-only first slice.
module.exports = { analyzeStrand, analyzeJavaScript: analyzeStrand, ENGINE, JAVASCRIPT_LIMITS };
