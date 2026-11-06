/* global require, console, __dirname, setTimeout, clearTimeout */
// Run after npm run compile: node scripts/run-electron.mjs standalone/tourChecksSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { exportFixture } = require('../test/exportFixture');
const { exportTour } = require('../cli/tourExport');
const { startPresentation } = require('../cli/present');
const { ChangeTourCheckCategory: Category, ChangeTourCheckStatus: Status } = require('../out/changeTour');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Checks smoke timed out'); app.exit(1); }, 60000);
    const fixture = exportFixture();
    const windows = [];
    const errors = [];
    const requests = [];
    let server;
    try {
        fixture.source.version = 7;
        delete fixture.source.tours;
        fixture.source.details = { checks: {
            [Category.Claims]: {
                status: Status.Partial,
                summary: 'The check-disclosure-marker remains outside the main explanation.',
                details: 'Supporting [source evidence](https://example.test/evidence).'
            },
            [Category.Behavior]: { status: Status.NotChecked, summary: 'Runtime behavior was not exercised.' }
        } };
        fs.writeFileSync(fixture.sourcePath, JSON.stringify(fixture.source));
        const offline = session.fromPartition(`checks-${Date.now()}`);
        offline.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        async function check(url, exported) {
            const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
                contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
                ...(exported ? { session: offline } : {})
            } });
            windows.push(window);
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
            await window.loadURL(url);
            await wait("document.querySelector('.tour-checks') && document.querySelector('.tour-reading-item')");
            assert.equal(await evaluate("document.querySelector('.tour-checks').open"), false);
            assert.equal(await evaluate("document.querySelector('#tour-narrative-content').textContent.includes('check-disclosure-marker')"), false);
            await evaluate("document.querySelector('.tour-details > summary').click(); document.querySelector('.tour-checks > summary').focus()");
            assert.equal(await evaluate("document.activeElement === document.querySelector('.tour-checks > summary')"), true);
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
            window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
            await wait("document.querySelector('.tour-checks').open");
            const summaries = await evaluate("Array.from(document.querySelectorAll('.tour-check-category > summary'), node => node.textContent)");
            assert.deepEqual(summaries, [
                'Provenance · Not checked', 'Claims · Partial', 'Behavior · Not checked',
                'Coverage · Not checked', 'Uncertainty · Not checked'
            ]);
            await evaluate("document.querySelector('[data-check-category=claims] > summary').click()");
            assert.equal(await evaluate("document.querySelector('[data-check-category=claims]').open"), true);
            assert.equal(await evaluate("document.querySelector('[data-check-category=claims] a').href"), 'https://example.test/evidence');
            assert.equal(await evaluate("document.querySelectorAll('.tour-check-category[open]').length"), 1);
            await evaluate("document.querySelector('.tour-checks').scrollIntoView({ block: 'start' })");
            await wait("document.querySelector('[data-check-category=claims] a').getBoundingClientRect().bottom <= document.querySelector('.tour-details').getBoundingClientRect().bottom");
            fs.writeFileSync(path.join(os.tmpdir(), `bygone-checks-${exported ? 'offline' : 'live'}.png`), (await window.webContents.capturePage()).toPNG());
            window.destroy();
        }
        const output = path.join(fixture.root, 'checks.html');
        exportTour(fixture.sourcePath, output, path.resolve(__dirname, '..'));
        await check(pathToFileURL(output).href, true);
        const presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        server = presentation.server;
        await check(presentation.url, false);
        assert.deepEqual(requests, [], 'Offline viewer never fetches source links without reader activation');
        assert.deepEqual(errors, [], 'No reader console errors');
        console.log('Checks smoke passed: live/offline, native keyboard disclosure, honest omissions, safe links, outside reading.');
    } finally {
        for (const window of windows) if (!window.isDestroyed()) window.destroy();
        if (server) await new Promise(resolve => server.close(resolve));
        fixture.dispose();
        clearTimeout(timeout);
    }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
