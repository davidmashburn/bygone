/* global require, console, __dirname, setTimeout, clearTimeout */
// Run with: node scripts/run-electron.mjs standalone/exportSmoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL, URL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { runTourHistorySmoke } = require('./tourHistorySmoke');
const { exportTour } = require('../cli/tourExport');
const { exportFixture } = require('../test/exportFixture');
const { serializeDocumentFragment, parseDeepLink } = require('../out/deepLink');
const { resolveLocalDeepLink } = require('../out/deepLinkResolver');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Export smoke timed out'); app.exit(1); }, 60000);
    const fixture = exportFixture();
    const reviews = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-external-tour-')));
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
            const fileUrl = pathToFileURL(output).href;
            const { window, evaluate, wait } = await open(fileUrl + hash);
            await wait("window.__BYGONE_EXPORT_READY__ && document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:step'");
            await wait("document.querySelectorAll('.monaco-editor').length >= 2");
            assert.equal(await evaluate("document.querySelector('[data-tour-navigator=tour]').disabled"), false);
            assert.equal(await evaluate("[...document.querySelectorAll('.tour-reading-item')].every(item => item.querySelector('h1 .tour-copy-location, h2 .tour-copy-location, h3 .tour-copy-location'))"), true, 'Every heading keeps its link action after narration renders');
            assert.equal(await evaluate("document.activeElement.dataset.readingKey"), 'step:scene:step');
            assert.equal(await evaluate("document.querySelector('[data-workspace-mode=history]').disabled"), profile === 'minimal');
            assert.equal(await evaluate("getComputedStyle(document.querySelector('#refresh-session')).display"), 'none');
            await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
            await wait("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && !document.querySelector('.workspace-status')?.textContent");
            assert.equal(await evaluate("document.querySelector('[data-tour-navigator=tour]').disabled"), true, 'Compare disables Tour navigation');
            assert.equal(await evaluate("document.querySelector('#tour-scene-count').textContent"), '');
            assert.equal(await evaluate("document.querySelector('#back-to-directory').textContent.trim()"), 'Directory');
            assert.equal(await evaluate("document.querySelector('#toggle-directory-sidebar')"), null, 'Duplicate Files control is removed');
            await evaluate("document.querySelector('#back-to-directory').click()");
            await wait("document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
            assert.equal(await evaluate("Boolean(document.querySelector('.dir-entry[data-path=\"binary.dat\"]'))"), true, 'Compare overview includes omitted binary files');
            await evaluate("document.querySelector('.dir-entry[data-path=\"app.txt\"]').click()");
            await wait("document.querySelectorAll('.monaco-editor').length >= 2 && !document.querySelector('#directory-return-toolbar').hidden");
            await evaluate("document.querySelector('#back-to-directory').click()");
            await wait("document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
            await evaluate("document.querySelector('[data-workspace-mode=deconstructed]').click()");
            await wait("document.querySelector('[data-workspace-mode=deconstructed][aria-pressed=true]') && document.querySelector('[data-reading-key=\"scene:synthetic\"]')");
            await wait("location.hash.includes('mode=deconstructed')");
            assert.equal(await evaluate("document.querySelector('[data-tour-navigator=tour]').disabled"), false, 'Tour navigation is re-enabled for a narrative mode');
            await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
            await wait("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
            await evaluate("document.querySelector('[data-workspace-mode=deconstructed]').click()");
            await wait("document.querySelector('[data-workspace-mode=deconstructed][aria-pressed=true]') && document.querySelector('[data-reading-key=\"scene:synthetic\"]')");
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
                await runTourHistorySmoke(window.webContents, 'app.txt');
                await wait("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
                assert.equal(await evaluate("document.querySelector('[data-tour-navigator=tour]').disabled"), true, 'History disables Tour navigation');
                assert.equal(await evaluate("document.querySelector('#tour-scene-count').textContent"), '');
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
        const externalTour = path.join(reviews, 'review # ö.bygone.yaml');
        const source = JSON.parse(fs.readFileSync(fixture.sourcePath, 'utf8'));
        const scenes = source.tours.historical.chapters[0].scenes;
        scenes[0].steps[0].body = 'A longer explanation keeps this step scrollable while its scene heading stays visible. '.repeat(100);
        scenes[0].steps.push({ ...scenes[0].steps[0], id: 'second-step', title: 'Second step' });
        scenes.push({ ...scenes[0], id: 'next-scene', title: 'Next scene', steps: [{ ...scenes[0].steps[0], id: 'next-step' }] });
        fs.writeFileSync(externalTour, JSON.stringify(source));
        const presentation = await startPresentation(['--tour', externalTour], fixture.root, path.resolve(__dirname, '..'), {
            announce: false, open: false, location: { mode: 'historical', focus: { part: 'step', scene: 'scene', step: 'step' } }
        });
        server = presentation.server;
        const live = await open(presentation.url, false);
        await live.wait("document.activeElement.dataset.readingKey === 'step:scene:step'");
        assert.equal(await live.evaluate("document.querySelectorAll('.tour-step-context').length"), 0);
        assert.equal(await live.evaluate("document.querySelectorAll('.tour-scene-header').length"), 2);
        assert.equal(await live.evaluate(`(() => {
            const header = document.querySelector('.tour-scene-header.is-stuck').getBoundingClientRect();
            const step = document.querySelector('[data-reading-key="step:scene:step"]').getBoundingClientRect();
            return Math.abs(header.top - document.querySelector('#tour-narrative-content').getBoundingClientRect().top) < 1
                && step.top >= header.bottom - 1;
        })()`), true, 'Deep-linked step lands beneath its sticky scene heading');
        await live.evaluate("location.hash = '#location=1&mode=historical&part=scene&scene=scene'");
        await live.wait("document.activeElement.dataset.readingKey === 'scene:scene'");
        assert.equal(await live.evaluate(`(() => {
            const header = document.querySelector('.tour-scene-header');
            const summary = header.querySelector('summary');
            return !header.classList.contains('is-stuck') && getComputedStyle(summary).visibility === 'hidden'
                && summary.getBoundingClientRect().width >= 28
                && Math.abs(header.querySelector('h2').getBoundingClientRect().left - header.querySelector('button').getBoundingClientRect().left) < 1;
        })()`), true, 'Scene overview control stays hidden while the original overview is visible');
        await live.evaluate("document.querySelector('.tour-scene-context').open = false; location.hash = '#location=1&mode=historical&part=step&scene=scene&step=step'");
        await live.wait("document.activeElement.dataset.readingKey === 'step:scene:step'");
        const initialScroll = await live.evaluate("document.querySelector('#tour-narrative-content').scrollTop");
        assert.equal(await live.evaluate(`(() => {
            const header = document.querySelector('.tour-scene-header.is-stuck');
            const summary = header.querySelector('summary');
            const title = header.querySelector('h2');
            return getComputedStyle(summary).visibility === 'visible'
                && getComputedStyle(summary, '::before').borderRightWidth === '2px'
                && summary.getBoundingClientRect().left >= title.getBoundingClientRect().right;
        })()`), true, 'Pinned heading keeps its title aligned and shows the chevron on the right');
        // Real pointer events avoid locator auto-scrolling a sticky element's original position into view.
        const togglePoint = await live.evaluate(`(() => { const r = document.querySelector('.tour-scene-header.is-stuck .tour-scene-title-toggle').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
        live.window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...togglePoint });
        live.window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...togglePoint });
        await live.wait("document.querySelector('.tour-scene-context').open");
        assert.equal(await live.evaluate("document.querySelector('#tour-narrative-content').scrollTop"), initialScroll);
        assert.equal(await live.evaluate("document.querySelector('.tour-reading-item.is-active').dataset.readingKey"), 'step:scene:step');
        assert.equal(await live.evaluate("document.querySelector('.tour-scene-context-body').getBoundingClientRect().height <= document.querySelector('#tour-narrative-content').clientHeight / 2"), true);
        await live.evaluate("document.querySelector('.tour-scene-context summary').focus({preventScroll:true})");
        live.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        live.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await live.wait("!document.querySelector('.tour-scene-context').open");
        live.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        live.window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        live.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await live.wait("document.querySelector('.tour-scene-context').open");
        assert.equal(await live.evaluate("document.querySelector('#tour-narrative-content').scrollTop"), initialScroll);
        // Scrolling advances the scene and its sticky header together, in both directions.
        await live.evaluate(`(() => {
            const content = document.querySelector('#tour-narrative-content');
            const next = document.querySelector('[data-reading-key="step:next-scene:next-step"]');
            content.scrollTop += next.getBoundingClientRect().top - content.getBoundingClientRect().top;
        })()`);
        await live.wait("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:next-scene:next-step'");
        assert.equal(await live.evaluate("document.querySelector('.tour-scene-header.is-stuck .tour-scene-heading').textContent"), 'Next scene');
        assert.equal(await live.evaluate("document.querySelector('.tour-scene-context').open"), false, 'Leaving the scene closes its overview');
        await live.evaluate(`document.querySelector('#tour-narrative-content').scrollTop = ${initialScroll}`);
        await live.wait("document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === 'step:scene:step'");
        assert.ok(await live.evaluate("document.querySelector('.tour-copy-location').dataset.tooltip.includes('saved current document')"), JSON.stringify({ binding: presentation.manifest.localSource, titles: await live.evaluate("[...document.querySelectorAll('.tour-copy-location')].map(b => b.title)") }));
        await live.evaluate(`Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedTourLink = value; } } });
            document.querySelector('[data-reading-key="step:scene:step"] .tour-copy-location').click();`);
        await live.wait('Boolean(window.copiedTourLink)');
        const copiedLink = await live.evaluate('window.copiedTourLink');
        const link = parseDeepLink(copiedLink);
        assert.equal(link.tour, pathToFileURL(externalTour).href);
        assert.deepEqual(link.focus, { part: 'step', scene: 'scene', step: 'step' });
        await live.evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
        await live.wait("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && !document.querySelector('#directory-return-toolbar').hidden");
        await live.evaluate("document.querySelector('#back-to-directory').click()");
        await live.wait("document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
        const compareUrl = await live.evaluate('location.href');
        assert.equal(new URL(compareUrl).searchParams.get('view'), 'directory');
        const compareOverviewLink = await open(compareUrl, false);
        await compareOverviewLink.wait("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
        compareOverviewLink.window.destroy();
        await runTourHistorySmoke(live.window.webContents, 'app.txt');
        const historyUrl = new URL(await live.evaluate('location.href'));
        historyUrl.hash = '';
        assert.equal(historyUrl.searchParams.get('mode'), 'history');
        assert.equal(historyUrl.searchParams.has('file'), false, 'Overview links do not select a file');
        const overviewLink = await open(historyUrl.href, false);
        await overviewLink.wait("document.querySelector('.dir-entry[data-path=\"app.txt\"]') && !document.querySelector('.monaco-editor')");
        overviewLink.window.destroy();
        historyUrl.searchParams.set('file', 'app.txt');
        const fileLink = await open(historyUrl.href, false);
        await fileLink.wait("document.querySelectorAll('.monaco-editor').length >= 2 && !document.getElementById('directory-return-toolbar').hidden");
        assert.equal(await fileLink.evaluate("new URL(location.href).searchParams.get('file')"), 'app.txt');
        fileLink.window.destroy();
        live.window.destroy();
        await new Promise(resolve => server.close(resolve));
        const resolved = resolveLocalDeepLink(copiedLink);
        const reopened = await startPresentation(['--tour', resolved.documentPath], resolved.repoRoot, path.resolve(__dirname, '..'), {
            announce: false, open: false, location: { mode: link.mode, focus: link.focus }
        });
        server = reopened.server;
        const reopenedView = await open(reopened.url, false);
        await reopenedView.wait("document.activeElement.dataset.readingKey === 'step:scene:step'");
        reopenedView.window.destroy();
        console.log('Export smoke passed: file URLs, offline runtime/workers, both profiles/modes, section links, unavailable targets, integrity failures, sticky headings and keyboard overview, outside-repo copy link and reopen after server shutdown.');
        clearTimeout(timeout); app.exit(0);
    } catch (error) {
        console.error(error, { requests, errors }); clearTimeout(timeout); app.exit(1);
    } finally {
        windows.forEach(window => { if (!window.isDestroyed()) window.destroy(); });
        server?.close(); fixture.dispose(); fs.rmSync(reviews, { recursive: true, force: true });
    }
});
