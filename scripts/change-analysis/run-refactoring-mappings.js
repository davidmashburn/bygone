const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { digest } = require('./symbol-inventory');
const { normalizeMappings } = require('./refactoring-mappings');
const { createHash } = require('node:crypto');

const PINNED_JAR_SHA256 = '8f760b20a2be7552869cee1e1375008c76ac031c1c241f26cd55d32703887dce';
const BRIDGE = path.join(__dirname, 'refactoring-miner/BygoneMappingsBridge.java');
const { LIMITS, inputProblem, boundedProcessOptions } = require('../../packages/strand/src/input');

function compileBridge(config) {
    if (!config.java || !config.jar) throw new Error('Provide an explicit java executable and engine jar.');
    const jar = fs.readFileSync(config.jar);
    const jarSha256 = createHash('sha256').update(jar).digest('hex');
    if (jarSha256 !== (config.expectedJarSha256 || PINNED_JAR_SHA256)) throw new Error('engine-jar-digest-mismatch: provide the verified build digest explicitly');
    const javac = path.join(path.dirname(config.java), process.platform === 'win32' ? 'javac.exe' : 'javac');
    const versions = [config.java, javac].map(executable => {
        const result = childProcess.spawnSync(executable, ['-version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 1048576, windowsHide: true });
        const major = Number(`${result.stdout || ''}\n${result.stderr || ''}`.match(/(?:version\s+"|javac\s+)(\d+)/)?.[1]);
        if (result.error || result.status !== 0 || !major || major < 21) {
            throw new Error(`java-toolchain-unavailable: use an explicit JDK 21+ with sibling java and javac; ${path.basename(executable)} version check failed${result.error ? ` (${result.error.code})` : ''}. Use --exact-only to analyze without Java.`);
        }
        return major;
    });
    if (versions[0] !== versions[1]) throw new Error('java-toolchain-mismatch: java and sibling javac must have the same major version.');
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-mapping-bridge-'));
    const compiled = childProcess.spawnSync(javac, ['-proc:none', '-cp', config.jar, '-d', buildDir, BRIDGE], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 1048576
    });
    if (compiled.error || compiled.status !== 0) {
        fs.rmSync(buildDir, { recursive: true, force: true });
        throw new Error(`bridge-compile-failed: verify the pinned engine build and JDK 21+; ${compiled.error?.message || compiled.stderr}`);
    }
    return { ...config, buildDir, jarSha256, bridgeSha256: digest(fs.readFileSync(BRIDGE, 'utf8')) };
}

function analyzeWithBridge(before, after, config = {}) {
    const requestedLimits = config.limits ?? {};
    const processOptions = boundedProcessOptions(requestedLimits, 'timeoutMs', 'maxOutputBytes', LIMITS.timeoutMs);
    const limits = { ...LIMITS, ...requestedLimits,
        ...(processOptions ? { timeoutMs: processOptions.timeout, maxOutputBytes: processOptions.maxBuffer } : {}) };
    const invalidLimits = !processOptions
        || Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)
        || limits.maxRecords > 100000;
    const problem = invalidLimits ? 'invalid-limits' : inputProblem(before, after, limits);
    if (problem) return { analysis: { version: 1, status: 'unavailable', reason: problem, inventories: null, relations: [],
        scope: { note: 'Inventory not computed because the input was invalid or over budget.' } }, native: null };
    const inventoryOptions = { python: config.python, pythonTimeoutMs: config.pythonTimeoutMs, pythonMaxOutputBytes: config.pythonMaxOutputBytes };
    if (!Object.keys(before).length && !Object.keys(after).length) {
        const native = { status: 'unavailable', reason: 'no-supported-documents', mappers: [] };
        return { analysis: { ...normalizeMappings(before, after, native, inventoryOptions), status: 'unavailable' }, native };
    }
    // Parse preflight remains authoritative even if the Java engine reports success.
    const fallback = reason => ({ analysis: normalizeMappings(before, after, { status: 'unavailable', reason, mappers: [] }, inventoryOptions),
        native: { status: 'unavailable', reason, mappers: [] } });
    const preflight = normalizeMappings(before, after, { status: 'unavailable', reason: 'engine-not-run', mappers: [] }, inventoryOptions);
    inventoryOptions.inventories = preflight.inventories;
    if ([...preflight.inventories.before.documents, ...preflight.inventories.after.documents].some(d => d.status === 'invalid')) {
        return fallback('parse-preflight-failed');
    }
    if (!config.java || !config.jar || !config.buildDir) return fallback('engine-not-configured');
    const began = performance.now();
    const result = childProcess.spawnSync(config.java, ['-Xmx2g', '-cp', `${config.buildDir}${path.delimiter}${config.jar}`, 'BygoneMappingsBridge'], {
        input: JSON.stringify({ before, after, maxRecords: limits.maxRecords }), encoding: 'utf8',
        ...processOptions, windowsHide: true
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
    return { analysis: normalizeMappings(before, after, native, inventoryOptions), native,
        engineMs: performance.now() - began, stderr: result.stderr || '',
        identity: { jarSha256: config.jarSha256, bridgeSha256: config.bridgeSha256 } };
}

module.exports = { compileBridge, analyzeWithBridge, inputProblem, LIMITS };

if (require.main === module) {
    const [java, jar, manifestFile, outputFile, expectedJarSha256] = process.argv.slice(2);
    if (!java || !jar || !manifestFile || !outputFile) throw new Error('Usage: node run-refactoring-mappings.js <java> <jar> <manifest.json> <output.json> [verified jar sha256]');
    const config = compileBridge({ java, jar, expectedJarSha256 });
    try {
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
    } finally {
        fs.rmSync(config.buildDir, { recursive: true, force: true });
    }
}
