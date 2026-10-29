/* global require, console, setTimeout, clearTimeout */
// Walk every packaged step offline in Chromium. Optional screenshots stay outside the package.
// node scripts/run-electron.mjs standalone/tourPackageSmoke.js PACKAGE_DIR [SCREENSHOT_DIR]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Package smoke timed out'); app.exit(1); }, 120000);
    let win;
    try {
        const directory = path.resolve(process.argv[2]);
        const screenshots = process.argv[3] && path.resolve(process.argv[3]);
        if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'tour.json')));
        const steps = manifest.scenes.flatMap(scene => scene.steps.map(step => ({ scene: scene.id, step: step.id, image: step.image })));
        const offline = session.fromPartition('package-smoke');
        const requests = [];
        offline.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        win = new BrowserWindow({ show: false, width: 1366, height: 768, webPreferences: {
            session: offline, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
        } });
        const evaluate = code => win.webContents.executeJavaScript(code, true);
        const wait = condition => evaluate(`new Promise((resolve, reject) => {
            const start = performance.now(); function check() {
                if (${condition}) resolve(true);
                else if (performance.now() - start > 15000) reject(new Error(${JSON.stringify(condition)}));
                else requestAnimationFrame(check);
            } check();
        })`);
        const started = Date.now();
        await win.loadURL(pathToFileURL(path.join(directory, 'tour.html')).href);
        const active = "document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey";
        await wait(`${active} === 'title'`);
        const readyMs = Date.now() - started;
        for (const [index, item] of steps.entries()) {
            // Code tours include chapter/scene stops; screenshot guides go straight to images.
            for (let stops = 0; stops < 4; stops++) {
                const previous = await evaluate(active);
                await evaluate("document.querySelector('#tour-next').click()");
                await wait(`${active} !== ${JSON.stringify(previous)}`);
                if ((await evaluate(active)).startsWith('step:')) break;
            }
            await wait(`${active} === ${JSON.stringify(`step:${item.scene}:${item.step}`)}`);
            if (item.image) {
                await wait("document.querySelector('.tour-image-evidence img')?.naturalWidth > 0");
                assert.equal(await evaluate("document.querySelector('.tour-image-evidence img').alt"), item.image.alt);
            } else {
                await wait("document.querySelectorAll('.monaco-editor').length >= 2");
            }
            if (screenshots && [0, 14, 25, 38].includes(index)) {
                fs.writeFileSync(path.join(screenshots, `step-${index + 1}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
        assert.equal(await evaluate("document.querySelector('#tour-next').disabled"), true);
        const last = steps.at(-1);
        if (last.image) {
            win.setSize(850, 700);
            await evaluate("document.querySelector('.tour-image-evidence button').click()");
            await wait("document.querySelector('.tour-image-dialog')?.open");
            const bounds = await evaluate("(() => {const r=document.querySelector('.tour-image-dialog').getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}})()");
            assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.w && bounds.bottom <= bounds.h, JSON.stringify(bounds));
            if (screenshots) fs.writeFileSync(path.join(screenshots, 'expanded-850.png'), (await win.webContents.capturePage()).toPNG());
        }
        assert.deepEqual(requests, []);
        console.log(JSON.stringify({ title: manifest.title, steps: steps.length, readyMs, networkRequests: requests.length, viewport: '1366x768', expandedViewport: last.image ? '850x700' : null }));
    } finally { win?.destroy(); clearTimeout(timeout); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
