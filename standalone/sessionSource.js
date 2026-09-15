/* global module, require */

const path = require('path');

const REFRESHABLE_SOURCE_KINDS = new Set([
    'files',
    'directories',
    'file-history',
    'directory-history',
    'git-refs',
    'branch-review'
]);

function normalizePaths(paths) {
    return (paths || []).map((candidate) => path.resolve(candidate));
}

function readOnlyProperty(readOnly) {
    return readOnly ? { readOnly: true } : {};
}

function createFilesSource(paths, readOnly = false) {
    return { kind: 'files', paths: normalizePaths(paths), ...readOnlyProperty(readOnly) };
}

function createDirectoriesSource(paths, labels, readOnly = false) {
    return {
        kind: 'directories',
        paths: normalizePaths(paths),
        ...(Array.isArray(labels) ? { labels: [...labels] } : {}),
        ...readOnlyProperty(readOnly)
    };
}

function createFileHistorySource(filePath, includeStaged, skipUnchanged, readOnly = false) {
    return {
        kind: 'file-history',
        path: path.resolve(filePath),
        includeStaged: Boolean(includeStaged),
        skipUnchanged: Boolean(skipUnchanged),
        ...readOnlyProperty(readOnly)
    };
}

function createDirectoryHistorySource(dirPath, includeStaged, skipUnchanged, readOnly = false) {
    return {
        kind: 'directory-history',
        path: path.resolve(dirPath),
        includeStaged: Boolean(includeStaged),
        skipUnchanged: Boolean(skipUnchanged),
        ...readOnlyProperty(readOnly)
    };
}

function createGitRefsSource(repoRoot, refs, readOnly = false) {
    return {
        kind: 'git-refs',
        repoRoot: path.resolve(repoRoot),
        refs: [...refs],
        ...readOnlyProperty(readOnly)
    };
}

function createBranchReviewSource(repoRoot, headRef, baseRef) {
    return {
        kind: 'branch-review',
        repoRoot: path.resolve(repoRoot),
        headRef,
        ...(baseRef ? { baseRef } : {})
    };
}

function isRefreshableSource(source) {
    return Boolean(source && REFRESHABLE_SOURCE_KINDS.has(source.kind));
}

function cloneSessionSource(source) {
    if (!source || typeof source !== 'object') {
        return { kind: 'blank' };
    }

    return JSON.parse(JSON.stringify(source));
}

function sessionSourcesEqual(left, right) {
    return JSON.stringify(left || null) === JSON.stringify(right || null);
}

module.exports = {
    cloneSessionSource,
    createBranchReviewSource,
    createDirectoriesSource,
    createDirectoryHistorySource,
    createFileHistorySource,
    createFilesSource,
    createGitRefsSource,
    isRefreshableSource,
    sessionSourcesEqual
};
