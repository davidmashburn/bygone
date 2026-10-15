/* global module */

function dedupeDecorations(decorations) {
    const seen = new Set();
    return decorations.filter((decoration) => {
        const range = decoration.range;
        const options = decoration.options || {};
        const key = [
            range.startLineNumber,
            range.startColumn,
            range.endLineNumber,
            range.endColumn,
            options.className || '',
            options.blockClassName || '',
            options.inlineClassName || '',
            options.linesDecorationsClassName || '',
            options.marginClassName || ''
        ].join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

// Shared panels receive ranges from both adjacent comparisons. Merge only change
// paint: selection, tour annotations and collapsed boundaries retain their identity.
function unionChangeDecorations(decorations) {
    const result = [];
    const groups = new Map();
    for (const decoration of decorations) {
        const options = decoration.options || {};
        const inline = options.inlineClassName === 'bygone-inline-blue';
        const wholeLine = options.className === 'bygone-paired-line'
            || options.blockClassName === 'bygone-paired-line-outline'
            || options.className === 'bygone-one-sided-line'
            || options.blockClassName === 'bygone-one-sided-line-outline';
        if ((!inline && !wholeLine)
            || (inline && decoration.range.startLineNumber !== decoration.range.endLineNumber)) {
            result.push(decoration);
            continue;
        }
        // Keep differently configured decorations separate even when their colors match.
        const key = JSON.stringify(options);
        if (!groups.has(key)) groups.set(key, { inline, items: [] });
        groups.get(key).items.push({ ...decoration, range: { ...decoration.range } });
    }
    for (const { inline, items } of groups.values()) {
        items.sort((a, b) => a.range.startLineNumber - b.range.startLineNumber
            || a.range.startColumn - b.range.startColumn);
        let previous;
        for (const item of items) {
            const a = previous?.range;
            const b = item.range;
            const overlaps = a && (inline
                ? a.startLineNumber === b.startLineNumber && b.startColumn <= a.endColumn
                : b.startLineNumber <= a.endLineNumber + 1);
            if (overlaps) {
                if (inline) a.endColumn = Math.max(a.endColumn, b.endColumn);
                else if (b.endLineNumber > a.endLineNumber) {
                    a.endLineNumber = b.endLineNumber;
                    a.endColumn = b.endColumn;
                }
            } else {
                result.push(item);
                previous = item;
            }
        }
    }
    // A shared line may be inserted relative to one neighbor and replaced relative
    // to the other. Show replacement blue there, without stacking a green fill or
    // outline underneath. Focus mode naturally restores the selected pair's color.
    const replacements = result.filter(d => d.options?.className === 'bygone-paired-line')
        .map(d => d.range).sort((a, b) => a.startLineNumber - b.startLineNumber);
    const resolved = result.flatMap(decoration => {
        const options = decoration.options || {};
        if (options.className !== 'bygone-one-sided-line'
            && options.blockClassName !== 'bygone-one-sided-line-outline') return [decoration];
        const range = decoration.range;
        const pieces = [];
        let start = range.startLineNumber;
        for (const blue of replacements) {
            if (blue.endLineNumber < start) continue;
            if (blue.startLineNumber > range.endLineNumber) break;
            if (blue.startLineNumber > start) pieces.push({ ...decoration, range: {
                ...range, startLineNumber: start, endLineNumber: blue.startLineNumber - 1,
                endColumn: Number.MAX_SAFE_INTEGER
            } });
            start = Math.max(start, blue.endLineNumber + 1);
        }
        if (start <= range.endLineNumber) pieces.push({ ...decoration, range: { ...range, startLineNumber: start } });
        return pieces;
    });
    return dedupeDecorations(resolved);
}

module.exports = {
    dedupeDecorations,
    unionChangeDecorations
};
