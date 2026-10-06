const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
// The browser module is ESM; a data URL keeps this CommonJS test independent
// of build output and the package's module mode.
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [resolve(__dirname, '../media/tourProse.js')], bundle: true, write: false, format: 'esm' }).outputFiles[0].contents).toString('base64'));
const document = {
    createTextNode(text) { return { textContent: text }; },
    createElement(tag) {
        return { tag, dataset: {}, children: [], replaceChildren(...children) { this.children = children; } };
    }
};
const visibleText = (nodes) => nodes.map(n => n.children?.length ? visibleText(n.children) : n.textContent || '').join('');

test('renders the PLAT-695 link as a named clickable link', async () => {
    const { renderTourProse } = await modulePromise;
    const text = '[PLAT-695: Manage go-live: stop collection on Lucid](https://linear.app/swayable/issue/PLAT-695)';
    const nodes = renderTourProse(document, text);
    assert.equal(visibleText(nodes), 'PLAT-695: Manage go-live: stop collection on Lucid');
    assert.equal(nodes[0].tag, 'a');
    assert.equal(nodes[0].href, 'https://linear.app/swayable/issue/PLAT-695');
    assert.equal(nodes[0].target, '_blank');
    assert.equal(nodes[0].rel, 'noopener noreferrer');
});

test('keeps links clickable and labels intact across narration segments', async () => {
    const { renderTourProse } = await modulePromise;
    const text = 'See [the review](https://example.com/review), then continue.';
    const nodes = renderTourProse(document, text, [
        { id: 'one', startOffset: 0, endOffset: 9 },
        { id: 'two', startOffset: 9, endOffset: text.length }
    ]);
    assert.equal(visibleText(nodes), 'See the review, then continue.');
    const link = nodes.find(n => n.tag === 'a');
    assert.deepEqual(link.children.map(n => n.dataset.narrationSegmentId), ['one', 'two']);
    assert.equal(link.href, 'https://example.com/review');
});

test('supports multiple links and treats unsafe targets and HTML as text', async () => {
    const { renderTourProse } = await modulePromise;
    const text = '[one](https://example.com/1) / [two](http://example.com/2) <img onerror=alert(1)> [bad](javascript:alert(1))';
    const nodes = renderTourProse(document, text);
    assert.equal(nodes.filter(n => n.tag === 'a').length, 2);
    assert.equal(visibleText(nodes), 'one / two <img onerror=alert(1)> [bad](javascript:alert(1))');
});

test('the initial reading view and highlighted view share the renderer', () => {
    const host = readFileSync(resolve(__dirname, '../web/host.js'), 'utf8');
    assert.ok(host.includes("readingField.replaceChildren(...renderTourProse(document, text || ''))"));
    assert.ok(host.includes('renderTourProse(document, text, matchingSegments)'));
});

test('retains URL parentheses instead of silently truncating the destination', async () => {
    const { renderTourProse } = await modulePromise;
    const nodes = renderTourProse(document, '[reference](https://example.com/topic_(detail))');
    assert.equal(visibleText(nodes), 'reference');
    assert.equal(nodes[0].href, 'https://example.com/topic_(detail)');
});


test('renders validated Bygone links and leaves unsupported link payloads as text', async () => {
    const { renderTourProse } = await modulePromise;
    const { serializeDeepLink } = require('../out/deepLink');
    const link = serializeDeepLink({ kind: 'tour', repo: 'file:///tmp/repo', tour: 'tour.bygone', mode: 'historical', focus: { part: 'title' } });
    assert.equal(renderTourProse(document, `[Open tour](${link})`)[0].href, link);
    assert.equal(renderTourProse(document, '[Invalid](bygone://unknown/v9)')[0].tag, undefined);
});
