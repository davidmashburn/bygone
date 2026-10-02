// Render the supported inline Markdown without accepting authored HTML.
// Source offsets stay in the original prose so narration highlighting can
// coexist with links whose URL and Markdown punctuation are not displayed.
export function renderTourProse(document, text, segments = []) {
    const children = [];
    const pattern = /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gu;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
        if (match.index > 0 && text[match.index - 1] === '!') continue;
        let url;
        try { url = new URL(match[2]); } catch { continue; }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        children.push(...renderRange(document, text, offset, match.index, segments));
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const labelStart = match.index + 1;
        link.replaceChildren(...renderRange(document, text, labelStart, labelStart + match[1].length, segments));
        children.push(link);
        offset = match.index + match[0].length;
    }
    children.push(...renderRange(document, text, offset, text.length, segments));
    return children;
}

function renderRange(document, text, start, end, segments) {
    const children = [];
    let offset = start;
    for (const segment of segments) {
        const from = Math.max(start, segment.startOffset);
        const to = Math.min(end, segment.endOffset);
        if (from >= to) continue;
        if (from > offset) children.push(document.createTextNode(text.slice(offset, from)));
        const span = document.createElement('span');
        span.className = 'tour-narration-segment';
        span.dataset.narrationSegmentId = segment.id;
        span.textContent = text.slice(from, to);
        children.push(span);
        offset = to;
    }
    if (offset < end) children.push(document.createTextNode(text.slice(offset, end)));
    return children;
}
