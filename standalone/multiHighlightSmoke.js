/* global require, module, console */
const assert = require('node:assert/strict');
const { buildTwoWayDiffModel } = require('../out/diffEngine');

async function runMultiHighlightSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const contents = [
        '# Workshop\n\nBring red paper and small brushes.\nKeep this paragraph unchanged.\nPack old boxes.\n\n## Schedule\nStart early.\nEnd together.',
        '# Workshop\n\nBring blue paper and small brushes.\nKeep this paragraph unchanged.\nPack new boxes.\n\n## Schedule\nStart early.\nEnd together.\nExtra note.',
        '# Workshop\n\nBring blue paper and large brushes.\nKeep this paragraph unchanged.\nPack new crates.\n\n## Schedule\nStart later.\nEnd together.\nExtra details.',
        '# Workshop\n\nBring blue paper and large brushes.\nKeep this paragraph unchanged.\nPack new crates.\n\n## Schedule\nStart later.\nEnd together.\nExtra details.'
    ];
    const panels = contents.map((content, i) => ({ id: `paint-${i}`, label: `${i}.md`, content, editable: false }));
    const pairs = contents.slice(1).map((content, i) => ({ leftIndex: i, rightIndex: i + 1,
        diffModel: buildTwoWayDiffModel(contents[i], content) }));
    const paint = () => evaluate(`window.monaco.editor.getEditors().map(e => e.getModel().getAllDecorations()
        .filter(d => /bygone-(paired|inline-blue|one-sided)/.test([d.options.className, d.options.inlineClassName, d.options.blockClassName].join(' ')))
        .map(d => ({range:d.range, options:{className:d.options.className, inlineClassName:d.options.inlineClassName, blockClassName:d.options.blockClassName}})))`);
    async function assertPaint(selected = null) {
        const actual = await paint();
        for (let index = 0; index < panels.length; index++) {
            const expectedWords = new Set(), expectedLines = new Map();
            for (const [pairIndex, pair] of pairs.entries()) {
                if (selected !== null && pairIndex !== selected) continue;
                const side = index === pair.leftIndex ? 'left' : index === pair.rightIndex ? 'right' : null;
                if (!side) continue;
                for (const block of pair.diffModel.blocks) {
                    for (let line = block[`${side}Start`] + 1; line <= block[`${side}End`]; line++) {
                        if (block.kind === 'replace' || !expectedLines.has(line)) {
                            expectedLines.set(line, block.kind === 'replace' ? 'blue' : 'green');
                        }
                    }
                }
                for (const line of pair.diffModel[`${side}Lines`]) {
                    let column = 1;
                    for (const segment of line.segments || []) {
                        if (segment.emphasis && segment.kind === (side === 'left' ? 'removed' : 'added')) {
                            for (let c = column; c < column + segment.text.length; c++) expectedWords.add(`${line.lineNumber}:${c}`);
                        }
                        column += segment.text.length;
                    }
                }
            }
            const words = new Set(), lines = new Map();
            for (const { range: r, options: o } of actual[index]) {
                if (o.inlineClassName === 'bygone-inline-blue') {
                    for (let c = r.startColumn; c < r.endColumn; c++) {
                        const key = `${r.startLineNumber}:${c}`;
                        assert.ok(!words.has(key), 'Overlapping words are painted once');
                        words.add(key);
                    }
                }
                if (['bygone-paired-line', 'bygone-one-sided-line'].includes(o.className)) {
                    for (let line = r.startLineNumber; line <= r.endLineNumber; line++) {
                        assert.ok(!lines.has(line), 'Overlapping lines are painted once');
                        lines.set(line, o.className === 'bygone-paired-line' ? 'blue' : 'green');
                    }
                }
            }
            assert.deepEqual([...words].sort(), [...expectedWords].sort(), `Panel ${index} word ownership (focus ${selected})`);
            assert.deepEqual([...lines].sort(), [...expectedLines].sort(), `Panel ${index} block ownership (focus ${selected})`);
        }
    }
    const gutterPixels = () => evaluate(`(() => {
        const canvas = document.querySelector('#connection-canvas'), bounds = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        const rects = window.monaco.editor.getEditors().map(e => e.getDomNode().getBoundingClientRect());
        return rects.slice(1).map((r, i) => {
            const x = Math.floor((rects[i].right + r.left) / 2 - bounds.left);
            const top = Math.ceil(Math.max(rects[i].top, r.top) - bounds.top);
            const height = Math.floor(Math.min(rects[i].bottom, r.bottom) - bounds.top) - top;
            if (x < 0 || x >= canvas.width || height <= 0) return 0;
            const pixels = ctx.getImageData(x, top, 1, height).data;
            return Array.from(pixels).filter((v, n) => n % 4 === 3 && v > 0).length;
        });
    })()`);
    const choosePair = async index => {
        await evaluate(`document.querySelector('[data-pair-index="${index}"].multi-gutter').click()`);
        await settle();
    };
    const toggle = async () => {
        await evaluate("document.querySelector('#toggle-pair-focus').click()");
        await settle();
    };
    await show({ type: 'showMultiDiff', panels, pairs, activePairIndex: 0, activePanelId: panels[0].id });
    assert.equal(await evaluate("document.querySelector('#toggle-pair-focus').getAttribute('aria-pressed')"), 'false');
    // Four visible panes exercise a shared panel and an identical neighboring pair.
    await evaluate(`{ const picker = document.querySelector('[data-multi-visible-count]');
        picker.value = '4'; picker.dispatchEvent(new Event('change', {bubbles:true})); }`);
    await evaluate('new Promise(resolve => setTimeout(resolve, 250))');
    await assertPaint();
    const pixels = await gutterPixels();
    assert.ok(pixels[0] > 0 && pixels[1] > 0 && pixels[2] === 0, `Union connectors: ${pixels}`);
    for (const pairIndex of [0, 1, 2]) {
        await choosePair(pairIndex);
        const state = () => evaluate('window.monaco.editor.getEditors().map(e => ({uri:e.getModel().uri.toString(), scroll:e.getScrollTop(), value:e.getValue()}))');
        const before = await state();
        await toggle();
        assert.deepEqual(await state(), before, 'Focusing preserves models, source and scroll');
        await assertPaint(pairIndex);
        const focusedPixels = await gutterPixels();
        for (let i = 0; i < pairs.length; i++) {
            assert.equal(focusedPixels[i] > 0, i === pairIndex && pairs[i].diffModel.blocks.length > 0, `Focused connector ${i}`);
        }
        for (let change = 0; change < pairs[pairIndex].diffModel.blocks.length + 1; change++) {
            await evaluate("document.querySelector('#next-change').click()");
            await settle();
            assert.equal(await evaluate("Number(document.querySelector('.multi-gutter.is-active-pair').dataset.pairIndex)"), pairIndex,
                'Change navigation stays with the selected pair');
        }
        await toggle();
        await assertPaint();
    }
    await toggle();
    await choosePair(0);
    await assertPaint(0);
    await choosePair(1);
    await assertPaint(1);
    assert.equal(await evaluate("document.querySelector('#toggle-pair-focus').getAttribute('aria-pressed')"), 'true', 'Pair switches retain focus');
    await toggle();
    // Added/deleted empty files exercise coincident collapsed boundaries and
    // identical whole-line paint arriving from opposite sides of a shared pane.
    const emptyPanels = ['', 'new entry', ''].map((content, i) => ({id:`empty-${i}`,label:`${i}.md`,content,editable:false}));
    await show({type:'showMultiDiff', panels:emptyPanels, activePairIndex:0, activePanelId:'empty-0',
        pairs:emptyPanels.slice(1).map((p,i)=>({leftIndex:i,rightIndex:i+1,
            diffModel:buildTwoWayDiffModel(emptyPanels[i].content,p.content)}))});
    const emptyPaint = await paint();
    assert.equal(emptyPaint[1].filter(d=>d.options.className==='bygone-one-sided-line').length,1);
    for (const index of [0,2]) assert.ok(emptyPaint[index].some(d=>d.options.blockClassName==='bygone-one-sided-boundary-top'));
    const greenGutters = await evaluate(`(() => {
        const canvas = document.querySelector('#connection-canvas'), bounds = canvas.getBoundingClientRect();
        const ctx = canvas.getContext('2d');
        const rects = window.monaco.editor.getEditors().map(e => e.getDomNode().getBoundingClientRect());
        return rects.slice(1).map((r, i) => {
            const x = Math.floor((rects[i].right + r.left) / 2 - bounds.left);
            const pixels = ctx.getImageData(x, 0, 1, canvas.height).data;
            let green = 0, blue = 0;
            for (let p = 0; p < pixels.length; p += 4) {
                if (!pixels[p + 3]) continue;
                if (pixels[p + 1] > pixels[p + 2]) green++;
                if (pixels[p + 2] > pixels[p + 1]) blue++;
            }
            return {green, blue};
        });
    })()`);
    assert.ok(greenGutters.every(g => g.green > 0 && g.blue === 0), 'Insert and delete connectors remain green');
    await toggle();
    assert.equal((await paint())[2].length,0, 'Focus removes the other pair’s empty-file boundary');
    await choosePair(1);
    assert.equal((await paint())[0].length,0);
    await toggle();
    await show({ type: 'showDiff', file1: 'before.md', file2: 'after.md', leftContent: 'unchanged', rightContent: 'new\nunchanged' });
    assert.equal(await evaluate("document.querySelector('#toggle-pair-focus').hidden"), true);
    assert.equal(await evaluate("window.monaco.editor.getEditors()[1].getModel().getAllDecorations().some(d => d.options.className === 'bygone-one-sided-line')"), true,
        'Two-way one-sided changes keep their existing color');
    console.log('Multi-panel union/focus paint, connectors and navigation passed');
}
module.exports = { runMultiHighlightSmoke };
