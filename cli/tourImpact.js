const { createHash } = require('node:crypto');
const { readFileSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseChangeTourManifest } = require('../out/changeTour.js');
const { buildTourRevisionImpactReport } = require('../out/tourRevisionImpact.js');
const { serializeDeepLink } = require('../out/deepLink.js');
const { repositoryRoot, readPinnedFile } = require('../out/reviewWorkspace.js');

/** Use a previously compiled snapshot: recompiling moving refs would erase the baseline. */
function runTourImpact(args, cwd, output, commandOptions = {}) {
    let input, head, destination, correspondence;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--json') continue;
        if (['--head', '--output', '-o', '--correspondence'].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value.`);
            if (arg === '--head') head = value;
            else if (arg === '--correspondence') correspondence = path.resolve(cwd, value);
            else destination = path.resolve(cwd, value);
        } else if (arg.startsWith('-') || input) throw new Error(`Unexpected impact argument: ${arg}`);
        else input = path.resolve(cwd, arg);
    }
    if (!input || !head) throw new Error('Usage: bygone tour impact <compiled-tour.json> --head <revision> [--correspondence <artifact.json>] [--output <new-report.json>]');
    if (statSync(input).size > 16 * 1024 * 1024) throw new Error('Compiled tour exceeds 16 MiB.');
    const bytes = readFileSync(input);
    const manifest = parseChangeTourManifest(JSON.parse(bytes.toString('utf8')));
    const root = repositoryRoot(commandOptions.repoRoot || cwd);
    const report = {
        ...buildTourRevisionImpactReport(manifest, root, {
            newHeadRef: head, correspondencePath: correspondence
        }),
        document: { file: path.basename(input), sha256: createHash('sha256').update(bytes).digest('hex') }
    };
    addEvidenceLinks(report, root);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (destination) {
        writeFileSync(destination, serialized, { flag: 'wx' });
        output.write(`Wrote tour revision-impact report to ${destination}\n`);
    } else output.write(serialized);
    return { action: 'impact', report, outputPath: destination };
}

function addEvidenceLinks(report, root) {
    const repo = pathToFileURL(root).href;
    const baseline = [report.baseline.mergeBaseOid, report.baseline.headOid];
    const delta = [report.baseline.headOid, report.newHead.oid];
    const comparison = delta[0] !== delta[1] ? delta : baseline;
    const sources = new Map();
    const evidenceLink = ref => {
        if (!ref) return undefined;
        const revisions = comparison.includes(ref.revision) ? comparison
            : [ref.revision, report.newHead.oid];
        if (revisions[0] === revisions[1]) return undefined;
        const key = JSON.stringify([ref.revision, ref.path]);
        if (!sources.has(key)) sources.set(key, readPinnedFile(root, ref.revision, ref.path)?.text);
        const source = sources.get(key);
        if (source === undefined) return undefined;
        return serializeDeepLink({ kind: 'compare', repo, revisions, file: ref.path,
            revision: ref.revision, line: source.slice(0, ref.start).split('\n').length });
    };
    for (const observation of report.observations) {
        for (const reference of observation.references) {
            const oldLink = evidenceLink(reference.oldRef);
            const newLink = evidenceLink(reference.newRef);
            if (oldLink) reference.oldEvidenceLink = oldLink;
            if (newLink) reference.newEvidenceLink = newLink;
        }
    }
    if (comparison[0] === comparison[1]) return;
    report.comparisonLink = serializeDeepLink({ kind: 'compare', repo, revisions: comparison });
    for (const change of [...report.uncoveredChanges, ...report.unsupportedChanges]) {
        try {
            change.comparisonLink = serializeDeepLink({ kind: 'compare', repo, revisions: comparison, file: change.path });
        } catch {
            // Some valid Git paths cannot be focused by the deep-link contract.
            change.comparisonLink = report.comparisonLink;
        }
    }
}

module.exports = { runTourImpact };
