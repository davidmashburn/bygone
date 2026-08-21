import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export type GitSnapshot =
    | { kind: 'commit'; oid: string; label: string }
    | { kind: 'index'; label: string }
    | { kind: 'worktree'; label: string };

export type GitChangeKind =
    | 'added'
    | 'copied'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'type-changed'
    | 'unmerged'
    | 'unknown';

export interface GitChangedPath {
    kind: GitChangeKind;
    path: string;
    previousPath?: string;
    similarity?: number;
}

export interface BranchCommit {
    oid: string;
    shortOid: string;
    timestamp: string;
    summary: string;
    parentOids: string[];
}

export interface BranchReviewRange {
    repoRoot: string;
    baseRef: string;
    headRef: string;
    baseOid: string;
    headOid: string;
    mergeBaseOid: string;
    currentBranch?: string;
    dirty: boolean;
    changedPaths: GitChangedPath[];
    commits: BranchCommit[];
}

export interface ReviewPathPair {
    key: string;
    leftPath: string | null;
    rightPath: string | null;
    kind: GitChangeKind;
    similarity?: number;
    summary?: string;
}

export type RunGit = (args: readonly string[], cwd: string) => string;

export function createGitRunner(maxBuffer = readGitMaxBuffer()): RunGit {
    return (args, cwd) => execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd();
}

export function resolveBranchReviewRange(
    startPath: string,
    headRef = 'HEAD',
    requestedBaseRef?: string,
    runGit: RunGit = createGitRunner()
): BranchReviewRange {
    const repoRoot = fs.realpathSync(runGit(['rev-parse', '--show-toplevel'], startPath));
    const currentBranch = tryRunGit(runGit, ['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot);
    const baseRef = requestedBaseRef || detectDefaultBaseRef(repoRoot, headRef, runGit);
    const headOid = verifyCommit(repoRoot, headRef, runGit);
    const baseOid = verifyCommit(repoRoot, baseRef, runGit);
    const mergeBaseOids = runGit(['merge-base', '--all', baseOid, headOid], repoRoot)
        .split('\n')
        .filter(Boolean);
    if (mergeBaseOids.length === 0) {
        throw new Error(`No merge base exists between ${baseRef} and ${headRef}.`);
    }
    if (mergeBaseOids.length > 1) {
        throw new Error(
            `Multiple merge bases exist between ${baseRef} and ${headRef}: `
            + `${mergeBaseOids.map((oid) => oid.slice(0, 7)).join(', ')}. `
            + 'Pass one merge-base commit explicitly with --base.'
        );
    }
    const mergeBaseOid = mergeBaseOids[0];

    return {
        repoRoot,
        baseRef,
        headRef,
        baseOid,
        headOid,
        mergeBaseOid,
        currentBranch: currentBranch || undefined,
        dirty: runGit(['status', '--porcelain=v1', '--untracked-files=normal'], repoRoot).length > 0,
        changedPaths: listChangedPaths(repoRoot, mergeBaseOid, headOid, runGit),
        commits: listBranchCommits(repoRoot, mergeBaseOid, headOid, runGit)
    };
}

export function detectDefaultBaseRef(
    repoRoot: string,
    headRef = 'HEAD',
    runGit: RunGit = createGitRunner()
): string {
    const remoteDefault = tryRunGit(
        runGit,
        ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
        repoRoot
    );
    const candidates = [remoteDefault, 'main', 'master']
        .filter((candidate): candidate is string => Boolean(candidate))
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

    for (const candidate of candidates) {
        if (candidate !== headRef && canResolveCommit(repoRoot, candidate, runGit)) {
            return candidate;
        }
    }

    throw new Error('Could not detect a base branch. Pass --base <ref>.');
}

export function listChangedPaths(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    runGit: RunGit = createGitRunner()
): GitChangedPath[] {
    const output = runGit([
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        '--find-copies',
        baseOid,
        headOid,
        '--'
    ], repoRoot);
    return parseNameStatusZ(output);
}

export function parseNameStatusZ(output: string): GitChangedPath[] {
    const fields = output.split('\0');
    if (fields[fields.length - 1] === '') {
        fields.pop();
    }

    const changedPaths: GitChangedPath[] = [];
    for (let index = 0; index < fields.length;) {
        const status = fields[index++];
        if (!status) {
            continue;
        }

        const code = status[0];
        const similarityText = status.slice(1);
        const similarity = similarityText ? Number.parseInt(similarityText, 10) : undefined;

        if (code === 'R' || code === 'C') {
            const previousPath = fields[index++];
            const nextPath = fields[index++];
            if (previousPath && nextPath) {
                changedPaths.push({
                    kind: code === 'R' ? 'renamed' : 'copied',
                    path: nextPath,
                    previousPath,
                    similarity: Number.isFinite(similarity) ? similarity : undefined
                });
            }
            continue;
        }

        const changedPath = fields[index++];
        if (!changedPath) {
            continue;
        }
        changedPaths.push({
            kind: changeKindForStatus(code),
            path: changedPath
        });
    }

    return changedPaths;
}

export function listBranchCommits(
    repoRoot: string,
    mergeBaseOid: string,
    headOid: string,
    runGit: RunGit = createGitRunner()
): BranchCommit[] {
    const output = runGit([
        'log',
        '--reverse',
        '--topo-order',
        '--format=%H%x00%h%x00%cI%x00%s%x00%P%x1e',
        `${mergeBaseOid}..${headOid}`
    ], repoRoot);

    return output
        .split('\x1e')
        .map((record) => record.replace(/^\n+|\n+$/g, ''))
        .filter(Boolean)
        .map((record) => {
            const [oid = '', shortOid = '', timestamp = '', summary = '', parents = ''] = record.split('\0');
            return {
                oid,
                shortOid,
                timestamp,
                summary,
                parentOids: parents.split(' ').filter(Boolean)
            };
        })
        .filter((commit) => Boolean(commit.oid));
}

export function materializeBranchReviewTrees(
    review: BranchReviewRange,
    leftRoot: string,
    rightRoot: string
): void {
    for (const changedPath of review.changedPaths) {
        if (changedPath.kind === 'renamed') {
            materializeGitPath(review.repoRoot, review.mergeBaseOid, changedPath.previousPath, leftRoot);
            materializeGitPath(review.repoRoot, review.headOid, changedPath.path, rightRoot);
            continue;
        }

        if (changedPath.kind !== 'added' && changedPath.kind !== 'copied') {
            materializeGitPath(review.repoRoot, review.mergeBaseOid, changedPath.path, leftRoot);
        }
        if (changedPath.kind !== 'deleted') {
            materializeGitPath(review.repoRoot, review.headOid, changedPath.path, rightRoot);
        }
    }
}

export function materializeGitTree(
    repoRoot: string,
    relativeDir: string,
    targetRoot: string,
    commit = 'HEAD'
): void {
    for (const relativeFile of listGitBlobPaths(repoRoot, commit, relativeDir)) {
        writeMaterializedGitFile(
            targetRoot,
            relativeFile,
            readGitBlob(repoRoot, commit, relativeFile)
        );
    }
}

export function resolveReviewPathPair(
    changedPaths: readonly GitChangedPath[],
    selectedPath: string
): ReviewPathPair | undefined {
    const changedPath = changedPaths.find((candidate) => (
        candidate.path === selectedPath || candidate.previousPath === selectedPath
    ));
    if (!changedPath) {
        return undefined;
    }

    const relatesDistinctPaths = (changedPath.kind === 'renamed' || changedPath.kind === 'copied')
        && Boolean(changedPath.previousPath);
    const leftPath = changedPath.kind === 'added'
        ? null
        : relatesDistinctPaths
            ? changedPath.previousPath ?? null
            : changedPath.path;
    const rightPath = changedPath.kind === 'deleted' ? null : changedPath.path;
    const relationVerb = changedPath.kind === 'renamed'
        ? 'Renamed'
        : changedPath.kind === 'copied'
            ? 'Copied'
            : null;

    return {
        key: changedPath.path,
        leftPath,
        rightPath,
        kind: changedPath.kind,
        similarity: changedPath.similarity,
        summary: relationVerb && changedPath.previousPath
            ? `${relationVerb} ${changedPath.previousPath} → ${changedPath.path}`
                + (changedPath.similarity === undefined ? '' : ` · ${changedPath.similarity}% similarity`)
            : undefined
    };
}

function verifyCommit(repoRoot: string, ref: string, runGit: RunGit): string {
    try {
        return runGit(['rev-parse', '--verify', `${ref}^{commit}`], repoRoot);
    } catch {
        throw new Error(`Could not resolve git ref "${ref}".`);
    }
}

function canResolveCommit(repoRoot: string, ref: string, runGit: RunGit): boolean {
    try {
        verifyCommit(repoRoot, ref, runGit);
        return true;
    } catch {
        return false;
    }
}

function tryRunGit(runGit: RunGit, args: readonly string[], cwd: string): string {
    try {
        return runGit(args, cwd);
    } catch {
        return '';
    }
}

const GITLINK_MODE = '160000';

function materializeGitPath(repoRoot: string, commit: string, relativePath: string | undefined, targetRoot: string): void {
    if (!relativePath || !isGitBlobPath(repoRoot, commit, relativePath)) {
        return;
    }

    writeMaterializedGitFile(targetRoot, relativePath, readGitBlob(repoRoot, commit, relativePath));
}

function writeMaterializedGitFile(targetRoot: string, relativePath: string, content: Buffer): void {
    const resolvedRoot = path.resolve(targetRoot);
    const targetFile = path.resolve(resolvedRoot, relativePath);
    if (targetFile !== resolvedRoot && !targetFile.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Refusing to materialize path outside review root: ${relativePath}`);
    }

    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, content);
}

function listGitBlobPaths(repoRoot: string, commit: string, relativeDir: string): string[] {
    if (commit === 'INDEX') {
        const args = ['ls-files', '--stage', '-z', '--'];
        if (relativeDir) {
            args.push(relativeDir);
        }

        return parseNulRecords(runGitText(repoRoot, args)).flatMap((record) => {
            const parsed = parseIndexStageRecord(record);
            return parsed && parsed.mode !== GITLINK_MODE ? [parsed.path] : [];
        });
    }

    const args = ['ls-tree', '-r', '-z', commit];
    if (relativeDir) {
        args.push('--', relativeDir);
    }

    return parseNulRecords(runGitText(repoRoot, args)).flatMap((record) => {
        const parsed = parseLsTreeRecord(record);
        return parsed && parsed.type === 'blob' ? [parsed.path] : [];
    });
}

function isGitBlobPath(repoRoot: string, commit: string, relativePath: string): boolean {
    if (commit === 'INDEX') {
        return listGitBlobPaths(repoRoot, commit, relativePath).includes(relativePath);
    }

    const parsed = parseLsTreeRecord(parseNulRecords(runGitText(repoRoot, ['ls-tree', '-z', commit, '--', relativePath]))[0] ?? '');
    return parsed?.type === 'blob';
}

function parseNulRecords(output: string): string[] {
    return output.split('\0').filter((record) => record.length > 0);
}

function parseLsTreeRecord(record: string): { type: string; path: string } | undefined {
    const tab = record.indexOf('\t');
    if (tab === -1) {
        return undefined;
    }

    const type = record.slice(0, tab).split(' ')[1];
    const relativePath = record.slice(tab + 1);
    if (!type || !relativePath) {
        return undefined;
    }

    return { type, path: relativePath };
}

function parseIndexStageRecord(record: string): { mode: string; path: string } | undefined {
    const tab = record.indexOf('\t');
    if (tab === -1) {
        return undefined;
    }

    const mode = record.slice(0, tab).split(' ')[0];
    const relativePath = record.slice(tab + 1);
    if (!mode || !relativePath) {
        return undefined;
    }

    return { mode, path: relativePath };
}

function readGitBlob(repoRoot: string, commit: string, relativePath: string): Buffer {
    const spec = commit && commit !== 'INDEX' ? `${commit}:${relativePath}` : `:${relativePath}`;
    return execFileSync('git', ['show', spec], {
        cwd: repoRoot,
        encoding: 'buffer',
        maxBuffer: readGitMaxBuffer(),
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function runGitText(repoRoot: string, args: readonly string[]): string {
    return execFileSync('git', [...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: readGitMaxBuffer(),
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function changeKindForStatus(code: string): GitChangeKind {
    if (code === 'A') {
        return 'added';
    }
    if (code === 'D') {
        return 'deleted';
    }
    if (code === 'M') {
        return 'modified';
    }
    if (code === 'T') {
        return 'type-changed';
    }
    if (code === 'U') {
        return 'unmerged';
    }
    return 'unknown';
}

function readGitMaxBuffer(): number {
    const parsed = Number.parseInt(process.env.BYGONE_GIT_MAX_BUFFER_BYTES ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GIT_MAX_BUFFER_BYTES;
}
