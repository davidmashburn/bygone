/* global module */

function getMenuCapabilities(session) {
    const isMultiDiff = session?.mode === 'multi-diff';
    const isTwoWayDiff = session?.mode === 'diff';
    const isHistory = session?.mode === 'history' || session?.mode === 'directory-history';
    return {
        isMultiDiff,
        isTwoWayDiff,
        isHistory,
        canReturnToDirectory: Boolean(session?.returnDirectory || session?.dirHistory?.viewRelativePath),
        canAddPanel: session?.mode === 'history' || (isMultiDiff && Boolean(session?.multi?.activePanelId)),
        canRemovePanel: isMultiDiff && (session?.multi?.files?.length || 0) > 1
    };
}

module.exports = { getMenuCapabilities };
