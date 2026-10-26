'use strict';
const fs = require('fs');
const path = require('path');
const workspace = require('../out/reviewWorkspace');
const { parseReview } = require('../out/requirements');
const { inspectDependencies } = require('../out/reviewDependencies');

function runEvidenceCommand(args, cwd) {
    const [action, input, ...rest] = args;
    if (!['inspect', 'import', 'refresh', 'tour'].includes(action) || !input) throw new Error('Usage: bygone evidence <inspect|import|refresh|tour> <review.json> [--head <revision>] [--requirements <review.json>] [--correspondence <artifact.json>] [--dependencies <report.json>] [--output <new-file>]');
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
        if (!['--head', '--requirements', '--correspondence', '--dependencies', '--output'].includes(rest[i]) || !rest[i + 1] || options[rest[i]]) throw new Error('Invalid or duplicate evidence option');
        options[rest[i]] = rest[i + 1];
    }
    const root = workspace.repositoryRoot(cwd), file = path.resolve(cwd, input);
    const loaded = workspace.loadReview(root, file);
    // Reports must describe the sanitized artifact that is actually imported.
    const review = action === 'import' ? { ...loaded, decisions: [] } : loaded;
    const absolute = key => options[key] ? path.resolve(cwd, options[key]) : undefined;
    const output = absolute('--output');
    if (action === 'refresh') {
        if (!output || !options['--head']) throw new Error('Refresh requires --head and a new --output file');
        const revised = options['--requirements'] ? parseReview(workspace.readEvidenceJson(absolute('--requirements'))) : review;
        if (revised.repository !== review.repository || revised.base !== review.base || revised.head !== review.head) throw new Error('Requirement update must identify the original repository and comparison');
        const requirements = revised.requirements;
        const result = workspace.refreshWorkspace(root, review, options['--head'], absolute('--correspondence'), requirements);
        workspace.writeReview(output, result.review);
        process.stdout.write(JSON.stringify({ output, transitions: result.transitions }, null, 2) + '\n'); return;
    }
    const report = workspace.inspectWorkspace(root, review);
    const dependencies = options['--dependencies'] ? inspectDependencies(root, review, workspace.readEvidenceJson(absolute('--dependencies'))) : undefined;
    if (action === 'import') {
        if (!output) throw new Error('Import requires a new --output file');
        // Compatible producers export this versioned shape directly. Never manufacture an inspection decision.
        workspace.writeReview(output, review);
        process.stdout.write(JSON.stringify({ output, report, dependencies }, null, 2) + '\n'); return;
    }
    if (action === 'tour') {
        if (!output) throw new Error('Tour requires a new --output file');
        const anchors = {}, steps = [];
        for (const requirement of report.requirements) for (const link of requirement.links) {
            if (link.resolution.status !== 'valid') continue;
            const text = workspace.sourceText(root, link.ref), needle = link.resolution.text;
            let at = -1, occurrence = 0;
            do { at = text.indexOf(needle, at + 1); occurrence++; } while (at >= 0 && at < link.ref.start);
            if (at !== link.ref.start) throw new Error('Cannot represent source reference as a tour anchor');
            const id = `evidence-${steps.length + 1}`;
            anchors[id] = { file: link.ref.path, revision: link.ref.revision === review.base ? 'base' : 'head', contains: needle, occurrence };
            steps.push({ id, title: `${requirement.id}: ${link.role}`, body: `${link.rationale}\nVerification: ${requirement.verification}; inspection: ${requirement.reviewer}. Reference validity does not establish fulfillment.`, focus: id,
                requirement: { id: requirement.id, text: requirement.text, source: requirement.sources.map(s => s.title).join('; ') } });
        }
        if (!steps.length) throw new Error('No valid evidence links to present; use evidence inspect for missing/broken evidence');
        const tour = { version: 6, title: 'Requirement evidence', range: { base: review.base, head: review.head }, anchors, connections: [],
            chapters: [{ id: 'requirements', title: 'Requirement evidence', scenes: [{ id: 'evidence', kind: 'walkthrough', title: 'Inspect recorded evidence',
                summary: 'Pinned references, execution records, and human inspection remain separate.', tags: [],
                bullets: report.requirements.filter(r => !r.implementationLinked || !r.testLinked).map(r => `${r.id}: missing implementation or test links`),
                takeaway: 'This tour supplies inspection context, not an approval decision.', steps }] }] };
        // Validate before publishing an artifact. The existing tour engine owns presentation.
        require('../out/changeTour').buildChangeTourManifest(root, { source: tour });
        fs.writeFileSync(output, JSON.stringify(tour, null, 2) + '\n', { flag: 'wx' });
        process.stdout.write(`Created ${output}\nOpen: bygone -C ${JSON.stringify(root)} present --tour ${JSON.stringify(output)}\n`); return;
    }
    const result = JSON.stringify({ review, report, dependencies }, null, 2) + '\n';
    if (output) fs.writeFileSync(output, result, { flag: 'wx' }); else process.stdout.write(result);
}
module.exports = { runEvidenceCommand };
