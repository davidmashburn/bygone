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
        canReturnToDirectory: Boolean(session?.canReturnToDirectory || session?.returnDirectory || session?.dirHistory?.viewRelativePath),
        canAddPanel: session?.mode === 'history' || (isMultiDiff && Boolean(session?.multi?.activePanelId)),
        canRemovePanel: isMultiDiff && (session?.multi?.files?.length || 0) > 1
    };
}

async function collectComparisonSelection(choosePaths, confirmSelection, { minimumCount = 2, allowBlankPanels = false } = {}) {
    const paths = [];
    let blankCount = 0;
    let chooseMore = true;
    const canceled = () => ({ paths: [], blankCount: 0 });
    while (true) {
        if (chooseMore) {
            const selectedPaths = await choosePaths(paths.length + blankCount);
            const pickerCanceled = !Array.isArray(selectedPaths) || selectedPaths.length === 0;
            if (!pickerCanceled) {
                for (const selectedPath of selectedPaths) {
                    if (typeof selectedPath === 'string' && !paths.includes(selectedPath)) {
                        paths.push(selectedPath);
                    }
                }
            }
            // A canceled follow-up picker keeps the selection available for review.
            if (pickerCanceled && paths.length + blankCount < minimumCount) return canceled();
            if (!pickerCanceled && paths.length + blankCount < 2) continue;
        }

        const decision = await confirmSelection([...paths], blankCount);
        if (decision === 'compare') {
            return { paths, blankCount };
        }
        if (decision === 'blank' && allowBlankPanels) {
            blankCount += 1;
            chooseMore = false;
        } else if (decision === 'add') {
            chooseMore = true;
        } else {
            return canceled();
        }
    }
}

module.exports = { collectComparisonSelection, getMenuCapabilities };
