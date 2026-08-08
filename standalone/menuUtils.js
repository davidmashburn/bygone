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
    return {
        isMultiDiff,
        isTwoWayDiff,
        isHistory,
        canFind,
        canRefreshSession: isRefreshableSource(session?.source),
        canReturnToDirectory: Boolean(session?.returnDirectory || session?.dirHistory?.viewRelativePath),
        canAddPanel: session?.mode === 'history' || (isMultiDiff && Boolean(session?.multi?.activePanelId)),
        canRemovePanel: isMultiDiff && (session?.multi?.files?.length || 0) > 1
    };
}

module.exports = { getMenuCapabilities };
