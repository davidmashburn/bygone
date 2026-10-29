const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

/** Isolate graph scripts from the desktop window's stricter script policy. */
async function serveDependencyHtml(html) {
    const route = `/dependency/${randomBytes(24).toString('hex')}`;
    const hashes = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
    const policy = `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data:;`;
    const server = createServer((request, response) => {
        const address = server.address();
        if (request.url !== route || request.method !== 'GET' || request.headers.host !== `127.0.0.1:${address.port}`) {
            response.writeHead(404); response.end(); return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
            'Content-Security-Policy': policy, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        response.end(html);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    server.unref();
    return { url: `http://127.0.0.1:${server.address().port}${route}`, dispose() {
        server.close(); server.closeAllConnections();
    } };
}
module.exports = { serveDependencyHtml };
