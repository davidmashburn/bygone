import { execFileSync } from 'child_process';
import type { BranchCommit, GitChangeKind } from './gitComparison';
import type { PullRequestSummary } from './pullRequest';
import { resolveBranchReviewRange, resolveReviewPathPair } from './gitComparison';

export const CHANGE_TOUR_CONTEXT_VERSION = 1 as const;
const DEFAULT_MAX_PATCH_BYTES = 128 * 1024;
const DEFAULT_MAX_TOTAL_PATCH_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const MAX_SYMBOL_SOURCE_BYTES = 1024 * 1024;

export type ChangeTourFileRole = 'production' | 'test' | 'documentation' | 'dependency' | 'generated';
export type ChangeTourPatchOmission = 'binary' | 'too-large' | 'total-budget' | 'unavailable';

export interface ChangeTourChangedRange {
    baseStart: number;
    baseCount: number;
    headStart: number;
    headCount: number;
}

export interface ChangeTourSymbolHint {
    name: string;
    kind: string;
    line: number;
}

export interface ChangeTourContextFile {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    role: ChangeTourFileRole;
    additions: number | null;
    deletions: number | null;
    binary: boolean;
    patch?: string;
    patchBytes: number;
    patchOmittedReason?: ChangeTourPatchOmission;
    changedRanges: ChangeTourChangedRange[];
    symbolHints: ChangeTourSymbolHint[];
}

export interface ChangeTourContext {
    version: typeof CHANGE_TOUR_CONTEXT_VERSION;
    generatedAt: string;
    range: {
        baseRef: string;
        headRef: string;
        mergeBaseOid: string;
        headOid: string;
        dirtyWorkingTreeExcluded: boolean;
    };
    limits: {
        maxPatchBytes: number;
        maxTotalPatchBytes: number;
    };
    summary: {
        changedFiles: number;
        commitCount: number;
        additions: number;
        deletions: number;
        binaryFiles: number;
        omittedPatches: number;
        includedPatchBytes: number;
        filesByRole: Record<ChangeTourFileRole, number>;
    };
    commits: BranchCommit[];
    files: ChangeTourContextFile[];
    pullRequest?: PullRequestSummary;
}

export interface BuildChangeTourContextOptions {
    headRef?: string;
    baseRef?: string;
    generatedAt?: string;
    maxPatchBytes?: number;
    maxTotalPatchBytes?: number;
    pullRequest?: PullRequestSummary;
}

export function buildChangeTourContext(
    startPath: string,
    options: BuildChangeTourContextOptions = {}
): ChangeTourContext {
    const range = resolveBranchReviewRange(startPath, options.headRef, options.baseRef);
    const maxPatchBytes = options.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
    const maxTotalPatchBytes = options.maxTotalPatchBytes ?? DEFAULT_MAX_TOTAL_PATCH_BYTES;
    requirePositiveInteger(maxPatchBytes, 'maxPatchBytes');
    requirePositiveInteger(maxTotalPatchBytes, 'maxTotalPatchBytes');
    const files = range.changedPaths.map((changedPath) => buildContextFile(
        range.repoRoot,
        range.mergeBaseOid,
        range.headOid,
        changedPath,
        maxPatchBytes
    ));
    applyTotalPatchBudget(files, maxTotalPatchBytes);
    const filesByRole = {
        production: 0,
        test: 0,
        documentation: 0,
        dependency: 0,
        generated: 0
    } satisfies Record<ChangeTourFileRole, number>;
    for (const file of files) filesByRole[file.role] += 1;
    return {
        version: CHANGE_TOUR_CONTEXT_VERSION,
        generatedAt: options.generatedAt || new Date().toISOString(),
        range: {
            baseRef: range.baseRef,
            headRef: range.headRef,
            mergeBaseOid: range.mergeBaseOid,
            headOid: range.headOid,
            dirtyWorkingTreeExcluded: range.dirty
        },
        limits: { maxPatchBytes, maxTotalPatchBytes },
        summary: {
            changedFiles: files.length,
            commitCount: range.commits.length,
            additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
            deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
            binaryFiles: files.filter((file) => file.binary).length,
            omittedPatches: files.filter((file) => file.patchOmittedReason).length,
            includedPatchBytes: files.reduce((total, file) => total + (file.patch ? file.patchBytes : 0), 0),
            filesByRole
        },
        commits: range.commits,
        files,
        pullRequest: options.pullRequest
    };
}

function applyTotalPatchBudget(files: ChangeTourContextFile[], maxBytes: number): void {
    let includedBytes = 0;
    for (const file of files) {
        if (!file.patch) continue;
        if (includedBytes + file.patchBytes <= maxBytes) {
            includedBytes += file.patchBytes;
            continue;
        }
        file.patch = undefined;
        file.patchOmittedReason = 'total-budget';
    }
}

function buildContextFile(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    changedPath: { kind: GitChangeKind; path: string; previousPath?: string },
    maxPatchBytes: number
): ChangeTourContextFile {
    const paths = [changedPath.previousPath, changedPath.path]
        .filter((candidate): candidate is string => Boolean(candidate));
    const stats = readLineStats(repoRoot, baseOid, headOid, paths);
    const patchResult = readPatch(repoRoot, baseOid, headOid, paths, stats.binary, maxPatchBytes);
    const changedRanges = patchResult.content ? parseChangedRanges(patchResult.content) : [];
    const pair = resolveReviewPathPair([changedPath], changedPath.path);
    const headContent = pair?.rightPath && !stats.binary
        ? readGitText(repoRoot, headOid, pair.rightPath, MAX_SYMBOL_SOURCE_BYTES)
        : undefined;
    return {
        path: changedPath.path,
        previousPath: changedPath.previousPath,
        changeKind: changedPath.kind,
        role: classifyFileRole(changedPath.path),
        additions: stats.additions,
        deletions: stats.deletions,
        binary: stats.binary,
        patch: patchResult.included ? patchResult.content : undefined,
        patchBytes: patchResult.bytes,
        patchOmittedReason: patchResult.reason,
        changedRanges,
        symbolHints: headContent ? findSymbolHints(headContent, changedRanges) : []
    };
}

function readLineStats(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    paths: string[]
): { additions: number | null; deletions: number | null; binary: boolean } {
    const output = runGit(repoRoot, ['diff', '--numstat', '--find-renames', baseOid, headOid, '--', ...paths]);
    const [additions = '0', deletions = '0'] = output.trim().split(/\s+/, 3);
    const binary = additions === '-' || deletions === '-';
    return {
        additions: binary ? null : Number.parseInt(additions, 10) || 0,
        deletions: binary ? null : Number.parseInt(deletions, 10) || 0,
        binary
    };
}

function readPatch(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    paths: string[],
    binary: boolean,
    maxPatchBytes: number
): { included: boolean; content: string; bytes: number; reason?: ChangeTourPatchOmission } {
    if (binary) return { included: false, content: '', bytes: 0, reason: 'binary' };
    try {
        const buffer = execFileSync('git', [
            'diff', '--no-ext-diff', '--no-color', '--find-renames', '--unified=3',
            baseOid, headOid, '--', ...paths
        ], {
            cwd: repoRoot,
            encoding: 'buffer',
            maxBuffer: MAX_CAPTURE_BYTES,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const content = buffer.toString('utf8');
        if (buffer.length > maxPatchBytes) {
            return { included: false, content, bytes: buffer.length, reason: 'too-large' };
        }
        return { included: true, content, bytes: buffer.length };
    } catch {
        return { included: false, content: '', bytes: 0, reason: 'unavailable' };
    }
}

function parseChangedRanges(patch: string): ChangeTourChangedRange[] {
    const ranges: ChangeTourChangedRange[] = [];
    const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(patch))) {
        ranges.push({
            baseStart: Number.parseInt(match[1], 10),
            baseCount: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
            headStart: Number.parseInt(match[3], 10),
            headCount: match[4] === undefined ? 1 : Number.parseInt(match[4], 10)
        });
    }
    return ranges;
}

function findSymbolHints(content: string, ranges: ChangeTourChangedRange[]): ChangeTourSymbolHint[] {
    const declarations: ChangeTourSymbolHint[] = [];
    content.split('\n').forEach((line, index) => {
        const python = line.match(/^\s*(?:async\s+)?(class|def)\s+([A-Za-z_]\w*)/);
        const typed = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/);
        const match = python || typed;
        if (match) declarations.push({ kind: match[1], name: match[2], line: index + 1 });
    });
    const selected = new Map<string, ChangeTourSymbolHint>();
    for (const range of ranges) {
        const start = range.headStart;
        const end = start + Math.max(0, range.headCount - 1);
        const enclosing = [...declarations].reverse().find((candidate) => candidate.line <= start);
        if (enclosing) selected.set(`${enclosing.kind}:${enclosing.name}:${enclosing.line}`, enclosing);
        for (const symbol of declarations.filter((candidate) => candidate.line >= start && candidate.line <= end)) {
            selected.set(`${symbol.kind}:${symbol.name}:${symbol.line}`, symbol);
        }
    }
    return [...selected.values()].slice(0, 25);
}

function readGitText(repoRoot: string, oid: string, relativePath: string, maxBytes: number): string | undefined {
    try {
        const content = execFileSync('git', ['show', `${oid}:${relativePath}`], {
            cwd: repoRoot,
            encoding: 'buffer',
            maxBuffer: maxBytes + 1,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        if (content.length > maxBytes || content.includes(0)) return undefined;
        return content.toString('utf8');
    } catch {
        return undefined;
    }
}

function classifyFileRole(filePath: string): ChangeTourFileRole {
    const lower = filePath.toLowerCase();
    const fileName = lower.split('/').pop() || lower;
    if (/(^|\/)(tests?|__tests__)(\/|$)/.test(lower) || /(^|\/)test_[^/]+$/.test(lower) || /\.(test|spec)\.[^/]+$/.test(lower)) return 'test';
    if (lower.startsWith('docs/') || fileName === 'readme.md' || /\.(md|mdx|rst)$/.test(lower)) return 'documentation';
    if (/(^|\/)(package-lock\.json|.*\.lock|pyproject\.toml|package\.json|go\.mod|cargo\.toml)$/.test(lower)) return 'dependency';
    if (/(^|\/)(dist|build|generated|vendor)(\/|$)/.test(lower) || /\.(min\.js|map)$/.test(lower)) return 'generated';
    return 'production';
}

function runGit(repoRoot: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: MAX_CAPTURE_BYTES,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd();
}

function requirePositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
}
