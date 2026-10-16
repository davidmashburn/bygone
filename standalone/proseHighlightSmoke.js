/* global require, module */
const assert = require('node:assert/strict');
const { buildTwoWayDiffModel } = require('../out/diffEngine');
const { proseDiffFixture } = require('../test/proseDiffFixture');

async function runProseHighlightSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const editors = 'window.monaco.editor.getEditors()';
    const fixture = proseDiffFixture();
    const contents = [fixture.before, fixture.feedback, fixture.revision].map(lines => lines.join('\n'));
    for (const count of [2, 3]) {
        await show(count === 2
            // Exercise the bundled worker, as well as host-supplied models below.
            ? { type: 'showDiff', file1: 'before.md', file2: 'feedback.md', leftContent: contents[0], rightContent: contents[1] }
            : { type: 'showMultiDiff', panels: contents.map((content, index) => ({ id: `prose-${index}`, label: `workshop-${index}.md`, content, editable: false })),
                pairs: contents.slice(1).map((content, index) => ({ leftIndex: index, rightIndex: index + 1, diffModel: buildTwoWayDiffModel(contents[index], content) })) });
        await evaluate(`${editors}.forEach(e => e.updateOptions({ wordWrap: 'on' }))`);
        await frames();
        const highlights = await evaluate(`${editors}.map(e => {
            const model = e.getModel();
            return model.getAllDecorations().filter(d => d.options.inlineClassName === 'bygone-inline-blue')
                .map(d => ({line: d.range.startLineNumber, text: model.getValueInRange(d.range)}));
        })`);
        for (const text of ['laminated', 'reserved benches', 'Monday']) {
            assert.ok(highlights[1].some(h => h.text.includes(text)), `Missing rendered highlight for ${text} in ${count} panes`);
        }
        if (count === 3) {
            for (const text of ['digital', 'orang', 'Tues']) {
                assert.ok(highlights[2].some(h => h.text.includes(text)), `Missing final-panel highlight for ${text}`);
            }
        }
        assert.equal(await evaluate(`${editors}.some(e => e.getModel().getAllDecorations()
            .some(d => d.options.linesDecorationsClassName === 'bygone-inline-omitted'))`), false,
        'Small prose fixtures must receive detailed highlighting');
        await evaluate(`${editors}[1].revealLineInCenter(3, 1)`);
        await frames();
        assert.equal(await evaluate(`Array.from(${editors}[1].getDomNode().querySelectorAll('.bygone-inline-blue'))
            .some(e => e.textContent.includes('laminated') && e.getBoundingClientRect().width > 0
                && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')`), true,
        'An insertion beyond the old paragraph limit must visibly paint');
    }
    const longLine = 'Workshop notes '.repeat(1500);
    for (const [leftContent, rightContent, explanation] of [
        [`${longLine}old`, `${longLine}new`, 'detailed word highlights unavailable'],
        ['Keep this line\n', 'Keep this line', 'final newline differs']
    ]) {
        await show({ type: 'showDiff', file1: 'before.txt', file2: 'after.txt', leftContent, rightContent });
        await evaluate(`${editors}.forEach(e => { e.updateOptions({ wordWrap: 'off' }); e.setScrollPosition({scrollTop: 0, scrollLeft: 0}); })`);
        await frames();
        assert.equal(await evaluate(`${editors}.every(e => e.getModel().getAllDecorations()
            .some(d => d.options.linesDecorationsClassName === 'bygone-inline-omitted'
                && d.options.linesDecorationsTooltip.includes(${JSON.stringify(explanation)})))`), true,
        'Changed lines without word paint must explain their marker');
        assert.equal(await evaluate(`${editors}.every(e => {
            const marker = e.getDomNode().querySelector('.bygone-inline-omitted');
            return marker && marker.getBoundingClientRect().width > 0
                && getComputedStyle(marker, '::before').content.includes('≠');
        })`), true, 'The missing-detail marker must be visible in both panes');
        assert.notEqual(await evaluate("document.querySelector('#change-position').textContent"), 'No changes');
        assert.equal(await evaluate(`${editors}.every(e => e.getModel().getAllDecorations()
            .some(d => d.options.className === 'bygone-uniform-line'))`), explanation.includes('unavailable'),
        'Only unavailable word detail receives the uniform fallback');
    }
    const versions = ['Bring copper badges to the north desk.', 'Leave violet ribbons at the south entrance.',
        'Leave violet ribbons at the west entrance.'];
    const panels = versions.map((content, i) => ({ id: `fallback-${i}`, label: `revision-${i}.txt`, content, editable: false }));
    await show({ type: 'showMultiDiff', panels, activePairIndex: 1,
        pairs: versions.slice(1).map((content, i) => ({ leftIndex: i, rightIndex: i + 1,
            diffModel: buildTwoWayDiffModel(versions[i], content, i === 0 ? { timeoutMs: -1 } : {}) })) });
    await frames();
    assert.equal(await evaluate(`(() => {
        const e = ${editors}[1], d = e.getModel().getAllDecorations();
        const fill = e.getDomNode().querySelector('.bygone-uniform-line');
        return d.filter(x => x.options.className === 'bygone-uniform-line').length === 1
            && !d.some(x => x.options.className === 'bygone-paired-line' || x.options.inlineClassName === 'bygone-inline-blue')
            && fill && fill.getBoundingClientRect().width > 0
            && getComputedStyle(fill).backgroundColor === 'rgba(79, 124, 255, 0.28)';
    })()`), true, 'Shared panel renders one uniform fill without inline or base fill stacking');
    await evaluate("document.querySelector('[data-pair-index=\"1\"].multi-gutter').click()");
    await evaluate("document.querySelector('#toggle-pair-focus').click()");
    await frames();
    assert.equal(await evaluate(`(() => {
        const d = ${editors}[1].getModel().getAllDecorations();
        return !d.some(x => x.options.className === 'bygone-uniform-line' || x.options.linesDecorationsClassName === 'bygone-inline-omitted')
            && d.some(x => x.options.inlineClassName === 'bygone-inline-blue');
    })()`), true, 'Focusing the detailed pair restores its word highlights and removes the unavailable marker');
    await evaluate("document.querySelector('#toggle-pair-focus').click()");
}

module.exports = { runProseHighlightSmoke };
