/* global require, module */
const assert = require('node:assert/strict');
const { buildTwoWayDiffModel } = require('../out/diffEngine');

async function runInitialRevealSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const prefix = Array.from({ length: 80 }, (_, index) => `const context${index} = true;`).join('\n');
    const contents = [1, 2].map(value => `${prefix}\nconst alpha = ${value};\n`);
    await evaluate(`{
        window.initialRevealFrames = { original: window.requestAnimationFrame, callbacks: [] };
        window.requestAnimationFrame = callback => { window.initialRevealFrames.callbacks.push(callback); return -1; };
        true;
    }`);
    try {
        const rendered = show({ type: 'showMultiDiff',
            panels: contents.map((content, index) => ({ id: 'initial-reveal-' + index, label: 'reveal.js', content, editable: false })),
            pairs: [{ leftIndex: 0, rightIndex: 1, diffModel: buildTwoWayDiffModel(...contents) }],
            revealFirstChangeInEachPanel: true });
        await evaluate(`new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                if (document.querySelector('[data-panel-id="initial-reveal-0"]')) resolve();
                else if (Date.now() - started > 3000) reject(new Error('Initial reveal fixture did not load'));
                else setTimeout(check, 10);
            };
            check();
        })`);
        // Queue preservation of the old viewport before the initial change jump.
        await evaluate(`{
            const container = document.getElementById('multi-way-diff');
            container.style.width = (container.clientWidth - 120) + 'px';
            window.dispatchEvent(new Event('resize'));
            window.requestAnimationFrame = window.initialRevealFrames.original;
            window.initialRevealFrames.callbacks.forEach(callback => requestAnimationFrame(callback));
        }`);
        await rendered;
        const positions = await evaluate(`window.monaco.editor.getEditors().map(editor => ({
            position: editor.getPosition(), scrollTop: editor.getScrollTop(), visible: editor.getVisibleRanges()
        }))`);
        assert.equal(positions.length, 2);
        for (const state of positions) {
            assert.equal(state.position.lineNumber, 81);
            assert.ok(state.visible.some(range => range.startLineNumber <= 81 && range.endLineNumber >= 81),
                'Queued resize must not undo initial navigation: ' + JSON.stringify(state));
        }
    } finally {
        await evaluate(`{
            window.requestAnimationFrame = window.initialRevealFrames.original;
            delete window.initialRevealFrames;
            document.getElementById('multi-way-diff').style.width = '';
            window.dispatchEvent(new Event('resize'));
        }`);
    }
}

module.exports = { runInitialRevealSmoke };
