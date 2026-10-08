import type { DirectoryEntry } from './directoryDiff';
import { buildHistoryDirectoryEntries } from './historyDirectory';
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
    // Authored evidence may include synthetic stages and omitted files. Build
    // inventories from that evidence only, then retain its explanatory metadata.
    const evidence = [...files, ...omitted];
    const byPath = new Map(evidence.map(file => [file.path, file]));
    const inventories = [
        new Set(evidence.filter(file => file.changeKind !== 'added').map(file => file.path)),
        new Set(evidence.filter(file => file.changeKind !== 'deleted').map(file => file.path))
    ];
    const sorted = buildHistoryDirectoryEntries(evidence.map(file => file.path), inventories).map(entry => {
        const file = byPath.get(entry.relativePath);
        return !file || entry.isDirectory ? entry : { ...entry, gitChangeKind: file.changeKind,
            ...(file.previousPath ? { previousPath: file.previousPath } : {}),
            ...(file.kind === 'omitted' ? { relationSummary: `Unavailable: ${file.reason}` } : {}) };
    });
    const suffix = scope ? ` / ${scope}/` : '';
    return { entries: sorted, files, labels: [labels[0] + suffix, labels[1] + suffix], omitted };
}
