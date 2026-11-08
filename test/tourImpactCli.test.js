const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { runTourCommand } = require('../cli/tour');
const { exportFixture } = require('./exportFixture');
const { parseDeepLink, parseDocumentFragment } = require('../out/deepLink');

test('impact uses a compiled snapshot, identifies its bytes, and creates reports without overwriting', () => {
    const fixture = exportFixture();
    const output = { write() {} };
    try {
        const snapshot = path.join(fixture.root, 'snapshot.json');
        runTourCommand(['compile', fixture.sourcePath, '--output', snapshot], fixture.root, '', output);
        const original = fs.readFileSync(snapshot);
        const source = fs.readFileSync(fixture.sourcePath);
        fs.writeFileSync(path.join(fixture.root, 'new.txt'), 'new unreferenced change\n');
        fixture.git('add', 'new.txt'); fixture.git('commit', '-m', 'New change');
        // Moving the authored branch must not silently recompile the original document.
        fixture.git('branch', '-f', 'export-head', 'HEAD');
        const destination = path.join(fixture.root, 'impact.json');
        const args = ['impact', snapshot, '--head', 'HEAD', '--output', destination];
        const result = runTourCommand(args, fixture.root, '', output);
        assert.equal(result.report.document.sha256, createHash('sha256').update(original).digest('hex'));
        assert.equal(result.report.document.file, 'snapshot.json');
        assert.equal(parseDeepLink(result.report.comparisonLink).revisions[0], fixture.head);
        const observation = result.report.observations.find(item => item.references.some(reference => reference.oldEvidenceLink));
        assert.ok(observation, 'Pinned evidence has an actionable comparison link');
        assert.equal(parseDocumentFragment(observation.fragment).focus.step, observation.stepId);
        for (const reference of observation.references) {
            if (!reference.oldRef) continue;
            const link = parseDeepLink(reference.oldEvidenceLink);
            assert.equal(link.file, reference.oldRef.path);
            assert.equal(link.revision, reference.oldRef.revision);
            assert.ok(link.line > 0);
        }
        assert.ok(result.report.uncoveredChanges.some(change => change.path === 'new.txt' && parseDeepLink(change.comparisonLink).file === 'new.txt'));
        const written = fs.readFileSync(destination);
        assert.deepEqual(JSON.parse(written), result.report);
        assert.throws(() => runTourCommand(args, fixture.root, '', output), /EEXIST/);
        assert.deepEqual(fs.readFileSync(destination), written);
        assert.throws(() => runTourCommand(['impact', snapshot, '--head', 'HEAD', '--output', snapshot], fixture.root, '', output), /EEXIST/);
        assert.deepEqual(fs.readFileSync(snapshot), original);
        assert.deepEqual(fs.readFileSync(fixture.sourcePath), source);
        assert.throws(() => runTourCommand(['impact', fixture.sourcePath, '--head', 'HEAD'], fixture.root, '', output));
        const cliReport = JSON.parse(execFileSync(process.execPath, [path.resolve(__dirname, '../bin/bygone.js'),
            '-C', fixture.root, 'tour', 'impact', snapshot, '--head', 'HEAD', '--json'],
        { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', stdio: 'pipe' }));
        assert.deepEqual(cliReport, result.report, 'The public CLI respects the explicitly bound repository');
    } finally { fixture.dispose(); }
});

test('impact requires explicit input and new head', () => {
    for (const args of [[], ['snapshot.json'], ['snapshot.json', '--head'], ['--unknown']]) {
        assert.throws(() => runTourCommand(['impact', ...args], '.', '', { write() {} }), /Usage:|requires a value|Unexpected/);
    }
});
