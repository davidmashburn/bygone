const path = require('path');
const { pathToFileURL } = require('url');
const { contextBridge, ipcRenderer } = require('electron');

const editorWorkerUrl = pathToFileURL(path.join(__dirname, '..', 'media', 'editor.worker.js')).toString();

ipcRenderer.on('melden:host-message', (_event, payload) => {
    window.postMessage({
        __meldenHostMessage: payload
    }, '*');
});

contextBridge.exposeInMainWorld('__MELDEN_HOST__', {
    environment: 'standalone',
    editorWorkerUrl,
    postMessage(message) {
        ipcRenderer.send('melden:renderer-message', message);
    }
});
