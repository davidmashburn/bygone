const LIMITS = { maxFiles: 50, maxFileBytes: 1048576, maxBytes: 4194304, maxRecords: 20000, timeoutMs: 30000, maxOutputBytes: 16777216 };

function inputProblem(before, after, limits) {
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return 'invalid-snapshot-map';
    if (new Set([...Object.keys(before), ...Object.keys(after)]).size > limits.maxFiles) return 'file-budget';
    let bytes = 0;
    for (const files of [before, after]) for (const value of Object.values(files)) {
        if (typeof value !== 'string') return 'invalid-snapshot-text';
        const size = Buffer.byteLength(value); bytes += size;
        if (size > limits.maxFileBytes) return 'file-byte-budget';
    }
    return bytes > limits.maxBytes ? 'comparison-byte-budget' : null;
}

module.exports = { LIMITS, inputProblem };
