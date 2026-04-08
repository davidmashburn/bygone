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
    resetScrollPositions
} = window.MeldenDom;

let currentMode = 'two-way';
let diffBlocks = [];
let monacoInstance;
let leftEditor;
let rightEditor;
let leftDecorationIds = [];
let rightDecorationIds = [];
let suppressEditorEvents = false;
let recomputeTimer;
let pendingTwoWayPayload;
let currentDiffRows = [];
let scrollMaps = null;
let historyMode = false;
const connectorController = window.MeldenConnectors.createConnectorController({
    getElement,
    getMode: () => currentMode,
    getEditors: () => ({ leftEditor, rightEditor }),
    getDiffBlocks: () => diffBlocks,
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

    if (message.type === 'showThreeWayMerge') {
        showThreeWayMerge(message);
    }
});

window.addEventListener('load', async () => {
    connectorController.initializeCanvas();
    initializeHistoryToolbar();
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
    currentMode = 'two-way';
    setCurrentDiffModel(diffModel);
    historyMode = Boolean(history);

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
    resetTwoWayScrollPositions();
    layoutEditors();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    setCurrentDiffModel({ blocks: [], rows: [] });
    historyMode = false;
    disposeTwoWayEditors();
    updateHistoryToolbar(null);

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

    leftEditor = createEditor(getElement('file1-content'));
    rightEditor = createEditor(getElement('file2-content'));
}

function createEditor(container) {
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
        if (suppressEditorEvents || historyMode) {
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

        synchronizeEditorScroll(editor);
        connectorController.scheduleDrawConnections();
    });

    editor.onDidContentSizeChange(() => {
        connectorController.scheduleDrawConnections();
    });

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
    leftEditor.updateOptions({ readOnly: historyMode });
    rightEditor.updateOptions({ readOnly: historyMode });
}

function setCurrentDiffModel(diffModel) {
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
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'melden-paired-line');
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-paired-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'melden-paired-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-paired-line');
        } else if (block.kind === 'delete') {
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'melden-one-sided-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'melden-one-sided-line');
            addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, rightEditor.getModel()?.getLineCount() ?? 0, 'melden-one-sided-boundary');
        } else if (block.kind === 'insert') {
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-one-sided-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-one-sided-line');
            addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, leftEditor.getModel()?.getLineCount() ?? 0, 'melden-one-sided-boundary');
        }
    }

    addInlineDecorations(leftDecorations, diffModel.leftLines || [], 'removed', 'melden-inline-blue');
    addInlineDecorations(rightDecorations, diffModel.rightLines || [], 'added', 'melden-inline-blue');

    leftDecorationIds = leftEditor.deltaDecorations(leftDecorationIds, leftDecorations);
    rightDecorationIds = rightEditor.deltaDecorations(rightDecorationIds, rightDecorations);
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

function initializeHistoryToolbar() {
    getElement('history-back').addEventListener('click', () => {
        host.postMessage({ type: 'historyBack' });
    });
    getElement('history-forward').addEventListener('click', () => {
        host.postMessage({ type: 'historyForward' });
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

function mapScrollTopBetweenEditors(sourceEditor, targetEditor) {
    const sourceSide = sourceEditor === leftEditor ? 'left' : 'right';
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    const sourceLineHeight = sourceEditor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const targetLineHeight = targetEditor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const sourceLineCount = sourceEditor.getModel()?.getLineCount() ?? 0;
    const targetLineCount = targetEditor.getModel()?.getLineCount() ?? 0;

    if (sourceLineCount === 0 || targetLineCount === 0 || currentDiffRows.length === 0 || !scrollMaps) {
        return getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height)
            * Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);
    }

    const sourceMaps = scrollMaps[sourceSide];
    const targetMaps = scrollMaps[targetSide];
    const sourceLinePosition = clamp(sourceEditor.getScrollTop() / sourceLineHeight, 0, sourceLineCount);
    const alignedRowPosition = linePositionToRowPosition(sourceLinePosition, sourceMaps, currentDiffRows.length);
    const targetLinePosition = rowPositionToLinePosition(alignedRowPosition, targetMaps, currentDiffRows.length);
    const maxTargetScrollTop = Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);

    return clamp(targetLinePosition * targetLineHeight, 0, maxTargetScrollTop);
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function createHostBridge() {
    if (window.__MELDEN_HOST__) {
        return window.__MELDEN_HOST__;
    }

    const vscodeApi = acquireVsCodeApi();
    return {
        environment: 'vscode',
        editorWorkerUrl: window.__MELDEN_EDITOR_WORKER_URL__,
        postMessage(message) {
            vscodeApi.postMessage(message);
        },
        onMessage(handler) {
            window.addEventListener('message', (event) => handler(event.data));
        }
    };
}
