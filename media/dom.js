(function () {
    const VIEW_IDS = {
        twoWay: 'two-way-diff',
        threeWay: 'three-way-diff'
    };

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

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    window.MeldenDom = {
        VIEW_IDS,
        getElement,
        setTextContent,
        clearHistoryToolbar,
        renderPlainLines,
        renderResultLines,
        toggleView,
        setStatus,
        resetScrollPositions
    };
})();
