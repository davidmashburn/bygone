(function () {
    const BLOCK_COLORS = {
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
            stroke: 'rgba(79, 124, 255, 0.92)'
        }
    };

    function createConnectorController(options) {
        let connectionCanvas;
        let canvasContext;
        let drawScheduled = false;

        return {
            initializeCanvas,
            resizeCanvas,
            scheduleDrawConnections
        };

        function initializeCanvas() {
            connectionCanvas = document.getElementById('connection-canvas');

            if (!connectionCanvas) {
                connectionCanvas = document.createElement('canvas');
                connectionCanvas.id = 'connection-canvas';
                options.getElement('diff-container').appendChild(connectionCanvas);
            }

            canvasContext = connectionCanvas.getContext('2d');
            resizeCanvas();
        }

        function resizeCanvas() {
            if (!connectionCanvas) {
                return;
            }

            const container = options.getElement('diff-container');
            connectionCanvas.width = container.clientWidth;
            connectionCanvas.height = container.clientHeight;
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

        function drawConnections() {
            if (!canvasContext || !connectionCanvas) {
                return;
            }

            canvasContext.clearRect(0, 0, connectionCanvas.width, connectionCanvas.height);

            if (options.getMode() !== 'two-way') {
                return;
            }

            const { leftEditor, rightEditor } = options.getEditors();
            if (!leftEditor || !rightEditor) {
                return;
            }

            const diffBlocks = options.getDiffBlocks();
            const containerRect = connectionCanvas.getBoundingClientRect();
            const leftRect = leftEditor.getDomNode().getBoundingClientRect();
            const rightRect = rightEditor.getDomNode().getBoundingClientRect();

            diffBlocks.forEach((block) => {
                drawBlockRegion(block, leftEditor, rightEditor, leftRect, rightRect, containerRect);
            });
        }

        function drawBlockRegion(block, leftEditor, rightEditor, leftRect, rightRect, containerRect) {
            const leftBounds = getBlockBounds(leftEditor, block.leftStart, block.leftEnd, leftRect, containerRect, true);
            const rightBounds = getBlockBounds(rightEditor, block.rightStart, block.rightEnd, rightRect, containerRect, false);

            if (!leftBounds || !rightBounds) {
                return;
            }

            const cpOffset = (rightBounds.x - leftBounds.x) * 0.35;
            const color = BLOCK_COLORS[block.kind] || BLOCK_COLORS.replace;
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

            gradient.addColorStop(0, color.leftFill);
            gradient.addColorStop(1, color.rightFill);

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
                strokeReplaceBlockOutline(leftBounds, rightBounds, cpOffset, leftRect, rightRect, containerRect, color.stroke);
                return;
            }

            strokeConnectorEdges(leftBounds, rightBounds, cpOffset, color.stroke);
            strokeBlockOutline(color.stroke, leftBounds, rightBounds, leftRect, rightRect, containerRect);

            if (collapsesLeft) {
                drawBoundaryGuide(leftRect, containerRect, leftBounds.top, color.stroke);
            }

            if (collapsesRight) {
                drawBoundaryGuide(rightRect, containerRect, rightBounds.top, color.stroke);
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
            const lineHeight = editor.getOption(options.getMonaco().editor.EditorOption.lineHeight);
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
                + editor.getOption(options.getMonaco().editor.EditorOption.lineHeight);
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
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(value, max));
    }

    window.BygoneConnectors = {
        createConnectorController
    };
})();
