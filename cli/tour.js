const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const { buildManifestForTourSource, loadTourSource } = require('./tourFile.js');

const TOUR_ACTIONS = Object.freeze(['validate', 'compile', 'schema']);

function runTourCommand(args, cwd, packageRoot, output = process.stdout) {
    const options = parseTourArgs(args);
    if (options.action === 'schema') {
        output.write(readFileSync(path.join(packageRoot, 'schemas', 'change-tour-source.schema.json'), 'utf8'));
        return { action: 'schema' };
    }

    const { resolvedPath, source } = loadTourSource(cwd, options.sourcePath);
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
        throw new Error(`Usage: bygone tour <${TOUR_ACTIONS.join('|')}> [file.bygone.yaml]`);
    }
    if (action === 'schema') {
        if (rest.length > 0) throw new Error('tour schema does not accept additional arguments.');
        return { action };
    }
    let sourcePath;
    let outputPath;
    let json = false;
    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === '--json') {
            json = true;
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
    if (!sourcePath) throw new Error(`tour ${action} requires a .bygone.yaml source file.`);
    if (action === 'validate' && outputPath) throw new Error('--output is only valid with tour compile.');
    if (action === 'compile' && json) throw new Error('--json is only valid with tour validate.');
    return { action, sourcePath, outputPath, json };
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
            (total, scene) => total + (scene.kind === 'walkthrough' ? scene.steps.length : 0),
            0
        )
    };
}

module.exports = {
    parseTourArgs,
    runTourCommand
};
