const path = require('path');
const { pathToFileURL } = require('url');
const { contextBridge, ipcRenderer } = require('electron');

const editorWorkerUrl = pathToFileURL(path.join(__dirname, '..', 'media', 'editor.worker.js')).toString();

ipcRenderer.on('bygone:host-message', (_event, payload) => {
    window.postMessage({
        __bygoneHostMessage: payload
    }, '*');
});

contextBridge.exposeInMainWorld('__BYGONE_HOST__', {
    environment: 'standalone',
    editorWorkerUrl,
    postMessage(message) {
        ipcRenderer.send('bygone:renderer-message', message);
    }
});
