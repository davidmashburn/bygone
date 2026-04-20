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
    const DIRECTORY_ADD_COLOR = {
        presentFill: 'rgba(73, 190, 119, 0.24)',
        absentFill: 'rgba(73, 190, 119, 0.08)',
        stroke: 'rgba(73, 190, 119, 0.92)'
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

            if (options.getMode() === 'directory') {
                drawDirectoryConnections();
                return;
            }

            if (options.getMode() === 'multi-way') {
                drawMultiWayConnections();
                return;
            }

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

        function drawMultiWayConnections() {
            const state = options.getMultiDiffState?.();
            if (!state || state.editors.length < 2 || state.pairs.length === 0) {
                return;
            }

            const containerRect = connectionCanvas.getBoundingClientRect();

            state.pairs.forEach((pair) => {
                const leftEditor = state.editors[pair.leftIndex];
                const rightEditor = state.editors[pair.rightIndex];
                if (!leftEditor || !rightEditor) {
                    return;
                }

                const leftRect = leftEditor.getDomNode().getBoundingClientRect();
                const rightRect = rightEditor.getDomNode().getBoundingClientRect();

                for (const block of pair.diffModel.blocks || []) {
                    drawBlockRegion(block, leftEditor, rightEditor, leftRect, rightRect, containerRect);
                }
            });
        }

        function drawDirectoryConnections() {
            const entries = options.getDirectoryEntries?.() || [];
            if (entries.length === 0) {
                return;
            }

            const rowsContainer = options.getElement('dir-rows');
            const columns = Array.from(rowsContainer.querySelectorAll('.dir-column'));
            if (columns.length < 2) {
                return;
            }

            const containerRect = connectionCanvas.getBoundingClientRect();
            const rowsViewportRect = rowsContainer.getBoundingClientRect();

            canvasContext.save();
            canvasContext.beginPath();
            canvasContext.rect(
                rowsViewportRect.left - containerRect.left,
                rowsViewportRect.top - containerRect.top,
                rowsViewportRect.width,
                rowsViewportRect.height
            );
            canvasContext.clip();

            for (let pairIndex = 0; pairIndex < columns.length - 1; pairIndex++) {
                const leftRect = columns[pairIndex].getBoundingClientRect();
                const rightRect = columns[pairIndex + 1].getBoundingClientRect();

                entries.forEach((entry, index) => {
                    const leftExists = directoryEntryExistsOnSide(entry, pairIndex);
                    const rightExists = directoryEntryExistsOnSide(entry, pairIndex + 1);
                    if (leftExists === rightExists) {
                        return;
                    }

                    const presentSideIndex = leftExists ? pairIndex : pairIndex + 1;
                    const absentSideIndex = leftExists ? pairIndex + 1 : pairIndex;
                    const presentRow = findDirectoryRow(rowsContainer, entry.relativePath, presentSideIndex);

                    if (!isVisibleDirectoryRow(presentRow)) {
                        return;
                    }

                    const boundaryY = getDirectoryBoundaryY(
                        entries,
                        index,
                        absentSideIndex,
                        rowsContainer,
                        leftExists ? rightRect : leftRect,
                        containerRect
                    );
                    if (boundaryY === undefined) {
                        return;
                    }

                    drawDirectoryAddConnector({
                        presentIsLeft: leftExists,
                        presentRect: presentRow.getBoundingClientRect(),
                        absentY: boundaryY,
                        leftRect,
                        rightRect,
                        containerRect
                    });
                });
            }

            canvasContext.restore();
        }

        function drawDirectoryAddConnector({ presentIsLeft, presentRect, absentY, leftRect, rightRect, containerRect }) {
            const presentColumnRect = presentIsLeft ? leftRect : rightRect;
            const absentColumnRect = presentIsLeft ? rightRect : leftRect;
            const presentBounds = {
                x: presentIsLeft
                    ? presentColumnRect.right - containerRect.left + 2
                    : presentColumnRect.left - containerRect.left - 2,
                top: presentRect.top - containerRect.top + 1,
                bottom: presentRect.bottom - containerRect.top - 1
            };
            const absentBounds = {
                x: presentIsLeft
                    ? absentColumnRect.left - containerRect.left - 2
                    : absentColumnRect.right - containerRect.left + 2,
                top: absentY,
                bottom: absentY
            };
            const leftBounds = presentIsLeft ? presentBounds : absentBounds;
            const rightBounds = presentIsLeft ? absentBounds : presentBounds;
            const cpOffset = Math.abs(rightBounds.x - leftBounds.x) * 0.35;
            const gradient = canvasContext.createLinearGradient(leftBounds.x, 0, rightBounds.x, 0);

            if (presentIsLeft) {
                gradient.addColorStop(0, DIRECTORY_ADD_COLOR.presentFill);
                gradient.addColorStop(1, DIRECTORY_ADD_COLOR.absentFill);
            } else {
                gradient.addColorStop(0, DIRECTORY_ADD_COLOR.absentFill);
                gradient.addColorStop(1, DIRECTORY_ADD_COLOR.presentFill);
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
            strokeConnectorEdges(leftBounds, rightBounds, cpOffset, DIRECTORY_ADD_COLOR.stroke);
            strokePaneOutline(presentColumnRect, containerRect, presentBounds.top, presentBounds.bottom, DIRECTORY_ADD_COLOR.stroke);
            drawBoundaryGuide(absentColumnRect, containerRect, absentY, DIRECTORY_ADD_COLOR.stroke);
        }

        function getDirectoryBoundaryY(entries, targetIndex, side, rowsContainer, sideRect, containerRect) {
            const previousRow = findNearestDirectoryRow(entries, targetIndex, -1, side, rowsContainer);
            const nextRow = findNearestDirectoryRow(entries, targetIndex, 1, side, rowsContainer);

            if (previousRow && nextRow) {
                const previousRect = previousRow.getBoundingClientRect();
                const nextRect = nextRow.getBoundingClientRect();
                return ((previousRect.bottom + nextRect.top) / 2) - containerRect.top;
            }

            if (previousRow) {
                return previousRow.getBoundingClientRect().bottom - containerRect.top;
            }

            if (nextRow) {
                return nextRow.getBoundingClientRect().top - containerRect.top;
            }

            return sideRect.top - containerRect.top + 12;
        }

        function findNearestDirectoryRow(entries, targetIndex, step, side, rowsContainer) {
            for (let index = targetIndex + step; index >= 0 && index < entries.length; index += step) {
                const entry = entries[index];
                if (!directoryEntryExistsOnSide(entry, side)) {
                    continue;
                }

                const row = findDirectoryRow(rowsContainer, entry.relativePath, side);
                if (isVisibleDirectoryRow(row)) {
                    return row;
                }
            }

            return undefined;
        }

        function directoryEntryExistsOnSide(entry, sideIndex) {
            if (Array.isArray(entry.sides)) {
                return Boolean(entry.sides[sideIndex]);
            }

            return sideIndex === 0
                ? entry.status !== 'right-only'
                : entry.status !== 'left-only';
        }

        function findDirectoryRow(rowsContainer, relativePath, sideIndex) {
            return Array.from(rowsContainer.querySelectorAll(`.dir-entry[data-side-index="${sideIndex}"]`))
                .find((row) => row.dataset.path === relativePath);
        }

        function isVisibleDirectoryRow(row) {
            return Boolean(row) && row.offsetParent !== null;
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
