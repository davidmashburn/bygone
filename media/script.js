const host = createHostBridge();
const {
    VIEW_IDS,
    getElement,
    setTextContent,
    clearHistoryToolbar,
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
const MODE_DIRECTORY = 'directory';
const NAVIGATOR_SCOPE_CHANGED = 'changed-files';
const NAVIGATOR_SCOPE_TREE = 'tree';
const UI_PROFILE_FLUSH_INTERVAL_MS = 1000;

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
let activeDirectoryFileChangeIndex = -1;
let canReturnToDirectoryView = false;
let currentDirectoryContext = null;
let shouldPulseActiveDiff = false;
let navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
let navigatorRailRenderKey = null;
const uiProfileEnabled = Boolean(host.profileUi);
const uiProfileStats = new Map();
let uiProfileFlushTimer = null;
const connectorController = window.BygoneConnectors.createConnectorController({
    getElement,
    getMode: () => currentMode,
    getEditors: () => ({ leftEditor, rightEditor }),
    getDiffBlocks: () => diffBlocks,
    getDirectoryEntries: () => directoryEntries,
    getMultiDiffState: () => ({ editors: multiEditors, pairs: multiDiffPairs }),
    getMonaco: () => monacoInstance
});

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
            Boolean(message.canReturnToDirectory),
            message.editableSides,
            message.directoryContext || null
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

        showMultiDiff(message.panels, message.pairs);
        return;
    }

    if (message.type === 'showThreeWayMerge') {
        showThreeWayMerge(message);
    }
});

window.addEventListener('load', async () => {
    connectorController.initializeCanvas();
    initializeHistoryToolbar();
    initializeChangeToolbar();
    initializeDirectoryReturnToolbar();
    initializeDirectoryTreeToolbar();
    initializeNavigatorRailEvents();
    initializeEditModeToolbar();
    initializeDirectoryViewEvents();
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
            Boolean(pendingTwoWayPayload.canReturnToDirectory),
            pendingTwoWayPayload.editableSides,
            pendingTwoWayPayload.directoryContext || null
        );
        pendingTwoWayPayload = undefined;
    }

    if (pendingMultiPayload) {
        showMultiDiff(pendingMultiPayload.panels, pendingMultiPayload.pairs);
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

function updateShellContext(modeLabel, title, breadcrumb = '') {
    setTextContent('mode-chip', modeLabel);
    setTextContent('file-info', title);
    setTextContent('breadcrumb-trail', breadcrumb);
}

function animateWorkspaceTransition(kind) {
    const shell = getElement('workspace-shell');
    if (!shell) {
        return;
    }

    const transitionClass = kind === 'timeline'
        ? 'workspace-shell--timeline-shift'
        : 'workspace-shell--hierarchy-shift';

    shell.classList.remove('workspace-shell--timeline-shift', 'workspace-shell--hierarchy-shift');
    // Force a reflow so replaying the class reliably retriggers the animation.
    void shell.offsetWidth;
    shell.classList.add(transitionClass);
    window.setTimeout(() => {
        shell.classList.remove(transitionClass);
    }, 240);
}

function pulseHistoryToolbar() {
    const toolbar = getElement('history-toolbar');
    if (!toolbar || toolbar.hidden) {
        return;
    }

    toolbar.classList.remove('history-toolbar--refresh');
    void toolbar.offsetWidth;
    toolbar.classList.add('history-toolbar--refresh');
}

function showTwoWayDiff(
    file1,
    file2,
    leftContent,
    rightContent,
    diffModel,
    history,
    canReturnToDirectory = false,
    nextEditableSides = null,
    nextDirectoryContext = null
) {
    const previousMode = currentMode;
    const previousHistoryMode = historyMode;
    currentMode = MODE_TWO_WAY;
    historyMode = Boolean(history);
    canReturnToDirectoryView = Boolean(canReturnToDirectory);
    currentDirectoryContext = canReturnToDirectoryView
        ? normalizeDirectoryContext(nextDirectoryContext)
        : null;
    if (!currentDirectoryContext) {
        navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    } else if (navigatorRailScope === NAVIGATOR_SCOPE_TREE && !isNavigatorTreeScopeAvailable(currentDirectoryContext)) {
        navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    }
    hostEditableSides = normalizeEditableSides(nextEditableSides, historyMode);
    setCurrentDiffModel(diffModel);
    setActiveDiffIndex(diffBlocks.length > 0 ? clamp(activeDiffIndex, 0, diffBlocks.length - 1) : -1, false);
    directoryEntries = [];
    clearDirectoryJumpSelection();
    disposeMultiEditors();

    toggleView(VIEW_IDS.twoWay);
    setStatus('', false);
    updateShellContext(
        history
            ? (canReturnToDirectory ? 'Directory History File' : 'File History')
            : (canReturnToDirectory ? 'Directory Drill-down' : 'Diff'),
        `Comparing ${file1} and ${file2}`,
        `${file1} ↔ ${file2}`
    );
    setTextContent('file1-header', file1);
    setTextContent('file2-header', file2);
    updateHistoryToolbar(history);
    updateDirectoryReturnToolbar(canReturnToDirectory);
    updateNavigatorRail();
    updateDirectoryTreeToolbar();
    updateEditModeToolbar();

    ensureTwoWayEditors();
    updateEditorValues(leftContent, rightContent);
    updateTwoWayEditorOptions();
    applyDiffDecorations(diffModel);
    updateChangeToolbarState();
    resetTwoWayScrollPositions();
    layoutEditors();
    revealActiveDiff(false);
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();

    if (canReturnToDirectoryView && previousMode === MODE_DIRECTORY) {
        animateWorkspaceTransition('hierarchy');
    } else if (historyMode || previousHistoryMode) {
        animateWorkspaceTransition('timeline');
    }
}

function showDirectoryDiff(leftLabel, rightLabel, entries, labels, history) {
    const previousMode = currentMode;
    const previousHistoryMode = historyMode;
    const previousCanReturnToDirectory = canReturnToDirectoryView;
    currentMode = MODE_DIRECTORY;
    historyMode = Boolean(history);
    canReturnToDirectoryView = false;
    currentDirectoryContext = null;
    navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = entries || [];
    activeDirectoryFileChangeIndex = -1;
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(history);
    updateDirectoryReturnToolbar(false);
    updateNavigatorRail();
    updateDirectoryTreeToolbar();
    updateEditModeToolbar();
    updateChangeToolbarState();

    const directoryLabels = Array.isArray(labels) && labels.length >= 2 ? labels : [leftLabel, rightLabel];

    toggleView(VIEW_IDS.directory);
    setStatus('', false);
    updateShellContext(
        history ? 'Directory History' : 'Directory Compare',
        `Comparing directories ${directoryLabels.join(' and ')}`,
        directoryLabels.join(' ↔ ')
    );

    resetDirectoryView();
    renderDirectoryView(getElement('dir-rows'), directoryEntries, directoryLabels);
    runDirectoryTreeAction(collapseUnchangedDirectories);
    updateChangeToolbarState();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();

    if (previousCanReturnToDirectory && previousMode === MODE_TWO_WAY) {
        animateWorkspaceTransition('hierarchy');
    } else if (historyMode || previousHistoryMode) {
        animateWorkspaceTransition('timeline');
    }
}

function showMultiDiff(panels, pairs) {
    if (!Array.isArray(panels) || panels.length < 2) {
        return;
    }

    currentMode = MODE_MULTI_WAY;
    historyMode = false;
    canReturnToDirectoryView = false;
    currentDirectoryContext = null;
    navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = [];
    clearDirectoryJumpSelection();
    disposeTwoWayEditors();
    disposeMultiEditors();
    multiDiffPairs = pairs || [];
    updateHistoryToolbar(null);
    updateDirectoryReturnToolbar(false);
    updateNavigatorRail();
    updateDirectoryTreeToolbar();
    updateEditModeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.multiWay);
    setStatus('', false);
    updateShellContext(
        'Multi Diff',
        `Comparing ${panels.length} files`,
        panels.map((panel) => panel.label).join(' ↔ ')
    );

    renderMultiDiffShell(panels);
    multiEditors = panels.map((panel, index) => {
        const editor = createEditor(getElement(`multi-pane-${index}-content`), MODE_MULTI_WAY);
        editor.updateOptions({ readOnly: true });
        editor.setValue(panel.content);
        return editor;
    });
    multiDecorationIds = multiEditors.map(() => []);
    applyMultiDiffDecorations(multiDiffPairs);
    resetMultiScrollPositions();
    layoutEditors();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    currentDiffModel = null;
    activeDiffIndex = -1;
    setCurrentDiffModel({ blocks: [], rows: [] });
    historyMode = false;
    canReturnToDirectoryView = false;
    currentDirectoryContext = null;
    navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    directoryEntries = [];
    clearDirectoryJumpSelection();
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(null);
    updateDirectoryReturnToolbar(false);
    updateNavigatorRail();
    updateDirectoryTreeToolbar();
    updateEditModeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.threeWay);
    updateShellContext(
        'Three-Way Merge',
        `Three-way merge for ${message.base.name}, ${message.left.name}, and ${message.right.name}`,
        `${message.base.name} · ${message.left.name} · ${message.right.name}`
    );
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
}

function ensureTwoWayEditors() {
    if (leftEditor && rightEditor) {
        return;
    }

    leftEditor = createEditor(getElement('file1-content'), MODE_TWO_WAY, 'left');
    rightEditor = createEditor(getElement('file2-content'), MODE_TWO_WAY, 'right');
}

function createEditor(container, editorMode, side = null) {
    container.innerHTML = '<div class="editor-root"></div>';
    container.classList.add('editor-host');

    const editor = monacoInstance.editor.create(container.firstElementChild, {
        value: '',
        language: 'plaintext',
        theme: 'vs',
        contextmenu: host.environment !== 'standalone',
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
        if (editorMode !== MODE_TWO_WAY || suppressEditorEvents || !isSideEditable(side)) {
            return;
        }

        scheduleRecompute();
        connectorController.scheduleDrawConnections();
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
}

function disposeMultiEditors() {
    multiEditors.forEach((editor) => editor.dispose());
    multiEditors = [];
    multiDecorationIds = [];
    multiDiffPairs = [];
    const container = getElement(VIEW_IDS.multiWay);
    if (container) {
        container.innerHTML = '';
    }
}

function renderMultiDiffShell(panels) {
    const columns = [];
    const children = [];

    panels.forEach((panel, index) => {
        columns.push('minmax(220px, 1fr)');
        children.push(
            `<div class="multi-pane" data-index="${index}">`
            + `<div class="multi-pane-header">${escapeHtml(panel.label)}</div>`
            + `<div id="multi-pane-${index}-content" class="multi-pane-content"></div>`
            + '</div>'
        );

        if (index < panels.length - 1) {
            columns.push('96px');
            children.push(
                `<div class="multi-gutter" data-pair-index="${index}">`
                + `<div class="multi-gutter-header">${escapeHtml(panel.label)}:${escapeHtml(panels[index + 1].label)}</div>`
                + '</div>'
            );
        }
    });

    const container = getElement(VIEW_IDS.multiWay);
    container.style.gridTemplateColumns = columns.join(' ');
    container.innerHTML = children.join('');
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
    profileUiPhase('applyDiffDecorations', () => {
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
    });
}

function addActiveBlockDecorations(target, start, end, targetLineCount) {
    const pulseClassName = shouldPulseActiveDiff ? 'bygone-active-diff-pulse' : null;
    if (start === end) {
        addCollapsedBoundaryDecoration(target, start, targetLineCount, 'bygone-active-diff');
        if (pulseClassName) {
            addCollapsedBoundaryDecoration(target, start, targetLineCount, pulseClassName);
        }
        return;
    }

    addLineDecorations(target, start, end, 'bygone-active-diff');
    addBlockEdgeDecorations(target, start, end, 'bygone-active-diff');
    if (pulseClassName) {
        addLineDecorations(target, start, end, pulseClassName);
        addBlockEdgeDecorations(target, start, end, pulseClassName);
    }
}

function applyMultiDiffDecorations(pairs) {
    profileUiPhase('applyMultiDiffDecorations', () => {
        const decorations = multiEditors.map(() => []);

        for (const pair of pairs || []) {
            const leftDecorations = decorations[pair.leftIndex];
            const rightDecorations = decorations[pair.rightIndex];
            const diffModel = pair.diffModel;

            if (!leftDecorations || !rightDecorations || !diffModel) {
                continue;
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
        }

        multiDecorationIds = multiEditors.map((editor, index) => (
            editor.deltaDecorations(multiDecorationIds[index] || [], decorations[index])
        ));
    });
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
        host.postMessage({ type: 'historyToggleStaged', includeStaged: nextIncludeStaged });
    });
}

function initializeDirectoryReturnToolbar() {
    getElement('back-to-directory').addEventListener('click', () => returnToDirectory());
}

function initializeDirectoryTreeToolbar() {
    getElement('directory-expand-all')?.addEventListener('click', () => {
        runDirectoryTreeAction(expandAllDirectories);
    });
    getElement('directory-collapse-all')?.addEventListener('click', () => {
        runDirectoryTreeAction(collapseAllDirectories);
    });
    getElement('directory-collapse-unchanged')?.addEventListener('click', () => {
        runDirectoryTreeAction(collapseUnchangedDirectories);
    });
}

function initializeNavigatorRailEvents() {
    const list = getElement('navigator-rail-list');
    const changedTab = getElement('navigator-tab-changed');
    const treeTab = getElement('navigator-tab-tree');
    if (!list) {
        return;
    }

    changedTab?.addEventListener('click', () => {
        setNavigatorRailScope(NAVIGATOR_SCOPE_CHANGED);
    });

    treeTab?.addEventListener('click', () => {
        setNavigatorRailScope(NAVIGATOR_SCOPE_TREE);
    });

    list.addEventListener('click', (event) => {
        const button = event.target instanceof Element
            ? event.target.closest('.navigator-entry')
            : null;
        if (!button || button.disabled) {
            return;
        }
        const relativePath = button?.dataset?.relativePath;
        if (typeof relativePath !== 'string' || relativePath.length === 0) {
            return;
        }

        if (currentDirectoryContext) {
            currentDirectoryContext.activeRelativePath = relativePath;
            updateNavigatorRail();
        }

        host.postMessage({
            type: 'openDirectoryEntry',
            relativePath
        });
    });

    list.addEventListener('keydown', (event) => {
        const entry = event.target instanceof Element
            ? event.target.closest('.navigator-entry')
            : null;
        if (!entry) {
            return;
        }

        const entries = Array.from(list.querySelectorAll('.navigator-entry:not([disabled])'));
        const currentIndex = entries.indexOf(entry);
        if (currentIndex < 0) {
            return;
        }

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const nextIndex = (currentIndex + step + entries.length) % entries.length;
            entries[nextIndex]?.focus();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            entry.click();
        }
    });
}

function setNavigatorRailScope(nextScope) {
    if (nextScope !== NAVIGATOR_SCOPE_CHANGED && nextScope !== NAVIGATOR_SCOPE_TREE) {
        return;
    }

    if (!currentDirectoryContext || !canReturnToDirectoryView || currentMode !== MODE_TWO_WAY) {
        navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
        return;
    }

    const normalizedScope = nextScope === NAVIGATOR_SCOPE_TREE && !isNavigatorTreeScopeAvailable(currentDirectoryContext)
        ? NAVIGATOR_SCOPE_CHANGED
        : nextScope;

    if (navigatorRailScope === normalizedScope) {
        return;
    }

    navigatorRailScope = normalizedScope;
    updateNavigatorRail();
    focusNavigatorRail();
}

function isNavigatorTreeScopeAvailable(directoryContext) {
    return Array.isArray(directoryContext?.treeEntries) && directoryContext.treeEntries.length > 0;
}

function updateNavigatorRailTabs(directoryContext) {
    const changedTab = getElement('navigator-tab-changed');
    const treeTab = getElement('navigator-tab-tree');
    if (!changedTab || !treeTab) {
        return;
    }

    const treeEnabled = isNavigatorTreeScopeAvailable(directoryContext);
    if (!treeEnabled && navigatorRailScope === NAVIGATOR_SCOPE_TREE) {
        navigatorRailScope = NAVIGATOR_SCOPE_CHANGED;
    }

    const changedSelected = navigatorRailScope !== NAVIGATOR_SCOPE_TREE;
    changedTab.classList.toggle('is-active', changedSelected);
    changedTab.setAttribute('aria-selected', changedSelected ? 'true' : 'false');
    changedTab.tabIndex = changedSelected ? 0 : -1;

    treeTab.disabled = !treeEnabled;
    treeTab.classList.toggle('is-active', !changedSelected);
    treeTab.setAttribute('aria-selected', !changedSelected ? 'true' : 'false');
    treeTab.tabIndex = !changedSelected ? 0 : -1;
}

function normalizeDirectoryContext(nextDirectoryContext) {
    if (!nextDirectoryContext || typeof nextDirectoryContext !== 'object') {
        return null;
    }

    const changedFiles = Array.isArray(nextDirectoryContext.changedFiles)
        ? nextDirectoryContext.changedFiles.filter((relativePath) => typeof relativePath === 'string' && relativePath.length > 0)
        : [];
    if (changedFiles.length === 0) {
        return null;
    }

    const activeRelativePath = typeof nextDirectoryContext.activeRelativePath === 'string'
        && changedFiles.includes(nextDirectoryContext.activeRelativePath)
        ? nextDirectoryContext.activeRelativePath
        : changedFiles[0];

    const treeEntries = Array.isArray(nextDirectoryContext.treeEntries)
        ? nextDirectoryContext.treeEntries
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                relativePath: typeof entry.relativePath === 'string' ? entry.relativePath : '',
                displayName: typeof entry.displayName === 'string' ? entry.displayName : '',
                status: typeof entry.status === 'string' ? entry.status : 'same',
                isDirectory: Boolean(entry.isDirectory),
                depth: Number.isFinite(entry.depth) ? Math.max(0, Number(entry.depth)) : 0,
                sides: Array.isArray(entry.sides) ? entry.sides.map((value) => Boolean(value)) : []
            }))
            .filter((entry) => entry.relativePath.length > 0 && entry.displayName.length > 0)
        : [];
    const changedFilesSignature = changedFiles.join('\u001f');
    const treeEntriesSignature = treeEntries
        .map((entry) => [
            entry.relativePath,
            entry.status,
            entry.isDirectory ? '1' : '0',
            String(entry.depth),
            entry.sides.map((value) => (value ? '1' : '0')).join('')
        ].join('\u001e'))
        .join('\u001f');

    return {
        changedFiles,
        activeRelativePath,
        treeEntries,
        changedFilesSignature,
        treeEntriesSignature
    };
}

function updateNavigatorRail() {
    profileUiPhase('updateNavigatorRail', () => {
        const rail = getElement('navigator-rail');
        const title = getElement('navigator-rail-title');
        const count = getElement('navigator-rail-count');
        const list = getElement('navigator-rail-list');
        const tabs = getElement('navigator-rail-tabs');

        if (!rail || !title || !count || !list || !tabs) {
            return;
        }

        const treeEnabled = isNavigatorTreeScopeAvailable(currentDirectoryContext);
        const effectiveScope = navigatorRailScope === NAVIGATOR_SCOPE_TREE && treeEnabled
            ? NAVIGATOR_SCOPE_TREE
            : NAVIGATOR_SCOPE_CHANGED;
        if (navigatorRailScope !== effectiveScope) {
            navigatorRailScope = effectiveScope;
        }

        const shouldShow = currentMode === MODE_TWO_WAY && canReturnToDirectoryView
            && currentDirectoryContext
            && currentDirectoryContext.changedFiles.length > 0;
        const nextRenderKey = shouldShow
            ? [
                'visible',
                historyMode ? 'history' : 'diff',
                navigatorRailScope,
                currentDirectoryContext.activeRelativePath,
                currentDirectoryContext.changedFilesSignature,
                currentDirectoryContext.treeEntriesSignature
            ].join('\u001d')
            : 'hidden';

        if (nextRenderKey === navigatorRailRenderKey) {
            return;
        }
        navigatorRailRenderKey = nextRenderKey;

        rail.hidden = !shouldShow;
        document.body.classList.toggle('navigator-rail-open', Boolean(shouldShow));
        getElement('workspace-shell')?.classList.toggle('navigator-rail-active', Boolean(shouldShow));
        tabs.hidden = !shouldShow;

        if (!shouldShow) {
            title.textContent = '';
            count.textContent = '';
            list.innerHTML = '';
            updateNavigatorRailTabs(null);
            return;
        }

        const shouldPreserveFocus = list.contains(document.activeElement);
        updateNavigatorRailTabs(currentDirectoryContext);

        if (navigatorRailScope === NAVIGATOR_SCOPE_TREE && isNavigatorTreeScopeAvailable(currentDirectoryContext)) {
            title.textContent = 'Directory Tree';
            count.textContent = `${currentDirectoryContext.treeEntries.length} entries`;
            list.setAttribute('aria-label', 'Directory tree');
            renderNavigatorRailTreeEntries(list, currentDirectoryContext.treeEntries, currentDirectoryContext.activeRelativePath);
        } else {
            const activeIndex = Math.max(0, currentDirectoryContext.changedFiles.indexOf(currentDirectoryContext.activeRelativePath));
            title.textContent = historyMode ? 'Snapshot Changes' : 'Changed Files';
            count.textContent = `${activeIndex + 1} / ${currentDirectoryContext.changedFiles.length}`;
            list.setAttribute('aria-label', 'Changed files');
            renderNavigatorRailChangedEntries(list, currentDirectoryContext.changedFiles, currentDirectoryContext.activeRelativePath);
        }

        if (shouldPreserveFocus) {
            const activeEntry = list.querySelector('.navigator-entry.is-active') || list.querySelector('.navigator-entry');
            if (activeEntry instanceof HTMLElement) {
                activeEntry.focus({ preventScroll: true });
            }
        }
    });
}

function renderNavigatorRailChangedEntries(container, changedFiles, activeRelativePath) {
    profileUiPhase('renderNavigatorRailChangedEntries', () => {
        container.innerHTML = '';

        changedFiles.forEach((relativePath, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'navigator-entry';
            button.dataset.relativePath = relativePath;
            button.title = relativePath;
            if (relativePath === activeRelativePath) {
                button.classList.add('is-active');
                button.tabIndex = 0;
            } else {
                button.tabIndex = -1;
            }

            const entryIndex = document.createElement('span');
            entryIndex.className = 'navigator-entry-index';
            entryIndex.textContent = String(index + 1);

            const label = document.createElement('span');
            label.className = 'navigator-entry-label';
            label.textContent = relativePath;

            button.append(entryIndex, label);
            container.append(button);
        });
    });
}

function renderNavigatorRailTreeEntries(container, treeEntries, activeRelativePath) {
    profileUiPhase('renderNavigatorRailTreeEntries', () => {
        container.innerHTML = '';
        let hasFocusableEntry = false;

        treeEntries.forEach((entry) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `navigator-entry navigator-entry--tree navigator-entry--${entry.status}`;
            button.dataset.relativePath = entry.relativePath;
            button.style.setProperty('--navigator-tree-depth', String(entry.depth));
            button.title = entry.relativePath;

            const hasBothSides = Array.isArray(entry.sides) && entry.sides.filter(Boolean).length >= 2;
            const isNavigable = !entry.isDirectory && hasBothSides;
            if (!isNavigable) {
                button.disabled = true;
                button.classList.add('is-disabled');
            }

            if (isNavigable && entry.relativePath === activeRelativePath) {
                button.classList.add('is-active');
                button.tabIndex = 0;
                hasFocusableEntry = true;
            } else {
                button.tabIndex = -1;
            }

            const treeKind = document.createElement('span');
            treeKind.className = 'navigator-tree-kind';
            treeKind.textContent = entry.isDirectory ? '▸' : '';

            const label = document.createElement('span');
            label.className = `navigator-entry-label${entry.isDirectory ? ' navigator-entry-label--dir' : ''}`;
            label.textContent = entry.isDirectory ? `${entry.displayName}/` : entry.displayName;

            button.append(treeKind, label);
            container.append(button);
        });

        if (!hasFocusableEntry) {
            const firstFocusableEntry = container.querySelector('.navigator-entry:not([disabled])');
            if (firstFocusableEntry instanceof HTMLElement) {
                firstFocusableEntry.tabIndex = 0;
            }
        }
    });
}

function focusNavigatorRail() {
    const list = getElement('navigator-rail-list');
    if (!list || list.childElementCount === 0) {
        return;
    }

    const activeEntry = list.querySelector('.navigator-entry.is-active')
        || list.querySelector('.navigator-entry:not([disabled])');
    if (activeEntry instanceof HTMLElement) {
        activeEntry.focus();
    }
}

function initializeEditModeToolbar() {
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

function initializeChangeToolbar() {
    getElement('previous-file-change').addEventListener('click', () => {
        navigateDirectoryFileChange('previous');
    });
    getElement('next-file-change').addEventListener('click', () => {
        navigateDirectoryFileChange('next');
    });
    getElement('previous-change').addEventListener('click', () => {
        if (currentMode === MODE_TWO_WAY) {
            navigateDiff(-1);
        }
    });
    getElement('next-change').addEventListener('click', () => {
        if (currentMode === MODE_DIRECTORY) {
            jumpToNextDirectoryFileChange();
            return;
        }
        navigateDiff(1);
    });
    getElement('copy-left-to-right').addEventListener('click', () => copyCurrentChange('left-to-right'));
    getElement('copy-right-to-left').addEventListener('click', () => copyCurrentChange('right-to-left'));

    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) {
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === '[' && !getElement('directory-return-toolbar').hidden) {
            event.preventDefault();
            returnToDirectory();
            return;
        }

        if (event.key === 'F6' && currentMode === MODE_TWO_WAY && canReturnToDirectoryView) {
            event.preventDefault();
            focusNavigatorRail();
            return;
        }

        if (event.key === 'F7') {
            event.preventDefault();
            if (currentMode === MODE_DIRECTORY) {
                jumpToNextDirectoryFileChange();
                return;
            }
            if (currentMode !== MODE_TWO_WAY) {
                return;
            }
            navigateDiff(event.shiftKey ? -1 : 1);
            return;
        }

        if (currentMode !== MODE_TWO_WAY) {
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

function returnToDirectory() {
    host.postMessage({ type: 'returnToDirectory' });
}

function navigateDirectoryFileChange(direction) {
    if (currentMode !== MODE_TWO_WAY || !canReturnToDirectoryView) {
        return;
    }
    if (!currentDirectoryContext || currentDirectoryContext.changedFiles.length < 2) {
        return;
    }

    host.postMessage({
        type: 'navigateDirectoryEntry',
        direction
    });
}

function updateDirectoryReturnToolbar(canReturnToDirectory) {
    getElement('directory-return-toolbar').hidden = !canReturnToDirectory;
}

function updateDirectoryTreeToolbar() {
    const toolbar = getElement('directory-tree-toolbar');
    if (!toolbar) {
        return;
    }

    toolbar.hidden = currentMode !== 'directory';
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

function runDirectoryTreeAction(action) {
    if (currentMode !== MODE_DIRECTORY) {
        return;
    }

    const container = getElement('dir-rows');
    if (!container) {
        return;
    }

    profileUiPhase('runDirectoryTreeAction', () => action(container));
    updateChangeToolbarState();
    connectorController.scheduleDrawConnections();
}

function registerEditorKeybindings(editor, editorMode) {
    if (editorMode !== MODE_TWO_WAY) {
        return;
    }

    editor.addCommand(monacoInstance.KeyCode.F7, () => navigateDiff(1));
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F7, () => navigateDiff(-1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.RightArrow, () => copyCurrentChange('left-to-right'));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.LeftArrow, () => copyCurrentChange('right-to-left'));
}

function navigateDiff(direction) {
    if (currentMode !== MODE_TWO_WAY || diffBlocks.length === 0) {
        return;
    }

    const nextIndex = activeDiffIndex < 0
        ? 0
        : (activeDiffIndex + direction + diffBlocks.length) % diffBlocks.length;

    setActiveDiffIndex(nextIndex, true);
}

function setActiveDiffIndex(index, shouldReveal) {
    activeDiffIndex = index;
    shouldPulseActiveDiff = shouldReveal;
    updateChangeToolbarState();

    if (leftEditor && rightEditor && currentDiffModel) {
        applyDiffDecorations(currentDiffModel);
    }
    shouldPulseActiveDiff = false;

    if (shouldReveal) {
        revealActiveDiff(true);
    }
}

function updateChangeToolbarState() {
    const toolbar = getElement('change-toolbar');
    const previousFileButton = getElement('previous-file-change');
    const previousButton = getElement('previous-change');
    const nextButton = getElement('next-change');
    const nextFileButton = getElement('next-file-change');
    const hint = toolbar.querySelector('.change-hint');
    const hasDiffs = currentMode === MODE_TWO_WAY && diffBlocks.length > 0;
    const drillDownFileCount = currentMode === MODE_TWO_WAY && canReturnToDirectoryView && currentDirectoryContext
        ? currentDirectoryContext.changedFiles.length
        : 0;
    const hasFileNavigation = drillDownFileCount > 0;
    const directoryChangeRows = currentMode === MODE_DIRECTORY ? getVisibleChangedFileRows() : [];
    const hasDirectoryFileChanges = currentMode === MODE_DIRECTORY && directoryChangeRows.length > 0;
    const hasLineNavigation = currentMode === MODE_TWO_WAY && hasDiffs;

    toolbar.hidden = !hasLineNavigation && !hasDirectoryFileChanges && !hasFileNavigation;

    if (currentMode === MODE_DIRECTORY) {
        previousFileButton.hidden = true;
        previousFileButton.disabled = true;
        nextFileButton.hidden = true;
        nextFileButton.disabled = true;
        previousButton.hidden = true;
        if (hint) {
            hint.hidden = true;
        }
        nextButton.hidden = false;
        nextButton.textContent = 'Next File Change';
        nextButton.disabled = directoryChangeRows.length === 0;

        if (activeDirectoryFileChangeIndex >= directoryChangeRows.length) {
            activeDirectoryFileChangeIndex = -1;
        }

        directoryChangeRows.forEach((row, index) => {
            row.classList.toggle('dir-entry--jump-target', index === activeDirectoryFileChangeIndex);
        });

        setTextContent(
            'change-position',
            directoryChangeRows.length === 0
                ? ''
                : `${Math.max(activeDirectoryFileChangeIndex + 1, 0)} / ${directoryChangeRows.length}`
        );
        updateActionToolbarState(false);
        return;
    }

    previousFileButton.hidden = !hasFileNavigation;
    previousFileButton.disabled = !hasFileNavigation || drillDownFileCount < 2;
    nextFileButton.hidden = !hasFileNavigation;
    nextFileButton.disabled = !hasFileNavigation || drillDownFileCount < 2;
    previousButton.hidden = !hasLineNavigation;
    nextButton.hidden = !hasLineNavigation;
    previousButton.textContent = '↑ Prev';
    nextButton.textContent = '↓ Next';
    if (hint) {
        hint.hidden = !hasLineNavigation;
        hint.textContent = hasFileNavigation
            ? 'F7 / Shift+F7 jumps line changes. Use ←/→ file buttons for changed files. F6 focuses the rail (Tree or Changed Files). Cmd/Ctrl+Alt+←/→ copies the selected change.'
            : 'F7 / Shift+F7 to jump. Cmd/Ctrl+Alt+←/→ to copy the selected change.';
    }

    if (!hasLineNavigation) {
        setTextContent('change-position', '');
        previousButton.disabled = true;
        nextButton.disabled = true;
        updateActionToolbarState(false);
        return;
    }

    const safeIndex = clamp(activeDiffIndex, 0, diffBlocks.length - 1);
    setTextContent('change-position', `${safeIndex + 1} / ${diffBlocks.length}`);
    previousButton.disabled = diffBlocks.length === 0;
    nextButton.disabled = diffBlocks.length === 0;
    updateActionToolbarState(true);
}

function updateActionToolbarState(hasActiveDiff) {
    const toolbar = getElement('action-toolbar');
    const copyLeftButton = getElement('copy-left-to-right');
    const copyRightButton = getElement('copy-right-to-left');
    const hasCopyActions = currentMode === MODE_TWO_WAY;

    toolbar.hidden = !hasCopyActions;
    if (!hasCopyActions) {
        return;
    }

    copyLeftButton.disabled = !hasActiveDiff || !isSideEditable('right');
    copyRightButton.disabled = !hasActiveDiff || !isSideEditable('left');
}

function jumpToNextDirectoryFileChange() {
    if (currentMode !== MODE_DIRECTORY) {
        return;
    }

    const rows = getVisibleChangedFileRows();
    if (rows.length === 0) {
        activeDirectoryFileChangeIndex = -1;
        updateChangeToolbarState();
        return;
    }

    activeDirectoryFileChangeIndex = (activeDirectoryFileChangeIndex + 1 + rows.length) % rows.length;
    const target = rows[activeDirectoryFileChangeIndex];
    if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    updateChangeToolbarState();
    connectorController.scheduleDrawConnections();
}

function getVisibleChangedFileRows() {
    const container = getElement('dir-rows');
    if (!container) {
        return [];
    }

    return Array.from(container.querySelectorAll('.dir-entry[data-is-dir="false"]'))
        .filter((row) => row.dataset.status !== 'same' && row.offsetParent !== null);
}

function clearDirectoryJumpSelection() {
    activeDirectoryFileChangeIndex = -1;
    const container = getElement('dir-rows');
    if (!container) {
        return;
    }

    container.querySelectorAll('.dir-entry--jump-target').forEach((row) => {
        row.classList.remove('dir-entry--jump-target');
    });
}

function revealActiveDiff(smooth) {
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
    container.addEventListener('scroll', () => {
        connectorController.scheduleDrawConnections();
    });
    container.addEventListener('bygone:directory-layout-change', () => {
        connectorController.scheduleDrawConnections();
    });
    container.addEventListener('bygone:directory-open-entry', (event) => {
        const relativePath = event.detail?.relativePath;
        if (typeof relativePath !== 'string') {
            return;
        }

        host.postMessage({
            type: 'openDirectoryEntry',
            relativePath
        });
    });
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

    if (!history) {
        toolbar.hidden = true;
        toolbar.classList.remove('history-toolbar--refresh');
        clearHistoryToolbar();
        stagedButton.setAttribute('aria-pressed', 'false');
        stagedButton.textContent = 'Staged Off';
        return;
    }

    toolbar.hidden = false;
    backButton.disabled = !history.canGoBack;
    forwardButton.disabled = !history.canGoForward;
    stagedButton.setAttribute('aria-pressed', history.includeStaged ? 'true' : 'false');
    stagedButton.textContent = history.includeStaged ? 'Staged On' : 'Staged Off';
    setTextContent('history-position', history.positionLabel);
    setTextContent('history-left-commit', history.leftCommitLabel);
    setTextContent('history-left-time', history.leftTimestamp);
    setTextContent('history-right-commit', history.rightCommitLabel);
    setTextContent('history-right-time', history.rightTimestamp);
    pulseHistoryToolbar();
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

function profileUiPhase(label, work) {
    if (!uiProfileEnabled) {
        return work();
    }

    const startedAt = performance.now();
    try {
        return work();
    } finally {
        recordUiProfileStat(label, performance.now() - startedAt);
    }
}

function recordUiProfileStat(label, durationMs) {
    const existing = uiProfileStats.get(label) || {
        count: 0,
        totalMs: 0,
        maxMs: 0
    };

    existing.count += 1;
    existing.totalMs += durationMs;
    existing.maxMs = Math.max(existing.maxMs, durationMs);
    uiProfileStats.set(label, existing);
    scheduleUiProfileFlush();
}

function scheduleUiProfileFlush() {
    if (uiProfileFlushTimer !== null) {
        return;
    }

    uiProfileFlushTimer = window.setTimeout(() => {
        uiProfileFlushTimer = null;
        flushUiProfileStats();
    }, UI_PROFILE_FLUSH_INTERVAL_MS);
}

function flushUiProfileStats() {
    if (!uiProfileEnabled || uiProfileStats.size === 0) {
        return;
    }

    const summary = Array.from(uiProfileStats.entries())
        .map(([label, stat]) => {
            const avgMs = stat.totalMs / Math.max(stat.count, 1);
            return `${label}: avg=${formatProfileDuration(avgMs)} max=${formatProfileDuration(stat.maxMs)} n=${stat.count}`;
        })
        .join(' | ');
    console.info(`[Bygone UI profile] ${summary}`);
    uiProfileStats.clear();
}

function formatProfileDuration(durationMs) {
    return `${durationMs.toFixed(2)}ms`;
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
        profileUi: false,
        postMessage(message) {
            vscodeApi.postMessage(message);
        },
        onMessage(handler) {
            window.addEventListener('message', (event) => handler(event.data));
        }
    };
}
