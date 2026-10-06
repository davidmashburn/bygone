/* global module */

const VISIBLE_PANELS_STORAGE_KEY = 'bygone.visiblePanels';

function normalizeVisiblePanelCount(value) {
    return value === 'fit' ? 'fit' : [2, 3, 4].includes(Number(value)) ? Number(value) : 2;
}

function readVisiblePanelPreference(storage) {
    try { return normalizeVisiblePanelCount(storage?.getItem(VISIBLE_PANELS_STORAGE_KEY)); }
    catch { return 2; }
}

function writeVisiblePanelPreference(storage, value) {
    try { storage?.setItem(VISIBLE_PANELS_STORAGE_KEY, String(normalizeVisiblePanelCount(value))); }
    catch { /* Optional local preference, like word wrap. */ }
}

function computeFocusedStripLayout({
    panelCount,
    activePanelIndex,
    activePairIndex,
    viewportWidth,
    minimumPaneWidth = 360,
    gutterWidth = 96,
    requestedVisibleCount = 2,
    previousVisibleStart
}) {
    const count = Math.max(1, Number.isInteger(panelCount) ? panelCount : 1);
    const width = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1);
    const requested = normalizeVisiblePanelCount(requestedVisibleCount);
    const maximumCount = Math.min(count, requested === 'fit' ? count : requested);
    const minimum = requested === 'fit' || requested === 2
        ? Math.max(1, Number.isFinite(minimumPaneWidth) ? minimumPaneWidth : 360) : 280;
    const pairGutter = Math.max(0, Number.isFinite(gutterWidth) ? gutterWidth : 96);
    const gutterForCount = number => number === 1 ? 0 : number === 2 ? pairGutter : 48;
    let effectiveCount = maximumCount;
    while (effectiveCount > 1 && width < effectiveCount * minimum + (effectiveCount - 1) * gutterForCount(effectiveCount)) {
        effectiveCount--;
    }
    const mode = effectiveCount > 1 ? 'pair' : 'panel';
    const effectiveGutterWidth = gutterForCount(effectiveCount);
    const paneWidth = (width - (effectiveCount - 1) * effectiveGutterWidth) / effectiveCount;
    const panelIndex = clampIndex(activePanelIndex, count);
    const pairIndex = count > 1 ? clampIndex(activePairIndex, count - 1) : 0;
    const firstRequired = mode === 'pair' ? pairIndex : panelIndex;
    const lastRequired = mode === 'pair' ? pairIndex + 1 : panelIndex;
    const initialStart = firstRequired - Math.floor((effectiveCount - (mode === 'pair' ? 2 : 1)) / 2);
    let visibleStart = clampIndex(Number.isInteger(previousVisibleStart) ? previousVisibleStart : initialStart, count - effectiveCount + 1);
    // Keep visible selections stationary; reveal off-screen selections with the
    // smallest possible move, including after a resize or density change.
    visibleStart = Math.min(visibleStart, firstRequired);
    visibleStart = Math.max(visibleStart, lastRequired - effectiveCount + 1);
    const visiblePanelIndexes = Array.from({ length: effectiveCount }, (_, index) => visibleStart + index);
    const visiblePairIndexes = visiblePanelIndexes.slice(0, -1);
    const stride = paneWidth + effectiveGutterWidth;
    const trackWidth = (count * paneWidth) + ((count - 1) * effectiveGutterWidth);
    const offset = Math.min(Math.max(0, trackWidth - width), visibleStart * stride);

    return {
        mode, paneWidth, gutterWidth: effectiveGutterWidth, trackWidth, offset,
        panelIndex, pairIndex, effectiveCount, visibleStart, visiblePanelIndexes, visiblePairIndexes,
        limitedByWidth: effectiveCount < maximumCount
    };
}

function clampIndex(value, count) {
    const index = Number.isInteger(value) ? value : 0;
    return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

module.exports = {
    computeFocusedStripLayout,
    readVisiblePanelPreference,
    writeVisiblePanelPreference
};
