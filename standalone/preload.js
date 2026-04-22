const path = require('path');
const { pathToFileURL } = require('url');
const { contextBridge, ipcRenderer } = require('electron');

const editorWorkerUrl = pathToFileURL(path.join(__dirname, '..', 'media', 'editor.worker.js')).toString();
const profileUi = parseBooleanEnv(process.env.BYGONE_PROFILE_UI);

ipcRenderer.on('bygone:host-message', (_event, payload) => {
    window.postMessage({
        __bygoneHostMessage: payload
    }, '*');
});

contextBridge.exposeInMainWorld('__BYGONE_HOST__', {
    environment: 'standalone',
    editorWorkerUrl,
    profileUi,
    postMessage(message) {
        ipcRenderer.send('bygone:renderer-message', message);
    }
});

function parseBooleanEnv(value) {
    if (typeof value !== 'string') {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
