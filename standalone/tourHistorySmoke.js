/* global require, module */
const assert = require('node:assert/strict');

async function runTourHistorySmoke(contents, file) {
    const evaluate = code => contents.executeJavaScript(code, true);
    const wait = condition => evaluate(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const check = () => {
            if (${condition}) resolve();
            else if (Date.now() > deadline) reject(new Error(${JSON.stringify(condition)}));
            else requestAnimationFrame(check);
        }; check();
    })`);
    const overview = "window.__historySmokeMessage?.history?.fileName === 'Changed files' && document.querySelector('.dir-entry[data-is-dir=false]') && !document.querySelector('.monaco-editor')";
    await evaluate(`window.__historySmokeListener = event => {
        if (['showDirectoryDiff', 'showMultiDiff'].includes(event.detail.type)) window.__historySmokeMessage = event.detail;
    }; window.addEventListener('bygone:host-message', window.__historySmokeListener)`);
    try {
        await evaluate("window.__historySmokeMessage = null; document.querySelector('[data-workspace-mode=history]').click()");
        await wait(overview);
        const original = await evaluate('window.__historySmokeMessage.labels');
        await evaluate("document.getElementById('history-back').click()");
        await wait(`(${overview}) && window.__historySmokeMessage.labels.at(-1) !== ${JSON.stringify(original.at(-1))}`);
        await evaluate("document.getElementById('history-forward').click()");
        await wait(`(${overview}) && window.__historySmokeMessage.labels.at(-1) === ${JSON.stringify(original.at(-1))}`);
        await evaluate(`document.querySelector(${JSON.stringify(`.dir-entry[data-path="${file}"]`)}).click()`);
        await wait("document.querySelectorAll('.monaco-editor').length >= 2 && !document.getElementById('directory-return-toolbar').hidden");
        const snapshots = await evaluate('window.__historySmokeMessage.panels.map(panel => panel.content)');
        assert.ok(snapshots.some(content => content.length), 'Drill-down loads real snapshot contents');
        await evaluate("document.getElementById('back-to-directory').click()");
        await wait(overview);
        assert.deepEqual(await evaluate('window.__historySmokeMessage.labels'), original, 'Return preserves compared revisions');
        await evaluate("document.querySelector('[data-workspace-mode=historical]').click()");
        await wait("document.querySelector('[data-workspace-mode=historical][aria-selected=true]')");
        await evaluate("window.__historySmokeMessage = null; document.querySelector('[data-workspace-mode=history]').click()");
        await wait(overview);
        assert.deepEqual(await evaluate('window.__historySmokeMessage.labels'), original, 'Mode round trip restores the overview');
    } finally {
        await evaluate(`window.removeEventListener('bygone:host-message', window.__historySmokeListener);
            delete window.__historySmokeListener; delete window.__historySmokeMessage;`);
    }
}

module.exports = { runTourHistorySmoke };
