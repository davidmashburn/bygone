(function () {
    const VIEW_IDS = {
        twoWay: 'two-way-diff',
        threeWay: 'three-way-diff',
        directory: 'directory-diff'
    };

    // Tracks which directory paths are currently collapsed.
    // Reset on each new directory diff load.
    const collapsedDirs = new Set();

    function getElement(id) {
        return document.getElementById(id);
    }

    function setTextContent(id, text) {
        getElement(id).textContent = text;
    }

    function clearHistoryToolbar() {
        setTextContent('history-position', '');
        setTextContent('history-left-commit', '');
        setTextContent('history-left-time', '');
        setTextContent('history-right-commit', '');
        setTextContent('history-right-time', '');
    }

    function renderPlainLines(container, lines) {
        renderLines(container, lines, () => 'context');
    }

    function renderResultLines(container, lines) {
        renderLines(container, lines, (line) => (
            line === '<<<<<<< LEFT' || line === '=======' || line === '>>>>>>> RIGHT'
                ? 'merge-marker'
                : 'context'
        ));
    }

    function renderLines(container, lines, kindForLine) {
        container.innerHTML = lines.map((line, index) => {
            const kind = kindForLine(line, index);
            const content = line.length === 0 ? '&nbsp;' : escapeHtml(line);
            return `<div class="diff-line ${kind}"><span class="line-number">${index + 1}</span><span class="line-text">${content}</span></div>`;
        }).join('');
    }

    function toggleView(activeId) {
        getElement(VIEW_IDS.twoWay).classList.toggle('hidden', activeId !== VIEW_IDS.twoWay);
        getElement(VIEW_IDS.threeWay).classList.toggle('hidden', activeId !== VIEW_IDS.threeWay);
        getElement(VIEW_IDS.directory).classList.toggle('hidden', activeId !== VIEW_IDS.directory);
    }

    function setStatus(text, visible) {
        const banner = getElement('status-banner');
        banner.hidden = !visible;
        banner.textContent = text;
    }

    function resetScrollPositions() {
        document.querySelectorAll('.file-content').forEach((container) => {
            container.scrollTop = 0;
            container.scrollLeft = 0;
        });
    }

    // ── Directory view ────────────────────────────────────────────────────────

    function resetDirectoryView() {
        collapsedDirs.clear();
    }

    function renderDirectoryView(container, entries) {
        const rows = entries.map((entry) => {
            const indent = '\u00a0\u00a0'.repeat(entry.depth); // non-breaking spaces for indentation
            const isDir = entry.isDirectory;
            const nameClass = isDir ? 'dir-name dir-name--dir' : 'dir-name';
            const displayText = isDir ? entry.displayName + '/' : entry.displayName;

            const toggleHtml = isDir
                ? `<span class="dir-toggle" aria-label="toggle">▼</span>`
                : `<span class="dir-toggle dir-toggle--spacer"></span>`;

            const cellContent = `${toggleHtml}<span class="dir-indent">${indent}</span><span class="${nameClass}">${escapeHtml(displayText)}</span>`;
            const emptyCellContent = `<span class="dir-cell-absent"></span>`;

            const leftCell = entry.status !== 'right-only' ? cellContent : emptyCellContent;
            const rightCell = entry.status !== 'left-only' ? cellContent : emptyCellContent;

            return `<div class="dir-row dir-row--${entry.status}" `
                + `data-path="${escapeAttr(entry.relativePath)}" `
                + `data-depth="${entry.depth}" `
                + `data-is-dir="${isDir}">`
                + `<div class="dir-cell dir-cell-left">${leftCell}</div>`
                + `<div class="dir-cell dir-cell-right">${rightCell}</div>`
                + `</div>`;
        });

        container.innerHTML = rows.join('');

        // Wire up directory fold toggles
        container.querySelectorAll('.dir-row[data-is-dir="true"]').forEach((row) => {
            row.addEventListener('click', (event) => {
                // Only handle clicks on the row itself or the toggle, not propagated from children
                const target = event.target;
                if (target.closest('.dir-toggle') || target === row || target.closest('.dir-cell')) {
                    const dirPath = row.dataset.path;
                    if (dirPath) {
                        toggleDirRow(container, dirPath);
                    }
                }
            });
        });
    }

    function toggleDirRow(container, dirPath) {
        if (collapsedDirs.has(dirPath)) {
            collapsedDirs.delete(dirPath);
        } else {
            collapsedDirs.add(dirPath);
        }
        applyDirectoryVisibility(container);
    }

    function applyDirectoryVisibility(container) {
        const rows = container.querySelectorAll('.dir-row');

        rows.forEach((row) => {
            const rowPath = row.dataset.path;
            const hidden = isHiddenByAncestor(rowPath);
            row.style.display = hidden ? 'none' : '';

            // Update toggle arrows for directory rows
            if (row.dataset.isDir === 'true') {
                const collapsed = collapsedDirs.has(rowPath);
                row.querySelectorAll('.dir-toggle').forEach((t) => {
                    t.textContent = collapsed ? '▶' : '▼';
                });
            }
        });
    }

    function isHiddenByAncestor(rowPath) {
        let current = rowPath;
        while (true) {
            const parent = getParentDirPath(current);
            if (parent === null) {
                return false;
            }
            if (collapsedDirs.has(parent)) {
                return true;
            }
            current = parent;
        }
    }

    function getParentDirPath(entryPath) {
        // "src/file.ts"   -> "src/"
        // "src/sub/"      -> "src/"
        // "src/"          -> null  (top-level dir)
        // "file.ts"       -> null  (top-level file)
        const withoutTrailing = entryPath.endsWith('/') ? entryPath.slice(0, -1) : entryPath;
        const slash = withoutTrailing.lastIndexOf('/');
        return slash === -1 ? null : withoutTrailing.slice(0, slash + 1);
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeAttr(text) {
        return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    window.BygoneDom = {
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
    };
}());
