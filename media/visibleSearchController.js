/* global module */

function findVisibleMatches(targets, query, options = {}) {
    const text = String(query || '');
    if (!text) return [];
    const limit = Number.isInteger(options.limit) ? options.limit : 500;
    const matches = [];
    for (const target of targets || []) {
        const model = target?.editor?.getModel?.();
        if (!model || typeof model.findMatches !== 'function') continue;
        const remaining = limit - matches.length;
        if (remaining <= 0) break;
        const found = model.findMatches(
            text,
            false,
            Boolean(options.regex),
            Boolean(options.caseSensitive),
            null,
            false,
            remaining
        );
        for (const match of found) {
            matches.push({
                targetId: target.id,
                label: target.label,
                editor: target.editor,
                range: match.range,
                preview: model.getLineContent?.(match.range.startLineNumber) || '',
                lineNumber: match.range.startLineNumber
            });
        }
    }
    return matches;
}

module.exports = { findVisibleMatches };
