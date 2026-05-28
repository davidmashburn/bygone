(function () {
    const VIEW_IDS = {
        twoWay: 'two-way-diff',
        threeWay: 'three-way-diff',
        multiWay: 'multi-way-diff',
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
        getElement(VIEW_IDS.multiWay).classList.toggle('hidden', activeId !== VIEW_IDS.multiWay);
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

    function renderDirectoryView(container, entries, labels = ['Left', 'Right']) {
        const columnTemplate = labels.map(() => 'minmax(0, 1fr)').join(' 96px ');
        const view = container.closest('.dir-view');
        const headers = view?.querySelector('.dir-headers');

        if (headers) {
            headers.style.gridTemplateColumns = columnTemplate;
            headers.innerHTML = labels.map((label, index) => {
                const isFirst = index === 0;
                const isLast = index === labels.length - 1;
                // Add buttons only meaningful on outermost columns
                const addLeftDisabled = !isFirst;
                const addRightDisabled = !isLast;
                // Remove must keep at least 2 columns (need a left/right to compare)
                const removeDisabled = labels.length <= 2;
                const header = `<div class="dir-col-header" data-side-index="${index}">`
                    + `<div class="multi-pane-header-top">`
                    + `<span class="multi-pane-title-wrap">`
                    + `<span class="multi-pane-title">${escapeHtml(label)}</span>`
                    + `</span>`
                    + `<span class="multi-pane-actions">`
                    + `<button class="multi-pane-action" type="button" data-dir-add-side="left" data-side-index="${index}" title="Add directory to the left" aria-label="Add directory to the left"${addLeftDisabled ? ' disabled' : ''}>+</button>`
                    + `<button class="multi-pane-action multi-pane-action-danger" type="button" data-dir-remove-side="${index}" title="Remove directory" aria-label="Remove directory"${removeDisabled ? ' disabled' : ''}>×</button>`
                    + `<button class="multi-pane-action" type="button" data-dir-add-side="right" data-side-index="${index}" title="Add directory to the right" aria-label="Add directory to the right"${addRightDisabled ? ' disabled' : ''}>+</button>`
                    + `</span>`
                    + `</div>`
                    + `</div>`;
                return index < labels.length - 1
                    ? `${header}<div class="dir-header-gutter" aria-hidden="true"></div>`
                    : header;
            }).join('');
        }

        container.style.gridTemplateColumns = columnTemplate;
        container.innerHTML = labels.map((_label, sideIndex) => {
            const rows = entries
                .filter((entry) => directoryEntryExistsOnSide(entry, sideIndex))
                .map((entry) => renderDirectoryEntry(entry, sideIndex));

            const column = `<div class="dir-column" data-side-index="${sideIndex}">${rows.join('')}</div>`;
            return sideIndex < labels.length - 1
                ? `${column}<div class="dir-gutter" aria-hidden="true"></div>`
                : column;
        }).join('');

        // Wire up directory fold toggles
        container.querySelectorAll('.dir-entry[data-is-dir="true"]').forEach((row) => {
            row.addEventListener('click', (event) => {
                const target = event.target;
                if (target.closest('.dir-toggle') || target === row || target.closest('.dir-entry-content')) {
                    const dirPath = row.dataset.path;
                    if (dirPath) {
                        toggleDirRow(container, dirPath);
                    }
                }
            });
        });

        container.querySelectorAll('.dir-entry[data-is-dir="false"]').forEach((row) => {
            row.addEventListener('click', () => {
                const relativePath = row.dataset.path;
                if (!relativePath) {
                    return;
                }

                container.dispatchEvent(new CustomEvent('bygone:directory-open-entry', {
                    detail: { relativePath }
                }));
            });
        });

        container.dispatchEvent(new CustomEvent('bygone:directory-layout-change'));
    }

    function renderDirectoryEntry(entry, sideIndex) {
        const indent = '\u00a0\u00a0'.repeat(entry.depth); // non-breaking spaces for indentation
        const isDir = entry.isDirectory;
        const nameClass = isDir ? 'dir-name dir-name--dir' : 'dir-name';
        const displayText = isDir ? entry.displayName + '/' : entry.displayName;

        const toggleHtml = isDir
            ? `<span class="dir-toggle" aria-label="toggle">▼</span>`
            : `<span class="dir-toggle dir-toggle--spacer"></span>`;

        const cellContent = `${toggleHtml}<span class="dir-indent">${indent}</span><span class="${nameClass}">${escapeHtml(displayText)}</span>`;

        return `<div class="dir-entry dir-entry--${entry.status}" `
            + `data-path="${escapeAttr(entry.relativePath)}" `
            + `data-depth="${entry.depth}" `
            + `data-side-index="${sideIndex}" `
            + `data-is-dir="${isDir}">`
            + `<div class="dir-entry-content">${cellContent}</div>`
            + `</div>`;
    }

    function directoryEntryExistsOnSide(entry, sideIndex) {
        if (Array.isArray(entry.sides)) {
            return Boolean(entry.sides[sideIndex]);
        }

        return sideIndex === 0
            ? entry.status !== 'right-only'
            : entry.status !== 'left-only';
    }

    function toggleDirRow(container, dirPath) {
        if (collapsedDirs.has(dirPath)) {
            collapsedDirs.delete(dirPath);
        } else {
            collapsedDirs.add(dirPath);
        }
        applyDirectoryVisibility(container);
    }

    function expandAllDirectories(container) {
        collapsedDirs.clear();
        applyDirectoryVisibility(container);
    }

    function collapseAllDirectories(container, entries) {
        collapsedDirs.clear();
        for (const entry of entries || []) {
            if (entry?.isDirectory && typeof entry.relativePath === 'string') {
                collapsedDirs.add(entry.relativePath);
            }
        }
        applyDirectoryVisibility(container);
    }

    function collapseUnchangedDirectories(container, entries) {
        collapsedDirs.clear();
        for (const entry of entries || []) {
            if (entry?.isDirectory && entry.status === 'same' && typeof entry.relativePath === 'string') {
                collapsedDirs.add(entry.relativePath);
            }
        }
        applyDirectoryVisibility(container);
    }

    function applyDirectoryVisibility(container) {
        const rows = container.querySelectorAll('.dir-entry');

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

        container.dispatchEvent(new CustomEvent('bygone:directory-layout-change'));
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
        escapeHtml,
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
    };
}());
