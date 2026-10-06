const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { convertTourSourceText, inspectTourConversion, parseTourSourceText } = require('../cli/tourFile.js');
const { loadTourWithConversion } = require('../standalone/tourConversion.js');
const { startPresentation } = require('../cli/present.js');
const { exportFixture } = require('./exportFixture.js');

function source(version = 3) {
    return { version, range: { base: 'main', head: 'topic' }, anchors: {
        line: { file: 'app.txt', revision: 'head', contains: 'value' }
    }, connections: [], chapters: [{ id: 'chapter', title: 'Chapter', scenes: [{
        id: 'scene', kind: 'walkthrough', title: 'Scene', summary: 'Summary', bullets: [], tags: [], takeaway: 'Takeaway',
        steps: [{ id: 'step', title: 'Step', body: 'Body', focus: 'line' }]
    }] }] };
}

test('conversion preserves authored evidence and IDs for versions 1–3, moving review notes into the tour flow', () => {
    for (const version of [1, 2, 3]) {
        const original = source(version);
        original.review = { title: 'Keep these notes in the original' };
        const text = JSON.stringify(original);
        assert.equal(inspectTourConversion(text).fromVersion, version);
        const converted = convertTourSourceText(text);
        const expected = { ...JSON.parse(text), version: 4 };
        delete expected.review;
        const body = converted.source.chapters[0].scenes[0].steps[0].body;
        assert.match(body, /Legacy review notes/);
        assert.match(body, /Keep these notes in the original/);
        expected.chapters[0].scenes[0].steps[0].body = body;
        assert.deepEqual(converted.source, expected);
        assert.deepEqual(parseTourSourceText(converted.text), expected);
        assert.equal(original.review.title, 'Keep these notes in the original');
    }
    assert.equal(inspectTourConversion(JSON.stringify(source(4))), null);
    assert.equal(inspectTourConversion(JSON.stringify(source(5))), null);
    assert.throws(() => convertTourSourceText(JSON.stringify(source(5))), /Only authored/);
    assert.throws(() => convertTourSourceText('version: 3\n---\nversion: 3'), /one YAML document/);
    assert.throws(() => convertTourSourceText('version: 3\0'), /Invalid tour text/);
    assert.throws(() => convertTourSourceText(JSON.stringify({ ...source(), unknownField: true })), /cannot be converted automatically.*unknown field/i);
});

test('review prose retains revisions, kinds, evidence links, next checks, and every authored mode', () => {
    const original = source();
    const synthetic = { ...original.chapters[0].scenes[0], kind: 'deconstructed-diff',
        stages: [{ id: 'stage', title: 'Stage', narration: 'Stage narration.', changes: [{ file: 'app.txt', hunks: ['hunk'] }] }] };
    delete synthetic.steps;
    original.tours = {
        historical: { chapters: JSON.parse(JSON.stringify(original.chapters)) },
        deconstructed: { chapters: [{ id: 'explanation', title: 'Explanation', scenes: [synthetic] }] }
    };
    original.review = { baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), items: [
        { id: 'note', kind: 'tradeoff', title: 'Original tradeoff', body: 'Preserve this reasoning.',
            evidence: [{ sceneId: 'scene', stepId: 'step' }], nextCheck: 'Check the boundary.' },
        { id: 'question', kind: 'question', title: 'An unresolved question', body: 'Question body',
            evidence: [{ sceneId: 'removed', stepId: 'missing' }], nextCheck: 'Recheck manually.' }
    ] };
    const converted = convertTourSourceText(JSON.stringify(original)).source;
    for (const tour of [converted, converted.tours.historical]) {
        const body = tour.chapters[0].scenes[0].steps[0].body;
        for (const text of ['a'.repeat(40), 'b'.repeat(40), 'Original tradeoff', 'Preserve this reasoning.', 'Check the boundary.', 'tradeoff (note)', 'removed / missing', 'Recheck manually.']) assert.ok(body.includes(text), text);
        assert.match(body, /Open referenced step.*scene=scene&step=step/);
        assert.doesNotMatch(body, /scene=removed|Original review data/);
        assert.equal((body.match(/## Legacy review notes/g) || []).length, 1);
    }
    const narration = converted.tours.deconstructed.chapters[0].scenes[0].stages[0].narration;
    assert.match(narration, /Stage narration\.[\s\S]*Legacy review notes[\s\S]*Preserve this reasoning/);
    assert.match(narration, /mode=historical/);
    assert.equal(original.chapters[0].scenes[0].steps[0].body, 'Body');
    original.tours.historical.chapters[0].scenes[0].id = 'different-scene';
    const changed = convertTourSourceText(JSON.stringify(original)).source;
    assert.doesNotMatch(changed.chapters[0].scenes[0].steps[0].body, /Open referenced step/);
});

test('v1 synthetic-only scenes fail explicitly instead of inventing real revision evidence', () => {
    const original = source(1);
    const scene = original.chapters[0].scenes[0];
    scene.kind = 'deconstructed-diff';
    delete scene.steps;
    scene.stages = [{ id: 'stage', title: 'Stage', narration: 'Narration', changes: [{ file: 'app.txt', hunks: ['hunk'] }] }];
    const text = JSON.stringify(original);
    assert.doesNotThrow(() => parseTourSourceText(text));
    assert.throws(() => convertTourSourceText(text), /cannot be converted automatically.*stack/);
});

test('desktop conversion cancels without writes, preserves originals, and never overwrites an existing copy', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-conversion-'));
    try {
        const file = path.join(root, 'tour.bygone.yaml');
        const text = JSON.stringify(source());
        fs.writeFileSync(file, text);
        const canceled = await loadTourWithConversion(root, file, { showMessageBox: async options => {
            assert.deepEqual(options.buttons, ['Convert and open copy', 'Cancel']);
            assert.match(options.detail, /Review notes/);
            return { response: 1 };
        } });
        assert.equal(canceled, null);
        assert.deepEqual(fs.readdirSync(root), ['tour.bygone.yaml']);
        const copy = path.join(root, 'tour.v4.bygone.yaml');
        fs.writeFileSync(copy, 'existing content');
        const converted = await loadTourWithConversion(root, file, { showMessageBox: async () => ({ response: 0 }) });
        assert.equal(converted.resolvedPath, path.join(root, 'tour.v4-2.bygone.yaml'));
        assert.equal(converted.source.version, 4);
        assert.equal(fs.readFileSync(file, 'utf8'), text);
        assert.equal(fs.readFileSync(copy, 'utf8'), 'existing content');
        await loadTourWithConversion(root, converted.resolvedPath, { showMessageBox: () => assert.fail('v4 must not prompt') });
        await assert.rejects(loadTourWithConversion(root, file, { showMessageBox: async () => {
            fs.writeFileSync(file, text + '\n');
            return { response: 0 };
        } }), /changed while conversion was pending/);
        assert.equal(fs.readdirSync(root).length, 3);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('presentation conversion retains section targets and links to the saved copy; cancel starts no server', async () => {
    const fixture = exportFixture();
    let presentation;
    try {
        const original = { ...fixture.source, version: 3 };
        delete original.tours;
        fs.writeFileSync(fixture.sourcePath, JSON.stringify(original));
        const options = { announce: false, open: false, ignoreEnvironment: true,
            loadTourSource: (cwd, file) => loadTourWithConversion(cwd, file, { showMessageBox: async () => ({ response: 1 }) }) };
        assert.equal(await startPresentation(['--tour', fixture.sourcePath], fixture.root, path.resolve(__dirname, '..'), options), null);
        options.loadTourSource = (cwd, file) => loadTourWithConversion(cwd, file, { showMessageBox: async () => ({ response: 0 }) });
        options.location = { mode: 'historical', focus: { part: 'step', scene: 'scene', step: 'step' } };
        presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, path.resolve(__dirname, '..'), options);
        assert.equal(presentation.manifest.version, 4);
        assert.equal(presentation.manifest.localSource.tour, 'test.v4.bygone');
        assert.equal(presentation.manifest.range.headOid, fixture.head);
        assert.equal(presentation.sourcePath, path.join(fixture.root, 'test.v4.bygone'));
        assert.equal(JSON.parse(fs.readFileSync(fixture.sourcePath, 'utf8')).version, 3);
    } finally {
        if (presentation) await new Promise(resolve => presentation.server.close(resolve));
        fixture.dispose();
    }
});
