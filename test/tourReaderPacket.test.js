const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { optionalBranchesFixture } = require('./optionalBranchesFixture');
const { runTourCommand } = require('../cli/tour');
const { buildReaderPacket, buildReaderPacketReport } = require('../cli/tourReaderPacket');
const { buildManifestForTourSource, loadTourSource } = require('../cli/tourFile');

test('reader packet uses real main reading order and keeps branch and check bodies optional', () => {
    const f = optionalBranchesFixture();
    try {
        const { source } = loadTourSource(f.root, f.sourcePath);
        const manifest = buildManifestForTourSource(f.root, source);
        const tour = { ...manifest, ...manifest.tours.historical };
        const packet = buildReaderPacket(tour);
        assert.equal(packet.schema_version, 1);
        assert.equal(packet.main.length, 6);
        assert.doesNotMatch(packet.main.map(n => n.text).join(' '), /optional-evidence-marker|Author-supplied checks/);
        assert.ok(packet.branches.some(n => /optional-evidence-marker/.test(n.text)));
        assert.ok(packet.checks.some(n => n.title === 'Behavior · Not checked'));
        const nodes = [...packet.main, ...packet.branches, ...packet.checks];
        assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length);
        for (const node of nodes) for (const id of node.child_ids) assert.ok(nodes.some(n => n.id === id));
        const mainBranches = packet.main.flatMap(n => n.child_ids).filter(id => id.startsWith('branch:'));
        assert.ok(mainBranches.length > 0);
        assert.ok(packet.branches.some(n => n.child_ids.length > 0), 'nested branches retained');
        assert.doesNotMatch(JSON.stringify(packet), /repository|generatedBy|mergeBaseOid/);
        let output = '';
        const result = runTourCommand(['reader-packet', f.sourcePath, '--json'], f.root,
            path.resolve(__dirname, '..'), { write: text => { output += text; } });
        assert.deepEqual(JSON.parse(output), result.report);
        assert.deepEqual(result.report.modes.historical, packet);
        manifest.details = { checks: { behavior: { status: 'verified', summary: 'Root only evidence.' } } };
        delete manifest.tours.historical.details;
        const independent = buildReaderPacketReport(manifest).modes.historical;
        assert.doesNotMatch(JSON.stringify(independent), /Root only evidence/);
        assert.ok(independent.checks.some(n => n.title === 'Behavior · Not checked'));
    } finally { f.dispose(); }
});
