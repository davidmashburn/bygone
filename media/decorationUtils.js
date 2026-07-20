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

module.exports = {
    dedupeDecorations
};
