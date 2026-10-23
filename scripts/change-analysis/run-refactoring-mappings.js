const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { digest } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');
const { createHash } = require('node:crypto');

const PINNED_JAR_SHA256 = '8f760b20a2be7552869cee1e1375008c76ac031c1c241f26cd55d32703887dce';
const BRIDGE = path.join(__dirname, 'refactoring-miner/BygoneMappingsBridge.java');
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

function compileBridge(config) {
    const jar = fs.readFileSync(config.jar);
    const jarSha256 = createHash('sha256').update(jar).digest('hex');
    if (jarSha256 !== (config.expectedJarSha256 || PINNED_JAR_SHA256)) throw new Error('engine-jar-digest-mismatch: provide the verified build digest explicitly');
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-mapping-bridge-'));
    const javac = path.join(path.dirname(config.java), process.platform === 'win32' ? 'javac.exe' : 'javac');
    const compiled = spawnSync(javac, ['-proc:none', '-cp', config.jar, '-d', buildDir, BRIDGE], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 1048576
    });
    if (compiled.error || compiled.status !== 0) throw new Error(`bridge-compile-failed: ${compiled.error?.message || compiled.stderr}`);
    return { ...config, buildDir, jarSha256, bridgeSha256: digest(fs.readFileSync(BRIDGE, 'utf8')) };
}

function analyzeWithBridge(before, after, config = {}) {
    const limits = { ...LIMITS, ...config.limits };
    const invalidLimits = Object.values(limits).some(value => !Number.isInteger(value) || value < 1) || limits.maxRecords > 100000;
    const problem = invalidLimits ? 'invalid-limits' : inputProblem(before, after, limits);
    if (problem) return { analysis: { version: 1, status: 'unavailable', reason: problem, inventories: null, relations: [],
        scope: { note: 'Inventory not computed because the input was invalid or over budget.' } }, native: null };
    // Parse preflight remains authoritative even if the Java engine reports success.
    const fallback = reason => ({ analysis: normalizeMappings(before, after, { status: 'unavailable', reason, mappers: [] }),
        native: { status: 'unavailable', reason, mappers: [] } });
    const preflight = normalizeMappings(before, after, { status: 'unavailable', reason: 'engine-not-run', mappers: [] });
    if ([...preflight.inventories.before.documents, ...preflight.inventories.after.documents].some(d => d.status === 'invalid')) {
        return fallback('parse-preflight-failed');
    }
    if (!config.java || !config.jar || !config.buildDir) return fallback('engine-not-configured');
    const began = performance.now();
    const result = spawnSync(config.java, ['-Xmx2g', '-cp', `${config.buildDir}${path.delimiter}${config.jar}`, 'BygoneMappingsBridge'], {
        input: JSON.stringify({ before, after, maxRecords: limits.maxRecords }), encoding: 'utf8',
        timeout: limits.timeoutMs, maxBuffer: limits.maxOutputBytes, windowsHide: true
    });
    let native;
    if (result.error) native = { status: 'unavailable', reason: result.error.code === 'ETIMEDOUT' ? 'engine-timeout' : `engine-process: ${result.error.code}`, mappers: [] };
    else if (result.status !== 0) native = { status: 'unavailable', reason: `engine-exit-${result.status}`, mappers: [] };
    else {
        try {
            native = JSON.parse(result.stdout);
            if (native.version !== 1 || !['complete', 'partial', 'unavailable'].includes(native.status) || !Array.isArray(native.mappers)) throw new Error('invalid-bridge-output');
        } catch { native = { status: 'unavailable', reason: 'invalid-bridge-output', mappers: [] }; }
    }
    return { analysis: normalizeMappings(before, after, native), native,
        engineMs: performance.now() - began, stderr: result.stderr || '',
        identity: { jarSha256: config.jarSha256, bridgeSha256: config.bridgeSha256 } };
}

module.exports = { compileBridge, analyzeWithBridge, inputProblem, LIMITS };

if (require.main === module) {
    const [java, jar, manifestFile, outputFile, expectedJarSha256] = process.argv.slice(2);
    if (!java || !jar || !manifestFile || !outputFile) throw new Error('Usage: node run-refactoring-mappings.js <java> <jar> <manifest.json> <output.json> [verified jar sha256]');
    const config = compileBridge({ java, jar, expectedJarSha256 });
    const raw = fs.readFileSync(manifestFile), manifest = JSON.parse(raw);
    const report = { version: 1, manifestSha256: digest(raw), jarSha256: config.jarSha256,
        bridgeSha256: config.bridgeSha256, limits: LIMITS, cases: [] };
    for (const c of manifest.cases) {
        let before = c.before, after = c.after;
        if (c.excludeUnchanged) {
            const keep = p => before[p] !== after[p];
            const a = Object.fromEntries(Object.entries(before).filter(([p]) => keep(p)));
            const b = Object.fromEntries(Object.entries(after).filter(([p]) => keep(p)));
            before = a; after = b;
        }
        report.cases.push({ id: c.id, split: c.split, ...analyzeWithBridge(before, after, config) });
        fs.writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
    }
    console.log(`${report.cases.length} comparisons written to ${outputFile}`);
}
