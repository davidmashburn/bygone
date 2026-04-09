import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const port = Number(process.env.MELDEN_WEB_PORT || '4173');
const host = '127.0.0.1';

const mimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'application/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml; charset=utf-8']
]);

const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', `http://localhost:${port}`);
    const targetPath = resolveRequestPath(requestUrl.pathname);

    if (!targetPath) {
        respond(response, 404, 'Not found');
        return;
    }

    try {
        const targetStat = await stat(targetPath);
        if (!targetStat.isFile()) {
            respond(response, 404, 'Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': mimeTypes.get(path.extname(targetPath)) || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        createReadStream(targetPath).pipe(response);
    } catch {
        respond(response, 404, 'Not found');
    }
});

server.listen(port, host, () => {
    console.log(`Melden web host running at http://${host}:${port}`);
});

function resolveRequestPath(requestPath) {
    if (requestPath === '/' || requestPath === '/index.html') {
        return path.join(root, 'web', 'index.html');
    }

    const normalized = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
    const candidate = path.join(root, normalized);

    if (!candidate.startsWith(root) || !existsSync(candidate)) {
        return null;
    }

    return candidate;
}

function respond(response, statusCode, message) {
    response.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8'
    });
    response.end(message);
}
