/* global require, console, __dirname, setTimeout, clearTimeout */
// Run after npm run compile: node scripts/run-electron.mjs standalone/tourBranchesSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { optionalBranchesFixture } = require('../test/optionalBranchesFixture');
const { exportTour } = require('../cli/tourExport');
const { serializeDocumentFragment } = require('../out/deepLink');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Branch smoke timed out'); app.exit(1); }, 60000);
    const fixture = optionalBranchesFixture();
    fixture.source.chapters[0].scenes[0].steps[1].branches = ['one', 'two'].map(id => ({
        id: `choice-${id}`, title: `Optional choice ${id}`, steps: [{ id: `choice-step-${id}`, title: `Choice ${id}`, body: 'An optional alternative.', focus: 'changed' }]
    }));
    fs.writeFileSync(fixture.sourcePath, JSON.stringify(fixture.source));
    const errors = [];
    const requests = [];
    const windows = [];
    let server;
    try {
        const offline = session.fromPartition(`branches-${Date.now()}`);
        offline.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            requests.push(details.url); callback({ cancel: true });
        });
        async function check(url, exported) {
            const window = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: {
                contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
                ...(exported ? { session: offline } : {})
            } });
            windows.push(window);
            // Exercise the same controls with no speech engine at all.
            await window.loadURL('about:blank');
            window.webContents.debugger.attach('1.3');
            await window.webContents.debugger.sendCommand('Page.enable');
            await window.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
                source: "delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;"
            });
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
            const active = async id => {
                try { await wait(`document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:${id}'`); }
                catch (error) { console.error('Expected', id, 'actual', await evaluate("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey"), errors); throw error; }
            };
            const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
            const key = (key, shiftKey = false, selector = '#tour-keyboard-navigation') => evaluate(`(() => {
                const event = new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, shiftKey: ${shiftKey}, bubbles: true, cancelable: true });
                document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event); return event.defaultPrevented;
            })()`);
            const selected = () => evaluate("document.querySelector('.tour-narration-segment.is-speaking')?.dataset.narrationSegmentId");
            const keys = () => evaluate("[...document.querySelectorAll('.tour-reading-item[data-reading-kind=step]')].map(e => e.dataset.readingKey)");
            const hash = id => serializeDocumentFragment('historical', { part: 'step', scene: 'scene', step: id });
            console.log(`Checking ${exported ? 'offline' : 'live'} reader`);
            await window.loadURL(url + hash('outcome'));
            await active('outcome');
            assert.equal(await evaluate("document.querySelector('[data-outline-branch-id=why]').open"), false);
            assert.equal(await evaluate(`(() => {
                const toolbar = document.querySelector('.tour-narrative-toolbar');
                const controls = [...toolbar.children].filter(element => element.getBoundingClientRect().width);
                const row = controls[0].getBoundingClientRect();
                return controls.every(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.top < row.bottom && rect.bottom > row.top
                        && rect.right <= toolbar.getBoundingClientRect().right + 1;
                });
            })()`), true, 'Primary controls share one row at 1280px without overflowing');
            assert.equal(await evaluate("document.getElementById('correspondence-availability').checkVisibility()"), false, 'Missing symbol analysis does not consume the tour outline');
            await click('.tour-details > summary');
            assert.equal(await evaluate("document.getElementById('correspondence-availability').checkVisibility()"), true, 'Symbol setup guidance remains available in Tour details');
            await click('.tour-details > summary');
            await click('.tour-feedback-more > summary');
            assert.equal(await evaluate("document.getElementById('tour-feedback-explain').checkVisibility()"), true);
            await click('#tour-feedback-explain');
            await wait("document.querySelector('.tour-feedback-dialog[open]')");
            assert.equal(await evaluate("document.querySelector('.tour-feedback-more').open"), false);
            await evaluate("document.querySelector('.tour-feedback-dialog').close()");
            assert.equal(await evaluate('typeof speechSynthesis'), 'undefined');
            assert.equal(await evaluate("document.getElementById('tour-listen').disabled"), true);
            await evaluate("document.getElementById('tour-next').focus()");
            await key('ArrowDown', true, '#tour-next');
            assert.equal(await evaluate('document.activeElement.id'), 'tour-next', 'Sentence shortcuts preserve invoking control focus');
            const parentSentence = await selected();
            assert.ok(parentSentence, 'Silent navigation visibly selects a sentence without device speech');
            assert.equal(await key('ArrowDown', true, '#tour-narrative-content'), false, 'Prose retains selection keys');
            assert.equal(await key('ArrowDown', false, '#tour-narrative-content'), false, 'Prose retains native scrolling');
            await key('ArrowRight'); await active('reason');
            await key('ArrowLeft'); await active('outcome');
            assert.equal(await selected(), parentSentence, 'Return restores the parent sentence');
            await evaluate("document.getElementById('tour-keyboard-navigation').focus()");
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
            await active('boundary');
            await key('ArrowRight');
            await wait("document.querySelector('.tour-detail-chooser[open]')");
            assert.equal(await key('ArrowDown', true), false, 'Dialog owns its keys');
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
            await wait("!document.querySelector('.tour-detail-chooser') && document.activeElement.id === 'tour-keyboard-navigation'");
            await active('boundary');
            await key('ArrowRight');
            await click('.tour-detail-chooser button'); await active('choice-step-one');
            await key('Escape'); await active('boundary');
            await key('ArrowUp'); await active('outcome');
            window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
            window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
            await wait("document.activeElement.id !== 'tour-keyboard-navigation'");
            await evaluate("document.querySelector('[data-outline-branch-id=why]').open = false");
            assert.deepEqual(await keys(), ['step:scene:outcome', 'step:scene:boundary', 'step:scene:finish']);
            assert.match(await evaluate("document.getElementById('tour-reading-plan').textContent"), /Next: The next main claim stays close.*Optional detail is skipped by Next and narration/);
            assert.equal(await evaluate("document.getElementById('tour-next').textContent"), 'Next ↓');
            assert.equal(await evaluate("document.querySelector('[data-outline-branch-id=why]').open"), false);
            assert.equal(await evaluate(`(() => {
                const toolbar = document.querySelector('.tour-narrative-toolbar');
                const controls = [...toolbar.children].filter(element => element.getBoundingClientRect().width);
                const row = controls[0].getBoundingClientRect();
                return controls.every(element => {
                    const rect = element.getBoundingClientRect();
                    return rect.top < row.bottom && rect.bottom > row.top
                        && rect.right <= toolbar.getBoundingClientRect().right + 1;
                });
            })()`), true, 'Primary controls share one row at 1280px without overflowing');
            assert.equal(await evaluate("document.getElementById('correspondence-availability').checkVisibility()"), false, 'Missing symbol analysis does not consume the tour outline');
            await click('.tour-details > summary');
            assert.equal(await evaluate("document.getElementById('correspondence-availability').checkVisibility()"), true, 'Symbol setup guidance remains available in Tour details');
            await click('.tour-details > summary');
            await click('.tour-feedback-more > summary');
            assert.equal(await evaluate("document.getElementById('tour-feedback-explain').checkVisibility()"), true);
            await click('#tour-feedback-explain');
            await wait("document.querySelector('.tour-feedback-dialog[open]')");
            assert.equal(await evaluate("document.querySelector('.tour-feedback-more').open"), false);
            await evaluate("document.querySelector('.tour-feedback-dialog').close()");
            await click('[data-outline-branch-id=why] > summary');
            await active('outcome');
            assert.match(await evaluate("document.querySelector('[data-outline-branch-id=why] .tour-outline-branch-status').textContent"), /Outside reading path/);
            await click('[data-outline-branch-id=why] > summary');
            await click('#tour-next'); await active('boundary');
            await click('#tour-back'); await active('outcome');
            const scroll = await evaluate("document.getElementById('tour-narrative-content').scrollTop");
            await click('[data-branch-id=why]'); await active('reason');
            assert.deepEqual(await keys(), ['step:scene:reason', 'step:scene:qualification']);
            assert.equal(await evaluate("document.getElementById('tour-next').textContent"), 'Next ↓');
            assert.match(await evaluate("document.getElementById('tour-reading-plan').textContent"), /Next: The scope remains bounded.*Deeper detail is skipped/);
            assert.equal(await evaluate("document.querySelector('[data-outline-branch-id=why]').open"), true);
            assert.equal(await evaluate("document.querySelector('#tour-scenes [aria-current=location]').dataset.readingLink"), 'step:scene:reason');
            assert.match(await evaluate("document.querySelector('[data-outline-branch-id=why] .tour-outline-branch-status').textContent"), /Reading now/);
            assert.match(await evaluate("document.querySelector('[data-outline-branch-id=evidence] .tour-outline-branch-status').textContent"), /Outside reading path/);
            assert.equal(await evaluate(`(() => {
                const content = document.getElementById('tour-narrative-content').getBoundingClientRect();
                const nav = document.querySelector('.tour-branch-navigation').getBoundingClientRect();
                const heading = document.querySelector('.tour-reading-item.is-active h3').getBoundingClientRect();
                return nav.top >= content.top - 1 && nav.bottom <= content.bottom && heading.top >= nav.bottom - 1;
            })()`), true, 'Return controls remain visible without covering the active heading');
            await click('[data-branch-id=evidence]'); await active('proof');
            assert.deepEqual(await keys(), ['step:scene:proof']);
            assert.equal(await evaluate("document.querySelector('#tour-scenes [aria-current=location]').dataset.readingLink"), 'step:scene:proof');
            assert.match(await evaluate("document.querySelector('[data-outline-branch-id=why] .tour-outline-branch-status').textContent"), /Parent path · paused/);
            assert.equal(await evaluate("document.getElementById('tour-reading-plan').textContent"), 'End of detail. Next and narration stop here.');
            assert.match(await evaluate("document.querySelector('.tour-branch-return').textContent"), /Return to parent detail: Callers observe the new value/);
            assert.equal(await evaluate("document.querySelector('.tour-branch-continue').textContent"), 'Continue parent detail ↓ The scope remains bounded');
            assert.match(await evaluate("document.querySelector('.tour-branch-label').textContent"), /Why does this change matter.*What evidence supports this/);
            assert.equal(await evaluate("document.getElementById('tour-next').disabled"), true);
            await wait("document.querySelector('.tour-step-code-location')?.textContent.includes('late.txt')");
            await click('.tour-branch-return'); await active('reason');
            await click('#tour-next'); await active('qualification');
            assert.equal(await evaluate("document.getElementById('tour-next').disabled"), true);
            await click('.tour-branch-return'); await active('outcome');
            assert.ok(Math.abs(await evaluate("document.getElementById('tour-narrative-content').scrollTop") - scroll) < 2, 'Return restores parent scroll');
            await click('[data-branch-id=why]'); await active('reason');
            await click('[data-branch-id=evidence]'); await active('proof');
            await click('.tour-branch-continue'); await active('qualification');
            await click('.tour-branch-continue'); await active('boundary');
            assert.match(await evaluate("document.getElementById('tour-outline-scope').textContent"), /Reading main path/);
            // An outline destination can enter nested detail directly, independently of disclosure.
            await click('#tour-scenes [data-reading-link="step:scene:proof"]'); await active('proof');
            await click('.tour-branch-continue'); await active('qualification');
            await click('.tour-branch-continue'); await active('boundary');
            await evaluate("const input = document.getElementById('tour-search-input'); input.value = 'optional-evidence-marker'; input.dispatchEvent(new Event('input', {bubbles:true}));");
            await wait("document.querySelector('.tour-search-result')");
            await click('.tour-search-result'); await active('proof');
            await click('.tour-branch-return'); await active('reason');
            await window.loadURL(url + hash('proof')); await active('proof');
            await click('.tour-branch-return'); await active('reason');
            await click('.tour-branch-return'); await active('outcome');
            await click('[data-branch-id=why]'); await active('reason');
            fs.writeFileSync(path.join(os.tmpdir(), `bygone-branches-${exported ? 'offline' : 'live'}.png`), (await window.webContents.capturePage()).toPNG());
            window.setSize(700, 700);
            await wait('window.innerWidth === 700');
            await click('#tour-sidebar-hide');
            await wait("document.getElementById('tour-sidebar-show').hidden === false");
            assert.equal(await evaluate("document.getElementById('tour-back').getBoundingClientRect().left >= document.getElementById('tour-sidebar-show').getBoundingClientRect().right"), true, 'Sidebar toggle does not cover step controls');
            fs.writeFileSync(path.join(os.tmpdir(), `bygone-branches-${exported ? 'offline' : 'live'}-narrow.png`), (await window.webContents.capturePage()).toPNG());
            assert.equal(await evaluate("document.querySelector('#tour-narrative-content').scrollWidth <= document.querySelector('#tour-narrative-content').clientWidth"), true, 'Branch controls fit a narrow viewport');
            window.destroy();
        }
        const output = path.join(fixture.root, 'branches.html');
        exportTour(fixture.sourcePath, output, path.resolve(__dirname, '..'));
        await check(pathToFileURL(output).href, true);
        const presentation = await startPresentation(['--tour', fixture.sourcePath], fixture.root, path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        server = presentation.server;
        await check(presentation.url, false);
        assert.deepEqual(requests, [], 'Export makes no network requests');
        assert.deepEqual(errors, [], 'No reader console errors');
        console.log('Branch smoke passed: main/optional navigation, nested return, scroll, search, deep links, live and offline.');
    } finally {
        for (const window of windows) if (!window.isDestroyed()) window.destroy();
        if (server) await new Promise(resolve => server.close(resolve));
        fixture.dispose();
        clearTimeout(timeout);
    }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
