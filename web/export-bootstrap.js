(async function bootstrapExport() {
    const status = document.getElementById('export-loading');
    const urls = [];
    const timer = setTimeout(() => {
        if (!window.__BYGONE_EXPORT_READY__) status.textContent = 'The viewer could not finish loading. Check internet access for CDN exports, then reopen this file. An embedded export works without internet.';
    }, 20000);
    try {
        const data = JSON.parse(document.getElementById('bygone-export-data').textContent);
        if (data.version !== 1 || !['minimal', 'full'].includes(data.profile)) throw new Error('Unsupported export format.');
        const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        for (const [id, text] of Object.entries(data.texts)) {
            if (typeof text !== 'string' || await hash(text) !== id) throw new Error('Exported evidence integrity check failed.');
        }
        const identity = { profile: data.profile, manifest: { ...data.manifest, generatedAt: undefined }, texts: data.texts, history: data.history };
        if (await hash(JSON.stringify(identity)) !== data.contentId) throw new Error('Exported snapshot integrity check failed.');
        document.body.classList.add('export-host');
        const blobUrls = new Map();
        for (const asset of data.assets) {
            let bytes;
            if (asset.base64) bytes = Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0));
            else {
                const response = await fetch(asset.url, { credentials: 'omit', integrity: asset.integrity, mode: 'cors' });
                if (!response.ok) throw new Error(`Viewer asset unavailable (${response.status}).`);
                bytes = new Uint8Array(await response.arrayBuffer());
            }
            const actual = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))));
            if (`sha256-${actual}` !== asset.integrity) throw new Error('Viewer asset integrity check failed.');
            const url = URL.createObjectURL(new Blob([bytes], { type: asset.name.endsWith('.css') ? 'text/css' : 'application/javascript' }));
            urls.push(url); blobUrls.set(asset.name, url);
        }
        function hydrate(value) {
            if (Array.isArray(value)) return value.map(hydrate);
            if (!value || typeof value !== 'object') return value;
            if (Object.keys(value).length === 1 && typeof value.$text === 'string') {
                if (typeof data.texts[value.$text] !== 'string') throw new Error('Missing exported evidence.');
                return data.texts[value.$text];
            }
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, hydrate(child)]));
        }
        data.manifest = hydrate(data.manifest);
        data.workers = { editor: blobUrls.get('media/editor.worker.js'), diff: blobUrls.get('media/diff.worker.js') };
        window.__BYGONE_EXPORT__ = data;
        for (const name of ['media/webview.css', 'web/presenter.css']) {
            await new Promise((resolve, reject) => {
                const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = blobUrls.get(name);
                link.onload = resolve; link.onerror = () => reject(new Error('Viewer styles could not load.')); document.head.append(link);
            });
        }
        for (const name of ['web/web-host.js', 'media/webview.js']) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script'); script.src = blobUrls.get(name);
                script.onload = resolve; script.onerror = () => reject(new Error('Viewer script could not load.')); document.body.append(script);
            });
        }
    } catch (error) {
        clearTimeout(timer);
        status.textContent = `Unable to open this export: ${error.message} Reopen to retry, or request an embedded export if the network is unavailable.`;
    }
    window.addEventListener('pagehide', event => {
        if (!event.persisted) { clearTimeout(timer); urls.forEach(url => URL.revokeObjectURL(url)); }
    });
})();
