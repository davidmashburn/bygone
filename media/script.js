const vscode = acquireVsCodeApi();

let currentMode = 'two-way';
let connectionCanvas;
let canvasContext;
let diffBlocks = [];
let scrollSyncBound = false;
let isSyncingScroll = false;
let drawScheduled = false;

window.addEventListener('message', (event) => {
    const message = event.data;

    if (message.type === 'showDiff') {
        showTwoWayDiff(message.file1, message.file2, message.diffModel);
        return;
    }

    if (message.type === 'showThreeWayMerge') {
        showThreeWayMerge(message);
    }
});

window.addEventListener('load', () => {
    initializeCanvas();
    bindScrollSync();
    vscode.postMessage({ type: 'ready' });
});

window.addEventListener('resize', () => {
    resizeCanvas();
    scheduleDrawConnections();
});

function showTwoWayDiff(file1, file2, diffModel) {
    currentMode = 'two-way';
    diffBlocks = diffModel.blocks || [];

    toggleView('two-way-diff');
    setStatus('', false);
    document.getElementById('file-info').textContent = `Comparing ${file1} and ${file2}`;
    document.getElementById('file1-header').textContent = file1;
    document.getElementById('file2-header').textContent = file2;

    renderSideLines(document.getElementById('file1-content'), diffModel.leftLines || []);
    renderSideLines(document.getElementById('file2-content'), diffModel.rightLines || []);

    resetScrollPositions();
    resizeCanvas();
    scheduleDrawConnections();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    diffBlocks = [];

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

function renderSideLines(container, lines) {
    container.innerHTML = lines.map((line, index) => {
        const content = renderLineContent(line);
        const classes = ['diff-line', line.kind, line.segments && line.segments.length > 0 ? 'has-inline-highlight' : '']
            .filter(Boolean)
            .join(' ');
        return `<div class="${classes}" data-line="${index}"><span class="line-number">${line.lineNumber}</span><span class="line-text">${content}</span></div>`;
    }).join('');
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

function bindScrollSync() {
    if (scrollSyncBound) {
        return;
    }

    scrollSyncBound = true;
    const containers = Array.from(document.querySelectorAll('.file-content'));

    containers.forEach((container) => {
        container.addEventListener('scroll', () => {
            if (isSyncingScroll) {
                scheduleDrawConnections();
                return;
            }

            const visibleContainers = getVisibleScrollContainers();
            const verticalRatio = getScrollRatio(container.scrollTop, container.scrollHeight - container.clientHeight);
            const horizontalRatio = getScrollRatio(container.scrollLeft, container.scrollWidth - container.clientWidth);

            isSyncingScroll = true;
            visibleContainers.forEach((other) => {
                if (other === container) {
                    return;
                }

                other.scrollTop = verticalRatio * Math.max(0, other.scrollHeight - other.clientHeight);
                other.scrollLeft = horizontalRatio * Math.max(0, other.scrollWidth - other.clientWidth);
            });
            isSyncingScroll = false;

            scheduleDrawConnections();
        });
    });
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

    if (currentMode !== 'two-way') {
        return;
    }

    const leftPanel = document.getElementById('file1-content');
    const rightPanel = document.getElementById('file2-content');

    if (!leftPanel || !rightPanel) {
        return;
    }

    const containerRect = connectionCanvas.getBoundingClientRect();
    const leftRect = leftPanel.getBoundingClientRect();
    const rightRect = rightPanel.getBoundingClientRect();

    diffBlocks.forEach((block) => {
        drawBlockRegion(block, leftPanel, rightPanel, leftRect, rightRect, containerRect);
    });
}

function drawBlockRegion(block, leftPanel, rightPanel, leftRect, rightRect, containerRect) {
    const leftBounds = getBlockBounds(leftPanel, block.leftStart, block.leftEnd, leftRect, containerRect, true);
    const rightBounds = getBlockBounds(rightPanel, block.rightStart, block.rightEnd, rightRect, containerRect, false);

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
            strokeLeft: 'rgba(79, 124, 255, 0.92)',
            strokeRight: 'rgba(79, 124, 255, 0.92)'
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
        gradient.addColorStop(0.5, color.leftFill);
        gradient.addColorStop(0.5, color.rightFill);
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

function getBlockBounds(panel, start, end, panelRect, containerRect, useRightEdge) {
    const lineCount = panel.children.length;
    const gutterInset = -2;
    const x = useRightEdge
        ? panelRect.right - containerRect.left + gutterInset
        : panelRect.left - containerRect.left - gutterInset;

    if (lineCount === 0) {
        const baseline = panelRect.top - containerRect.top + 12;
        return { x, top: baseline - 6, bottom: baseline + 6 };
    }

    if (start === end) {
        return getInsertionBounds(panel, indexClamp(start, 0, lineCount), x, containerRect);
    }

    const firstLine = panel.children[Math.min(start, lineCount - 1)];
    const lastLine = panel.children[Math.min(Math.max(end - 1, 0), lineCount - 1)];

    if (!firstLine || !lastLine) {
        return undefined;
    }

    return {
        x,
        top: firstLine.getBoundingClientRect().top - containerRect.top + 1,
        bottom: lastLine.getBoundingClientRect().bottom - containerRect.top - 1
    };
}

function getInsertionBounds(panel, index, x, containerRect) {
    const lineCount = panel.children.length;
    const lineHeight = getLineHeight(panel);
    const span = Math.max(6, Math.min(14, lineHeight * 0.45));
    let center;

    if (index <= 0) {
        center = panel.children[0].getBoundingClientRect().top - containerRect.top;
        return { x, top: center - span, bottom: center + span };
    }

    if (index >= lineCount) {
        center = panel.children[lineCount - 1].getBoundingClientRect().bottom - containerRect.top;
        return { x, top: center - span, bottom: center + span };
    }

    const previousRect = panel.children[index - 1].getBoundingClientRect();
    const nextRect = panel.children[index].getBoundingClientRect();
    center = previousRect.bottom + ((nextRect.top - previousRect.bottom) / 2) - containerRect.top;

    return {
        x,
        top: center - span,
        bottom: center + span
    };
}

function getLineHeight(panel) {
    const firstLine = panel.children[0];
    return firstLine ? firstLine.getBoundingClientRect().height : 16;
}

function indexClamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function getVisibleScrollContainers() {
    return Array.from(document.querySelectorAll('.file-content')).filter((container) => {
        const view = container.closest('.diff-view');
        return view && !view.classList.contains('hidden');
    });
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderLineContent(line) {
    if (line.segments && line.segments.length > 0) {
        const renderedSegments = line.segments.map((segment) => {
            const classes = [
                'inline-segment',
                `${segment.kind}-segment`,
                segment.emphasis ? 'emphasis' : ''
            ].filter(Boolean).join(' ');
            const text = segment.text.length === 0 ? '&nbsp;' : escapeHtml(segment.text);
            return `<span class="${classes}">${text}</span>`;
        }).join('');

        return renderedSegments.length > 0 ? renderedSegments : '&nbsp;';
    }

    return line.content.length === 0 ? '&nbsp;' : escapeHtml(line.content);
}
