const path = require('path');
const { lstatSync, mkdirSync, statSync, writeFileSync } = require('fs');
const { resolveBranchReviewRange } = require('../out/gitComparison');
const { importChangeCorrespondence, readCorrespondenceJson } = require('../out/changeCorrespondence');

function importCorrespondenceCommand(args, cwd, output = process.stdout) {
    if (args[0] !== 'import') throw new Error('Usage: bygone correspondence import <report.json> [<head>] --base <base> [--case <id>] --output <artifact.json>');
    const options = {};
    const positional = [];
    for (let i = 1; i < args.length; i++) {
        const arg = args[i];
        if (['--base', '--case', '--output', '-o'].includes(arg)) {
            if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`${arg} requires a value.`);
            options[arg === '-o' ? '--output' : arg] = args[++i];
        } else if (arg.startsWith('-')) throw new Error(`Unknown correspondence option: ${arg}`);
        else positional.push(arg);
    }
    if (!positional.length || positional.length > 2 || !options['--output']) throw new Error('Provide a producer report, at most one head ref, and --output.');
    const reportPath = path.resolve(cwd, positional[0]);
    const destination = path.resolve(cwd, options['--output']);
    assertDestinationAvailable(reportPath, destination);
    const report = readCorrespondenceJson(reportPath);
    if (!report || typeof report !== 'object') throw new Error('Invalid correspondence report.');
    let selected = report;
    if (Array.isArray(report.cases)) {
        if (!options['--case']) throw new Error('A multi-case producer report requires --case.');
        const matches = report.cases.filter(c => c.id === options['--case']);
        if (matches.length !== 1) throw new Error('Select exactly one existing producer case.');
        selected = matches[0];
    } else if (options['--case']) throw new Error('--case requires a multi-case producer report.');
    const range = resolveBranchReviewRange(cwd, positional[1] || 'HEAD', options['--base']);
    const artifact = importChangeCorrespondence(range.repoRoot, selected, { baseOid: range.mergeBaseOid, headOid: range.headOid });
    mkdirSync(path.dirname(destination), { recursive: true });
    try {
        writeFileSync(destination, JSON.stringify(artifact, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
        if (error?.code === 'EEXIST') throw new Error(`The correspondence output already exists at ${destination}; choose a new path.`, { cause: error });
        throw new Error(`Could not create correspondence output at ${destination}: ${error.message}`, { cause: error });
    }
    output.write(`Wrote ${artifact.relations.length} inferred correspondences (${artifact.status}) to ${destination}\n`);
    return artifact;
}

function assertDestinationAvailable(reportPath, destination) {
    if (sameActualFile(reportPath, destination)) {
        throw new Error('The imported artifact must not overwrite the producer report or any of its symlink/hardlink aliases.');
    }
    try {
        lstatSync(destination);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw new Error(`Could not inspect correspondence output at ${destination}: ${error.message}`, { cause: error });
    }
    throw new Error(`The correspondence output already exists at ${destination}; choose a new path.`);
}

function sameActualFile(first, second) {
    if (first === second) return true;
    try {
        const left = statSync(first);
        const right = statSync(second);
        if (left.dev !== undefined && left.ino !== undefined
            && left.dev === right.dev && left.ino === right.ino
            && left.ino !== 0 && right.ino !== 0) return true;
    } catch {
        return false;
    }
    return false;
}

module.exports = { importCorrespondenceCommand };
