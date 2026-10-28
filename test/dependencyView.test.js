const test = require('node:test');
const assert = require('node:assert/strict');
const ELK = require('elkjs');
const { projectGraph, layoutInput } = require('../cli/dependency-view-model');
const source = file => ({ file, line: 1, column: 1 });
function fixture(count) {
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, name: `fn${i}`, language: 'typescript', source: source(`src/file${i}.ts`) }));
    const sites = nodes.slice(1).map((n, i) => ({ id: `s${i}`, owner: n.id, target: 'n0', relation: 'call', phase: 'invocation', resolution: 'resolved', source: n.source }));
    return { nodes, sites };
}
test('focus survives node truncation and retains connected incoming edges', () => {
    const snapshot = fixture(152);
    snapshot.nodes.push(snapshot.nodes.shift()); // Hub occurs after all of its callers.
    const graph = projectGraph(snapshot, { mode: 'symbols', focus: 'n0' });
    assert.equal(graph.nodes.length, 150);
    assert.equal(graph.nodes[0].id, 'n0');
    assert.equal(graph.edges.length, 149);
    assert.equal(graph.omittedNodes, 2);
    assert.equal(graph.omittedEdges, 2);
    assert.ok(graph.edges.every(e => e.target === 'n0'));
});
test('file projection aggregates repeated sites and excludes within-file edges and references by default', () => {
    const snapshot = fixture(3);
    snapshot.nodes[2].source.file = snapshot.nodes[1].source.file;
    snapshot.sites.push({ ...snapshot.sites[0], id: 'extra' }, { ...snapshot.sites[0], id: 'reference', relation: 'reference' },
        { ...snapshot.sites[0], id: 'within', target: 'n2' });
    const graph = projectGraph(snapshot);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].count, 3);
    assert.equal(graph.sites.length, 4); // Includes within-file evidence, though it is not a file dependency.
    assert.equal(projectGraph(snapshot, { relation: '' }).edges[0].count, 4);
});
test('search preserves targets and edge limits disclose every omitted relationship', () => {
    const snapshot = fixture(10);
    const search = projectGraph(snapshot, { mode: 'symbols', query: 'fn8' });
    assert.deepEqual(new Set(search.nodes.map(n => n.id)), new Set(['n8', 'n0']));
    assert.equal(search.edges.length, 1);
    const bounded = projectGraph(snapshot, { maxNodes: 5, maxEdges: 2 });
    assert.equal(bounded.omittedNodes, 5);
    assert.equal(bounded.omittedEdges, 7);
    const ids = new Set(bounded.nodes.map(n => n.id));
    assert.ok(bounded.edges.every(e => ids.has(e.owner) && ids.has(e.target)));
});

test('language filtering excludes other-language sites in mixed folders while retaining targets', () => {
    const snapshot = fixture(3);
    snapshot.nodes[0].language = 'python';
    snapshot.nodes[0].source.file = 'src/a/first.py';
    snapshot.nodes[1].source.file = 'src/a/second.ts';
    snapshot.nodes[2].source.file = 'src/b/target.ts';
    snapshot.sites = [0, 1].map(i => ({ id: `s${i}`, owner: `n${i}`, target: 'n2', relation: 'call', phase: 'invocation' }));
    const graph = projectGraph(snapshot, { mode: 'folders', language: 'python' });
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].count, 1);
    assert.deepEqual(graph.sites.map(s => s.id), ['s0']);
    assert.deepEqual(graph.nodes.map(n => n.name).sort(), ['src/a', 'src/b']);
});
for (const count of [20, 100]) test(`ELK routes a ${count}-node cyclic graph without node overlap`, async () => {
    const snapshot = fixture(count);
    for (let i = 0; i < count; i++) snapshot.sites.push({ id: `cycle${i}`, owner: `n${i}`, target: `n${(i + 1) % count}`, relation: 'call' });
    const graph = projectGraph(snapshot, { mode: 'symbols' });
    const input = layoutInput(graph), engine = new ELK();
    const layout = await engine.layout(input);
    assert.equal(layout.children.length, count);
    assert.equal(layout.edges.length, graph.edges.length);
    for (const edge of layout.edges) assert.ok(edge.sections?.length, edge.id);
    for (const a of layout.children) for (const b of layout.children) {
        if (a.id === b.id) continue;
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} overlaps ${b.id}`);
    }
    const again = await engine.layout(layoutInput(graph));
    const positions = nodes => nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
    assert.deepEqual(positions(again.children), positions(layout.children));
});

test('large repositories start grouped by folder and retain cross-folder evidence', () => {
    const snapshot = fixture(40);
    for (let i = 0; i < 40; i++) snapshot.nodes[i].source.file = `${i < 20 ? 'cli' : 'src'}/file${i}.ts`;
    const graph = projectGraph(snapshot);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].count, 20);
});
