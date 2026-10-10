/* global require, module, console */
const assert = require('node:assert/strict');
const { buildTwoWayDiffModel } = require('../out/diffEngine');

async function runGutterCopySmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 200))');
    const values = () => evaluate('window.monaco.editor.getEditors().map(e => e.getValue())');
    const hidden = () => evaluate("document.querySelector('.gutter-copy-controls').hidden");
    const render = async (left, right, editable = [true, true], multi = true) => {
        await evaluate("document.getElementById('diff-container').dispatchEvent(new PointerEvent('pointerleave'))");
        const diffModel = buildTwoWayDiffModel(left, right);
        await show(multi ? { type: 'showMultiDiff', panels: [left, right].map((content, i) => ({
            id: `gutter-${i}`, label: `${i}.txt`, content, editable: editable[i]
        })), pairs: [{leftIndex: 0, rightIndex: 1, diffModel}], activePanelId: 'gutter-0' }
            : { type: 'showDiff', file1: 'left.txt', file2: 'right.txt', leftContent: left, rightContent: right,
                diffModel, editableSides: {left: editable[0], right: editable[1]} });
        return diffModel;
    };
    // Match the connector's midpoint, including collapsed insertion/deletion edges.
    const hover = async block => evaluate(`(() => {
        const editors = window.monaco.editor.getEditors();
        const rects = editors.map(e => e.getDomNode().getBoundingClientRect());
        const block = ${JSON.stringify(block)};
        const center = (i, start, end) => {
            const e = editors[i];
            if (start === end) return rects[i].top + e.getTopForLineNumber(start + 1) - e.getScrollTop();
            return rects[i].top + (e.getTopForLineNumber(start + 1) + e.getBottomForLineNumber(end)) / 2 - e.getScrollTop();
        };
        document.getElementById('diff-container').dispatchEvent(new PointerEvent('pointermove', {
            clientX: (rects[0].right + rects[1].left) / 2,
            clientY: (center(0, block.leftStart, block.leftEnd) + center(1, block.rightStart, block.rightEnd)) / 2
        }));
        return !document.querySelector('.gutter-copy-controls').hidden;
    })()`);
    const click = async direction => evaluate(`document.querySelector('[data-gutter-copy="${direction}"]').click()`);
    const buttonRects = () => evaluate("[...document.querySelectorAll('[data-gutter-copy]')].map(b => { const r = b.getBoundingClientRect(); return {x:r.x,y:r.y}; })");
    const hoverLine = (side, line) => evaluate(`(() => {
        const editor = window.monaco.editor.getEditors()[${side}];
        const rect = editor.getDomNode().getBoundingClientRect();
        document.getElementById('diff-container').dispatchEvent(new PointerEvent('pointermove', {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + editor.getTopForLineNumber(${line}) - editor.getScrollTop() + 8
        }));
    })()`);
    const left = 'old first\nkeep\nold second\nend';
    const right = 'new first\nkeep\nnew second\nend';
    for (const multi of [true, false]) {
        const model = await render(left, right, [true, true], multi);
        assert.equal(await hidden(), true, 'No arrows at rest');
        assert.equal(await evaluate("document.querySelectorAll('#copy-left-to-right,#copy-right-to-left').length"), 0);
        assert.equal(await hover(model.blocks[1]), true, `Hover reveals arrows synchronously (${multi ? 'multi' : 'two'}): ${JSON.stringify(await evaluate("window.monaco.editor.getEditors().map(e => ({rect:e.getDomNode().getBoundingClientRect().toJSON(), scroll:e.getScrollTop()}))"))}`);
        await click('left-to-right');
        assert.deepEqual(await values(), [left, 'new first\nkeep\nold second\nend'], 'Copy hovered block, not selected first block');
        assert.equal(await hidden(), true, 'Arrows dismiss after copying');
        await evaluate('window.monaco.editor.getEditors()[1].getModel().undo()');
        assert.deepEqual(await values(), [left, right], 'One undo restores the copied change');

        await render(left, right, [true, true], multi);
        for (const side of [0, 1]) {
            await evaluate(`(() => {
                const editor = window.monaco.editor.getEditors()[${side}];
                editor.focus();
                editor.setPosition({lineNumber:2,column:1});
                editor.trigger('keyboard', 'cursorDown', {});
            })()`);
            await settle();
            assert.equal(await hidden(), false, 'Keyboard cursor in either side reveals arrows');
            await evaluate("document.getElementById('diff-container').dispatchEvent(new PointerEvent('pointerleave'))");
            assert.equal(await hidden(), false, 'Cursor-selected arrows survive mouse leaving');
            await evaluate(`window.monaco.editor.getEditors()[${side}].trigger('keyboard', 'cursorUp', {})`);
            await settle();
            assert.equal(await hidden(), true, 'Cursor in matching context dismisses arrows');
        }
        await evaluate("document.getElementById('previous-change').click()");
        await settle();
        assert.equal(await hidden(), false, 'Jump to previous change reveals arrows');
        await evaluate("document.getElementById('next-change').click()");
        await settle();
        assert.equal(await hidden(), false, 'Jump to next change reveals arrows');
        await click('right-to-left');
        assert.deepEqual(await values(), ['old first\nkeep\nnew second\nend', right], 'Jump arrows copy the jumped-to block');

        await render('keep\nold a\nold b\nold c\nend', 'keep\nnew a\nnew b\nnew c\nend', [true,true], multi);
        await hoverLine(0, 2);
        assert.equal(await hidden(), false, 'Hovering source text reveals arrows');
        const anchored = await buttonRects();
        assert.ok(anchored[0].x < anchored[1].x, 'Each arrow stays on its source side');
        await hoverLine(0, 4);
        assert.deepEqual(await buttonRects(), anchored, 'Arrows do not track pointer vertically');
        await hoverLine(1, 3);
        assert.equal(await hidden(), false, 'Hovering opposite text reveals arrows');
        assert.deepEqual(await buttonRects(), anchored, 'Both sides reveal the same anchored controls');
    }
    for (const direction of ['left-to-right', 'right-to-left']) {
        for (const pair of [['keep\nend', 'keep\ninserted\nend'], ['keep\ndeleted\nend', 'keep\nend']]) {
            const model = await render(...pair);
            assert.equal(await hover(model.blocks[0]), true);
            await click(direction);
            const expected = pair[direction === 'left-to-right' ? 0 : 1];
            assert.deepEqual(await values(), [expected, expected], 'Insert/delete copies in either direction');
        }
    }
    let model = await render(left, right, [false, true]);
    await hover(model.blocks[0]);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-gutter-copy]')].map(b => b.dataset.gutterCopy)"), ['left-to-right', 'right-to-left'], 'Arrows face each other');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-gutter-copy]')].map(b => b.disabled)"), [false, true]);
    await click('right-to-left');
    assert.deepEqual(await values(), [left, right], 'Read-only target cannot change');
    model = await render(left, right, [false, false]);
    assert.equal(await hover(model.blocks[0]), false, 'No copy controls for two read-only panels');
    model = await render(left, right);
    await hover(model.blocks[0]);
    await evaluate("document.querySelector('[data-gutter-copy]').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    assert.equal(await hidden(), true, 'Escape dismisses the arrows');
    await hover(model.blocks[0]);
    await evaluate("document.getElementById('diff-container').dispatchEvent(new PointerEvent('pointerleave'))");
    assert.equal(await hidden(), true, 'Leaving the gutter hides controls');
    await hover(model.blocks[0]);
    await evaluate("window.monaco.editor.getEditors()[0].executeEdits('test', [{range: new window.monaco.Range(1,1,1,1),text:'changed '}])");
    assert.equal(await hover(model.blocks[0]), false, 'Stale blocks are unavailable during recomputation');
    await settle();
    const tail = '\n' + Array.from({length: 100}, (_, i) => `unchanged ${i}`).join('\n');
    model = await render(left + tail, right + tail);
    await hover(model.blocks[0]);
    await evaluate('window.monaco.editor.getEditors()[0].setScrollTop(800)');
    await settle();
    assert.equal(await hidden(), true, 'Scrolling the block away hides the arrows');
    await render(left, right);
    await evaluate("document.querySelector('[data-panel-id=\"gutter-0\"][data-multi-panel-copy=\"left-to-right\"]').click()");
    assert.deepEqual(await values(), [left, 'old first\nkeep\nnew second\nend'], 'Panel copy controls still work');
    console.log('Gutter copy smoke passed: fixed source placement, text/gutter hover, keyboard cursor, change navigation, exact block, both directions, insert/delete, undo, read-only, stale diffs, scrolling and panel controls.');
}

module.exports = { runGutterCopySmoke };
