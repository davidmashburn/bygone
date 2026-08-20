/* global module, process, require */

const fs = require('fs');
const path = require('path');

const WINDOW_STATE_VERSION = 1;

function readWindowState(filePath) {
    try {
        return normalizeWindowState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return null;
    }
}

function writeWindowState(filePath, state) {
    const normalized = normalizeWindowState(state);
    if (!normalized) {
        throw new Error('Cannot save invalid Bygone window state.');
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try {
            fs.unlinkSync(temporaryPath);
        } catch {
            // The rename normally removes the temporary path.
        }
    }
}

function normalizeWindowState(value) {
    if (!value || typeof value !== 'object' || value.version !== WINDOW_STATE_VERSION) {
        return null;
    }

    const mainSource = value.main === null ? null : normalizeSessionSource(value.main?.source);
    if (value.main !== null && !mainSource) {
        return null;
    }
    if (!Array.isArray(value.tours)) {
        return null;
    }

    const tours = value.tours.map(normalizeTourLaunch).filter(Boolean);
    if (tours.length !== value.tours.length) {
        return null;
    }

    return {
        version: WINDOW_STATE_VERSION,
        main: mainSource ? { source: mainSource } : null,
        tours
    };
}

function normalizeSessionSource(source) {
    if (!source || typeof source !== 'object' || typeof source.kind !== 'string') {
        return null;
    }
    if (source.kind === 'blank') {
        return { kind: 'blank' };
    }
    if (source.kind === 'files' || source.kind === 'directories') {
        if (!isStringArray(source.paths) || source.paths.length === 0) return null;
        return {
            kind: source.kind,
            paths: [...source.paths],
            ...(source.kind === 'directories' && isStringArray(source.labels)
                ? { labels: [...source.labels] }
                : {})
        };
    }
    if (source.kind === 'file-history' || source.kind === 'directory-history') {
        if (typeof source.path !== 'string' || source.path.length === 0) return null;
        return {
            kind: source.kind,
            path: source.path,
            includeStaged: Boolean(source.includeStaged),
            skipUnchanged: Boolean(source.skipUnchanged)
        };
    }
    if (source.kind === 'git-refs') {
        if (typeof source.repoRoot !== 'string' || !isStringArray(source.refs) || source.refs.length < 2) return null;
        return { kind: source.kind, repoRoot: source.repoRoot, refs: [...source.refs] };
    }
    if (source.kind === 'branch-review') {
        if (typeof source.repoRoot !== 'string' || typeof source.headRef !== 'string') return null;
        return {
            kind: source.kind,
            repoRoot: source.repoRoot,
            headRef: source.headRef,
            ...(typeof source.baseRef === 'string' ? { baseRef: source.baseRef } : {})
        };
    }
    return null;
}

function normalizeTourLaunch(value) {
    if (!value || typeof value !== 'object' || !isStringArray(value.args) || typeof value.cwd !== 'string') {
        return null;
    }
    return { args: [...value.args], cwd: value.cwd };
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

module.exports = {
    WINDOW_STATE_VERSION,
    normalizeWindowState,
    readWindowState,
    writeWindowState
};
