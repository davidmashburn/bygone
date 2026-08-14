const { execFileSync } = require('child_process');
const { readFileSync, realpathSync, statSync } = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { loadAll: loadYamlDocuments } = require('js-yaml');
const { buildChangeTourManifest, parseChangeTourSource } = require('../out/changeTour.js');

const DEFAULT_MAX_TOUR_SOURCE_BYTES = 1024 * 1024;

function loadTourSource(cwd, sourcePath) {
    const resolvedPath = path.resolve(cwd, sourcePath);
    const source = readTourSourceDocument(resolvedPath);
    return { resolvedPath, source };
}

function resolveTourRepositoryRoot(cwd, sourcePath) {
    const candidates = [path.dirname(path.resolve(sourcePath)), path.resolve(cwd)];
    for (const candidate of candidates) {
        try {
            const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
                cwd: candidate,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            if (repoRoot) {
                return realpathSync(repoRoot);
            }
        } catch {
            // Try the caller's working directory for tours stored outside their repository.
        }
    }
    return path.resolve(cwd);
}

function readTourSourceDocument(sourcePath, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TOUR_SOURCE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error('The Bygone source size limit must be a positive safe integer.');
    }

    const sourceLabel = path.resolve(sourcePath);
    let stats;
    let bytes;
    try {
        stats = statSync(sourceLabel);
        if (!stats.isFile()) {
            throw new Error('path is not a regular file');
        }
        if (stats.size > maxBytes) {
            throw new Error(`file is ${stats.size} bytes; limit is ${maxBytes} bytes`);
        }
        bytes = readFileSync(sourceLabel);
    } catch (error) {
        throw new Error(`Could not read Bygone source ${sourceLabel}: ${errorMessage(error)}`, { cause: error });
    }

    if (bytes.length > maxBytes) {
        throw new Error(`Could not read Bygone source ${sourceLabel}: file is ${bytes.length} bytes; limit is ${maxBytes} bytes`);
    }
    if (bytes.includes(0)) {
        throw new Error(`Could not decode Bygone source ${sourceLabel}: NUL bytes are not allowed.`);
    }

    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        throw new Error(`Could not decode Bygone source ${sourceLabel} as UTF-8: ${errorMessage(error)}`, { cause: error });
    }

    let documents;
    try {
        documents = loadYamlDocuments(text);
    } catch (error) {
        throw new Error(`Could not parse Bygone source ${sourceLabel} as YAML: ${errorMessage(error)}`, { cause: error });
    }
    if (documents.length !== 1) {
        throw new Error(`Could not parse Bygone source ${sourceLabel}: expected one YAML document, found ${documents.length}.`);
    }

    try {
        return parseChangeTourSource(documents[0]);
    } catch (error) {
        throw new Error(`Invalid Bygone source ${sourceLabel}: ${errorMessage(error)}`, { cause: error });
    }
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function buildManifestForTourSource(cwd, source, options = {}) {
    return buildChangeTourManifest(cwd, {
        headRef: options.headRef || source.range?.head,
        baseRef: options.baseRef || source.range?.base,
        title: options.title,
        sourceUrl: options.sourceUrl,
        generatedAt: options.generatedAt,
        source
    });
}

module.exports = {
    DEFAULT_MAX_TOUR_SOURCE_BYTES,
    buildManifestForTourSource,
    loadTourSource,
    readTourSourceDocument,
    resolveTourRepositoryRoot
};
