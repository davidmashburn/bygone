/* global require, console, __dirname, setTimeout, clearTimeout */
// Run with: node scripts/run-electron.mjs standalone/exportSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
const { exportTour } = require('../cli/tourExport');
const { exportFixture } = require('../test/exportFixture');
const { serializeDocumentFragment } = require('../out/deepLink');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Export smoke timed out'); app.exit(1); }, 60000);
    const fixture = exportFixture();
    const windows = [];
    const requests = [];
    const errors = [];
    let server;
    try {
        const partition = session.fromPartition('export-smoke');
        partition.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        async function open(url, offline = true) {
            const window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: {
                contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
                ...(offline ? { session: partition } : {})
            } });
            windows.push(window);
            window.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('Electron Security Warning')) errors.push(message); });
            await window.loadURL(url);
            const evaluate = code => window.webContents.executeJavaScript(code, true);
            const wait = condition => evaluate(`new Promise((resolve, reject) => {
                const start = performance.now(); const check = () => {
                    if (${condition}) resolve(true);
                    else if (performance.now() - start > 15000) reject(new Error(${JSON.stringify(condition)} + ': ' + document.querySelector('#export-loading')?.textContent));
                    else requestAnimationFrame(check);
                }; check();
            })`);
            return { window, evaluate, wait };
        }
        for (const profile of ['minimal', 'full']) {
            const output = path.join(fixture.root, `${profile}.html`);
            exportTour(fixture.sourcePath, output, path.resolve(__dirname, '..'), { profile });
            const hash = serializeDocumentFragment('historical', { part: 'step', scene: 'scene', step: 'step' });
            const { pathToFileURL } = require('node:url');
            const fileUrl = pathToFileURL(output).href;
            const { window, evaluate, wait } = await open(fileUrl + hash);
            await wait("window.__BYGONE_EXPORT_READY__ && document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:step'");
            await wait("document.querySelectorAll('.monaco-editor').length >= 2");
            assert.equal(await evaluate("[...document.querySelectorAll('.tour-reading-item')].every(item => item.querySelector('h1 .tour-copy-location, h2 .tour-copy-location, h3 .tour-copy-location'))"), true, 'Every heading keeps its link action after narration renders');
            assert.equal(await evaluate("document.activeElement.dataset.readingKey"), 'step:scene:step');
            assert.equal(await evaluate("document.querySelector('[data-workspace-mode=history]').disabled"), profile === 'minimal');
            assert.equal(await evaluate("getComputedStyle(document.querySelector('#refresh-session')).display"), 'none');
            await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
            await wait("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && !document.querySelector('.workspace-status')?.textContent");
            await evaluate("document.querySelector('[data-workspace-mode=deconstructed]').click()");
            await wait("document.querySelector('[data-workspace-mode=deconstructed][aria-pressed=true]') && document.querySelector('[data-reading-key=\"scene:synthetic\"]')");
            await wait("location.hash.includes('mode=deconstructed')");
            await window.loadURL(window.webContents.getURL());
            await wait("window.__BYGONE_EXPORT_READY__ && document.querySelector('[data-workspace-mode=deconstructed][aria-pressed=true]')");
            await evaluate("location.hash = '#location=1&mode=historical&part=chapter&chapter=chapter'");
            await wait("document.activeElement.dataset.readingKey === 'chapter:chapter'");
            await evaluate('history.back()');
            await wait("document.querySelector('[data-workspace-mode=deconstructed][aria-pressed=true]') && document.activeElement.dataset.readingKey === 'title'");
            await evaluate('history.forward()');
            await wait("document.activeElement.dataset.readingKey === 'chapter:chapter'");
            await evaluate("location.hash = '#location=1&mode=historical&part=step&scene=scene&step=gone'");
            await wait("document.querySelector('.workspace-status')?.textContent.includes('unavailable')");
            assert.equal(await evaluate("document.querySelector('.tour-reading-item.is-active').dataset.readingKey"), 'chapter:chapter');
            if (profile === 'full') {
                await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
                await wait("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
            }
            window.destroy();
            // Fail closed on modified evidence, before starting any viewer code.
            const tampered = fs.readFileSync(output, 'utf8').replace('alpha\\nbeta\\n', 'alpha\\nTAMPERED\\n');
            assert.notEqual(tampered, fs.readFileSync(output, 'utf8'));
            fs.writeFileSync(output, tampered);
            const bad = await open(fileUrl);
            await bad.wait("document.querySelector('#export-loading')?.textContent.includes('integrity check failed')");
            assert.equal(await bad.evaluate('Boolean(window.__BYGONE_EXPORT_READY__)'), false);
            bad.window.destroy();
        }
        assert.deepEqual(requests, [], 'Embedded exports perform no network requests');
        assert.deepEqual(errors, [], 'No renderer errors');
        // The live presentation also validates a semantic target before opening.
        const presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, path.resolve(__dirname, '..'), {
            announce: false, open: false, location: { mode: 'historical', focus: { part: 'step', scene: 'scene', step: 'step' } }
        });
        server = presentation.server;
        const live = await open(presentation.url, false);
        await live.wait("document.activeElement.dataset.readingKey === 'step:scene:step'");
        assert.ok(await live.evaluate("document.querySelector('.tour-copy-location').dataset.tooltip.includes('saved current document')"), JSON.stringify({ binding: presentation.manifest.localSource, titles: await live.evaluate("[...document.querySelectorAll('.tour-copy-location')].map(b => b.title)") }));
        live.window.destroy();
        console.log('Export smoke passed: file URLs, offline runtime/workers, both profiles/modes, section links, unavailable targets, integrity failures, live presentation target.');
        clearTimeout(timeout); app.exit(0);
    } catch (error) {
        console.error(error, { requests, errors }); clearTimeout(timeout); app.exit(1);
    } finally {
        windows.forEach(window => { if (!window.isDestroyed()) window.destroy(); });
        server?.close(); fixture.dispose();
    }
});
