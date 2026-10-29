const { readFileSync } = require('fs');
const { join } = require('path');
const { projectGraph, layoutInput } = require('./dependency-view-model');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mermaidLabel = value => String(value).replace(/#/g, '#35;').replace(/&/g, '#38;').replace(/</g, '#60;').replace(/>/g, '#62;').replace(/"/g, '#quot;').replace(/[\r\n]/g, ' ');

function renderEvidenceSummary(report) {
    const lines = [`Dependency evidence: ${report.range.baseOid.slice(0, 7)} → ${report.range.headOid.slice(0, 7)}`, 'Static source bindings; no runtime observations.'];
    lines.push(`Analysis scope: ${report.configuration?.scopes?.map(scope => scope || '.').join(', ') || 'whole repository'}`);
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
    const graph = projectGraph(report.head);
    const ids = new Map(graph.nodes.map((n, i) => [n.id, `n${i}`]));
    const lines = ['flowchart LR', '  %% Static grouped dependencies; references and within-group sites omitted.',
        `  %% Analysis scopes: ${JSON.stringify(report.configuration?.scopes || [])} (empty means whole repository).`,
        `  %% Coverage: ${report.head.coverage.indexComplete ? 'within supported scope' : 'PARTIAL'}; showing ${graph.nodes.length}/${graph.totalNodes} nodes and ${graph.edges.length}/${graph.totalEdges} relationships.`];
    for (const n of graph.nodes) lines.push(`  ${ids.get(n.id)}["${mermaidLabel(n.name === n.folder ? n.folder : n.source.file)}"]`);
    for (const e of graph.edges) lines.push(`  ${ids.get(e.owner)} -->|"${mermaidLabel(`${e.relations.join(', ')} · ${e.count} sites`)}"| ${ids.get(e.target)}`);
    lines.push('  %% Unresolved sites remain in JSON and the HTML evidence table.');
    return lines.join('\n') + '\n';
}
function renderEvidenceHtml(report, options = {}) {
    const settings = JSON.stringify(options).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    const data = JSON.stringify(report).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const layout = readFileSync(join(__dirname, '../out/dependency-layout.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
    const license = readFileSync(join(__dirname, '../out/dependency-layout-LICENSE.txt'), 'utf8');
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bygone dependency evidence</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101923;color:#e2ebf2;font:14px system-ui}header,main{padding:20px 28px}header{border-bottom:1px solid #334655;display:flex;justify-content:space-between;gap:20px;align-items:center}h1{margin:0 0 6px;font-size:24px}p{line-height:1.5}label{display:inline-flex;gap:7px;align-items:center;margin:5px 14px 5px 0}select,input,button{font:inherit;background:#1e2d3c;color:inherit;border:1px solid #526879;border-radius:6px;padding:7px}button,a{cursor:pointer}button:hover{background:#315369}button:disabled{opacity:.45;cursor:default}a{color:#8ad6ff}.muted{color:#9bb1c2}.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}.toolbar .grow{flex:1}#graph{height:65vh;min-height:380px;max-height:820px;overflow:hidden;border:1px solid #334655;border-radius:8px;background:#14212e;touch-action:none;cursor:grab}#graph:active{cursor:grabbing}svg{width:100%;height:100%;display:block}svg text{fill:#e2ebf2;font:12px system-ui}svg .node{cursor:pointer}svg .node:focus rect{stroke:#fff;stroke-width:3}svg rect{fill:#253d50;stroke:#7797ae}svg .selected rect{fill:#315d6c;stroke:#67e4ca;stroke-width:3}svg .edge{cursor:pointer}svg .edge path{fill:none;stroke:#728e9f;stroke-width:1.7}svg .edge:hover path,svg .edge.selected path{stroke:#8ad6ff;stroke-width:3}svg .edge text{fill:#b7e9ff;paint-order:stroke;stroke:#14212e;stroke-width:5px;stroke-linejoin:round}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #334655;overflow-wrap:anywhere}th{color:#9bb1c2}details{margin:18px 0}summary{cursor:pointer}#status{color:#94e2cf}#evidence{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}.error{color:#ffb4a5!important}#focus{min-height:22px}#hint{font-size:12px}@media(max-width:650px){header,main{padding:16px}header{display:block}label{margin-right:8px}#graph{min-height:350px}input{max-width:180px}}
</style>
<header><div><h1>Dependency evidence</h1><div class="muted">${escapeHtml(report.range.baseOid.slice(0, 7))} → ${escapeHtml(report.range.headOid.slice(0, 7))}</div></div><div class="muted">Static bindings · no observed execution</div></header>
<main><div><label>Revision <select id="revision"><option>head</option><option>base</option></select></label><label>View <select id="mode"><option value="folders">Folders</option><option value="files">Files</option><option value="symbols">Symbols</option></select></label><label>Language <select id="language"><option value="">All</option><option value="python">Python</option><option value="typescript">JS/TS</option><option value="go">Go</option><option value="rust">Rust</option><option value="mojo">Mojo</option></select></label><label>Relation <select id="relation"><option value="dependencies">Dependencies</option><option value="">All, including references</option><option>import</option><option>reexport</option><option>call</option><option>construct</option><option>reference</option></select></label><label>Phase <select id="phase"><option value="">All</option><option>module-init</option><option>invocation</option><option>type</option><option>unknown</option></select></label><label>Find <input id="search" placeholder="File or symbol" type="search"></label></div>
<div class="toolbar"><button id="reset">Clear focus</button><button id="expand" disabled>Inspect symbols</button><span class="grow"></span><label>Direction <select id="direction"><option value="RIGHT">Left to right</option><option value="DOWN">Top to bottom</option></select></label><button id="zoomout" aria-label="Zoom out">−</button><button id="fit">Fit graph</button><button id="zoomin" aria-label="Zoom in">+</button></div>
<p id="status" role="status"></p><div id="graph" aria-busy="true"></div><p id="focus"></p><p id="hint" class="muted">Arrows point from consumer to dependency. Select a node for its neighbors; select an edge for its source evidence. Drag to pan, scroll to zoom. Folder and file views combine repeated relationships and hide within-group edges. Diagrams show up to 150 nodes and 300 relationships; JSON retains the full indexed report.</p>
<details id="changes-panel"><summary>Dependency changes and affected consumers</summary><button id="load-correspondence" hidden>Load symbol correspondence</button><div id="changes"></div></details><details id="evidence-panel"><summary id="evidence-summary">Source evidence</summary><div id="evidence"></div></details><details><summary>Coverage, producers, and limitations</summary><div id="details"></div></details><details><summary>Layout license</summary><p>Layout by <a href="https://github.com/kieler/elkjs/tree/v0.12.1">ELK.js 0.12.1</a>, distributed unmodified under EPL-2.0. Source and notices are available at that link.</p><pre>${escapeHtml(license)}</pre></details></main>
<script id="settings" type="application/json">${settings}</script><script id="report" type="application/json">${data}</script><script>${layout}</script><script>const projectGraph = ${projectGraph.toString()}; const layoutInput = ${layoutInput.toString()}; (${viewer.toString()})();</script></html>`;
}
/* global document, window, ELK, acquireVsCodeApi */
function viewer() {
    const report = JSON.parse(document.getElementById('report').textContent);
    const settings = JSON.parse(document.getElementById('settings').textContent);
    const bridge = settings.embedded && typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
    document.getElementById('mode').value = new Set(report.head.nodes.map(n => n.source.file)).size > 30 ? 'folders' : 'files';
    const el = id => document.getElementById(id), engine = new ELK();
    let focus, selectedEdge, generation = 0, current, svg, box, initialBox, drag, moved = false;
    const text = (tag, value, parent) => { const n = document.createElement(tag); n.textContent = value; if (parent) parent.append(n); return n; };
    const svgEl = (tag, attrs, parent) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (parent) parent.append(n); return n; };
    const sourceLink = (source, parent) => {
        const value = `${source.file}:${source.line}:${source.column}`;
        if (settings.embedded) { const a = text('button', value, parent); a.addEventListener('click', () => { const message = { type: 'dependencySource', source }; if (bridge) bridge.postMessage(message); else window.parent.postMessage(message, '*'); }); }
        else if (source.link?.startsWith('bygone:')) { const a = text('a', value, parent); a.href = source.link; }
        else text('span', value, parent);
    };
    if (settings.canLoadCorrespondence) {
        el('load-correspondence').hidden = false;
        el('load-correspondence').onclick = () => { const message = { type: 'dependencyLoadCorrespondence' }; if (bridge) bridge.postMessage(message); else window.parent.postMessage(message, '*'); };
    }
    if (settings.changes) {
        const changes = settings.changes, parent = el('changes');
        text('p', `${changes.continuations.length} trusted symbol continuations · ${changes.changes.added.length} added calls · ${changes.changes.removed.length} removed calls · ${changes.changes.unknown.length} unclassified calls`, parent);
        for (const limitation of changes.limitations) text('p', limitation, parent);
        for (const kind of ['added', 'removed', 'unknown']) {
            const entries = changes.changes[kind];
            text('h3', `${kind} · showing ${Math.min(200, entries.length)} / ${entries.length}`, parent);
            for (const entry of entries.slice(0, 200)) {
                const row = text('p', `${entry.consumer?.name || '?'} → ${entry.target?.name || entry.site.name}${entry.reason ? ' · ' + entry.reason : ''} · `, parent);
                sourceLink(entry.site.source, row);
            }
        }
        text('h3', `Affected consumers · ${changes.affectedConsumers.length}`, parent);
        for (const consumer of changes.affectedConsumers.slice(0, 200)) {
            const node = consumer.after || consumer.before;
            const row = text('p', `${node.name} · +${consumer.added.length} / −${consumer.removed.length} / ?${consumer.unknown.length} · `, parent);
            sourceLink(node.source, row);
        }
    } else el('changes-panel').hidden = true;
    const applyBox = () => { if (svg && box) svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`); };
    const zoom = factor => {
        if (!box || box.width * factor < 80 || box.width * factor > 100000) return;
        box = { x: box.x + box.width * (1 - factor) / 2, y: box.y + box.height * (1 - factor) / 2, width: box.width * factor, height: box.height * factor }; applyBox();
    };
    const fit = () => {
        if (!initialBox) return;
        const ratio = el('graph').clientWidth / el('graph').clientHeight;
        box = { ...initialBox };
        if (box.width / box.height < ratio) { const w = box.height * ratio; box.x -= (w - box.width) / 2; box.width = w; }
        else { const h = box.width / ratio; box.y -= (h - box.height) / 2; box.height = h; }
        applyBox();
    };
    function evidence() {
        if (!current) return;
        const snapshot = report[el('revision').value], all = new Map(snapshot.nodes.map(n => [n.id, n]));
        const original = new Map(snapshot.sites.map(s => [s.id, s]));
        const sites = current.sites.filter(s => !selectedEdge || JSON.stringify([s.owner, s.target]) === selectedEdge);
        el('evidence-summary').textContent = `Source evidence · ${Math.min(300, sites.length)} / ${sites.length} sites${selectedEdge ? ' for selected relationship' : ''}`;
        el('evidence').replaceChildren();
        const table = text('table', '', el('evidence')), tr = text('tr', '', table);
        for (const h of ['Site', 'Relation / phase', 'Target / resolution', 'Source evidence']) text('th', h, tr);
        for (const projected of sites.slice(0, 300)) {
            const s = original.get(projected.id), row = text('tr', '', table);
            text('td', `${all.get(s.owner)?.name || '?'} → ${s.name}`, row);
            text('td', `${s.relation} / ${s.phase}`, row);
            const target = all.get(s.target);
            text('td', `${target ? target.source.file + ': ' + target.name : s.resolution}${s.reason ? ' — ' + s.reason : ''}`, row);
            sourceLink(s.source, text('td', '', row));
        }
    }
    async function render() {
        const request = ++generation, snapshot = report[el('revision').value];
        const mode = el('mode').value;
        current = projectGraph(snapshot, { mode, focus, query: el('search').value, language: el('language').value, relation: el('relation').value, phase: el('phase').value });
        const graph = current, c = snapshot.coverage;
        el('status').classList.remove('error');
        const scope = report.configuration?.scopes?.map(value => value || '.').join(', ') || 'whole repository';
        const status = `Scope: ${scope} · ${c.indexComplete ? 'Indexed within supported scope' : 'PARTIAL coverage'} · ${c.indexedFiles}/${c.candidateFiles} indexed files · ${graph.nodes.length}/${graph.totalNodes} ${mode} · ${graph.edges.length}/${graph.totalEdges} relationships · ${c.unresolvedSites} unresolved sites`;
        el('status').textContent = status + ' · Arranging…';
        el('graph').setAttribute('aria-busy', 'true');
        el('graph').replaceChildren(); svg = undefined;
        const selected = graph.nodes.find(n => n.id === focus);
        el('focus').replaceChildren();
        if (selected) { text('strong', `${selected.name} · `, el('focus')); if (mode === 'folders') text('span', `${selected.members} indexed symbols`, el('focus')); else sourceLink(selected.source, el('focus')); }
        el('expand').disabled = mode === 'symbols' || !selected;
        el('expand').textContent = mode === 'folders' ? 'Inspect files' : 'Inspect symbols';
        evidence();
        el('details').replaceChildren();
        for (const a of report.assumptions) text('p', a, el('details'));
        if (report.configuration) text('p', `Python roots: ${report.configuration.pythonRoots.map(root => root || '.').join(', ')}`, el('details'));
        for (const p of snapshot.producers) text('p', `${p.language}: ${p.name}`, el('details'));
        for (const d of snapshot.diagnostics) text('p', `${d.file || d.language || ''}: ${d.code}: ${d.message}`, el('details'));
        if (c.omittedDiagnostics) text('p', `${c.omittedDiagnostics} additional diagnostics omitted.`, el('details'));
        try {
            const layout = await engine.layout(layoutInput(graph, el('direction').value));
            if (request !== generation) return;
            svg = svgEl('svg', { role: 'img', 'aria-label': 'Dependency graph; select nodes for direct neighbors' }, el('graph'));
            const defs = svgEl('defs', {}, svg), marker = svgEl('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
            svgEl('polygon', { points: '0,0 10,5 0,10', fill: '#a2b8c6' }, marker);
            for (const edge of layout.edges || []) {
                const data = graph.edges[Number(edge.id.slice(1))];
                const g = svgEl('g', { class: `edge${data.id === selectedEdge ? ' selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${data.count} sites: ${data.relations.join(', ')}` }, svg);
                for (const section of edge.sections || []) {
                    const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
                    svgEl('path', { d: points.map((p, j) => `${j ? 'L' : 'M'}${p.x},${p.y}`).join(' '), 'marker-end': 'url(#arrow)' }, g);
                    if (data.count > 1) { const point = points[Math.floor(points.length / 2)]; svgEl('text', { x: point.x + 6, y: point.y - 6 }, g).textContent = String(data.count); }
                }
                svgEl('title', {}, g).textContent = `${data.count} sites · ${data.relations.join(', ')} · ${data.phases.join(', ')}`;
                const select = () => {
                    if (moved) return;
                    selectedEdge = data.id;
                    for (const group of svg.querySelectorAll('.edge')) group.classList.remove('selected');
                    g.classList.add('selected'); evidence(); el('evidence-panel').open = true;
                };
                g.addEventListener('click', select); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moved = false; select(); } });
            }
            for (const node of layout.children || []) {
                const data = graph.nodes[Number(node.id.slice(1))];
                const g = svgEl('g', { class: `node${data.id === focus ? ' selected' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${data.name} in ${data.source.file}` }, svg);
                svgEl('rect', { x: node.x, y: node.y, width: node.width, height: node.height, rx: 8 }, g);
                svgEl('title', {}, g).textContent = `${data.source.file}: ${data.name}`;
                const label = data.name === '<init>' ? 'Module initialization' : data.name;
                svgEl('text', { x: node.x + 12, y: node.y + 25 }, g).textContent = label.length > 31 ? label.slice(0, 28) + '…' : label;
                const path = mode === 'folders' ? `${data.members} indexed symbols` : data.source.file;
                svgEl('text', { x: node.x + 12, y: node.y + 47 }, g).textContent = path.length > 33 ? '…' + path.slice(-32) : path;
                const select = () => { if (!moved) { focus = data.id; selectedEdge = undefined; render(); } };
                g.addEventListener('click', select); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moved = false; select(); } });
            }
            initialBox = { x: 0, y: 0, width: Math.max(300, layout.width || 0), height: Math.max(180, layout.height || 0) }; fit();
            el('status').textContent = status + (graph.omittedNodes || graph.omittedEdges ? ' · Narrow the filters to see omitted relationships.' : '');
        } catch (error) {
            if (request !== generation) return;
            el('status').classList.add('error'); el('status').textContent = `${status} · Layout unavailable: ${error.message}. Source evidence remains available.`;
        } finally { if (request === generation) el('graph').setAttribute('aria-busy', 'false'); }
    }
    for (const id of ['revision', 'mode', 'language', 'relation', 'phase', 'search']) el(id).addEventListener(id === 'search' ? 'input' : 'change', () => { focus = undefined; selectedEdge = undefined; render(); });
    el('direction').addEventListener('change', render);
    el('reset').addEventListener('click', () => { focus = undefined; selectedEdge = undefined; render(); });
    el('expand').addEventListener('click', () => {
        const selected = current.nodes.find(n => n.id === focus);
        if (!selected) return;
        const folders = el('mode').value === 'folders';
        el('mode').value = folders ? 'files' : 'symbols'; el('search').value = folders ? selected.folder === '.' ? '' : selected.folder + '/' : selected.source.file; focus = undefined; selectedEdge = undefined; render();
    });
    el('fit').addEventListener('click', fit); el('zoomin').addEventListener('click', () => zoom(.8)); el('zoomout').addEventListener('click', () => zoom(1.25));
    el('graph').addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    el('graph').addEventListener('pointerdown', e => { moved = false; if (box && e.button === 0) drag = { x: e.clientX, y: e.clientY, box: { ...box } }; });
    window.addEventListener('pointermove', e => {
        if (!drag || !svg) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        box = { ...drag.box, x: drag.box.x - dx * drag.box.width / el('graph').clientWidth, y: drag.box.y - dy * drag.box.height / el('graph').clientHeight }; applyBox();
    });
    window.addEventListener('pointerup', () => { drag = undefined; });
    window.addEventListener('pointercancel', () => { drag = undefined; });
    window.addEventListener('resize', fit);
    if (settings.focus?.file) {
        if (settings.focus.revision === 'base') el('revision').value = 'base';
        const snapshot = report[el('revision').value];
        const candidates = snapshot.nodes.filter(n => n.source.file === settings.focus.file && n.kind !== 'module-init' && (Number.isInteger(settings.focus.start) ? n.source.start <= settings.focus.start && n.source.end > settings.focus.start : n.source.line === settings.focus.line));
        candidates.sort((a, b) => b.source.start - a.source.start);
        el('mode').value = (settings.focus.line || Number.isInteger(settings.focus.start)) && candidates.length ? 'symbols' : 'files';
        focus = el('mode').value === 'symbols' ? candidates[0].id : JSON.stringify(['file', settings.focus.file]);
    }
    render();
}
module.exports = { renderEvidenceSummary, renderMermaid, renderEvidenceHtml };
