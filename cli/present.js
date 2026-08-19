const { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { createServer } = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { buildChangeTourManifest, parseChangeTourStory } = require('../out/changeTour.js');
const { buildTourWindowTitle } = require('../out/windowTitle.js');
const { tokenMatches } = require('./commandSpec.js');
const { loadTourSource } = require('./tourFile.js');

const MIME_TYPES = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'application/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml; charset=utf-8'],
    ['.ttf', 'font/ttf']
]);

async function startPresentation(args, cwd, packageRoot, options = {}) {
    const { headRef, baseRef, tourPath, explicitHeadRef } = parsePresentArgs(args);
    const story = process.env.BYGONE_TOUR_STORY
        ? parseChangeTourStory(JSON.parse(readFileSync(path.resolve(cwd, process.env.BYGONE_TOUR_STORY), 'utf8')))
        : undefined;
    const source = tourPath ? loadTourSource(cwd, tourPath).source : undefined;
    const manifest = buildChangeTourManifest(cwd, {
        headRef: explicitHeadRef || source?.range?.head || headRef,
        baseRef: baseRef || source?.range?.base,
        title: process.env.BYGONE_TOUR_TITLE,
        sourceUrl: process.env.BYGONE_TOUR_SOURCE_URL,
        story,
        source
    });
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const outputPath = process.env.BYGONE_TOUR_OUTPUT;
    if (outputPath) {
        const resolvedOutput = path.resolve(cwd, outputPath);
        mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        writeFileSync(resolvedOutput, serializedManifest, 'utf8');
        process.stdout.write(`Wrote change-tour manifest to ${resolvedOutput}\n`);
    }

    const tourWindowTitle = buildTourWindowTitle(manifest, 'Bygone');
    const presenterIndexPath = path.join(packageRoot, 'web', 'index.html');
    let presenterIndexTemplate;

    const server = createServer((request, response) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname === '/tour.json') {
            response.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            response.end(serializedManifest);
            return;
        }
        if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
            if (!presenterIndexTemplate) {
                presenterIndexTemplate = readFileSync(presenterIndexPath, 'utf8');
            }
            const html = presenterIndexTemplate.replace(
                /<title>Bygone Tour<\/title>/,
                `<title>${escapeHtml(tourWindowTitle)}</title>`
            );
            response.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            response.end(html);
            return;
        }
        const targetPath = resolveAssetPath(packageRoot, requestUrl.pathname);
        if (!targetPath) {
            respond(response, 404, 'Not found');
            return;
        }
        response.writeHead(200, {
            'Content-Type': MIME_TYPES.get(path.extname(targetPath)) || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        createReadStream(targetPath).on('error', () => respond(response, 500, 'Read failed')).pipe(response);
    });
    const requestedPort = readPort(process.env.BYGONE_TOUR_PORT);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Could not determine the presentation server address.');
    }
    const url = `http://127.0.0.1:${address.port}/?manifest=/tour.json`;
    if (options.announce !== false) {
        process.stdout.write(`Bygone change tour running at ${url}\n`);
        process.stdout.write('Press Ctrl+C to stop.\n');
    }
    if (options.open !== false && process.env.BYGONE_TOUR_NO_OPEN !== '1') {
        const openUrl = typeof options.openUrl === 'function' ? options.openUrl : openBrowser;
        try {
            await openUrl(url);
        } catch (error) {
            server.close();
            throw error;
        }
    }
    return { manifest, server, url };
}

function parsePresentArgs(args) {
    let headRef = 'HEAD';
    let explicitHeadRef;
    let baseRef;
    let tourPath;
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (tokenMatches('base', arg)) {
            if (!args[index + 1]) {
                throw new Error(`${arg} requires a Git ref.`);
            }
            baseRef = args[++index];
            continue;
        }
        if (tokenMatches('tour', arg)) {
            if (!args[index + 1]) throw new Error(`${arg} requires a YAML file.`);
            tourPath = args[++index];
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unknown present option: ${arg}`);
        }
        if (explicitHeadRef) {
            throw new Error('present accepts at most one head ref.');
        }
        headRef = arg;
        explicitHeadRef = arg;
    }
    return { headRef, baseRef, tourPath, explicitHeadRef };
}

function resolveAssetPath(packageRoot, requestPath) {
    if (requestPath === '/' || requestPath === '/index.html') {
        return null;
    }
    if (!requestPath.startsWith('/web/') && !requestPath.startsWith('/media/')) {
        return null;
    }
    const candidate = path.resolve(packageRoot, `.${requestPath}`);
    if (!candidate.startsWith(`${path.resolve(packageRoot)}${path.sep}`) || !existsSync(candidate)) {
        return null;
    }
    return candidate;
}

function openBrowser(url) {
    const command = process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '', url]]
            : ['xdg-open', [url]];
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
    child.unref();
}

function readPort(value) {
    if (!value) {
        return 0;
    }
    const port = Number.parseInt(value, 10);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('BYGONE_TOUR_PORT must be an integer from 0 to 65535.');
    }
    return port;
}

function respond(response, statusCode, message) {
    if (!response.headersSent) {
        response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end(message);
}

function escapeHtml(text) {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

module.exports = {
    parsePresentArgs,
    startPresentation,
    escapeHtml
};
