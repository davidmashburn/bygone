const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await check()) return; await pause(40); }
    throw new Error('Timed out: ' + label);
}
async function test(name, fn) { await fn(); console.log('FOLLOW PASS ' + name); }

exports.run = async function() {
    const fixture = process.env.BYGONE_FOLLOW_FIXTURE;
    const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: 'pipe' }).trim();
    const api = await vscode.extensions.getExtension('davidmashburn.bygone').activate();
    const docs = await Promise.all(['A', 'B', 'C'].map(n => vscode.workspace.openTextDocument(vscode.Uri.file(path.join(fixture, n + '.ts')))));
    const show = async i => { const editor = await vscode.window.showTextDocument(docs[i], { viewColumn: vscode.ViewColumn.One, preview: false }); await until(() => vscode.window.activeTextEditor?.document.uri.toString() === docs[i].uri.toString() && vscode.window.activeTextEditor.viewColumn === editor.viewColumn, 'source focus'); return editor; };
    const command = name => vscode.commands.executeCommand('bygone.' + name);
    const message = () => api.provider?.currentMessage;
    const ready = name => until(() => message()?.file2 === name && !message().follow.unavailable, name + ' rendered')
        .catch(error => { console.error('Following state:', JSON.stringify(message())); throw error; });
    const panels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputWebview && t.label.startsWith('Bygone:'));
    const webviews = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputWebview);
    let panel;
    async function buffers() {
        await until(() => api.renders > 0, 'renderer ready');
        let response;
        const requestId = Date.now();
        const listener = panel.webview.onDidReceiveMessage(m => { if (m.type === 'navigationState' && m.requestId === requestId) response = m; });
        try {
            await panel.webview.postMessage({ type: 'captureNavigationState', requestId, flushEditors: true });
            await until(() => response, 'renderer buffers');
            return response.buffers;
        } finally { listener.dispose(); }
    }
    try {
        await test('command creates one editable renderer beside source and preserves keyboard focus', async () => {
            await show(0);
            await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
            const beforeFollowing = docs[0].getText();
            await vscode.commands.executeCommand('type', { text: 'z' });
            await until(() => docs[0].getText() !== beforeFollowing, 'source typing before following');
            await vscode.commands.executeCommand('undo');
            await until(() => docs[0].getText() === beforeFollowing, 'source preflight undo');
            await command('followActiveEditor'); await ready('A.ts');
            panel = api.provider.panels.get('follow').panel;
            // Git/model readiness can precede the workbench assigning the new
            // webview its column. Wait for placement before asserting layout.
            await until(() => panel.viewColumn !== undefined, 'following panel placement');
            assert.equal(panel.viewColumn, vscode.ViewColumn.Two);
            assert.equal(vscode.window.activeTextEditor.document, docs[0]);
            assert.deepEqual(message().editableSides, { left: false, right: true });
            assert.match(message().follow.status, /No changes from HEAD/);
            await until(() => api.renders > 0, 'initial renderer');
            const original = docs[0].getText();
            await vscode.commands.executeCommand('type', { text: 'z' });
            await until(() => docs[0].getText() !== original && message().rightContent === docs[0].getText(), 'typing follows').catch(error => { console.log(JSON.stringify({ active: vscode.window.activeTextEditor?.document.uri.toString(), panelActive: panel.active, text: docs[0].getText(), message: message() })); throw error; });
            assert.equal((await buffers()).find(b => b.id === 'right').content, docs[0].getText());
            await vscode.commands.executeCommand('undo'); await until(() => message().rightContent === original, 'undo follows');
        });
        await test('background opens do not retarget; rapid switches reuse the same panel', async () => {
            await vscode.workspace.openTextDocument({ content: 'background' }); await pause(200); assert.equal(message().file2, 'A.ts');
            await show(1); await show(0); await show(2); await ready('C.ts');
            assert.equal(panels().length, 1); assert.equal(api.provider.panels.get('follow').panel, panel);
            assert.match(message().leftContent, /function c/); assert.match(message().rightContent, /function c/);
        });
        await test('a delayed Git read cannot overwrite a newer target', async () => {
            const controller = api.controller;
            const read = controller.readBaseline;
            let release, entered, staleSignal;
            const gate = new Promise(resolve => { release = resolve; });
            const started = new Promise(resolve => { entered = resolve; });
            let once = true;
            controller.readBaseline = async (...args) => {
                const baseline = await read(...args);
                if (once) { once = false; staleSignal = args[1]; entered(); await gate; }
                return baseline;
            };
            try {
                await show(0); await started;
                await show(1); await ready('B.ts');
                release(); await pause(200);
                assert.equal(staleSignal.aborted, true);
                assert.equal(message().file2, 'B.ts');
                assert.match(message().leftContent, /function b/);
            } finally { release?.(); controller.readBaseline = read; }
            await show(2); await ready('C.ts');
        });
        await test('dirty buffer, save and source undo update without writing from Bygone', async () => {
            const original = fs.readFileSync(docs[2].uri.fsPath, 'utf8');
            await vscode.window.activeTextEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '// dirty\n'));
            await until(() => message().rightContent === docs[2].getText() && /Unsaved buffer/.test(message().follow.status), 'dirty state');
            assert.equal(fs.readFileSync(docs[2].uri.fsPath, 'utf8'), original);
            await docs[2].save(); await until(() => /Saved buffer/.test(message().follow.status), 'saved state');
        });
        await test('pin freezes file and baseline through HEAD change; resume and refresh resolve current HEAD', async () => {
            const baseline = message().leftContent;
            await command('pinFollowing'); await until(() => message().follow.mode === 'pinned', 'pinned');
            await show(0); await pause(200); assert.equal(message().file2, 'C.ts');
            git('add', '.'); git('commit', '-m', 'fixture update');
            await command('refreshFollowing'); await pause(300); assert.equal(message().leftContent, baseline);
            await command('resumeFollowing'); await ready('A.ts');
            await show(2); await ready('C.ts'); assert.equal(message().leftContent, docs[2].getText());
            assert.match(message().follow.status, /No changes from HEAD/);
            await vscode.window.activeTextEditor.edit(edit => edit.insert(new vscode.Position(0, 0), '// second\n')); await docs[2].save();
            git('add', '.'); git('commit', '-m', 'second fixture update');
            await command('refreshFollowing'); await until(() => message().leftContent === docs[2].getText(), 'HEAD refresh');
        });
        await test('pinned buffer updates reuse the frozen baseline without Git reads', async () => {
            const controller = api.controller;
            await command('pinFollowing'); await until(() => message().follow.mode === 'pinned', 'pin');
            await show(0);
            const read = controller.readBaseline;
            controller.readBaseline = () => { throw new Error('Unexpected Git read during pinned edit'); };
            try {
                const edit = new vscode.WorkspaceEdit();
                edit.insert(docs[2].uri, new vscode.Position(0, 0), '// pinned edit\n');
                await vscode.workspace.applyEdit(edit);
                await until(() => message().rightContent === docs[2].getText(), 'pinned buffer');
                assert.equal(message().file2, 'C.ts'); assert.equal(message().follow.mode, 'pinned');
            } finally { controller.readBaseline = read; }
            await show(2); await command('resumeFollowing'); await ready('C.ts');
        });
        await test('focusing the follower retains its source and resume uses the last source', async () => {
            panel.reveal(panel.viewColumn, false); await until(() => panel.active, 'panel focus');
            await pause(200); assert.equal(message().file2, 'C.ts');
            await command('pinFollowing'); await show(1); await command('resumeFollowing'); await ready('B.ts');
        });
        await test('unsupported documents clear the previous comparison', async () => {
            const untitled = await vscode.workspace.openTextDocument({ content: 'untitled' });
            await vscode.window.showTextDocument(untitled, vscode.ViewColumn.One);
            await until(() => message().follow.unavailable && /local file/.test(message().follow.status), 'unsupported state');
            assert.equal(message().leftContent, ''); assert.equal(message().rightContent, '');
            await show(0); await ready('A.ts');
        });
        await test('SCM diff tabs show an explicit source-file instruction', async () => {
            await vscode.commands.executeCommand('vscode.diff', docs[0].uri, docs[1].uri, 'Native diff', { viewColumn: vscode.ViewColumn.One });
            await until(() => message().follow.unavailable && /SCM diff following is off/.test(message().follow.status), 'native diff state');
            await show(0); await ready('A.ts');
        });
        await test('binary custom editors clear the previous source', async () => {
            const uri = vscode.Uri.file(path.join(fixture, 'pixel.png'));
            fs.writeFileSync(uri.fsPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=', 'base64'));
            await vscode.commands.executeCommand('vscode.openWith', uri, 'imagePreview.previewEditor', { viewColumn: vscode.ViewColumn.One });
            await until(() => message().follow.unavailable && /custom and binary/.test(message().follow.status), 'image unavailable');
            assert.equal(message().rightContent, '');
            await show(0); await ready('A.ts');
        });
        await test('untracked files show an absent baseline', async () => {
            const uri = vscode.Uri.file(path.join(fixture, 'new.ts')); fs.writeFileSync(uri.fsPath, 'new file\n');
            await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One, preview: false });
            await ready('new.ts'); assert.equal(message().leftContent, ''); assert.match(message().follow.status, /No baseline/);
        });
        await test('history explicitly pauses following', async () => {
            await show(0); await ready('A.ts');
            await vscode.commands.executeCommand('bygone.compareActiveFileHistory', docs[0].uri);
            assert.equal(api.controller.mode, 'paused');
            await show(1); await pause(200); assert.equal(api.controller.mode, 'paused');
            for (const [key, state] of api.provider.panels) if (key !== 'follow') state.panel.dispose();
            await until(() => webviews().length === 1, 'history tab closed');
            await command('resumeFollowing'); await ready('B.ts');
        });
        await test('manual refresh captures its original panel and cannot mix A with B', async () => {
            const provider = api.provider;
            const model = message().diffModel;
            await provider.showDiff(docs[0].uri, docs[1].uri, docs[0].getText(), docs[1].getText(), model);
            const originalState = provider.activeState;
            await until(() => provider.activeState === originalState && provider.isReady, 'first manual panel ready');
            const read = provider.readCurrentSide.bind(provider);
            let release, entered;
            const gate = new Promise(resolve => { release = resolve; });
            const started = new Promise(resolve => { entered = resolve; });
            let once = true;
            provider.readCurrentSide = async (...args) => { const content = await read(...args); if (once) { once = false; entered(); await gate; } return content; };
            const refresh = provider.refreshCurrentDocumentDiff(); await started;
            await provider.showDiff(docs[1].uri, docs[2].uri, docs[1].getText(), docs[2].getText(), model);
            const otherState = provider.activeState;
            await until(() => provider.activeState === otherState && provider.isReady, 'second manual panel ready');
            release(); await refresh;
            assert.equal(provider.activeState, originalState);
            assert.equal(provider.currentMessage.leftContent, docs[0].getText());
            assert.equal(provider.currentMessage.rightContent, docs[1].getText());
            assert.equal(otherState.currentMessage.leftContent, docs[1].getText());
            provider.readCurrentSide = read;
            for (const [key, state] of provider.panels) if (key !== 'follow') state.panel.dispose();
            await until(() => webviews().length === 1, 'manual tabs closed');
            await show(0); await command('resumeFollowing'); await ready('A.ts');
        });
        await test('delayed manual comparison setup cannot replace the follower', async () => {
            const provider = api.provider;
            const language = provider.resolveLanguageId.bind(provider);
            let release, entered;
            const gate = new Promise(resolve => { release = resolve; });
            const started = new Promise(resolve => { entered = resolve; });
            let once = true;
            provider.resolveLanguageId = async uri => {
                const value = await language(uri);
                if (once) { once = false; entered(); await gate; }
                return value;
            };
            try {
                const manual = provider.showDiff(docs[0].uri, docs[1].uri, docs[0].getText(), docs[1].getText(), message().diffModel);
                await started;
                await show(2); await command('resumeFollowing'); await ready('C.ts');
                release(); await manual;
                const follow = provider.panels.get('follow');
                const payload = provider.activeState === follow ? provider.currentMessage : follow.currentMessage;
                assert.equal(payload.file2, 'C.ts');
                assert.equal(payload.rightContent, docs[2].getText());
            } finally { release?.(); provider.resolveLanguageId = language; }
            // Keep the manual tab alive through its first render before closing;
            // older VS Code cannot reopen a source while an overlay is opening.
            await until(() => provider.isReady, 'manual setup ready');
            for (const [key, state] of provider.panels) if (key !== 'follow') state.panel.dispose();
            await until(() => webviews().length === 1, 'manual setup closed');
            await show(0); await command('resumeFollowing'); await ready('A.ts');
        });
        await test('closing during an in-flight Git read discards its result', async () => {
            const controller = api.controller;
            const read = controller.readBaseline;
            let release, entered, signal;
            const gate = new Promise(resolve => { release = resolve; });
            const started = new Promise(resolve => { entered = resolve; });
            controller.readBaseline = async (...args) => {
                const baseline = await read(...args); signal = args[1]; entered(); await gate; return baseline;
            };
            try {
                await command('refreshFollowing'); await started;
                panel.dispose(); release(); await pause(200);
                assert.equal(signal.aborted, true); assert.equal(panels().length, 0);
                assert.equal(controller.view, undefined);
            } finally { release?.(); controller.readBaseline = read; }
            await show(0); await command('followActiveEditor'); await ready('A.ts');
            panel = api.provider.panels.get('follow').panel;
        });
        await test('closing cancels scheduled work; reopening is explicit; restored panel stays paused', async () => {
            await command('refreshFollowing'); panel.dispose(); await until(() => webviews().length === 0, 'follower tab closed'); await show(2); await pause(400);
            assert.equal(panels().length, 0); assert.equal(api.controller.view, undefined);
            const restored = vscode.window.createWebviewPanel('bygone.followPanel', 'Restored', vscode.ViewColumn.Two, { enableScripts: true });
            await api.controller.deserializeWebviewPanel(restored);
            await until(() => api.provider.isReady, 'restored panel ready');
            assert.equal(api.controller.mode, 'paused');
            await show(0); await pause(200); assert.equal(api.controller.mode, 'paused');
            await command('resumeFollowing'); await ready('A.ts');
            restored.dispose();
        });
        console.log('FOLLOW HOST COMPLETE VS Code ' + vscode.version);
    } finally { api.controller?.dispose(); }
};
