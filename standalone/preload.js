const path = require('path');
const { pathToFileURL } = require('url');
const { contextBridge, ipcRenderer } = require('electron');

const editorWorkerUrl = pathToFileURL(path.join(__dirname, '..', 'media', 'editor.worker.js')).toString();

contextBridge.exposeInMainWorld('__MELDEN_HOST__', {
    environment: 'standalone',
    editorWorkerUrl,
    postMessage(message) {
        ipcRenderer.send('melden:renderer-message', message);
    },
    onMessage(handler) {
        const listener = (_event, payload) => handler(payload);
        ipcRenderer.on('melden:host-message', listener);
    }
});
