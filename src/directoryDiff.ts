import * as fs from 'fs';
import * as path from 'path';

export type DirectoryEntryStatus = 'same' | 'left-only' | 'right-only';

export interface DirectoryEntry {
    relativePath: string;
    displayName: string;
    depth: number;
    isDirectory: boolean;
    status: DirectoryEntryStatus;
}

function safeReadDir(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function collectUnionEntries(
    leftRoot: string,
    rightRoot: string,
    relativeDir: string,
    depth: number,
    result: DirectoryEntry[]
): void {
    const leftEntries = safeReadDir(path.join(leftRoot, relativeDir));
    const rightEntries = safeReadDir(path.join(rightRoot, relativeDir));

    const leftMap = new Map(leftEntries.map(e => [e.name, e]));
    const rightMap = new Map(rightEntries.map(e => [e.name, e]));

    const allNames = [...new Set([...leftMap.keys(), ...rightMap.keys()])]
        .filter(name => !name.startsWith('.'))
        .sort((a, b) => {
            const aIsDir = leftMap.get(a)?.isDirectory() ?? rightMap.get(a)?.isDirectory() ?? false;
            const bIsDir = leftMap.get(b)?.isDirectory() ?? rightMap.get(b)?.isDirectory() ?? false;
            if (aIsDir !== bIsDir) {
                return aIsDir ? -1 : 1;
            }
            return a.localeCompare(b);
        });

    for (const name of allNames) {
        const relPath = relativeDir ? `${relativeDir}/${name}` : name;
        const leftEntry = leftMap.get(name);
        const rightEntry = rightMap.get(name);
        const isDirectory = leftEntry?.isDirectory() ?? rightEntry?.isDirectory() ?? false;
        const status: DirectoryEntryStatus =
            leftEntry && rightEntry ? 'same' :
            leftEntry ? 'left-only' : 'right-only';

        result.push({
            relativePath: isDirectory ? `${relPath}/` : relPath,
            displayName: name,
            depth,
            isDirectory,
            status
        });

        if (isDirectory) {
            collectUnionEntries(leftRoot, rightRoot, relPath, depth + 1, result);
        }
    }
}

export function buildDirectoryComparison(leftDir: string, rightDir: string): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];
    collectUnionEntries(leftDir, rightDir, '', 0, entries);
    return entries;
}
