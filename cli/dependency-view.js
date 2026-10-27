const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mermaidLabel = value => String(value).replace(/&/g, '#38;').replace(/</g, '#60;').replace(/>/g, '#62;').replace(/"/g, '#quot;').replace(/[\r\n]/g, ' ');

function renderEvidenceSummary(report) {
    const lines = [`Dependency evidence: ${report.range.baseOid.slice(0, 7)} → ${report.range.headOid.slice(0, 7)}`, 'Static source bindings; no runtime observations.'];
    for (const side of ['base', 'head']) {
        const s = report[side], c = s.coverage;
        lines.push(`${side}: ${c.indexedFiles}/${c.candidateFiles} files, ${s.nodes.length} nodes, ${s.sites.length} sites, ${c.unresolvedSites} unresolved; ${c.indexComplete ? 'indexed within supported scope' : 'PARTIAL coverage'}`);
        for (const p of s.producers) lines.push(`  ${p.language}: ${p.name}`);
        for (const d of s.diagnostics.slice(0, 10)) lines.push(`  ${d.file || d.language || ''}: ${d.code}: ${d.message}`);
    }
    lines.push('Use --json for all evidence, --mermaid for a head graph, or --html --output graph.html for the interactive viewer.');
    return lines.join('\n') + '\n';
}
function renderMermaid(report) {
    const snapshot = report.head;
    const nodes = snapshot.nodes.slice(0, 150);
    const ids = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
    const sites = snapshot.sites.filter(s => ids.has(s.owner) && (!s.target || ids.has(s.target))).slice(0, 300);
    const lines = ['flowchart LR', '  %% Static evidence; resolved bindings are not runtime observations.', `  %% Coverage: ${snapshot.coverage.indexComplete ? 'within supported scope' : 'PARTIAL'}; showing ${nodes.length}/${snapshot.nodes.length} nodes and ${sites.length}/${snapshot.sites.length} sites.`];
    for (const n of nodes) lines.push(`  ${ids.get(n.id)}["${mermaidLabel(`${n.source.file}: ${n.name}`)}"]`);
    for (const [i, s] of sites.entries()) {
        const target = s.target ? ids.get(s.target) : `u${i}`;
        if (!s.target) lines.push(`  ${target}["${mermaidLabel(`${s.name} (${s.resolution})`)}"]`);
        lines.push(`  ${ids.get(s.owner)} ${s.target ? '-->' : '-.->'}|"${mermaidLabel(`${s.relation}; ${s.phase}`)}"| ${target}`);
    }
    return lines.join('\n') + '\n';
}
function renderEvidenceHtml(report) {
    // Escape HTML-sensitive characters in JSON, including script terminators from repository-controlled names.
    const data = JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bygone dependency evidence</title>
<style>body{margin:0;background:#101923;color:#e2ebf2;font:15px system-ui}header,main{padding:20px 28px}header{border-bottom:1px solid #334655}h1{margin:0 0 8px;font-size:25px}p{line-height:1.5}label{display:inline-flex;gap:7px;align-items:center;margin:5px 16px 5px 0}select,input,button{background:#1e2d3c;color:inherit;border:1px solid #526879;border-radius:5px;padding:7px}button,a{cursor:pointer}a{color:#8ad6ff}.muted{color:#9bb1c2}#graph{overflow:auto;border:1px solid #334655;border-radius:8px;background:#14212e}svg{display:block}svg text{fill:#e2ebf2;font:12px system-ui}svg .node{cursor:pointer}svg .node:focus rect{stroke:#fff;stroke-width:3}svg rect{fill:#253d50;stroke:#7797ae}svg .selected rect{fill:#315d6c;stroke:#67e4ca}svg path{fill:none;stroke:#728e9f;stroke-width:1.4}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #334655;overflow-wrap:anywhere}th{color:#9bb1c2}details{margin:16px 0}#status{color:#94e2cf}#evidence{overflow:auto}code{overflow-wrap:anywhere}button{margin-left:8px}</style>
<header><h1>Dependency evidence</h1><div class="muted">${escapeHtml(report.range.baseOid.slice(0, 7))} → ${escapeHtml(report.range.headOid.slice(0, 7))} · Static bindings, not observed execution</div></header>
<main><label>Revision <select id="revision"><option>head</option><option>base</option></select></label><label>Language <select id="language"><option value="">All</option><option value="python">Python</option><option value="typescript">JS/TS</option><option value="go">Go</option><option value="rust">Rust</option><option value="mojo">Mojo</option></select></label><label>Relation <select id="relation"><option value="">All</option><option>import</option><option>reexport</option><option>call</option><option>construct</option><option>reference</option></select></label><label>Phase <select id="phase"><option value="">All</option><option>module-init</option><option>invocation</option><option>type</option><option>unknown</option></select></label><label>Find <input id="search" placeholder="File or symbol" type="search"></label><button id="reset">Clear focus</button>
<p id="status" role="status"></p><p class="muted">Select a node to inspect its direct callers and dependencies. Arrows point from consumer to dependency. Unresolved sites appear in the evidence table. The view is bounded to 150 nodes and 300 sites; JSON retains the full indexed report.</p><div id="graph"></div><p id="focus"></p><div id="evidence"></div><details><summary>Coverage, producers, and limitations</summary><div id="details"></div></details></main>
<script id="report" type="application/json">${data}</script><script>(${viewer.toString()})();</script></html>`;
}
/* global document, window */
function viewer() {
    const report = JSON.parse(document.getElementById('report').textContent);
    const el = id => document.getElementById(id);
    let focus;
    const text = (tag, value, parent) => { const n = document.createElement(tag); n.textContent = value; if (parent) parent.append(n); return n; };
    const svgEl = (tag, attrs, parent) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (parent) parent.append(n); return n; };
    const sourceLink = (source, parent) => {
        const value = `${source.file}:${source.line}:${source.column}`;
        if (source.link && source.link.startsWith('bygone:')) { const a = text('a', value, parent); a.href = source.link; }
        else text('span', value, parent);
    };
    function render() {
        const snapshot = report[el('revision').value];
        const all = new Map(snapshot.nodes.map(n => [n.id, n]));
        const q = el('search').value.toLowerCase();
        let nodes = snapshot.nodes.filter(n => (!el('language').value || n.language === el('language').value) && (!q || `${n.name} ${n.source.file}`.toLowerCase().includes(q)));
        let allowed = new Set(nodes.map(n => n.id));
        let sites = snapshot.sites.filter(s => (focus || allowed.has(s.owner)) && (!el('relation').value || s.relation === el('relation').value) && (!el('phase').value || s.phase === el('phase').value));
        if (focus) {
            sites = sites.filter(s => s.owner === focus || s.target === focus);
            allowed = new Set([focus, ...sites.flatMap(s => [s.owner, s.target]).filter(Boolean)]);
            nodes = snapshot.nodes.filter(n => allowed.has(n.id));
        } else {
            // Include targets of filtered consumers so edges do not silently disappear under a search.
            const targets = new Set(sites.map(s => s.target).filter(Boolean));
            nodes = [...nodes, ...snapshot.nodes.filter(n => targets.has(n.id) && !allowed.has(n.id))];
        }
        const totalNodes = nodes.length, totalSites = sites.length;
        nodes = nodes.slice(0, 150); allowed = new Set(nodes.map(n => n.id));
        sites = sites.filter(s => allowed.has(s.owner)).slice(0, 300);
        const c = snapshot.coverage;
        el('status').textContent = `${c.indexComplete ? 'Indexed within supported scope' : 'PARTIAL coverage'} · ${c.indexedFiles}/${c.candidateFiles} files · Showing ${nodes.length}/${totalNodes} filtered nodes, ${sites.length}/${totalSites} filtered sites · ${c.unresolvedSites} unresolved in snapshot`;
        const selected = all.get(focus);
        el('focus').replaceChildren();
        if (selected) { text('strong', `${selected.name} · `, el('focus')); sourceLink(selected.source, el('focus')); }
        el('graph').replaceChildren();
        const cols = Math.min(4, Math.max(1, nodes.length), Math.max(1, Math.floor(el('graph').clientWidth / 290)));
        const width = cols * 290 + 40, height = Math.max(160, Math.ceil(nodes.length / cols) * 110 + 40);
        const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': 'Dependency graph; select nodes for direct neighbors' }, el('graph'));
        const defs = svgEl('defs', {}, svg); const marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, defs);
        svgEl('polygon', { points: '0,0 10,5 0,10', fill: '#a2b8c6' }, marker);
        const positions = new Map(nodes.map((n, i) => [n.id, { x: 20 + i % cols * 290, y: 20 + Math.floor(i / cols) * 110 }]));
        for (const s of sites) {
            const a = positions.get(s.owner), b = positions.get(s.target);
            if (!a || !b) continue;
            const ax = a.x + 125, ay = a.y + 54, bx = b.x + 125, by = b.y;
            const path = svgEl('path', { d: s.owner === s.target ? `M${ax},${ay} C${ax + 160},${ay + 60} ${ax + 160},${by - 40} ${bx},${by}` : `M${ax},${ay} C${ax},${ay + 35} ${bx},${by - 35} ${bx},${by}`, 'marker-end': 'url(#arrow)' }, svg);
            const title = svgEl('title', {}, path); title.textContent = `${s.relation}; ${s.phase}; ${s.resolution}`;
        }
        for (const n of nodes) {
            const p = positions.get(n.id), g = svgEl('g', { class: `node ${n.id === focus ? 'selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${n.name} in ${n.source.file}` }, svg);
            svgEl('rect', { x: p.x, y: p.y, width: 250, height: 54, rx: 6 }, g);
            const title = svgEl('title', {}, g); title.textContent = `${n.source.file}: ${n.name}`;
            const name = svgEl('text', { x: p.x + 9, y: p.y + 20 }, g); name.textContent = n.name.length > 32 ? n.name.slice(0, 29) + '…' : n.name;
            const file = svgEl('text', { x: p.x + 9, y: p.y + 39 }, g); file.textContent = n.source.file.length > 33 ? '…' + n.source.file.slice(-32) : n.source.file;
            const select = () => { focus = n.id; render(); };
            g.addEventListener('click', select); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
        }
        el('evidence').replaceChildren();
        const table = document.createElement('table'); el('evidence').append(table);
        const tr = document.createElement('tr'); table.append(tr);
        for (const h of ['Site', 'Relation / phase', 'Target / resolution', 'Source evidence']) text('th', h, tr);
        for (const s of sites) {
            const row = document.createElement('tr'); table.append(row);
            text('td', `${all.get(s.owner)?.name || '?'} → ${s.name}`, row);
            text('td', `${s.relation} / ${s.phase}`, row);
            const target = all.get(s.target); text('td', `${target ? target.source.file + ': ' + target.name : s.resolution}${s.reason ? ' — ' + s.reason : ''}`, row);
            const cell = document.createElement('td'); row.append(cell); sourceLink(s.source, cell);
        }
        el('details').replaceChildren();
        for (const a of report.assumptions) text('p', a, el('details'));
        if (report.configuration) text('p', `Python roots: ${report.configuration.pythonRoots.map(root => root || '.').join(', ')}`, el('details'));
        for (const p of snapshot.producers) text('p', `${p.language}: ${p.name}`, el('details'));
        for (const d of snapshot.diagnostics) text('p', `${d.file || d.language || ''}: ${d.code}: ${d.message}`, el('details'));
        if (c.omittedDiagnostics) text('p', `${c.omittedDiagnostics} additional diagnostics omitted.`, el('details'));
    }
    for (const id of ['revision', 'language', 'relation', 'phase', 'search']) el(id).addEventListener(id === 'search' ? 'input' : 'change', () => { focus = undefined; render(); });
    el('reset').addEventListener('click', () => { focus = undefined; render(); });
    window.addEventListener('resize', render);
    render();
}
module.exports = { renderEvidenceSummary, renderMermaid, renderEvidenceHtml };
