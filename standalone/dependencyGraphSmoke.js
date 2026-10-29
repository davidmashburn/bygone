/* global require, console, setTimeout, clearTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { dependencyIntegrationFixture } = require('../test/dependencyIntegrationFixture');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 45000);
    let f, window;
    try {
        f = await dependencyIntegrationFixture();
        const html = path.join(f.root, 'graph.html'); fs.writeFileSync(html, f.html);
        window = new BrowserWindow({ show: false, width: 1280, height: 900,
            webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
        await window.loadFile(html);
        const evaluate = code => window.webContents.executeJavaScript(code, true);
        await evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){
            if(document.querySelector('#graph svg .node')) return resolve();
            if(document.querySelector('#status.error') || performance.now()-start>15000) return reject(new Error(document.querySelector('#status').textContent));
            requestAnimationFrame(check);}check();})`);
        assert.match(await evaluate("document.getElementById('focus').textContent"), /run/);
        assert.match(await evaluate("document.getElementById('changes').textContent"), /1 added calls · 1 removed calls/);
        await evaluate(`window.__messages=[]; window.addEventListener('message',e=>window.__messages.push(e.data));document.querySelector('#focus button').click();`);
        const message = await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(window.__messages[0]),30))`);
        assert.equal(message.type, 'dependencySource');
        assert.equal(message.source.oid, f.range.headOid);
        assert.equal(message.source.file, 'app.ts');
        assert.equal(message.source.line, 3);
        await evaluate("document.getElementById('changes-panel').open=true");
        fs.mkdirSync('/tmp/bygone-dependency-integration', { recursive: true });
        fs.writeFileSync('/tmp/bygone-dependency-integration/graph.png', (await window.webContents.capturePage()).toPNG());
        fs.copyFileSync(html, '/tmp/bygone-dependency-integration/demo.html');
        console.log('Dependency graph smoke passed: layout, correspondence deltas, exact source messages. Screenshot /tmp/bygone-dependency-integration/graph.png');
    } catch (error) { console.error(error); app.exitCode = 1; }
    finally { clearTimeout(timeout); window?.destroy(); f?.dispose(); app.exit(app.exitCode || 0); }
});
