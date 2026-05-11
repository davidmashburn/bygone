import { buildTwoWayDiffModel } from '../src/diffEngine';

const host = createHostBridge();
const {
    VIEW_IDS,
    getElement,
    setTextContent,
    clearHistoryToolbar,
    escapeAttr,
    renderPlainLines,
    renderResultLines,
    toggleView,
    setStatus,
    resetScrollPositions,
    resetDirectoryView,
    renderDirectoryView,
    expandAllDirectories,
    collapseAllDirectories,
    collapseUnchangedDirectories
} = window.BygoneDom;

const MODE_TWO_WAY = 'two-way';
const MODE_MULTI_WAY = 'multi-way';
const MULTI_PANEL_WIDTH = 470;
const MULTI_GUTTER_WIDTH = 96;

let currentMode = MODE_TWO_WAY;
let diffBlocks = [];
let monacoInstance;
let leftEditor;
let rightEditor;
let leftDecorationIds = [];
let rightDecorationIds = [];
let activeDiffIndex = -1;
let currentDiffModel = null;
let suppressEditorEvents = false;
let recomputeTimer;
let pendingTwoWayPayload;
let pendingMultiPayload;
let currentDiffRows = [];
let scrollMaps = null;
let historyMode = false;
let hostEditableSides = { left: true, right: true };
let userReadOnly = false;
let directoryEntries = [];
let multiEditors = [];
let multiDecorationIds = [];
let multiDiffPairs = [];
let multiPanels = [];
let activeMultiPanelId = null;
let activeMultiPairIndex = null;
let multiPanelChangeIndices = new Map();
let multiPanelMutationEnabled = false;
let historyRailState = null;
let activeHistoryRailTabId = null;
let currentFileNavigation = { canGoPrevious: false, canGoNext: false };
let activePaneSide = 'right';
let activeDirectoryEntryPath = null;
let suppressDirectoryScrollSync = false;
const connectorController = window.BygoneConnectors.createConnectorController({
    getElement,
    getMode: () => currentMode,
    getEditors: () => ({ leftEditor, rightEditor }),
    getDiffBlocks: () => diffBlocks,
    getDirectoryEntries: () => directoryEntries,
    getMultiDiffState: () => ({ editors: multiEditors, pairs: multiDiffPairs }),
    getMonaco: () => monacoInstance
});

function notifyRenderComplete() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            host.postMessage({
                type: 'renderComplete',
                mode: currentMode
            });
        });
    });
}

host.onMessage((message) => {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.type === 'showDiff') {
        if (!monacoInstance) {
            pendingTwoWayPayload = message;
            return;
        }

        showTwoWayDiff(
            message.file1,
            message.file2,
            message.leftContent,
            message.rightContent,
            message.diffModel,
            message.history || null,
            message.fileNavigation || null,
            Boolean(message.canReturnToDirectory),
            message.editableSides
        );
        return;
    }

    if (message.type === 'showDirectoryDiff') {
        showDirectoryDiff(message.leftLabel, message.rightLabel, message.entries, message.labels, message.history || null);
        return;
    }

    if (message.type === 'showMultiDiff') {
        if (!monacoInstance) {
            pendingMultiPayload = message;
            return;
        }

        showMultiDiff(message.panels, message.pairs, message.activePanelId ?? null, message.activePairIndex ?? null);
        return;
    }

    if (message.type === 'showThreeWayMerge') {
        showThreeWayMerge(message);
    }
});

window.addEventListener('load', async () => {
    connectorController.initializeCanvas();
    initializeHistoryRail();
    initializeHistoryToolbar();
    initializeDirectoryTreeToolbar();
    initializeChangeToolbar();
    initializeDirectoryReturnToolbar();
    initializeEditModeToolbar();
    initializeDirectoryViewEvents();
    initializeMultiDiffInteractions();
    initializeStandaloneDropTarget();
    await initializeMonaco();
    host.postMessage({ type: 'ready' });

    if (pendingTwoWayPayload) {
        showTwoWayDiff(
            pendingTwoWayPayload.file1,
            pendingTwoWayPayload.file2,
            pendingTwoWayPayload.leftContent,
            pendingTwoWayPayload.rightContent,
            pendingTwoWayPayload.diffModel,
            pendingTwoWayPayload.history || null,
            pendingTwoWayPayload.fileNavigation || null,
            Boolean(pendingTwoWayPayload.canReturnToDirectory),
            pendingTwoWayPayload.editableSides
        );
        pendingTwoWayPayload = undefined;
    }

    if (pendingMultiPayload) {
        showMultiDiff(
            pendingMultiPayload.panels,
            pendingMultiPayload.pairs,
            pendingMultiPayload.activePanelId ?? null,
            pendingMultiPayload.activePairIndex ?? null
        );
        pendingMultiPayload = undefined;
    }
});

window.addEventListener('resize', () => {
    layoutEditors();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
});

async function initializeMonaco() {
    self.MonacoEnvironment = {
        getWorker: () => new Worker(host.editorWorkerUrl)
    };

    monacoInstance = window.monaco;
}

function showTwoWayDiff(file1, file2, leftContent, rightContent, diffModel, history, fileNavigation, canReturnToDirectory = false, nextEditableSides = null) {
    currentMode = MODE_TWO_WAY;
    historyMode = Boolean(history);
    activeDirectoryEntryPath = null;
    hostEditableSides = normalizeEditableSides(nextEditableSides, historyMode);
    if (hostEditableSides.left && !hostEditableSides.right) {
        activePaneSide = 'left';
    } else if (hostEditableSides.right) {
        activePaneSide = 'right';
    }
    setCurrentDiffModel(diffModel);
    setActiveDiffIndex(diffBlocks.length > 0 ? clamp(activeDiffIndex, 0, diffBlocks.length - 1) : -1, false);
    directoryEntries = [];
    disposeMultiEditors();

    toggleView(VIEW_IDS.twoWay);
    setStatus('', false);
    setTextContent('file-info', `Comparing ${file1} and ${file2}`);
    setTextContent('file1-header', file1);
    setTextContent('file2-header', file2);
    updateHistoryToolbar(history);
    updateHistoryRail(history?.rail || null);
    updateFileNavigationState(fileNavigation || null, canReturnToDirectory);
    updateDirectoryReturnToolbar(canReturnToDirectory);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();

    ensureTwoWayEditors();
    updateActivePaneHeader();
    updateEditorValues(leftContent, rightContent);
    updateTwoWayEditorOptions();
    applyDiffDecorations(diffModel);
    updateChangeToolbarState();
    resetTwoWayScrollPositions();
    layoutEditors();
    revealActiveDiff(false);
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function showDirectoryDiff(leftLabel, rightLabel, entries, labels, history) {
    currentMode = 'directory';
    historyMode = false;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = entries || [];
    activeDirectoryEntryPath = getDefaultDirectoryEntryPath(directoryEntries);
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(history);
    updateHistoryRail(history?.rail || null);
    updateFileNavigationState(null, false);
    updateDirectoryReturnToolbar(false);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    const directoryLabels = Array.isArray(labels) && labels.length >= 2 ? labels : [leftLabel, rightLabel];

    toggleView(VIEW_IDS.directory);
    setStatus('', false);
    setTextContent('file-info', `Comparing directories ${directoryLabels.join(' and ')}`);

    resetDirectoryView();
    renderDirectoryView(getElement('dir-rows'), directoryEntries, directoryLabels);
    collapseUnchangedDirectories(getElement('dir-rows'), directoryEntries);
    attachDirectoryScrollSync();
    resetDirectoryScrollPositions();
    updateDirectoryEntrySelection();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function showMultiDiff(panels, pairs, nextActivePanelId = null, nextActivePairIndex = null) {
    if (!Array.isArray(panels) || panels.length < 1) {
        return;
    }

    currentMode = MODE_MULTI_WAY;
    historyMode = false;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = [];
    disposeTwoWayEditors();
    disposeMultiEditors(false);
    multiPanels = panels;
    multiDiffPairs = pairs || [];
    activeMultiPanelId = resolveActiveMultiPanelId(panels, nextActivePanelId);
    activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, nextActivePairIndex, activeMultiPanelId, panels);
    multiPanelChangeIndices = new Map();
    multiPanelMutationEnabled = host.environment === 'standalone';
    updateHistoryToolbar(null);
    updateHistoryRail(null);
    updateFileNavigationState(null, false);
    updateDirectoryReturnToolbar(false);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.multiWay);
    setStatus('', false);
    setTextContent('file-info', `Comparing ${panels.length} file${panels.length === 1 ? '' : 's'}`);

    renderMultiDiffShell(panels);
    suppressEditorEvents = true;
    multiEditors = panels.map((panel, index) => {
        const editor = createEditor(getElement(`multi-pane-${index}-content`), MODE_MULTI_WAY, panel.id);
        editor.updateOptions({ readOnly: panel.editable === false });
        editor.setValue(panel.content);
        return editor;
    });
    suppressEditorEvents = false;
    multiDecorationIds = multiEditors.map(() => []);
    updateMultiActivePairModel(false);
    resetMultiScrollPositions();
    layoutEditors();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    currentDiffModel = null;
    activeDiffIndex = -1;
    setCurrentDiffModel({ blocks: [], rows: [] });
    historyMode = false;
    directoryEntries = [];
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(null);
    updateHistoryRail(null);
    updateFileNavigationState(null, false);
    updateDirectoryReturnToolbar(false);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.threeWay);
    setTextContent('file-info', `Three-way merge for ${message.base.name}, ${message.left.name}, and ${message.right.name}`);
    setTextContent('base-header', message.base.name);
    setTextContent('left-header', message.left.name);
    setTextContent('right-header', message.right.name);
    setTextContent('result-header', message.result.name);
    setStatus(
        message.meta.isExperimental
            ? `Experimental merge view. ${message.meta.conflictCount} conflict(s) need review.`
            : '',
        message.meta.isExperimental
    );

    renderPlainLines(getElement('base-content'), message.base.lines);
    renderPlainLines(getElement('left-content'), message.left.lines);
    renderPlainLines(getElement('right-content'), message.right.lines);
    renderResultLines(getElement('result-content'), message.result.lines);

    resetScrollPositions();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function ensureTwoWayEditors() {
    if (leftEditor && rightEditor) {
        return;
    }

    leftEditor = createEditor(getElement('file1-content'), MODE_TWO_WAY, 'left');
    rightEditor = createEditor(getElement('file2-content'), MODE_TWO_WAY, 'right');
    updateActivePaneHeader();
}

function createEditor(container, editorMode, side = null) {
    container.innerHTML = '<div class="editor-root"></div>';
    container.classList.add('editor-host');

    const editor = monacoInstance.editor.create(container.firstElementChild, {
        value: '',
        language: 'plaintext',
        theme: 'vs',
        automaticLayout: true,
        minimap: { enabled: false },
        glyphMargin: false,
        folding: false,
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 8,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderWhitespace: 'selection',
        overviewRulerLanes: 0,
        scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });

    editor.onDidChangeModelContent(() => {
        if (suppressEditorEvents) {
            return;
        }

        if (editorMode === MODE_TWO_WAY) {
            if (!isSideEditable(side)) {
                return;
            }

            scheduleRecompute();
            connectorController.scheduleDrawConnections();
            return;
        }

        if (editorMode === MODE_MULTI_WAY && side) {
            recomputeMultiDiffState();
            host.postMessage({
                type: 'multiUpdatePanelContent',
                panelId: side,
                content: editor.getValue().replace(/\r\n/g, '\n')
            });
            connectorController.scheduleDrawConnections();
        }
    });

    editor.onDidScrollChange(() => {
        if (suppressEditorEvents) {
            connectorController.scheduleDrawConnections();
            return;
        }

        if (editorMode === MODE_MULTI_WAY) {
            synchronizeMultiScroll(editor);
        } else {
            synchronizeEditorScroll(editor);
        }
        connectorController.scheduleDrawConnections();
    });

    editor.onDidContentSizeChange(() => {
        connectorController.scheduleDrawConnections();
    });

    editor.onDidFocusEditorText(() => {
        if (editorMode !== MODE_TWO_WAY || !side) {
            return;
        }

        setActivePane(side, false);
    });

    registerEditorKeybindings(editor, editorMode);

    return editor;
}

function disposeTwoWayEditors() {
    if (leftEditor) {
        leftEditor.dispose();
        leftEditor = undefined;
        leftDecorationIds = [];
    }

    if (rightEditor) {
        rightEditor.dispose();
        rightEditor = undefined;
        rightDecorationIds = [];
    }

    getElement('file1-content').classList.remove('editor-host');
    getElement('file2-content').classList.remove('editor-host');
    updateActivePaneHeader();
}

function disposeMultiEditors(resetState = true) {
    multiEditors.forEach((editor) => editor.dispose());
    multiEditors = [];
    multiDecorationIds = [];
    multiDiffPairs = [];
    multiPanelChangeIndices = new Map();
    if (resetState) {
        multiPanels = [];
        activeMultiPanelId = null;
        activeMultiPairIndex = null;
        multiPanelMutationEnabled = false;
    }
    const container = getElement(VIEW_IDS.multiWay);
    if (container) {
        container.innerHTML = '';
        container.style.width = '';
        container.style.minWidth = '';
    }
}

function renderMultiDiffShell(panels) {
    const columns = [];
    const children = [];
    let totalWidth = 0;

    panels.forEach((panel, index) => {
        columns.push(`${MULTI_PANEL_WIDTH}px`);
        totalWidth += MULTI_PANEL_WIDTH;
        children.push(
            `<div class="multi-pane" data-index="${index}" data-panel-id="${escapeAttr(panel.id)}">`
            + `<div class="multi-pane-header" data-panel-id="${escapeAttr(panel.id)}">`
            + `<div class="multi-pane-header-top">`
            + `<span class="multi-pane-title-wrap">`
            + `<span class="multi-pane-title">${escapeHtml(panel.label)}</span>`
            + `<span class="multi-pane-dirty${panel.dirty ? ' is-visible' : ''}" aria-hidden="true" title="Unsaved changes">•</span>`
            + `</span>`
            + `<span class="multi-pane-actions${multiPanelMutationEnabled ? '' : ' hidden'}">`
            + `<button class="multi-pane-action" type="button" data-multi-add-side="left" data-panel-id="${escapeAttr(panel.id)}" title="Add panel to the left" aria-label="Add panel to the left">+</button>`
            + `<button class="multi-pane-action multi-pane-action-danger" type="button" data-multi-remove-panel="${escapeAttr(panel.id)}" title="Remove panel" aria-label="Remove panel">×</button>`
            + `<button class="multi-pane-action" type="button" data-multi-add-side="right" data-panel-id="${escapeAttr(panel.id)}" title="Add panel to the right" aria-label="Add panel to the right">+</button>`
            + `</span>`
            + `</div>`
            + `<div class="multi-pane-header-controls">`
            + `<button class="multi-pane-copy" type="button" data-multi-panel-copy="right-to-left" data-panel-id="${escapeAttr(panel.id)}" title="Copy current change into the left neighbor" aria-label="Copy current change into the left neighbor">`
            + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H9"></path><path d="M13 8l-4 4 4 4"></path><path d="M5 5v14"></path></svg>`
            + `</button>`
            + `<span class="multi-pane-position" data-multi-panel-position="${escapeAttr(panel.id)}">0 / 0</span>`
            + `<button class="multi-pane-copy" type="button" data-multi-panel-copy="left-to-right" data-panel-id="${escapeAttr(panel.id)}" title="Copy current change into the right neighbor" aria-label="Copy current change into the right neighbor">`
            + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h10"></path><path d="M11 8l4 4-4 4"></path><path d="M19 5v14"></path></svg>`
            + `</button>`
            + `</div>`
            + `</div>`
            + `<div id="multi-pane-${index}-content" class="multi-pane-content"></div>`
            + '</div>'
        );

        if (index < panels.length - 1) {
            columns.push(`${MULTI_GUTTER_WIDTH}px`);
            totalWidth += MULTI_GUTTER_WIDTH;
            children.push(
                `<div class="multi-gutter" data-pair-index="${index}">`
                + `<div class="multi-gutter-header"><span class="multi-gutter-title">${escapeHtml(panel.label)}:${escapeHtml(panels[index + 1].label)}</span></div>`
                + '</div>'
            );
        }
    });

    const container = getElement(VIEW_IDS.multiWay);
    const trackWidth = Math.max(totalWidth, container.parentElement?.clientWidth || 0);
    container.innerHTML = `<div class="multi-view-track" style="grid-template-columns:${columns.join(' ')};width:${trackWidth}px;">${children.join('')}</div>`;
}

function recomputeMultiDiffState() {
    if (currentMode !== MODE_MULTI_WAY || multiEditors.length !== multiPanels.length) {
        return;
    }

    const nextPanels = multiPanels.map((panel, index) => ({
        ...panel,
        content: multiEditors[index]?.getValue().replace(/\r\n/g, '\n') ?? panel.content
    }));

    multiPanels = nextPanels;
    multiDiffPairs = nextPanels.slice(0, -1).map((panel, index) => ({
        leftIndex: index,
        rightIndex: index + 1,
        diffModel: buildTwoWayDiffModel(panel.content, nextPanels[index + 1].content)
    }));
    activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, activeMultiPairIndex, activeMultiPanelId, multiPanels);
    updateMultiActivePairModel(false, activeMultiPairIndex);
    updateActiveMultiShellState();
    connectorController.scheduleDrawConnections();
}

function resolveActiveMultiPanelId(panels, nextActivePanelId) {
    if (nextActivePanelId && panels.some((panel) => panel.id === nextActivePanelId)) {
        return nextActivePanelId;
    }

    return panels[0]?.id ?? null;
}

function resolveActiveMultiPairIndex(pairs, nextActivePairIndex, nextActivePanelId, panels) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
        return null;
    }

    if (Number.isInteger(nextActivePairIndex) && nextActivePairIndex >= 0 && nextActivePairIndex < pairs.length) {
        return nextActivePairIndex;
    }

    const panelIndex = panels.findIndex((panel) => panel.id === nextActivePanelId);
    if (panelIndex < 0) {
        return 0;
    }

    return Math.max(0, Math.min(panelIndex, pairs.length - 1));
}

function updateActiveMultiShellState() {
    const container = getElement(VIEW_IDS.multiWay);
    container.querySelectorAll('.multi-pane').forEach((pane) => {
        pane.classList.toggle('is-active-pane', pane.getAttribute('data-panel-id') === activeMultiPanelId);
    });
    container.querySelectorAll('.multi-gutter').forEach((gutter) => {
        const pairIndex = Number.parseInt(gutter.getAttribute('data-pair-index') || '', 10);
        gutter.classList.toggle('is-active-pair', Number.isInteger(pairIndex) && pairIndex === activeMultiPairIndex);
    });
    container.querySelectorAll('[data-multi-remove-panel]').forEach((button) => {
        button.disabled = multiPanels.length <= 1;
    });
    container.querySelectorAll('[data-multi-panel-position]').forEach((element) => {
        const panelId = element.getAttribute('data-multi-panel-position') || '';
        const panelChanges = getMultiPanelChanges(panelId);
        const panelChangeIndex = getMultiPanelChangeIndex(panelId, panelChanges);
        element.textContent = panelChanges.length > 0 ? `${panelChangeIndex + 1} / ${panelChanges.length}` : '0 / 0';
    });
    container.querySelectorAll('[data-multi-panel-copy]').forEach((button) => {
        const panelId = button.getAttribute('data-panel-id') || '';
        const direction = button.getAttribute('data-multi-panel-copy') || '';
        button.disabled = !canCopyFromPanel(panelId, direction);
    });
}

function updateEditorValues(leftContent, rightContent) {
    const leftModel = leftEditor.getModel();
    const rightModel = rightEditor.getModel();
    suppressEditorEvents = true;

    if (leftEditor.getValue() !== leftContent && leftModel) {
        leftModel.setValue(leftContent);
    }

    if (rightEditor.getValue() !== rightContent && rightModel) {
        rightModel.setValue(rightContent);
    }

    suppressEditorEvents = false;
}

function updateTwoWayEditorOptions() {
    leftEditor.updateOptions({ readOnly: !isSideEditable('left') });
    rightEditor.updateOptions({ readOnly: !isSideEditable('right') });
}

function normalizeEditableSides(nextEditableSides, isHistoryMode) {
    if (nextEditableSides && typeof nextEditableSides === 'object') {
        return {
            left: Boolean(nextEditableSides.left),
            right: Boolean(nextEditableSides.right)
        };
    }

    return {
        left: !isHistoryMode,
        right: !isHistoryMode
    };
}

function isSideEditable(side) {
    if (side === 'left') {
        return hostEditableSides.left && !userReadOnly;
    }

    if (side === 'right') {
        return hostEditableSides.right && !userReadOnly;
    }

    return false;
}

function hasHostEditableSide() {
    return hostEditableSides.left || hostEditableSides.right;
}

function setCurrentDiffModel(diffModel) {
    currentDiffModel = diffModel;
    diffBlocks = diffModel.blocks || [];
    currentDiffRows = diffModel.rows || [];
    scrollMaps = currentDiffRows.length === 0
        ? null
        : {
            left: buildScrollMaps(currentDiffRows, 'left'),
            right: buildScrollMaps(currentDiffRows, 'right')
        };
}

function applyDiffDecorations(diffModel) {
    const leftDecorations = [];
    const rightDecorations = [];

    for (const block of diffModel.blocks || []) {
        if (block.kind === 'replace') {
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
        } else if (block.kind === 'delete') {
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
            addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, rightEditor.getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
        } else if (block.kind === 'insert') {
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
            addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, leftEditor.getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
        }
    }

    const activeBlock = diffBlocks[activeDiffIndex];
    if (activeBlock) {
        addActiveBlockDecorations(leftDecorations, activeBlock.leftStart, activeBlock.leftEnd, leftEditor.getModel()?.getLineCount() ?? 0);
        addActiveBlockDecorations(rightDecorations, activeBlock.rightStart, activeBlock.rightEnd, rightEditor.getModel()?.getLineCount() ?? 0);
    }

    addInlineDecorations(leftDecorations, diffModel.leftLines || [], 'removed', 'bygone-inline-blue');
    addInlineDecorations(rightDecorations, diffModel.rightLines || [], 'added', 'bygone-inline-blue');

    leftDecorationIds = leftEditor.deltaDecorations(leftDecorationIds, leftDecorations);
    rightDecorationIds = rightEditor.deltaDecorations(rightDecorationIds, rightDecorations);
}

function addActiveBlockDecorations(target, start, end, targetLineCount) {
    if (start === end) {
        addCollapsedBoundaryDecoration(target, start, targetLineCount, 'bygone-active-diff');
        return;
    }

    addLineDecorations(target, start, end, 'bygone-active-diff');
    addBlockEdgeDecorations(target, start, end, 'bygone-active-diff');
}

function applyMultiDiffDecorations(pairs) {
    const decorations = multiEditors.map(() => []);

    (pairs || []).forEach((pair, pairIndex) => {
        const leftDecorations = decorations[pair.leftIndex];
        const rightDecorations = decorations[pair.rightIndex];
        const diffModel = pair.diffModel;

        if (!leftDecorations || !rightDecorations || !diffModel) {
            return;
        }

        for (const block of diffModel.blocks || []) {
            if (block.kind === 'replace') {
                addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
                addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
                addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
                addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
                addAdjacentEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'right', 'bygone-paired-edge');
                addAdjacentEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'left', 'bygone-paired-edge');
            } else if (block.kind === 'delete') {
                addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
                addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
                addAdjacentEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'right', 'bygone-one-sided-edge');
                addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, multiEditors[pair.rightIndex].getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
            } else if (block.kind === 'insert') {
                addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
                addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
                addAdjacentEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'left', 'bygone-one-sided-edge');
                addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, multiEditors[pair.leftIndex].getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
            }
        }

        addInlineDecorations(leftDecorations, diffModel.leftLines || [], 'removed', 'bygone-inline-blue');
        addInlineDecorations(rightDecorations, diffModel.rightLines || [], 'added', 'bygone-inline-blue');

        if (pairIndex === activeMultiPairIndex) {
            const activeBlock = diffModel.blocks?.[activeDiffIndex];
            if (activeBlock) {
                addActiveBlockDecorations(leftDecorations, activeBlock.leftStart, activeBlock.leftEnd, multiEditors[pair.leftIndex].getModel()?.getLineCount() ?? 0);
                addActiveBlockDecorations(rightDecorations, activeBlock.rightStart, activeBlock.rightEnd, multiEditors[pair.rightIndex].getModel()?.getLineCount() ?? 0);
            }
        }
    });

    multiDecorationIds = multiEditors.map((editor, index) => (
        editor.deltaDecorations(multiDecorationIds[index] || [], decorations[index])
    ));
}

function addLineDecorations(target, start, end, className) {
    for (let index = start; index < end; index++) {
        target.push({
            range: new monacoInstance.Range(index + 1, 1, index + 1, 1),
            options: {
                isWholeLine: true,
                wholeLineClassName: `${className}-whole`,
                className,
                linesDecorationsClassName: `${className}-gutter`,
                marginClassName: `${className}-gutter`
            }
        });
    }
}

function addBlockEdgeDecorations(target, start, end, className) {
    if (start >= end) {
        return;
    }

    const firstLine = start + 1;
    const lastLine = end;

    target.push({
        range: new monacoInstance.Range(firstLine, 1, firstLine, 1),
        options: {
            isWholeLine: true,
            className: `${className}-start`
        }
    });

    target.push({
        range: new monacoInstance.Range(lastLine, 1, lastLine, 1),
        options: {
            isWholeLine: true,
            className: `${className}-end`
        }
    });
}

function addAdjacentEdgeDecorations(target, start, end, side, className) {
    for (let index = start; index < end; index++) {
        target.push({
            range: new monacoInstance.Range(index + 1, 1, index + 1, 1),
            options: {
                isWholeLine: true,
                className: `${className}-${side}`
            }
        });
    }
}

function addCollapsedBoundaryDecoration(target, anchorIndex, targetLineCount, className) {
    if (targetLineCount <= 0) {
        return;
    }

    if (anchorIndex <= 0) {
        target.push({
            range: new monacoInstance.Range(1, 1, 1, 1),
            options: {
                isWholeLine: true,
                className: `${className}-top`
            }
        });
        return;
    }

    if (anchorIndex >= targetLineCount) {
        target.push({
            range: new monacoInstance.Range(targetLineCount, 1, targetLineCount, 1),
            options: {
                isWholeLine: true,
                className: `${className}-bottom`
            }
        });
        return;
    }

    target.push({
        range: new monacoInstance.Range(anchorIndex + 1, 1, anchorIndex + 1, 1),
        options: {
            isWholeLine: true,
            className: `${className}-top`
        }
    });
}

function addInlineDecorations(target, lines, expectedKind, className) {
    for (const line of lines) {
        if (!line.segments) {
            continue;
        }

        let column = 1;
        for (const segment of line.segments) {
            const segmentLength = segment.text.length;
            const startColumn = column;
            const endColumn = column + Math.max(segmentLength, 1);

            if (segment.emphasis && segment.kind === expectedKind && segmentLength > 0) {
                target.push({
                    range: new monacoInstance.Range(line.lineNumber, startColumn, line.lineNumber, endColumn),
                    options: {
                        inlineClassName: className
                    }
                });
            }

            column += segmentLength;
        }
    }
}

function synchronizeEditorScroll(sourceEditor) {
    if (!leftEditor || !rightEditor) {
        return;
    }

    const targetEditor = sourceEditor === leftEditor ? rightEditor : leftEditor;
    const horizontalRatio = getScrollRatio(sourceEditor.getScrollLeft(), sourceEditor.getScrollWidth() - sourceEditor.getLayoutInfo().contentWidth);
    const targetScrollTop = mapScrollTopBetweenEditors(sourceEditor, targetEditor);

    suppressEditorEvents = true;
    targetEditor.setScrollTop(targetScrollTop);
    targetEditor.setScrollLeft(horizontalRatio * Math.max(0, targetEditor.getScrollWidth() - targetEditor.getLayoutInfo().contentWidth));
    suppressEditorEvents = false;
}

function synchronizeMultiScroll(sourceEditor) {
    if (multiEditors.length < 2) {
        return;
    }

    const horizontalRatio = getScrollRatio(sourceEditor.getScrollLeft(), sourceEditor.getScrollWidth() - sourceEditor.getLayoutInfo().contentWidth);
    const verticalRatio = getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height);

    suppressEditorEvents = true;
    for (const editor of multiEditors) {
        if (editor === sourceEditor) {
            continue;
        }

        editor.setScrollTop(verticalRatio * Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height));
        editor.setScrollLeft(horizontalRatio * Math.max(0, editor.getScrollWidth() - editor.getLayoutInfo().contentWidth));
    }
    suppressEditorEvents = false;
}

function initializeHistoryToolbar() {
    getElement('history-back').addEventListener('click', () => {
        host.postMessage({ type: 'historyBack' });
    });
    getElement('history-forward').addEventListener('click', () => {
        host.postMessage({ type: 'historyForward' });
    });
    getElement('history-toggle-staged').addEventListener('click', (event) => {
        const button = event.currentTarget;
        const nextIncludeStaged = button.getAttribute('aria-pressed') !== 'true';
        host.postMessage({
            type: 'historyToggleStaged',
            includeStaged: nextIncludeStaged
        });
    });
    getElement('history-toggle-skip-unchanged').addEventListener('click', (event) => {
        const button = event.currentTarget;
        const nextSkipUnchanged = button.getAttribute('aria-pressed') !== 'true';
        host.postMessage({
            type: 'historyToggleSkipUnchanged',
            skipUnchanged: nextSkipUnchanged
        });
    });
}

function initializeDirectoryTreeToolbar() {
    getElement('directory-expand-all').addEventListener('click', () => {
        expandAllDirectories(getElement('dir-rows'));
    });
    getElement('directory-collapse-all').addEventListener('click', () => {
        collapseAllDirectories(getElement('dir-rows'), directoryEntries);
    });
    getElement('directory-collapse-unchanged').addEventListener('click', () => {
        collapseUnchangedDirectories(getElement('dir-rows'), directoryEntries);
    });
}

function initializeHistoryRail() {
    const rail = getElement('history-rail');

    rail.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-rail-tab], [data-rail-item]') : null;
        if (!target) {
            return;
        }

        if (target.hasAttribute('data-rail-item')) {
            const tabId = target.getAttribute('data-rail-tab');
            const itemIndex = Number.parseInt(target.getAttribute('data-rail-index') || '', 10);
            const item = getHistoryRailItems(tabId).find((candidate) => candidate.index === itemIndex || candidate.relativePath === target.getAttribute('data-rail-path'));
            if (!item) {
                return;
            }

            if (item.kind === 'history-entry' && Number.isInteger(item.index)) {
                host.postMessage({ type: 'selectHistoryEntry', index: item.index });
                return;
            }

            if (item.kind === 'directory-entry' && typeof item.relativePath === 'string') {
                host.postMessage({ type: 'openDirectoryEntry', relativePath: item.relativePath });
            }
            return;
        }

        if (target.hasAttribute('data-rail-tab')) {
            const tabId = target.getAttribute('data-rail-tab');
            if (tabId && historyRailState?.tabs?.some((tab) => tab.id === tabId)) {
                activeHistoryRailTabId = tabId;
                renderHistoryRail();
            }
        }
    });
}

function initializeDirectoryReturnToolbar() {
    getElement('back-to-directory').addEventListener('click', () => returnToDirectory());
}

function initializeMultiDiffInteractions() {
    const container = getElement(VIEW_IDS.multiWay);

    container.addEventListener('scroll', () => {
        if (currentMode === MODE_MULTI_WAY) {
            connectorController.scheduleDrawConnections();
        }
    });

    container.addEventListener('wheel', (event) => {
        if (currentMode !== MODE_MULTI_WAY) {
            return;
        }

        const deltaX = Math.abs(event.deltaX) > 0 ? event.deltaX : (event.shiftKey ? event.deltaY : 0);
        if (deltaX === 0) {
            return;
        }

        const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
        if (maxScrollLeft <= 0) {
            return;
        }

        const nextScrollLeft = clamp(container.scrollLeft + deltaX, 0, maxScrollLeft);
        if (nextScrollLeft === container.scrollLeft) {
            return;
        }

        container.scrollLeft = nextScrollLeft;
        connectorController.scheduleDrawConnections();
        event.preventDefault();
    }, { passive: false, capture: true });

    container.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-panel-id], [data-pair-index], [data-multi-add-side], [data-multi-remove-panel], [data-multi-panel-copy]') : null;
        if (!target) {
            return;
        }

        const panelCopyDirection = target.getAttribute('data-multi-panel-copy');
        const panelCopyId = target.getAttribute('data-panel-id');
        if (panelCopyDirection && panelCopyId) {
            event.stopPropagation();
            copyMultiPanelChange(panelCopyId, panelCopyDirection);
            return;
        }

        const addSide = target.getAttribute('data-multi-add-side');
        const addPanelId = target.getAttribute('data-panel-id');
        if (addSide && addPanelId) {
            event.stopPropagation();
            if (multiPanelMutationEnabled) {
                host.postMessage({
                    type: 'multiAddPanel',
                    anchorPanelId: addPanelId,
                    side: addSide
                });
            }
            return;
        }

        const removePanelId = target.getAttribute('data-multi-remove-panel');
        if (removePanelId) {
            event.stopPropagation();
            if (multiPanelMutationEnabled) {
                host.postMessage({
                    type: 'multiRemovePanel',
                    panelId: removePanelId
                });
            }
            return;
        }

        const pairIndex = Number.parseInt(target.getAttribute('data-pair-index') || '', 10);
        if (Number.isInteger(pairIndex)) {
            setActiveMultiPair(pairIndex, true);
            return;
        }

        const panelId = target.getAttribute('data-panel-id');
        if (panelId) {
            setActiveMultiPanel(panelId, true);
        }
    });
}

function initializeEditModeToolbar() {
    getElement('file1-header')?.addEventListener('click', () => setActivePane('left', true));
    getElement('file2-header')?.addEventListener('click', () => setActivePane('right', true));
    getElement('toggle-readonly').addEventListener('click', () => {
        if (!hasHostEditableSide()) {
            return;
        }

        userReadOnly = !userReadOnly;
        updateTwoWayEditorOptions();
        updateEditModeToolbar();
        updateChangeToolbarState();
    });
}

function setActivePane(side, focusEditor) {
    if (side !== 'left' && side !== 'right') {
        return;
    }

    activePaneSide = side;
    updateActivePaneHeader();

    if (!focusEditor || currentMode !== MODE_TWO_WAY) {
        return;
    }

    const editor = side === 'left' ? leftEditor : rightEditor;
    editor?.focus();
}

function updateActivePaneHeader() {
    const leftHeader = getElement('file1-header');
    const rightHeader = getElement('file2-header');
    if (!leftHeader || !rightHeader) {
        return;
    }

    const isTwoWay = currentMode === MODE_TWO_WAY;
    leftHeader.classList.toggle('is-active-pane', isTwoWay && activePaneSide === 'left');
    rightHeader.classList.toggle('is-active-pane', isTwoWay && activePaneSide === 'right');
}

function setActiveMultiPanel(panelId, notifyHost) {
    if (currentMode !== MODE_MULTI_WAY) {
        return;
    }

    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
        return;
    }

    activeMultiPanelId = panelId;
    if (multiDiffPairs.length > 0) {
        const currentPair = getActiveMultiPair();
        const pairStillFits = currentPair
            && (currentPair.leftIndex === panelIndex || currentPair.rightIndex === panelIndex);
        if (!pairStillFits) {
            const preferredPairIndex = panelIndex === 0 ? 0 : Math.min(panelIndex - 1, multiDiffPairs.length - 1);
            activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, preferredPairIndex, activeMultiPanelId, multiPanels);
        }
    } else {
        activeMultiPairIndex = null;
    }
    updateMultiActivePairModel(false);
    updateActiveMultiShellState();

    if (notifyHost) {
        host.postMessage({
            type: 'multiSetActivePanel',
            panelId
        });
    }
}

function setActiveMultiPair(pairIndex, notifyHost) {
    if (currentMode !== MODE_MULTI_WAY || pairIndex < 0 || pairIndex >= multiDiffPairs.length) {
        return;
    }

    const pair = multiDiffPairs[pairIndex];
    if (!pair) {
        return;
    }

    const activePanelIndex = multiPanels.findIndex((panel) => panel.id === activeMultiPanelId);
    if (activePanelIndex < 0 || (pair.leftIndex !== activePanelIndex && pair.rightIndex !== activePanelIndex)) {
        activeMultiPanelId = multiPanels[pair.leftIndex]?.id ?? activeMultiPanelId;
    }
    activeMultiPairIndex = pairIndex;
    updateMultiActivePairModel(false, pairIndex);
    updateActiveMultiShellState();

    if (notifyHost) {
        host.postMessage({
            type: 'multiSetActivePair',
            pairIndex
        });
    }
}

function getActiveMultiPanelIndex() {
    return multiPanels.findIndex((panel) => panel.id === activeMultiPanelId);
}

function getAdjacentMultiPairs(panelIndex = getActiveMultiPanelIndex()) {
    if (panelIndex < 0) {
        return [];
    }

    return multiDiffPairs.flatMap((pair, pairIndex) => {
        if (pair.leftIndex === panelIndex) {
            return [{ pair, pairIndex, side: 'left' }];
        }

        if (pair.rightIndex === panelIndex) {
            return [{ pair, pairIndex, side: 'right' }];
        }

        return [];
    });
}

function getMultiPanelChanges(panelId = activeMultiPanelId) {
    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    const adjacentPairs = getAdjacentMultiPairs(panelIndex);
    const mergedChanges = new Map();

    adjacentPairs.forEach(({ pair, pairIndex, side }) => {
        (pair.diffModel?.blocks || []).forEach((block, blockIndex) => {
            const start = side === 'left' ? block.leftStart : block.rightStart;
            const end = side === 'left' ? block.leftEnd : block.rightEnd;
            const normalizedStart = Math.max(0, start);
            const normalizedEnd = Math.max(normalizedStart, end);
            const key = `${normalizedStart}:${normalizedEnd}`;
            const existing = mergedChanges.get(key);
            const nextChange = {
                key,
                start: normalizedStart,
                end: normalizedEnd,
                pairIndex,
                blockIndex
            };

            if (!existing) {
                mergedChanges.set(key, nextChange);
                return;
            }

            if (pairIndex === activeMultiPairIndex && existing.pairIndex !== activeMultiPairIndex) {
                mergedChanges.set(key, nextChange);
            }
        });
    });

    return Array.from(mergedChanges.values()).sort((left, right) => {
        if (left.start !== right.start) {
            return left.start - right.start;
        }

        if (left.end !== right.end) {
            return left.end - right.end;
        }

        return left.pairIndex - right.pairIndex;
    });
}

function getMultiPanelChangeIndex(panelId = activeMultiPanelId, panelChanges = getMultiPanelChanges(panelId)) {
    if (panelChanges.length === 0) {
        return -1;
    }

    const currentIndex = multiPanelChangeIndices.get(panelId);
    if (!Number.isInteger(currentIndex)) {
        return 0;
    }

    return clamp(currentIndex, 0, panelChanges.length - 1);
}

function setMultiPanelChangeIndex(panelId, index) {
    if (!panelId) {
        return;
    }

    multiPanelChangeIndices.set(panelId, index);
}

function getActiveMultiPanelChange() {
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);
    const panelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
    if (panelChangeIndex < 0) {
        return null;
    }

    return panelChanges[panelChangeIndex];
}

function updateMultiActivePairModel(shouldReveal, preferredPairIndex = null) {
    const previousChange = getActiveMultiPanelChange();
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);

    if (panelChanges.length === 0) {
        const activePair = getActiveMultiPair();
        if (!activePair) {
            setMultiPanelChangeIndex(activeMultiPanelId, -1);
            activeMultiPairIndex = null;
            setCurrentDiffModel({ blocks: [], rows: [] });
            setActiveDiffIndex(-1, false);
            updateActiveMultiShellState();
            return;
        }

        setMultiPanelChangeIndex(activeMultiPanelId, -1);
        setCurrentDiffModel(activePair.diffModel);
        setActiveDiffIndex(-1, false);
        applyMultiDiffDecorations(multiDiffPairs);
        updateActiveMultiShellState();
        connectorController.scheduleDrawConnections();
        return;
    }

    let nextChangeIndex = -1;
    if (previousChange) {
        nextChangeIndex = panelChanges.findIndex((change) => change.key === previousChange.key);
    }

    if (nextChangeIndex < 0 && Number.isInteger(preferredPairIndex)) {
        nextChangeIndex = panelChanges.findIndex((change) => change.pairIndex === preferredPairIndex);
    }

    const currentPanelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
    if (nextChangeIndex < 0 && Number.isInteger(currentPanelChangeIndex) && currentPanelChangeIndex >= 0) {
        nextChangeIndex = clamp(currentPanelChangeIndex, 0, panelChanges.length - 1);
    }

    if (nextChangeIndex < 0) {
        nextChangeIndex = 0;
    }

    const activeChange = panelChanges[nextChangeIndex];
    const activePair = activeChange ? multiDiffPairs[activeChange.pairIndex] : null;
    if (!activePair) {
        setMultiPanelChangeIndex(activeMultiPanelId, -1);
        setCurrentDiffModel({ blocks: [], rows: [] });
        setActiveDiffIndex(-1, false);
        updateActiveMultiShellState();
        return;
    }

    setMultiPanelChangeIndex(activeMultiPanelId, nextChangeIndex);
    activeMultiPairIndex = activeChange.pairIndex;
    setCurrentDiffModel(activePair.diffModel);
    setActiveDiffIndex(activeChange.blockIndex, false);

    applyMultiDiffDecorations(multiDiffPairs);
    updateActiveMultiShellState();

    if (shouldReveal) {
        revealActiveDiff(true);
    } else {
        connectorController.scheduleDrawConnections();
    }
}

function getActiveMultiPair() {
    if (!Number.isInteger(activeMultiPairIndex) || activeMultiPairIndex < 0 || activeMultiPairIndex >= multiDiffPairs.length) {
        return null;
    }

    return multiDiffPairs[activeMultiPairIndex];
}

function initializeChangeToolbar() {
    getElement('previous-file').addEventListener('click', () => navigateFile('previous'));
    getElement('next-file').addEventListener('click', () => navigateFile('next'));
    getElement('previous-change').addEventListener('click', () => navigateDiff(-1));
    getElement('next-change').addEventListener('click', () => navigateDiff(1));
    getElement('copy-left-to-right').addEventListener('click', () => copyCurrentChange('left-to-right'));
    getElement('copy-right-to-left').addEventListener('click', () => copyCurrentChange('right-to-left'));

    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || (currentMode !== MODE_TWO_WAY && currentMode !== MODE_MULTI_WAY)) {
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            navigateDiff(-1);
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            navigateDiff(1);
            return;
        }

        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's' && currentMode === MODE_MULTI_WAY) {
            event.preventDefault();
            host.postMessage({
                type: 'multiSavePanel',
                panelId: activeMultiPanelId
            });
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === '[' && !getElement('directory-return-toolbar').hidden) {
            event.preventDefault();
            returnToDirectory();
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowRight') {
            event.preventDefault();
            copyCurrentChange('left-to-right');
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            copyCurrentChange('right-to-left');
        }
    });
}

function navigateFile(direction) {
    if (currentMode === 'directory') {
        navigateDirectoryEntry(direction);
        return;
    }

    if (currentMode === MODE_MULTI_WAY) {
        const currentIndex = multiPanels.findIndex((panel) => panel.id === activeMultiPanelId);
        if (currentIndex < 0) {
            return;
        }

        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const nextPanel = multiPanels[nextIndex];
        if (!nextPanel) {
            return;
        }

        setActiveMultiPanel(nextPanel.id, true);
        const pairIndex = direction === 'previous'
            ? Math.max(0, nextIndex)
            : Math.max(0, nextIndex - 1);
        setActiveMultiPair(pairIndex, true);
        return;
    }

    if ((direction === 'previous' && !currentFileNavigation.canGoPrevious)
        || (direction === 'next' && !currentFileNavigation.canGoNext)) {
        return;
    }

    host.postMessage({
        type: 'navigateFile',
        direction
    });
}

function returnToDirectory() {
    host.postMessage({ type: 'returnToDirectory' });
}

function updateDirectoryReturnToolbar(canReturnToDirectory) {
    getElement('directory-return-toolbar').hidden = !canReturnToDirectory;
}

function updateEditModeToolbar() {
    const toolbar = getElement('edit-mode-toolbar');
    const button = getElement('toggle-readonly');
    const hasEditableSide = currentMode === MODE_TWO_WAY && hasHostEditableSide();

    toolbar.hidden = !hasEditableSide;
    button.classList.toggle('is-readonly', userReadOnly);
    button.textContent = userReadOnly ? 'Read-only' : 'Editing On';
    button.title = userReadOnly
        ? 'Allow editing for writable panes'
        : 'Freeze writable panes';
}

function registerEditorKeybindings(editor, editorMode) {
    if (editorMode !== MODE_TWO_WAY && editorMode !== MODE_MULTI_WAY) {
        return;
    }

    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.UpArrow, () => navigateDiff(-1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.DownArrow, () => navigateDiff(1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.RightArrow, () => copyCurrentChange('left-to-right'));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.LeftArrow, () => copyCurrentChange('right-to-left'));

    if (editorMode === MODE_MULTI_WAY) {
        editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            host.postMessage({
                type: 'multiSavePanel',
                panelId: activeMultiPanelId
            });
        });
    }
}

function navigateDiff(direction) {
    if (currentMode === MODE_MULTI_WAY) {
        const panelChanges = getMultiPanelChanges(activeMultiPanelId);
        if (panelChanges.length === 0) {
            return;
        }

        const currentPanelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
        const nextIndex = currentPanelChangeIndex < 0
            ? 0
            : (currentPanelChangeIndex + direction + panelChanges.length) % panelChanges.length;

        setActiveMultiPanelChangeIndex(nextIndex, true);
        return;
    }

    if (currentMode !== MODE_TWO_WAY || diffBlocks.length === 0) {
        return;
    }

    const nextIndex = activeDiffIndex < 0
        ? 0
        : (activeDiffIndex + direction + diffBlocks.length) % diffBlocks.length;

    setActiveDiffIndex(nextIndex, true);
}

function setActiveMultiPanelChangeIndex(index, shouldReveal) {
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);
    if (currentMode !== MODE_MULTI_WAY || index < 0 || index >= panelChanges.length) {
        return;
    }

    const nextChange = panelChanges[index];
    const nextPair = multiDiffPairs[nextChange.pairIndex];
    if (!nextPair) {
        return;
    }

    setMultiPanelChangeIndex(activeMultiPanelId, index);
    activeMultiPairIndex = nextChange.pairIndex;
    setCurrentDiffModel(nextPair.diffModel);
    setActiveDiffIndex(nextChange.blockIndex, false);

    updateActiveMultiShellState();
    if (shouldReveal) {
        revealActiveDiff(true);
    }
}

function getActivePanelEditor() {
    const panelIndex = getActiveMultiPanelIndex();
    if (panelIndex < 0) {
        return null;
    }

    return multiEditors[panelIndex] || null;
}

function getMultiPairForDirection(direction) {
    const activePanelIndex = getActiveMultiPanelIndex();
    if (activePanelIndex < 0) {
        return null;
    }

    const targetPanelIndex = direction === 'left-to-right' ? activePanelIndex + 1 : activePanelIndex - 1;
    if (targetPanelIndex < 0 || targetPanelIndex >= multiPanels.length) {
        return null;
    }

    const pairIndex = direction === 'left-to-right' ? activePanelIndex : targetPanelIndex;
    const pair = multiDiffPairs[pairIndex];
    if (!pair) {
        return null;
    }

    return {
        pair,
        pairIndex,
        activePanelIndex,
        targetPanelIndex
    };
}

function getMultiPairProjection(pair, activePanelIndex, activeChange) {
    if (!pair || !activeChange) {
        return null;
    }

    const activeSide = pair.leftIndex === activePanelIndex ? 'left' : (pair.rightIndex === activePanelIndex ? 'right' : null);
    if (!activeSide) {
        return null;
    }

    const targetSide = activeSide === 'left' ? 'right' : 'left';
    const activeStartKey = activeSide === 'left' ? 'leftStart' : 'rightStart';
    const activeEndKey = activeSide === 'left' ? 'leftEnd' : 'rightEnd';
    const targetStartKey = targetSide === 'left' ? 'leftStart' : 'rightStart';
    const targetEndKey = targetSide === 'left' ? 'leftEnd' : 'rightEnd';
    const block = (pair.diffModel?.blocks || []).find((candidate) => (
        candidate[activeStartKey] === activeChange.start && candidate[activeEndKey] === activeChange.end
    ));

    if (block) {
        return {
            activeStart: block[activeStartKey],
            activeEnd: block[activeEndKey],
            targetStart: block[targetStartKey],
            targetEnd: block[targetEndKey]
        };
    }

    return {
        activeStart: activeChange.start,
        activeEnd: activeChange.end,
        targetStart: activeChange.start,
        targetEnd: activeChange.end
    };
}

function canCopyFromPanel(panelId, direction) {
    const panelChanges = getMultiPanelChanges(panelId);
    if (panelChanges.length === 0) {
        return false;
    }

    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
        return false;
    }

    if (direction === 'left-to-right') {
        return panelIndex < multiPanels.length - 1;
    }

    if (direction === 'right-to-left') {
        return panelIndex > 0;
    }

    return false;
}

function copyMultiPanelChange(panelId, direction) {
    if (!canCopyFromPanel(panelId, direction)) {
        return;
    }

    if (panelId !== activeMultiPanelId) {
        setActiveMultiPanel(panelId, true);
    }

    copyCurrentChange(direction);
}

function setActiveDiffIndex(index, shouldReveal) {
    activeDiffIndex = index;
    updateChangeToolbarState();

    if (leftEditor && rightEditor && currentDiffModel) {
        applyDiffDecorations(currentDiffModel);
    } else if (currentMode === MODE_MULTI_WAY) {
        applyMultiDiffDecorations(multiDiffPairs);
    }

    if (shouldReveal) {
        revealActiveDiff(true);
    }
}

function updateChangeToolbarState() {
    const toolbar = getElement('change-toolbar');
    const toolbarCenter = toolbar.querySelector('.change-toolbar-center');
    const toolbarHint = toolbar.parentElement?.querySelector('.change-hint');
    const isCompareMode = currentMode === MODE_TWO_WAY || currentMode === 'directory' || currentMode === MODE_MULTI_WAY || currentMode === 'three-way';
    const hasTwoWayMode = currentMode === MODE_TWO_WAY;
    const hasTwoWayDiffs = hasTwoWayMode && diffBlocks.length > 0;
    const directoryTargets = getNavigableDirectoryEntries();
    const hasDirectoryTargets = currentMode === 'directory' && directoryTargets.length > 0;
    toolbar.hidden = !isCompareMode;

    if (!isCompareMode) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        setTextContent('change-position', '');
        return;
    }

    if (hasDirectoryTargets) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        const currentIndex = getActiveDirectoryEntryIndex(directoryTargets);
        setTextContent('change-position', `${currentIndex + 1} / ${directoryTargets.length}`);
        getElement('copy-left-to-right').hidden = false;
        getElement('copy-right-to-left').hidden = false;
        getElement('previous-change').disabled = true;
        getElement('next-change').disabled = true;
        getElement('previous-file').disabled = currentIndex <= 0;
        getElement('next-file').disabled = currentIndex >= directoryTargets.length - 1;
        getElement('copy-left-to-right').disabled = true;
        getElement('copy-right-to-left').disabled = true;
        updateDirectoryEntrySelection();
        return;
    }

    if (hasTwoWayMode) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        const safeIndex = diffBlocks.length > 0 ? clamp(activeDiffIndex, 0, diffBlocks.length - 1) : -1;
        setTextContent('change-position', diffBlocks.length > 0 ? `${safeIndex + 1} / ${diffBlocks.length}` : '0 / 0');
        getElement('copy-left-to-right').hidden = false;
        getElement('copy-right-to-left').hidden = false;
        getElement('previous-change').disabled = diffBlocks.length === 0;
        getElement('next-change').disabled = diffBlocks.length === 0;
        getElement('previous-file').disabled = !currentFileNavigation.canGoPrevious;
        getElement('next-file').disabled = !currentFileNavigation.canGoNext;
        getElement('copy-left-to-right').disabled = !isSideEditable('right');
        getElement('copy-right-to-left').disabled = !isSideEditable('left');
        return;
    }

    if (currentMode === MODE_MULTI_WAY) {
        const currentPanelIndex = getActiveMultiPanelIndex();
        const panelChanges = getMultiPanelChanges(activeMultiPanelId);
        const panelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
        toolbarCenter.hidden = true;
        if (toolbarHint) {
            toolbarHint.hidden = true;
        }
        setTextContent('change-position', panelChanges.length > 0 ? `${panelChangeIndex + 1} / ${panelChanges.length}` : '0 / 0');
        getElement('copy-left-to-right').hidden = true;
        getElement('copy-right-to-left').hidden = true;
        getElement('previous-change').disabled = panelChanges.length === 0;
        getElement('next-change').disabled = panelChanges.length === 0;
        getElement('previous-file').disabled = currentPanelIndex <= 0;
        getElement('next-file').disabled = currentPanelIndex < 0 || currentPanelIndex >= multiPanels.length - 1;
        getElement('copy-left-to-right').disabled = true;
        getElement('copy-right-to-left').disabled = true;
        updateActiveMultiShellState();
        return;
    }

    toolbarCenter.hidden = false;
    if (toolbarHint) {
        toolbarHint.hidden = false;
    }
    setTextContent('change-position', '—');
    getElement('copy-left-to-right').hidden = false;
    getElement('copy-right-to-left').hidden = false;
    getElement('previous-change').disabled = true;
    getElement('next-change').disabled = true;
    getElement('previous-file').disabled = true;
    getElement('next-file').disabled = true;
    getElement('copy-left-to-right').disabled = true;
    getElement('copy-right-to-left').disabled = true;
}

function getNavigableDirectoryEntries() {
    return directoryEntries.filter((entry) => !entry.isDirectory && entry.status !== 'same');
}

function getDefaultDirectoryEntryPath(entries) {
    return entries.find((entry) => !entry.isDirectory && entry.status !== 'same')?.relativePath ?? null;
}

function getActiveDirectoryEntryIndex(entries = getNavigableDirectoryEntries()) {
    const currentIndex = entries.findIndex((entry) => entry.relativePath === activeDirectoryEntryPath);
    if (currentIndex >= 0) {
        return currentIndex;
    }

    if (entries.length === 0) {
        return -1;
    }

    activeDirectoryEntryPath = entries[0].relativePath;
    return 0;
}

function navigateDirectoryEntry(direction) {
    const entries = getNavigableDirectoryEntries();
    if (entries.length === 0) {
        return;
    }

    const currentIndex = getActiveDirectoryEntryIndex(entries);
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= entries.length) {
        return;
    }

    activeDirectoryEntryPath = entries[nextIndex].relativePath;
    updateChangeToolbarState();
}

function updateDirectoryEntrySelection() {
    const container = getElement('dir-rows');
    container.querySelectorAll('.dir-entry').forEach((row) => {
        row.classList.toggle('is-active-directory-entry', row.dataset.path === activeDirectoryEntryPath);
    });

    if (!activeDirectoryEntryPath) {
        return;
    }

    const activeRow = container.querySelector(`.dir-entry[data-path="${CSS.escape(activeDirectoryEntryPath)}"][data-side-index="0"]`)
        || container.querySelector(`.dir-entry[data-path="${CSS.escape(activeDirectoryEntryPath)}"][data-side-index="1"]`);
    activeRow?.scrollIntoView({ block: 'nearest' });
}

function updateFileNavigationState(fileNavigation, canReturnToDirectory) {
    currentFileNavigation = fileNavigation || {
        canGoPrevious: false,
        canGoNext: false
    };

    if (!canReturnToDirectory && !fileNavigation) {
        currentFileNavigation = {
            canGoPrevious: false,
            canGoNext: false
        };
    }
}

function revealActiveDiff(smooth) {
    if (currentMode === MODE_MULTI_WAY) {
        const activePair = getActiveMultiPair();
        if (!activePair || activeDiffIndex < 0) {
            return;
        }

        const block = diffBlocks[activeDiffIndex];
        if (!block) {
            return;
        }

        const leftMultiEditor = multiEditors[activePair.leftIndex];
        const rightMultiEditor = multiEditors[activePair.rightIndex];
        if (!leftMultiEditor || !rightMultiEditor) {
            return;
        }

        revealBlockSide(leftMultiEditor, block.leftStart, block.leftEnd, smooth);
        revealBlockSide(rightMultiEditor, block.rightStart, block.rightEnd, smooth);
        connectorController.scheduleDrawConnections();
        return;
    }

    if (!leftEditor || !rightEditor || activeDiffIndex < 0) {
        return;
    }

    const block = diffBlocks[activeDiffIndex];
    if (!block) {
        return;
    }

    revealBlockSide(leftEditor, block.leftStart, block.leftEnd, smooth);
    revealBlockSide(rightEditor, block.rightStart, block.rightEnd, smooth);
    connectorController.scheduleDrawConnections();
}

function revealBlockSide(editor, start, end, smooth) {
    const model = editor.getModel();
    const lineCount = model?.getLineCount() ?? 0;
    if (lineCount === 0) {
        return;
    }

    const lineNumber = start === end
        ? clamp(start + 1, 1, lineCount)
        : clamp(start + 1, 1, lineCount);

    editor.revealLineInCenterIfOutsideViewport(
        lineNumber,
        smooth ? monacoInstance.editor.ScrollType.Smooth : monacoInstance.editor.ScrollType.Immediate
    );
}

function copyCurrentChange(direction) {
    if (currentMode === MODE_MULTI_WAY) {
        const activeChange = getActiveMultiPanelChange();
        const pairContext = getMultiPairForDirection(direction);
        const activeEditor = getActivePanelEditor();
        if (!activeChange || !pairContext || !activeEditor) {
            return;
        }

        const targetEditor = multiEditors[pairContext.targetPanelIndex];
        const projection = getMultiPairProjection(pairContext.pair, pairContext.activePanelIndex, activeChange);
        if (!targetEditor || !projection) {
            return;
        }

        const sourceLines = getEditorLines(activeEditor).slice(projection.activeStart, projection.activeEnd);
        replaceEditorLines(targetEditor, projection.targetStart, projection.targetEnd, sourceLines);
        recomputeMultiDiffState();
        return;
    }

    const targetSide = direction === 'left-to-right' ? 'right' : 'left';
    if (currentMode !== MODE_TWO_WAY || !isSideEditable(targetSide) || activeDiffIndex < 0) {
        return;
    }

    const block = diffBlocks[activeDiffIndex];
    if (!block || !leftEditor || !rightEditor) {
        return;
    }

    const sourceEditor = direction === 'left-to-right' ? leftEditor : rightEditor;
    const targetEditor = direction === 'left-to-right' ? rightEditor : leftEditor;
    const sourceStart = direction === 'left-to-right' ? block.leftStart : block.rightStart;
    const sourceEnd = direction === 'left-to-right' ? block.leftEnd : block.rightEnd;
    const targetStart = direction === 'left-to-right' ? block.rightStart : block.leftStart;
    const targetEnd = direction === 'left-to-right' ? block.rightEnd : block.leftEnd;
    const sourceLines = getEditorLines(sourceEditor).slice(sourceStart, sourceEnd);

    replaceEditorLines(targetEditor, targetStart, targetEnd, sourceLines);
    scheduleRecompute();
    connectorController.scheduleDrawConnections();
}

function getEditorLines(editor) {
    const value = editor.getValue().replace(/\r\n/g, '\n');
    if (value.length === 0) {
        return [];
    }

    const lines = value.split('\n');
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function replaceEditorLines(editor, start, end, replacementLines) {
    const model = editor.getModel();
    if (!model) {
        return;
    }

    const lineCount = model.getLineCount();
    const isEmptyModel = lineCount === 1 && model.getValue().length === 0;
    const effectiveLineCount = isEmptyModel ? 0 : lineCount;
    const safeStart = clamp(start, 0, effectiveLineCount);
    const safeEnd = clamp(end, safeStart, effectiveLineCount);
    const replacementText = replacementLines.join('\n');
    let range;
    let text;

    if (safeStart === safeEnd) {
        if (replacementLines.length === 0) {
            return;
        }

        if (isEmptyModel) {
            range = new monacoInstance.Range(1, 1, 1, 1);
            text = replacementText;
        } else if (safeStart >= lineCount) {
            const lastColumn = model.getLineMaxColumn(lineCount);
            range = new monacoInstance.Range(lineCount, lastColumn, lineCount, lastColumn);
            text = `\n${replacementText}`;
        } else {
            range = new monacoInstance.Range(safeStart + 1, 1, safeStart + 1, 1);
            text = `${replacementText}\n`;
        }
    } else if (safeEnd < lineCount) {
        range = new monacoInstance.Range(safeStart + 1, 1, safeEnd + 1, 1);
        text = replacementLines.length > 0 ? `${replacementText}\n` : '';
    } else {
        range = new monacoInstance.Range(safeStart + 1, 1, lineCount, model.getLineMaxColumn(lineCount));
        text = replacementText;
    }

    editor.executeEdits('bygone-copy-change', [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
}

function initializeDirectoryViewEvents() {
    const container = getElement('dir-rows');
    container.addEventListener('bygone:directory-layout-change', () => {
        syncDirectoryColumnsFromActive();
        updateDirectoryEntrySelection();
        connectorController.scheduleDrawConnections();
    });
    container.addEventListener('bygone:directory-open-entry', (event) => {
        const relativePath = event.detail?.relativePath;
        if (typeof relativePath !== 'string') {
            return;
        }

        activeDirectoryEntryPath = relativePath;
        updateChangeToolbarState();
        host.postMessage({
            type: 'openDirectoryEntry',
            relativePath
        });
    });

    container.addEventListener('click', (event) => {
        const row = event.target instanceof Element ? event.target.closest('.dir-entry[data-is-dir="false"]') : null;
        const relativePath = row?.getAttribute('data-path');
        if (!relativePath || relativePath === activeDirectoryEntryPath) {
            return;
        }

        activeDirectoryEntryPath = relativePath;
        updateChangeToolbarState();
    });
}

function attachDirectoryScrollSync() {
    const container = getElement('dir-rows');
    container.querySelectorAll('.dir-column').forEach((column) => {
        column.addEventListener('scroll', () => handleDirectoryColumnScroll(column));
    });
}

function handleDirectoryColumnScroll(sourceColumn) {
    if (suppressDirectoryScrollSync) {
        connectorController.scheduleDrawConnections();
        return;
    }

    synchronizeDirectoryScroll(sourceColumn);
    connectorController.scheduleDrawConnections();
}

function getDirectoryColumns() {
    return Array.from(getElement('dir-rows').querySelectorAll('.dir-column'));
}

function resetDirectoryScrollPositions() {
    suppressDirectoryScrollSync = true;
    getDirectoryColumns().forEach((column) => {
        column.scrollTop = 0;
        column.scrollLeft = 0;
    });
    suppressDirectoryScrollSync = false;
}

function syncDirectoryColumnsFromActive() {
    const columns = getDirectoryColumns();
    if (columns.length < 2) {
        return;
    }

    const sourceColumn = columns.find((column) => column.scrollTop > 0) || columns[0];
    synchronizeDirectoryScroll(sourceColumn);
}

function synchronizeDirectoryScroll(sourceColumn) {
    const columns = getDirectoryColumns();
    if (columns.length < 2) {
        return;
    }

    const sourceSideIndex = Number.parseInt(sourceColumn.getAttribute('data-side-index') || '', 10);
    if (!Number.isInteger(sourceSideIndex)) {
        return;
    }

    const targetColumn = columns.find((column) => Number.parseInt(column.getAttribute('data-side-index') || '', 10) !== sourceSideIndex);
    if (!targetColumn) {
        return;
    }

    const sourceMap = buildDirectoryScrollMap(sourceColumn, sourceSideIndex);
    const targetSideIndex = Number.parseInt(targetColumn.getAttribute('data-side-index') || '', 10);
    const targetMap = buildDirectoryScrollMap(targetColumn, targetSideIndex);
    if (sourceMap.points.length === 0 || targetMap.points.length === 0) {
        return;
    }

    const globalPosition = directoryScrollTopToGlobalPosition(sourceColumn.scrollTop, sourceMap);
    const targetScrollTop = globalPositionToDirectoryScrollTop(globalPosition, targetMap, targetColumn);

    suppressDirectoryScrollSync = true;
    targetColumn.scrollTop = targetScrollTop;
    suppressDirectoryScrollSync = false;
}

function buildDirectoryScrollMap(column, sideIndex) {
    const rows = Array.from(column.querySelectorAll('.dir-entry'))
        .filter((row) => row.offsetParent !== null)
        .map((row) => {
            const relativePath = row.getAttribute('data-path');
            const globalIndex = directoryEntries.findIndex((entry) => entry.relativePath === relativePath && directoryEntryExistsOnSide(entry, sideIndex));
            return {
                globalIndex,
                top: row.offsetTop,
                height: row.offsetHeight
            };
        })
        .filter((point) => point.globalIndex >= 0);

    const points = rows.map((row) => ({
        position: row.globalIndex,
        top: row.top
    }));

    const lastRow = rows[rows.length - 1];
    if (lastRow) {
        points.push({
            position: lastRow.globalIndex + 1,
            top: lastRow.top + lastRow.height
        });
    }

    return { points };
}

function directoryEntryExistsOnSide(entry, sideIndex) {
    if (Array.isArray(entry.sides)) {
        return Boolean(entry.sides[sideIndex]);
    }

    return sideIndex === 0
        ? entry.status !== 'right-only'
        : entry.status !== 'left-only';
}

function directoryScrollTopToGlobalPosition(scrollTop, map) {
    const points = map.points;
    if (points.length === 0) {
        return 0;
    }

    if (points.length === 1 || scrollTop <= points[0].top) {
        return points[0].position;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        if (scrollTop <= next.top) {
            const span = Math.max(1, next.top - current.top);
            const fraction = (scrollTop - current.top) / span;
            return current.position + ((next.position - current.position) * fraction);
        }
    }

    return points[points.length - 1].position;
}

function globalPositionToDirectoryScrollTop(globalPosition, map, column) {
    const points = map.points;
    if (points.length === 0) {
        return 0;
    }

    if (points.length === 1 || globalPosition <= points[0].position) {
        return 0;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        if (globalPosition <= next.position) {
            const span = Math.max(0.0001, next.position - current.position);
            const fraction = (globalPosition - current.position) / span;
            return clamp(current.top + ((next.top - current.top) * fraction), 0, Math.max(0, column.scrollHeight - column.clientHeight));
        }
    }

    return Math.max(0, column.scrollHeight - column.clientHeight);
}

function initializeStandaloneDropTarget() {
    if (host.environment !== 'standalone') {
        return;
    }

    window.addEventListener('dragover', (event) => {
        event.preventDefault();
        document.body.classList.add('drag-active');
    });

    window.addEventListener('dragleave', (event) => {
        if (event.relatedTarget === null) {
            document.body.classList.remove('drag-active');
        }
    });

    window.addEventListener('drop', (event) => {
        event.preventDefault();
        document.body.classList.remove('drag-active');

        const paths = Array.from(event.dataTransfer?.files || [])
            .map((file) => file.path)
            .filter((filePath) => typeof filePath === 'string' && filePath.length > 0);

        if (paths.length === 0) {
            return;
        }

        host.postMessage({
            type: 'openDroppedFiles',
            paths
        });
    });
}

function updateHistoryToolbar(history) {
    const toolbar = getElement('history-toolbar');
    const backButton = getElement('history-back');
    const forwardButton = getElement('history-forward');
    const stagedButton = getElement('history-toggle-staged');
    const skipUnchangedButton = getElement('history-toggle-skip-unchanged');

    if (!history) {
        toolbar.hidden = true;
        clearHistoryToolbar();
        stagedButton.setAttribute('aria-pressed', 'false');
        stagedButton.classList.remove('is-active');
        skipUnchangedButton.setAttribute('aria-pressed', 'false');
        skipUnchangedButton.classList.remove('is-active');
        return;
    }

    toolbar.hidden = false;
    backButton.disabled = !history.canGoBack;
    forwardButton.disabled = !history.canGoForward;
    stagedButton.setAttribute('aria-pressed', history.includeStaged ? 'true' : 'false');
    stagedButton.classList.toggle('is-active', Boolean(history.includeStaged));
    skipUnchangedButton.setAttribute('aria-pressed', history.skipUnchanged ? 'true' : 'false');
    skipUnchangedButton.classList.toggle('is-active', Boolean(history.skipUnchanged));
    setTextContent('history-position', history.positionLabel);
    setTextContent('history-left-commit', history.leftCommitLabel);
    setTextContent('history-left-time', history.leftTimestamp);
    setTextContent('history-right-commit', history.rightCommitLabel);
    setTextContent('history-right-time', history.rightTimestamp);
}

function updateDirectoryTreeToolbar() {
    getElement('directory-tree-toolbar').hidden = currentMode !== 'directory';
}

function updateHistoryRail(historyRail) {
    historyRailState = historyRail;

    if (!historyRail) {
        activeHistoryRailTabId = null;
        renderHistoryRail();
        return;
    }

    if (!activeHistoryRailTabId || !historyRail.tabs.some((tab) => tab.id === activeHistoryRailTabId)) {
        activeHistoryRailTabId = historyRail.activeTabId || historyRail.tabs[0]?.id || null;
    }

    renderHistoryRail();
}

function renderHistoryRail() {
    const rail = getElement('history-rail');
    const container = getElement('container');

    if (!historyRailState) {
        rail.hidden = true;
        rail.classList.add('hidden');
        rail.innerHTML = '';
        container.classList.remove('history-rail-visible');
        return;
    }

    const tabs = historyRailState.tabs || [];
    const activeTabId = activeHistoryRailTabId || historyRailState.activeTabId || tabs[0]?.id || null;
    const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
    const items = activeTab ? (historyRailState.itemsByTab[activeTab.id] || []) : [];

    rail.hidden = false;
    rail.classList.remove('hidden');
    container.classList.add('history-rail-visible');
    rail.innerHTML = [
        '<div class="history-rail-tabs">',
        ...tabs.map((tab) => {
            const isActive = tab.id === (activeTab?.id || null);
            return `<button class="history-rail-tab${isActive ? ' active' : ''}" type="button" data-rail-tab="${escapeAttr(tab.id)}">${escapeHtml(tab.label)}</button>`;
        }),
        '</div>',
        '<div class="history-rail-list">',
        ...(items.length > 0
            ? items.map((item, index) => renderHistoryRailItem(item, activeTab?.id || '', index))
            : ['<div class="history-rail-empty">No entries</div>']),
        '</div>'
    ].join('');
}

function renderHistoryRailItem(item, tabId, index) {
    const statusClass = item.status ? ` status-${item.status}` : '';
    const marker = item.status ? historyRailStatusGlyph(item.status) : '•';
    const meta = item.meta ? `<span class="history-rail-meta">${escapeHtml(item.meta)}</span>` : '';
    const activeClass = item.active ? ' active' : '';
    const kindAttr = item.kind ? ` data-rail-kind="${escapeAttr(item.kind)}"` : '';
    const indexAttr = Number.isInteger(item.index) ? ` data-rail-index="${String(item.index)}"` : ` data-rail-index="${String(index)}"`;
    const pathAttr = typeof item.relativePath === 'string' ? ` data-rail-path="${escapeAttr(item.relativePath)}"` : '';

    return `<button class="history-rail-item${activeClass}${statusClass}" type="button" data-rail-item="true" data-rail-tab="${escapeAttr(tabId)}"${kindAttr}${indexAttr}${pathAttr}>`
        + `<span class="history-rail-marker">${escapeHtml(marker)}</span>`
        + `<span class="history-rail-text">`
        + `<span class="history-rail-label">${escapeHtml(item.label)}</span>`
        + meta
        + `</span>`
        + `</button>`;
}

function getHistoryRailItems(tabId) {
    return historyRailState?.itemsByTab?.[tabId] || [];
}

function historyRailStatusGlyph(status) {
    if (status === 'modified' || status === 'partial') {
        return '±';
    }

    if (status === 'left-only') {
        return '-';
    }

    if (status === 'right-only') {
        return '+';
    }

    return '•';
}

function scrollTopToModelLinePosition(editor, scrollTop) {
    const model = editor.getModel();
    if (!model) {
        return 0;
    }

    const lineCount = model.getLineCount();
    const lineHeight = editor.getOption(monacoInstance.editor.EditorOption.lineHeight);

    // Binary search: find the highest model line whose visual top <= scrollTop.
    // getTopForLineNumber is view-aware and accounts for folded regions.
    let lo = 1;
    let hi = lineCount;

    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (editor.getTopForLineNumber(mid) <= scrollTop) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    const lineTop = editor.getTopForLineNumber(lo);
    const fraction = Math.max(0, scrollTop - lineTop) / lineHeight;
    return lo - 1 + fraction; // 0-based fractional position
}

function modelLinePositionToScrollTop(editor, linePosition) {
    const model = editor.getModel();
    if (!model) {
        return 0;
    }

    const lineCount = model.getLineCount();
    const lineHeight = editor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const lineIndex = Math.floor(linePosition);
    const fraction = linePosition - lineIndex;
    const lineNumber = clamp(lineIndex + 1, 1, lineCount);

    return editor.getTopForLineNumber(lineNumber) + fraction * lineHeight;
}

function mapScrollTopBetweenEditors(sourceEditor, targetEditor) {
    const sourceSide = sourceEditor === leftEditor ? 'left' : 'right';
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    const sourceLineCount = sourceEditor.getModel()?.getLineCount() ?? 0;
    const targetLineCount = targetEditor.getModel()?.getLineCount() ?? 0;

    if (sourceLineCount === 0 || targetLineCount === 0 || currentDiffRows.length === 0 || !scrollMaps) {
        return getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height)
            * Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);
    }

    const sourceMaps = scrollMaps[sourceSide];
    const targetMaps = scrollMaps[targetSide];
    const sourceLinePosition = clamp(
        scrollTopToModelLinePosition(sourceEditor, sourceEditor.getScrollTop()),
        0,
        sourceLineCount
    );
    const alignedRowPosition = linePositionToRowPosition(sourceLinePosition, sourceMaps, currentDiffRows.length);
    const targetLinePosition = rowPositionToLinePosition(alignedRowPosition, targetMaps, currentDiffRows.length);
    const maxTargetScrollTop = Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);

    return clamp(modelLinePositionToScrollTop(targetEditor, targetLinePosition), 0, maxTargetScrollTop);
}

function buildScrollMaps(rows, side) {
    const lineToRow = [];
    const boundaryCounts = new Array(rows.length + 1).fill(0);
    let seenLines = 0;

    rows.forEach((row, index) => {
        const cell = row[side];
        boundaryCounts[index] = seenLines;

        if (cell.kind !== 'placeholder' && cell.lineNumber !== null) {
            lineToRow[cell.lineNumber - 1] = index;
            seenLines++;
        }
    });

    boundaryCounts[rows.length] = seenLines;

    return {
        lineToRow,
        boundaryCounts
    };
}

function linePositionToRowPosition(linePosition, maps, rowCount) {
    const lineIndex = Math.floor(linePosition);
    const fraction = linePosition - lineIndex;

    if (lineIndex >= maps.lineToRow.length) {
        return rowCount;
    }

    const rowIndex = maps.lineToRow[lineIndex];
    if (rowIndex === undefined) {
        return rowCount;
    }

    return clamp(rowIndex + fraction, 0, rowCount);
}

function rowPositionToLinePosition(rowPosition, maps, rowCount) {
    if (rowPosition >= rowCount) {
        return maps.boundaryCounts[rowCount];
    }

    const rowIndex = Math.floor(rowPosition);
    const fraction = rowPosition - rowIndex;
    const currentCount = maps.boundaryCounts[rowIndex];
    const nextCount = maps.boundaryCounts[rowIndex + 1];

    if (nextCount === currentCount) {
        return currentCount;
    }

    return currentCount + fraction;
}

function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = window.setTimeout(() => {
        if (!leftEditor || !rightEditor) {
            return;
        }

        host.postMessage({
            type: 'recomputeDiff',
            leftContent: leftEditor.getValue(),
            rightContent: rightEditor.getValue()
        });
    }, 120);
}

function layoutEditors() {
    leftEditor?.layout();
    rightEditor?.layout();
    multiEditors.forEach((editor) => editor.layout());
}

function getScrollRatio(value, extent) {
    if (extent <= 0) {
        return 0;
    }

    return value / extent;
}

function resetTwoWayScrollPositions() {
    leftEditor.setScrollTop(0);
    leftEditor.setScrollLeft(0);
    rightEditor.setScrollTop(0);
    rightEditor.setScrollLeft(0);
}

function resetMultiScrollPositions() {
    multiEditors.forEach((editor) => {
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createHostBridge() {
    if (window.__BYGONE_HOST__) {
        return {
            ...window.__BYGONE_HOST__,
            onMessage(handler) {
                window.addEventListener('bygone:host-message', (event) => handler(event.detail));
                window.addEventListener('message', (event) => {
                    if (!event?.data || typeof event.data !== 'object' || !('__bygoneHostMessage' in event.data)) {
                        return;
                    }

                    handler(event.data.__bygoneHostMessage);
                });
            }
        };
    }

    const vscodeApi = acquireVsCodeApi();
    return {
        environment: 'vscode',
        editorWorkerUrl: window.__BYGONE_EDITOR_WORKER_URL__,
        postMessage(message) {
            vscodeApi.postMessage(message);
        },
        onMessage(handler) {
            window.addEventListener('message', (event) => handler(event.data));
        }
    };
}
