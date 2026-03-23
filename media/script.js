const vscode = acquireVsCodeApi();

let currentMode = 'two-way';
let connectionCanvas;
let canvasContext;
let connections = [];
let scrollSyncBound = false;

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
    drawConnections();
});

function showTwoWayDiff(file1, file2, diffModel) {
    currentMode = 'two-way';
    connections = diffModel.connections || [];

    toggleView('two-way-diff');
    setStatus('', false);
    document.getElementById('file-info').textContent = `Comparing ${file1} and ${file2}`;
    document.getElementById('file1-header').textContent = file1;
    document.getElementById('file2-header').textContent = file2;

    renderTwoWayRows(document.getElementById('file1-content'), diffModel.rows, 'left');
    renderTwoWayRows(document.getElementById('file2-content'), diffModel.rows, 'right');

    resetScrollPositions();
    resizeCanvas();
    drawConnections();
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    connections = [];

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
    drawConnections();
}

function renderTwoWayRows(container, rows, side) {
    container.innerHTML = rows.map((row, index) => {
        const cell = row[side];
        const lineNumber = cell.lineNumber === null ? '' : `<span class="line-number">${cell.lineNumber}</span>`;
        const content = cell.content.length === 0 ? '&nbsp;' : escapeHtml(cell.content);
        return `<div class="diff-line ${cell.kind}" data-row="${index}">${lineNumber}<span class="line-text">${content}</span></div>`;
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
        let kind = 'context';

        if (line === '<<<<<<< LEFT' || line === '=======' || line === '>>>>>>> RIGHT') {
            kind = 'merge-marker';
        }

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
            const source = container;

            containers.forEach((other) => {
                if (other === source) {
                    return;
                }

                other.scrollTop = source.scrollTop;
                other.scrollLeft = source.scrollLeft;
            });

            drawConnections();
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

    connections.forEach((connection) => {
        if (connection.type === 'context') {
            drawContextConnection(connection.row, leftPanel, rightPanel, leftRect, rightRect, containerRect);
            return;
        }

        drawBoundaryConnection(connection, leftPanel, rightPanel, leftRect, rightRect, containerRect);
    });
}

function drawContextConnection(row, leftPanel, rightPanel, leftRect, rightRect, containerRect) {
    const leftLine = leftPanel.children[row];
    const rightLine = rightPanel.children[row];

    if (!leftLine || !rightLine) {
        return;
    }

    const leftLineRect = leftLine.getBoundingClientRect();
    const rightLineRect = rightLine.getBoundingClientRect();

    canvasContext.strokeStyle = 'rgba(128, 128, 128, 0.28)';
    canvasContext.lineWidth = 1;
    canvasContext.beginPath();
    canvasContext.moveTo(leftRect.right - containerRect.left, leftLineRect.top + leftLineRect.height / 2 - containerRect.top);
    canvasContext.lineTo(rightRect.left - containerRect.left, rightLineRect.top + rightLineRect.height / 2 - containerRect.top);
    canvasContext.stroke();
}

function drawBoundaryConnection(connection, leftPanel, rightPanel, leftRect, rightRect, containerRect) {
    const startLine = leftPanel.children[connection.row];
    const endLine = rightPanel.children[connection.targetRow];

    if (!startLine || !endLine) {
        return;
    }

    const startRect = startLine.getBoundingClientRect();
    const endRect = endLine.getBoundingClientRect();
    const startX = leftRect.right - containerRect.left;
    const endX = rightRect.left - containerRect.left;
    const startY = connection.direction === 'start'
        ? startRect.bottom - containerRect.top
        : startRect.top + startRect.height / 2 - containerRect.top;
    const endY = connection.direction === 'start'
        ? endRect.top - containerRect.top
        : endRect.top + endRect.height / 2 - containerRect.top;

    canvasContext.strokeStyle = 'rgba(233, 144, 2, 0.75)';
    canvasContext.lineWidth = 2;
    canvasContext.beginPath();
    canvasContext.moveTo(startX, startY);
    canvasContext.bezierCurveTo(
        startX + (endX - startX) * 0.35, startY,
        startX + (endX - startX) * 0.65, endY,
        endX, endY
    );
    canvasContext.stroke();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
