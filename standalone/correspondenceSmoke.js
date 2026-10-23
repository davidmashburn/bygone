/* global require, __dirname, console, setTimeout, clearTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { correspondenceFixture, source } = require('../test/correspondenceFixture');
const { importChangeCorrespondence } = require('../out/changeCorrespondence');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 45000);
    const fixture = correspondenceFixture(); let presentation, window;
    try {
        const artifact = importChangeCorrespondence(fixture.root, source, fixture.range);
        const file = path.join(fixture.root, 'correspondence.json'); fs.writeFileSync(file, JSON.stringify(artifact));
        presentation = await startPresentation(['--base', fixture.range.baseOid, '--correspondence', file], fixture.root,
            path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        window = new BrowserWindow({ show: false, width: 1280, height: 900,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
        await window.loadURL(presentation.url);
        const evaluate = code => window.webContents.executeJavaScript(code, true);
        const wait = condition => evaluate(`new Promise((resolve, reject) => {
            const began=performance.now(); const check=()=>{
                if (${condition}) return resolve(true);
                if (performance.now()-began>15000) return reject(new Error('Correspondence UI timed out'));
                requestAnimationFrame(check);
            };check();
        })`);
        await wait("document.querySelector('#correspondence-tab') && !document.querySelector('#correspondence-tab').hidden");
        const selected = await evaluate(`(() => {
            window.__symbolSmokeMessages=[];
            window.addEventListener('bygone:host-message', e=>window.__symbolSmokeMessages.push(e.detail));
            document.getElementById('correspondence-tab').click();
            const filter=document.getElementById('correspondence-filter'); filter.value='validateChangeTourDetails';
            filter.dispatchEvent(new Event('input'));
            const buttons=[...document.querySelectorAll('#correspondence-list button')];
            if (buttons.length!==1) throw new Error('Expected a unique symbol result');
            buttons[0].click();
            const message=window.__symbolSmokeMessages.at(-1);
            return { count:buttons.length, message, status:document.getElementById('correspondence-status').textContent,
                visible:getComputedStyle(document.querySelector('#container')).visibility };
        })()`);
        assert.equal(selected.count, 1); assert.equal(selected.visible, 'visible');
        assert.match(selected.message.file1, /src\/tourAssessment.ts:85/); assert.match(selected.message.file2, /src\/tourDetails.ts:22/);
        assert.match(selected.message.leftContent, /validateAssessment\(value.assessment/);
        assert.doesNotMatch(selected.message.rightContent, /validateAssessment\(value.assessment/);
        assert.deepEqual(selected.message.editableSides, { left: false, right: false });
        assert.match(selected.status, /Behavior unassessed/);
        await evaluate(`document.querySelector('[data-tour-navigator="files"]').click(); document.querySelector('#tour-files button[data-file-path="src/tourDetails.ts"]').click()`);
        const full = await evaluate('window.__symbolSmokeMessages.at(-1)');
        assert.equal(full.rightContent, source.after['src/tourDetails.ts']);
        console.log('Correspondence browser smoke passed: cross-file declaration comparison, deleted validation visible, read-only panes, full-file return.');
    } finally {
        clearTimeout(timeout); if (window) window.destroy();
        if (presentation) await new Promise(resolve => presentation.server.close(resolve)); fixture.dispose();
    }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
