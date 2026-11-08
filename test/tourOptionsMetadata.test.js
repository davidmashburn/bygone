const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const Ajv = require('ajv/dist/2020');
const {
    parseChangeTourSource,
    parseChangeTourManifest,
    buildChangeTourManifest
} = require('../out/changeTour');
const { materializeTour } = require('../cli/tourExport');
const { buildManifestForTourSource } = require('../cli/tourFile');
const { startPresentation } = require('../cli/present');
const { exportFixture } = require('./exportFixture');

const validateSchema = new Ajv({ strict: false, allErrors: true })
    .compile(require('../schemas/change-tour-source.schema.json'));
const clone = value => JSON.parse(JSON.stringify(value));

test('v8 coverage compilation keeps optional range defaults and partial CLI overrides', () => {
    const fixture = exportFixture();
    try {
        fixture.git('checkout', '-b', 'feature-review');
        fixture.git('branch', '-f', 'main', fixture.base);
        const source = clone(fixture.source);
        source.version = 8;
        delete source.range;
        delete source.tours;
        for (const coverage of ['key-changes', 'complete']) {
            source.options = { ...options, coverage };
            for (const overrides of [{}, { baseRef: 'export-base' }, { headRef: 'export-head' }]) {
                const manifest = buildManifestForTourSource(fixture.root, source, overrides);
                assert.equal(manifest.range.mergeBaseOid, fixture.base);
                assert.equal(manifest.range.headOid, fixture.head);
                assert.equal(manifest.range.baseRef, overrides.baseRef || 'main');
                assert.equal(manifest.range.headRef, overrides.headRef || 'HEAD');
                assert.doesNotThrow(() => parseChangeTourManifest(manifest));
                if (coverage === 'complete') {
                    assert.equal(manifest.authoringCoverage.complete.tour.range.baseOid, fixture.base);
                    assert.equal(manifest.authoringCoverage.complete.tour.range.headOid, fixture.head);
                }
            }
        }
        assert.equal(source.range, undefined, 'Compilation must not mutate the source.');
    } finally { fixture.dispose(); }
});

test('presenting v7 and v8 sources without a range uses the resolved comparison', async () => {
    const fixture = exportFixture();
    let presentation;
    try {
        fixture.git('checkout', '-b', 'feature-review');
        fixture.git('branch', '-f', 'main', fixture.base);
        const source = clone(fixture.source);
        delete source.range;
        delete source.tours;
        for (const version of [7, 8]) {
            source.version = version;
            fs.writeFileSync(fixture.sourcePath, JSON.stringify(source));
            for (const overrides of [[], ['--base', 'export-base'], ['export-head']]) {
                presentation = await startPresentation(['--tour', fixture.sourcePath, ...overrides], fixture.root,
                    path.resolve(__dirname, '..'), { announce: false, open: false, ignoreEnvironment: true });
                const manifest = await (await fetch(new URL('/tour.json', presentation.url))).json();
                assert.equal(manifest.range.mergeBaseOid, fixture.base);
                assert.equal(manifest.range.headOid, fixture.head);
                assert.doesNotThrow(() => parseChangeTourManifest(manifest));
                await new Promise(resolve => presentation.server.close(resolve));
                presentation = undefined;
            }
        }
    } finally {
        if (presentation) await new Promise(resolve => presentation.server.close(resolve));
        fixture.dispose();
    }
});

const options = {
    style: 'historical',
    depth: 'deep',
    audience: 'peer',
    familiarity: 'some',
    coverage: 'key-changes',
    emphasis: ['correctness', 'tests'],
    notes: 'Explain the real revisions and distinguish them from synthetic stages.',
    paths: ['app.txt'],
    inferred: ['audience']
};

function v8Source(fixture) {
    const source = clone(fixture.source);
    source.version = 8;
    source.author = { name: 'Ada Reviewer', url: 'https://example.test/ada' };
    source.generatedBy = { model: 'runtime-model', provider: 'runtime-provider', harness: 'bygone-test', effort: 'max' };
    source.options = clone(options);
    source.coverage = {
        exclusions: [{ path: 'large.txt', reason: 'The fixture intentionally exceeds the text limit.' }],
        accountedFiles: [
            { path: 'binary.dat', reason: 'Binary content is outside the textual walkthrough.' },
            { path: 'transient.txt', reason: 'The path disappears before the final endpoint.' }
        ]
    };
    source.tours.historical.options = { ...clone(options), style: 'historical', inferred: ['depth'] };
    source.tours.deconstructed.options = {
        ...clone(options), style: 'deconstructed', depth: 'guided', inferred: ['style', 'depth']
    };
    return source;
}

function assertSourceRejected(value, pattern) {
    assert.equal(validateSchema(value), false, JSON.stringify(validateSchema.errors));
    assert.throws(() => parseChangeTourSource(value), pattern);
}

test('v8 source metadata validates, compiles, parses, and exports without losing fields', () => {
    const fixture = exportFixture();
    try {
        const source = v8Source(fixture);
        assert.equal(validateSchema(source), true, JSON.stringify(validateSchema.errors));
        const parsed = parseChangeTourSource(source);
        assert.deepEqual(parsed.author, source.author);
        assert.deepEqual(parsed.options, source.options);
        assert.deepEqual(parsed.coverage, source.coverage);
        assert.deepEqual(parsed.tours.historical.options, source.tours.historical.options);
        assert.deepEqual(parsed.tours.deconstructed.options, source.tours.deconstructed.options);

        const manifest = buildChangeTourManifest(fixture.root, { source: parsed });
        assert.equal(manifest.version, 8);
        assert.deepEqual(manifest.author, source.author);
        assert.deepEqual(manifest.generatedBy, source.generatedBy);
        assert.deepEqual(manifest.options, source.options);
        assert.deepEqual(manifest.coverage, source.coverage);
        assert.deepEqual(manifest.tours.historical.options, source.tours.historical.options);
        assert.deepEqual(manifest.tours.deconstructed.options, source.tours.deconstructed.options);
        assert.deepEqual(parseChangeTourManifest(manifest).options, source.options);

        fs.writeFileSync(fixture.sourcePath, JSON.stringify(source));
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(fixture.sourcePath, profile);
            assert.equal(exported.manifest.version, 8);
            assert.deepEqual(exported.manifest.author, source.author);
            assert.deepEqual(exported.manifest.generatedBy, source.generatedBy);
            assert.deepEqual(exported.manifest.options, source.options);
            assert.deepEqual(exported.manifest.coverage, source.coverage);
            assert.deepEqual(exported.manifest.tours.historical.options, source.tours.historical.options);
            assert.deepEqual(exported.manifest.tours.deconstructed.options, source.tours.deconstructed.options);
        }
    } finally {
        fixture.dispose();
    }
});

test('v7 remains readable and every new metadata field is rejected before v8', () => {
    const fixture = exportFixture();
    try {
        const source = clone(fixture.source);
        source.version = 7;
        assert.equal(validateSchema(source), true, JSON.stringify(validateSchema.errors));
        assert.equal(parseChangeTourSource(source).version, 7);
        const manifest = buildChangeTourManifest(fixture.root, { source: parseChangeTourSource(source) });
        assert.equal(manifest.version, 7);
        assert.equal('author' in manifest, false);
        assert.equal('options' in manifest, false);

        const withOptions = clone(source);
        withOptions.options = clone(options);
        assertSourceRejected(withOptions, /options requires tour version 8/);

        const withAuthor = clone(source);
        withAuthor.author = { name: 'Ada' };
        assertSourceRejected(withAuthor, /author requires tour version 8/);

        const withProvider = clone(source);
        withProvider.generatedBy = { model: 'runtime-model', provider: 'runtime-provider' };
        assertSourceRejected(withProvider, /generatedBy\.provider requires tour version 8/);

        const withAccountedFiles = clone(source);
        withAccountedFiles.coverage = {
            exclusions: [],
            accountedFiles: [{ path: 'binary.dat', reason: 'Binary' }]
        };
        assertSourceRejected(withAccountedFiles, /accountedFiles requires tour version 8/);

        const manifestWithOptions = clone(manifest);
        manifestWithOptions.options = clone(options);
        assert.throws(() => parseChangeTourManifest(manifestWithOptions), /options requires tour version 8/);
        const manifestWithAuthor = clone(manifest);
        manifestWithAuthor.author = { name: 'Ada' };
        assert.throws(() => parseChangeTourManifest(manifestWithAuthor), /author requires tour version 8/);
    } finally {
        fixture.dispose();
    }
});

test('source and manifest reject malformed v8 metadata, including coverage duplicates', () => {
    const fixture = exportFixture();
    try {
        const source = v8Source(fixture);
        for (const [mutate, pattern] of [
            [value => { value.author.name = ' '; }, /author\.name/],
            [value => { value.author.url = 'ftp://example.test/ada'; }, /author\.url/],
            [value => { value.generatedBy.provider = ''; }, /generatedBy\.provider/],
            [value => { value.options.style = 'unsupported'; }, /options\.style/],
            [value => { value.options.inferred = ['audience', 'audience']; }, /options\.inferred/],
            [value => { value.options.paths = ['../secret']; }, /options\.paths/],
            [value => { value.coverage.accountedFiles[0].reason = ' '; }, /accountedFiles\[0\]\.reason/]
        ]) {
            const invalid = clone(source);
            mutate(invalid);
            assertSourceRejected(invalid, pattern);
        }
        for (const [mutate, pattern] of [
            [value => { value.coverage.accountedFiles[1].path = value.coverage.accountedFiles[0].path; }, /duplicate path/]
        ]) {
            const invalid = clone(source);
            mutate(invalid);
            assert.equal(validateSchema(invalid), true, 'JSON Schema cannot compare a single property across object items.');
            assert.throws(() => parseChangeTourSource(invalid), pattern);
        }
        const duplicateEntry = clone(source);
        duplicateEntry.coverage.accountedFiles.push(clone(duplicateEntry.coverage.accountedFiles[0]));
        assertSourceRejected(duplicateEntry, /duplicate path/);
        const sharedReason = clone(source);
        sharedReason.coverage.accountedFiles[1].reason = sharedReason.coverage.accountedFiles[0].reason;
        assert.doesNotThrow(() => parseChangeTourSource(sharedReason));

        const manifest = buildChangeTourManifest(fixture.root, { source: parseChangeTourSource(source) });
        for (const [mutate, pattern] of [
            [value => { value.author.name = ' '; }, /author\.name/],
            [value => { value.generatedBy.provider = ''; }, /generatedBy\.provider/],
            [value => { value.options.inferred = ['style', 'style']; }, /options\.inferred/],
            [value => { value.tours.historical.options.coverage = 'unsupported'; }, /tours\.historical\.options\.coverage/],
            [value => { value.coverage.accountedFiles[1].path = value.coverage.accountedFiles[0].path; }, /duplicate path/]
        ]) {
            const invalid = clone(manifest);
            mutate(invalid);
            assert.throws(() => parseChangeTourManifest(invalid), pattern);
        }
    } finally {
        fixture.dispose();
    }
});

const detailsModule = import('data:text/javascript;base64,' + Buffer.from(buildSync({
    entryPoints: [path.resolve(__dirname, '../web/tourDetails.js')], bundle: true, write: false, format: 'esm'
}).outputFiles[0].contents).toString('base64'));
function element(tag) {
    return { tag, dataset: {}, children: [], textContent: '', hidden: false,
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; }
    };
}
const visibleText = node => node.textContent + (node.children || []).map(visibleText).join('');
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];

test('details render v8 author, runtime, labels, inferred choices, scope, and notes safely', async () => {
    const { renderTourDetails } = await detailsModule;
    const previous = global.document;
    global.document = { createElement: element, createTextNode: value => ({ textContent: value }) };
    try {
        const host = element('section');
        renderTourDetails(host, {
            author: { name: '<img src=x onerror=alert(1)>', url: 'https://example.test/author' },
            generatedBy: { provider: 'Provider', model: 'Model', harness: 'Harness', effort: 'Effort' },
            options: {
                ...clone(options),
                notes: '<img src=x onerror=alert(1)> [unsafe](javascript:alert(1))'
            }
        });
        const rendered = visibleText(host);
        assert.match(rendered, /Human author/);
        assert.match(rendered, /Provider/);
        assert.match(rendered, /Deep dive/);
        assert.match(rendered, /Peer engineer \/ reviewer/);
        assert.match(rendered, /Inferred choices/);
        assert.match(rendered, /Audience: Peer engineer \/ reviewer/);
        assert.match(rendered, /app\.txt/);
        assert.match(rendered, /<img src=x onerror=alert\(1\)>/);
        assert.equal(descendants(host).some(node => node.tag === 'img'), false);
        assert.equal(descendants(host).some(node => node.tag === 'a'), false);

        renderTourDetails(host, { options: { ...clone(options), style: 'deconstructed', inferred: ['style'] } });
        assert.match(visibleText(host), /Deconstructed/);
        assert.match(visibleText(host), /Inferred choices/);
    } finally {
        global.document = previous;
    }
});
