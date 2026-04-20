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
    renderDirectoryView
} = window.BygoneDom;

const MODE_TWO_WAY = 'two-way';
const MODE_MULTI_WAY = 'multi-way';

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
let directoryEntries = [];
let multiEditors = [];
let multiDecorationIds = [];
let multiDiffPairs = [];
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

        showTwoWayDiff(message.file1, message.file2, message.leftContent, message.rightContent, message.diffModel, message.history || null);
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
            pendingTwoWayPayload.history || null
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

function showTwoWayDiff(file1, file2, leftContent, rightContent, diffModel, history) {
    currentMode = MODE_TWO_WAY;
    historyMode = Boolean(history);
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
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(history);
    updateChangeToolbarState();

    const directoryLabels = Array.isArray(labels) && labels.length >= 2 ? labels : [leftLabel, rightLabel];

    toggleView(VIEW_IDS.directory);
    setStatus('', false);
    setTextContent('file-info', `Comparing directories ${directoryLabels.join(' and ')}`);

    resetDirectoryView();
    renderDirectoryView(getElement('dir-rows'), directoryEntries, directoryLabels);
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
}

function showMultiDiff(panels, pairs) {
    if (!Array.isArray(panels) || panels.length < 2) {
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
    disposeMultiEditors();
    multiDiffPairs = pairs || [];
    updateHistoryToolbar(null);
    updateChangeToolbarState();

    toggleView(VIEW_IDS.multiWay);
    setStatus('', false);
    setTextContent('file-info', `Comparing ${panels.length} files`);

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
    directoryEntries = [];
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(null);
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
}

function ensureTwoWayEditors() {
    if (leftEditor && rightEditor) {
        return;
    }

    leftEditor = createEditor(getElement('file1-content'), MODE_TWO_WAY);
    rightEditor = createEditor(getElement('file2-content'), MODE_TWO_WAY);
}

function createEditor(container, editorMode) {
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
        if (editorMode !== MODE_TWO_WAY || suppressEditorEvents || historyMode) {
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
    const readOnly = historyMode;
    leftEditor.updateOptions({ readOnly });
    rightEditor.updateOptions({ readOnly });
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
}

function initializeChangeToolbar() {
    getElement('previous-change').addEventListener('click', () => navigateDiff(-1));
    getElement('next-change').addEventListener('click', () => navigateDiff(1));
    getElement('copy-left-to-right').addEventListener('click', () => copyCurrentChange('left-to-right'));
    getElement('copy-right-to-left').addEventListener('click', () => copyCurrentChange('right-to-left'));

    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || currentMode !== MODE_TWO_WAY) {
            return;
        }

        if (event.key === 'F7') {
            event.preventDefault();
            navigateDiff(event.shiftKey ? -1 : 1);
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
    updateChangeToolbarState();

    if (leftEditor && rightEditor && currentDiffModel) {
        applyDiffDecorations(currentDiffModel);
    }

    if (shouldReveal) {
        revealActiveDiff(true);
    }
}

function updateChangeToolbarState() {
    const toolbar = getElement('change-toolbar');
    const hasDiffs = currentMode === MODE_TWO_WAY && diffBlocks.length > 0;
    toolbar.hidden = !hasDiffs;

    if (!hasDiffs) {
        setTextContent('change-position', '');
        return;
    }

    const safeIndex = clamp(activeDiffIndex, 0, diffBlocks.length - 1);
    const copyDisabled = historyMode;
    setTextContent('change-position', `${safeIndex + 1} / ${diffBlocks.length}`);
    getElement('previous-change').disabled = diffBlocks.length === 0;
    getElement('next-change').disabled = diffBlocks.length === 0;
    getElement('copy-left-to-right').disabled = copyDisabled;
    getElement('copy-right-to-left').disabled = copyDisabled;
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
    if (currentMode !== MODE_TWO_WAY || historyMode || activeDiffIndex < 0) {
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

    if (!history) {
        toolbar.hidden = true;
        clearHistoryToolbar();
        return;
    }

    toolbar.hidden = false;
    backButton.disabled = !history.canGoBack;
    forwardButton.disabled = !history.canGoForward;
    setTextContent('history-position', history.positionLabel);
    setTextContent('history-left-commit', history.leftCommitLabel);
    setTextContent('history-left-time', history.leftTimestamp);
    setTextContent('history-right-commit', history.rightCommitLabel);
    setTextContent('history-right-time', history.rightTimestamp);
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
