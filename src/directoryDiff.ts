import * as fs from 'fs';
import * as path from 'path';

export type DirectoryEntryStatus = 'same' | 'modified' | 'left-only' | 'right-only' | 'partial';

export interface DirectoryEntry {
    relativePath: string;
    displayName: string;
    depth: number;
    isDirectory: boolean;
    status: DirectoryEntryStatus;
    sides: boolean[];
}

function safeReadDir(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function collectUnionEntries(
    roots: string[],
    relativeDir: string,
    depth: number,
    result: DirectoryEntry[]
): boolean {
    const maps = roots.map((root) => new Map(safeReadDir(path.join(root, relativeDir)).map(e => [e.name, e])));
    let hasChanges = false;

    const allNames = [...new Set(maps.flatMap((entryMap) => [...entryMap.keys()]))]
        .filter(name => !name.startsWith('.'))
        .sort((a, b) => {
            const aIsDir = maps.some((entryMap) => entryMap.get(a)?.isDirectory() ?? false);
            const bIsDir = maps.some((entryMap) => entryMap.get(b)?.isDirectory() ?? false);
            if (aIsDir !== bIsDir) {
                return aIsDir ? -1 : 1;
            }
            return a.localeCompare(b);
        });

    for (const name of allNames) {
        const relPath = relativeDir ? `${relativeDir}/${name}` : name;
        const sideEntries = maps.map((entryMap) => entryMap.get(name));
        const sides = sideEntries.map(Boolean);
        const isDirectory = sideEntries.some((entry) => entry?.isDirectory() ?? false);
        let childrenChanged = false;

        result.push({
            relativePath: isDirectory ? `${relPath}/` : relPath,
            displayName: name,
            depth,
            isDirectory,
            status: 'same',
            sides
        });
        const entryIndex = result.length - 1;

        if (isDirectory) {
            childrenChanged = collectUnionEntries(roots, relPath, depth + 1, result);
        }

        const status = getEntryStatus(roots, relPath, sideEntries, sides, isDirectory, childrenChanged);
        result[entryIndex].status = status;
        hasChanges = hasChanges || status !== 'same';
    }

    return hasChanges;
}

function getEntryStatus(
    roots: string[],
    relativePath: string,
    entries: Array<fs.Dirent | undefined>,
    sides: boolean[],
    isDirectory: boolean,
    childrenChanged: boolean
): DirectoryEntryStatus {
    const presentCount = sides.filter(Boolean).length;

    if (presentCount === 0) {
        return 'same';
    }

    if (presentCount < roots.length) {
        if (roots.length === 2) {
            return sides[0] ? 'left-only' : 'right-only';
        }
        return 'partial';
    }

    if (isDirectory) {
        const allDirectories = entries.every((entry) => entry?.isDirectory());
        return allDirectories && !childrenChanged ? 'same' : 'modified';
    }

    return fileContentsEqual(roots.map((root) => path.join(root, relativePath))) ? 'same' : 'modified';
}

function fileContentsEqual(filePaths: string[]): boolean {
    try {
        const first = fs.readFileSync(filePaths[0]);
        return filePaths.slice(1).every((filePath) => first.equals(fs.readFileSync(filePath)));
    } catch {
        return false;
    }
}

export function buildDirectoryComparison(leftDir: string, rightDir: string): DirectoryEntry[] {
    return buildMultiDirectoryComparison([leftDir, rightDir]);
}

export function buildMultiDirectoryComparison(dirs: string[]): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];
    collectUnionEntries(dirs, '', 0, entries);
    return entries;
}
