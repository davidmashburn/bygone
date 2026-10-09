/* global module, require, console */
const assert = require('node:assert/strict');
const { ipcMain } = require('electron');
const { reorderComparisonSession } = require('./panelOrder');

async function runPanelOrderSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const frames = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    let session;
    let moves = 0;
    const listener = (event, message) => {
        if (event.sender !== window.webContents || !session) return;
        if (message.type === 'multiUpdatePanelContent') {
            const panel = session.multi.files.find(panel => panel.id === message.panelId);
            if (panel) { panel.content = message.content; panel.dirty = true; }
        }
        if (message.type === 'multiMovePanel') {
            const result = reorderComparisonSession(session, message);
            if (result) { moves++; window.webContents.send('bygone:host-message', result); }
        }
    };
    ipcMain.on('bygone:renderer-message', listener);
    const order = () => evaluate("[...document.querySelectorAll('.multi-pane')].map(pane => pane.dataset.panelId)");
    const moveButton = async (id, direction) => {
        await evaluate(`document.querySelector('[data-multi-move="${direction}"][data-panel-id="${id}"]').click()`);
        await frames();
    };
    const load = async (count, reorderEnabled = true, long = false) => {
        const panels = Array.from({ length: count }, (_, index) => ({ id: `reorder-${index}`, label: `file-${index}.txt`,
            path: `/fixture/${index}`, editable: index !== 1, removeEnabled: true, addLeftEnabled: true, addRightEnabled: true,
            content: long ? Array.from({ length: 100 }, (_, line) => `line ${line} panel ${index}`).join('\n') : `panel ${index}\n` }));
        session = { mode: 'multi-diff', source: { kind: 'files', paths: panels.map(panel => panel.path) }, multi: { files: panels } };
        await show({ type: 'showMultiDiff', panels, pairs: panels.slice(1).map((_, index) => ({ leftIndex: index, rightIndex: index + 1 })), activePanelId: panels[0].id, activePairIndex: 0, mutationEnabled: true, reorderEnabled });
        // Disable Monaco's unrelated delayed word highlighting before rapid fixture disposal.
        await evaluate(`window.monaco.editor.getEditors().forEach(editor => editor.updateOptions({ occurrencesHighlight: 'off' })); window.reorderEditors = new Map(window.monaco.editor.getEditors().map(editor => [editor.getDomNode().closest('.multi-pane').dataset.panelId, editor])); true;`);
    };
    try {
        await load(3, true, true);
        await evaluate(`{
            const editor = window.reorderEditors.get('reorder-0');
            editor.pushUndoStop(); editor.executeEdits('test', [{ range: new window.monaco.Range(5, 1, 5, 1), text: 'edited ' }]); editor.pushUndoStop();
            editor.setPosition({ lineNumber: 20, column: 3 }); editor.setScrollTop(200);
        }`);
        await frames();
        const before = await evaluate(`{ const editor = window.reorderEditors.get('reorder-0'); ({ content: editor.getValue(), position: editor.getPosition(), scroll: editor.getScrollTop(), uri: editor.getModel().uri.toString() }); }`);
        await moveButton('reorder-0', 1);
        assert.deepEqual(await order(), ['reorder-1', 'reorder-0', 'reorder-2']);
        const after = await evaluate(`{ const editor = window.reorderEditors.get('reorder-0'); ({ content: editor.getValue(), position: editor.getPosition(), scroll: editor.getScrollTop(), uri: editor.getModel().uri.toString() }); }`);
        assert.deepEqual(after, before, 'Moving retains the same model, text, cursor and scroll');
        assert.equal(session.multi.files[1].content, before.content, 'Host retains the edited buffer');
        await evaluate("window.reorderEditors.get('reorder-0').trigger('test', 'undo')");
        assert.equal(await evaluate("window.reorderEditors.get('reorder-0').getValue().includes('edited ')"), false, 'Undo survives moving');
        await moveButton('reorder-0', 1);
        assert.deepEqual(await order(), ['reorder-1', 'reorder-2', 'reorder-0']);
        assert.equal(await evaluate("window.reorderEditors.get('reorder-1').getOption(window.monaco.editor.EditorOption.readOnly)"), true);
        assert.equal(await evaluate("document.querySelector('[data-multi-move=\"1\"][data-panel-id=\"reorder-0\"]').disabled"), true);
        // Real DOM drag events exercise insertion positions and Escape cancellation.
        await evaluate(`window.reorderDrag = new DataTransfer(); document.querySelector('[data-multi-select-panel="reorder-0"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.reorderDrag })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
        const count = moves;
        await evaluate(`document.querySelector('.multi-pane').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: window.reorderDrag }));`);
        assert.equal(moves, count, 'Escape cancels the move');
        await load(2);
        await evaluate(`{
            const source = document.querySelector('[data-multi-select-panel="reorder-0"]');
            const target = document.querySelector('[data-panel-id="reorder-1"].multi-pane');
            const bounds = target.getBoundingClientRect();
            const dataTransfer = new DataTransfer();
            source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
            target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.right - 10 }));
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
        }`);
        await frames();
        assert.deepEqual(await order(), ['reorder-1', 'reorder-0'], 'Dragging swaps two panels');
        // Wait for async diff computation through observable enabled copy action.
        await evaluate(`new Promise((resolve, reject) => {
            const end = Date.now() + 5000;
            const check = () => { const button = document.querySelector('[data-multi-panel-copy="left-to-right"][data-panel-id="reorder-1"]');
                if (!button.disabled) resolve(); else if (Date.now() > end) reject(new Error('Copy did not become available')); else setTimeout(check, 20); }; check();
        })`);
        await evaluate(`document.querySelector('[data-multi-panel-copy="left-to-right"][data-panel-id="reorder-1"]').click()`);
        await frames();
        assert.equal(await evaluate("window.reorderEditors.get('reorder-0').getValue()"), 'panel 1\n', 'Copy targets the new writable right neighbor');
        assert.equal(session.multi.files[1].path, '/fixture/0', 'Save destination stays attached to the moved panel');
        await load(6);
        await evaluate(`{
            const select = document.querySelector('[data-multi-visible-count]'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true }));
            window.reorderDrag = new DataTransfer();
            document.querySelector('[data-multi-select-panel="reorder-0"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.reorderDrag }));
            const container = document.getElementById('multi-way-diff');
            container.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.reorderDrag, clientX: container.getBoundingClientRect().right - 5 }));
        }`);
        await evaluate('new Promise(resolve => setTimeout(resolve, 1100))');
        assert.equal(await evaluate("Number(document.querySelector('.multi-pane:not([inert])').dataset.index) > 0"), true, 'Edge dragging reveals hidden panels');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
        assert.deepEqual(await order(), Array.from({ length: 6 }, (_, index) => `reorder-${index}`));
        await load(2, false);
        assert.equal(await evaluate("document.querySelectorAll('.multi-panel-menu, [draggable=\"true\"]').length"), 0, 'History/tour hosts do not expose reorder controls');
        await load(1);
        assert.equal(await evaluate("document.querySelectorAll('.multi-panel-menu').length"), 0, 'Single panel has no reorder affordance');
        console.log('Panel reorder smoke passed: Monaco identity, undo, cursor/scroll, dirty buffers, permissions, copy/save destination, drag/drop, Escape, edge reveal, two/six/single panels.');
    } finally { ipcMain.removeListener('bygone:renderer-message', listener); }
}
module.exports = { runPanelOrderSmoke };
