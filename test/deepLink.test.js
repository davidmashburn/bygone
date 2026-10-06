const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseDeepLink, serializeDeepLink, serializeDocumentFragment, parseDocumentFragment, resolveDocumentFocus } = require('../out/deepLink');
const { resolveLocalDeepLink } = require('../out/deepLinkResolver');
const { buildManifestForTourSource } = require('../cli/tourFile');
const { exportFixture } = require('./exportFixture');

test('link codec roundtrips ordered pinned comparisons and Unicode document targets', () => {
    const repo = pathToFileURL('/tmp/a b/ö').href;
    const link = { kind: 'compare', repo, revisions: ['a'.repeat(40), 'b'.repeat(40)], file: 'a b/ö.txt', revision: 'b'.repeat(40), line: 2 };
    assert.deepEqual(parseDeepLink(serializeDeepLink(link)), link);
    for (const focus of [{ part: 'title' }, { part: 'chapter', chapter: 'ö' }, { part: 'scene', scene: 'scene' }, { part: 'step', scene: 'scene', step: '2' }]) {
        const tour = { kind: 'tour', repo, tour: 'tours/test.bygone', mode: 'historical', focus };
        assert.deepEqual(parseDeepLink(serializeDeepLink(tour)), tour);
        assert.deepEqual(parseDocumentFragment(serializeDocumentFragment(tour.mode, focus)), { mode: tour.mode, focus });
    }
    const valid = serializeDeepLink(link);
    for (const bad of [valid + '&kind=compare', valid + '&unknown=1', valid.replace('/v1', '/v2'), valid.replace('a'.repeat(40), 'HEAD'), valid.replace('line=2', 'line=-1'), valid.replace('line=2', 'line=Infinity'), valid.replace('file=a+b%2F%C3%B6.txt', 'file=..%2Fsecret'), valid + '%', valid + '#step']) assert.throws(() => parseDeepLink(bad), bad);
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=title&scene=x'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=title&part=title'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=chapter&chapter=%'));
    assert.throws(() => parseDocumentFragment('#location=1&mode=historical&part=review&review=note'));
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
