const { execFile } = require('child_process');
const { join } = require('path');
const { existsSync } = require('fs');
const { renderEvidenceHtml } = require('./dependency-view');

/** Runs snapshot analysis outside the extension/Electron event loop. */
async function buildNativeDependencyView(repoRoot, options) {
    const { signal, ...input } = options;
    if (signal?.aborted) throw new Error('Dependency analysis cancelled.');
    const result = await new Promise((resolve, reject) => {
        let worker = join(__dirname, '../out/dependencyNativeWorker.js');
        const unpacked = worker.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
        if (unpacked !== worker && existsSync(unpacked)) worker = unpacked;
        const child = execFile(process.execPath, [worker], {
            cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            detached: process.platform !== 'win32',
            maxBuffer: 32 * 1024 * 1024
        }, (error, stdout, stderr) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            // Reap adapters as well as their parent after timeout or cancellation.
            if (process.platform !== 'win32') stop();
            if (timedOut) return reject(new Error('Dependency analysis timed out.'));
            if (signal?.aborted) return reject(new Error('Dependency analysis cancelled.'));
            if (error) return reject(new Error(stderr.trim().slice(0, 2000) || error.message));
            try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
        });
        const stop = () => {
            if (!child.pid) return;
            if (process.platform === 'win32') {
                execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
            } else {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
            }
        };
        const abort = () => stop();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, 45000);
        timer.unref();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({ ...input, repoRoot }));
    });
    return { ...result, html: renderEvidenceHtml(result.report, { embedded: true, canLoadCorrespondence: true, focus: options.focus, changes: result.changes }) };
}

/** Select the host-owned anchor, never a path or link supplied by the webview. */
function dependencySource(report, source) {
    if (!source || typeof source !== 'object') return undefined;
    for (const snapshot of [report.base, report.head]) {
        for (const entry of [...snapshot.nodes, ...snapshot.sites]) {
            const anchor = entry.source;
            if (anchor.oid === source.oid && anchor.file === source.file && anchor.blobOid === source.blobOid
                && anchor.start === source.start && anchor.end === source.end && anchor.digest === source.digest) return anchor;
        }
    }
    return undefined;
}
module.exports = { buildNativeDependencyView, dependencySource };
