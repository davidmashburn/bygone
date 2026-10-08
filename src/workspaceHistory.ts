import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import type { DirectoryEntry } from './directoryDiff';
import { buildHistoryDirectoryEntries } from './historyDirectory';

const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_GIT_LIST_BYTES = 64 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 4 * 1024 * 1024;

type WorkspacePathType = 'file' | 'directory';

export interface WorkspaceHistoryPath {
    path: string;
    type: WorkspacePathType;
}

export interface WorkspaceHistoryContext {
    repoRoot: string;
    paths: WorkspaceHistoryPath[];
    revisions: string[];
    headOid: string;
    activeRevision: string;
}

export interface WorkspaceHistoryOptions {
    includeStaged?: boolean;
}

export interface WorkspaceHistoryEntry {
    commit: string;
    parentCommit: string | null;
    shortCommit: string;
    summary: string;
    timestamp: string;
    author?: string;
    authorEmail?: string;
    message?: string;
    parents?: string[];
}

export interface WorkspaceHistoryReadResult {
    content: string;
    exists: boolean;
    reason?: string;
}

export interface WorkspaceHistory {
    entries: WorkspaceHistoryEntry[];
    files: string[];
    read(relativePath: string, revision: string): WorkspaceHistoryReadResult;
    changedCommits(relativePath: string): string[];
    changedFiles(revisions: readonly string[]): string[];
    directoryEntries(revisions: readonly string[]): DirectoryEntry[];
}

interface NormalizedScope {
    path: string;
    type: WorkspacePathType;
}

interface TreeRecord {
    mode: string;
    type: string;
    oid: string;
    path: string;
}

interface CommitMetadata {
    commit: string;
    shortCommit: string;
    timestamp: string;
    summary: string;
    parentCommit: string | null;
    author: string;
    authorEmail: string;
    message: string;
    parents: string[];
}

interface SafeWorkingTreePath {
    absolutePath: string;
    resolvedPath: string;
}

interface BoundedFileRead {
    kind: 'missing' | 'too-large' | 'content';
    bytes?: Buffer;
}

interface NormalizedRevisionSelection {
    commits: string[];
    states: Set<'WORKTREE' | 'INDEX'>;
}

const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Build a read-only history view over one repository and one explicitly
 * scoped set of paths. The repository is inspected when this function is
 * called; returned operations only read Git objects, the index, or files on
 * disk and expose no mutation API.
 */
export function createWorkspaceHistory(
    context: WorkspaceHistoryContext,
    options: WorkspaceHistoryOptions = {}
): WorkspaceHistory {
    const repoRoot = resolveRepositoryRoot(context);
    const scopes = normalizeScopes(context.paths);
    const includeStaged = normalizeIncludeStaged(options);
    const headOid = validateCommitOid(repoRoot, context.headOid, 'head OID');
    const revisionSelection = normalizeRevisionList(context.revisions, repoRoot);
    const localStates = resolveLocalStates(revisionSelection.states, includeStaged);
    // Local revisions are rooted at the resolver's pinned head, not at the
    // checkout's current HEAD.  Include that anchor when another committed
    // root was selected so WORKTREE/INDEX never silently lose the pinned
    // ancestry (or read against an unrelated branch).
    const selectedRoots = [...new Set(
        revisionSelection.commits.length > 0
            ? [...revisionSelection.commits, ...(localStates.size > 0 ? [headOid] : [])]
            : [headOid]
    )];
    const axis = buildCommitAxis(repoRoot, selectedRoots);
    const axisSet = new Set(axis);
    const allowedCommits = new Set(axis);

    const metadata = readCommitMetadataBatch(repoRoot, selectedRoots, axis);
    validateActiveRevision(context.activeRevision, axisSet, localStates);

    const files = collectFiles(repoRoot, scopes, selectedRoots, localStates);
    const localEntries = buildLocalEntries(localStates, headOid);
    const entries = [
        ...localEntries,
        ...metadata.slice().reverse().map((entry) => ({
            commit: entry.commit,
            parentCommit: entry.parentCommit,
            shortCommit: entry.shortCommit,
            summary: entry.summary,
            timestamp: entry.timestamp,
            author: entry.author,
            authorEmail: entry.authorEmail,
            message: entry.message,
            parents: entry.parents
        }))
    ];
    const changedCommitsCache = new Map<string, string[]>();
    const changedFilesCache = new Map<string, string[]>();
    let emptyTree: string;

    return {
        entries,
        files,
        directoryEntries(revisions: readonly string[]): DirectoryEntry[] {
            const changed = this.changedFiles(revisions);
            // Inventory trees once per revision, without loading every changed blob.
            const inventories = revisions.map(revision => {
                if (revision === 'EMPTY') return new Set<string>();
                if (revision === 'WORKTREE') return new Set(changed.filter(file => isLocalPath(repoRoot, file)));
                if (revision === 'INDEX') return new Set(listIndexRecords(repoRoot, scopes).map(record => record.path));
                return new Set(runGitText(['ls-tree', '-r', '--name-only', '-z', revision], repoRoot, MAX_GIT_LIST_BYTES).split('\0').filter(Boolean));
            });
            // Working-tree parents can exist even when all changed children were
            // deleted. Keep that filesystem fact at the live repository boundary.
            revisions.forEach((revision, index) => {
                if (revision !== 'WORKTREE') return;
                for (const file of changed) {
                    const parts = file.split('/');
                    for (let depth = 1; depth < parts.length; depth++) {
                        const directory = parts.slice(0, depth).join('/');
                        try {
                            if (fs.lstatSync(path.join(repoRoot, directory)).isDirectory()) inventories[index].add(directory);
                        } catch { /* Absent parent. */ }
                    }
                }
            });
            return buildHistoryDirectoryEntries(changed, inventories);
        },
        changedFiles: (revisions: readonly string[]): string[] => {
            for (const revision of revisions) {
                if (revision !== 'EMPTY' && !allowedCommits.has(revision)
                    && !localStates.has(revision as 'WORKTREE' | 'INDEX')) {
                    throw new Error(`Unknown history revision: ${revision}`);
                }
            }
            const live = revisions.includes('WORKTREE') || revisions.includes('INDEX');
            const key = JSON.stringify(revisions);
            const cached = !live && changedFilesCache.get(key);
            if (cached) return cached.slice();
            const tree = (revision: string): string => {
                if (revision !== 'EMPTY') return revision;
                // Hash without writing an object; works for SHA-1 and SHA-256 repos.
                emptyTree ||= execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], {
                    cwd: repoRoot, input: '', encoding: 'utf8'
                }).trim();
                return emptyTree;
            };
            const changed = new Set<string>();
            for (let index = 1; index < revisions.length; index++) {
                const pair = [revisions[index - 1], revisions[index]];
                if (pair[0] === pair[1]) continue;
                const committed = pair.filter(revision => revision !== 'WORKTREE' && revision !== 'INDEX').map(tree);
                const args = ['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z'];
                if (pair.includes('INDEX') && !pair.includes('WORKTREE')) args.push('--cached');
                const output = runGitText([...args, ...committed, '--', ...pathspecsForScopes(scopes)], repoRoot, MAX_GIT_LIST_BYTES);
                output.split('\0').filter(Boolean).forEach(file => changed.add(file));
                if (pair.includes('WORKTREE')) {
                    const untracked = runGitText(['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspecsForScopes(scopes)], repoRoot, MAX_GIT_LIST_BYTES);
                    untracked.split('\0').filter(Boolean).forEach(file => changed.add(file));
                }
            }
            const result = files.filter(file => changed.has(file));
            if (!live) changedFilesCache.set(key, result);
            return result.slice();
        },
        read: (relativePath: string, revision: string): WorkspaceHistoryReadResult => {
            const normalizedPath = validateScopedPath(relativePath, scopes);
            if (revision === 'EMPTY') {
                return emptyReadResult();
            }
            if (revision === 'WORKTREE') {
                if (!localStates.has('WORKTREE')) {
                    throw new Error('WORKTREE is not available for this workspace history axis.');
                }
                return readWorkingTreeFile(repoRoot, normalizedPath);
            }
            if (revision === 'INDEX') {
                if (!localStates.has('INDEX')) {
                    throw new Error('INDEX is not available for this workspace history axis.');
                }
                return readIndexFile(repoRoot, normalizedPath);
            }
            if (!allowedCommits.has(revision)) {
                throw new Error(`Unknown history revision: ${revision}`);
            }
            return readCommittedFile(repoRoot, normalizedPath, revision);
        },
        changedCommits: (relativePath: string): string[] => {
            const normalizedPath = validateScopedPath(relativePath, scopes);
            const cached = changedCommitsCache.get(normalizedPath);
            if (cached) {
                return cached.slice();
            }

            const pathspecs = pathspecsForPath(normalizedPath);
            const output = runGitText([
                'log',
                '--topo-order',
                '--format=%H',
                ...selectedRoots.slice().sort(),
                '--',
                ...pathspecs
            ], repoRoot, MAX_GIT_LIST_BYTES);
            const changed = new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
            const result = axis.filter((commit) => changed.has(commit));

            // Treat the live states like history entries in the marker set,
            // but compare them only with their pinned parent.  This keeps
            // clean local entries visible in the rail while marking only
            // actual working/index changes.
            if (localStates.has('INDEX')) {
                const indexValue = readIndexFile(repoRoot, normalizedPath);
                const headValue = readCommittedFile(repoRoot, normalizedPath, headOid);
                if (!sameReadResult(indexValue, headValue)) {
                    result.push('INDEX');
                }
            }
            if (localStates.has('WORKTREE')) {
                const worktreeValue = readWorkingTreeFile(repoRoot, normalizedPath);
                const parentValue = localStates.has('INDEX')
                    ? readIndexFile(repoRoot, normalizedPath)
                    : readCommittedFile(repoRoot, normalizedPath, headOid);
                if (!sameReadResult(worktreeValue, parentValue)) {
                    result.push('WORKTREE');
                }
            }

            changedCommitsCache.set(normalizedPath, result);
            return result.slice();
        }
    };
}

function resolveRepositoryRoot(context: WorkspaceHistoryContext): string {
    if (!context || typeof context !== 'object' || typeof context.repoRoot !== 'string') {
        throw new Error('A repository root is required for workspace history.');
    }

    let requestedRoot: string;
    try {
        requestedRoot = fs.realpathSync(context.repoRoot);
    } catch {
        throw new Error('The workspace history repository root could not be resolved.');
    }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(requestedRoot);
    } catch {
        throw new Error('The workspace history repository root could not be read.');
    }
    if (!stat.isDirectory()) {
        throw new Error('The workspace history repository root is not a directory.');
    }

    const detectedRoot = runGitText(['rev-parse', '--show-toplevel'], requestedRoot, MAX_GIT_METADATA_BYTES).trim();
    let canonicalDetectedRoot: string;
    try {
        canonicalDetectedRoot = fs.realpathSync(detectedRoot);
    } catch {
        throw new Error('The workspace history repository root could not be resolved by Git.');
    }
    if (canonicalDetectedRoot !== requestedRoot) {
        throw new Error('The workspace history repository root must be the exact Git worktree root.');
    }
    return requestedRoot;
}

function normalizeIncludeStaged(options: WorkspaceHistoryOptions): boolean {
    if (options === undefined || options === null) {
        return false;
    }
    if (typeof options !== 'object') {
        throw new Error('Workspace history options must be an object.');
    }
    if (options.includeStaged === undefined) {
        return false;
    }
    if (typeof options.includeStaged !== 'boolean') {
        throw new Error('includeStaged must be a boolean.');
    }
    return options.includeStaged;
}

function normalizeScopes(rawScopes: WorkspaceHistoryPath[]): NormalizedScope[] {
    if (!Array.isArray(rawScopes)) {
        throw new Error('Workspace history paths must be an array.');
    }

    // A Git-ref source has no path operands.  In the shared workspace
    // contract that means the repository root, not an empty/unscoped view.
    const scopes: NormalizedScope[] = rawScopes.length === 0
        ? [{ path: '', type: 'directory' }]
        : [];
    const seen = new Set<string>();
    for (const rawScope of rawScopes) {
        if (!rawScope || typeof rawScope !== 'object') {
            throw new Error('Each workspace history path must be an object.');
        }
        if (rawScope.type !== 'file' && rawScope.type !== 'directory') {
            throw new Error('Workspace history paths must be files or directories.');
        }
        const normalizedPath = normalizeRepositoryPath(rawScope.path, rawScope.type);
        const key = `${rawScope.type}:${normalizedPath}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        scopes.push({ path: normalizedPath, type: rawScope.type });
    }
    return scopes;
}

function normalizeRepositoryPath(value: string, type: WorkspacePathType): string {
    if (typeof value !== 'string') {
        throw new Error('Workspace history paths must be strings.');
    }

    if (value.startsWith('/')) {
        throw new Error(`Workspace history path must be a safe relative path: ${value}`);
    }

    let candidate = value;
    if (type === 'directory') {
        candidate = candidate.replace(/\/+$/g, '');
    }
    if (candidate === '.' || candidate === '') {
        if (type === 'directory') {
            return '';
        }
        throw new Error('File history paths must be relative paths, not the repository root.');
    }
    if (
        candidate.includes('\\')
        || candidate.includes('\0')
        || candidate.includes('\r')
        || candidate.includes('\n')
    ) {
        throw new Error(`Workspace history path must be a safe relative path: ${value}`);
    }

    const segments = candidate.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
        throw new Error(`Workspace history path must be a safe relative path: ${value}`);
    }
    return candidate;
}

function normalizeRevisionList(
    rawRevisions: string[],
    repoRoot: string
): NormalizedRevisionSelection {
    if (!Array.isArray(rawRevisions)) {
        throw new Error('Workspace history revisions must be an array.');
    }

    const commits: string[] = [];
    const states = new Set<'WORKTREE' | 'INDEX'>();
    for (const rawRevision of rawRevisions) {
        if (typeof rawRevision !== 'string') {
            throw new Error('Workspace history revisions must be strings.');
        }
        const state = rawRevision.toUpperCase();
        if (state === 'WORKTREE') {
            states.add('WORKTREE');
            continue;
        }
        if (state === 'INDEX') {
            states.add('INDEX');
            continue;
        }
        const revision = validateCommitOid(repoRoot, rawRevision, 'revision OID');
        if (!commits.includes(revision)) {
            commits.push(revision);
        }
    }
    return { commits, states };
}

function resolveLocalStates(
    requestedStates: ReadonlySet<'WORKTREE' | 'INDEX'>,
    includeStaged: boolean
): Set<'WORKTREE' | 'INDEX'> {
    const states = new Set(requestedStates);
    // A pure committed axis must never acquire the current checkout merely
    // because the caller enabled staged-file support.  Once WORKTREE is an
    // explicit operand, includeStaged exposes its exact INDEX parent too;
    // INDEX itself is also accepted as an explicit revision when the option
    // is false.
    if (states.has('WORKTREE') && includeStaged) {
        states.add('INDEX');
    }
    return states;
}

function validateCommitOid(repoRoot: string, value: string, label: string): string {
    if (typeof value !== 'string' || !OID_PATTERN.test(value)) {
        throw new Error(`Invalid ${label}; expected a full Git commit OID.`);
    }
    let objectType: string;
    try {
        objectType = runGitText(['cat-file', '-t', value], repoRoot, MAX_GIT_METADATA_BYTES).trim();
    } catch {
        throw new Error(`Could not resolve ${label}: ${value}`);
    }
    if (objectType !== 'commit') {
        throw new Error(`${label} does not identify a commit: ${value}`);
    }
    return value;
}

function buildCommitAxis(repoRoot: string, selectedRoots: readonly string[]): string[] {
    const output = runGitText([
        'rev-list',
        '--topo-order',
        '--reverse',
        ...selectedRoots.slice().sort()
    ], repoRoot, MAX_GIT_LIST_BYTES);
    const commits = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const unique = [...new Set(commits)];
    const selectedSet = new Set(selectedRoots);
    for (const root of selectedRoots) {
        if (!unique.includes(root)) {
            throw new Error(`Git did not return selected revision ${root} in the history axis.`);
        }
    }
    if (unique.some((commit) => !OID_PATTERN.test(commit))) {
        throw new Error('Git returned an invalid commit OID while building workspace history.');
    }
    if (selectedSet.size === 0) {
        return [];
    }
    return unique;
}

function validateActiveRevision(
    activeRevision: string,
    axis: ReadonlySet<string>,
    localStates: ReadonlySet<'WORKTREE' | 'INDEX'>
): void {
    if (typeof activeRevision !== 'string') {
        throw new Error('An active workspace history revision is required.');
    }
    if (activeRevision === 'EMPTY' || activeRevision === 'WORKTREE') {
        if (activeRevision === 'WORKTREE' && !localStates.has('WORKTREE')) {
            throw new Error('WORKTREE is not included in the workspace history axis.');
        }
        return;
    }
    if (activeRevision === 'INDEX') {
        if (!localStates.has('INDEX')) {
            throw new Error('INDEX is not included in the workspace history axis.');
        }
        return;
    }
    if (!OID_PATTERN.test(activeRevision) || !axis.has(activeRevision)) {
        throw new Error(`Active workspace history revision is not on the selected axis: ${activeRevision}`);
    }
}

function readCommitMetadataBatch(
    repoRoot: string,
    selectedRoots: readonly string[],
    axis: readonly string[]
): CommitMetadata[] {
    const output = runGitText([
        'log',
        '--topo-order',
        '--reverse',
        '--format=%H%x00%h%x00%cI%x00%s%x00%P%x00%an%x00%ae%x00%B%x1e',
        ...selectedRoots.slice().sort()
    ], repoRoot, MAX_GIT_METADATA_BYTES);
    const axisSet = new Set(axis);
    const metadata: CommitMetadata[] = [];
    for (const rawRecord of output.split('\x1e')) {
        const record = rawRecord.replace(/^\n+|\n+$/g, '');
        if (!record) {
            continue;
        }
        const [commit = '', shortCommit = '', timestamp = '', summary = '', parentField = '', author = '', authorEmail = '', message = ''] = record.split('\0');
        if (!axisSet.has(commit)) {
            continue;
        }
        metadata.push({
            commit,
            shortCommit: shortCommit || commit.slice(0, 7),
            timestamp,
            summary,
            author,
            authorEmail,
            message: message.trimEnd(),
            parents: parentField.split(' ').filter(Boolean),
            parentCommit: parentField.split(' ').find(Boolean) ?? null
        });
    }
    if (metadata.length !== axis.length || metadata.some((entry, index) => entry.commit !== axis[index])) {
        throw new Error('Git returned incomplete commit metadata for the workspace history axis.');
    }
    return metadata;
}

function collectFiles(
    repoRoot: string,
    scopes: readonly NormalizedScope[],
    selectedRoots: readonly string[],
    localStates: ReadonlySet<'WORKTREE' | 'INDEX'>
): string[] {
    const explicitFiles = new Set(
        scopes.filter((scope) => scope.type === 'file').map((scope) => scope.path)
    );
    const candidates = new Set(explicitFiles);
    const historicalPaths = new Set(listHistoricalPaths(repoRoot, selectedRoots, scopes));
    for (const historicalPath of historicalPaths) {
        if (isPathInScopes(historicalPath, scopes)) {
            candidates.add(historicalPath);
        }
    }

    if (localStates.has('INDEX')) {
        for (const record of listIndexRecords(repoRoot, scopes)) {
            if (record.type === 'blob' && isPathInScopes(record.path, scopes)) {
                candidates.add(record.path);
            }
        }
    }
    if (localStates.has('WORKTREE')) {
        for (const worktreePath of listWorktreePaths(repoRoot, scopes)) {
            if (isPathInScopes(worktreePath, scopes)) {
                candidates.add(worktreePath);
            }
        }
    }

    return [...candidates]
        .filter((candidate) => explicitFiles.has(candidate) || historicalPaths.has(candidate) || (
            localStates.size > 0 && isLocalPath(repoRoot, candidate)
        ))
        .sort();
}

function listHistoricalPaths(
    repoRoot: string,
    selectedRoots: readonly string[],
    scopes: readonly NormalizedScope[]
): string[] {
    const output = runGitBuffer([
        'log',
        '--name-only',
        '--no-renames',
        '-m',
        '-z',
        '--pretty=format:',
        ...selectedRoots.slice().sort(),
        '--',
        ...pathspecsForScopes(scopes)
    ], repoRoot, MAX_GIT_LIST_BYTES);
    return output.toString('utf8').split('\0').filter(Boolean);
}

function isLocalPath(repoRoot: string, relativePath: string): boolean {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    try {
        const stat = fs.lstatSync(absolutePath);
        return stat.isFile() || stat.isSymbolicLink();
    } catch {
        return false;
    }
}

function buildLocalEntries(
    localStates: ReadonlySet<'WORKTREE' | 'INDEX'>,
    headOid: string
): WorkspaceHistoryEntry[] {
    if (localStates.size === 0) {
        return [];
    }

    const entries: WorkspaceHistoryEntry[] = [];
    if (localStates.has('WORKTREE')) {
        entries.push({
            commit: 'WORKTREE',
            parentCommit: localStates.has('INDEX') ? 'INDEX' : headOid,
            shortCommit: 'Working Tree',
            summary: '',
            timestamp: ''
        });
    }
    if (localStates.has('INDEX')) {
        entries.push({
            commit: 'INDEX',
            parentCommit: headOid,
            shortCommit: 'Staged',
            summary: '',
            timestamp: ''
        });
    }
    return entries;
}

function listIndexRecords(repoRoot: string, scopes: readonly NormalizedScope[]): TreeRecord[] {
    if (scopes.length === 0) {
        return [];
    }
    const output = runGitBuffer([
        'ls-files',
        '--stage',
        '-z',
        '--',
        ...pathspecsForScopes(scopes)
    ], repoRoot, MAX_GIT_LIST_BYTES);
    return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
        const separator = record.indexOf('\t');
        if (separator < 0) {
            return { mode: '', type: '', oid: '', path: record };
        }
        const [mode = '', oid = '', stage = ''] = record.slice(0, separator).split(' ');
        return {
            mode: `${mode}:${stage}`,
            type: mode === '160000' ? 'commit' : 'blob',
            oid,
            path: record.slice(separator + 1)
        };
    });
}

function listWorktreePaths(repoRoot: string, scopes: readonly NormalizedScope[]): string[] {
    if (scopes.length === 0) {
        return [];
    }
    const output = runGitBuffer([
        'ls-files',
        '-co',
        '--exclude-standard',
        '-z',
        '--',
        ...pathspecsForScopes(scopes)
    ], repoRoot, MAX_GIT_LIST_BYTES);
    return output.toString('utf8').split('\0').filter(Boolean).filter((relativePath) => {
        const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
        try {
            const stat = fs.lstatSync(absolutePath);
            return stat.isFile() || stat.isSymbolicLink();
        } catch {
            return false;
        }
    });
}

function parseTreeRecords(output: Buffer): TreeRecord[] {
    return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
        const separator = record.indexOf('\t');
        if (separator < 0) {
            return { mode: '', type: '', oid: '', path: record };
        }
        const [mode = '', type = '', oid = ''] = record.slice(0, separator).split(' ');
        return { mode, type, oid, path: record.slice(separator + 1) };
    });
}

function pathspecsForScopes(scopes: readonly NormalizedScope[]): string[] {
    if (scopes.some((scope) => scope.type === 'directory' && scope.path === '')) {
        return [];
    }
    return scopes.map((scope) => pathspecForPath(scope.path));
}

function pathspecsForPath(relativePath: string): string[] {
    return relativePath === '' ? [] : [pathspecForPath(relativePath)];
}

function pathspecForPath(relativePath: string): string {
    return `:(top,literal)${relativePath}`;
}

function isPathInScopes(relativePath: string, scopes: readonly NormalizedScope[]): boolean {
    return scopes.some((scope) => {
        if (scope.type === 'file') {
            return relativePath === scope.path;
        }
        return scope.path === '' || relativePath === scope.path || relativePath.startsWith(`${scope.path}/`);
    });
}

function validateScopedPath(relativePath: string, scopes: readonly NormalizedScope[]): string {
    const normalizedPath = normalizeRepositoryPath(relativePath, 'directory');
    if (!isPathInScopes(normalizedPath, scopes)) {
        throw new Error(`Path is outside the workspace history scope: ${relativePath}`);
    }
    return normalizedPath;
}

function readCommittedFile(
    repoRoot: string,
    relativePath: string,
    revision: string
): WorkspaceHistoryReadResult {
    if (relativePath === '') {
        return emptyReadResult();
    }
    const records = listTreeRecordsForPath(repoRoot, revision, relativePath);
    const record = records.find((candidate) => candidate.path === relativePath);
    if (!record) {
        return emptyReadResult();
    }
    if (record.type !== 'blob') {
        return {
            content: '',
            exists: false,
            reason: 'Git submodule content is not owned by this repository.'
        };
    }
    return readBlob(repoRoot, record.oid);
}

function listTreeRecordsForPath(repoRoot: string, revision: string, relativePath: string): TreeRecord[] {
    return parseTreeRecords(runGitBuffer([
        'ls-tree',
        '-r',
        '-z',
        revision,
        '--',
        ...pathspecsForPath(relativePath)
    ], repoRoot, MAX_GIT_LIST_BYTES));
}

function readBlob(repoRoot: string, oid: string): WorkspaceHistoryReadResult {
    let size: number;
    try {
        size = Number.parseInt(runGitText(['cat-file', '-s', oid], repoRoot, MAX_GIT_METADATA_BYTES).trim(), 10);
    } catch {
        return {
            content: '',
            exists: false,
            reason: 'Git blob content is unavailable.'
        };
    }
    if (!Number.isSafeInteger(size) || size < 0) {
        return {
            content: '',
            exists: false,
            reason: 'Git blob size is invalid.'
        };
    }
    if (size > MAX_CONTENT_BYTES) {
        return omittedReadResult('File is too large to display (over 2 MiB).');
    }

    let bytes: Buffer;
    try {
        bytes = runGitBuffer(['cat-file', 'blob', oid], repoRoot, MAX_CONTENT_BYTES + 1);
    } catch {
        return {
            content: '',
            exists: false,
            reason: 'Git blob content is unavailable.'
        };
    }
    if (bytes.length > MAX_CONTENT_BYTES) {
        return omittedReadResult('File is too large to display (over 2 MiB).');
    }
    return decodeText(bytes);
}

function readIndexFile(repoRoot: string, relativePath: string): WorkspaceHistoryReadResult {
    if (relativePath === '') {
        return emptyReadResult();
    }
    const record = listIndexRecordsForPath(repoRoot, relativePath)
        .find((candidate) => candidate.path === relativePath && candidate.type === 'blob' && candidate.mode.endsWith(':0'));
    if (!record || !record.oid || /^0+$/.test(record.oid)) {
        return emptyReadResult();
    }
    return readBlob(repoRoot, record.oid);
}

function listIndexRecordsForPath(repoRoot: string, relativePath: string): TreeRecord[] {
    const output = runGitBuffer([
        'ls-files',
        '--stage',
        '-z',
        '--',
        ...pathspecsForPath(relativePath)
    ], repoRoot, MAX_GIT_LIST_BYTES);
    return output.toString('utf8').split('\0').filter(Boolean).map((record) => {
        const separator = record.indexOf('\t');
        if (separator < 0) {
            return { mode: '', type: '', oid: '', path: record };
        }
        const [mode = '', oid = '', stage = ''] = record.slice(0, separator).split(' ');
        return {
            mode: `${mode}:${stage}`,
            type: mode === '160000' ? 'commit' : 'blob',
            oid,
            path: record.slice(separator + 1)
        };
    });
}

function readWorkingTreeFile(repoRoot: string, relativePath: string): WorkspaceHistoryReadResult {
    if (relativePath === '') {
        return emptyReadResult();
    }
    const safePath = resolveSafeWorkingTreePath(repoRoot, relativePath);
    let stat: fs.Stats;
    try {
        stat = fs.statSync(safePath.resolvedPath);
    } catch {
        return emptyReadResult();
    }
    if (!stat.isFile()) {
        return emptyReadResult();
    }

    const read = readBoundedFile(safePath.resolvedPath);
    if (read.kind === 'missing') {
        return emptyReadResult();
    }
    if (read.kind === 'too-large') {
        return omittedReadResult('File is too large to display (over 2 MiB).');
    }
    return decodeText(read.bytes ?? Buffer.alloc(0));
}

function resolveSafeWorkingTreePath(repoRoot: string, relativePath: string): SafeWorkingTreePath {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    let existingPath = absolutePath;
    const missingSegments: string[] = [];
    while (true) {
        try {
            fs.lstatSync(existingPath);
            break;
        } catch {
            const parentPath = path.dirname(existingPath);
            if (parentPath === existingPath) {
                throw new Error(`Working-tree path could not be validated: ${relativePath}`);
            }
            missingSegments.unshift(path.basename(existingPath));
            existingPath = parentPath;
        }
    }

    let resolvedExisting: string;
    try {
        resolvedExisting = fs.realpathSync(existingPath);
    } catch {
        throw new Error(`Working-tree path could not be validated: ${relativePath}`);
    }
    assertInsideRepository(repoRoot, resolvedExisting, relativePath);
    assertNoNestedRepository(repoRoot, resolvedExisting, relativePath);

    const resolvedPath = path.join(resolvedExisting, ...missingSegments);
    if (missingSegments.length === 0) {
        assertInsideRepository(repoRoot, resolvedPath, relativePath);
        assertNoNestedRepository(repoRoot, resolvedPath, relativePath);
    }
    return { absolutePath, resolvedPath };
}

function assertInsideRepository(repoRoot: string, candidate: string, relativePath: string): void {
    const relative = path.relative(repoRoot, candidate);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`Working-tree path escapes the repository root: ${relativePath}`);
    }
}

function assertNoNestedRepository(repoRoot: string, candidate: string, relativePath: string): void {
    const relative = path.relative(repoRoot, candidate);
    if (relative === '') {
        return;
    }
    let current = repoRoot;
    for (const segment of relative.split(path.sep)) {
        current = path.join(current, segment);
        if (current === repoRoot) {
            continue;
        }
        try {
            if (fs.existsSync(path.join(current, '.git'))) {
                throw new Error(`Working-tree path crosses a nested repository boundary: ${relativePath}`);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('nested repository boundary')) {
                throw error;
            }
        }
    }
}

function readBoundedFile(filePath: string): BoundedFileRead {
    let descriptor: number;
    try {
        descriptor = fs.openSync(filePath, 'r');
    } catch {
        return { kind: 'missing' };
    }
    try {
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile()) {
            return { kind: 'missing' };
        }
        if (stat.size > MAX_CONTENT_BYTES) {
            return { kind: 'too-large' };
        }
        const bytes = Buffer.alloc(MAX_CONTENT_BYTES + 1);
        let total = 0;
        while (total < bytes.length) {
            const count = fs.readSync(descriptor, bytes, total, bytes.length - total, null);
            if (count === 0) {
                break;
            }
            total += count;
        }
        if (total > MAX_CONTENT_BYTES) {
            return { kind: 'too-large' };
        }
        return { kind: 'content', bytes: bytes.subarray(0, total) };
    } catch {
        return { kind: 'missing' };
    } finally {
        try {
            fs.closeSync(descriptor);
        } catch {
            // The read result is already determined; closing is best effort.
        }
    }
}

function decodeText(bytes: Buffer): WorkspaceHistoryReadResult {
    if (bytes.includes(0)) {
        return omittedReadResult('Binary file content is omitted.');
    }
    try {
        return {
            content: UTF8_DECODER.decode(bytes),
            exists: true
        };
    } catch {
        return omittedReadResult('Binary file content is omitted.');
    }
}

function emptyReadResult(): WorkspaceHistoryReadResult {
    return { content: '', exists: false };
}

function omittedReadResult(reason: string): WorkspaceHistoryReadResult {
    return { content: '', exists: true, reason };
}

function sameReadResult(
    left: WorkspaceHistoryReadResult,
    right: WorkspaceHistoryReadResult
): boolean {
    return left.exists === right.exists
        && left.content === right.content
        && left.reason === right.reason;
}

function runGitBuffer(args: readonly string[], cwd: string, maxBuffer: number): Buffer {
    return execFileSync('git', [...args], {
        cwd,
        maxBuffer,
        stdio: ['ignore', 'pipe', 'pipe']
    }) as Buffer;
}

function runGitText(args: readonly string[], cwd: string, maxBuffer: number): string {
    return runGitBuffer(args, cwd, maxBuffer).toString('utf8');
}

export default createWorkspaceHistory;
