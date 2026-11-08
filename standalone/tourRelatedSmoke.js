/* global require, console, __dirname, setTimeout, clearTimeout */
// Run after compilation: node scripts/run-electron.mjs standalone/tourRelatedSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { optionalBranchesFixture } = require('../test/optionalBranchesFixture');
const { exportTour } = require('../cli/tourExport');
const { startPresentation } = require('../cli/present');
const { serializeDocumentFragment } = require('../out/deepLink');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Related explanations smoke timed out'); app.exit(1); }, 60000);
    const fixture = optionalBranchesFixture();
    const requests = [];
    let server;
    try {
        const offline = session.fromPartition(`related-${Date.now()}`);
        offline.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        const check = async (url, exported) => {
            const window = new BrowserWindow({ show: false, width: 1280, height: 800,
                webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
                    ...(exported ? { session: offline } : {}) } });
            const errors = [];
            window.webContents.on('console-message', (_event, level, message) => {
                if (level >= 3 && !message.includes('Electron Security Warning')) errors.push(message);
            });
            const evaluate = code => window.webContents.executeJavaScript(code, true);
            const wait = condition => evaluate(`new Promise((resolve, reject) => {
                const start = performance.now(); let stableFrames = 0; const check = () => {
                    stableFrames = (${condition}) ? stableFrames + 1 : 0;
                    if (stableFrames >= 3) resolve(true);
                    else if (performance.now() - start > 10000) reject(new Error(${JSON.stringify(condition)}));
                    else requestAnimationFrame(check);
                }; check();
            })`);
            try {
                await window.loadURL(url + serializeDocumentFragment('historical', { part: 'step', scene: 'scene', step: 'outcome' }));
                await wait("window.monaco?.editor.getEditors().length === 2 && document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:outcome'");
                await evaluate(`window.addEventListener('bygone:host-message', event => {
                    if (event.detail.type === 'restoreRelatedExplanationFocus') {
                        window.relatedRequest = { ...event.detail, type: 'relatedExplanations' };
                    }
                })`);
                const active = () => evaluate("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey");
                const lookup = (side, needle) => evaluate(`(() => {
                    const editor = window.monaco.editor.getEditors()[${side}];
                    const lines = editor.getValue().split('\\n');
                    const line = lines.findIndex(text => text.includes(${JSON.stringify(needle)})) + 1;
                    if (!line) throw new Error('Fixture line not found');
                    editor.focus(); editor.setPosition({ lineNumber: line, column: 1 });
                    return editor.getAction('bygone.relatedExplanations').run();
                })()`);
                await lookup(1, 'BETA');
                await wait("document.getElementById('tour-related-dialog')?.open");
                assert.equal(await active(), 'step:scene:outcome', 'Lookup preserves the narrative');
                const labels = await evaluate("[...document.querySelectorAll('#tour-related-results button')].map(button => button.textContent)");
                assert.ok(labels.some(label => label.includes('Callers observe the new value')), 'Optional explanations are discoverable');
                assert.ok(labels.length > 1, 'Several explanations of the same code remain distinct');
                assert.equal(await evaluate(`(() => {
                    const dialog = document.getElementById('tour-related-dialog');
                    const bounds = dialog.getBoundingClientRect();
                    return bounds.width > 0 && bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= innerHeight
                        && dialog.contains(document.elementFromPoint(bounds.left + 20, bounds.top + 20));
                })()`), true, 'The results dialog is visible above the comparison');
                window.showInactive();
                await wait("document.getElementById('tour-related-dialog')?.open");
                fs.writeFileSync(`/tmp/bygone-related-${exported ? 'offline' : 'live'}.png`, (await window.webContents.capturePage()).toPNG());
                window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
                window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
                await wait("!document.getElementById('tour-related-dialog').open");
                await wait("window.monaco.editor.getEditors()[1].hasTextFocus()");
                assert.equal(await active(), 'step:scene:outcome', 'Dismissal preserves the narrative');
                await lookup(0, 'beta');
                await wait("document.getElementById('tour-related-dialog')?.open");
                assert.equal(await evaluate("document.querySelectorAll('#tour-related-results button').length"), 0, 'Equal lines on the other revision do not match');
                assert.match(await evaluate("document.getElementById('tour-related-status').textContent"), /no .*reference|no .*explanation/i);
                await evaluate("document.getElementById('tour-related-dialog').close()");
                await lookup(1, 'BETA');
                await wait("document.getElementById('tour-related-dialog')?.open");
                await evaluate("[...document.querySelectorAll('#tour-related-results button')].find(button => button.textContent.includes('Callers observe the new value')).click()");
                await wait("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:reason'");
                await evaluate("document.getElementById('tour-return').click()");
                await wait("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:outcome'");
                await evaluate("window.__BYGONE_HOST__.postMessage(window.relatedRequest)");
                assert.equal(await evaluate("document.getElementById('tour-related-dialog').open"), false, 'Stale requests cannot reopen results after navigation');
                assert.deepEqual(errors, []);
                console.log(`Related explanations: ${exported ? 'offline' : 'live'} passed`);
            } finally { window.destroy(); }
        };
        const output = path.join(fixture.root, 'related.html');
        exportTour(fixture.sourcePath, output, path.resolve(__dirname, '..'));
        // A recipient opens the snapshot from a different directory without its checkout.
        const recipient = path.join(fixture.root, 'recipient');
        fs.mkdirSync(recipient);
        fs.copyFileSync(output, path.join(recipient, 'review.html'));
        await check(pathToFileURL(path.join(recipient, 'review.html')).href, true);
        assert.deepEqual(requests, [], 'Offline lookup makes no network requests');
        const presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root,
            path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        server = presentation.server;
        await check(presentation.url, false);
        console.log('Related explanations smoke passed');
    } finally {
        clearTimeout(timeout);
        if (server) await new Promise(resolve => server.close(resolve));
        fixture.dispose();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
