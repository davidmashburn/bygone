import type { HistoryViewState } from './webviewMessages';

export const MAX_WINDOW_TITLE_LENGTH = 120;

export function truncateTitle(text: string, max = MAX_WINDOW_TITLE_LENGTH): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, max - 1)}…`;
}

export function formatComparisonPair(left: string, right: string): string {
    return `${left} ↔ ${right}`;
}

export interface MultiPanelTitleInput {
    panels: Array<{ label: string }>;
    activePanelId?: string | null;
    activePairIndex?: number | null;
    panelIds?: string[];
}

export function buildMultiPanelTitle(input: MultiPanelTitleInput): string {
    const { panels, activePanelId, activePairIndex, panelIds } = input;
    if (panels.length === 0) {
        return 'Multi-Panel Compare';
    }
    if (panels.length === 1) {
        return truncateTitle(panels[0].label);
    }
    if (panels.length === 2) {
        return truncateTitle(formatComparisonPair(panels[0].label, panels[1].label));
    }

    const ids = panelIds ?? panels.map((_panel, index) => String(index));
    const activeIndex = activePanelId ? ids.findIndex((id) => id === activePanelId) : -1;

    if (activePairIndex !== null && activePairIndex !== undefined
        && activePairIndex >= 0 && activePairIndex < panels.length - 1) {
        return truncateTitle(formatComparisonPair(
            panels[activePairIndex].label,
            panels[activePairIndex + 1].label
        ));
    }

    if (activeIndex >= 0) {
        const derivedPairIndex = activeIndex < panels.length - 1
            ? activeIndex
            : Math.max(0, activeIndex - 1);
        return truncateTitle(formatComparisonPair(
            panels[derivedPairIndex].label,
            panels[derivedPairIndex + 1].label
        ));
    }

    return truncateTitle(formatComparisonPair(panels[0].label, panels[panels.length - 1].label));
}

export function buildHistoryTitle(
    fileName: string,
    options?: { shortCommit?: string; positionLabel?: string }
): string {
    const parts = [`${fileName} History`];
    if (options?.shortCommit) {
        parts.push(options.shortCommit);
    }
    if (options?.positionLabel) {
        parts.push(`(${options.positionLabel})`);
    }
    return truncateTitle(parts.join(' — '));
}

export function buildHistoryTitleFromViewState(
    fileName: string,
    history: Pick<HistoryViewState, 'positionLabel' | 'rightCommitLabel'>
): string {
    const shortCommit = history.rightCommitLabel.split(/\s+/)[0] || undefined;
    return buildHistoryTitle(fileName, {
        shortCommit,
        positionLabel: history.positionLabel
    });
}

export function buildTwoWayComparisonTitle(left: string, right: string): string {
    return truncateTitle(formatComparisonPair(left, right));
}

export function buildTourWindowTitle(
    manifest?: { windowTitle?: string; title?: string },
    appName = 'Bygone'
): string {
    const label = manifest?.windowTitle?.trim() || manifest?.title?.trim();
    return label ? truncateTitle(label) : `${appName} Tour`;
}

export interface StandaloneSessionTitleInput {
    mode?: string;
    left?: { label: string };
    right?: { label: string };
    multi?: {
        files: Array<{ id: string; label: string }>;
        activePanelId?: string | null;
        activePairIndex?: number | null;
    };
    history?: {
        filePath?: string;
        index?: number;
        entries?: Array<{ shortCommit?: string }>;
    };
    directory?: {
        labels?: string[];
        review?: { headRef?: string };
    };
    dirHistory?: { displayName?: string; viewRelativePath?: string };
}

export function buildStandaloneSessionTitle(session: StandaloneSessionTitleInput): string {
    if (session.mode === 'multi-diff' && session.multi) {
        return buildMultiPanelTitle({
            panels: session.multi.files,
            activePanelId: session.multi.activePanelId,
            activePairIndex: session.multi.activePairIndex,
            panelIds: session.multi.files.map((file) => file.id)
        });
    }

    if (session.mode === 'history' && session.history?.filePath) {
        const entry = session.history.entries?.[session.history.index ?? 0];
        return buildHistoryTitle(
            session.history.filePath.split('/').pop() || 'File',
            { shortCommit: entry?.shortCommit }
        );
    }

    if (session.mode === 'directory-history' && session.dirHistory) {
        const name = session.dirHistory.displayName || session.dirHistory.viewRelativePath || 'Directory';
        return truncateTitle(`${name} Directory History`);
    }

    if (session.mode === 'directory' && session.directory) {
        if (session.directory.review?.headRef) {
            return truncateTitle(`${session.directory.review.headRef} Branch Change`);
        }
        if (session.directory.labels?.length) {
            return truncateTitle(session.directory.labels.join(' ↔ '));
        }
    }

    if (session.left && session.right) {
        return buildTwoWayComparisonTitle(session.left.label, session.right.label);
    }

    return 'Compare';
}
