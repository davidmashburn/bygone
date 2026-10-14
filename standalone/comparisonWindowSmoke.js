/* global require, module, console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout } = require('node:timers/promises');
const { app, Menu } = require('electron');
const { writeWindowState } = require('./windowState.js');

async function waitFor(check, description) {
    const deadline = Date.now() + 15000;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
        await setTimeout(30);
    }
}

async function runComparisonWindowSmoke({ host, hosts, dialog, openNewComparison, restoreOpenWindowState }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-window-smoke-'));
    const originalUserData = app.getPath('userData');
    app.setPath('userData', root);
    const originalOpen = dialog.showOpenDialog;
    const originalMessage = dialog.showMessageBox;
    const picks = [];
    const prompts = [];
    const menuItem = (label) => Menu.getApplicationMenu().items
        .find((item) => item.label === 'File').submenu.items.find((item) => item.label === label);
    const evaluate = (owner, code) => owner.window().webContents.executeJavaScript(code, true);
    const edit = async (owner, index, content) => {
        const panelId = owner.session().multi.files[index].id;
        await evaluate(owner, `window.__BYGONE_HOST__.postMessage(${JSON.stringify({
            type: 'multiUpdatePanelContent', panelId, content
        })})`);
        await waitFor(() => owner.session().multi.files[index].content === content, 'renderer edit reaches its own session');
    };
    const loaded = (owner) => waitFor(async () => owner.window() && !owner.window().webContents.isLoadingMainFrame()
        && await evaluate(owner, "Boolean(window.__BYGONE_HOST__ && document.querySelector('.monaco-editor'))"), 'comparison renderer loads');
    const focus = async (owner) => {
        owner.window().show();
        owner.window().focus();
        await waitFor(() => owner.window().isFocused(), 'window receives focus');
        await setTimeout(80);
    };
    dialog.showOpenDialog = async () => {
        assert.ok(picks.length, 'Unexpected file picker');
        const filePaths = picks.shift();
        return { canceled: filePaths === null, filePaths: filePaths || [] };
    };
    dialog.showMessageBox = async (_owner, options) => {
        prompts.push(options.message);
        if (options.message.startsWith('Compare ')) return { response: 0 };
        if (options.type === 'warning') return { response: 2 };
        throw new Error(`Unexpected dialog: ${options.message}`);
    };
    try {
        const left = path.join(root, 'left.txt');
        const right = path.join(root, 'right.txt');
        fs.writeFileSync(left, 'left saved\n');
        fs.writeFileSync(right, 'right saved\n');
        const dirs = ['left', 'right'].map((name) => path.join(root, name));
        for (const [index, dir] of dirs.entries()) {
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'file.txt'), `directory ${index}\n`);
        }
        host.ensureMainWindow();
        await host.openDiff(left, right);
        await loaded(host);
        await focus(host);
        await edit(host, 0, 'unsaved original\n');
        const originalSession = host.session();
        const originalWindow = host.window();

        // Exercise the actual menu/picker path that used to show the replacement warning.
        picks.push(dirs);
        menuItem('Compare Directories…').click();
        await waitFor(() => hosts.size === 2 && [...hosts].some((owner) => owner.session().mode === 'directory'), 'new directory comparison window');
        const directory = [...hosts].find((owner) => owner !== host);
        assert.equal(host.session(), originalSession);
        assert.equal(host.session().multi.files[0].content, 'unsaved original\n');
        assert.equal(host.session().multi.files[0].dirty, true);
        assert.deepEqual(directory.source().paths, dirs);
        assert.ok(!prompts.some((message) => message.startsWith('Save your changes')));
        assert.equal(fs.readFileSync(left, 'utf8'), 'left saved\n');

        // Forwarded CLI launches and repeated requests also open independent windows.
        await directory.routeLaunchTarget({ kind: 'diff', leftPath: left, rightPath: right });
        const second = [...hosts].at(-1);
        assert.equal(hosts.size, 3);
        await loaded(second);
        await edit(second, 1, 'unsaved second\n');
        assert.equal(host.session().multi.files[1].content, 'right saved\n');
        assert.equal(second.session().multi.files[0].content, 'left saved\n');

        // The focused window owns Save All, even after other renderers send messages.
        await focus(host);
        menuItem('Save All').click();
        await waitFor(() => !host.session().multi.files[0].dirty, 'focused comparison saves');
        assert.equal(fs.readFileSync(left, 'utf8'), 'unsaved original\n');
        assert.equal(fs.readFileSync(right, 'utf8'), 'right saved\n');
        assert.equal(second.session().multi.files[1].dirty, true);
        await focus(second);
        menuItem('Save All').click();
        await waitFor(() => !second.session().multi.files[1].dirty, 'second comparison saves');
        assert.equal(fs.readFileSync(right, 'utf8'), 'unsaved second\n');

        // Dropped files and new blank comparisons keep the prior windows alive.
        await second.openDroppedFiles([left, right]);
        assert.equal(hosts.size, 4);
        const dropped = [...hosts].at(-1);
        await loaded(dropped);
        const blank = await openNewComparison('openBlankDiff', [true]);
        assert.equal(hosts.size, 5);
        await loaded(blank);
        assert.ok(blank.session().multi.files.every((panel) => !panel.editable));
        assert.equal(host.window(), originalWindow);

        // Closing an edited window still prompts, and Cancel retains it.
        await edit(second, 1, 'do not discard\n');
        second.window().close();
        await waitFor(() => prompts.includes('You have unsaved Bygone edits.'), 'close protects unsaved changes');
        assert.equal(second.window().isDestroyed(), false);
        assert.equal(second.session().multi.files[1].dirty, true);
        dropped.window().close();
        assert.equal(second.window().isDestroyed(), false);
        assert.equal(host.window().isDestroyed(), false);
        // A restart restores every comparison and retains read-only blank panels.
        for (const owner of [...hosts]) owner.window().destroy();
        writeWindowState(path.join(root, 'open-windows.json'), {
            version: 1,
            main: { source: { kind: 'files', paths: [left, right] } },
            comparisons: [
                { source: { kind: 'directories', paths: dirs } },
                { source: { kind: 'blank', readOnly: true } }
            ],
            tours: []
        });
        assert.equal(await restoreOpenWindowState(), true);
        assert.equal(hosts.size, 3);
        for (const owner of hosts) await waitFor(async () => !owner.window().webContents.isLoadingMainFrame()
            && await evaluate(owner, "Boolean(window.__BYGONE_HOST__ && document.querySelector('#container'))"), 'restored comparison renderer loads');
        assert.deepEqual([...hosts].map((owner) => owner.source().kind), ['files', 'directories', 'blank']);
        assert.ok([...hosts].at(-1).session().multi.files.every((panel) => !panel.editable));
        console.log('Comparison window smoke passed: independent sessions, directory picker, CLI, drops, blank, IPC, focused saves, close protection, and restoration.');
    } finally {
        dialog.showOpenDialog = originalOpen;
        dialog.showMessageBox = originalMessage;
        for (const owner of [...hosts]) owner.window()?.destroy();
        app.setPath('userData', originalUserData);
        fs.rmSync(root, { recursive: true, force: true });
    }
}

module.exports = { runComparisonWindowSmoke };
