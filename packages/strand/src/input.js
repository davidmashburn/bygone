const LIMITS = Object.freeze({ maxFiles: 50, maxFileBytes: 1048576, maxBytes: 4194304, maxRecords: 20000, timeoutMs: 30000, maxOutputBytes: 16777216 });

function inputProblem(before, after, limits) {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return 'invalid-snapshot-map';
    if (new Set([...Object.keys(before), ...Object.keys(after)]).size > Math.min(limits.maxFiles, LIMITS.maxFiles)) return 'file-budget';
    let bytes = 0;
    for (const files of [before, after]) for (const value of Object.values(files)) {
        if (typeof value !== 'string') return 'invalid-snapshot-text';
        const size = Buffer.byteLength(value); bytes += size;
        if (size > Math.min(limits.maxFileBytes, LIMITS.maxFileBytes)) return 'file-byte-budget';
    }
    return bytes > Math.min(limits.maxBytes, LIMITS.maxBytes) ? 'comparison-byte-budget' : null;
}

function boundedProcessOptions(options, timeoutKey, outputKey, defaultTimeout) {
    const timeout = options[timeoutKey] === undefined ? defaultTimeout : options[timeoutKey];
    const maxBuffer = options[outputKey] === undefined ? LIMITS.maxOutputBytes : options[outputKey];
    if (![timeout, maxBuffer].every(value => Number.isSafeInteger(value) && value > 0)) return null;
    return { timeout: Math.min(timeout, defaultTimeout), maxBuffer: Math.min(maxBuffer, LIMITS.maxOutputBytes) };
}

module.exports = { LIMITS, inputProblem, boundedProcessOptions };
