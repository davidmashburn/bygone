/* global module */

function containsModelLine(change, modelLineNumber) {
    if (!change || !Number.isInteger(modelLineNumber) || modelLineNumber < 1) {
        return false;
    }

    const lineIndex = modelLineNumber - 1;
    return change.start < change.end && lineIndex >= change.start && lineIndex < change.end;
}

function findChangeIndexAtLine(changes, modelLineNumber, preferredPairIndex = null) {
    if (!Array.isArray(changes)) {
        return -1;
    }

    const matches = [];
    changes.forEach((change, index) => {
        if (containsModelLine(change, modelLineNumber)) {
            matches.push({ change, index });
        }
    });

    if (matches.length === 0) {
        return -1;
    }

    if (Number.isInteger(preferredPairIndex)) {
        const preferred = matches.find(({ change }) => change.pairIndex === preferredPairIndex);
        if (preferred) {
            return preferred.index;
        }
    }

    return matches[0].index;
}

function buildBlockChanges(blocks, side) {
    if (!Array.isArray(blocks) || (side !== 'left' && side !== 'right')) {
        return [];
    }

    const startKey = side === 'left' ? 'leftStart' : 'rightStart';
    const endKey = side === 'left' ? 'leftEnd' : 'rightEnd';
    return blocks.map((block, blockIndex) => ({
        start: Math.max(0, block[startKey]),
        end: Math.max(0, block[endKey]),
        blockIndex
    }));
}

function buildDirectoryNavigationState(entries, activeRelativePath) {
    const files = Array.isArray(entries)
        ? entries.filter((entry) => !entry.isDirectory && entry.status !== 'same')
        : [];
    const currentIndex = files.findIndex((entry) => entry.relativePath === activeRelativePath);
    return {
        fileNavigation: {
            canGoPrevious: currentIndex > 0,
            canGoNext: currentIndex >= 0 && currentIndex < files.length - 1
        },
        directoryNavigation: {
            activeRelativePath,
            rail: {
                activeTabId: 'directory-files',
                tabs: [{ id: 'directory-files', label: 'Files' }],
                itemsByTab: {
                    'directory-files': files.map((entry) => ({
                        label: entry.displayName || entry.relativePath,
                        status: entry.status,
                        kind: 'directory-entry',
                        relativePath: entry.relativePath,
                        active: entry.relativePath === activeRelativePath
                    }))
                }
            }
        }
    };
}

function resolveFileNavigationAction({
    direction,
    mode,
    fileNavigation,
    panelIds,
    activePanelId
}) {
    if (direction !== 'previous' && direction !== 'next') {
        return { kind: 'none' };
    }

    if (fileNavigation && typeof fileNavigation === 'object') {
        const canNavigate = direction === 'previous'
            ? fileNavigation.canGoPrevious === true
            : fileNavigation.canGoNext === true;
        return canNavigate ? { kind: 'host-file' } : { kind: 'none' };
    }

    if (mode !== 'multi-way' || !Array.isArray(panelIds)) {
        return { kind: 'none' };
    }

    const currentIndex = panelIds.indexOf(activePanelId);
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= panelIds.length) {
        return { kind: 'none' };
    }

    return {
        kind: 'panel',
        panelId: panelIds[nextIndex],
        pairIndex: direction === 'previous'
            ? Math.max(0, nextIndex)
            : Math.max(0, nextIndex - 1)
    };
}

module.exports = {
    buildBlockChanges,
    buildDirectoryNavigationState,
    containsModelLine,
    findChangeIndexAtLine,
    resolveFileNavigationAction
};
