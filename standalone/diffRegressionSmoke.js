/* global require, console, __dirname, setTimeout, clearTimeout */
// Real Monaco rendering and scroll events, without touching an installed session.
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { buildTwoWayDiffModel } = require('../out/diffEngine');
const { runPanelDensitySmoke } = require('./panelDensitySmoke');
const { runGutterCopySmoke } = require('./gutterCopySmoke');
const { yamlDiffFixture } = require('../test/yamlDiffFixture');

app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Diff regression smoke timed out'); app.exit(1); }, 60000);
    const errors = [];
    const window = new BrowserWindow({ show: false, width: 1500, height: 850, webPreferences: {
        preload: path.resolve(__dirname, '../out/standalone-preload.js'),
        nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false
    } });
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const message = predicate => new Promise(resolve => {
        const listener = (event, payload) => {
            if (event.sender === window.webContents && predicate(payload)) {
                ipcMain.removeListener('bygone:renderer-message', listener);
                resolve(payload);
            }
        };
        ipcMain.on('bygone:renderer-message', listener);
    });
    let request = 0;
    const show = async payload => {
        const renderRequestId = ++request;
        const rendered = message(p => p.type === 'renderComplete' && p.renderRequestId === renderRequestId);
        window.webContents.send('bygone:host-message', { ...payload, renderRequestId });
        await rendered;
        await frames();
    };
    window.webContents.on('console-message', (_event, level, text) => {
        if (level >= 3 && !text.includes('Electron Security Warning')) errors.push(text);
    });
    try {
        const ready = message(p => p.type === 'ready');
        await window.loadFile(path.resolve(__dirname, 'index.html'));
        await ready;
        const fixture = yamlDiffFixture();
        const leftContent = fixture.before.join('\n');
        const rightContent = fixture.after.join('\n');
        const diffModel = buildTwoWayDiffModel(leftContent, rightContent, {timeoutMs: 3000});
        const editors = 'window.monaco.editor.getEditors()';
        async function assertWhitespacePaint(side) {
            await evaluate(`${editors}[${side}].revealLineInCenter(163, 1)`);
            await frames();
            const highlights = await evaluate(`Array.from(${editors}[${side}].getDomNode().querySelectorAll('.bygone-inline-blue')).map(e => ({ width: e.getBoundingClientRect().width, text: e.textContent, background: getComputedStyle(e).backgroundColor }))`);
            assert.ok(highlights.some(h => h.width > 0 && !h.text.trim() && h.background !== 'rgba(0, 0, 0, 0)'), JSON.stringify(highlights.slice(0, 8)));
            const ranges = await evaluate(`${editors}[${side}].getModel().getAllDecorations().filter(d => d.options.inlineClassName === 'bygone-inline-blue' && d.range.startLineNumber === 162).map(d => [d.range.startColumn, d.range.endColumn])`);
            assert.deepEqual(ranges, [[1, 3]], 'Extra indentation is highlighted at the start of the line');
            assert.equal(await evaluate(`Boolean(${editors}[${side}].getDomNode().querySelector('.margin [class*=bygone-paired-line]'))`), false, 'Diff shading must not blend into leading whitespace from the gutter');
        }
        async function assertConnectorClip() {
            const pixels = await evaluate(`{
                const canvas = document.getElementById('connection-canvas');
                const bounds = canvas.getBoundingClientRect();
                const panes = ${editors}.slice(0, 2).map(e => e.getDomNode().getBoundingClientRect());
                const top = Math.ceil(Math.max(...panes.map(p => p.top)) - bounds.top);
                const bottom = Math.floor(Math.min(...panes.map(p => p.bottom)) - bounds.top);
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let outside = 0, inside = 0;
                for (let y = 0; y < canvas.height; y++) {
                    for (let x = 0; x < canvas.width; x++) {
                        if (data[(y * canvas.width + x) * 4 + 3]) {
                            if (y < top - 1 || y > bottom) outside++;
                            else inside++;
                        }
                    }
                }
                ({outside, inside, top, bottom});
            }`);
            assert.equal(pixels.outside, 0, `Connectors must not paint over panel controls: ${JSON.stringify(pixels)}`);
            assert.ok(pixels.inside > 0, 'Clipping must retain visible connectors');
        }
        async function scroll(sourceIndex, sourceLine, targets, fraction = 0.25) {
            await evaluate(`${editors}[${sourceIndex}].revealLineInCenter(${sourceLine}, 1)`);
            await frames();
            await evaluate(`{
                const editor = ${editors}[${sourceIndex}];
                const top = editor.getTopForLineNumber(${sourceLine});
                editor.setScrollTop(top + (editor.getBottomForLineNumber(${sourceLine}) - top) * ${fraction});
            }`);
            await frames();
            const positions = await evaluate(`${editors}.map(editor => ({top: editor.getScrollTop(), expected: 0}))`);
            for (const [index, line] of targets.entries()) {
                const expected = await evaluate(`{
                    const e = ${editors}[${index}];
                    e.getTopForLineNumber(${line}) + (e.getBottomForLineNumber(${line}) - e.getTopForLineNumber(${line})) * ${fraction};
                }`);
                assert.ok(Math.abs(positions[index].top - expected) <= 2, JSON.stringify({ request, sourceIndex, sourceLine, index, line, actual: positions[index].top, expected, positions }));
            }
        }
        for (const count of [2, 3, 2]) {
            if (count === 2) {
                await show({ type: 'showDiff', file1: 'before.yaml', file2: 'after.yaml', leftContent, rightContent, diffModel: request === 0 ? diffModel : undefined });
            } else {
                const panels = [leftContent, rightContent, leftContent].map((content, index) => ({ id: `panel-${index}`, label: `panel-${index}.yaml`, content, editable: false }));
                await show({ type: 'showMultiDiff', panels, pairs: [
                    { leftIndex: 0, rightIndex: 1, diffModel },
                    { leftIndex: 1, rightIndex: 2, diffModel: buildTwoWayDiffModel(rightContent, leftContent, {timeoutMs: 3000}) }
                ] });
            }
            assert.equal(await evaluate(`${editors}.length`), count);
            for (const wrap of ['off', 'on']) {
                console.log({request, count, wrap});
                await evaluate(`${editors}.forEach(e => e.updateOptions({ wordWrap: '${wrap}' }))`);
                await frames();
                for (const source of [0, count - 1, 1]) {
                    await scroll(source, 41, Array(count).fill(41));
                    const lines = [fixture.suffixStart.left + 31, fixture.suffixStart.right + 31, fixture.suffixStart.left + 31].slice(0, count);
                    await scroll(source, lines[source], lines);
                }
                // Reflow starts at the body, not the preceding YAML key.
                const block = fixture.reflows[0];
                await scroll(0, block.leftStart + 1, [block.leftStart + 1, block.rightStart + 1, block.leftStart + 1].slice(0, count), 0);
                const middle = [block.leftStart + 1, (block.rightStart + block.rightEnd + 1) / 2, block.leftStart + 1].slice(0, count);
                await scroll(0, middle[0], middle, 0.5);
                await scroll(1, middle[1], middle, 0.5);
                await assertConnectorClip();
            }
            await assertWhitespacePaint(1);
        }
        await show({ type: 'showDiff', file1: 'after.yaml', file2: 'before.yaml', leftContent: rightContent, rightContent: leftContent });
        await assertWhitespacePaint(0);
        for (const [leftContent, rightContent, expected] of [
            ['freeze', 'freezeSet', [[], [[7, 10]]]],
            ['userStatisticsThing', 'userMetricsThing', [[[5, 12]], [[5, 9]]]]
        ]) {
            // Omit the host model so this also verifies the bundled diff worker.
            await show({type: 'showDiff', file1: 'before.txt', file2: 'after.txt', leftContent, rightContent});
            assert.equal(await evaluate(`${editors}.every(e => {
                const decorations = e.getModel().getAllDecorations();
                return decorations.some(d => d.options.className === 'bygone-paired-line')
                    && !decorations.some(d => d.options.className === 'bygone-one-sided-line');
            })`), true, 'Bare identifier changes render as blue replacements');
            const ranges = await evaluate(`${editors}.map(e => e.getModel().getAllDecorations()
                .filter(d => d.options.inlineClassName === 'bygone-inline-blue')
                .map(d => [d.range.startColumn, d.range.endColumn]))`);
            assert.deepEqual(ranges, expected, 'Bare identifier edges remain unhighlighted');
        }
        await show({type: 'showDiff', file1: 'title-before.yaml', file2: 'title-after.yaml',
            leftContent: 'title: Find the right depth without expanding the README',
            rightContent: 'title: Organize the engineering and agent reference'});
        assert.equal(await evaluate(`${editors}.every(e => {
            const decorations = e.getModel().getAllDecorations();
            return decorations.some(d => d.options.className === 'bygone-paired-line')
                && !decorations.some(d => d.options.className === 'bygone-one-sided-line');
        })`), true, 'Worker-computed renamed title fields render blue on both sides');
        const changeBefore = 'old first\nkeep\nold second\n';
        const changeAfter = 'new first\nkeep\nnew second\n';
        for (const count of [2, 3]) {
            const contents = [changeBefore, changeAfter, changeBefore].slice(0, count);
            await show(count === 2
                ? { type: 'showDiff', file1: 'before.txt', file2: 'after.txt', leftContent: changeBefore, rightContent: changeAfter, diffModel: buildTwoWayDiffModel(changeBefore, changeAfter), initialChangeIndex: 0 }
                : { type: 'showMultiDiff', panels: contents.map((content, index) => ({ id: `change-${index}`, label: `change-${index}`, content, editable: false })),
                    pairs: contents.slice(1).map((content, index) => ({ leftIndex: index, rightIndex: index + 1, diffModel: buildTwoWayDiffModel(contents[index], content) })), initialChangeIndex: 0 });
            for (const index of [1, 2]) {
                if (index === 2) await evaluate("document.querySelector('#next-change').click()");
                await frames();
                assert.equal(await evaluate("document.querySelector('#change-position').textContent"), `Change ${index} of 2`);
                const active = await evaluate(`${editors}.flatMap(e => e.getModel().getAllDecorations()
                    .filter(d => d.options.blockClassName === 'bygone-active-diff-outline')
                    .map(d => d.range.startLineNumber))`);
                assert.deepEqual(active, [index === 1 ? 1 : 3, index === 1 ? 1 : 3], 'Only the current change in the active pair is outlined');
                assert.equal(await evaluate("document.querySelectorAll('.bygone-active-diff-gutter').length"), 2);
            }
        }
        for (const [leftContent, rightContent] of [['', 'new\n'], ['removed\n', '']]) {
            await show({ type: 'showDiff', file1: 'before.txt', file2: 'after.txt', leftContent, rightContent, diffModel: buildTwoWayDiffModel(leftContent, rightContent) });
            await evaluate("document.querySelector('#next-change').click()");
            await frames();
            assert.equal(await evaluate(`${editors}.every(e => e.getModel().getAllDecorations().some(d => d.options.blockClassName?.startsWith('bygone-active-diff-')))`), true, 'Added and deleted files mark the current change on both sides');
        }
        await runPanelDensitySmoke({ window, show });
        const mutabilityFixture = {
            type: 'showDiff', file1: 'snapshot.txt', file2: 'worktree.txt',
            leftContent: 'before\n', rightContent: 'after\n'
        };
        const readOnlyOptions = `${editors}.map(e => e.getOption(window.monaco.editor.EditorOption.readOnly))`;
        await show({ ...mutabilityFixture, editableSides: { left: false, right: true } });
        assert.equal(await evaluate("document.getElementById('edit-mode-toolbar').hidden"), false);
        assert.equal(await evaluate("document.getElementById('toggle-readonly').closest('.change-toolbar-actions') !== null"), true);
        assert.equal(await evaluate("document.getElementById('comparison-mutability') === null"), true);
        assert.deepEqual(await evaluate(readOnlyOptions), [true, false]);
        await evaluate("document.getElementById('toggle-readonly').click()");
        assert.deepEqual(await evaluate(readOnlyOptions), [true, true]);
        await evaluate("document.getElementById('toggle-readonly').click()");
        assert.deepEqual(await evaluate(readOnlyOptions), [true, false]);
        for (const readOnlyLabel of ['Read-only snapshot', 'Read-only file']) {
            await show({ ...mutabilityFixture, editableSides: { left: false, right: false }, readOnlyLabel });
            assert.equal(await evaluate("document.getElementById('edit-mode-toolbar').getBoundingClientRect().height"), 0);
            assert.equal(await evaluate("document.querySelector('#file-info #comparison-mutability').textContent"), 'Read-only');
            assert.match(await evaluate("document.getElementById('comparison-mutability').getAttribute('aria-label')"),
                readOnlyLabel === 'Read-only file' ? /Editing was disabled/ : /snapshot/);
            await evaluate("document.getElementById('toggle-readonly').click()");
            assert.deepEqual(await evaluate(readOnlyOptions), [true, true], 'Read-only host capabilities cannot be toggled away');
        }
        await runGutterCopySmoke({ window, show });
        assert.deepEqual(errors, []);
        console.log('Diff renderer regression smoke passed: whitespace paint/ranges, long YAML, two/three panels, both scroll directions, wrap on/off, unchanged prefix/suffix, reflow boundaries, panel switching, connector clipping, renamed title pairing.');
        clearTimeout(timeout); app.exit(0);
    } catch (error) {
        console.error(error, errors); clearTimeout(timeout); app.exit(1);
    }
});
