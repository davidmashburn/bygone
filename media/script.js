const vscode = acquireVsCodeApi();

let currentMode = 'two-way';
let connectionCanvas;
let canvasContext;
let diffBlocks = [];
let drawScheduled = false;
let monacoInstance;
let leftEditor;
let rightEditor;
let leftDecorationIds = [];
let rightDecorationIds = [];
let suppressEditorEvents = false;
let recomputeTimer;
let pendingTwoWayPayload;
let currentDiffRows = [];
let historyMode = false;

window.addEventListener('message', (event) => {
    const message = event.data;

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
    initializeCanvas();
    initializeHistoryToolbar();
    await initializeMonaco();
    vscode.postMessage({ type: 'ready' });

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
    resizeCanvas();
    scheduleDrawConnections();
});

async function initializeMonaco() {
    await new Promise((resolve) => {
        self.MonacoEnvironment = {
            getWorkerUrl: () => {
                const workerSource = `
                    self.MonacoEnvironment = { baseUrl: ${JSON.stringify(window.__MELDEN_MONACO_BASE__)} };
                    importScripts(${JSON.stringify(`${window.__MELDEN_MONACO_BASE__}/base/worker/workerMain.js`)});
                `;
                return `data:text/javascript;charset=utf-8,${encodeURIComponent(workerSource)}`;
            }
        };

        window.require.config({ paths: { vs: window.__MELDEN_MONACO_BASE__ } });
        window.require(['vs/editor/editor.main'], () => {
            monacoInstance = window.monaco;
            resolve();
        });
    });
}

function showTwoWayDiff(file1, file2, leftContent, rightContent, diffModel, history) {
    currentMode = 'two-way';
    diffBlocks = diffModel.blocks || [];
    currentDiffRows = diffModel.rows || [];
    historyMode = Boolean(history);

    toggleView('two-way-diff');
    setStatus('', false);
    document.getElementById('file-info').textContent = `Comparing ${file1} and ${file2}`;
    document.getElementById('file1-header').textContent = file1;
    document.getElementById('file2-header').textContent = file2;
    updateHistoryToolbar(history);

    ensureTwoWayEditors();
    updateEditorValues(leftContent, rightContent);
    leftEditor.updateOptions({ readOnly: historyMode });
    rightEditor.updateOptions({ readOnly: historyMode });
    applyDiffDecorations(diffModel);

    leftEditor.setScrollTop(0);
    leftEditor.setScrollLeft(0);
    rightEditor.setScrollTop(0);
    rightEditor.setScrollLeft(0);
    layoutEditors();
    resizeCanvas();
    scheduleDrawConnections();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    diffBlocks = [];
    historyMode = false;
    disposeTwoWayEditors();
    updateHistoryToolbar(null);

    toggleView('three-way-diff');
    document.getElementById('file-info').textContent = `Three-way merge for ${message.base.name}, ${message.left.name}, and ${message.right.name}`;
    document.getElementById('base-header').textContent = message.base.name;
    document.getElementById('left-header').textContent = message.left.name;
    document.getElementById('right-header').textContent = message.right.name;
    document.getElementById('result-header').textContent = message.result.name;
    setStatus(
        message.meta.isExperimental
            ? `Experimental merge view. ${message.meta.conflictCount} conflict(s) need review.`
            : '',
        message.meta.isExperimental
    );

    renderPlainLines(document.getElementById('base-content'), message.base.lines);
    renderPlainLines(document.getElementById('left-content'), message.left.lines);
    renderPlainLines(document.getElementById('right-content'), message.right.lines);
    renderResultLines(document.getElementById('result-content'), message.result.lines);

    resetScrollPositions();
    resizeCanvas();
    scheduleDrawConnections();
}

function ensureTwoWayEditors() {
    if (leftEditor && rightEditor) {
        return;
    }

    leftEditor = createEditor(document.getElementById('file1-content'));
    rightEditor = createEditor(document.getElementById('file2-content'));
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
        scheduleDrawConnections();
    });

    editor.onDidScrollChange(() => {
        if (suppressEditorEvents) {
            scheduleDrawConnections();
            return;
        }

        synchronizeEditorScroll(editor);
        scheduleDrawConnections();
    });

    editor.onDidContentSizeChange(() => {
        scheduleDrawConnections();
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

    document.getElementById('file1-content').classList.remove('editor-host');
    document.getElementById('file2-content').classList.remove('editor-host');
}

function updateEditorValues(leftContent, rightContent) {
    suppressEditorEvents = true;

    if (leftEditor.getValue() !== leftContent) {
        leftEditor.getModel().setValue(leftContent);
    }

    if (rightEditor.getValue() !== rightContent) {
        rightEditor.getModel().setValue(rightContent);
    }

    suppressEditorEvents = false;
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
            addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, leftEditor.getModel()?.getLineCount() ?? 0, rightEditor.getModel()?.getLineCount() ?? 0, 'melden-one-sided-boundary');
        } else if (block.kind === 'insert') {
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-one-sided-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'melden-one-sided-line');
            addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, leftEditor.getModel()?.getLineCount() ?? 0, rightEditor.getModel()?.getLineCount() ?? 0, 'melden-one-sided-boundary');
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

function addCollapsedBoundaryDecoration(target, anchorIndex, targetLineCount, _otherLineCount, className) {
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
    document.getElementById('history-back').addEventListener('click', () => {
        vscode.postMessage({ type: 'historyBack' });
    });
    document.getElementById('history-forward').addEventListener('click', () => {
        vscode.postMessage({ type: 'historyForward' });
    });
}

function updateHistoryToolbar(history) {
    const toolbar = document.getElementById('history-toolbar');
    const backButton = document.getElementById('history-back');
    const forwardButton = document.getElementById('history-forward');
    const position = document.getElementById('history-position');
    const leftCommit = document.getElementById('history-left-commit');
    const leftTime = document.getElementById('history-left-time');
    const rightCommit = document.getElementById('history-right-commit');
    const rightTime = document.getElementById('history-right-time');

    if (!history) {
        toolbar.hidden = true;
        position.textContent = '';
        leftCommit.textContent = '';
        leftTime.textContent = '';
        rightCommit.textContent = '';
        rightTime.textContent = '';
        return;
    }

    toolbar.hidden = false;
    backButton.disabled = !history.canGoBack;
    forwardButton.disabled = !history.canGoForward;
    position.textContent = history.positionLabel;
    leftCommit.textContent = history.leftCommitLabel;
    leftTime.textContent = history.leftTimestamp;
    rightCommit.textContent = history.rightCommitLabel;
    rightTime.textContent = history.rightTimestamp;
}

function mapScrollTopBetweenEditors(sourceEditor, targetEditor) {
    const sourceSide = sourceEditor === leftEditor ? 'left' : 'right';
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    const sourceLineHeight = sourceEditor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const targetLineHeight = targetEditor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const sourceLineCount = sourceEditor.getModel()?.getLineCount() ?? 0;
    const targetLineCount = targetEditor.getModel()?.getLineCount() ?? 0;

    if (sourceLineCount === 0 || targetLineCount === 0 || currentDiffRows.length === 0) {
        return getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height)
            * Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);
    }

    const sourceMaps = buildScrollMaps(currentDiffRows, sourceSide);
    const targetMaps = buildScrollMaps(currentDiffRows, targetSide);
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

        vscode.postMessage({
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

function renderPlainLines(container, lines) {
    container.innerHTML = lines.map((line, index) => {
        const content = line.length === 0 ? '&nbsp;' : escapeHtml(line);
        return `<div class="diff-line context"><span class="line-number">${index + 1}</span><span class="line-text">${content}</span></div>`;
    }).join('');
}

function renderResultLines(container, lines) {
    container.innerHTML = lines.map((line, index) => {
        const kind = line === '<<<<<<< LEFT' || line === '=======' || line === '>>>>>>> RIGHT'
            ? 'merge-marker'
            : 'context';
        const content = line.length === 0 ? '&nbsp;' : escapeHtml(line);
        return `<div class="diff-line ${kind}"><span class="line-number">${index + 1}</span><span class="line-text">${content}</span></div>`;
    }).join('');
}

function toggleView(activeId) {
    document.getElementById('two-way-diff').classList.toggle('hidden', activeId !== 'two-way-diff');
    document.getElementById('three-way-diff').classList.toggle('hidden', activeId !== 'three-way-diff');
}

function setStatus(text, visible) {
    const banner = document.getElementById('status-banner');
    banner.hidden = !visible;
    banner.textContent = text;
}

function resetScrollPositions() {
    document.querySelectorAll('.file-content').forEach((container) => {
        container.scrollTop = 0;
        container.scrollLeft = 0;
    });
}

function initializeCanvas() {
    connectionCanvas = document.getElementById('connection-canvas');

    if (!connectionCanvas) {
        connectionCanvas = document.createElement('canvas');
        connectionCanvas.id = 'connection-canvas';
        document.getElementById('diff-container').appendChild(connectionCanvas);
    }

    canvasContext = connectionCanvas.getContext('2d');
    resizeCanvas();
}

function resizeCanvas() {
    if (!connectionCanvas) {
        return;
    }

    const container = document.getElementById('diff-container');
    connectionCanvas.width = container.clientWidth;
    connectionCanvas.height = container.clientHeight;
}

function drawConnections() {
    if (!canvasContext || !connectionCanvas) {
        return;
    }

    canvasContext.clearRect(0, 0, connectionCanvas.width, connectionCanvas.height);

    if (currentMode !== 'two-way' || !leftEditor || !rightEditor) {
        return;
    }

    const containerRect = connectionCanvas.getBoundingClientRect();
    const leftRect = leftEditor.getDomNode().getBoundingClientRect();
    const rightRect = rightEditor.getDomNode().getBoundingClientRect();

    diffBlocks.forEach((block) => {
        drawBlockRegion(block, leftEditor, rightEditor, leftRect, rightRect, containerRect);
    });
}

function drawBlockRegion(block, leftEditorRef, rightEditorRef, leftRect, rightRect, containerRect) {
    const leftBounds = getBlockBounds(leftEditorRef, block.leftStart, block.leftEnd, leftRect, containerRect, true);
    const rightBounds = getBlockBounds(rightEditorRef, block.rightStart, block.rightEnd, rightRect, containerRect, false);

    if (!leftBounds || !rightBounds) {
        return;
    }

    const colors = {
        insert: {
            leftFill: 'rgba(73, 190, 119, 0.10)',
            rightFill: 'rgba(73, 190, 119, 0.26)',
            stroke: 'rgba(73, 190, 119, 0.92)'
        },
        delete: {
            leftFill: 'rgba(73, 190, 119, 0.26)',
            rightFill: 'rgba(73, 190, 119, 0.10)',
            stroke: 'rgba(73, 190, 119, 0.92)'
        },
        replace: {
            leftFill: 'rgba(79, 124, 255, 0.24)',
            rightFill: 'rgba(79, 124, 255, 0.24)',
            strokeLeft: 'rgba(79, 124, 255, 0.92)'
        }
    };

    const cpOffset = (rightBounds.x - leftBounds.x) * 0.35;
    const color = colors[block.kind] || colors.replace;
    const gradient = canvasContext.createLinearGradient(leftBounds.x, 0, rightBounds.x, 0);
    const collapsesLeft = block.kind === 'insert';
    const collapsesRight = block.kind === 'delete';

    if (collapsesLeft) {
        const center = (leftBounds.top + leftBounds.bottom) / 2;
        leftBounds.top = center;
        leftBounds.bottom = center;
    }

    if (collapsesRight) {
        const center = (rightBounds.top + rightBounds.bottom) / 2;
        rightBounds.top = center;
        rightBounds.bottom = center;
    }

    if (block.kind === 'replace') {
        gradient.addColorStop(0, color.leftFill);
        gradient.addColorStop(1, color.rightFill);
    } else {
        gradient.addColorStop(0, color.leftFill);
        gradient.addColorStop(1, color.rightFill);
    }

    const path = new Path2D();
    path.moveTo(leftBounds.x, leftBounds.top);
    path.bezierCurveTo(
        leftBounds.x + cpOffset, leftBounds.top,
        rightBounds.x - cpOffset, rightBounds.top,
        rightBounds.x, rightBounds.top
    );
    path.lineTo(rightBounds.x, rightBounds.bottom);
    path.bezierCurveTo(
        rightBounds.x - cpOffset, rightBounds.bottom,
        leftBounds.x + cpOffset, leftBounds.bottom,
        leftBounds.x, leftBounds.bottom
    );
    path.closePath();

    canvasContext.fillStyle = gradient;
    canvasContext.fill(path);

    if (block.kind === 'replace') {
        strokeReplaceBlockOutline(leftBounds, rightBounds, cpOffset, leftRect, rightRect, containerRect, color.strokeLeft);
    } else {
        strokeConnectorEdges(leftBounds, rightBounds, cpOffset, color.stroke);
        strokeBlockOutline(color.stroke, leftBounds, rightBounds, leftRect, rightRect, containerRect);
        if (collapsesLeft) {
            drawBoundaryGuide(leftRect, containerRect, leftBounds.top, color.stroke);
        }
        if (collapsesRight) {
            drawBoundaryGuide(rightRect, containerRect, rightBounds.top, color.stroke);
        }
    }
}

function getBlockBounds(editor, start, end, editorRect, containerRect, useRightEdge) {
    const model = editor.getModel();
    const lineCount = model ? model.getLineCount() : 0;
    const gutterInset = -2;
    const x = useRightEdge
        ? editorRect.right - containerRect.left + gutterInset
        : editorRect.left - containerRect.left - gutterInset;

    if (lineCount === 0) {
        const baseline = editorRect.top - containerRect.top + 12;
        return { x, top: baseline - 6, bottom: baseline + 6 };
    }

    if (start === end) {
        return getInsertionBounds(editor, clamp(start, 0, lineCount), x, editorRect, containerRect);
    }

    const firstLine = Math.min(start + 1, lineCount);
    const lastLine = Math.min(Math.max(end, 1), lineCount);

    return {
        x,
        top: getEditorTopForLine(editor, firstLine, editorRect, containerRect) + 1,
        bottom: getEditorBottomForLine(editor, lastLine, editorRect, containerRect) - 1
    };
}

function getInsertionBounds(editor, index, x, editorRect, containerRect) {
    const model = editor.getModel();
    const lineCount = model ? model.getLineCount() : 0;
    const lineHeight = editor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const span = Math.max(6, Math.min(14, lineHeight * 0.45));
    let center;

    if (index <= 0) {
        center = getEditorTopForLine(editor, 1, editorRect, containerRect);
        return { x, top: center - span, bottom: center + span };
    }

    if (index >= lineCount) {
        center = getEditorBottomForLine(editor, lineCount, editorRect, containerRect);
        return { x, top: center - span, bottom: center + span };
    }

    const previousBottom = getEditorBottomForLine(editor, index, editorRect, containerRect);
    const nextTop = getEditorTopForLine(editor, index + 1, editorRect, containerRect);
    center = previousBottom + ((nextTop - previousBottom) / 2);

    return {
        x,
        top: center - span,
        bottom: center + span
    };
}

function getEditorTopForLine(editor, lineNumber, editorRect, containerRect) {
    return editorRect.top - containerRect.top + editor.getTopForLineNumber(lineNumber) - editor.getScrollTop();
}

function getEditorBottomForLine(editor, lineNumber, editorRect, containerRect) {
    return getEditorTopForLine(editor, lineNumber, editorRect, containerRect)
        + editor.getOption(monacoInstance.editor.EditorOption.lineHeight);
}

function strokeReplaceBlockOutline(leftBounds, rightBounds, cpOffset, leftRect, rightRect, containerRect, color) {
    canvasContext.lineWidth = 1.5;
    canvasContext.strokeStyle = color;
    canvasContext.beginPath();
    canvasContext.moveTo(leftBounds.x, leftBounds.top);
    canvasContext.bezierCurveTo(
        leftBounds.x + cpOffset, leftBounds.top,
        rightBounds.x - cpOffset, rightBounds.top,
        rightBounds.x, rightBounds.top
    );
    canvasContext.stroke();

    canvasContext.beginPath();
    canvasContext.moveTo(rightBounds.x, rightBounds.bottom);
    canvasContext.bezierCurveTo(
        rightBounds.x - cpOffset, rightBounds.bottom,
        leftBounds.x + cpOffset, leftBounds.bottom,
        leftBounds.x, leftBounds.bottom
    );
    canvasContext.stroke();

    strokePaneOutline(leftRect, containerRect, leftBounds.top, leftBounds.bottom, color);
    strokePaneOutline(rightRect, containerRect, rightBounds.top, rightBounds.bottom, color);
}

function drawBoundaryGuide(panelRect, containerRect, y, color) {
    canvasContext.strokeStyle = color;
    canvasContext.lineWidth = 1.5;
    canvasContext.beginPath();
    canvasContext.moveTo(panelRect.left - containerRect.left, y);
    canvasContext.lineTo(panelRect.right - containerRect.left, y);
    canvasContext.stroke();
}

function strokeBlockOutline(color, leftBounds, rightBounds, leftRect, rightRect, containerRect) {
    strokePaneOutline(leftRect, containerRect, leftBounds.top, leftBounds.bottom, color);
    strokePaneOutline(rightRect, containerRect, rightBounds.top, rightBounds.bottom, color);
}

function strokePaneOutline(panelRect, containerRect, top, bottom, color) {
    canvasContext.strokeStyle = color;
    canvasContext.lineWidth = 1.5;
    canvasContext.beginPath();
    canvasContext.moveTo(panelRect.left - containerRect.left, top);
    canvasContext.lineTo(panelRect.right - containerRect.left, top);
    canvasContext.moveTo(panelRect.left - containerRect.left, bottom);
    canvasContext.lineTo(panelRect.right - containerRect.left, bottom);
    canvasContext.stroke();
}

function strokeConnectorEdges(leftBounds, rightBounds, cpOffset, color) {
    canvasContext.strokeStyle = color;
    canvasContext.lineWidth = 1.5;
    canvasContext.beginPath();
    canvasContext.moveTo(leftBounds.x, leftBounds.top);
    canvasContext.bezierCurveTo(
        leftBounds.x + cpOffset, leftBounds.top,
        rightBounds.x - cpOffset, rightBounds.top,
        rightBounds.x, rightBounds.top
    );
    canvasContext.stroke();

    canvasContext.beginPath();
    canvasContext.moveTo(rightBounds.x, rightBounds.bottom);
    canvasContext.bezierCurveTo(
        rightBounds.x - cpOffset, rightBounds.bottom,
        leftBounds.x + cpOffset, leftBounds.bottom,
        leftBounds.x, leftBounds.bottom
    );
    canvasContext.stroke();
}

function getScrollRatio(value, extent) {
    if (extent <= 0) {
        return 0;
    }

    return value / extent;
}

function scheduleDrawConnections() {
    if (drawScheduled) {
        return;
    }

    drawScheduled = true;
    window.requestAnimationFrame(() => {
        drawScheduled = false;
        drawConnections();
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
