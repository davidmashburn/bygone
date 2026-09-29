import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The source shapes are intentionally structural.  The standalone host owns
 * the source constructors, while this module also has to be safe when it is
 * handed persisted or otherwise untrusted session data.
 */
export type WorkspaceGitSource =
    | { kind: 'files'; paths?: unknown; resolvedRevisions?: unknown }
    | { kind: 'directories'; paths?: unknown; resolvedRevisions?: unknown }
    | { kind: 'file-history'; path?: unknown; resolvedRevisions?: unknown }
    | { kind: 'directory-history'; path?: unknown; resolvedRevisions?: unknown }
    | { kind: 'git-refs'; repoRoot?: unknown; refs?: unknown; resolvedRevisions?: unknown }
    | { kind: 'branch-review'; repoRoot?: unknown; headRef?: unknown; baseRef?: unknown; resolvedRevisions?: unknown };

export interface WorkspaceGitOptions {
    pinnedRevisions?: readonly string[];
    activeIndex?: number;
}

export interface WorkspaceGitPath {
    path: string;
    type: 'file' | 'directory';
}

export interface WorkspaceGitReady {
    kind: 'ready';
    repoRoot: string;
    commonDir: string;
    worktreeRoot: string;
    paths: WorkspaceGitPath[];
    revisions: string[];
    headOid: string;
    activeRevision: string;
    historyLabel: string;
    notice?: string;
}

export interface WorkspaceGitUnavailable {
    kind: 'unavailable';
    reason: string;
}

export type WorkspaceGitResult = WorkspaceGitReady | WorkspaceGitUnavailable;

export type WorkspaceRangeStatus =
    | 'exact'
    | 'none'
    | 'multiple'
    | 'uncommitted'
    | 'reversed'
    | 'divergent'
    | 'unavailable';

export interface WorkspaceRangeExact {
    status: 'exact';
    repoRoot: string;
    revisions: [string, string];
    fromOid: string;
    toOid: string;
    baseOid: string;
    headOid: string;
}

export interface WorkspaceRangeUnavailable {
    status: Exclude<WorkspaceRangeStatus, 'exact'>;
    reason?: string;
}

export type WorkspaceRange = WorkspaceRangeExact | WorkspaceRangeUnavailable;

const DEFAULT_GIT_MAX_BUFFER_BYTES = 256 * 1024;
const MAX_GIT_ARGUMENT_LENGTH = 16 * 1024;
const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

type RepositoryInfo = {
    repoRoot: string;
    commonDir: string;
    worktreeRoot: string;
    headOid: string;
};

type LocalOperand = {
    absolutePath: string;
    type: 'file' | 'directory';
};

/**
 * Return whether candidate is within root, including root itself.
 *
 * Callers that need filesystem identity should realpath both inputs before
 * calling this helper.  Keeping the helper lexical makes it useful for the
 * already-canonical paths carried by a ready descriptor without introducing
 * another filesystem read.
 */
export function scopeContainsPath(root: string, candidate: string): boolean {
    if (typeof root !== 'string' || typeof candidate !== 'string' || root.length === 0 || candidate.length === 0) {
        return false;
    }

    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Resolve the Git provenance of a refreshable standalone session source.
 *
 * The result is deliberately a discriminated union: a caller must decide
 * what to do when a source is outside Git, spans repository/worktree
 * boundaries, or has no committed HEAD.  In particular, this function never
 * replaces a live path with a different worktree and never turns an
 * untracked file into a broader directory request.
 */
export function resolveWorkspaceGit(
    source: WorkspaceGitSource | null | undefined,
    options: WorkspaceGitOptions = {}
): WorkspaceGitResult {
    if (!source || typeof source !== 'object' || typeof source.kind !== 'string') {
        return unavailable('The source has no Git provenance (it is blank, synthetic, or otherwise unresolved).');
    }

    try {
        switch (source.kind) {
            case 'files':
                return resolveLocalSource(source, 'files', options);
            case 'directories':
                return resolveLocalSource(source, 'directories', options);
            case 'file-history':
                return resolveHistorySource(source, 'file-history', options);
            case 'directory-history':
                return resolveHistorySource(source, 'directory-history', options);
            case 'git-refs':
                return resolveGitRefsSource(source, options);
            case 'branch-review':
                return resolveBranchReviewSource(source, options);
            default: {
                const unknownSource = source as { kind: string };
                return unavailable(`Source kind "${unknownSource.kind}" has no Git provenance.`);
            }
        }
    } catch (error) {
        return unavailable(errorMessage(error));
    }
}

/**
 * Prove an exact two-commit ancestor/descendant range.
 *
 * This function intentionally does not compute a merge base.  A divergent
 * pair (or a pair with multiple merge bases) remains a deliberate choice for
 * the caller instead of being silently rewritten into a different range.
 */
export function resolveWorkspaceRange(
    repoRoot: string,
    revisions: readonly string[]
): WorkspaceRange {
    if (!Array.isArray(revisions)) {
        return { status: 'unavailable', reason: 'Revision selection is not an array.' };
    }
    if (revisions.length < 2) {
        return { status: 'none', reason: 'An exact range requires two committed revisions.' };
    }
    if (revisions.length > 2) {
        return { status: 'multiple', reason: 'An exact range accepts exactly two revisions.' };
    }

    const first = revisions[0];
    const second = revisions[1];
    if (typeof first !== 'string' || typeof second !== 'string') {
        return { status: 'unavailable', reason: 'Revision selection contains a non-string value.' };
    }

    const firstState = normalizeState(first);
    const secondState = normalizeState(second);
    if (firstState || secondState) {
        return {
            status: 'uncommitted',
            reason: 'INDEX and WORKTREE are live repository states, not committed revisions.'
        };
    }

    let repository: RepositoryInfo;
    try {
        const inspected = inspectRepositoryRoot(repoRoot);
        if (isUnavailable(inspected)) {
            return { status: 'unavailable', reason: inspected.reason };
        }
        repository = inspected;
    } catch (error) {
        return { status: 'unavailable', reason: errorMessage(error) };
    }

    let firstOid: string;
    let secondOid: string;
    try {
        firstOid = resolveCommitRevision(repository.repoRoot, first);
        secondOid = resolveCommitRevision(repository.repoRoot, second);
    } catch (error) {
        return { status: 'unavailable', reason: errorMessage(error) };
    }

    if (firstOid === secondOid) {
        return { status: 'none', reason: 'The selected revisions resolve to the same commit.' };
    }

    if (canRunGit(['merge-base', '--is-ancestor', firstOid, secondOid], repository.repoRoot)) {
        return {
            status: 'exact',
            repoRoot: repository.repoRoot,
            revisions: [firstOid, secondOid],
            fromOid: firstOid,
            toOid: secondOid,
            baseOid: firstOid,
            headOid: secondOid
        };
    }

    if (canRunGit(['merge-base', '--is-ancestor', secondOid, firstOid], repository.repoRoot)) {
        return {
            status: 'reversed',
            reason: `The requested revisions are reversed: ${secondOid} is an ancestor of ${firstOid}.`
        };
    }

    try {
        const mergeBases = runGit(['merge-base', '--all', firstOid, secondOid], repository.repoRoot)
            .split('\n')
            .map((oid) => oid.trim())
            .filter(Boolean);
        if (mergeBases.length > 1) {
            return {
                status: 'multiple',
                reason: `The revisions have multiple merge bases (${mergeBases.join(', ')}); no exact range was selected.`
            };
        }
    } catch {
        // A pair with no merge base is still divergent.  The more useful
        // outcome is returned below instead of leaking a Git implementation
        // error into the prompt.
    }

    return {
        status: 'divergent',
        reason: `The revisions are not an ancestor/descendant pair; no merge base was substituted.`
    };
}

function resolveLocalSource(
    source: Extract<WorkspaceGitSource, { kind: 'files' | 'directories' }>,
    kind: 'files' | 'directories',
    options: WorkspaceGitOptions
): WorkspaceGitResult {
    const operands = readLocalOperands(source, kind);
    if (operands.length === 0) {
        return unavailable(`The ${kind} source has no paths.`);
    }

    const inspected = operands.map((operand) => inspectOperand(operand));
    const repository = ensureSingleRepository(inspected);
    if (isUnavailable(repository)) {
        return repository;
    }

    if (kind === 'files') {
        for (const operand of operands) {
            if (operand.type !== 'file') {
                return unavailable(`The files source requires files; ${operand.absolutePath} is not a file.`);
            }
            if (!isTrackedFile(repository.repoRoot, operand.absolutePath)) {
                return unavailable(
                    `Untracked file ${operand.absolutePath} has no committed Git provenance. `
                    + `Select its containing directory (${path.dirname(operand.absolutePath)}) instead; `
                    + 'it will not be selected automatically.'
                );
            }
        }
    } else {
        for (const operand of operands) {
            if (operand.type !== 'directory') {
                return unavailable(`The directories source requires directories; ${operand.absolutePath} is not a directory.`);
            }
        }
    }

    const revisions = chooseRevisions(source, options, ['WORKTREE'], repository.repoRoot);
    return buildReadyDescriptor(repository, operands, revisions, options, kind);
}

function resolveHistorySource(
    source: Extract<WorkspaceGitSource, { kind: 'file-history' | 'directory-history' }>,
    kind: 'file-history' | 'directory-history',
    options: WorkspaceGitOptions
): WorkspaceGitResult {
    const value = source.path;
    if (typeof value !== 'string' || value.trim().length === 0) {
        return unavailable(`The ${kind} source has no path.`);
    }

    const operand: LocalOperand = { absolutePath: canonicalPath(value), type: 'file' };
    let stat: fs.Stats;
    try {
        stat = fs.statSync(operand.absolutePath);
    } catch {
        return unavailable(`Git history path ${operand.absolutePath} does not exist or cannot be read.`);
    }
    operand.type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'file';

    if (kind === 'file-history' && operand.type !== 'file') {
        return unavailable(`File history requires a file; ${operand.absolutePath} is not a file.`);
    }
    if (kind === 'directory-history' && operand.type !== 'directory') {
        return unavailable(`Directory history requires a directory; ${operand.absolutePath} is not a directory.`);
    }

    const repository = inspectOperand(operand);
    if (isUnavailable(repository)) {
        return repository;
    }

    if (kind === 'file-history' && !isTrackedFile(repository.repoRoot, operand.absolutePath)) {
        return unavailable(
            `Untracked file ${operand.absolutePath} has no committed Git history. `
            + `Select its containing directory (${path.dirname(operand.absolutePath)}) instead; `
            + 'it will not be selected automatically.'
        );
    }

    const revisions = chooseRevisions(source, options, ['WORKTREE'], repository.repoRoot);
    return buildReadyDescriptor(repository, [operand], revisions, options, kind);
}

function resolveGitRefsSource(
    source: Extract<WorkspaceGitSource, { kind: 'git-refs' }>,
    options: WorkspaceGitOptions
): WorkspaceGitResult {
    const repository = inspectExplicitRepository(source.repoRoot);
    if (isUnavailable(repository)) {
        return repository;
    }

    const refs = readStringList(source.refs, 'git refs');
    if (isUnavailable(refs)) {
        return refs;
    }
    if (refs.length === 0) {
        return unavailable('The git-refs source has no refs.');
    }

    const pinned = choosePinnedRevisions(source, options);
    const revisions = pinned
        ? resolvePinnedRevisions(repository.repoRoot, pinned)
        : resolveRevisionRefs(repository.repoRoot, refs);
    if (isUnavailable(revisions)) {
        return revisions;
    }

    return buildReadyDescriptor(repository, [], revisions, options, 'git-refs');
}

function resolveBranchReviewSource(
    source: Extract<WorkspaceGitSource, { kind: 'branch-review' }>,
    options: WorkspaceGitOptions
): WorkspaceGitResult {
    const repository = inspectExplicitRepository(source.repoRoot);
    if (isUnavailable(repository)) {
        return repository;
    }

    if (typeof source.headRef !== 'string' || source.headRef.trim().length === 0) {
        return unavailable('The branch-review source has no head ref.');
    }

    const pinned = choosePinnedRevisions(source, options);
    let revisions: string[] | WorkspaceGitUnavailable;
    if (pinned) {
        revisions = resolvePinnedRevisions(repository.repoRoot, pinned);
    } else {
        const baseRef = typeof source.baseRef === 'string' && source.baseRef.trim().length > 0
            ? source.baseRef
            : detectDefaultBaseRef(repository.repoRoot, source.headRef);
        const baseOid = resolveCommitRevision(repository.repoRoot, baseRef);
        const headOid = resolveCommitRevision(repository.repoRoot, source.headRef);
        revisions = [baseOid, headOid];
    }
    if (isUnavailable(revisions)) {
        return revisions;
    }

    return buildReadyDescriptor(repository, [], revisions, options, 'branch-review');
}

function buildReadyDescriptor(
    repository: RepositoryInfo,
    operands: readonly LocalOperand[],
    revisions: string[] | WorkspaceGitUnavailable,
    options: WorkspaceGitOptions,
    sourceKind: WorkspaceGitSource['kind']
): WorkspaceGitResult {
    if (isUnavailable(revisions)) {
        return revisions;
    }
    if (revisions.length === 0) {
        return unavailable('No Git revisions were selected.');
    }

    const activeIndex = resolveActiveIndex(revisions, options.activeIndex);
    if (isUnavailable(activeIndex)) {
        return activeIndex;
    }

    const activeRevision = revisions[activeIndex.index];
    const hasLiveState = revisions.some((revision) => Boolean(normalizeState(revision)));
    const headOid = hasLiveState
        ? repository.headOid
        : activeRevision;
    if (!FULL_OID_PATTERN.test(headOid)) {
        return unavailable(`Active revision ${activeRevision} is not a full commit OID.`);
    }

    const paths = operands.map((operand) => ({
        path: relativeRepositoryPath(repository.worktreeRoot, operand.absolutePath),
        type: operand.type
    }));
    const historyLabel = historyLabelFor(sourceKind, activeRevision);
    return {
        kind: 'ready',
        repoRoot: repository.repoRoot,
        commonDir: repository.commonDir,
        worktreeRoot: repository.worktreeRoot,
        paths,
        revisions: [...revisions],
        headOid,
        activeRevision,
        historyLabel
    };
}

function readLocalOperands(
    source: Extract<WorkspaceGitSource, { kind: 'files' | 'directories' }>,
    kind: 'files' | 'directories'
): LocalOperand[] {
    if (!Array.isArray(source.paths)) {
        throw new Error(`The ${kind} source paths value is not an array.`);
    }

    return source.paths.map((value, index) => {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`The ${kind} source path at index ${index} is not a non-empty string.`);
        }
        return {
            absolutePath: canonicalPath(value),
            type: kind === 'files' ? 'file' : 'directory'
        };
    });
}

function inspectOperand(operand: LocalOperand): RepositoryInfo | WorkspaceGitUnavailable & { kind: 'unavailable' };
function inspectOperand(operand: LocalOperand): RepositoryInfo | WorkspaceGitUnavailable {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(operand.absolutePath);
    } catch {
        return unavailable(`Path ${operand.absolutePath} does not exist or cannot be read.`);
    }

    if (!stat.isFile() && !stat.isDirectory()) {
        return unavailable(`Path ${operand.absolutePath} is neither a file nor a directory.`);
    }

    try {
        const repository = inspectRepositoryFromPath(operand.absolutePath);
        const type = stat.isDirectory() ? 'directory' : 'file';
        operand.type = type;
        if (!scopeContainsPath(repository.worktreeRoot, operand.absolutePath)) {
            return unavailable(
                `Path ${operand.absolutePath} is outside the Git worktree ${repository.worktreeRoot}.`
            );
        }
        return repository;
    } catch (error) {
        return unavailable(
            `Path ${operand.absolutePath} has no Git provenance (it is outside a Git worktree or is a temporary/non-Git path): `
            + errorMessage(error)
        );
    }
}

function ensureSingleRepository(
    inspected: ReadonlyArray<RepositoryInfo | WorkspaceGitUnavailable>
): RepositoryInfo | WorkspaceGitUnavailable {
    const first = inspected[0];
    if (!first || isUnavailable(first)) {
        return first || unavailable('No Git repository owns the selected paths.');
    }

    for (const candidate of inspected.slice(1)) {
        if (isUnavailable(candidate)) {
            return candidate;
        }
        if (candidate.commonDir !== first.commonDir) {
            return unavailable(
                'The selected paths belong to different Git repositories (their canonical Git common directories differ), '
                + 'even if the repositories have the same remote. Keep the request within one clone or submodule.'
            );
        }
        if (candidate.worktreeRoot !== first.worktreeRoot) {
            return unavailable(
                'The selected paths come from multiple originating Git worktrees. '
                + 'Live working-tree states cannot be combined; select paths from one worktree instead.'
            );
        }
    }

    return first;
}

function inspectExplicitRepository(value: unknown): RepositoryInfo | WorkspaceGitUnavailable {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return unavailable('The Git repository root is missing.');
    }

    let root: string;
    try {
        root = canonicalPath(value);
        if (!fs.statSync(root).isDirectory()) {
            return unavailable(`Git repository root ${root} is not a directory.`);
        }
    } catch {
        return unavailable(`Git repository root ${value} does not exist or cannot be read.`);
    }

    try {
        const repository = inspectRepositoryFromPath(root);
        if (repository.worktreeRoot !== root) {
            return unavailable(
                `Git repository root ${root} is not the canonical worktree root ${repository.worktreeRoot}.`
            );
        }
        return repository;
    } catch (error) {
        return unavailable(`Repository ${root} has no usable Git worktree: ${errorMessage(error)}`);
    }
}

function inspectRepositoryFromPath(startPath: string): RepositoryInfo {
    const cwd = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const worktreeOutput = runGit(['rev-parse', '--show-toplevel'], cwd);
    const worktreeRoot = canonicalPath(worktreeOutput);
    const commonOutput = runGit(['rev-parse', '--git-common-dir'], worktreeRoot);
    const commonCandidate = path.isAbsolute(commonOutput)
        ? commonOutput
        : path.resolve(worktreeRoot, commonOutput);
    const commonDir = canonicalPath(commonCandidate);
    let headOid: string;
    try {
        headOid = resolveCommitRevision(worktreeRoot, 'HEAD');
    } catch (error) {
        throw new Error(
            `Repository ${worktreeRoot} has an unborn HEAD (no commit yet): ${errorMessage(error)}`
        );
    }

    return {
        repoRoot: worktreeRoot,
        commonDir,
        worktreeRoot,
        headOid
    };
}

function inspectRepositoryRoot(value: unknown): RepositoryInfo | WorkspaceGitUnavailable {
    return inspectExplicitRepository(value);
}

function canonicalPath(value: string): string {
    if (value.length > MAX_GIT_ARGUMENT_LENGTH) {
        throw new Error('Path exceeds the bounded Git provenance input limit.');
    }
    return fs.realpathSync(path.resolve(value));
}

function relativeRepositoryPath(worktreeRoot: string, absolutePath: string): string {
    if (!scopeContainsPath(worktreeRoot, absolutePath)) {
        throw new Error(`Path ${absolutePath} is outside the Git worktree ${worktreeRoot}.`);
    }
    return path.relative(worktreeRoot, absolutePath).split(path.sep).join('/');
}

function isTrackedFile(repoRoot: string, filePath: string): boolean {
    const relative = relativeRepositoryPath(repoRoot, filePath);
    if (relative.length === 0) {
        return false;
    }
    return canRunGit(['ls-files', '--error-unmatch', '--', relative], repoRoot);
}

function choosePinnedRevisions(
    source: { resolvedRevisions?: unknown },
    options: WorkspaceGitOptions
): string[] | undefined {
    if (options.pinnedRevisions !== undefined) {
        return Array.isArray(options.pinnedRevisions)
            ? [...options.pinnedRevisions]
            : undefined;
    }
    if (Array.isArray(source.resolvedRevisions)) {
        return [...source.resolvedRevisions] as string[];
    }
    return undefined;
}

function chooseRevisions(
    source: { resolvedRevisions?: unknown },
    options: WorkspaceGitOptions,
    fallback: string[],
    repoRoot: string
): string[] | WorkspaceGitUnavailable {
    const pinned = choosePinnedRevisions(source, options);
    if (!pinned) {
        return [...fallback];
    }
    return pinned.length > 0
        ? resolvePinnedRevisions(repoRoot, pinned)
        : unavailable('Pinned Git revisions are empty.');
}

function resolvePinnedRevisions(
    repoRoot: string,
    pinned: readonly string[],
    allowUnresolvedCommits = false
): string[] | WorkspaceGitUnavailable {
    if (!Array.isArray(pinned) || pinned.length === 0) {
        return unavailable('Pinned Git revisions are empty.');
    }

    const revisions: string[] = [];
    for (const value of pinned) {
        if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_GIT_ARGUMENT_LENGTH) {
            return unavailable('Pinned Git revisions must be non-empty bounded strings.');
        }
        const state = normalizeState(value);
        if (state) {
            revisions.push(state);
            continue;
        }
        if (!FULL_OID_PATTERN.test(value)) {
            return unavailable(`Pinned revision ${value} is not a full commit OID.`);
        }
        if (allowUnresolvedCommits) {
            revisions.push(value.toLowerCase());
            continue;
        }
        try {
            revisions.push(resolveCommitRevision(repoRoot, value));
        } catch (error) {
            return unavailable(`Could not resolve pinned revision ${value}: ${errorMessage(error)}`);
        }
    }
    return revisions;
}

function resolveRevisionRefs(repoRoot: string, refs: readonly string[]): string[] | WorkspaceGitUnavailable {
    const revisions: string[] = [];
    for (const ref of refs) {
        if (typeof ref !== 'string' || ref.trim().length === 0 || ref.length > MAX_GIT_ARGUMENT_LENGTH) {
            return unavailable('Git refs must be non-empty bounded strings.');
        }
        const state = normalizeState(ref);
        if (state) {
            revisions.push(state);
            continue;
        }
        try {
            revisions.push(resolveCommitRevision(repoRoot, ref));
        } catch (error) {
            return unavailable(`Could not resolve Git ref ${ref}: ${errorMessage(error)}`);
        }
    }
    return revisions;
}

function resolveCommitRevision(repoRoot: string, revision: string): string {
    if (revision.length > MAX_GIT_ARGUMENT_LENGTH) {
        throw new Error('Git revision exceeds the bounded input limit.');
    }
    const output = runGit([
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${revision}^{commit}`
    ], repoRoot);
    if (!FULL_OID_PATTERN.test(output)) {
        throw new Error(`Git revision ${revision} did not resolve to a full commit OID.`);
    }
    return output.toLowerCase();
}

function detectDefaultBaseRef(repoRoot: string, headRef: string): string {
    const remoteDefault = tryRunGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], repoRoot);
    const candidates = [remoteDefault, 'main', 'master']
        .filter((candidate): candidate is string => Boolean(candidate))
        .filter((candidate, index, all) => all.indexOf(candidate) === index)
        .filter((candidate) => candidate !== headRef);

    for (const candidate of candidates) {
        if (canRunGit(['rev-parse', '--verify', '--end-of-options', `${candidate}^{commit}`], repoRoot)) {
            return candidate;
        }
    }
    throw new Error('Could not detect a branch-review base ref.');
}

function resolveActiveIndex(revisions: readonly string[], requested: number | undefined):
    { index: number } | WorkspaceGitUnavailable {
    if (requested !== undefined) {
        if (!Number.isInteger(requested) || requested < 0 || requested >= revisions.length) {
            return unavailable(`Active revision index ${String(requested)} is outside the selected revision list.`);
        }
        return { index: requested };
    }

    const worktreeIndex = revisions.lastIndexOf('WORKTREE');
    return { index: worktreeIndex >= 0 ? worktreeIndex : revisions.length - 1 };
}

function historyLabelFor(sourceKind: WorkspaceGitSource['kind'], activeRevision: string): string {
    if (activeRevision === 'WORKTREE') {
        return 'Working Tree';
    }
    if (activeRevision === 'INDEX') {
        return 'Index';
    }
    if (sourceKind === 'branch-review') {
        return `Branch Review @ ${activeRevision.slice(0, 12)}`;
    }
    return `Git Revision @ ${activeRevision.slice(0, 12)}`;
}

function normalizeState(value: string): 'INDEX' | 'WORKTREE' | undefined {
    const normalized = value.toUpperCase();
    if (normalized === 'INDEX') return 'INDEX';
    if (normalized === 'WORKTREE' || normalized === 'WORKDIR' || normalized === 'WORKINGTREE') return 'WORKTREE';
    return undefined;
}

function runGit(args: readonly string[], cwd: string): string {
    return execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer: DEFAULT_GIT_MAX_BUFFER_BYTES,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function tryRunGit(args: readonly string[], cwd: string): string | undefined {
    try {
        return runGit(args, cwd);
    } catch {
        return undefined;
    }
}

function canRunGit(args: readonly string[], cwd: string): boolean {
    try {
        runGit(args, cwd);
        return true;
    } catch {
        return false;
    }
}

function readStringList(value: unknown, label: string): string[] | WorkspaceGitUnavailable {
    if (!Array.isArray(value)) {
        return unavailable(`The ${label} value is not an array.`);
    }
    return value.map((item, index) => {
        if (typeof item !== 'string' || item.trim().length === 0) {
            throw new Error(`The ${label} item at index ${index} is not a non-empty string.`);
        }
        return item;
    });
}

function unavailable(reason: string): WorkspaceGitUnavailable {
    return { kind: 'unavailable', reason };
}

function isUnavailable(value: unknown): value is WorkspaceGitUnavailable {
    return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'unavailable');
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message.replace(/\s+/g, ' ').trim();
    }
    return String(error).replace(/\s+/g, ' ').trim();
}
