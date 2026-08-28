/* global module, require */

const { isRefreshableSource } = require('./sessionSource.js');

function getMenuCapabilities(session) {
    const isMultiDiff = session?.mode === 'multi-diff';
    const isTwoWayDiff = session?.mode === 'diff';
    const isHistory = session?.mode === 'history' || session?.mode === 'directory-history';
    const canFind = (isTwoWayDiff && !session?.binaryComparison)
        || (isMultiDiff && Boolean(session?.multi?.files?.some((panel) => panel.path || panel.content)))
        || (session?.mode === 'history')
        || (session?.mode === 'directory-history' && Boolean(session?.dirHistory?.viewRelativePath));
    const activeMultiPanel = isMultiDiff
        ? session?.multi?.files?.find((panel) => panel.id === session?.multi?.activePanelId)
        : null;
    const canReplace = (isTwoWayDiff && !session?.binaryComparison && !session?.returnDirectory?.review)
        || Boolean(activeMultiPanel?.editable);
    const canSearchComparison = canFind || session?.mode === 'directory';
    return {
        isMultiDiff,
        isTwoWayDiff,
        isHistory,
        canFind,
        canSearchComparison,
        canReplace,
        canRefreshSession: isRefreshableSource(session?.source),
        canReturnToDirectory: Boolean(session?.returnDirectory || session?.dirHistory?.viewRelativePath),
        canAddPanel: session?.mode === 'history' || (isMultiDiff && Boolean(session?.multi?.activePanelId)),
        canRemovePanel: isMultiDiff && (session?.multi?.files?.length || 0) > 1
    };
}

async function collectComparisonSelection(choosePaths, confirmSelection) {
    const paths = [];
    while (true) {
        const selectedPaths = await choosePaths(paths.length);
        if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
            return [];
        }

        for (const selectedPath of selectedPaths) {
            if (typeof selectedPath === 'string' && !paths.includes(selectedPath)) {
                paths.push(selectedPath);
            }
        }

        if (paths.length < 2) {
            continue;
        }

        const decision = await confirmSelection([...paths]);
        if (decision === 'compare') {
            return paths;
        }
        if (decision !== 'add') {
            return [];
        }
    }
}

module.exports = { collectComparisonSelection, getMenuCapabilities };
