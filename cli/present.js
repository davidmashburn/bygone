const { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require('fs');
const { createServer } = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { buildChangeTourManifest, parseChangeTourStory } = require('../out/changeTour.js');
const { buildTourAuthoringCoverage, buildTourCoverageReport } = require('../out/tourCoverage.js');
const { buildTourWindowTitle } = require('../out/windowTitle.js');
const { tokenMatches } = require('./commandSpec.js');
const { loadTourSource, parseTourSourceText, inspectTourConversion, convertTourSourceText, buildManifestForTourSource } = require('./tourFile.js');
const { createTourHistory } = require('./tourHistory.js');
const { pathToFileURL } = require('url');
const { resolveDocumentFocus, serializeDocumentFragment } = require('../out/deepLink.js');

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
    const story = !options.ignoreEnvironment && process.env.BYGONE_TOUR_STORY
        ? parseChangeTourStory(JSON.parse(readFileSync(path.resolve(cwd, process.env.BYGONE_TOUR_STORY), 'utf8')))
        : undefined;
    const loadedSource = tourPath ? await (options.loadTourSource || loadTourSource)(cwd, tourPath) : undefined;
    if (tourPath && !loadedSource) return null;
    const source = loadedSource?.source;
    const builtManifest = buildChangeTourManifest(cwd, {
        headRef: explicitHeadRef || source?.range?.head || headRef,
        baseRef: baseRef || source?.range?.base,
        title: options.ignoreEnvironment ? undefined : process.env.BYGONE_TOUR_TITLE,
        sourceUrl: options.ignoreEnvironment ? undefined : process.env.BYGONE_TOUR_SOURCE_URL,
        story,
        source
    });
    const manifest = source
        ? { ...builtManifest, authoringCoverage: buildTourAuthoringCoverage(buildTourCoverageReport(cwd, source)) }
        : builtManifest;
    if (options.location) resolveDocumentFocus(manifest, options.location.mode, options.location.focus);
    if (tourPath) {
        const root = realpathSync(builtManifest.repository?.root || cwd);
        const documentPath = realpathSync(loadedSource.resolvedPath);
        const relative = path.relative(root, documentPath).split(path.sep).join('/');
        const contained = relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative);
        manifest.localSource = { repo: pathToFileURL(root).href, tour: contained ? relative : pathToFileURL(documentPath).href };
    }
    const history = createTourHistory(manifest);
    const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const outputPath = options.ignoreEnvironment ? undefined : process.env.BYGONE_TOUR_OUTPUT;
    if (outputPath) {
        const resolvedOutput = path.resolve(cwd, outputPath);
        mkdirSync(path.dirname(resolvedOutput), { recursive: true });
        writeFileSync(resolvedOutput, serializedManifest, 'utf8');
        process.stdout.write(`Wrote change-tour manifest to ${resolvedOutput}\n`);
    }

    const tourWindowTitle = buildTourWindowTitle(manifest, 'Bygone');
    const presenterIndexPath = path.join(packageRoot, 'web', 'index.html');
    let presenterIndexTemplate;
    // Uploaded documents remain immutable, scoped to this existing repository,
    // and addressed independently so opening one cannot mutate another tab.
    const uploadedTours = new Map();

    const server = createServer((request, response) => {
        const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
        if (requestUrl.pathname === '/tour/open') {
            if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed' });
            if (!isSameOriginLoopbackRequest(request)) return respondJson(response, 403, { error: 'Forbidden' });
            if (uploadedTours.size >= 16) return respondJson(response, 409, { error: 'This presentation has reached its open-document limit. Start a new presentation to open more documents.' });
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk) => {
                body += chunk;
                if (Buffer.byteLength(body, 'utf8') > 2 * 1024 * 1024) { respondJson(response, 413, { error: 'Request too large' }); request.destroy(); }
            });
            request.on('end', () => {
                if (response.writableEnded) return;
                try {
                    const input = JSON.parse(body);
                    const conversion = inspectTourConversion(input.source);
                    if (conversion && input.convertToV4 !== true) return respondJson(response, 409, { conversion });
                    const converted = conversion ? convertTourSourceText(input.source) : null;
                    const uploadedSource = converted?.source || parseTourSourceText(input.source);
                    const loaded = buildManifestForTourSource(cwd, uploadedSource);
                    const id = String(uploadedTours.size + 1);
                    uploadedTours.set(id, { manifest: loaded, history: createTourHistory(loaded) });
                    respondJson(response, 200, { manifestUrl: `/loaded/${id}/tour.json`, repository: loaded.repository?.root || cwd, range: loaded.range, convertedSource: converted?.text });
                } catch (error) { respondJson(response, 400, { error: `Invalid tour for this repository: ${error.message}` }); }
            });
            return;
        }
        const loadedMatch = requestUrl.pathname.match(/^\/loaded\/(\d+)\/(tour\.json|history\/(?:list|diff|compare|compare-many|changed-files|revisions))$/);
        const loadedTour = loadedMatch ? uploadedTours.get(loadedMatch[1]) : null;
        if (loadedMatch && !loadedTour) return respondJson(response, 404, { error: 'Loaded document not found' });
        if (loadedTour && loadedMatch[2] === 'tour.json') return respondJson(response, 200, loadedTour.manifest);
        const requestHistory = loadedTour ? loadedTour.history : history;
        if (loadedMatch) requestUrl.pathname = `/${loadedMatch[2]}`;
        if (requestUrl.pathname === '/history/list' || requestUrl.pathname === '/history/diff'
            || requestUrl.pathname === '/history/compare' || requestUrl.pathname === '/history/compare-many'
            || requestUrl.pathname === '/history/changed-files' || requestUrl.pathname === '/history/revisions') {
            if (request.method !== 'POST') return respondJson(response, 405, { error: 'Method not allowed' });
            if (!isSameOriginLoopbackRequest(request)) return respondJson(response, 403, { error: 'Forbidden' });
            if (!requestHistory) return respondJson(response, 404, { error: 'History requires a version 2 tour.' });
            let body = '';
            request.setEncoding('utf8');
            request.on('data', chunk => {
                body += chunk;
                if (body.length > 8192) {
                    respondJson(response, 413, { error: 'Request too large' });
                    request.destroy();
                }
            });
            request.on('end', () => {
                if (response.writableEnded) return;
                try {
                    const input = JSON.parse(body);
                    const result = requestUrl.pathname === '/history/list'
                        ? requestHistory.list(input)
                        : requestUrl.pathname === '/history/diff'
                            ? requestHistory.diff(input)
                            : requestUrl.pathname === '/history/compare'
                                ? requestHistory.compare(input)
                                : requestUrl.pathname === '/history/compare-many'
                                    ? requestHistory.compareMany(input)
                                    : requestUrl.pathname === '/history/changed-files'
                                        ? requestHistory.changedFiles(input)
                                        : requestHistory.revisions(input);
                    respondJson(response, 200, result);
                } catch {
                    respondJson(response, 400, { error: 'Could not load history for this file and revision.' });
                }
            });
            return;
        }
        if (requestUrl.pathname === '/narration/claim') {
            if (request.method !== 'POST') {
                respond(response, 405, 'Method not allowed');
                return;
            }
            if (!isSameOriginLoopbackRequest(request)) {
                respond(response, 403, 'Forbidden');
                return;
            }
            options.onNarrationClaim?.();
            response.writeHead(204, { 'Cache-Control': 'no-store' });
            response.end();
            return;
        }
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
    const requestedPort = readPort(options.ignoreEnvironment ? undefined : process.env.BYGONE_TOUR_PORT);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        server.close();
        throw new Error('Could not determine the presentation server address.');
    }
    const url = `http://127.0.0.1:${address.port}/?manifest=/tour.json${options.location ? serializeDocumentFragment(options.location.mode, options.location.focus) : ''}`;
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
    return { manifest, server, url, sourcePath: loadedSource?.resolvedPath };
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

function respondJson(response, statusCode, body) {
    if (!response.headersSent) {
        response.writeHead(statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
    }
    response.end(JSON.stringify(body));
}

function isSameOriginLoopbackRequest(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string') return false;
    try {
        const parsed = new URL(origin);
        return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.host === host;
    } catch {
        return false;
    }
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
