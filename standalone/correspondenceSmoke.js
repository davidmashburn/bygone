/* global require, __dirname, console, setTimeout, clearTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { correspondenceFixture, source } = require('../test/correspondenceFixture');
const { correspondenceTreeFixture } = require('../test/correspondenceTreeFixture');
const { importChangeCorrespondence, validateChangeCorrespondence } = require('../out/changeCorrespondence');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 45000);
    const fixture = correspondenceFixture(); let presentation, window, outlineFixture;
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
                if (performance.now()-began>15000) return reject(new Error('Correspondence UI timed out: ' + ${JSON.stringify(condition)}));
                requestAnimationFrame(check);
            };check();
        })`);
        await wait("document.querySelector('#correspondence-tab') && !document.querySelector('#correspondence-tab').hidden");
        assert.match(await evaluate("document.getElementById('correspondence-limitations').textContent"), /Detailed diagnostics unavailable/);
        const selected = await evaluate(`(() => {
            window.__symbolSmokeMessages=[];
            window.addEventListener('bygone:host-message', e=>window.__symbolSmokeMessages.push(e.detail));
            document.getElementById('correspondence-tab').click();
            const filter=document.getElementById('correspondence-filter'); filter.value='validateChangeTourDetails';
            filter.dispatchEvent(new Event('input'));
            const buttons=[...document.querySelectorAll('#correspondence-list .correspondence-item[data-source-reference="false"]')];
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
        await new Promise(resolve => presentation.server.close(resolve)); presentation = null;
        const outline = correspondenceTreeFixture(); outlineFixture = correspondenceFixture(outline);
        outline.artifact.diagnostics = { version: 1, scope: ['Changed synthetic files only; unchanged files are outside the search.'], records: [
            { category: 'syntax', reason: 'python-binding-not-inventoried', locations: [{ side: 'before', path: 'src/outline.py', start: 0 }] },
            { category: 'rejected', reason: 'unresolved-container', producerId: 'synthetic-record', locations: [
                { side: 'before', path: 'src/outline.py', reason: 'container-boundary-mismatch' },
                { side: 'after', path: 'src/outline.py', reason: 'container-name-mismatch' }] },
            { category: 'relationship', reason: 'extract', locations: [{ side: 'after', path: 'src/outline.py', symbolId: 'after-kept' }] },
            { category: 'problem', reason: 'engine-truncated', message: 'Synthetic partial export.', locations: [] }
        ] };
        const treeArtifact = validateChangeCorrespondence(outlineFixture.root, { ...outline.artifact, range: outlineFixture.range }, outlineFixture.range);
        const treeFile = path.join(outlineFixture.root, 'tree.json'); fs.writeFileSync(treeFile, JSON.stringify(treeArtifact));
        presentation = await startPresentation(['--base', outlineFixture.range.baseOid, '--correspondence', treeFile], outlineFixture.root,
            path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        await window.loadURL(presentation.url);
        await wait("document.querySelector('#correspondence-tab') && !document.querySelector('#correspondence-tab').hidden");
        const hierarchy = await evaluate(`(() => {
            window.__symbolSmokeMessages=[];
            window.addEventListener('bygone:host-message', e=>window.__symbolSmokeMessages.push(e.detail));
            document.getElementById('correspondence-tab').click();
            const stable=document.querySelector('[data-symbol-key="after:after-Stable"]');
            const moves=document.querySelectorAll('[data-correspondence-id="relation-transfer"]');
            return {context:stable.classList.contains('is-context'), ambiguous:stable.querySelectorAll('.correspondence-item').length,
                moves:moves.length, status:document.getElementById('correspondence-status').textContent};
        })()`);
        assert.ok(hierarchy.context); assert.equal(hierarchy.ambiguous, 3); assert.equal(hierarchy.moves, 2);
        assert.match(hierarchy.status, /3 of 6 inferred mappings/); assert.match(hierarchy.status, /4 unmatched symbols/);
        // Native keyboard activation must expand/collapse without opening a diff.
        await evaluate(`document.querySelector('[data-symbol-key="after:after-Work"] > .correspondence-heading > .correspondence-toggle').focus()`);
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await wait(`document.querySelector('[data-symbol-key="after:after-Work"] > ul').hidden`);
        assert.equal(await evaluate('window.__symbolSmokeMessages.length'), 0);
        const filtered = await evaluate(`(() => {
            const filter=document.getElementById('correspondence-filter');
            const search=value=>{filter.value=value;filter.dispatchEvent(new Event('input'));};
            search('nested'); const empty=document.getElementById('correspondence-list').textContent;
            document.getElementById('correspondence-all').click();
            const nested=document.querySelector('[data-symbol-key="after:after-nested"]');
            const method=nested.parentElement.closest('li'), work=method.parentElement.closest('li');
            nested.querySelector('.correspondence-item').click();
            const result={paired:window.__symbolSmokeMessages.at(-1),empty,method:method.dataset.symbolKey,work:work.dataset.symbolKey,
                expanded:!work.querySelector(':scope > ul').hidden};
            search(''); result.collapsedAgain=document.querySelector('[data-symbol-key="after:after-Work"] > ul').hidden;
            search('fresh_only'); document.querySelector('.correspondence-item').click();
            result.unmatched=window.__symbolSmokeMessages.at(-1);
            result.selection=document.getElementById('correspondence-selection').textContent;
            search('uncertain'); document.querySelector('[data-symbol-key="before:before-uncertain"] .correspondence-item').click();
            result.ambiguous=window.__symbolSmokeMessages.at(-1);
            result.ambiguousSelection=document.getElementById('correspondence-selection').textContent;
            search(''); result.pressed=document.querySelector('[data-symbol-key="before:before-uncertain"] .correspondence-item').getAttribute('aria-pressed');
            return result;
        })()`);
        assert.match(filtered.empty, /No symbols match/);
        assert.equal(filtered.method, 'after:after-new_name'); assert.equal(filtered.work, 'after:after-Work');
        assert.ok(filtered.expanded); assert.ok(filtered.collapsedAgain);
        assert.match(filtered.paired.leftContent, /def nested/);
        assert.equal(filtered.paired.leftContent, filtered.paired.rightContent);
        assert.deepEqual(filtered.paired.editableSides, { left: false, right: false });
        assert.equal(filtered.unmatched.leftContent, ''); assert.match(filtered.unmatched.rightContent, /def fresh_only/);
        assert.match(filtered.unmatched.file1, /No accepted match/);
        assert.deepEqual(filtered.unmatched.editableSides, { left: false, right: false });
        assert.match(filtered.selection, /does not establish an addition or deletion/);
        assert.match(filtered.ambiguous.leftContent, /def uncertain/); assert.equal(filtered.ambiguous.rightContent, '');
        assert.match(filtered.ambiguousSelection, /ambiguous before symbol/); assert.equal(filtered.pressed, 'true');
        const diagnostics = await evaluate(`(() => {
            const container=document.getElementById('correspondence-limitations');
            document.getElementById('correspondence-analysis').open=true;
            const syntax=container.querySelector('[data-diagnostic-category="syntax"]'); syntax.open=true;
            const result={summary:syntax.querySelector('summary').textContent, text:container.textContent};
            syntax.querySelector('button').click(); result.full=window.__symbolSmokeMessages.at(-1);
            document.getElementById('correspondence-all').checked=false;
            const filter=document.getElementById('correspondence-filter');filter.value='no-such-symbol';filter.dispatchEvent(new Event('input'));
            container.querySelector('[data-diagnostic-category="relationship"] button').click();
            result.unchanged=window.__symbolSmokeMessages.at(-1);
            result.all=document.getElementById('correspondence-all').checked;
            result.search=filter.value; result.focused=document.activeElement.dataset.correspondenceId;
            const unmatched=container.querySelector('[data-diagnostic-category="unmatched"]'); unmatched.open=true;
            const competing=unmatched.querySelector('li:last-child');
            result.competitors=competing.querySelectorAll('button').length;
            competing.querySelector('button').click(); result.ambiguous=window.__symbolSmokeMessages.at(-1);
            result.syntaxStillOpen=container.querySelector('[data-diagnostic-category="syntax"]').open;
            return result;
        })()`);
        assert.match(diagnostics.summary, /1 syntax records/);
        assert.match(diagnostics.text, /Synthetic partial export/); assert.match(diagnostics.text, /container-boundary-mismatch/);
        assert.doesNotMatch(diagnostics.text, /Detailed diagnostics unavailable/);
        assert.equal(diagnostics.full.leftContent, outline.before['src/outline.py']);
        assert.equal(diagnostics.full.rightContent, outline.after['src/outline.py']);
        assert.match(diagnostics.unchanged.leftContent, /def kept/);
        assert.equal(diagnostics.unchanged.leftContent, diagnostics.unchanged.rightContent);
        assert.ok(diagnostics.all); assert.equal(diagnostics.search, ''); assert.equal(diagnostics.focused, 'relation-kept');
        assert.equal(diagnostics.competitors, 2); assert.match(diagnostics.ambiguous.leftContent, /def uncertain/);
        assert.equal(diagnostics.ambiguous.rightContent, ''); assert.ok(diagnostics.syntaxStillOpen);
        console.log('Correspondence browser smoke passed: symbol tree, complete slices, keyboard/search, diagnostic categories, legacy fallback, full-file locations, unchanged endpoint and ambiguous-origin navigation.');
    } finally {
        clearTimeout(timeout); if (window) window.destroy();
        if (presentation) await new Promise(resolve => presentation.server.close(resolve)); fixture.dispose(); outlineFixture?.dispose();
    }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
