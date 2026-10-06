/* global module */

const mapCache = new WeakMap();
const fallbackCache = new WeakMap();

function buildScrollMaps(rows, side) {
    const lineToRow = [];
    const boundaryCounts = [0];
    rows.forEach((row, index) => {
        const cell = row[side];
        const hasLine = cell.kind !== 'placeholder' && cell.lineNumber !== null;
        if (hasLine) lineToRow[cell.lineNumber - 1] = index;
        boundaryCounts.push(boundaryCounts[index] + Number(hasLine));
    });
    return { lineToRow, boundaryCounts };
}

// Positions are fractional, zero-based model lines. Unchanged lines retain
// their correspondence regardless of changes elsewhere in either document.
function mapLinePosition(position, sourceSide, model) {
    if (!model?.rows?.length) return position;
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    if (model.quality === 'fallback') {
        // A timed-out diff has no matched rows. Retain provable common edges,
        // and interpolate only the unresolved middle instead of mapping to zero.
        let edges = fallbackCache.get(model);
        if (!edges) {
            const left = model.leftLines;
            const right = model.rightLines;
            const limit = Math.min(left.length, right.length);
            let prefix = 0;
            while (prefix < limit && left[prefix].content === right[prefix].content) prefix++;
            let suffix = 0;
            while (suffix < limit - prefix && left[left.length - suffix - 1].content === right[right.length - suffix - 1].content) suffix++;
            edges = { prefix, left: left.length - suffix, right: right.length - suffix };
            fallbackCache.set(model, edges);
        }
        if (position < edges.prefix) return position;
        if (position >= edges[sourceSide]) return edges[targetSide] + position - edges[sourceSide];
        return edges.prefix + (position - edges.prefix) / (edges[sourceSide] - edges.prefix)
            * (edges[targetSide] - edges.prefix);
    }
    for (const block of model.reflows || model.blocks || []) {
        if (!block.reflow) continue;
        const start = block[`${sourceSide}Start`];
        const end = block[`${sourceSide}End`];
        if (position >= start && position < end) {
            const targetStart = block[`${targetSide}Start`];
            return targetStart + (position - start) / (end - start)
                * (block[`${targetSide}End`] - targetStart);
        }
    }
    let maps = mapCache.get(model);
    if (!maps) {
        maps = { left: buildScrollMaps(model.rows, 'left'), right: buildScrollMaps(model.rows, 'right') };
        mapCache.set(model, maps);
    }
    const source = maps[sourceSide];
    const target = maps[targetSide];
    const index = Math.max(0, Math.floor(position));
    const row = source.lineToRow[index];
    if (row === undefined) return target.boundaryCounts[model.rows.length];
    return target.boundaryCounts[row] + (position - index)
        * (target.boundaryCounts[row + 1] - target.boundaryCounts[row]);
}

function mapMultiPanelLinePositions(position, sourceIndex, panelCount, pairs) {
    const positions = new Array(panelCount);
    positions[sourceIndex] = position;
    for (const direction of [-1, 1]) {
        for (let index = sourceIndex; index + direction >= 0 && index + direction < panelCount; index += direction) {
            const next = index + direction;
            const pair = pairs.find((candidate) => candidate.leftIndex === Math.min(index, next)
                && candidate.rightIndex === Math.max(index, next));
            positions[next] = mapLinePosition(positions[index], direction > 0 ? 'left' : 'right', pair?.diffModel);
        }
    }
    return positions;
}

function scrollTopToModelLinePosition(editor, scrollTop) {
    const lineCount = editor.getModel()?.getLineCount() || 0;
    if (!lineCount) return 0;
    let lo = 1;
    let hi = lineCount;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (editor.getTopForLineNumber(mid) <= scrollTop) lo = mid;
        else hi = mid - 1;
    }
    const top = editor.getTopForLineNumber(lo);
    const height = Math.max(1, editor.getBottomForLineNumber(lo) - top);
    // A wrapped line still occupies one model line, however tall it is.
    return lo - 1 + Math.max(0, Math.min(1, (scrollTop - top) / height));
}

function modelLinePositionToScrollTop(editor, position) {
    const lineCount = editor.getModel()?.getLineCount() || 0;
    if (!lineCount) return 0;
    if (position >= lineCount) return editor.getBottomForLineNumber(lineCount);
    const index = Math.max(0, Math.floor(position));
    const top = editor.getTopForLineNumber(index + 1);
    const height = Math.max(0, editor.getBottomForLineNumber(index + 1) - top);
    return top + Math.max(0, position - index) * height;
}

module.exports = { mapLinePosition, mapMultiPanelLinePositions, scrollTopToModelLinePosition, modelLinePositionToScrollTop };
