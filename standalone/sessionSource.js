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

function createFilesSource(paths) {
    return { kind: 'files', paths: normalizePaths(paths) };
}

function createDirectoriesSource(paths, labels) {
    return {
        kind: 'directories',
        paths: normalizePaths(paths),
        ...(Array.isArray(labels) ? { labels: [...labels] } : {})
    };
}

function createFileHistorySource(filePath, includeStaged, skipUnchanged) {
    return {
        kind: 'file-history',
        path: path.resolve(filePath),
        includeStaged: Boolean(includeStaged),
        skipUnchanged: Boolean(skipUnchanged)
    };
}

function createDirectoryHistorySource(dirPath, includeStaged, skipUnchanged) {
    return {
        kind: 'directory-history',
        path: path.resolve(dirPath),
        includeStaged: Boolean(includeStaged),
        skipUnchanged: Boolean(skipUnchanged)
    };
}

function createGitRefsSource(repoRoot, refs) {
    return {
        kind: 'git-refs',
        repoRoot: path.resolve(repoRoot),
        refs: [...refs]
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
