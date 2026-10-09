/* global require, module */
const { moveComparisonPanel, movedPanelPairIndex } = require('../out/panelOrder.js');

function reorderComparisonSession(session, message) {
    if (session.mode !== 'multi-diff' || !session.multi || session.multi.sourceKind === 'history'
        || session.workspaceView?.mode === 'history') return null;
    const files = moveComparisonPanel(session.multi.files, message);
    if (!files) return null;
    session.multi.files = files;
    session.multi.activePanelId = message.panelId;
    session.multi.activePairIndex = movedPanelPairIndex(files.map(panel => panel.id), message.panelId);
    if (session.workspaceView) {
        session.workspaceView.panelOrder = files.map(panel => panel.revision);
        session.source = { ...session.source, comparisonView: { ...session.workspaceView } };
    } else if (session.returnDirectory) {
        session.source = { ...session.source, panelOrder: files.map(panel => String(panel.columnIndex)) };
        session.returnDirectory.source = session.source;
    } else if (session.source.kind === 'files') {
        session.source = { ...session.source, paths: files.map(panel => panel.path) };
    }
    return { type: 'reorderMultiPanels', panelIds: files.map(panel => panel.id), activePanelId: message.panelId };
}
module.exports = { reorderComparisonSession };
