/* global require, module */
const assert = require('node:assert/strict');
const http = require('node:http');
const { BrowserWindow, Menu, webContents, clipboard } = require('electron');
const { setTimeout, clearTimeout } = require('node:timers');

async function checkPreviewContextMenu(guest, previewRenderer) {
    const originalPopup = Menu.prototype.popup;
    let shownMenu;
    let timeout;
    const clipboardContents = clipboard.availableFormats().map(format => [format, clipboard.readBuffer(format)]);
    try {
        clipboard.writeText('Link preview paste fixture');
        const popup = new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Preview right-click did not open a native menu')), 10000);
            Menu.prototype.popup = function (options) {
                shownMenu = this;
                const guestFocused = guest.isFocused();
                originalPopup.call(this, options);
                resolve({ menu: this, options, guestFocused });
            };
        });
        // Deliberately focus the host first: right-click must focus the guest.
        const owner = BrowserWindow.fromWebContents(previewRenderer);
        owner.show();
        owner.focus();
        previewRenderer.focus();
        const point = await guest.executeJavaScript(`(() => {
            const rect = document.querySelector('#username').getBoundingClientRect();
            return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
        })()`);
        const zoom = guest.getZoomFactor();
        const position = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom), button: 'right', clickCount: 1 };
        guest.sendInputEvent({ type: 'mouseDown', ...position });
        guest.sendInputEvent({ type: 'mouseUp', ...position });
        const { menu, options, guestFocused } = await popup;
        assert.equal(options.frame, guest.mainFrame, 'Native system actions target the clicked preview frame');
        assert.equal(options.window.webContents, previewRenderer, 'Menu belongs to the preview host window');
        assert.equal(guestFocused, true, 'Editing actions target the guest rather than the host');
        const roles = menu.items.map(item => item.role).filter(Boolean);
        assert.deepEqual(roles, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']);
        assert.equal(menu.items.find(item => item.role === 'paste').enabled, true, 'Editable field allows Paste');
    } finally {
        clearTimeout(timeout);
        Menu.prototype.popup = originalPopup;
        shownMenu?.closePopup();
        clipboard.clear();
        for (const [format, buffer] of clipboardContents) clipboard.writeBuffer(format, buffer);
    }
}

async function runLinkPreviewSmoke(renderer, { native = true, previewRenderer = renderer } = {}) {
    let requests = 0;
    const server = http.createServer((_request, response) => {
        requests++;
        response.writeHead(200, {
            'Content-Type': 'text/html', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "frame-ancestors 'none'"
        });
        response.end('<title>Frame-blocked fixture</title><h1>Preview loaded</h1><a id="next" href="/second">Next page</a><p><input id="username" name="username" autocomplete="username" placeholder="Username"></p>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/first`;
    const evaluate = code => previewRenderer.executeJavaScript(code, true);
    const waitFor = condition => evaluate(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const check = () => {
            try { if (${condition}) { resolve(true); return; } } catch {}
            if (Date.now() > deadline) reject(new Error(${JSON.stringify(condition)}));
            else requestAnimationFrame(check);
        }; check();
    })`);
    try {
        await renderer.executeJavaScript(`(() => {
            const link = document.createElement('a');
            link.id = 'native-preview-smoke'; link.href = ${JSON.stringify(url)};
            link.textContent = 'Blocked site';
            link.style.cssText = 'position:fixed;top:20px;left:20px';
            document.body.appendChild(link);
            link.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}));
            document.querySelector('.bygone-link-context-menu button').click();
        })()`, true);
        await waitFor("document.querySelector('.bygone-link-preview[open]')");
        if (!native) {
            assert.equal(await evaluate("Boolean(document.querySelector('.bygone-link-preview iframe[sandbox]'))"), true);
            assert.equal(await evaluate("document.querySelector('.bygone-link-preview p').textContent.includes('Bygone Desktop')"), true);
            return;
        }
        await waitFor("document.querySelector('.bygone-link-preview webview')?.getURL() === " + JSON.stringify(url)
            + " && !document.querySelector('.bygone-link-preview webview').isLoading()");
        const id = await evaluate("document.querySelector('.bygone-link-preview webview').getWebContentsId()");
        const guest = webContents.fromId(id);
        assert.ok(guest, 'Native guest exists');
        assert.equal(await guest.executeJavaScript("document.querySelector('h1').textContent"), 'Preview loaded',
            'Top-level preview renders despite X-Frame-Options DENY and CSP frame-ancestors none');
        assert.deepEqual(await guest.executeJavaScript("[typeof require, typeof window.__BYGONE_HOST__]"), ['undefined', 'undefined']);
        const preferences = guest.getLastWebPreferences();
        assert.equal(preferences.sandbox, true);
        assert.equal(preferences.contextIsolation, true);
        assert.equal(preferences.nodeIntegration, false);
        assert.equal(preferences.webSecurity, true);
        assert.ok(!preferences.preload, 'External page has no preload or app bridge');
        await checkPreviewContextMenu(guest, previewRenderer);
        await guest.executeJavaScript("document.querySelector('#next').click()", true);
        await waitFor("document.querySelector('.bygone-link-preview-header a').href.endsWith('/second') && !document.querySelector('.bygone-link-preview webview').isLoading()");
        await waitFor("!document.querySelector('.bygone-link-preview-controls button').disabled");
        await evaluate("document.querySelector('.bygone-link-preview-controls button').click()");
        await waitFor("document.querySelector('.bygone-link-preview-header a').href.endsWith('/first') && !document.querySelector('.bygone-link-preview webview').isLoading()");
        await waitFor("!document.querySelectorAll('.bygone-link-preview-controls button')[1].disabled");
        await evaluate("document.querySelectorAll('.bygone-link-preview-controls button')[1].click()");
        await waitFor("document.querySelector('.bygone-link-preview-header a').href.endsWith('/second') && !document.querySelector('.bygone-link-preview webview').isLoading()");
        const beforeReload = requests;
        await evaluate(`new Promise(resolve => {
            document.querySelector('.bygone-link-preview webview').addEventListener('did-stop-loading', resolve, {once:true});
            document.querySelectorAll('.bygone-link-preview-controls button')[2].click();
        })`);
        assert.ok(requests > beforeReload, 'Reload makes a new request');
        const destroyed = new Promise(resolve => guest.once('destroyed', resolve));
        guest.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        await waitFor("!document.querySelector('.bygone-link-preview[open]')");
        await destroyed;
        assert.equal(guest.isDestroyed(), true, 'Closing destroys the guest');
    } finally {
        await evaluate("document.querySelector('.bygone-link-preview[open]')?.close()");
        await waitFor("!document.querySelector('.bygone-link-preview')");
        await renderer.executeJavaScript("document.querySelector('#native-preview-smoke')?.remove()");
        await new Promise(resolve => server.close(resolve));
    }
}

module.exports = { runLinkPreviewSmoke };
