import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { GitChangeKind, resolveBranchReviewRange } from './gitComparison';

export const CHANGE_INVENTORY_VERSION = 1 as const;

export interface ChangeUnit {
    id: string;
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    baseStart: number;
    baseCount: number;
    headStart: number;
    headCount: number;
    additions: number;
    deletions: number;
    contextHash: string;
}

export interface ChangeInventoryFile {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    material: 'text' | 'binary' | 'unsupported';
    additions: number | null;
    deletions: number | null;
    units: ChangeUnit[];
}

export interface ChangeInventory {
    version: typeof CHANGE_INVENTORY_VERSION;
    range: {
        repoRoot: string;
        baseRef: string;
        headRef: string;
        baseOid: string;
        headOid: string;
    };
    summary: {
        changedFiles: number;
        textualFiles: number;
        binaryFiles: number;
        changeUnits: number;
        additions: number;
        deletions: number;
    };
    files: ChangeInventoryFile[];
}

export interface BuildChangeInventoryOptions {
    headRef?: string;
    baseRef?: string;
}

export function buildChangeInventory(
    startPath: string,
    options: BuildChangeInventoryOptions = {}
): ChangeInventory {
    const range = resolveBranchReviewRange(startPath, options.headRef, options.baseRef);
    const files = range.changedPaths.map((changedPath) => buildInventoryFile(
        range.repoRoot,
        range.mergeBaseOid,
        range.headOid,
        changedPath
    ));
    return {
        version: CHANGE_INVENTORY_VERSION,
        range: {
            repoRoot: range.repoRoot,
            baseRef: range.baseRef,
            headRef: range.headRef,
            baseOid: range.mergeBaseOid,
            headOid: range.headOid
        },
        summary: {
            changedFiles: files.length,
            textualFiles: files.filter((file) => file.material === 'text').length,
            binaryFiles: files.filter((file) => file.material === 'binary').length,
            changeUnits: files.reduce((total, file) => total + file.units.length, 0),
            additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
            deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0)
        },
        files
    };
}

function buildInventoryFile(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    changedPath: { kind: GitChangeKind; path: string; previousPath?: string }
): ChangeInventoryFile {
    const paths = [...new Set([changedPath.previousPath, changedPath.path].filter(Boolean))] as string[];
    const numstat = runGit(repoRoot, ['diff', '--numstat', '--find-renames', baseOid, headOid, '--', ...paths]);
    const [added = '0', deleted = '0'] = numstat.trim().split(/\s+/, 3);
    const binary = added === '-' || deleted === '-';
    if (binary) {
        return {
            path: changedPath.path,
            previousPath: changedPath.previousPath,
            changeKind: changedPath.kind,
            material: 'binary',
            additions: null,
            deletions: null,
            units: []
        };
    }

    let patch: string;
    try {
        patch = runGit(repoRoot, [
            'diff', '--no-ext-diff', '--no-color', '--find-renames', '--unified=3',
            baseOid, headOid, '--', ...paths
        ]);
    } catch {
        return {
            path: changedPath.path,
            previousPath: changedPath.previousPath,
            changeKind: changedPath.kind,
            material: 'unsupported',
            additions: Number.parseInt(added, 10) || 0,
            deletions: Number.parseInt(deleted, 10) || 0,
            units: []
        };
    }

    const units = parsePatchUnits(patch, changedPath);
    return {
        path: changedPath.path,
        previousPath: changedPath.previousPath,
        changeKind: changedPath.kind,
        material: 'text',
        additions: Number.parseInt(added, 10) || 0,
        deletions: Number.parseInt(deleted, 10) || 0,
        units
    };
}

export function parsePatchUnits(
    patch: string,
    changedPath: { kind: GitChangeKind; path: string; previousPath?: string }
): ChangeUnit[] {
    const lines = patch.split('\n');
    const units: ChangeUnit[] = [];
    const seenIds = new Map<string, number>();
    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (!match) continue;
        const body: string[] = [];
        for (index += 1; index < lines.length && !lines[index].startsWith('@@ ') && !lines[index].startsWith('diff --git '); index += 1) {
            if (!lines[index].startsWith('\\ No newline')) body.push(lines[index]);
        }
        index -= 1;
        const normalizedBody = body.join('\n');
        const contextHash = createHash('sha256').update(normalizedBody).digest('hex').slice(0, 16);
        const baseId = `hunk-${createHash('sha256').update(JSON.stringify([
            changedPath.previousPath || changedPath.path,
            changedPath.path,
            normalizedBody
        ])).digest('hex').slice(0, 12)}`;
        const occurrence = (seenIds.get(baseId) || 0) + 1;
        seenIds.set(baseId, occurrence);
        units.push({
            id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
            path: changedPath.path,
            previousPath: changedPath.previousPath,
            changeKind: changedPath.kind,
            baseStart: Number.parseInt(match[1], 10),
            baseCount: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
            headStart: Number.parseInt(match[3], 10),
            headCount: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
            additions: body.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
            deletions: body.filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
            contextHash
        });
    }
    return units;
}

function runGit(repoRoot: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
    }).trimEnd();
}
