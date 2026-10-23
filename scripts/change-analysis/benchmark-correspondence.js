const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('node:child_process');
const { cases } = require('./benchmark/cases');
const { digest } = require('./symbol-inventory');
const { analyzeWithBridge, compileBridge, LIMITS } = require('./run-refactoring-mappings');
const { analyzeStrand, ENGINE, JAVASCRIPT_LIMITS } = require('./run-javascript-mappings');

const labelKey = e => JSON.stringify([e.path, e.name, e.occurrence ?? null]);
const pairKey = p => JSON.stringify([labelKey(p.source), labelKey(p.destination), p.kind || 'continuation']);
const describe = e => ({ path: e.path, name: e.qualifiedName || e.name, kind: e.kind, start: e.start, end: e.end });

function scoreCase(c, analysis) {
    if (!analysis || !Array.isArray(analysis.relations)) throw new Error('Invalid analysis: relations array required');
    const labels = {}, allEntries = {}, gaps = [];
    for (const side of ['before', 'after']) {
        const entries = analysis.inventories?.[side]?.entries || [];
        allEntries[side] = new Map(entries.map(e => [e.id, e]));
        labels[side] = new Map();
        const unique = new Set();
        for (const label of c.evaluated[side]) {
            const key = labelKey(label);
            if (unique.has(key)) throw new Error(`Duplicate gold endpoint: ${c.id} ${key}`);
            unique.add(key);
            const matches = entries.filter(e => e.path === label.path && (e.qualifiedName || e.name) === label.name).sort((a, b) => a.start - b.start);
            if (matches.length > 1 && label.occurrence === undefined) throw new Error(`Ambiguous gold selector: ${c.id} ${key}`);
            const match = matches[label.occurrence ?? 0];
            if (!match) gaps.push({ side, ...label });
            else {
                if (labels[side].has(match.id)) throw new Error(`Gold selectors alias one declaration: ${c.id} ${key}`);
                labels[side].set(match.id, label);
            }
        }
    }
    function metric(expected, predictions) {
        const wanted = new Map();
        for (const p of expected) {
            for (const [side, endpoint] of [['before', p.source], ['after', p.destination]]) {
                if (!c.evaluated[side].some(e => labelKey(e) === labelKey(endpoint))) throw new Error(`Gold pair outside evaluated scope: ${c.id}`);
            }
            if (wanted.has(pairKey(p))) throw new Error(`Duplicate gold pair: ${c.id}`);
            wanted.set(pairKey(p), p);
        }
        const found = new Set(), incorrect = [];
        let ignored = 0;
        for (const p of predictions) {
            const source = allEntries.before.get(p.sourceId), destination = allEntries.after.get(p.destinationId);
            if (!source || !destination) throw new Error(`Prediction references missing declaration: ${c.id}`);
            const a = labels.before.get(p.sourceId), b = labels.after.get(p.destinationId);
            if (!a && !b) { ignored++; continue; }
            const key = a && b && pairKey({ source: a, destination: b, kind: p.kind });
            if (wanted.has(key) && !found.has(key)) found.add(key);
            else incorrect.push({ source: describe(source), destination: describe(destination), kind: p.kind || 'continuation',
                reason: wanted.has(key) ? 'duplicate-prediction' : 'not-gold-pair' });
        }
        const missed = [...wanted].filter(([key]) => !found.has(key)).map(([, p]) => {
            const missing = gaps.filter(e => (e.side === 'before' && labelKey(e) === labelKey(p.source)) || (e.side === 'after' && labelKey(e) === labelKey(p.destination)));
            const ids = Object.entries(labels).flatMap(([side, entries]) => [...entries].filter(([, label]) =>
                labelKey(label) === labelKey(side === 'before' ? p.source : p.destination)).map(([id]) => id));
            return { ...p, reason: missing.length ? 'inventory-gap' : 'unaccepted-match',
                diagnostics: (analysis.unmatchedDiagnostics || []).filter(d => ids.includes(d.symbolId || d.id)).map(d => d.reason) };
        });
        const focusKeys = [...wanted].filter(([, p]) => p.focus !== false).map(([key]) => key);
        return { expected: wanted.size, correct: found.size, missed: missed.length, incorrect: incorrect.length,
            focusExpected: focusKeys.length, focusCorrect: focusKeys.filter(key => found.has(key)).length,
            focusMissed: focusKeys.filter(key => !found.has(key)).length,
            ignored, missedPairs: missed, incorrectPairs: incorrect };
    }
    return { id: c.id, group: c.group, status: analysis.status, engine: analysis.engine,
        inventoryGaps: gaps, continuations: metric(c.expected, analysis.relations),
        groups: metric(c.expectedGroups || [], (analysis.groups || []).filter(g => g.status === 'inferred')),
        issues: analysis.issues || [], engineProcessedPaths: analysis.scope?.engineProcessedPaths,
        rejected: (analysis.rejected || []).map(r => ({ mapperId: r.mapperId, reason: r.reason, endpoints: r.endpoints })),
        unresolvedReasons: (analysis.unresolved || []).map(g => g.reason),
        inventoryDocuments: Object.fromEntries(['before', 'after'].map(side => [side, analysis.inventories?.[side]?.documents || []])) };
}

function summarize(rows) {
    const empty = () => ({ expected: 0, correct: 0, missed: 0, incorrect: 0, focusExpected: 0, focusCorrect: 0, focusMissed: 0, ignored: 0 });
    const totals = { cases: rows.length, inventoryGaps: 0, continuations: empty(), groups: empty() };
    for (const row of rows) {
        totals.inventoryGaps += row.inventoryGaps.length;
        for (const metric of ['continuations', 'groups']) for (const key of Object.keys(totals[metric])) totals[metric][key] += row[metric][key];
    }
    for (const metric of ['continuations', 'groups']) {
        const m = totals[metric];
        m.precision = m.correct + m.incorrect ? m.correct / (m.correct + m.incorrect) : null;
        m.recall = m.expected ? m.correct / m.expected : null;
    }
    return totals;
}

function run(mode, output, env = process.env) {
    if (!['exact', 'engine', 'both', ENGINE.producer, 'all'].includes(mode)) throw new Error(`Mode must be exact, engine, both, ${ENGINE.producer}, or all`);
    const config = ['engine', 'both', 'all'].includes(mode) ? compileBridge({ java: env.MAPPING_JAVA, jar: env.MAPPING_JAR,
        expectedJarSha256: env.MAPPING_JAR_SHA256, python: env.MAPPING_PYTHON }) : null;
    try {
        const report = { version: 1, generatedAt: new Date().toISOString(),
            revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim(),
            node: process.version, corpusSha256: digest(JSON.stringify(cases)),
            runnerSha256: digest(fs.readFileSync(__filename)), labelsSha256: digest(fs.readFileSync(path.join(__dirname, 'benchmark/cases.js'))),
            implementationSha256: Object.fromEntries(['symbol-inventory.js', '../../packages/strand/src/python-inventory.py', 'refactoring-mappings.js',
                'run-refactoring-mappings.js', '../../packages/strand/src/js-correspondence.js', '../../packages/strand/src/symbol-inventory.js', 'run-javascript-mappings.js', 'analyze-git.js', '../../src/changeCorrespondence.ts',
                '../../test/fixtures/correspondence-module-split.json'].map(name => [name, digest(fs.readFileSync(path.join(__dirname, name)))])),
            frozenCorpusSha256: digest(fs.readFileSync(path.join(__dirname, 'benchmark/frozen-js-ts.json'))),
            engineIdentity: config && { jarSha256: config.jarSha256, bridgeSha256: config.bridgeSha256 }, limits: LIMITS, javascriptEngine: { ...ENGINE, limits: JAVASCRIPT_LIMITS },
            scope: 'Explicitly labeled declarations; pairs touching a labeled endpoint are scored. Others are counted as ignored. Extract/inline groups are separate.',
            modes: {} };
        for (const selected of mode === 'all' ? ['exact', 'engine', ENGINE.producer] : mode === 'both' ? ['exact', 'engine'] : [mode]) {
            const began = performance.now(), rows = [];
            for (const c of cases) {
                let { before, after } = c;
                if (c.excludeUnchanged) {
                    const changed = p => before[p] !== after[p];
                    const left = Object.fromEntries(Object.entries(before).filter(([p]) => changed(p)));
                    const right = Object.fromEntries(Object.entries(after).filter(([p]) => changed(p)));
                    before = left; after = right;
                }
                const result = selected === ENGINE.producer ? analyzeStrand(before, after, { python: env.MAPPING_PYTHON })
                    : analyzeWithBridge(before, after, selected === 'engine' ? config : { python: env.MAPPING_PYTHON });
                rows.push({ ...scoreCase(c, result.analysis), nativeStatus: result.native?.status, nativeReason: result.native?.reason,
                    inputPaths: { before: Object.keys(before), after: Object.keys(after) }, engineMs: result.engineMs,
                    parsers: { before: result.analysis.inventories?.before?.parser, after: result.analysis.inventories?.after?.parser } });
            }
            report.modes[selected] = { totals: summarize(rows), byGroup: Object.fromEntries([...new Set(rows.map(r => r.group))].map(group => [group, summarize(rows.filter(r => r.group === group))])),
                elapsedMs: performance.now() - began, cases: rows };
        }
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
        return report;
    } finally { if (config) fs.rmSync(config.buildDir, { recursive: true, force: true }); }
}

module.exports = { scoreCase, summarize, run };
if (require.main === module) {
    const [mode, output] = process.argv.slice(2);
    if (!mode || !output) throw new Error(`Usage: node scripts/change-analysis/benchmark-correspondence.js <exact|engine|both|${ENGINE.producer}|all> <new-output.json>`);
    const report = run(mode, output);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(report.modes).map(([name, result]) => [name, result.totals])), null, 2));
    console.log(`Report: ${output}`);
}
