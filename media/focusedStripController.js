/* global module */

function computeFocusedStripLayout({
    panelCount,
    activePanelIndex,
    activePairIndex,
    viewportWidth,
    minimumPaneWidth,
    gutterWidth
}) {
    const count = Math.max(1, Number.isInteger(panelCount) ? panelCount : 1);
    const width = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1);
    const minimum = Math.max(1, Number.isFinite(minimumPaneWidth) ? minimumPaneWidth : 1);
    const pairGutter = Math.max(0, Number.isFinite(gutterWidth) ? gutterWidth : 0);
    const pairMode = count > 1 && width >= (minimum * 2) + pairGutter;
    const mode = pairMode ? 'pair' : 'panel';
    const effectiveGutterWidth = pairMode ? pairGutter : 0;
    const paneWidth = pairMode ? (width - effectiveGutterWidth) / 2 : width;
    const panelIndex = clampIndex(activePanelIndex, count);
    const pairIndex = count > 1 ? clampIndex(activePairIndex, count - 1) : 0;
    const anchorIndex = pairMode ? pairIndex : panelIndex;
    const stride = paneWidth + effectiveGutterWidth;
    const trackWidth = (count * paneWidth) + ((count - 1) * effectiveGutterWidth);
    const maximumOffset = Math.max(0, trackWidth - width);
    const offset = Math.min(maximumOffset, Math.max(0, anchorIndex * stride));

    return {
        mode,
        paneWidth,
        gutterWidth: effectiveGutterWidth,
        trackWidth,
        offset,
        panelIndex,
        pairIndex
    };
}

function clampIndex(value, count) {
    const index = Number.isInteger(value) ? value : 0;
    return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

module.exports = {
    computeFocusedStripLayout
};
