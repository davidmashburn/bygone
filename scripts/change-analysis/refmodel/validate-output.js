const CATALOG = ['Add Method Parameter', 'Remove Method Parameter', 'Rename Method', 'Rename Class', 'Rename Package', 'Rename Field', 'Extract Class', 'Extract Superclass', 'Inline Method', 'Pull Up Method', 'Push Down Method', 'Pull Up Field', 'Push Down Field', 'Inline Class', 'Extract Interface', 'Move Method', 'Move Field', 'Replace Magic Number with Constant', 'Encapsulate Field'];
function validateOutput(text, before, after, evidence) {
    let value;
    try { value = JSON.parse(text); } catch { return { valid: false, errors: ['invalid-json'], proposals: [] }; }
    const errors = [], proposals = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['invalid-object'], proposals: [] };
    if (!Array.isArray(value.operations) || value.operations.length > 6) errors.push('operations-shape');
    if (!Array.isArray(value.additionalEdits) || value.additionalEdits.length > 5) errors.push('edits-shape');
    if (!Array.isArray(value.uncertainties) || value.uncertainties.length > 5 || !value.uncertainties.every(s => typeof s === 'string')) errors.push('uncertainties-shape');
    if (value.behavior !== 'unassessed') errors.push('behavior-claim');
    const ids = new Map(['before', 'after'].flatMap(side => evidence.inventory[side].map(e => [e.id, { ...e, side }])));
    const hints = new Set([...evidence.correspondences, ...evidence.groups].map(p => `${p.source}:${p.destination}`));
    function citations(items, label) {
        if (!Array.isArray(items) || !items.length) { errors.push(`${label}:missing-evidence`); return; }
        for (const item of items) {
            const files = item?.side === 'before' ? before : item?.side === 'after' ? after : null;
            if (!files || typeof item.path !== 'string' || !Object.hasOwn(files, item.path) || typeof item.quote !== 'string' || !item.quote.trim()) {
                errors.push(`${label}:invalid-evidence`); continue;
            }
            const haystack = files[item.path], first = haystack.indexOf(item.quote);
            if (first < 0) errors.push(`${label}:quote-not-found`);
            else if (haystack.indexOf(item.quote, first + 1) >= 0) errors.push(`${label}:ambiguous-quote`);
            if (item.symbolId) {
                const entry = ids.get(item.symbolId);
                if (!entry || entry.side !== item.side || entry.path !== item.path || first < entry.start || first + item.quote.length > entry.end) errors.push(`${label}:quote-id-mismatch`);
            }
        }
    }
    for (const [index, op] of (Array.isArray(value.operations) ? value.operations : []).entries()) {
        if (!op || !CATALOG.includes(op.type)) { errors.push(`operation-${index}:catalog`); continue; }
        if (typeof op.explanation !== 'string') errors.push(`operation-${index}:explanation`);
        let validIds = true;
        for (const [side, field] of [['before', 'sourceIds'], ['after', 'destinationIds']]) {
            if (!Array.isArray(op[field]) || !op[field].length || op[field].some(id => ids.get(id)?.side !== side)) {
                errors.push(`operation-${index}:invalid-${field}`); validIds = false;
            }
        }
        citations(op.evidence, `operation-${index}`);
        proposals.push({ type: op.type, validIds,
            hasMappingSupport: validIds && op.sourceIds.some(a => op.destinationIds.some(b => hints.has(`${a}:${b}`))) });
    }
    for (const [index, edit] of (Array.isArray(value.additionalEdits) ? value.additionalEdits : []).entries()) {
        if (!edit || typeof edit.explanation !== 'string') errors.push(`edit-${index}:explanation`);
        citations(edit?.evidence, `edit-${index}`);
    }
    return { valid: !errors.length, errors, proposals };
}
module.exports = { CATALOG, validateOutput };
