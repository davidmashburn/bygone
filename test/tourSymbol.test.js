const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const Ajv = require('ajv/dist/2020');
const { buildChangeTourManifest, parseChangeTourManifest, parseChangeTourSource } = require('../out/changeTour');
const { buildTourCoverageReport } = require('../out/tourCoverage');
const { materializeTour } = require('../cli/tourExport');
const schema = require('../schemas/change-tour-source.schema.json');

const { tourSymbolFixture: fixture } = require('./tourSymbolFixture');
const step = manifest => manifest.scenes[0].steps[0];
const compile = f => buildChangeTourManifest(f.root, { source: f.source });

test('symbol stops pin complete declarations and both file contexts; exports are self-contained', () => {
    const f = fixture();
    try {
        const validate = new Ajv({ strict: false }).compile(schema);
        assert.ok(validate(f.source), JSON.stringify(validate.errors));
        const manifest = compile(f), symbol = step(manifest).symbol;
        assert.equal(manifest.version, 6); assert.equal(symbol.status, 'inferred');
        assert.equal(symbol.before.path, 'src/outline.py'); assert.equal(symbol.after.path, 'src/moved.py');
        assert.equal(symbol.context.leftContent, f.input.before['src/outline.py']);
        assert.equal(symbol.context.rightContent, f.input.after['src/moved.py']);
        assert.deepEqual(symbol.range, f.range);
        assert.equal(symbol.before.text, symbol.context.leftContent.slice(symbol.before.start, symbol.before.end));
        assert.deepEqual(step(parseChangeTourManifest(JSON.parse(JSON.stringify(manifest)))).symbol, symbol);
        const coverage = buildTourCoverageReport(f.root, f.source);
        assert.ok(coverage.files.find(file => file.path === 'src/outline.py').coveredUnits > 0);
        assert.ok(coverage.files.find(file => file.path === 'src/moved.py').coveredUnits > 0);
        const sourcePath = path.join(f.root, 'move.bygone'); fs.writeFileSync(sourcePath, JSON.stringify(f.source));
        const packed = materializeTour(sourcePath, 'minimal');
        const hydrate = value => Array.isArray(value) ? value.map(hydrate) : value && typeof value === 'object'
            ? value.$text ? packed.texts[value.$text] : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, hydrate(child)])) : value;
        assert.deepEqual(step(hydrate(packed.manifest)).symbol, symbol);
        assert.throws(() => parseChangeTourManifest({ ...manifest, scenes: [{ ...manifest.scenes[0], steps: [{ ...step(manifest), symbol: { ...symbol, status: 'ambiguous' } }] }] }), /Invalid pinned/);
        const bad = structuredClone(manifest); bad.scenes[0].steps[0].symbol.before.startLine++;
        assert.throws(() => parseChangeTourManifest(bad), /Invalid pinned/);
        const conflicting = structuredClone(manifest); conflicting.scenes[0].steps[0].connection = {};
        assert.throws(() => parseChangeTourManifest(conflicting), /cannot combine/);
        const stale = structuredClone(manifest); stale.scenes[0].steps[0].symbol.range.headOid = f.range.baseOid;
        assert.throws(() => parseChangeTourManifest(stale), /revisions do not match/);
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(sourcePath, profile);
            assert.equal(JSON.stringify(exported).includes(f.root), false);
            assert.equal(JSON.stringify(exported).includes('symbols.json'), false);
        }
    } finally { f.dispose(); }
});

test('symbol stops reject stale artifacts, invented matches, unrelated focus and older formats', () => {
    const f = fixture();
    try {
        const sourceStep = f.source.chapters[0].scenes[0].steps[0];
        sourceStep.symbol.relation = 'invented'; assert.throws(() => compile(f), /No accepted correspondence/);
        sourceStep.symbol = { symbol: 'after-transfer' }; assert.throws(() => compile(f), /Matched symbols/);
        sourceStep.symbol = { relation: 'relation-transfer' };
        f.source.anchors.moved.contains = 'class Stable:';
        f.source.anchors.moved.file = 'src/outline.py';
        assert.throws(() => compile(f), /Symbol stop focus|ambiguous/i);
        f.source.anchors.moved = { file: 'src/moved.py', revision: 'head', contains: 'def transfer()' };
        delete f.source.correspondence; assert.throws(() => compile(f), /requires a correspondence artifact/);
        f.source.correspondence = '../symbols.json'; assert.throws(() => parseChangeTourSource(f.source), /repository-relative/);
        f.source.correspondence = 'symbols.json'; f.source.version = 5;
        assert.throws(() => parseChangeTourSource(f.source), /version 6/);
        assert.equal(new Ajv({ strict: false }).compile(schema)(f.source), false);
        f.source.version = 6;
        f.input.artifact.range.baseOid = f.range.headOid;
        fs.writeFileSync(path.join(f.root, 'symbols.json'), JSON.stringify(f.input.artifact));
        assert.throws(() => compile(f), /revisions do not match/);
    } finally { f.dispose(); }
});

test('ambiguous endpoints remain one-sided in symbol stops', () => {
    const f = fixture();
    try {
        f.source.anchors.moved = { file: 'src/outline.py', revision: 'head', contains: 'def uncertain(self)' };
        f.source.chapters[0].scenes[0].steps[0].symbol = { symbol: 'after-uncertain' };
        const symbol = step(compile(f)).symbol;
        assert.equal(symbol.status, 'ambiguous'); assert.equal(symbol.before, undefined);
        assert.equal(symbol.context.leftContent, ''); assert.match(symbol.after.text, /def uncertain/);
    } finally { f.dispose(); }
});

test('symbol artifacts allow internal symlinks and hardlinks and reject links outside the repository', () => {
    const f = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-artifact-outside-'));
    try {
        const directoryLink = process.platform === 'win32' ? 'junction' : 'dir';
        fs.mkdirSync(path.join(f.root, 'evidence'));
        fs.copyFileSync(path.join(f.root, 'symbols.json'), path.join(f.root, 'evidence', 'symbols.json'));
        fs.symlinkSync(path.join(f.root, 'evidence'), path.join(f.root, 'internal'), directoryLink);
        f.source.correspondence = 'internal/symbols.json';
        assert.doesNotThrow(() => compile(f));
        fs.linkSync(path.join(f.root, 'symbols.json'), path.join(f.root, 'hardlink-symbols.json'));
        f.source.correspondence = 'hardlink-symbols.json';
        assert.doesNotThrow(() => compile(f));
        fs.copyFileSync(path.join(f.root, 'symbols.json'), path.join(outside, 'symbols.json'));
        fs.symlinkSync(outside, path.join(f.root, 'external'), directoryLink);
        f.source.correspondence = 'external/symbols.json';
        assert.throws(() => compile(f), /must be inside the repository/);
    } finally { f.dispose(); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('before-only and after-only stops preserve their side across authored modes', () => {
    const f = fixture();
    try {
        const cases = [
            ['base', 'before-prior_only', 'def prior_only()', 'before'],
            ['head', 'after-fresh_only', 'def fresh_only()', 'after']
        ];
        for (const [revision, id, contains, side] of cases) {
            f.source.anchors.moved = { file: 'src/outline.py', revision, contains };
            f.source.chapters[0].scenes[0].steps[0].symbol = { symbol: id };
            f.source.tours = { historical: { chapters: structuredClone(f.source.chapters) } };
            const manifest = compile(f);
            for (const scenes of [manifest.scenes, manifest.zoom.final.scenes, manifest.tours.historical.scenes]) {
                const symbol = scenes[0].steps[0].symbol;
                assert.equal(symbol.status, 'unmatched');
                assert.equal(symbol[side].id, id);
                assert.equal(symbol[side === 'before' ? 'after' : 'before'], undefined);
                assert.equal(symbol.context[side === 'before' ? 'rightContent' : 'leftContent'], '');
            }
            assert.doesNotThrow(() => parseChangeTourManifest(manifest));
        }
    } finally { f.dispose(); }
});

test('base-side symbol anchors retain their original path through a Git rename', () => {
    const f = fixture();
    try {
        const git = (...args) => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' }).trim();
        git('mv', 'src/outline.py', 'src/renamed.py');
        git('commit', '-m', 'Rename outline');
        f.range.headOid = git('rev-parse', 'HEAD');
        f.input.artifact.range = f.range;
        for (const entry of [...f.input.artifact.symbols.after, ...f.input.artifact.documents.after]) {
            if (entry.path === 'src/outline.py') entry.path = 'src/renamed.py';
        }
        fs.writeFileSync(path.join(f.root, 'symbols.json'), JSON.stringify(f.input.artifact));
        f.source.range.head = f.range.headOid;
        f.source.anchors.moved = { file: 'src/outline.py', revision: 'base', contains: 'def prior_only()' };
        f.source.chapters[0].scenes[0].steps[0].symbol = { symbol: 'before-prior_only' };
        const compiled = step(compile(f));
        assert.equal(compiled.diff.path, 'src/renamed.py');
        assert.equal(compiled.diff.previousPath, 'src/outline.py');
        assert.equal(compiled.focus.path, 'src/outline.py');
        assert.equal(compiled.symbol.before.path, 'src/outline.py');
    } finally { f.dispose(); }
});
