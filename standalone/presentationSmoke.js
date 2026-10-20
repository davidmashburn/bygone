/* global require, console, __dirname, process, Buffer, fetch, URL, setTimeout, clearTimeout */
// Run with: node scripts/run-electron.mjs standalone/presentationSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { createPackage } = require('@electron/asar');
const { exportFixture } = require('../test/exportFixture');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Presentation smoke timed out'); app.exit(1); }, 60000);
    const fixture = exportFixture();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-presentation-asar-'));
    const assets = ['web/index.html', 'web/presenter.css', 'web/web-host.js', 'media/webview.css', 'media/webview.js', 'media/editor.worker.js', 'media/diff.worker.js'];
    let presentation;
    let window;
    try {
        const source = path.join(root, 'source');
        for (const name of assets) {
            const target = path.join(source, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(path.join(__dirname, '..', name), target);
        }
        const archive = path.join(root, 'app.asar');
        await createPackage(source, archive);

        // Use Electron's own extraction API to locate only this test's temporary
        // copies, then simulate cleanup while the archive remains open and cached.
        const { Archive } = process._linkedBinding('electron_common_asar');
        const copyFileOut = Archive.prototype.copyFileOut;
        const extracted = [];
        Archive.prototype.copyFileOut = function (...args) {
            const result = copyFileOut.apply(this, args);
            extracted.push(result);
            return result;
        };
        try {
            for (const name of assets.slice(1)) fs.closeSync(fs.openSync(path.join(archive, name), 'r'));
        } finally {
            Archive.prototype.copyFileOut = copyFileOut;
        }
        assert.equal(extracted.length, assets.length - 1, 'Every runtime asset must exercise ASAR extraction');
        for (const target of extracted) {
            assert.ok(target && !target.includes('app.asar'), 'Delete only extracted temporary copies');
            fs.unlinkSync(target);
        }
        await assert.rejects(new Promise((resolve, reject) => {
            fs.createReadStream(path.join(archive, 'media/webview.js'))
                .on('error', reject).on('data', () => {}).on('end', resolve);
        }), { code: 'ENOENT' }, 'The former streaming path fails after cached extraction cleanup');

        presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, archive,
            { announce: false, open: false, ignoreEnvironment: true });
        for (const name of assets.slice(1)) {
            const response = await fetch(new URL(`/${name}`, presentation.url));
            assert.equal(response.status, 200, name);
            assert.ok(Buffer.from(await response.arrayBuffer()).equals(fs.readFileSync(path.join(source, name))), `${name}: exact asset bytes`);
        }
        window = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: {
            sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false
        } });
        await window.loadURL(`${presentation.url}#location=1&mode=historical&part=step&scene=scene&step=step`);
        await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const deadline = Date.now() + 20000;
            const check = () => {
                if (document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:step'
                    && document.querySelectorAll('.monaco-editor .view-line').length >= 2
                    && document.body.innerText.includes('Evidence')) resolve(true);
                else if (Date.now() > deadline) reject(new Error('Narrative and diff did not render: ' + document.body.innerText.slice(0, 1000)));
                else setTimeout(check, 50);
            }; check();
        })`);
        fs.writeFileSync(path.join(os.tmpdir(), 'bygone-presentation-asar.png'), (await window.webContents.capturePage()).toPNG());
        console.log('Presentation ASAR smoke passed: deleted extraction cache, exact asset bytes, sandboxed narrative and diff.');
    } finally {
        window?.destroy();
        if (presentation) await new Promise(resolve => presentation.server.close(resolve));
        fixture.dispose();
        fs.rmSync(root, { recursive: true, force: true });
        clearTimeout(timeout);
    }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
