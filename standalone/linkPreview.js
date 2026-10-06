/* global require, module, URL */
const { BrowserWindow, Menu, clipboard, session, shell } = require('electron');

const LINK_PREVIEW_PARTITION = 'bygone-link-preview';

function isWebUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return false; }
}

function openPreviewExternal({ url }) {
    if (isWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
}

function installLinkPreviewHost(contents) {
    // Preview cookies and permissions are separate from the app's own session.
    const previewSession = session.fromPartition(LINK_PREVIEW_PARTITION);
    previewSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    previewSession.setPermissionCheckHandler(() => false);
    contents.on('will-attach-webview', (event, preferences, params) => {
        if (params.partition !== LINK_PREVIEW_PARTITION || !isWebUrl(params.src)) {
            event.preventDefault();
            return;
        }
        delete preferences.preload;
        Object.assign(preferences, {
            sandbox: true, contextIsolation: true, nodeIntegration: false,
            nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
            webSecurity: true, allowRunningInsecureContent: false
        });
    });
    contents.on('did-attach-webview', (_event, guest) => {
        guest.setWindowOpenHandler(openPreviewExternal);
        guest.on('context-menu', (event, params) => {
            event.preventDefault();
            if (guest.isDestroyed() || contents.isDestroyed()) return;
            // Native editing and system actions must target the guest, not the host.
            guest.focus();
            const template = [];
            if (isWebUrl(params.linkURL)) {
                template.push(
                    { label: 'Open Link in Browser', click: () => openPreviewExternal({ url: params.linkURL }) },
                    { label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) },
                    { type: 'separator' }
                );
            }
            if (params.mediaType === 'image' && params.hasImageContents) {
                template.push({ label: 'Copy Image', click: () => {
                    if (!guest.isDestroyed()) guest.copyImageAt(params.x, params.y);
                } }, { type: 'separator' });
            }
            if (params.isEditable) {
                template.push(
                    { role: 'undo', enabled: params.editFlags.canUndo },
                    { role: 'redo', enabled: params.editFlags.canRedo },
                    { type: 'separator' },
                    { role: 'cut', enabled: params.editFlags.canCut }
                );
            }
            template.push({ role: 'copy', enabled: params.editFlags.canCopy });
            if (params.isEditable) template.push({ role: 'paste', enabled: params.editFlags.canPaste });
            template.push({ role: 'selectAll', enabled: params.editFlags.canSelectAll });
            Menu.buildFromTemplate(template).popup({
                window: BrowserWindow.fromWebContents(contents),
                // Enables macOS AutoFill, Writing Tools, and Services in this frame.
                ...(params.frame ? { frame: params.frame } : {})
            });
        });
        const guardNavigation = (event, url) => {
            if (!isWebUrl(url)) event.preventDefault();
        };
        guest.on('will-navigate', guardNavigation);
        guest.on('will-redirect', guardNavigation);
        // Keyboard input inside a guest doesn't reach the host's modal dialog.
        guest.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown' || input.key !== 'Escape') return;
            event.preventDefault();
            void contents.executeJavaScript("document.querySelector('.bygone-link-preview[open]')?.close()").catch(() => {});
        });
    });
}

module.exports = { installLinkPreviewHost, openPreviewExternal };
