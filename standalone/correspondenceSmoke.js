/* global require, __dirname, console, setTimeout, clearTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { correspondenceFixture, source } = require('../test/correspondenceFixture');
const { correspondenceTreeFixture } = require('../test/correspondenceTreeFixture');
const { importChangeCorrespondence, validateChangeCorrespondence } = require('../out/changeCorrespondence');
const { tourSymbolFixture } = require('../test/tourSymbolFixture');
const { exportTour } = require('../cli/tourExport');
const { startPresentation } = require('../cli/present');

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 45000);
    const fixture = correspondenceFixture(); let presentation, window, outlineFixture, tourFixture;
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
        const context = await evaluate(`(() => {
            document.getElementById('correspondence-context').click();
            const full=window.__symbolSmokeMessages.at(-1);
            const active=[...document.querySelectorAll('#tour-files .tour-file.is-active')].map(button=>button.dataset.filePath);
            const symbols=document.querySelectorAll('#tour-files .file-symbols .correspondence-item').length;
            const file=path=>document.querySelector('#tour-files .tour-file[data-file-path="'+path+'"]');
            const tree=path=>file(path).parentElement.querySelector('.file-symbols');
            const toggle=path=>file(path).parentElement.querySelector('.file-symbol-toggle');
            const visible=path=>getComputedStyle(tree(path)).display!=='none';
            const source='src/tourAssessment.ts', destination='src/tourDetails.ts';
            const compact=!visible(source) && !visible(destination);
            const accessible=toggle(destination).dataset.tooltip==='Show Symbols'
                && toggle(destination).getAttribute('aria-expanded')==='false'
                && toggle(destination).getAttribute('aria-controls')===tree(destination).id;
            const messages=window.__symbolSmokeMessages.length;
            toggle(destination).click();
            const expanded=visible(destination) && !visible(source)
                && toggle(destination).getAttribute('aria-expanded')==='true'
                && toggle(destination).dataset.tooltip==='Hide Symbols';
            const noNavigation=messages===window.__symbolSmokeMessages.length;
            file(source).click(); const switched=visible(destination) && !visible(source);
            toggle(source).click(); const independent=visible(source) && visible(destination);
            document.getElementById('file-symbol-context').click();
            const stable=visible(source) && visible(destination);
            toggle(destination).click(); file(destination).click();
            const staysFolded=visible(source) && !visible(destination);
            document.getElementById('correspondence-all').click();
            document.getElementById('correspondence-all').click();
            const preserved=visible(source) && !visible(destination);
            const noExtraLevel=!document.querySelector('.file-symbols > summary')
                && !document.getElementById('tour-show-file-symbols');
            toggle(source).click(); document.getElementById('file-symbol-context').click();
            return {full,active,symbols,compact,accessible,expanded,noNavigation,switched,independent,
                stable,staysFolded,preserved,noExtraLevel,restored:window.__symbolSmokeMessages.at(-1)};
        })()`);
        assert.equal(context.full.leftContent, source.before['src/tourAssessment.ts']);
        assert.equal(context.full.rightContent, source.after['src/tourDetails.ts']);
        assert.deepEqual(context.full.tourAnnotations.map(a=>a.startLine), [85,22]);
        assert.deepEqual(context.active.sort(), ['src/tourAssessment.ts', 'src/tourDetails.ts']); assert.ok(context.symbols);
        for (const key of ['compact','accessible','expanded','noNavigation','switched','independent','stable','staysFolded','preserved','noExtraLevel']) {
            assert.ok(context[key], key);
        }
        assert.equal(context.restored.leftContent, selected.message.leftContent);
        assert.equal(context.restored.rightContent, selected.message.rightContent);
        await evaluate(`document.querySelector('#tour-files .file-symbol-toggle').focus()`);
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await wait(`document.querySelector('#tour-files .file-symbol-toggle').getAttribute('aria-expanded')==='true'`);
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
            const stable=document.querySelector('#correspondence-list [data-symbol-key="after:after-Stable"]');
            const moves=document.querySelectorAll('#correspondence-list [data-correspondence-id="relation-transfer"]');
            return {context:stable.classList.contains('is-context'), ambiguous:stable.querySelectorAll('.correspondence-item').length,
                moves:moves.length, status:document.getElementById('correspondence-status').textContent};
        })()`);
        assert.ok(hierarchy.context); assert.equal(hierarchy.ambiguous, 3); assert.equal(hierarchy.moves, 2);
        assert.match(hierarchy.status, /3 of 6 inferred mappings/); assert.match(hierarchy.status, /4 unmatched symbols/);
        const symbolColors = await evaluate(`(() => {
            const read=(root,key)=>{
                const button=document.querySelector(root+' [data-symbol-key="'+key+'"] > .correspondence-heading > .correspondence-item');
                return {kind:button.dataset.changeKind,color:getComputedStyle(button.querySelector('strong')).color};
            };
            const keys=['after:after-fresh_only','before:before-prior_only','after:after-new_name',
                'before:before-uncertain','after:after-uncertain','after:after-Stable','before:before-transfer','after:after-transfer'];
            return keys.map(key=>({key,symbols:read('#correspondence-list',key),files:read('#tour-files',key)}));
        })()`);
        const colors = Object.fromEntries(symbolColors.map(row=>[row.key,row.symbols]));
        for (const row of symbolColors) assert.deepEqual(row.files, row.symbols, row.key);
        assert.equal(colors['after:after-fresh_only'].kind, 'added');
        assert.equal(colors['before:before-prior_only'].kind, 'deleted');
        for (const key of ['after:after-new_name','before:before-transfer','after:after-transfer']) {
            assert.equal(colors[key].kind, 'modified');
            assert.equal(colors[key].color, colors['after:after-new_name'].color);
        }
        for (const key of ['before:before-uncertain','after:after-uncertain']) {
            assert.equal(colors[key].kind, 'ambiguous');
            assert.equal(colors[key].color, colors['after:after-Stable'].color);
        }
        assert.equal(colors['after:after-Stable'].kind, 'unchanged');
        assert.equal(new Set(['after:after-fresh_only','before:before-prior_only','after:after-new_name','after:after-Stable']
            .map(key=>colors[key].color)).size, 4);
        const unmatchedFilter = await evaluate(`(() => {
            const addedRemoved=document.getElementById('correspondence-unmatched');
            const all=document.getElementById('correspondence-all');
            const result={defaultChecked:addedRemoved.checked};
            addedRemoved.click();
            result.filtered=document.getElementById('correspondence-status').textContent;
            result.beforeOnly=!!document.querySelector('#correspondence-list [data-symbol-key="before:before-prior_only"]');
            result.afterOnly=!!document.querySelector('#correspondence-list [data-symbol-key="after:after-fresh_only"]');
            result.ambiguous=!!document.querySelector('#correspondence-list [data-symbol-key="before:before-uncertain"]');
            all.click();
            result.withUnchanged=document.getElementById('correspondence-status').textContent;
            all.click(); addedRemoved.click();
            result.restored=document.getElementById('correspondence-status').textContent;
            return result;
        })()`);
        assert.ok(unmatchedFilter.defaultChecked);
        assert.match(unmatchedFilter.filtered, /3 of 6 inferred mappings · 0 unmatched symbols/);
        assert.equal(unmatchedFilter.beforeOnly, false); assert.equal(unmatchedFilter.afterOnly, false);
        assert.equal(unmatchedFilter.ambiguous, false);
        assert.match(unmatchedFilter.withUnchanged, /6 of 6 inferred mappings · 0 unmatched symbols/);
        assert.match(unmatchedFilter.restored, /4 unmatched symbols/);
        // Native keyboard activation must expand/collapse without opening a diff.
        await evaluate(`document.querySelector('#correspondence-list [data-symbol-key="after:after-Work"] > .correspondence-heading > .correspondence-toggle').focus()`);
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await wait(`document.querySelector('#correspondence-list [data-symbol-key="after:after-Work"] > ul').hidden`);
        assert.equal(await evaluate('window.__symbolSmokeMessages.length'), 0);
        const filtered = await evaluate(`(() => {
            const filter=document.getElementById('correspondence-filter');
            const search=value=>{filter.value=value;filter.dispatchEvent(new Event('input'));};
            search('nested'); const empty=document.getElementById('correspondence-list').textContent;
            document.getElementById('correspondence-all').click();
            const nested=document.querySelector('#correspondence-list [data-symbol-key="after:after-nested"]');
            const method=nested.parentElement.closest('li'), work=method.parentElement.closest('li');
            nested.querySelector('.correspondence-item').click();
            const result={paired:window.__symbolSmokeMessages.at(-1),empty,method:method.dataset.symbolKey,work:work.dataset.symbolKey,
                expanded:!work.querySelector(':scope > ul').hidden};
            search(''); result.collapsedAgain=document.querySelector('#correspondence-list [data-symbol-key="after:after-Work"] > ul').hidden;
            search('fresh_only'); document.querySelector('.correspondence-item').click();
            result.unmatched=window.__symbolSmokeMessages.at(-1);
            result.selection=document.getElementById('correspondence-selection').textContent;
            search('uncertain'); document.querySelector('#correspondence-list [data-symbol-key="before:before-uncertain"] .correspondence-item').click();
            result.ambiguous=window.__symbolSmokeMessages.at(-1);
            result.ambiguousSelection=document.getElementById('correspondence-selection').textContent;
            search(''); result.pressed=document.querySelector('#correspondence-list [data-symbol-key="before:before-uncertain"] .correspondence-item').getAttribute('aria-pressed');
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
            document.getElementById('correspondence-unmatched').click();
            const unmatched=container.querySelector('[data-diagnostic-category="unmatched"]'); unmatched.open=true;
            const competing=unmatched.querySelector('li:last-child');
            result.competitors=competing.querySelectorAll('button').length;
            competing.querySelector('button').click(); result.ambiguous=window.__symbolSmokeMessages.at(-1);
            result.includeUnmatched=document.getElementById('correspondence-unmatched').checked;
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
        assert.ok(diagnostics.includeUnmatched);
        const oldPage = await evaluate(`(() => {
            document.getElementById('correspondence-unmatched').remove();
            const filter=document.getElementById('correspondence-filter');
            filter.value='prior_only'; filter.dispatchEvent(new Event('input'));
            const status=document.getElementById('correspondence-status').textContent;
            const before=window.__symbolSmokeMessages.length;
            document.querySelector('[data-diagnostic-category="unmatched"] li:last-child button').click();
            return {status, opened:window.__symbolSmokeMessages.length-before, selected:window.__symbolSmokeMessages.at(-1)};
        })()`);
        assert.match(oldPage.status, /0 of 6 inferred mappings · 1 unmatched symbols/);
        assert.equal(oldPage.opened, 1);
        assert.match(oldPage.selected.leftContent, /def uncertain/);
        await new Promise(resolve => presentation.server.close(resolve)); presentation = null;
        tourFixture = tourSymbolFixture();
        const sourcePath = path.join(tourFixture.root, 'move.bygone'); fs.writeFileSync(sourcePath, JSON.stringify(tourFixture.source));
        presentation = await startPresentation(['--tour', sourcePath], tourFixture.root,
            path.resolve(__dirname, '..'), { open: false, announce: false, ignoreEnvironment: true });
        const exportPath = path.join(tourFixture.root, 'move.html'); exportTour(sourcePath, exportPath, path.resolve(__dirname, '..'));
        for (const url of [presentation.url, require('node:url').pathToFileURL(exportPath).href]) {
            await window.loadURL(url);
            await wait(`document.querySelector('.tour-outline-step[data-scene-id="move"]')`);
            await evaluate(`window.__symbolSmokeMessages=[]; window.addEventListener('bygone:host-message', e=>window.__symbolSmokeMessages.push(e.detail)); document.querySelector('.tour-outline-step[data-scene-id="move"]').click()`);
            await wait(`window.__symbolSmokeMessages.some(m=>m.comparisonId==='correspondence-relation-transfer-symbol')`);
            const symbolStop = await evaluate(`(() => {
                const latest=()=>window.__symbolSmokeMessages.findLast(m=>m.type==='showDiff');
                const selected=latest(), hash=location.hash;
                document.getElementById('file-symbol-context').click();
                const full=latest();
                const returnVisible=!document.getElementById('tour-return-focus').hidden;
                document.getElementById('file-symbol-context').click();
                return {selected,full,restored:latest(),sameStop:hash===location.hash,returnVisible};
            })()`);
            assert.match(symbolStop.selected.leftContent, /^def transfer/);
            assert.equal(symbolStop.full.leftContent, tourFixture.input.before['src/outline.py']);
            assert.equal(symbolStop.full.rightContent, tourFixture.input.after['src/moved.py']);
            assert.equal(symbolStop.full.tourAnnotations.length, 2);
            assert.equal(symbolStop.restored.leftContent, symbolStop.selected.leftContent);
            assert.ok(symbolStop.sameStop); assert.ok(symbolStop.returnVisible);
            const titleSelection = await evaluate(`(() => {
                document.getElementById('tour-title').click();
                return { selected: document.querySelectorAll('.correspondence-item[aria-pressed="true"]').length,
                    activeFiles: document.querySelectorAll('#tour-files .tour-file.is-active').length };
            })()`);
            assert.equal(titleSelection.selected, 0);
            assert.equal(titleSelection.activeFiles, 0);
        }
        console.log('Correspondence browser smoke passed: symbol tree, complete slices, keyboard/search, diagnostic categories, legacy fallback, full-file locations, unchanged endpoint, ambiguous-origin navigation and live/offline symbol tour stops.');
    } finally {
        clearTimeout(timeout); if (window) window.destroy();
        if (presentation) await new Promise(resolve => presentation.server.close(resolve)); fixture.dispose(); outlineFixture?.dispose(); tourFixture?.dispose();
    }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
