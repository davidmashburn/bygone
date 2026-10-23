const Diff = require('diff');
const { digest, inventorySnapshot } = require('./symbol-inventory');

function validateSpan(span, files) {
    if (!span || !Object.hasOwn(files, span.path)) return false;
    const text = files[span.path];
    return span.valid === true && Number.isInteger(span.start) && Number.isInteger(span.end)
        && span.start >= 0 && span.end > span.start && span.end <= text.length
        && text.slice(span.start, span.end) === span.text && digest(span.text) === span.sha256;
}

function normalizeMappings(before, after, native, options = {}) {
    const inventories = { before: inventorySnapshot(before, 'before'), after: inventorySnapshot(after, 'after') };
    const allEntries = [...inventories.before.entries, ...inventories.after.entries];
    const byId = new Map(allEntries.map(e => [e.id, e]));
    const comparisonKey = digest(JSON.stringify([inventories.before.snapshotId, inventories.after.snapshotId, 'mappings-v1', inventories.before.parser]));
    const issues = [], rejected = [], candidates = [], groups = [];
    const invalidDocuments = [...inventories.before.documents, ...inventories.after.documents].filter(d => d.status === 'invalid');
    const engineComplete = native?.status === 'complete' && !native.truncated && !invalidDocuments.length;
    function endpoint(span, side, category = 'callable') {
        if (!validateSpan(span, side === 'before' ? before : after)) return null;
        const entries = inventories[side].entries.filter(e => {
            if (e.path !== span.path || (category === 'callable' ? !e.callable : !['class', 'interface', 'type', 'enum'].includes(e.kind))) return false;
            const engineName = category === 'callable' ? span.name : span.name?.split('.').at(-1);
            if (engineName && engineName !== e.name && !(e.name === 'default' && engineName === 'anonymous')) return false;
            return e.engineRanges.some(range => range.end === span.end && range.start <= span.start
                && /^(?:(?:export|default|declare|async|abstract|public|private|protected|static|readonly|override)\b|\s)*$/.test((side === 'before' ? before : after)[e.path].slice(range.start, span.start)));
        });
        return entries.length === 1 ? entries[0] : null;
    }
    const classMappers = (native?.classMappings || []).map(c => ({ ...c, category: 'type', origins: ['continuation'], mappings: [] }));
    for (const mapper of [...(native?.mappers || []), ...classMappers]) {
        const source = endpoint(mapper.source, 'before', mapper.category), destination = endpoint(mapper.destination, 'after', mapper.category);
        if (!source || !destination) {
            if (!validateSpan(mapper.source, before) || !validateSpan(mapper.destination, after)) issues.push({ mapperId: mapper.id, reason: 'invalid-container-range' });
            rejected.push({ mapperId: mapper.id, reason: 'unresolved-container', source: mapper.source, destination: mapper.destination });
            continue;
        }
        const mappings = [], unmappedBefore = [], unmappedAfter = [];
        for (const mapping of mapper.mappings || []) {
            if (validateSpan(mapping.source, before) && validateSpan(mapping.destination, after)) {
                mappings.push({ ...mapping, rawEqual: mapping.source.text === mapping.destination.text });
            } else issues.push({ mapperId: mapper.id, reason: 'invalid-statement-range', mapping });
        }
        for (const [side, fields, output] of [
            ['before', ['unmappedBefore', 'unmappedInnerBefore'], unmappedBefore],
            ['after', ['unmappedAfter', 'unmappedInnerAfter'], unmappedAfter]
        ]) {
            for (const field of fields) for (const span of mapper[field] || []) {
                if (validateSpan(span, side === 'before' ? before : after)) output.push(span);
                else issues.push({ mapperId: mapper.id, reason: 'invalid-unmapped-range', side, span });
            }
        }
        const evidence = { mapperId: mapper.id, source: mapper.source, destination: mapper.destination,
            mappings, unmappedBefore, unmappedAfter, origins: mapper.origins };
        const kind = mapper.origins.includes('extract') ? 'extract' : mapper.origins.includes('inline') ? 'inline' : 'continuation';
        if (kind !== 'continuation') {
            groups.push({ kind, sourceId: source.id, destinationId: destination.id, evidence,
                status: engineComplete ? 'inferred' : 'unresolved', behavior: 'unassessed' });
        } else if (mapper.origins.includes('continuation')) {
            candidates.push({ sourceId: source.id, destinationId: destination.id, evidence: [evidence], producer: 'refactoring-miner' });
        }
    }
    // Exact fallback is intentionally narrow. Keep every identical occurrence
    // as a competitor, including already paired retained sources.
    const key = e => JSON.stringify([e.kind, e.digest, e.declarationContext || '']);
    const buckets = entries => {
        const out = new Map();
        for (const entry of entries) { const k = key(entry); out.set(k, [...(out.get(k) || []), entry]); }
        return out;
    };
    const old = buckets(inventories.before.entries), current = buckets(inventories.after.entries);
    const unresolved = [];
    if (options.exactFallback !== false && !invalidDocuments.length) {
        for (const [k, sources] of old) {
            const destinations = current.get(k) || [];
            if (sources.length === 1 && destinations.length === 1) {
                candidates.push({ sourceId: sources[0].id, destinationId: destinations[0].id, evidence: [], producer: 'exact-declaration' });
            } else if (destinations.length && sources.some(s => s.callable) && !candidates.some(c => sources.some(s => s.id === c.sourceId) && destinations.some(d => d.id === c.destinationId))) {
                unresolved.push({ reason: 'repeated-exact-occurrences', sources: sources.map(e => e.id), destinations: destinations.map(e => e.id) });
            }
        }
    }
    const pairs = new Map();
    for (const candidate of candidates) {
        const k = `${candidate.sourceId}:${candidate.destinationId}`;
        const pair = pairs.get(k);
        if (pair) { pair.evidence.push(...candidate.evidence); pair.producers.add(candidate.producer); }
        else pairs.set(k, { ...candidate, evidence: [...candidate.evidence], producers: new Set([candidate.producer]) });
    }
    const sourceTargets = new Map(), destinationSources = new Map();
    for (const candidate of pairs.values()) {
        sourceTargets.set(candidate.sourceId, new Set([...(sourceTargets.get(candidate.sourceId) || []), candidate.destinationId]));
        destinationSources.set(candidate.destinationId, new Set([...(destinationSources.get(candidate.destinationId) || []), candidate.sourceId]));
    }
    const relations = [];
    for (const pair of pairs.values()) {
        const incomplete = !engineComplete && !pair.producers.has('exact-declaration');
        if (incomplete || sourceTargets.get(pair.sourceId).size > 1 || destinationSources.get(pair.destinationId).size > 1) {
            unresolved.push({ reason: incomplete ? 'incomplete-analysis' : 'conflicting-continuations', sources: [pair.sourceId], destinations: [pair.destinationId], evidence: pair.evidence });
            continue;
        }
        const source = byId.get(pair.sourceId), destination = byId.get(pair.destinationId);
        const a = before[source.path].slice(source.start, source.end), b = after[destination.path].slice(destination.start, destination.end);
        const id = digest(JSON.stringify([comparisonKey, pair.sourceId, pair.destinationId]));
        relations.push({ id, sourceId: source.id, destinationId: destination.id,
            pathChanged: source.path !== destination.path, nameChanged: source.name !== destination.name,
            rawEqual: a === b, declarationContextChanged: source.declarationContext !== destination.declarationContext,
            localDiff: Diff.diffLines(a, b), evidence: pair.evidence, producers: [...pair.producers].sort(), behavior: 'unassessed' });
    }
    const pairedBefore = new Set(relations.map(r => r.sourceId)), pairedAfter = new Set(relations.map(r => r.destinationId));
    return { version: 1, comparisonKey, status: engineComplete && !issues.length ? 'complete' : 'partial',
        scope: { before: Object.keys(before).sort(), after: Object.keys(after).sort(), engineProcessedPaths: native?.processedPaths,
            note: 'Supplied snapshots only; correspondence is inferred and does not establish editing history or behavior preservation.' },
        inventories, relations, groups, unresolved, rejected, issues,
        unmatchedBefore: inventories.before.entries.filter(e => !pairedBefore.has(e.id)).map(e => e.id),
        unmatchedAfter: inventories.after.entries.filter(e => !pairedAfter.has(e.id)).map(e => e.id),
        engine: { status: native?.status || 'unavailable', reason: native?.reason, truncated: !!native?.truncated } };
}

module.exports = { normalizeMappings, validateSpan };
