const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseDeepLink, serializeDeepLink, serializeDocumentFragment, parseDocumentFragment, resolveDocumentFocus } = require('../out/deepLink');
const { resolveLocalDeepLink } = require('../out/deepLinkResolver');
const { buildManifestForTourSource } = require('../cli/tourFile');
const { exportFixture } = require('./exportFixture');
const { startPresentation } = require('../cli/present');

test('link codec roundtrips ordered pinned comparisons and Unicode document targets', () => {
    const repo = pathToFileURL('/tmp/a b/ö').href;
    const link = { kind: 'compare', repo, revisions: ['a'.repeat(40), 'b'.repeat(40)], file: 'a b/ö.txt', revision: 'b'.repeat(40), line: 2 };
    assert.deepEqual(parseDeepLink(serializeDeepLink(link)), link);
    for (const focus of [{ part: 'title' }, { part: 'chapter', chapter: 'ö' }, { part: 'scene', scene: 'scene' }, { part: 'step', scene: 'scene', step: '2' }]) {
        const tour = { kind: 'tour', repo, tour: 'tours/test.bygone', mode: 'historical', focus };
        assert.deepEqual(parseDeepLink(serializeDeepLink(tour)), tour);
        const external = { ...tour, tour: pathToFileURL('/tmp/reviews/a b # ö.bygone.yaml').href };
        assert.deepEqual(parseDeepLink(serializeDeepLink(external)), external);
        assert.deepEqual(parseDocumentFragment(serializeDocumentFragment(tour.mode, focus)), { mode: tour.mode, focus });
    }
    const valid = serializeDeepLink(link);
    for (const bad of [valid + '&kind=compare', valid + '&unknown=1', valid.replace('/v1', '/v2'), valid.replace('a'.repeat(40), 'HEAD'), valid.replace('line=2', 'line=-1'), valid.replace('line=2', 'line=Infinity'), valid.replace('file=a+b%2F%C3%B6.txt', 'file=..%2Fsecret'), valid + '%', valid + '#step']) assert.throws(() => parseDeepLink(bad), bad);
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=title&scene=x'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=title&part=title'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=chapter&chapter=%'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=review&review=note'));
});

test('tour links reject remote URLs and relative traversal', () => {
    const link = { kind: 'tour', repo: 'file:///tmp/repo', mode: 'historical', focus: { part: 'title' } };
    for (const tour of ['https://example.com/tour.bygone', 'file://server/share/tour.bygone', 'file:///tmp/tour?query',
        'file:///tmp/tour#fragment', '../tour.bygone', '/tmp/tour.bygone', 'C:\\reviews\\tour.bygone']) {
        assert.throws(() => serializeDeepLink({ ...link, tour }), tour);
    }
});

test('outside-repository tour links reopen the same saved document and section after the server closes', async () => {
    const fixture = exportFixture();
    const reviews = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-reviews-')));
    const documentPath = path.join(reviews, 'a b # ö.bygone.yaml');
    const options = { announce: false, open: false, ignoreEnvironment: true };
    const packageRoot = path.resolve(__dirname, '..');
    let presentation;
    try {
        fs.copyFileSync(fixture.sourcePath, documentPath);
        // A repo-local symlink must also produce an explicit external file binding.
        const alias = path.join(fixture.root, 'alias.bygone');
        fs.symlinkSync(documentPath, alias);
        presentation = await startPresentation(['--tour', alias], fixture.root, packageRoot, options);
        assert.deepEqual(presentation.manifest.localSource, {
            repo: pathToFileURL(fixture.root).href, tour: pathToFileURL(documentPath).href
        });
        const focus = { part: 'step', scene: 'scene', step: 'step' };
        const value = serializeDeepLink({ kind: 'tour', ...presentation.manifest.localSource, mode: 'historical', focus });
        await new Promise(resolve => presentation.server.close(resolve));
        presentation = undefined;
        const resolved = resolveLocalDeepLink(value);
        assert.equal(resolved.documentPath, documentPath);
        assert.equal(resolved.repoRoot, fixture.root);
        const location = { mode: resolved.link.mode, focus: resolved.link.focus };
        presentation = await startPresentation(['--tour', resolved.documentPath], resolved.repoRoot, packageRoot, { ...options, location });
        assert.equal(presentation.sourcePath, documentPath);
        assert.equal(presentation.manifest.range.headOid, fixture.head);
        assert.equal(resolveDocumentFocus(presentation.manifest, location.mode, location.focus).key, 'step:scene:step');
        await assert.rejects(startPresentation(['--tour', documentPath], fixture.root, packageRoot,
            { ...options, location: { ...location, focus: { ...focus, step: 'gone' } } }), /unavailable/);
        assert.throws(() => resolveLocalDeepLink(serializeDeepLink({ ...resolved.link, tour: pathToFileURL(reviews).href })), /not a file/);
        fs.unlinkSync(documentPath);
        assert.throws(() => resolveLocalDeepLink(value), /ENOENT/);
    } finally {
        if (presentation) await new Promise(resolve => presentation.server.close(resolve));
        fixture.dispose();
        fs.rmSync(reviews, { recursive: true, force: true });
    }
});

test('local resolution checks exact worktree, containment, commits and lines before opening', () => {
    const fixture = exportFixture();
    try {
        const repo = pathToFileURL(fixture.root).href;
        const tour = { kind: 'tour', repo, tour: 'test.bygone', mode: 'historical', focus: { part: 'step', scene: 'scene', step: 'step' } };
        assert.equal(resolveLocalDeepLink(serializeDeepLink(tour)).documentPath, fixture.sourcePath);
        const manifest = buildManifestForTourSource(fixture.root, fixture.source);
        assert.equal(resolveDocumentFocus(manifest, 'historical', tour.focus).key, 'step:scene:step');
        assert.equal(resolveDocumentFocus(manifest, 'historical', { part: 'chapter', chapter: 'chapter' }).key, 'chapter:chapter');
        assert.throws(() => resolveDocumentFocus(manifest, 'deconstructed', tour.focus), /unavailable/);
        assert.throws(() => resolveDocumentFocus(manifest, 'historical', { ...tour.focus, step: 'gone' }), /unavailable/);
        const compare = { kind: 'compare', repo, revisions: [fixture.base, fixture.head], file: 'app.txt', revision: fixture.head, line: 2 };
        const before = fixture.git('status', '--porcelain');
        assert.equal(resolveLocalDeepLink(serializeDeepLink(compare)).repoRoot, fixture.root);
        assert.throws(() => resolveLocalDeepLink(serializeDeepLink({ ...compare, line: 999 })), /outside/);
        assert.throws(() => resolveLocalDeepLink(serializeDeepLink({ ...compare, file: 'binary.dat' })), /Binary/);
        assert.throws(() => resolveLocalDeepLink(serializeDeepLink({ ...compare, revisions: [fixture.base, 'f'.repeat(40)], revision: undefined, line: undefined })));
        fs.symlinkSync(__filename, path.join(fixture.root, 'outside.bygone'));
        assert.throws(() => resolveLocalDeepLink(serializeDeepLink({ ...tour, tour: 'outside.bygone' })), /outside/);
        fs.unlinkSync(path.join(fixture.root, 'outside.bygone'));
        assert.equal(fixture.git('status', '--porcelain'), before, 'No repository mutation');
    } finally { fixture.dispose(); }
});
