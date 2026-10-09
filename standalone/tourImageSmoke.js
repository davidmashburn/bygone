/* global require, console, __dirname, setTimeout, clearTimeout */
// Real Chromium decoding, navigation, and offline image evidence.
// node scripts/run-electron.mjs standalone/tourImageSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { exportFixture } = require('../test/exportFixture');
const { exportTour } = require('../cli/tourExport');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Image smoke timed out'); app.exit(1); }, 60000);
    const f = exportFixture();
    let win;
    try {
        fs.copyFileSync(path.resolve(__dirname, '../docs/visual-walkthrough/images/01-two-files.png'), path.join(f.root, 'screen.png'));
        f.git('add', 'screen.png'); f.git('commit', '-m', 'Screenshot evidence');
        const source = JSON.parse(JSON.stringify(f.source));
        source.range.head = f.git('rev-parse', 'HEAD');
        delete source.tours;
        const steps = source.chapters[0].scenes[0].steps;
        steps.push({ ...steps[0], id: 'code', title: 'Code evidence' });
        steps[0].image = { file: 'screen.png', revision: 'head', alt: 'Two comparison panes' };
        fs.writeFileSync(f.sourcePath, JSON.stringify(source));
        const offline = session.fromPartition('image-evidence-smoke');
        const requests = [], errors = [];
        offline.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        for (const profile of ['minimal', 'full']) {
            const output = path.join(f.root, `${profile}.html`);
            exportTour(f.sourcePath, output, path.resolve(__dirname, '..'), { profile });
            win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: {
                session: offline, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false
            } });
            win.webContents.on('console-message', (_event, level, message) => {
                if (level >= 3 && !message.includes('Electron Security Warning')) errors.push(message);
            });
            const evaluate = code => win.webContents.executeJavaScript(code, true);
            const wait = condition => evaluate(`new Promise((resolve, reject) => {
                const start = performance.now(); function check() {
                    if (${condition}) resolve(true);
                    else if (performance.now() - start > 10000) reject(new Error(${JSON.stringify(condition)}));
                    else requestAnimationFrame(check);
                } check();
            })`);
            await win.loadURL(pathToFileURL(output).href + '#location=1&mode=historical&part=step&scene=scene&step=step');
            await wait("document.querySelector('.tour-image-evidence img')?.naturalWidth === 2880");
            assert.equal(await evaluate("document.querySelector('.tour-image-evidence img').alt"), 'Two comparison panes');
            assert.equal(await evaluate("getComputedStyle(document.querySelector('#diff-workspace')).display"), 'none');
            await evaluate("document.querySelector('.tour-image-evidence button').click()");
            await wait("document.querySelector('.tour-image-dialog')?.open");
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait("!document.querySelector('.tour-image-dialog')?.open");
            await evaluate("location.hash = '#location=1&mode=historical&part=step&scene=scene&step=code'");
            await wait("!document.body.classList.contains('tour-image-active') && document.querySelectorAll('.monaco-editor').length >= 2");
            assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#diff-workspace')).display"), 'none');
            await evaluate("location.hash = '#location=1&mode=historical&part=step&scene=scene&step=step'");
            await wait("document.querySelector('.tour-image-evidence img')?.naturalWidth === 2880");
            await evaluate("document.querySelector('.tour-file[data-file-path=\"app.txt\"]').click()");
            await wait("!document.body.classList.contains('tour-image-active') && !document.querySelector('#tour-return-focus').hidden");
            await evaluate("document.querySelector('#tour-return-focus').click()");
            await wait("document.querySelector('.tour-image-evidence img')?.naturalWidth === 2880 && document.querySelector('#tour-return-focus').hidden");
            await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
            await wait("document.querySelector('[data-workspace-mode=compare][aria-selected=true]') && !document.body.classList.contains('tour-image-active')");
            assert.equal(await evaluate("document.querySelector('.tour-image-dialog')"), null);
            // A pure screenshot guide opens with its Intro and crosses chapter/scene
            // boundaries without turning their headings into file-inventory stops.
            const guide = JSON.parse(JSON.stringify(source));
            const firstScene = guide.chapters[0].scenes[0];
            firstScene.steps[1].image = { ...firstScene.steps[0].image };
            firstScene.steps[1].title = 'Second image';
            guide.chapters.push({ id: 'second-chapter', title: 'Second chapter', scenes: [{
                ...firstScene, id: 'second-scene', title: 'Second scene', steps: [firstScene.steps[0]]
            }] });
            fs.writeFileSync(f.sourcePath, JSON.stringify(guide));
            const guideOutput = path.join(f.root, `guide-${profile}.html`);
            exportTour(f.sourcePath, guideOutput, path.resolve(__dirname, '..'), { profile });
            fs.writeFileSync(f.sourcePath, JSON.stringify(source));
            await win.loadURL(pathToFileURL(guideOutput).href);
            const activeKey = "document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey";
            await wait(`${activeKey} === 'title'`);
            assert.match(await evaluate("document.querySelector('.tour-route-evidence').textContent"), /images in reading order/);
            const press = async (key, expected) => {
                await evaluate(`document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(key)},bubbles:true}))`);
                await wait(`${activeKey} === ${JSON.stringify(expected)}`);
                assert.equal(await evaluate("document.body.classList.contains('tour-directory-overview')"), false);
            };
            await press('ArrowRight', 'step:scene:step');
            await wait("document.querySelector('.tour-image-evidence img')?.naturalWidth === 2880");
            await press('ArrowLeft', 'title');
            await press('ArrowRight', 'step:scene:step');
            await press('ArrowRight', 'step:scene:code');
            await press('ArrowRight', 'step:second-scene:step');
            await press('ArrowLeft', 'step:scene:code');
            await evaluate("location.hash = '#location=1&mode=historical&part=chapter&chapter=second-chapter'");
            await wait(`${activeKey} === 'step:second-scene:step'`);
            assert.equal(await evaluate("document.body.classList.contains('tour-directory-overview')"), false);
            win.destroy(); win = undefined;
        }
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        console.log('Image evidence smoke passed: Minimal and Full decode offline, expand, close, return from Files, and restore code/Compare.');
    } finally { win?.destroy(); f.dispose(); clearTimeout(timeout); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
