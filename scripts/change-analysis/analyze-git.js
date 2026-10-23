const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveBranchReviewRange } = require('../../out/gitComparison');
const { importChangeCorrespondence } = require('../../out/changeCorrespondence');
const { compileBridge, analyzeWithBridge, LIMITS } = require('./run-refactoring-mappings');
const { analyzeStrand, ENGINE, JAVASCRIPT_LIMITS } = require('./run-javascript-mappings');

const USAGE = 'npm run correspondence:analyze -- [<head>] --base <base> --output <artifact.json> [--repo <checkout>] [--python <python3>] [--engine bygone-strand | --exact-only | --java <jdk/bin/java> --jar <RM-fat.jar> --jar-sha256 <verified digest>]';
const { isSupportedSource } = require('./symbol-inventory');

function parseArgs(args) {
    const options = {}, positional = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--exact-only') {
            if (options[arg]) throw new Error(`Repeated option: ${arg}`);
            options[arg] = true;
        } else if (['--base', '--output', '--repo', '--java', '--jar', '--jar-sha256', '--python', '--engine'].includes(arg)) {
            if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a value.`);
            if (options[arg]) throw new Error(`Repeated option: ${arg}`);
            options[arg] = args[++i];
        } else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        else positional.push(arg);
    }
    if (positional.length > 1 || !options['--base'] || !options['--output']) throw new Error(USAGE);
    if (options['--exact-only'] && ['--java', '--jar', '--jar-sha256'].some(key => options[key])) {
        throw new Error('--exact-only cannot be combined with Java engine options.');
    }
    if (options['--engine'] && options['--engine'] !== ENGINE.producer) throw new Error(`Unknown engine: ${options['--engine']}`);
    if (options['--engine'] && ['--exact-only', '--java', '--jar', '--jar-sha256'].some(key => options[key])) {
        throw new Error('--engine cannot be combined with exact-only or Java engine options.');
    }
    return { ...options, head: positional[0] || 'HEAD' };
}

function engineOptions(options, cwd, env) {
    if (options['--exact-only'] || options['--engine']) return null; // Deliberately ignore ambient engine configuration.
    const java = options['--java'] || env.MAPPING_JAVA;
    const jar = options['--jar'] || env.MAPPING_JAR;
    const expectedJarSha256 = options['--jar-sha256'] || env.MAPPING_JAR_SHA256;
    if (!java && !jar && !expectedJarSha256) return null;
    if (!java || !jar || !/^[a-f0-9]{64}$/.test(expectedJarSha256 || '')) {
        throw new Error('Incomplete Java engine configuration: provide --java/--jar/--jar-sha256 or MAPPING_JAVA/MAPPING_JAR/MAPPING_JAR_SHA256 together, or use --exact-only.');
    }
    return { java: path.resolve(cwd, java), jar: path.resolve(cwd, jar), expectedJarSha256 };
}

// Read committed blobs, never working-tree bytes. Rename detection is disabled
// so both names remain in scope even across language/extension changes.
function readSnapshots(range, limits = LIMITS) {
    const git = args => execFileSync('git', args, { cwd: range.repoRoot, maxBuffer: 8 * 1024 * 1024 });
    const paths = git(['diff', '--name-only', '-z', '--no-renames', range.mergeBaseOid, range.headOid, '--'])
        .toString('utf8').split('\0').filter(Boolean);
    const selected = paths.filter(p => isSupportedSource(p));
    if (selected.length > limits.maxFiles) throw new Error(`file-budget: ${selected.length} source paths exceeds ${limits.maxFiles}.`);
    const before = Object.create(null), after = Object.create(null), excluded = [];
    let bytes = 0;
    for (const p of paths.filter(p => !isSupportedSource(p))) excluded.push({ path: p, reason: 'unsupported-language' });
    for (const [oid, files] of [[range.mergeBaseOid, before], [range.headOid, after]]) {
        for (const p of selected) {
            const entry = git(['ls-tree', '-z', oid, '--', `:(literal)${p}`]).toString('utf8');
            if (!entry) continue; // Added/deleted on this side.
            const [mode, type, blob] = entry.slice(0, entry.indexOf('\t')).split(' ');
            if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
                excluded.push({ path: p, reason: 'non-regular-file', oid }); continue;
            }
            const size = Number(git(['cat-file', '-s', blob]).toString('utf8'));
            if (size > limits.maxFileBytes) throw new Error(`file-byte-budget: ${p}`);
            bytes += size;
            if (bytes > limits.maxBytes) throw new Error('comparison-byte-budget');
            const raw = git(['cat-file', 'blob', blob]), text = raw.toString('utf8');
            if (!Buffer.from(text, 'utf8').equals(raw) || text.includes('\0')) throw new Error(`non-text-source: ${p}`);
            files[p] = text;
        }
    }
    return { before, after, excluded };
}

function analyzeGit(args, cwd = process.cwd(), output = process.stdout, env = process.env) {
    const options = parseArgs(args);
    const engine = engineOptions(options, cwd, env);
    const python = options['--python'] || env.MAPPING_PYTHON || 'python3';
    const pythonExecutable = /[\\/]/.test(python) ? path.resolve(cwd, python) : python;
    const range = resolveBranchReviewRange(path.resolve(cwd, options['--repo'] || '.'), options.head, options['--base']);
    const snapshots = readSnapshots(range);
    let config;
    try {
        if (engine) config = compileBridge(engine);
        const javascript = options['--engine'] === ENGINE.producer;
        const result = javascript ? analyzeStrand(snapshots.before, snapshots.after, { python: pythonExecutable })
            : analyzeWithBridge(snapshots.before, snapshots.after, { ...config, python: pythonExecutable });
        result.analysis.scope.excluded = snapshots.excluded;
        result.analysis.scope.note = 'Changed supported-language regular files only. Unchanged files are outside the candidate universe; repository-wide origins were not searched.';
        const artifact = importChangeCorrespondence(range.repoRoot, result, { baseOid: range.mergeBaseOid, headOid: range.headOid });
        artifact.limitations.push(`Changed supported-language regular files only; ${snapshots.excluded.length} changed path/side exclusions. Unchanged files are outside the candidate universe.`,
            `Parser: ${[...new Set([result.analysis.inventories.before.parser, result.analysis.inventories.after.parser])].join('; ')}.`,
            `Engine status: ${result.analysis.engine.status}; reason: ${result.analysis.engine.reason || 'none'}; limits: ${JSON.stringify(javascript ? JAVASCRIPT_LIMITS : LIMITS)}.`);
        if (config) artifact.limitations.push(`Engine SHA-256: ${config.jarSha256}; bridge SHA-256: ${config.bridgeSha256}.`);
        else if (javascript) artifact.limitations.push(`${ENGINE.name} v${ENGINE.version}: JS/TS/Python/Java/Go/Rust/Mojo declaration correspondence; Mojo is experimental (pinned community grammar); Python .pyi stubs have inventory/exact matching only. Extraction/inline, binding resolution and behavior preservation are not assessed.`,
            `Engine implementation SHA-256: ${result.identity.implementationSha256}; Python features SHA-256: ${result.identity.pythonFeaturesSha256}; runner SHA-256: ${result.identity.runnerSha256}.`);
        else artifact.limitations.push('Java engine not configured: inventory and unambiguous byte-identical declaration matching only. Edited or renamed declarations are not paired; unmatched symbols do not prove additions or removals.');
        const diagnostics = ['before', 'after'].flatMap(side => result.analysis.inventories[side].documents
            .flatMap(d => d.diagnostics.map(diag => `${side}:${d.path}: ${diag.message.slice(0, 300)}`)));
        if (diagnostics.length) artifact.limitations.push(`Inventory diagnostics (${diagnostics.length}): ${diagnostics.slice(0, 20).join('; ')}`);
        if (!javascript && [...Object.keys(snapshots.before), ...Object.keys(snapshots.after)].some(p => /\.pyi$/.test(p))) {
            artifact.limitations.push('Python .pyi stubs are independently inventoried, but this pinned engine does not parse them. Comparison is partial; stub declarations accept only independent exact matches. Analyzed implementation declarations may still have inferred engine matches.');
        }
        const destination = path.resolve(cwd, options['--output']);
        const serialized = JSON.stringify(artifact, null, 2) + '\n';
        if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new Error('Correspondence file exceeds 16 MiB.');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        // Do not overwrite an existing artifact or source file.
        fs.writeFileSync(destination, serialized, { flag: 'wx' });
        output.write(`Wrote ${artifact.relations.length} inferred correspondences (${artifact.status}) to ${destination}\n`);
        output.write(`Pinned ${range.mergeBaseOid}..${range.headOid}; engine ${result.analysis.engine.status}${result.analysis.engine.reason ? ` (${result.analysis.engine.reason})` : ''}\n`);
        if (javascript) output.write(`${ENGINE.name} v${ENGINE.version}: inferred JS/TS/Python/Java/Go/Rust/Mojo declaration correspondence; behavior unassessed.\n`);
        else if (!config) output.write('Exact-only coverage: edited/renamed declarations may remain unmatched. Configure the optional Java engine for broader inference.\n');
        return artifact;
    } finally {
        if (config) fs.rmSync(config.buildDir, { recursive: true, force: true });
    }
}

module.exports = { parseArgs, readSnapshots, analyzeGit };
if (require.main === module) {
    try { analyzeGit(process.argv.slice(2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
