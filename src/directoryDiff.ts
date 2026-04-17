import * as fs from 'fs';
import * as path from 'path';

export interface DirectoryMap {
    leftLineToPath: string[];
    rightLineToPath: string[];
    pathToLeftLine: Record<string, number>;
    pathToRightLine: Record<string, number>;
}

export interface DirectoryDiffInput {
    leftText: string;
    rightText: string;
    directoryMap: DirectoryMap;
}

interface TreeEntry {
    relativePath: string;
    displayLine: string;
}

function collectEntries(rootDir: string, relativeDir: string, depth: number, result: TreeEntry[]): void {
    const absDir = path.join(rootDir, relativeDir);
    let entries: fs.Dirent[];

    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return;
    }

    entries.sort((a, b) => {
        const aIsDir = a.isDirectory();
        const bIsDir = b.isDirectory();
        if (aIsDir !== bIsDir) {
            return aIsDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });

    const indent = '  '.repeat(depth);

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
            result.push({
                relativePath: `${relPath}/`,
                displayLine: `${indent}${entry.name}/`
            });
            collectEntries(rootDir, relPath, depth + 1, result);
        } else {
            result.push({
                relativePath: relPath,
                displayLine: `${indent}${entry.name}`
            });
        }
    }
}

function buildSide(entries: TreeEntry[]): {
    text: string;
    lineToPath: string[];
    pathToLine: Record<string, number>;
} {
    const lineToPath: string[] = [];
    const pathToLine: Record<string, number> = {};
    const lines: string[] = [];

    for (const entry of entries) {
        pathToLine[entry.relativePath] = lines.length;
        lineToPath.push(entry.relativePath);
        lines.push(entry.displayLine);
    }

    return { text: lines.join('\n'), lineToPath, pathToLine };
}

export function buildDirectoryDiffInput(leftDir: string, rightDir: string): DirectoryDiffInput {
    const leftEntries: TreeEntry[] = [];
    const rightEntries: TreeEntry[] = [];

    collectEntries(leftDir, '', 0, leftEntries);
    collectEntries(rightDir, '', 0, rightEntries);

    const left = buildSide(leftEntries);
    const right = buildSide(rightEntries);

    return {
        leftText: left.text,
        rightText: right.text,
        directoryMap: {
            leftLineToPath: left.lineToPath,
            rightLineToPath: right.lineToPath,
            pathToLeftLine: left.pathToLine,
            pathToRightLine: right.pathToLine
        }
    };
}
