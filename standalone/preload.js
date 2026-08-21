const { contextBridge, ipcRenderer, webUtils } = require('electron');

const editorWorkerUrl = new URL('../media/editor.worker.js', window.location.href).toString();
const diffWorkerUrl = new URL('../media/diff.worker.js', window.location.href).toString();

ipcRenderer.on('bygone:host-message', (_event, payload) => {
    window.postMessage({
        __bygoneHostMessage: payload
    }, '*');
});

contextBridge.exposeInMainWorld('__BYGONE_HOST__', {
    environment: 'standalone',
    editorWorkerUrl,
    diffWorkerUrl,
    getPathForFile(file) {
        return webUtils.getPathForFile(file);
    },
    postMessage(message) {
        ipcRenderer.send('bygone:renderer-message', message);
    }
});
