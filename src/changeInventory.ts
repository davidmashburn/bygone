import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { GitChangeKind, resolveBranchReviewRange } from './gitComparison';

export const CHANGE_INVENTORY_VERSION = 2 as const;

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
    oldText: string;
    newText: string;
}

export interface ChangeInventoryFile {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    material: 'text' | 'binary' | 'unsupported';
    additions: number | null;
    deletions: number | null;
    units: ChangeUnit[];
    baseContent?: string;
    headContent?: string;
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
    const basePath = changedPath.kind === 'added' ? undefined : (changedPath.previousPath || changedPath.path);
    const headPath = changedPath.kind === 'deleted' ? undefined : changedPath.path;
    const baseBlob = readGitBlob(repoRoot, baseOid, basePath);
    const headBlob = readGitBlob(repoRoot, headOid, headPath);
    if (!baseBlob || !headBlob) {
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
    const binary = added === '-' || deleted === '-'
        || !isLosslessTextBlob(baseBlob)
        || !isLosslessTextBlob(headBlob);
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
            'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--find-renames=20%',
            '--diff-algorithm=default', '--unified=0', '--inter-hunk-context=0',
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
        units,
        baseContent: baseBlob.toString('utf8'),
        headContent: headBlob.toString('utf8')
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
            body.push(lines[index]);
        }
        index -= 1;
        const { oldText, newText } = parseHunkText(body);
        const contextHash = createHash('sha256')
            .update(JSON.stringify([oldText, newText]))
            .digest('hex')
            .slice(0, 16);
        const baseId = `hunk-${createHash('sha256').update(JSON.stringify([
            changedPath.previousPath || changedPath.path,
            changedPath.path,
            oldText,
            newText
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
            contextHash,
            oldText,
            newText
        });
    }
    return units;
}

export function materializeChangeUnits(
    baseContent: string,
    units: readonly ChangeUnit[],
    selectedUnitIds: Iterable<string>
): string {
    const selected = new Set(selectedUnitIds);
    const knownIds = new Set(units.map((unit) => unit.id));
    for (const id of selected) {
        if (!knownIds.has(id)) {
            throw new Error(`Unknown change unit: ${id}`);
        }
    }

    const offsets = buildLineBoundaryOffsets(baseContent);
    const ordered = [...units].sort((left, right) => {
        const leftRange = resolveBaseRange(left, offsets, baseContent.length);
        const rightRange = resolveBaseRange(right, offsets, baseContent.length);
        return leftRange.start - rightRange.start || leftRange.end - rightRange.end;
    });
    const chunks: string[] = [];
    let cursor = 0;
    let previousEnd = 0;

    for (const unit of ordered) {
        const range = resolveBaseRange(unit, offsets, baseContent.length);
        if (range.start < previousEnd) {
            throw new Error(`Overlapping change units cannot be materialized independently: ${unit.id}`);
        }
        if (baseContent.slice(range.start, range.end) !== unit.oldText) {
            throw new Error(`Change unit ${unit.id} no longer matches its base content.`);
        }
        if (selected.has(unit.id)) {
            chunks.push(baseContent.slice(cursor, range.start), unit.newText);
            cursor = range.end;
        }
        previousEnd = Math.max(previousEnd, range.end);
    }

    chunks.push(baseContent.slice(cursor));
    return chunks.join('');
}

function parseHunkText(body: readonly string[]): { oldText: string; newText: string } {
    let oldText = '';
    let newText = '';
    let previousPrefix = '';

    for (const line of body) {
        if (line === '\\ No newline at end of file') {
            if (previousPrefix === '-' || previousPrefix === ' ') oldText = removeFinalNewline(oldText);
            if (previousPrefix === '+' || previousPrefix === ' ') newText = removeFinalNewline(newText);
            continue;
        }
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === '-' || prefix === ' ') oldText += `${content}\n`;
        if (prefix === '+' || prefix === ' ') newText += `${content}\n`;
        previousPrefix = prefix;
    }

    return { oldText, newText };
}

function removeFinalNewline(value: string): string {
    return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function buildLineBoundaryOffsets(content: string): number[] {
    const offsets = [0];
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] === '\n') offsets.push(index + 1);
    }
    if (offsets[offsets.length - 1] !== content.length) offsets.push(content.length);
    return offsets;
}

function resolveBaseRange(
    unit: ChangeUnit,
    offsets: readonly number[],
    contentLength: number
): { start: number; end: number } {
    const startIndex = unit.baseCount === 0 ? unit.baseStart : unit.baseStart - 1;
    const endIndex = unit.baseCount === 0 ? startIndex : startIndex + unit.baseCount;
    const start = offsets[startIndex];
    const end = offsets[endIndex];
    if (start === undefined || end === undefined || start > contentLength || end > contentLength) {
        throw new Error(`Change unit ${unit.id} has an invalid base range.`);
    }
    return { start, end };
}

function isLosslessTextBlob(content: Buffer): boolean {
    if (content.includes(0)) return false;
    const decoded = content.toString('utf8');
    return Buffer.from(decoded, 'utf8').equals(content);
}

function readGitBlob(repoRoot: string, oid: string, relativePath?: string): Buffer | null {
    if (!relativePath) return Buffer.alloc(0);
    try {
        return execFileSync('git', ['show', `${oid}:${relativePath}`], {
            cwd: repoRoot,
            encoding: 'buffer',
            maxBuffer: 16 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch {
        return null;
    }
}

function runGit(repoRoot: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
