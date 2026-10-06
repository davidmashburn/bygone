/* global require, module, console, __dirname, URL */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout, clearTimeout } = require('node:timers');
const { runTourReadingSmoke } = require('./tourReadingSmoke.js');
const { runLinkPreviewSmoke } = require('./linkPreviewSmoke.js');
const { runPanelSwitchSmoke } = require('./panelSwitchSmoke.js');
const { serializeDeepLink } = require('../out/deepLink');
const { pathToFileURL } = require('node:url');

async function runWorkspaceSmoke({ open, openMulti, window, session, dialog, openTour, openTourWindow, openLink, latestTourWindow, navigation }) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-workspace-smoke-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    const evaluate = (code) => window().webContents.executeJavaScript(code, true).catch((error) => {
        throw new Error(`Workspace script failed: ${code}\n${error.message}`);
    });
    const waitFor = (condition) => evaluate(`new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => { if (${condition}) resolve(true); else if (Date.now() - start > 15000) reject(new Error(${JSON.stringify(condition)})); else requestAnimationFrame(check); };
        check();
    })`);
    try {
        git('init'); git('config', 'user.name', 'Workspace smoke'); git('config', 'user.email', 'smoke@example.test');
        const revisions = [];
        for (let i = 0; i < 4; i++) {
            fs.writeFileSync(path.join(root, 'one.txt'), `one ${i}\n`);
            fs.writeFileSync(path.join(root, 'two.txt'), `two ${i}\n`);
            git('add', '.'); git('commit', '-m', `Revision ${i}`);
            revisions.push(git('rev-parse', 'HEAD').toString().trim());
        }
        const comparisonLink = { kind: 'compare', repo: pathToFileURL(root).href,
            revisions: [revisions[0], revisions[3]], file: 'one.txt', revision: revisions[3], line: 2 };
        await openLink(serializeDeepLink(comparisonLink));
        await waitFor("document.querySelectorAll('.monaco-editor').length >= 2");
        assert.equal(session().source.kind, 'git-refs');
        assert.equal(session().source.readOnly, true);
        assert.deepEqual(session().source.resolvedRevisions, comparisonLink.revisions);
        assert.equal((await navigation()).editorStates.right.selection.startLineNumber, 2, 'Cold link reveals the exact requested line');
        const linkedSession = session();
        await assert.rejects(openLink(serializeDeepLink({ ...comparisonLink, line: 1000 })), /outside/);
        assert.equal(session(), linkedSession, 'Invalid targets preserve the current comparison');
        await runPanelSwitchSmoke({ browserContents: window().webContents, openMulti });
        await open(path.join(root, 'one.txt'), path.join(root, 'two.txt'));
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelectorAll('.monaco-editor').length >= 2");
        const original = session();
        await evaluate("document.querySelectorAll('[data-multi-select-panel]')[1].click()");
        await waitFor("document.querySelectorAll('[data-multi-select-panel]')[1].getAttribute('aria-pressed') === 'true'");
        await evaluate("document.querySelector('[data-workspace-mode=historical]').click()");
        await waitFor("document.querySelector('dialog[open] textarea')");
        const initialPrompt = await evaluate("document.querySelector('dialog[open] textarea').value");
        assert.match(initialPrompt, /SKILL\.md/);
        assert.ok(initialPrompt.length < 1600, 'The handoff stays short');
        const instructions = await evaluate("document.querySelector('[aria-label=\"Tour skill Markdown instructions\"]').value");
        assert.match(instructions, /version 4/);
        const saveDialog = dialog.showSaveDialog;
        const chooseDialog = dialog.showOpenDialog;
        const skillCopy = path.join(root, 'my-tour-instructions.md');
        try {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: skillCopy });
            await evaluate("document.querySelector('[data-workspace-prompt-action=workspace-skill-save]').click()");
            await waitFor(`document.querySelector('dialog[open] textarea').value.includes(${JSON.stringify(skillCopy)})`);
            assert.equal(fs.readFileSync(skillCopy, 'utf8'), instructions);
            fs.appendFileSync(skillCopy, '\nCustom context: explain the migration rationale.\n');
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [skillCopy] });
            await evaluate("document.querySelector('[data-workspace-prompt-action=workspace-skill-choose]').click()");
            await waitFor("document.querySelector('[aria-label=\"Tour skill Markdown instructions\"]').value.includes('Custom context:')");
            dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
            await evaluate("document.querySelector('[data-workspace-prompt-action=workspace-skill-choose]').click()");
            await waitFor("document.querySelector('.workspace-status').textContent.includes('canceled')");
            assert.ok(await evaluate(`document.querySelector('dialog[open] textarea').value.includes(${JSON.stringify(skillCopy)})`));
            const bundledPath = path.join(__dirname, '..', 'skills', 'pr-tour-guide', 'SKILL.md');
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: bundledPath });
            await evaluate("document.querySelector('[data-workspace-prompt-action=workspace-skill-save]').click()");
            await waitFor("document.querySelector('dialog[open] .workspace-prompt-status').textContent.includes('read-only')");
            assert.equal(fs.readFileSync(bundledPath, 'utf8'), instructions, 'Saving a copy cannot overwrite the bundled skill');
        } finally { dialog.showSaveDialog = saveDialog; dialog.showOpenDialog = chooseDialog; }
        await evaluate("document.querySelector('dialog[open] textarea').value = 'Keep this prompt'; document.querySelector('dialog[open] textarea').dispatchEvent(new Event('input')); document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', {cancelable:true}))");
        await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]') && document.querySelectorAll('.multi-pane').length === 2");
        assert.equal(session().workspaceView.path, 'two.txt');
        assert.equal(session().multi.files.at(-1).editable, true);
        const checkboxes = await evaluate("document.querySelectorAll('#history-rail [role=checkbox]').length");
        assert.ok(checkboxes >= 4, `Expected all commits, got ${checkboxes}`);
        const hoverElapsed = await evaluate(`new Promise((resolve, reject) => {
            document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            const details = document.querySelector('.commit-hover-details');
            const started = performance.now();
            const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Commit hover did not open')); }, 5000);
            const observer = new MutationObserver(() => {
                if (details.hidden) return;
                observer.disconnect(); clearTimeout(timeout); resolve(performance.now() - started);
            });
            observer.observe(details, { attributes: true, attributeFilter: ['hidden'] });
            document.querySelector('[data-commit-row] .history-rail-entry').dispatchEvent(
                new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.querySelector('[data-commit-row] [data-rail-menu]') }));
        })`);
        assert.ok(hoverElapsed >= 480, `Commit details wait for the shared 500ms hover delay (got ${hoverElapsed}ms)`);
        const overlays = await evaluate(`(async () => {
            const row = document.querySelector('[data-commit-row]');
            const details = document.querySelector('.commit-hover-details');
            const selected = document.querySelectorAll('[aria-checked=true]').length;
            const detailStyle = getComputedStyle(details);
            const hover = { visible: !details.hidden, background: detailStyle.backgroundColor, font: detailStyle.fontFamily };
            row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 200 }));
            const menu = document.querySelector('.commit-context-menu');
            const menuStyle = getComputedStyle(menu);
            const buttonStyle = getComputedStyle(menu.querySelector('button'));
            const result = { hover, menuVisible: !menu.hidden, background: menuStyle.backgroundColor,
                font: menuStyle.fontFamily, buttonFont: buttonStyle.fontFamily,
                singleNavigationTooltip: ['previous-file', 'next-file'].every(id => {
                    const button = document.getElementById(id);
                    return button.hasAttribute('data-tooltip') && !button.hasAttribute('title');
                }),
                selectionUnchanged: selected === document.querySelectorAll('[aria-checked=true]').length };
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 700));
            result.dismissed = menu.hidden && details.hidden;
            return result;
        })()`);
        assert.equal(overlays.hover.visible, true);
        assert.equal(overlays.menuVisible, true);
        assert.equal(overlays.selectionUnchanged, true);
        assert.equal(overlays.singleNavigationTooltip, true, 'File navigation must not show both managed and native tooltips');
        assert.equal(overlays.dismissed, true, 'Escape must not reopen the tooltip through focus restoration');
        for (const [surface, background] of Object.entries({ details: overlays.hover.background, menu: overlays.background })) {
            assert.match(background, /^rgb\(/, `${surface} must be opaque: ${JSON.stringify(overlays)}`);
        }
        assert.match(overlays.hover.font, /system-ui/);
        assert.match(overlays.font, /system-ui/);
        assert.equal(overlays.buttonFont, overlays.font);
        const canceledCommitHover = await evaluate(`(async () => {
            const entry = document.querySelector('[data-commit-row] .history-rail-entry');
            entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 700));
            return document.querySelector('.commit-hover-details').hidden;
        })()`);
        assert.equal(canceledCommitHover, true, 'Escape cancels pending commit hovers as well as visible ones');
        const tooltipChecks = await evaluate(`(async () => {
            const tooltip = document.getElementById('bygone-ui-tooltip');
            const toolbar = document.getElementById('directory-tree-toolbar');
            const originallyHidden = toolbar.hidden;
            toolbar.hidden = false;
            const hover = async (button, dismiss = true) => {
                document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
                const started = performance.now();
                const elapsed = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Tooltip did not open for ' + button.id)); }, 5000);
                    const observer = new MutationObserver(() => {
                        if (tooltip.hidden) return;
                        observer.disconnect(); clearTimeout(timeout); resolve(performance.now() - started);
                    });
                    observer.observe(tooltip, { attributes: true, attributeFilter: ['hidden'] });
                    const svg = button.querySelector('svg') || button;
                    svg.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
                    // Moving across the icon must not restart or cancel the timer.
                    (svg.querySelector('path') || svg).dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: svg }));
                });
                const style = getComputedStyle(tooltip);
                const anchor = button.getBoundingClientRect();
                const bounds = tooltip.getBoundingClientRect();
                const result = { id: button.id, elapsed, text: tooltip.textContent, nativeTitle: button.hasAttribute('title'),
                    opacity: style.opacity, background: style.backgroundColor, font: style.fontFamily,
                    placedBelow: Math.abs(bounds.top - anchor.bottom - 8) < 1,
                    inViewport: bounds.left >= 8 && bounds.right <= innerWidth - 8,
                    pseudoContent: getComputedStyle(button, '::after').content };
                if (dismiss) button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
                result.dismissed = tooltip.hidden;
                return result;
            };
            const checks = [];
            for (const id of ['directory-expand-all', 'directory-collapse-all', 'directory-collapse-unchanged', 'previous-file', 'next-file']) {
                const button = document.getElementById(id);
                const originallyHidden = button.hidden;
                button.hidden = false;
                checks.push(await hover(button));
                button.hidden = originallyHidden;
            }
            const button = document.getElementById('directory-expand-all');
            const oldText = button.dataset.tooltip;
            button.title = 'Updated tooltip';
            await Promise.resolve();
            checks.push({ updatedTitle: button.dataset.tooltip === 'Updated tooltip' && !button.hasAttribute('title') });
            button.title = oldText;
            document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            const modal = document.createElement('dialog');
            const action = document.createElement('button');
            action.id = 'modal-tooltip-smoke';
            action.title = 'Tooltip inside modal';
            action.textContent = 'Action';
            modal.appendChild(action);
            document.body.appendChild(modal);
            modal.showModal();
            const modalCheck = await hover(action, false);
            modalCheck.parentIsModal = tooltip.parentElement === modal;
            modal.close();
            await Promise.resolve();
            modalCheck.modalDismissed = tooltip.hidden && tooltip.parentElement === document.body;
            modal.remove();
            checks.push(modalCheck);
            toolbar.hidden = originallyHidden;
            return checks;
        })()`);
        const modalCheck = tooltipChecks.pop();
        assert.ok(modalCheck.text === 'Tooltip inside modal' && modalCheck.parentIsModal && modalCheck.modalDismissed,
            'Modal tooltips render in the top layer and close with their dialog');
        assert.equal(tooltipChecks.pop().updatedTitle, true, 'Dynamic title updates use the managed tooltip');
        for (const check of tooltipChecks) {
            assert.ok(check.elapsed >= 480, `${check.id} must wait 500ms: ${JSON.stringify(check)}`);
            assert.ok(check.text && !check.nativeTitle && check.dismissed, JSON.stringify(check));
            assert.equal(check.opacity, '1', 'Tooltip opacity is independent of disabled buttons');
            assert.match(check.background, /^rgb\(/);
            assert.match(check.font, /system-ui/);
            assert.equal(check.pseudoContent, 'none', 'No CSS bubble can appear instantly');
            assert.ok(check.placedBelow && check.inViewport, JSON.stringify(check));
        }
        const linkChecks = await evaluate(`(async () => {
            const link = document.createElement('a');
            link.href = 'https://example.invalid/review?mode=preview#evidence';
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const label = document.createElement('span');
            label.textContent = 'Review evidence';
            link.appendChild(label);
            link.style.cssText = 'position:fixed;top:20px;left:20px;z-index:10000';
            document.body.appendChild(link);
            const tooltip = document.getElementById('bygone-ui-tooltip');
            const menu = document.querySelector('.bygone-link-context-menu');
            const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await pause(650);
            const checks = { hover: !tooltip.hidden && tooltip.querySelector('#bygone-link-url').textContent === link.href,
                lazy: !document.querySelector('.bygone-link-preview'),
                normalLink: link.target === '_blank' && link.rel === 'noopener noreferrer' };
            label.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
            await pause(50);
            const preview = tooltip.querySelector('button');
            preview.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: link }));
            await pause(250);
            checks.reachable = !tooltip.hidden;
            preview.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            preview.click();
            let modal = document.querySelector('.bygone-link-preview[open]');
            checks.hoverPreview = Boolean(modal) && modal.querySelector('webview').src === link.href;
            checks.sandbox = modal.querySelector('webview').getAttribute('partition') === 'bygone-link-preview';
            checks.fallback = modal.querySelector('p a').href === link.href;
            const frame = modal.querySelector('webview');
            modal.querySelector('button').click();
            await pause(650);
            checks.closed = !modal.isConnected && !frame.isConnected
                && document.activeElement === link && tooltip.hidden;
            label.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: innerWidth - 1, clientY: innerHeight - 1 }));
            const bounds = menu.getBoundingClientRect();
            checks.context = !menu.hidden && menu.querySelector('button').textContent === 'Preview link'
                && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
            menu.querySelector('button').click();
            modal = document.querySelector('.bygone-link-preview[open]');
            checks.contextPreview = Boolean(modal) && menu.hidden;
            modal.close();
            await pause(50);
            link.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
            checks.keyboardMenu = !menu.hidden && document.activeElement.textContent === 'Preview link';
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            checks.keyboardNavigation = document.activeElement.textContent === 'Open link in browser';
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            checks.menuDismissed = menu.hidden && document.activeElement === link;
            label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
            checks.keyboardPreview = !tooltip.hidden && document.activeElement === preview;
            document.activeElement.click();
            modal = document.querySelector('.bygone-link-preview[open]');
            checks.keyboardOpened = Boolean(modal);
            modal.close();
            await pause(50);
            link.href = 'javascript:alert(1)';
            const unsafe = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            link.dispatchEvent(unsafe);
            checks.unsafe = menu.hidden && !unsafe.defaultPrevented;
            link.href = 'https://example.invalid/updated';
            label.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            link.remove();
            await pause(650);
            checks.removed = tooltip.hidden && menu.hidden;
            return checks;
        })()`);
        for (const [check, passed] of Object.entries(linkChecks)) assert.equal(passed, true, `Link preview: ${check}`);
        await runLinkPreviewSmoke(window().webContents);
        await evaluate("document.querySelectorAll('#history-rail [role=checkbox]')[1].click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(1)')");
        await evaluate("document.querySelectorAll('#history-rail [role=checkbox]')[2].click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(2)')");
        await evaluate("document.querySelector('[data-action=workspaceClear]').click()");
        await waitFor("document.querySelector('[data-action=workspaceApply]').textContent.includes('(0)')");
        assert.equal(session().workspaceView.mode, 'history');
        await evaluate("document.querySelector('[data-workspace-back]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelectorAll('.multi-pane').length === 2");
        assert.equal(session(), original);
        await evaluate("document.querySelector('[data-workspace-mode=historical]').click()");
        await waitFor("document.querySelector('dialog[open] textarea')?.value === 'Keep this prompt'");
        await evaluate("document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', {cancelable:true}))");
        const dirtyConfirm = dialog.showMessageBox;
        let dirtyPrompts = 0;
        let confirmResponse = 2;
        try {
            dialog.showMessageBox = async () => { dirtyPrompts++; return { response: confirmResponse }; };
            // Edit and request a mode switch in one renderer turn, before the
            // ordinary debounced model message can reach the native host.
            await evaluate("window.monaco.editor.getModels().find(model => model.getValue() === 'two 3\\n').setValue('unsent edit\\n'); document.querySelector('[data-workspace-mode=history]').click()");
            await new Promise((resolve, reject) => {
                const deadline = Date.now() + 5000;
                const check = () => dirtyPrompts ? resolve() : Date.now() > deadline ? reject(new Error('Immediate edit did not trigger the unsaved guard')) : setTimeout(check, 20);
                check();
            });
            assert.equal(session(), original, 'Cancel preserves the original comparison');
            assert.equal(fs.readFileSync(path.join(root, 'two.txt'), 'utf8'), 'two 3\n');
            assert.equal(session().multi.files[1].content, 'unsent edit\n');
            confirmResponse = 1;
            await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
            await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
            await evaluate("document.querySelector('[data-workspace-back]').click()");
            await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]')");
            assert.equal(session().multi.files[1].content, 'two 3\n', 'Discarded edits cannot return in the retained comparison');
            assert.ok(session().multi.files.every((panel) => !panel.dirty));
        } finally { dialog.showMessageBox = dirtyConfirm; }
        const retainedOriginal = session();
        const tourPath = path.join(root, 'smoke.bygone');
        fs.writeFileSync(tourPath, JSON.stringify({ version: 4, title: 'Continuous reading smoke tour',
            range: { base: revisions[0], head: revisions[3] },
            anchors: { value: { file: 'one.txt', revision: 'head', contains: 'one' } }, connections: [],
            chapters: [
                { id: 'chapter-one', title: 'Change setup', scenes: [{ id: 'scene-one', kind: 'walkthrough', title: 'Read the first change',
                    summary: 'The first value changes.', bullets: [], tags: [], takeaway: 'The first committed value.',
                    steps: [
                        { id: 'step-one-a', title: 'First value', body: 'The first committed value.', focus: 'value' },
                        { id: 'step-one-b', title: 'First follow-up', body: 'The first follow-up value.', focus: 'value' }
                    ] }] },
                { id: 'chapter-two', title: 'Change follow-up', scenes: [{ id: 'scene-two', kind: 'walkthrough', title: 'Read the second change',
                    summary: 'The second value changes.', bullets: [], tags: [], takeaway: 'The second committed value.',
                    steps: [
                        { id: 'step-two-a', title: 'Second value', body: 'The second committed value.', focus: 'value' },
                        { id: 'step-two-b', title: 'Second follow-up', body: 'The second follow-up value.', focus: 'value' }
                    ] }] }
            ]
        }));
        const legacyTourPath = path.join(root, 'legacy.bygone');
        const legacyTourText = JSON.stringify({ ...JSON.parse(fs.readFileSync(tourPath, 'utf8')), version: 3, review: { title: 'Keep original review notes' } });
        fs.writeFileSync(legacyTourPath, legacyTourText);
        const pick = dialog.showOpenDialog;
        const confirm = dialog.showMessageBox;
        let confirmations = 0;
        try {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [legacyTourPath] });
            dialog.showMessageBox = async (_owner, options) => {
                assert.equal(options.title, 'Convert older tour');
                return { response: 1 };
            };
            await openTour();
            assert.equal(session(), retainedOriginal, 'Cancel conversion retains the comparison');
            assert.equal(fs.existsSync(path.join(root, 'legacy.v4.bygone')), false);
            dialog.showMessageBox = async () => { confirmations++; return { response: 0 }; };
            await openTour();
            assert.equal(fs.readFileSync(legacyTourPath, 'utf8'), legacyTourText);
            assert.equal(require('../cli/tourFile.js').readTourSourceDocument(path.join(root, 'legacy.v4.bygone')).version, 4);
        } finally { dialog.showOpenDialog = pick; dialog.showMessageBox = confirm; }
        assert.equal(confirmations, 2, 'An older tour requires conversion and a scoped comparison requires a tour-context choice');
        await waitFor("document.querySelector('[data-workspace-mode=historical][aria-pressed=true]') && document.querySelector('#workspace-tour-frame:not([hidden])')");
        const tourFrame = await new Promise((resolve, reject) => {
            const contents = window().webContents;
            const timeout = setTimeout(() => { contents.removeListener('did-frame-finish-load', check); reject(new Error('Tour subframe did not load')); }, 15000);
            function check() {
                const frame = contents.mainFrame.frames.find((entry) => entry.url.startsWith('http://127.0.0.1:'));
                if (frame) { clearTimeout(timeout); contents.removeListener('did-frame-finish-load', check); resolve(frame); }
            }
            contents.on('did-frame-finish-load', check);
            check();
        });
        assert.ok(tourFrame, 'Tour runs in a loopback subframe');
        await tourFrame.executeJavaScript(`new Promise((resolve, reject) => {
            const start = Date.now(); const check = () => {
                if (document.querySelector('#tour-title')?.textContent && document.querySelector('.tour-reading-item.is-active')) resolve(true);
                else if (Date.now() - start > 15000) reject(new Error('Tour did not render')); else requestAnimationFrame(check);
            }; check();
        })`);
        await runLinkPreviewSmoke(tourFrame, { previewRenderer: window().webContents });
        assert.notEqual(await tourFrame.executeJavaScript("window.__BYGONE_HOST__?.environment"), 'standalone');
        assert.equal(await tourFrame.executeJavaScript("typeof window.__BYGONE_HOST__?.getPathForFile"), 'undefined');
        const nativeTourWindow = await openTourWindow(tourPath);
        try {
            await nativeTourWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
                const deadline = Date.now() + 10000;
                const check = () => {
                    if (document.querySelector('.tour-reading-item.is-active')) resolve();
                    else if (Date.now() > deadline) reject(new Error('Native tour did not render'));
                    else requestAnimationFrame(check);
                }; check();
            })`);
            await runLinkPreviewSmoke(nativeTourWindow.webContents);
        } finally { nativeTourWindow.destroy(); }
        const { BrowserWindow } = require('electron');
        const browserWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        try {
            const browserContents = browserWindow.webContents;
            const browserUrl = new URL(tourFrame.url);
            browserUrl.searchParams.delete('workspaceEmbedded');
            await browserWindow.loadURL(browserUrl.toString());
            await browserContents.executeJavaScript(`new Promise((resolve, reject) => {
                const start = Date.now(); const check = () => {
                    if (document.querySelector('[data-workspace-mode=deconstructed]')) resolve();
                    else if (Date.now() - start > 15000) reject(new Error('Browser controls did not load')); else requestAnimationFrame(check);
                }; check();
            })`);
            // Electron requires a focused window for native mouse input.
            browserWindow.show();
            browserWindow.focus();
            const originalZoom = browserContents.getZoomFactor();
            browserContents.setZoomFactor(1);
            try { await runTourReadingSmoke({ browserContents, browserWindow }); }
            finally { browserContents.setZoomFactor(originalZoom); }
            await runLinkPreviewSmoke(browserContents, { native: false });
            // The browser surface cannot supply local absolute paths. Its selected
            // Markdown remains an attachment, and user-edited drafts survive changes.
            await browserContents.executeJavaScript("document.querySelector('[data-workspace-mode=deconstructed]').click()");
            const browserPrompt = await browserContents.executeJavaScript("document.querySelector('dialog[open] textarea').value");
            assert.match(browserPrompt, /attached/);
            await browserContents.executeJavaScript(`(async () => {
                const input = document.querySelector('dialog[open] input[type=file]');
                const transfer = new DataTransfer();
                transfer.items.add(new File(['# My browser instructions\\nExplain the tradeoffs.'], 'my-browser-skill.md', {type:'text/markdown'}));
                input.files = transfer.files;
                input.dispatchEvent(new Event('change'));
                await new Promise(resolve => setTimeout(resolve, 100));
            })()`);
            assert.match(await browserContents.executeJavaScript("document.querySelector('dialog[open] textarea').value"), /my-browser-skill\.md/);
            assert.match(await browserContents.executeJavaScript("document.querySelector('[aria-label=\"Tour skill Markdown instructions\"]').value"), /Explain the tradeoffs/);
            const downloadPath = path.join(root, 'browser-download.md');
            const download = new Promise((resolve, reject) => {
                const browserSession = browserContents.session;
                const timeout = setTimeout(() => {
                    browserSession.removeListener('will-download', onDownload);
                    reject(new Error('Markdown download did not finish'));
                }, 10000);
                function onDownload(_event, item) {
                    item.setSavePath(downloadPath);
                    item.once('done', (_event, state) => {
                        clearTimeout(timeout);
                        if (state === 'completed') resolve(); else reject(new Error(`Markdown download ${state}`));
                    });
                }
                browserSession.once('will-download', onDownload);
            });
            await Promise.all([download, browserContents.executeJavaScript("document.querySelector('[data-workspace-prompt-action=workspace-skill-save]').click()")]);
            assert.equal(fs.readFileSync(downloadPath, 'utf8'), '# My browser instructions\nExplain the tradeoffs.');
            await browserContents.executeJavaScript(`(async () => {
                const draft = document.querySelector('dialog[open] textarea');
                draft.value = 'My edited prompt'; draft.dispatchEvent(new Event('input'));
                const input = document.querySelector('dialog[open] input[type=file]');
                const transfer = new DataTransfer();
                transfer.items.add(new File(['# Another skill'], 'another.md', {type:'text/markdown'}));
                input.files = transfer.files; input.dispatchEvent(new Event('change'));
                await new Promise(resolve => setTimeout(resolve, 100));
            })()`);
            assert.equal(await browserContents.executeJavaScript("document.querySelector('dialog[open] textarea').value"), 'My edited prompt');
            assert.equal(await browserContents.executeJavaScript("document.querySelector('.workspace-prompt-draft-notice').hidden"), false);
            await browserContents.executeJavaScript("document.querySelector('[data-workspace-prompt-action=workspace-prompt-reset]').click()");
            assert.match(await browserContents.executeJavaScript("document.querySelector('dialog[open] textarea').value"), /another\.md/);
        } finally { browserWindow.destroy(); }
        await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=compare][aria-pressed=true]') && document.querySelector('#workspace-tour-frame').hidden");
        assert.equal(session(), retainedOriginal);
        await open(path.join(root, 'one.txt'), path.join(root, 'two.txt'), {
            source: { kind: 'files', paths: [path.join(root, 'one.txt'), path.join(root, 'two.txt')], readOnly: true }
        });
        await waitFor("document.querySelectorAll('.multi-pane-provenance.is-readonly').length === 2");
        await evaluate("document.querySelector('[data-workspace-mode=history]').click()");
        await waitFor("document.querySelector('[data-workspace-mode=history][aria-pressed=true]')");
        assert.ok(session().multi.files.every((panel) => panel.editable === false));
        await openLink(serializeDeepLink({ ...comparisonLink, revision: revisions[0], line: 1 }));
        await waitFor("document.querySelectorAll('.monaco-editor').length >= 2");
        assert.equal((await navigation()).editorStates.left.selection.startLineNumber, 1);
        const tourLink = { kind: 'tour', repo: pathToFileURL(root).href, tour: 'smoke.bygone', mode: 'historical',
            focus: { part: 'step', scene: 'scene-two', step: 'step-two-b' } };
        await openLink(serializeDeepLink(tourLink));
        const linkedTour = latestTourWindow();
        try {
            await linkedTour.webContents.executeJavaScript(`new Promise((resolve, reject) => {
                const started = Date.now(); const check = () => {
                    if (document.activeElement.dataset.readingKey === 'step:scene-two:step-two-b') resolve();
                    else if (Date.now() - started > 10000) reject(new Error('Linked tour target did not render'));
                    else requestAnimationFrame(check);
                }; check();
            })`);
            await assert.rejects(openLink(serializeDeepLink({ ...tourLink, focus: { ...tourLink.focus, step: 'missing' } })), /unavailable/);
            assert.equal(latestTourWindow(), linkedTour, 'Missing sections do not open another window');
        } finally { linkedTour.destroy(); }
        console.log('Workspace smoke passed: cold/warm comparison links, exact line focus, semantic tour links and fail-closed recovery; link URL tooltips, hover/context/keyboard previews, blocked-header native previews in workspace/embedded/native tours, native editing context menus with system-action frames, navigation and cleanup, short prompts, native Markdown save/select, protected bundled skill, browser custom instructions/download, preserved drafts, History/Compare round trips, same-window tour, and read-only preservation.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

module.exports = { runWorkspaceSmoke };
