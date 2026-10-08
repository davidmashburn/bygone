import type { DirectoryEntry } from './directoryDiff';

/** View policy shared by desktop workspaces, browser tours, and exported tours.
 * Callers supply already-scoped evidence; this module never reads a repository
 * or grants editing capabilities.
 */
export interface RevisionFiles {
    paths: readonly string[];
    currentPath: string | null;
    changedPaths?: ReadonlySet<string>;
}

export function revisionFileTarget(files: RevisionFiles, direction: -1 | 1): string | null {
    if (!files.currentPath || (direction !== -1 && direction !== 1)) return null;
    const current = files.paths.indexOf(files.currentPath);
    if (current < 0) return null;
    for (let index = current + direction; index >= 0 && index < files.paths.length; index += direction) {
        if (!files.changedPaths || files.changedPaths.has(files.paths[index])) return files.paths[index];
    }
    return null;
}

export function revisionFileNavigation(files: RevisionFiles) {
    return { canGoPrevious: revisionFileTarget(files, -1) !== null, canGoNext: revisionFileTarget(files, 1) !== null };
}

/** null means ignore the action; { path: null } means return to the overview. */
export function revisionFileAction(
    message: { type: string; relativePath?: unknown; direction?: unknown },
    files: RevisionFiles,
    canReturnToDirectory: boolean
): { path: string | null } | null {
    if (message.type === 'returnToDirectory') return canReturnToDirectory ? { path: null } : null;
    if (message.type === 'openDirectoryEntry') {
        return typeof message.relativePath === 'string' && files.paths.includes(message.relativePath)
            ? { path: message.relativePath } : null;
    }
    if (message.type === 'navigateFile' && (message.direction === 'previous' || message.direction === 'next')) {
        const path = revisionFileTarget(files, message.direction === 'previous' ? -1 : 1);
        return path === null ? null : { path };
    }
    return null;
}

export function revisionDirectoryView(labels: string[], entries: DirectoryEntry[]) {
    return { type: 'showDirectoryDiff' as const, labels, leftLabel: labels[0], rightLabel: labels[labels.length - 1], entries, canMutate: false };
}

export function revisionPanelPairs<P, D>(panels: readonly P[], diff?: (left: P, right: P) => D) {
    return panels.slice(0, -1).map((panel, index) => ({
        leftIndex: index, rightIndex: index + 1,
        ...(diff ? { diffModel: diff(panel, panels[index + 1]) } : {})
    }));
}

export function revisionPanelsView<P, D>(options: {
    panels: P[];
    files: RevisionFiles;
    activePanelId?: string | null;
    activePairIndex?: number;
    canReturnToDirectory: boolean;
    mutationEnabled: boolean;
}, diff?: (left: P, right: P) => D) {
    const { files, ...view } = options;
    return { type: 'showMultiDiff' as const, ...view, pairs: revisionPanelPairs(view.panels, diff), fileNavigation: revisionFileNavigation(files) };
}

interface CommitEntry {
    commit: string;
    shortCommit: string;
    summary: string;
    timestamp?: string;
    author?: string;
    authorEmail?: string;
    message?: string;
    parents?: string[];
    parentCommit?: string | null;
}

export function revisionRailItems(entries: readonly CommitEntry[], options: {
    displayed?: readonly (string | null | undefined)[];
    selected: readonly string[];
    active?: string | null;
    changed?: ReadonlySet<string>;
    tourCommits?: ReadonlySet<string>;
    selectionEnabled: boolean;
    missingRevisionSelectionEnabled?: boolean;
    missingRevisionLabel: (commit: string | null) => string;
}) {
    const displayed = options.displayed || [];
    const marker = (commit: string | null) => ({
        active: commit === options.active,
        selected: commit !== null && options.selected.includes(commit),
        panelNumber: displayed.indexOf(commit) + 1 || undefined
    });
    const items = entries.map((entry, index) => ({
        kind: 'history-entry', index, commit: entry.commit as string | null,
        label: `${entry.shortCommit} ${entry.summary}`.trim(), meta: entry.timestamp || '',
        summary: entry.summary, timestamp: entry.timestamp, author: entry.author,
        authorEmail: entry.authorEmail, message: entry.message,
        parents: entry.parents || (entry.parentCommit ? [entry.parentCommit] : []),
        selectionEnabled: options.selectionEnabled, ...marker(entry.commit),
        ...(options.changed ? { changesFile: options.changed.has(entry.commit) } : {}),
        ...(options.tourCommits ? { inTour: options.tourCommits.has(entry.commit) } : {})
    }));
    displayed.forEach((commit, index) => {
        // Synthetic stages have no Git identity and must not gain commit markers.
        if (commit === undefined || items.some(item => item.commit === commit)) return;
        items.push({ kind: 'panel-revision', index: -index - 1, commit,
            label: options.missingRevisionLabel(commit), meta: '', summary: '', timestamp: undefined,
            author: undefined, authorEmail: undefined, message: undefined, parents: [],
            selectionEnabled: Boolean(options.missingRevisionSelectionEnabled), ...marker(commit) });
    });
    return items;
}
