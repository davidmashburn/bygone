/* global require, module, console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout, clearTimeout } = require('node:timers');

async function runWorkspaceSmoke({ open, window, session, dialog, openTour }) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-smoke-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    const evaluate = (code) => window().webContents.executeJavaScript(code, true);
    const waitFor = (condition) => evaluate(`new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => { if (${condition}) resolve(true); else if (Date.now() - start > 15000) reject(new Error(${JSON.stringify(condition)})); else requestAnimationFrame(check); };
        check();
    })`);
    try {
        git('init'); git('config', 'user.name', 'Workspace smoke'); git('config', 'user.email', 'smoke@example.test');
        const revisions = [];
        for (let i = 0; i < 4; i++) {
            fs.writeFileSync(path.join(root, 'one.txt'), `one ${i}\n`);
            fs.writeFileSync(path.join(root, 'two.txt'), `two ${i}\n`);
            git('add', '.'); git('commit', '-m', `Revision ${i}`);
            revisions.push(git('rev-parse', 'HEAD').toString().trim());
        }
        await open(path.join(root, 'one.txt'), path.join(root, 'two.txt'));
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelectorAll('.monaco-editor').length >= 2");
        const original = session();
        await evaluate("document.querySelectorAll('[data-multi-select-panel]')[1].click()");
        await waitFor("document.querySelectorAll('[data-multi-select-panel]')[1].getAttribute('aria-pressed') === 'true'");
        await evaluate("document.querySelector('[data-workspace-mode=historical]').click()");
        await waitFor("document.querySelector('dialog[open] textarea')");
        await evaluate("document.querySelector('dialog[open] textarea').value = 'Keep this prompt'; document.querySelector('dialog[open] textarea').dispatchEvent(new Event('input')); document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', {cancelable:true}))");
        await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]') && document.querySelectorAll('.multi-pane').length === 2");
        assert.equal(session().workspaceView.path, 'two.txt');
        assert.equal(session().multi.files.at(-1).editable, true);
        const checkboxes = await evaluate("document.querySelectorAll('#history-rail [role=checkbox]').length");
        assert.ok(checkboxes >= 4, `Expected all commits, got ${checkboxes}`);
        await evaluate("document.querySelectorAll('#history-rail [role=checkbox]')[1].click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(1)')");
        await evaluate("document.querySelectorAll('#history-rail [role=checkbox]')[2].click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(2)')");
        await evaluate("document.querySelector('[data-action=workspaceClear]').click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(0)')");
        assert.equal(session().workspaceView.mode, 'history');
        await evaluate("document.querySelector('[data-workspace-back]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelectorAll('.multi-pane').length === 2");
        assert.equal(session(), original);
        await evaluate("document.querySelector('[data-workspace-mode=historical]').click()");
        await waitFor("document.querySelector('dialog[open] textarea')?.value === 'Keep this prompt'");
        await evaluate("document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', {cancelable:true}))");
        const dirtyConfirm = dialog.showMessageBox;
        let dirtyPrompts = 0;
        let confirmResponse = 2;
        try {
            dialog.showMessageBox = async () => { dirtyPrompts++; return { response: confirmResponse }; };
            // Edit and request a mode switch in one renderer turn, before the
            // ordinary debounced model message can reach the native host.
            await evaluate("window.monaco.editor.getModels().find(model => model.getValue() === 'two 3\\n').setValue('unsent edit\\n'); document.querySelector('[data-workspace-mode=history]').click()");
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 5000;
                const check = () => dirtyPrompts ? resolve() : Date.now() > deadline ? reject(new Error('Immediate edit did not trigger the unsaved guard')) : setTimeout(check, 20);
                check();
            });
            assert.equal(session(), original, 'Cancel preserves the original comparison');
            assert.equal(fs.readFileSync(path.join(root, 'two.txt'), 'utf8'), 'two 3\n');
            assert.equal(session().multi.files[1].content, 'unsent edit\n');
            confirmResponse = 1;
            await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
            await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
            await evaluate("document.querySelector('[data-workspace-back]').click()");
            await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]')");
            assert.equal(session().multi.files[1].content, 'two 3\n', 'Discarded edits cannot return in the retained comparison');
            assert.ok(session().multi.files.every((panel) => !panel.dirty));
        } finally { dialog.showMessageBox = dirtyConfirm; }
        const retainedOriginal = session();
        const tourPath = path.join(root, 'smoke.bygone');
        fs.writeFileSync(tourPath, JSON.stringify({ version: 3, range: { base: revisions[0], head: revisions[3] },
            anchors: { value: { file: 'one.txt', revision: 'head', contains: 'one' } }, connections: [],
            chapters: [{ id: 'chapter', title: 'Change', scenes: [{ id: 'scene', kind: 'walkthrough', title: 'Read the change',
                summary: 'The value changes.', bullets: [], tags: [], takeaway: 'Real committed values.',
                steps: [{ id: 'step', title: 'Value', body: 'The committed value.', focus: 'value' }] }] }]
        }));
        const pick = dialog.showOpenDialog;
        const confirm = dialog.showMessageBox;
        let confirmations = 0;
        try {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [tourPath] });
            dialog.showMessageBox = async () => { confirmations++; return { response: 0 }; };
            await openTour();
        } finally { dialog.showOpenDialog = pick; dialog.showMessageBox = confirm; }
        assert.equal(confirmations, 1, 'A scoped local comparison requires an explicit tour-context choice');
        await waitFor("document.querySelector('[data-workspace-mode=historical][aria-pressed=true]') && document.querySelector('#workspace-tour-frame:not([hidden])')");
        const tourFrame = await new Promise((resolve, reject) => {
            const contents = window().webContents;
            const timeout = setTimeout(() => { contents.removeListener('did-frame-finish-load', check); reject(new Error('Tour subframe did not load')); }, 15000);
            function check() {
                const frame = contents.mainFrame.frames.find((entry) => entry.url.startsWith('http://127.0.0.1:'));
                if (frame) { clearTimeout(timeout); contents.removeListener('did-frame-finish-load', check); resolve(frame); }
            }
            contents.on('did-frame-finish-load', check);
            check();
        });
        assert.ok(tourFrame, 'Tour runs in a loopback subframe');
        await tourFrame.executeJavaScript(`new Promise((resolve, reject) => {
            const start = Date.now(); const check = () => {
                if (document.querySelector('#tour-title')?.textContent && document.querySelectorAll('.monaco-editor').length) resolve(true);
                else if (Date.now() - start > 15000) reject(new Error('Tour did not render')); else requestAnimationFrame(check);
            }; check();
        })`);
        assert.notEqual(await tourFrame.executeJavaScript("window.__BYGONE_HOST__?.environment"), 'standalone');
        assert.equal(await tourFrame.executeJavaScript("typeof window.__BYGONE_HOST__?.getPathForFile"), 'undefined');
        await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelector('#workspace-tour-frame').hidden");
        assert.equal(session(), retainedOriginal);
        await open(path.join(root, 'one.txt'), path.join(root, 'two.txt'), {
            source: { kind: 'files', paths: [path.join(root, 'one.txt'), path.join(root, 'two.txt')], readOnly: true }
        });
        await waitFor("document.querySelectorAll('.multi-pane-provenance.is-readonly').length === 2");
        await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
        assert.ok(session().multi.files.every((panel) => panel.editable === false));
        console.log('Workspace smoke passed: native controls, prompt draft, History, all-commit rail, draft Clear, exact return, confirmed same-window tour, and read-only preservation.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

module.exports = { runWorkspaceSmoke };
