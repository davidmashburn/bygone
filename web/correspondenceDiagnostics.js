const categories = [
    ['outside', 'Outside analysis', 'path exclusions', 'Files excluded from this search. Unchanged files may also be outside its scope.'],
    ['syntax', 'Syntax not inventoried', 'syntax records', 'Syntax the independent inventory did not turn into symbols. These records are not a count of missing functions.'],
    ['rejected', 'Engine candidates rejected', 'engine records', 'Producer containers that could not be accepted against the independent inventory. One record may cover two endpoints.'],
    ['unmatched', 'No accepted match', 'symbols', 'Unmatched does not establish an addition or deletion. Ambiguous groups list competing endpoints without choosing an origin.'],
    ['relationship', 'Other detected relationships', 'relationship records', 'Extraction or inline evidence can be inspected at its endpoints, but is not navigable as an accepted continuation.'],
    ['problem', 'Analysis problems', 'problem records', 'Recorded parser or engine problems. Partial searches can omit competing origins.']
];

const reasons = {
    'unsupported-language': 'Language is outside the supported inventory.',
    'non-regular-file': 'Path is not a regular source file.',
    'destructured-binding': 'Destructured binding is not inventoried as an independent symbol.',
    'unsupported-class-member': 'Class member form is not inventoried.',
    'namespace-members-not-enumerated': 'Members inside this namespace are not enumerated.',
    'unmodeled-top-level-statement': 'Top-level statement is not inventoried; callbacks inside it have no independent symbol.',
    'python-lambda-not-inventoried': 'Python lambda is not inventoried as an independent symbol.',
    'python-binding-not-inventoried': 'Python binding is outside the declaration inventory.',
    'python-top-level-expression-not-inventoried': 'Python top-level expression is outside the declaration inventory.',
    'unresolved-container': 'One or both engine containers could not be resolved to an independent symbol.',
    'invalid-container-range': 'Engine range, text, or digest failed source validation.',
    'no-inventoried-container': 'No inventoried container of the required kind in this file.',
    'container-name-mismatch': 'Engine name does not match an eligible inventoried declaration.',
    'container-boundary-mismatch': 'Engine boundaries do not match an eligible declaration range.',
    'multiple-inventory-containers': 'More than one inventory container matches these boundaries.',
    'resolved-container': 'This endpoint resolves; the other endpoint prevented acceptance.',
    'engine-skipped-document': 'Engine did not process this inventoried document.',
    'parser-diagnostic': 'Inventory parser reported a problem.',
    'engine-incomplete': 'Engine analysis did not finish completely.',
    'engine-truncated': 'Engine output was truncated.',
    'invalid-statement-range': 'An engine statement mapping failed source validation.',
    'invalid-unmapped-range': 'An engine unmapped statement failed source validation.',
    'repeated-exact-occurrences': 'Repeated identical declarations leave competing origins.',
    'conflicting-continuations': 'Candidates compete for the same continuation.',
    'incomplete-analysis': 'Candidate withheld because the search was incomplete.',
    'no-per-symbol-explanation': 'No accepted match. The producer supplied no per-symbol explanation.',
    'no-candidate-supplied': 'No continuation candidate was supplied for this inventoried symbol. The engine gave no explanation; origins outside the search remain unknown.',
    'candidate-endpoint-rejected': 'An engine candidate named this symbol, but its other endpoint failed inventory validation. See Engine candidates rejected.',
    'relationship-without-continuation': 'Only extraction or inline evidence was supplied; no continuation was accepted.',
    'ambiguous-symbol': 'Symbol belongs to an unresolved candidate group below.',
    extract: 'Extraction relationship detected; behavior unassessed.',
    inline: 'Inline relationship detected; behavior unassessed.'
};

export const diagnosticReason = reason => reasons[reason] || `Recorded reason: ${reason}`;

/** Counts are category-specific, never a coverage percentage or an additive total. */
export function buildCorrespondenceDiagnostics(evidence) {
    const paired = new Set(evidence.relations.flatMap(r => [r.sourceId, r.destinationId]));
    const ambiguous = new Set(evidence.unresolved.flatMap(g => [...g.sourceIds, ...g.destinationIds]));
    const entries = new Map();
    for (const side of ['before', 'after']) for (const entry of evidence.symbols[side]) entries.set(entry.id, { ...entry, side });
    const locate = id => { const e = entries.get(id); return { path: e.path, side: e.side, line: e.startLine, symbolId: id }; };
    const recorded = new Map((evidence.diagnostics?.records || []).filter(r => r.category === 'unmatched')
        .flatMap(r => r.locations.filter(l => l.symbolId).map(l => [l.symbolId, r])));
    const unmatched = [...entries.values()].filter(e => !paired.has(e.id)).map(e => ({
        reason: ambiguous.has(e.id) ? 'ambiguous-symbol' : recorded.get(e.id)?.reason || 'no-per-symbol-explanation', locations: [locate(e.id)]
    }));
    const originRecords = (evidence.diagnostics?.records || []).filter(r => r.category === 'unmatched' && r.reason === 'repeated-exact-occurrences');
    const groups = evidence.unresolved.map(group => {
        const ids = [...group.sourceIds, ...group.destinationIds];
        const context = originRecords.find(r => r.reason === group.reason && ids.every(id => r.locations.some(l => l.symbolId === id)));
        return { reason: group.reason, message: context?.message || 'Ambiguous group: inspect each competing endpoint.',
            locations: context?.locations || ids.map(locate) };
    });
    return categories.map(([category, title, unit, description]) => ({ category, title, description,
        count: category === 'unmatched' ? `${unmatched.length} ${unit} · ${groups.length} ambiguous groups`
            : evidence.diagnostics ? `${evidence.diagnostics.records.filter(r => r.category === category).length} ${unit}` : 'details unavailable',
        records: category === 'unmatched' ? [...unmatched, ...groups] : (evidence.diagnostics?.records || []).filter(r => r.category === category) }));
}
