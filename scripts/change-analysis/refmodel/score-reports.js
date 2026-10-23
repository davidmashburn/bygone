const fs = require('fs');
const path = require('path');
const { CATALOG, validateOutput } = require('./validate-output');

function score(report, fixtures, evidence) {
    return report.runs.map(run => {
        const fixture = fixtures.find(c => c.id === run.caseId);
        const text = run.response?.response || '';
        const result = { caseId: run.caseId, arm: run.arm, status: run.status, elapsedSeconds: run.elapsedSeconds };
        if (run.status !== 'complete') return result;
        if (run.arm === 'upstream') {
            // Extract only emphasized bullet headings, never labels mentioned in reasoning.
            result.headings = [...text.matchAll(/^\s*-\s*\*\*([^*]+)\*\*/gm)].map(m => m[1].trim());
            result.labels = result.headings.filter(s => CATALOG.includes(s));
            result.otherHeadings = result.headings.filter(s => !CATALOG.includes(s));
        } else {
            let before = fixture.before, after = fixture.after;
            if (fixture.excludeUnchanged) {
                const changed = p => before[p] !== after[p];
                const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(changed);
                before = Object.fromEntries(paths.filter(p => Object.hasOwn(before, p)).map(p => [p, before[p]]));
                after = Object.fromEntries(paths.filter(p => Object.hasOwn(after, p)).map(p => [p, after[p]]));
            }
            result.validation = validateOutput(text, before, after, evidence[run.caseId]);
            try { result.labels = JSON.parse(text).operations?.map(op => op.type) || []; }
            catch { result.labels = []; }
        }
        return result;
    });
}

if (require.main === module) {
    const root = __dirname;
    const fixtures = ['manifest.json', 'diagnostics.json'].flatMap(name => JSON.parse(fs.readFileSync(path.join(root, '../semantic-corpus', name))).cases);
    const evidence = JSON.parse(fs.readFileSync(path.join(root, 'evidence.json')));
    for (const name of process.argv.slice(2)) {
        const report = JSON.parse(fs.readFileSync(name));
        const scored = score(report, fixtures, evidence);
        const summary = Object.fromEntries(['upstream', 'grounded'].map(arm => {
            const runs = scored.filter(r => r.arm === arm);
            const durations = runs.filter(r => r.status === 'complete').map(r => r.elapsedSeconds).sort((a, b) => a - b);
            return [arm, { runs: runs.length, complete: durations.length,
                sourceValidResponses: arm === 'grounded' ? runs.filter(r => r.validation?.valid).length : null,
                responsesWithOperations: runs.filter(r => r.labels?.length).length,
                medianSeconds: durations[Math.floor(durations.length / 2)] ?? null,
                p95Seconds: durations[Math.ceil(durations.length * 0.95) - 1] ?? null }];
        }));
        const destination = name.replace(/\.json$/, '.scored.json');
        fs.writeFileSync(destination, JSON.stringify({ protocolSha256: report.protocolSha256,
            note: 'Mechanical label extraction and source validation only. Source validity is not semantic correctness. No accuracy or precision estimate.', summary, runs: scored }, null, 2) + '\n');
        console.log(JSON.stringify({ destination, summary }));
    }
}

module.exports = { score };
