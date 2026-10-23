const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportFixture } = require('./exportFixture');
const { startPresentation } = require('../cli/present');

test('presentation serves asset bytes and reports read failures before sending success headers', async () => {
    const fixture = exportFixture();
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-presentation-assets-'));
    let presentation;
    try {
        fs.mkdirSync(path.join(packageRoot, 'web'));
        fs.mkdirSync(path.join(packageRoot, 'media'));
        fs.writeFileSync(path.join(packageRoot, 'web/index.html'), '<title>Bygone Tour</title>');
        const content = Buffer.from([0, 1, 2, 127, 128, 255]);
        fs.writeFileSync(path.join(packageRoot, 'media/webview.js'), content);
        // This passes existence checks but fails when read, without relying on
        // filesystem permissions (which behave differently when tests run as root).
        fs.mkdirSync(path.join(packageRoot, 'web/unreadable.css'));
        presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, packageRoot,
            { announce: false, open: false, ignoreEnvironment: true });
        const initialPage = await fetch(presentation.url);
        assert.equal(initialPage.headers.get('cache-control'), 'no-store');
        assert.doesNotMatch(await initialPage.text(), /correspondence-unmatched/);
        fs.writeFileSync(path.join(packageRoot, 'web/index.html'), '<title>Bygone Tour</title><input id="correspondence-unmatched" type="checkbox" checked>');
        const rebuiltPage = await fetch(presentation.url);
        assert.match(await rebuiltPage.text(), /id="correspondence-unmatched"/);
        fs.unlinkSync(path.join(packageRoot, 'web/index.html'));
        const missingPage = await fetch(presentation.url);
        assert.equal(missingPage.status, 500);
        assert.equal(await missingPage.text(), 'Read failed');
        const asset = await fetch(new URL('/media/webview.js', presentation.url));
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('content-type'), /application\/javascript/);
        assert.equal(asset.headers.get('cache-control'), 'no-store');
        assert.deepEqual(Buffer.from(await asset.arrayBuffer()), content);
        const unreadable = await fetch(new URL('/web/unreadable.css', presentation.url));
        assert.equal(unreadable.status, 500);
        assert.match(unreadable.headers.get('content-type'), /text\/plain/);
        assert.equal(await unreadable.text(), 'Read failed');
        const missing = await fetch(new URL('/media/missing.js', presentation.url));
        assert.equal(missing.status, 404);
        await missing.text();
        const manifest = await fetch(new URL('/tour.json', presentation.url));
        assert.equal((await manifest.json()).range.headOid, fixture.head);
    } finally {
        if (presentation) await new Promise(resolve => presentation.server.close(resolve));
        fixture.dispose();
        fs.rmSync(packageRoot, { recursive: true, force: true });
    }
});
