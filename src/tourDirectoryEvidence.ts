import type { DirectoryEntry } from './directoryDiff';
import type { ChangeTourManifest, ChangeTourScene, ChangeTourDiffScene, ChangeTourOmittedFile } from './changeTourManifest';

/** Materialize the overview's exact comparison without substituting final snapshots. */
export function buildTourDirectoryEvidence(tour: ChangeTourManifest, scene: ChangeTourScene): {
    entries: DirectoryEntry[];
    files: ChangeTourDiffScene[];
    labels: [string, string];
    omitted: ChangeTourOmittedFile[];
} {
    const overview = 'overview' in scene ? scene.overview : undefined;
    const scope = (overview?.path || '').split('/').filter((part) => part && part !== '.').join('/');
    const inScope = (path: string) => !scope || path.startsWith(`${scope}/`);
    let labels: [string, string] = [tour.range.baseRef, tour.range.headRef];
    let files: ChangeTourDiffScene[];
    let omitted: ChangeTourOmittedFile[] = [];
    if (scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff') {
        const definitions = scene.kind === 'stacked-diff' ? scene.stack : scene.panels;
        const from = overview?.comparison
            ? definitions.findIndex((panel) => panel.id === overview.comparison?.from) : 0;
        const to = overview?.comparison
            ? definitions.findIndex((panel) => panel.id === overview.comparison?.to) : definitions.length - 1;
        if (!definitions[from] || !definitions[to] || from === to) {
            throw new Error(`Scene ${scene.id} has invalid overview comparison endpoints.`);
        }
        labels = [definitions[from].label, definitions[to].label];
        files = scene.files.flatMap((file): ChangeTourDiffScene[] => {
            if (!inScope(file.path)) return [];
            const left = file.panels[from];
            const right = file.panels[to];
            if (!left || !right) return [];
            if (left.exists === right.exists && left.content === right.content) return [];
            const changeKind = !left.exists ? 'added' : !right.exists ? 'deleted' : 'modified';
            return [{
                id: `${scene.id}-overview-${file.path}`, kind: 'text-diff', title: file.path,
                path: file.path, changeKind,
                leftContent: left.content, rightContent: right.content,
                leftLabel: labels[0], rightLabel: labels[1],
                summary: '', bullets: [], tags: [], takeaway: '', additions: 0, deletions: 0
            }];
        });
    } else {
        files = tour.files.filter((file): file is ChangeTourDiffScene => file.kind === 'text-diff' && inScope(file.path));
        omitted = tour.files.filter((file): file is ChangeTourOmittedFile => file.kind === 'omitted' && inScope(file.path));
    }
    const entries = new Map<string, DirectoryEntry>();
    for (const file of [...files, ...omitted]) {
        const sides = [file.changeKind !== 'added', file.changeKind !== 'deleted'];
        const parts = file.path.split('/');
        for (let depth = 0; depth < parts.length - 1; depth++) {
            const path = parts.slice(0, depth + 1).join('/');
            const directory = entries.get(path);
            if (directory) directory.sides = directory.sides.map((exists, index) => exists || sides[index]);
            else entries.set(path, {
                relativePath: path, displayName: parts[depth], depth, isDirectory: true,
                status: 'modified', sides: [...sides]
            });
        }
        entries.set(file.path, {
            relativePath: file.path, displayName: parts[parts.length - 1], depth: parts.length - 1,
            isDirectory: false, sides,
            status: !sides[0] ? 'right-only' : !sides[1] ? 'left-only' : 'modified',
            gitChangeKind: file.changeKind,
            ...(file.previousPath ? { previousPath: file.previousPath } : {}),
            ...(file.kind === 'omitted' ? { relationSummary: `Unavailable: ${file.reason}` } : {})
        });
    }
    for (const entry of entries.values()) {
        if (entry.isDirectory) entry.status = !entry.sides[0] ? 'right-only' : !entry.sides[1] ? 'left-only' : 'modified';
    }
    // Compare ancestor segments so each directory's descendants stay together.
    const sorted = [...entries.values()].sort((a, b) => {
        const left = a.relativePath.split('/');
        const right = b.relativePath.split('/');
        for (let i = 0; i < Math.min(left.length, right.length); i++) {
            if (left[i] === right[i]) continue;
            const leftDirectory = i < left.length - 1 || a.isDirectory;
            const rightDirectory = i < right.length - 1 || b.isDirectory;
            return Number(rightDirectory) - Number(leftDirectory) || left[i].localeCompare(right[i]);
        }
        return left.length - right.length;
    });
    const suffix = scope ? ` / ${scope}/` : '';
    return { entries: sorted, files, labels: [labels[0] + suffix, labels[1] + suffix], omitted };
}
