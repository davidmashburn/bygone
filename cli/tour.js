const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const { buildChangeTourContext } = require('../out/changeTour.js');
const { buildTourCoverageReport } = require('../out/tourCoverage.js');
const { buildManifestForTourSource, loadTourSource } = require('./tourFile.js');

const TOUR_ACTIONS = Object.freeze(['context', 'coverage', 'validate', 'compile', 'schema']);

function runTourCommand(args, cwd, packageRoot, output = process.stdout) {
    const options = parseTourArgs(args);
    if (options.action === 'schema') {
        output.write(readFileSync(path.join(packageRoot, 'schemas', 'change-tour-source.schema.json'), 'utf8'));
        return { action: 'schema' };
    }
    if (options.action === 'context') {
        const context = buildChangeTourContext(cwd, {
            headRef: options.headRef,
            baseRef: options.baseRef,
            maxPatchBytes: options.maxPatchBytes,
            maxTotalPatchBytes: options.maxTotalPatchBytes
        });
        return writeJsonResult('change-tour context', context, options.outputPath, cwd, output);
    }

    const { resolvedPath, source } = loadTourSource(cwd, options.sourcePath);
    if (options.action === 'coverage') {
        const report = buildTourCoverageReport(cwd, source);
        output.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderCoverageReport(report));
        if (options.minimumCoverage !== undefined && report.totals.coveragePercent < options.minimumCoverage) {
            throw new Error(`Tour coverage ${report.totals.coveragePercent}% is below the required ${options.minimumCoverage}%.`);
        }
        return { action: 'coverage', sourcePath: resolvedPath, report };
    }
    const manifest = buildManifestForTourSource(cwd, source);
    if (options.action === 'validate') {
        const result = buildValidationResult(resolvedPath, manifest);
        output.write(options.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `Valid change tour: ${path.relative(cwd, resolvedPath) || path.basename(resolvedPath)} · ${result.walkthroughSteps} steps · ${result.summary.changedFiles} changed files · ${result.range.mergeBaseOid.slice(0, 7)} → ${result.range.headOid.slice(0, 7)}\n`);
        return result;
    }

    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    if (options.outputPath) {
        const resolvedOutput = path.resolve(cwd, options.outputPath);
        mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        writeFileSync(resolvedOutput, serialized, 'utf8');
        output.write(`Wrote compiled change tour to ${resolvedOutput}\n`);
        return { action: 'compile', outputPath: resolvedOutput, manifest };
    }
    output.write(serialized);
    return { action: 'compile', manifest };
}

function parseTourArgs(args) {
    const [action, ...rest] = args;
    if (!TOUR_ACTIONS.includes(action)) {
        throw new Error(`Usage: bygone tour <${TOUR_ACTIONS.join('|')}> [file.bygone]`);
    }
    if (action === 'schema') {
        if (rest.length > 0) throw new Error('tour schema does not accept additional arguments.');
        return { action };
    }
    if (action === 'context') return parseContextArgs(rest);
    let sourcePath;
    let outputPath;
    let json = false;
    let minimumCoverage;
    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === '--json') {
            json = true;
            continue;
        }
        if (arg === '--minimum-coverage') {
            minimumCoverage = Number.parseInt(rest[++index], 10);
            if (!Number.isInteger(minimumCoverage) || minimumCoverage < 0 || minimumCoverage > 100) {
                throw new Error('--minimum-coverage requires an integer from 0 to 100.');
            }
            continue;
        }
        if (arg === '--output' || arg === '-o') {
            if (!rest[index + 1]) throw new Error(`${arg} requires a file path.`);
            outputPath = rest[++index];
            continue;
        }
        if (arg.startsWith('-')) throw new Error(`Unknown tour option: ${arg}`);
        if (sourcePath) throw new Error(`tour ${action} accepts exactly one source file.`);
        sourcePath = arg;
    }
    if (!sourcePath) throw new Error(`tour ${action} requires a .bygone source file.`);
    if (action === 'validate' && outputPath) throw new Error('--output is only valid with tour compile.');
    if (action === 'compile' && json) throw new Error('--json is only valid with tour validate or coverage.');
    if (action !== 'coverage' && minimumCoverage !== undefined) {
        throw new Error('--minimum-coverage is only valid with tour coverage.');
    }
    return { action, sourcePath, outputPath, json, ...(action === 'coverage' ? { minimumCoverage } : {}) };
}

function renderCoverageReport(report) {
    const lines = [
        `Tour coverage: ${report.totals.coveredUnits}/${report.totals.includedUnits} hunks (${report.totals.coveragePercent}%)`,
        `Depth: ${report.depth.mentioned} mentioned · ${report.depth.explained} explained · ${report.depth.contextualized} contextualized`
    ];
    if (report.totals.excludedUnits > 0) lines.push(`Excluded: ${report.totals.excludedUnits}/${report.totals.originalUnits} hunks`);
    for (const file of report.files.filter((entry) => entry.uncoveredHunks.length > 0)) {
        lines.push(`${file.path}: ${file.uncoveredHunks.length} uncovered (${file.uncoveredHunks.join(', ')})`);
    }
    for (const unsupported of report.unsupported) lines.push(`${unsupported.path}: ${unsupported.material} material not scored`);
    return `${lines.join('\n')}\n`;
}

function parseContextArgs(args) {
    let headRef;
    let baseRef;
    let outputPath;
    let maxPatchBytes;
    let maxTotalPatchBytes;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--base' || arg === '-m' || arg === '--main') {
            if (!args[index + 1]) throw new Error(`${arg} requires a Git ref.`);
            baseRef = args[++index];
            continue;
        }
        if (arg === '--output' || arg === '-o') {
            if (!args[index + 1]) throw new Error(`${arg} requires a file path.`);
            outputPath = args[++index];
            continue;
        }
        if (arg === '--max-patch-bytes') {
            if (!args[index + 1]) throw new Error(`${arg} requires a positive integer.`);
            maxPatchBytes = Number.parseInt(args[++index], 10);
            if (!Number.isInteger(maxPatchBytes) || maxPatchBytes < 1) {
                throw new Error(`${arg} requires a positive integer.`);
            }
            continue;
        }
        if (arg === '--max-total-patch-bytes') {
            if (!args[index + 1]) throw new Error(`${arg} requires a positive integer.`);
            maxTotalPatchBytes = Number.parseInt(args[++index], 10);
            if (!Number.isInteger(maxTotalPatchBytes) || maxTotalPatchBytes < 1) {
                throw new Error(`${arg} requires a positive integer.`);
            }
            continue;
        }
        if (arg.startsWith('-')) throw new Error(`Unknown tour context option: ${arg}`);
        if (headRef) throw new Error('tour context accepts at most one head ref.');
        headRef = arg;
    }
    return { action: 'context', headRef, baseRef, outputPath, maxPatchBytes, maxTotalPatchBytes };
}

function writeJsonResult(label, value, outputPath, cwd, output) {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (!outputPath) {
        output.write(serialized);
        return { action: 'context', context: value };
    }
    const resolvedOutput = path.resolve(cwd, outputPath);
    mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    writeFileSync(resolvedOutput, serialized, 'utf8');
    output.write(`Wrote ${label} to ${resolvedOutput}\n`);
    return { action: 'context', outputPath: resolvedOutput, context: value };
}

function buildValidationResult(sourcePath, manifest) {
    return {
        ok: true,
        sourcePath,
        title: manifest.title,
        range: manifest.range,
        summary: manifest.summary,
        chapters: manifest.chapters.length,
        walkthroughSteps: manifest.scenes.reduce(
            (total, scene) => total + (
                scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff'
                    ? scene.steps.length
                    : 0
            ),
            0
        )
    };
}

module.exports = {
    parseTourArgs,
    runTourCommand
};
