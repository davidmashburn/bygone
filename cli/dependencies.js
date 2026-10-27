const { mkdirSync, writeFileSync } = require('fs');
const path = require('path');

function runDependenciesCommand(args, cwd, output = process.stdout) {
    let headRef, baseRef, outputPath;
    let json = false, graph = false, mermaid = false, html = false;
    const pythonRoots = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--graph') { graph = true; continue; }
        if (arg === '--mermaid') { graph = true; mermaid = true; continue; }
        if (arg === '--html') { graph = true; html = true; continue; }
        if (arg === '--json') { json = true; continue; }
        if (['--base', '-m', '--main', '--output', '-o', '--python-root'].includes(arg)) {
            const value = args[++index];
            if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value.`);
            if (['--output', '-o'].includes(arg)) outputPath = value;
            else if (arg === '--python-root') { pythonRoots.push(value === '.' ? '' : value); graph = true; }
            else baseRef = value;
        } else if (arg.startsWith('-') || headRef) throw new Error(`Unexpected dependencies argument: ${arg}`);
        else headRef = arg;
    }
    if ([json, mermaid, html].filter(Boolean).length > 1) throw new Error('Choose one of --json, --mermaid, or --html.');
    const build = graph ? require('../out/dependencyEvidence.js').buildDependencyEvidence : require('../out/dependencyGraph.js').buildDependencyGraph;
    const report = build(cwd, { headRef, baseRef, ...(pythonRoots.length ? { pythonRoots } : {}) });
    const view = graph ? require('./dependency-view') : undefined;
    const rendered = mermaid ? view.renderMermaid(report) : html ? view.renderEvidenceHtml(report)
        : json || outputPath ? `${JSON.stringify(report, null, 2)}\n` : graph ? view.renderEvidenceSummary(report) : renderDependencyReport(report);
    if (outputPath) {
        const resolved = path.resolve(cwd, outputPath);
        mkdirSync(path.dirname(resolved), { recursive: true });
        writeFileSync(resolved, rendered);
        output.write(`Wrote dependency evidence to ${resolved}\n`);
    } else output.write(rendered);
    return report;
}

function renderDependencyReport(report) {
    const complete = report.base.coverage.indexComplete && report.head.coverage.indexComplete;
    const lines = [
        `Module dependencies: ${report.range.baseOid.slice(0, 7)} → ${report.range.headOid.slice(0, 7)}`,
        `Static JS/TS evidence; initialization labels describe syntax, not observed execution.`,
        `Index coverage: ${complete ? 'complete within supported scope' : 'PARTIAL — deltas and consumer lists may be incomplete'}`
    ];
    for (const side of ['base', 'head']) {
        const snapshot = report[side];
        const coverage = snapshot.coverage;
        lines.push(`${side}: ${coverage.indexedFiles}/${coverage.candidateFiles} source files, ${snapshot.edges.length} sites, ${coverage.unresolvedEdges} unresolved, ${snapshot.diagnostics.length + coverage.omittedDiagnostics} diagnostics`);
    }
    const site = edge => `${edge.source.file}:${edge.source.line}:${edge.source.column} → ${edge.target ?? edge.specifier ?? '<computed>'} [${edge.relationship}; ${edge.phase}; ${edge.loading}; ${edge.resolution}]`;
    const groups = [
        ['Added module edges', report.changes.added], ['Removed module edges', report.changes.removed],
        ['Unchanged consumers (base)', report.unchangedConsumers.base], ['Unchanged consumers (head)', report.unchangedConsumers.head]
    ];
    for (const [label, edges] of groups) {
        lines.push(`\n${label}: ${edges.length}`);
        for (const edge of edges.slice(0, 50)) {
            lines.push(`  ${site(edge)}`);
            if (edge.source.link) lines.push(`    ${edge.source.link}`);
        }
        if (edges.length > 50) lines.push(`  ${edges.length - 50} more sites; use --json for the bounded full report.`);
    }
    for (const side of ['base', 'head']) {
        lines.push(`\n${side} diagnostics:`);
        for (const item of report[side].diagnostics.slice(0, 10)) lines.push(`  ${item.file ? `${item.file}: ` : ''}${item.code}: ${item.message}`);
        if (report[side].diagnostics.length > 10) lines.push('  More diagnostics in --json.');
    }
    lines.push('\nUse --json or --output <file> for all indexed edges, potential initialization calls, exact source ranges, and scope assumptions.');
    return `${lines.join('\n')}\n`;
}
module.exports = { runDependenciesCommand, renderDependencyReport };
