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

test('reader packets preserve title-equal prose while removing duplicated headings', () => {
    const f = optionalBranchesFixture();
    try {
        const { source } = loadTourSource(f.root, f.sourcePath);
        const manifest = buildManifestForTourSource(f.root, source);
        const tour = { ...manifest, ...manifest.tours.historical };
        const title = 'Keep local copies.';
        const prose = `Remote copies are absent. ${title} They are the only evidence.`;
        tour.opening = { title, summary: prose };
        tour.conclusion = { title, summary: prose };
        const scene = tour.scenes[0];
        scene.title = title;
        scene.summary = prose;
        const step = scene.steps.find(step => !step.branch);
        step.title = title;
        step.body = prose;
        const packet = buildReaderPacket(tour);
        for (const id of ['title', `scene:${scene.id}`, `step:${scene.id}:${step.id}`, 'conclusion']) {
            const item = packet.main.find(item => item.id === id);
            assert.equal(item.title, title);
            assert.ok(item.text.includes(prose.replaceAll('. ', '.\n')), `${id} retains the full prose sequence`);
            assert.equal(item.text.split('\n').filter(line => line === title).length, 1,
                `${id} retains the prose occurrence without duplicating the heading`);
        }
    } finally { f.dispose(); }
});

test('optional packet branches retain child headings as well as matching body sentences', () => {
    const f = optionalBranchesFixture();
    try {
        const { source } = loadTourSource(f.root, f.sourcePath);
        const manifest = buildManifestForTourSource(f.root, source);
        const tour = { ...manifest, ...manifest.tours.historical };
        const step = tour.scenes[0].steps.find(step => step.branch);
        step.title = 'Keep optional copies.';
        step.body = step.title;
        const packet = buildReaderPacket(tour);
        const branch = packet.branches.find(item => item.id === `branch:0:${step.branch.id}`);
        assert.equal(branch.text.split('\n').filter(line => line === step.title).length, 2);
    } finally { f.dispose(); }
});
