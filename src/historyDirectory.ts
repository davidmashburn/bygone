import type { DirectoryEntry } from './directoryDiff';

/** Build a changed-files tree from path inventories without reading file contents. */
export function buildHistoryDirectoryEntries(paths: string[], inventories: ReadonlySet<string>[]): DirectoryEntry[] {
    const rows = new Map<string, DirectoryEntry>();
    const trees = inventories.map(files => {
        const tree = new Set(files);
        for (const file of files) {
            const parts = file.split('/');
            for (let depth = 1; depth < parts.length; depth++) tree.add(parts.slice(0, depth).join('/'));
        }
        return tree;
    });
    for (const file of paths) {
        const parts = file.split('/');
        for (let depth = 0; depth < parts.length; depth++) {
            const relativePath = parts.slice(0, depth + 1).join('/');
            if (rows.has(relativePath)) continue;
            const sides = trees.map(tree => tree.has(relativePath));
            rows.set(relativePath, { relativePath, displayName: parts[depth], depth,
                isDirectory: depth < parts.length - 1, sides,
                status: sides.every(Boolean) ? 'modified' : sides.length !== 2 ? 'partial'
                    : sides[0] ? 'left-only' : 'right-only' });
        }
    }
    return [...rows.values()].sort((a, b) => {
        const left = a.relativePath.split('/');
        const right = b.relativePath.split('/');
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            if (left[i] === right[i]) continue;
            return Number(i < right.length - 1 || b.isDirectory) - Number(i < left.length - 1 || a.isDirectory)
                || left[i].localeCompare(right[i]);
        }
        return left.length - right.length;
    });
}
