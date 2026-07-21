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
                        label: entry.relativePath,
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

module.exports = {
    buildBlockChanges,
    buildDirectoryNavigationState,
    containsModelLine,
    findChangeIndexAtLine
};
