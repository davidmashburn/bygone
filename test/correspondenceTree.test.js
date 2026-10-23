const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolve } = require('node:path');
const { buildSync } = require('esbuild');
const { correspondenceTreeFixture } = require('./correspondenceTreeFixture');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [resolve(__dirname, '../web/correspondenceTree.js')], bundle: true, write: false, format: 'esm' }).outputFiles[0].contents).toString('base64'));
const flatten = tree => {
    const result = [], pending = [...tree.files];
    while (pending.length) { const node = pending.pop(); result.push(node); pending.push(...node.children); }
    return result;
};

test('tree keeps lexical parents, unmatched sides and ambiguous ancestors without inventing pairs', async () => {
    const { buildCorrespondenceTree } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    // Inventory order must not establish hierarchy.
    artifact.symbols.before.reverse(); artifact.symbols.after.reverse();
    const tree = buildCorrespondenceTree(artifact);
    const nodes = flatten(tree), stable = nodes.find(n => n.entry?.name === 'Stable');
    assert.ok(stable.context); assert.equal(stable.changed, false);
    assert.deepEqual(stable.children.map(n => [n.entry.name, n.side, n.ambiguous]), [
        ['uncertain', 'after', true], ['uncertain', 'before', true]
    ]);
    assert.equal(nodes.some(n => n.entry?.name === 'kept'), false);
    assert.equal(nodes.some(n => n.entry?.name === 'nested'), false);
    assert.equal(tree.matchingRelations, 3); // class, edited/renamed method, moved function
    assert.equal(tree.matchingUnmatched, 4);
    const all = flatten(buildCorrespondenceTree(artifact, { all: true }));
    const nested = all.find(n => n.entry?.name === 'nested');
    assert.equal(nested.parent.entry.name, 'new_name');
    assert.equal(nested.parent.parent.entry.name, 'Work');
    assert.equal(all.filter(n => n.entry?.name === 'Stable').length, 1);
});

test('moves retain both locations with one relation count and exact comparison endpoints', async () => {
    const { buildCorrespondenceTree } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    const tree = buildCorrespondenceTree(artifact, { query: 'TRANSFER' });
    const nodes = flatten(tree), moved = nodes.filter(n => n.relation);
    assert.deepEqual(tree.files.map(f => f.path), ['src/moved.py', 'src/outline.py']);
    assert.equal(moved.length, 2); assert.equal(tree.matchingRelations, 1);
    assert.equal(moved.filter(n => n.sourceReference).length, 1);
    for (const node of moved) {
        assert.equal(node.before.path, 'src/outline.py'); assert.equal(node.after.path, 'src/moved.py');
        assert.equal(node.before.text, node.after.text);
    }
});

test('search retains only matching symbols and ancestor paths; all reveals unchanged nested symbols', async () => {
    const { buildCorrespondenceTree } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    let tree = buildCorrespondenceTree(artifact, { query: 'new_name' });
    assert.equal(tree.matchingRelations, 1);
    const parent = tree.files[0].children[0];
    assert.equal(parent.entry.name, 'Work'); assert.ok(parent.context);
    assert.equal(parent.children[0].entry.name, 'new_name');
    assert.equal(buildCorrespondenceTree(artifact, { query: 'nested' }).files.length, 0);
    tree = buildCorrespondenceTree(artifact, { all: true, query: 'nested' });
    const nodes = flatten(tree);
    assert.equal(nodes.find(n => n.entry?.name === 'nested').parent.entry.name, 'new_name');
    assert.ok(nodes.find(n => n.entry?.name === 'Work').context);
    assert.equal(buildCorrespondenceTree(artifact, { all: true, query: 'absent' }).files.length, 0);
});

test('a same-file reparenting keeps both source and destination hierarchy', async () => {
    const { buildCorrespondenceTree } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    // Move an otherwise identical nested symbol out of its enclosing method.
    const nested = artifact.symbols.after.find(n => n.name === 'nested');
    nested.start = 1000; nested.end = 1010;
    const tree = buildCorrespondenceTree(artifact, { query: 'nested' });
    const nodes = flatten(tree), matches = nodes.filter(n => n.entry?.name === 'nested');
    assert.equal(matches.length, 2); assert.equal(tree.matchingRelations, 1);
    assert.equal(matches.find(n => n.sourceReference).parent.entry.name, 'new_name');
    assert.equal(matches.find(n => !n.sourceReference).parent.type, 'file');
    assert.ok(matches.every(n => n.changed));
});

test('equal declaration ranges remain peers rather than becoming arbitrary ancestors', async () => {
    const { buildCorrespondenceTree } = await modulePromise;
    const { artifact } = correspondenceTreeFixture();
    const work = artifact.symbols.after.find(n => n.name === 'Work');
    artifact.symbols.after.push({ ...work, id: 'after-peer', name: 'Peer' });
    const tree = buildCorrespondenceTree(artifact, { all: true });
    const nodes = flatten(tree), peer = nodes.find(n => n.entry?.name === 'Peer');
    assert.equal(peer.parent.type, 'file');
    assert.equal(nodes.find(n => n.entry?.name === 'new_name').parent.type, 'file');
});
