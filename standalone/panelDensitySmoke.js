/* global require, module, console */
const assert = require('node:assert/strict');
const { buildTwoWayDiffModel } = require('../out/diffEngine');

async function runPanelDensitySmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true).catch(error => {
        throw new Error(`Density script failed: ${code}\n${error.message}`);
    });
    const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 250))');
    const choose = async value => {
        await evaluate(`{ const picker = document.querySelector('[data-multi-visible-count]');
            picker.value = ${JSON.stringify(String(value))}; picker.dispatchEvent(new Event('change', {bubbles:true})); }`);
        await settle();
    };
    const read = () => evaluate(`({
        visible: [...document.querySelectorAll('.multi-pane')].filter(p => !p.inert).map(p => Number(p.dataset.index)),
        pair: Number(document.querySelector('.multi-gutter.is-active-pair').dataset.pairIndex),
        transform: document.querySelector('.multi-view-track').style.transform,
        fit: document.querySelector('[data-multi-strip-fit]').textContent,
        choice: document.querySelector('[data-multi-visible-count]').value,
        models: window.monaco.editor.getEditors().map(e => e.getModel().uri.toString())
    })`);
    const switchPair = async index => {
        await evaluate(`document.querySelectorAll('.multi-gutter')[${index}].click()`);
        await settle();
    };
    const savedBounds = window.getBounds();
    const savedPreference = await evaluate("localStorage.getItem('bygone.visiblePanels')");
    const panels = Array.from({ length: 6 }, (_, index) => ({ id: `density-${index}`,
        label: `long-path/to/revisions/panel-${index}.yaml`, editable: index !== 5,
        content: Array.from({ length: 180 }, (_, line) => line === 0 ? `needle revision ${index}`
            : `line_${line}: ${'long wrapped YAML content '.repeat(8)} revision ${index}`).join('\n') }));
    const render = async (items, canReturnToDirectory = false, workspace) => show({ type: 'showMultiDiff', panels: items, activePanelId: items[0].id, canReturnToDirectory, workspace,
        activePairIndex: 0, pairs: items.slice(1).map((panel, index) => ({ leftIndex: index, rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(items[index].content, panel.content) })) });
    try {
        window.setSize(1700, 900);
        await render(panels);
        await choose(4);
        assert.equal(await evaluate(`(() => {
            const picker = document.querySelector('.multi-strip-density');
            const controls = document.querySelector('.multi-strip-controls').getBoundingClientRect();
            return !picker.hidden && Math.abs(picker.getBoundingClientRect().right - controls.right) < 1;
        })()`), true, 'Visible panels is right-aligned');
        const initial = await read();
        assert.deepEqual(initial.visible, [0, 1, 2, 3]);
        for (const pair of [1, 2, 0]) {
            await switchPair(pair);
            const next = await read();
            assert.equal(next.transform, initial.transform, 'Selecting a visible gutter leaves the group stationary');
            assert.equal(next.pair, pair);
        }
        await switchPair(3);
        assert.deepEqual((await read()).visible, [1, 2, 3, 4]);
        await switchPair(4);
        assert.deepEqual((await read()).visible, [2, 3, 4, 5]);
        const lastGroup = (await read()).transform;
        await evaluate("document.querySelectorAll('[data-multi-select-panel]')[2].click()");
        await settle();
        assert.equal((await read()).transform, lastGroup, 'Selecting the leftmost visible panel must choose a visible adjacent pair');
        assert.equal((await read()).pair, 2);
        await switchPair(0);

        window.webContents.send('bygone:host-message', { type: 'visibleSearch' });
        await settle();
        await evaluate(`{ const input = document.querySelector('.visible-search-input');
            input.value = 'needle'; input.dispatchEvent(new Event('input', {bubbles:true})); }`);
        assert.equal(await evaluate("document.querySelectorAll('[data-visible-search-result]').length"), 4);
        await choose(3);
        assert.equal(await evaluate("document.querySelectorAll('[data-visible-search-result]').length"), 3);
        await evaluate(`{ const scope = document.querySelector('.visible-search-scope');
            scope.value = 'comparison'; scope.dispatchEvent(new Event('change')); }`);
        assert.equal(await evaluate("document.querySelectorAll('[data-visible-search-result]').length"), 6);
        await evaluate("document.querySelector('.visible-search-close').click()");

        await choose(2);
        assert.equal(await evaluate("document.querySelector('.multi-strip-density').hidden"), false,
            'Choosing two out of six keeps the density picker available');
        await evaluate(`{ const editors = window.monaco.editor.getEditors();
            editors.forEach(e => e.updateOptions({wordWrap:'on'}));
            const e = editors[0];
            e.pushUndoStop(); e.executeEdits('density-smoke', [{range: new window.monaco.Range(1, 1, 1, 1), text:'edited '}]); e.pushUndoStop();
            e.setSelection(new window.monaco.Range(35, 3, 35, 12));
        }`);
        await settle();
        await evaluate('window.monaco.editor.getEditors()[0].setScrollTop(window.monaco.editor.getEditors()[0].getTopForLineNumber(35))');
        await settle();
        const selection = await evaluate('window.monaco.editor.getEditors()[0].getSelection()');
        const anchors = await evaluate('window.monaco.editor.getEditors().map(e => e.getVisibleRanges()[0].startLineNumber)');
        for (const count of [3, 4, 2]) {
            await choose(count);
            assert.deepEqual((await read()).models, initial.models, 'Density retains editor models');
            assert.deepEqual(await evaluate('window.monaco.editor.getEditors()[0].getSelection()'), selection);
            assert.deepEqual(await evaluate('window.monaco.editor.getEditors().map(e => e.getVisibleRanges()[0].startLineNumber)'), anchors,
                'Density preserves the model line at the top when wrapping changes');
            assert.equal(await evaluate("window.monaco.editor.getEditors()[0].getValue().startsWith('edited ' )"), true);
        }
        await evaluate("window.monaco.editor.getEditors()[0].trigger('density-smoke', 'undo', null)");
        assert.equal(await evaluate('window.monaco.editor.getEditors()[0].getValue()'), panels[0].content);
        await choose(4);
        window.setSize(1200, 900);
        await settle();
        assert.equal((await read()).visible.length, 4);
        assert.equal((await read()).choice, '4');
        assert.equal((await read()).fit, '');
        window.setSize(1700, 900);
        await settle();
        assert.equal((await read()).visible.length, 4);
        await choose('fit');
        assert.equal((await read()).visible.length, 4);
        window.setSize(2100, 900);
        await settle();
        assert.equal((await read()).visible.length, 5, 'Fit grows beyond four panels');
        window.setSize(2500, 900);
        await settle();
        assert.deepEqual((await read()).visible, [0, 1, 2, 3, 4, 5], 'Fit is bounded by available panels and readable width');
        const fullGroup = (await read()).transform;
        await switchPair(4);
        assert.equal((await read()).transform, fullGroup, 'The last pair stays stationary when all six panels fit');
        await switchPair(0);
        window.setSize(1200, 900);
        await settle();
        assert.equal((await read()).visible.length, 3);

        // At density 3, check the live ribbon endpoints after wrapping/resizing.
        await evaluate(`{
            const ctx = document.getElementById('connection-canvas').getContext('2d');
            window.densityGradients = [];
            window.densityClear = ctx.clearRect; window.densityGradient = ctx.createLinearGradient;
            ctx.clearRect = function(...args) { window.densityGradients = []; return window.densityClear.apply(this, args); };
            ctx.createLinearGradient = function(...args) { window.densityGradients.push([args[0], args[2]]); return window.densityGradient.apply(this, args); };
            window.monaco.editor.getEditors()[0].setScrollTop(0);
        }`);
        await switchPair(1);
        const geometry = await evaluate(`(() => {
            const panes = [...document.querySelectorAll('.multi-pane .monaco-editor')].map(e => e.getBoundingClientRect());
            const canvas = document.getElementById('connection-canvas').getBoundingClientRect();
            return { gradients: window.densityGradients, expected: [0, 1].map(i => [panes[i].right - canvas.left - 2, panes[i + 1].left - canvas.left + 2]) };
        })()`);
        assert.ok(geometry.gradients.length > 0);
        assert.ok(geometry.gradients.every(xs => geometry.expected.some(expected => xs.every((x, i) => Math.abs(x - expected[i]) < 1))), JSON.stringify(geometry));
        assert.ok(geometry.expected.every(expected => geometry.gradients.some(xs => xs.every((x, i) => Math.abs(x - expected[i]) < 1))), 'Both visible pair gutters have connectors');
        await evaluate(`{ const ctx = document.getElementById('connection-canvas').getContext('2d');
            ctx.clearRect = window.densityClear; ctx.createLinearGradient = window.densityGradient; void 0; }`);

        // Scene changes and membership changes must not overwrite the reader's request.
        await choose(4);
        await render(panels.slice(0, 2));
        assert.equal((await read()).choice, '4');
        assert.deepEqual((await read()).visible, [0, 1]);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.multi-strip-density')).display"), 'none');
        await render(panels.slice(0, 1));
        assert.equal(await evaluate("getComputedStyle(document.querySelector('.multi-strip-density')).display"), 'none');
        window.setSize(1700, 900);
        await render(panels);
        await switchPair(4);
        await render(panels.slice(1));
        assert.equal((await read()).choice, '4');
        assert.equal((await read()).visible.length, 4);
        // Directory and file views share the density request, including round trips.
        const directory = async count => show({ type: 'showDirectoryDiff',
            labels: panels.slice(0, count).map(panel => panel.label), canMutate: false,
            entries: [{ relativePath: 'sample.md', displayName: 'sample.md', depth: 0,
                isDirectory: false, status: 'modified', sides: Array(count).fill(true) }] });
        const directoryVisible = () => evaluate("[...document.querySelectorAll('.dir-column')].filter(p => !p.hidden).map(p => Number(p.dataset.sideIndex))");
        const chooseDirectory = async value => {
            await evaluate(`{ const picker = document.querySelector('[data-dir-visible-count]');
                picker.value = ${JSON.stringify(String(value))}; picker.dispatchEvent(new Event('change', {bubbles:true})); }`);
            await settle();
        };
        await directory(3);
        await chooseDirectory(3);
        assert.deepEqual(await directoryVisible(), [0, 1, 2]);
        await render(panels.slice(0, 3), true);
        assert.equal((await read()).choice, '3');
        assert.deepEqual((await read()).visible, [0, 1, 2]);
        await choose(2);
        await directory(3);
        assert.deepEqual(await directoryVisible(), [0, 1]);
        assert.equal(await evaluate("document.querySelector('[data-dir-visible-count]').value"), '2');
        await evaluate("document.querySelector('[data-dir-strip-direction=next]').click()");
        await settle();
        assert.deepEqual(await directoryVisible(), [1, 2]);
        await render(panels.slice(0, 3), true);
        assert.deepEqual((await read()).visible, [1, 2]);
        assert.equal((await read()).pair, 1);
        await directory(3);
        assert.deepEqual(await directoryVisible(), [1, 2]);
        await directory(6);
        for (const count of [3, 4, 'fit']) {
            await chooseDirectory(count);
            assert.equal((await directoryVisible()).length, count === 'fit' ? 4 : count);
        }
        await chooseDirectory(4);
        await evaluate("document.querySelector('[data-dir-strip-direction=next]').click()");
        await settle();
        assert.deepEqual(await directoryVisible(), [1, 2, 3, 4]);
        await render(panels, true);
        assert.deepEqual((await read()).visible, [1, 2, 3, 4]);
        await directory(6);
        assert.deepEqual(await directoryVisible(), [1, 2, 3, 4]);
        window.setSize(1200, 900);
        await settle();
        assert.equal((await directoryVisible()).length, 4);
        assert.equal(await evaluate("document.querySelector('[data-dir-strip-fit]').textContent"), '');
        window.setSize(1700, 900);
        await settle();
        assert.equal((await directoryVisible()).length, 4);
        // New explicit comparisons override a saved two-panel preference even
        // when tight, while refresh and directory round trips retain manual choices.
        window.setSize(1000, 900);
        for (const count of [3, 4]) {
            await chooseDirectory(2);
            const items = panels.slice(0, count).map(p => ({ ...p, id: `explicit-${count}-${p.id}` }));
            await render(items);
            await settle();
            assert.equal((await read()).choice, String(count));
            assert.equal((await read()).visible.length, count);
            assert.equal(await evaluate("localStorage.getItem('bygone.visiblePanels')"), '2', 'Automatic defaults do not rewrite the saved preference');
            await choose(2);
            await render(items);
            assert.equal((await read()).choice, '2', 'Refreshing the same comparison retains the reader choice');
            await directory(count);
            await settle();
            assert.equal(await evaluate("document.querySelector('[data-dir-visible-count]').value"), String(count));
            assert.equal((await directoryVisible()).length, count);
            await render(items, true);
            assert.equal((await read()).choice, String(count));
            assert.equal((await read()).visible.length, count);
            await choose(2);
            await directory(count);
            assert.equal(await evaluate("document.querySelector('[data-dir-visible-count]').value"), '2');
            await render(items, true);
            assert.equal((await read()).choice, '2');
        }
        // A fresh workspace may open directly at a revision file with a directory
        // return action. Reopening the same inputs must still apply the default.
        for (const sessionId of ['density-session-one', 'density-session-two']) {
            await render(panels.slice(0, 3), true, { sessionId, mode: 'compare', history: { enabled: false } });
            await settle();
            assert.equal((await read()).choice, '3');
            await choose(2);
            await directory(3);
            assert.equal(await evaluate("document.querySelector('[data-dir-visible-count]').value"), '2');
        }
        await directory(2);
        assert.deepEqual(await directoryVisible(), [0, 1]);
        assert.equal(await evaluate("document.querySelector('[data-dir-strip-controls]').hidden"), true);
        console.log('Panel density smoke passed: 2/3/4/Fit, stationary groups, end navigation, resize restoration, search, model/selection/edit/undo and wrapped scroll preservation, connectors, shorter scenes and removal.');
    } finally {
        window.setBounds(savedBounds);
        await evaluate(`localStorage.${savedPreference === null ? "removeItem('bygone.visiblePanels')" : `setItem('bygone.visiblePanels', ${JSON.stringify(savedPreference)})`}`);
    }
}

module.exports = { runPanelDensitySmoke };
