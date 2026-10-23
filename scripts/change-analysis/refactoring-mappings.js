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
    const producer = options.engineProducer || 'refactoring-miner';
    const strand = producer === 'bygone-strand';
    const inventories = options.inventories || { before: inventorySnapshot(before, 'before', options), after: inventorySnapshot(after, 'after', options) };
    const allEntries = [...inventories.before.entries, ...inventories.after.entries];
    const byId = new Map(allEntries.map(e => [e.id, e]));
    const comparisonKey = digest(JSON.stringify([inventories.before.snapshotId, inventories.after.snapshotId, 'mappings-v1', inventories.before.parser, inventories.after.parser]));
    const issues = [], rejected = [], candidates = [], groups = [];
    const invalidDocuments = [...inventories.before.documents, ...inventories.after.documents].filter(d => d.status === 'invalid');
    const skippedDocuments = native?.processedPaths ? ['before', 'after'].flatMap(side =>
        inventories[side].documents.filter(d => (d.status === 'complete' || (strand && d.status === 'unsupported'))
            && (/\.pyi$/.test(d.path) || !native.processedPaths[side]?.includes(d.path)))
            .map(d => ({ reason: 'engine-skipped-document', side, path: d.path }))) : [];
    issues.push(...skippedDocuments);
    const engineReliable = native?.status === 'complete' && !native.truncated && !invalidDocuments.length;
    const engineComplete = engineReliable && !skippedDocuments.length;
    const skippedImplementations = skippedDocuments.filter(d => strand ? /\.(?:[cm]?[jt]s|[jt]sx|py)$/.test(d.path) : !/\.pyi$/.test(d.path));
    const skippedChangedImplementation = skippedImplementations.some(d => before[d.path] !== after[d.path]);
    function localIdentity(entry, side) {
        const scope = [];
        for (let name = entry.qualifiedName; name;) {
            const owners = inventories[side].entries.filter(e => e.path === entry.path && e.qualifiedName === name);
            if (owners.length !== 1) return null;
            scope.push([owners[0].kind, owners[0].name]);
            name = owners[0].parent;
        }
        return JSON.stringify([entry.path, scope]);
    }
    function engineCoversPair(source, destination) {
        if (!engineReliable || skippedChangedImplementation) return false;
        // Stubs have their own inventory/exact coverage, outside this engine's
        // implementation search. Never bind a claimed engine span to a stub.
        if ([source, destination].some(e => strand ? !/\.(?:[cm]?[jt]s|[jt]sx|py)$/.test(e.path) : /\.pyi$/.test(e.path))) return false;
        if (native.processedPaths && (!native.processedPaths.before?.includes(source.path)
            || !native.processedPaths.after?.includes(destination.path))) return false;
        if (!skippedImplementations.length) return true;
        // RM omits byte-identical files. Their declarations can still compete
        // for cross-file origins, so only a unique retained local identity can
        // use engine evidence while those implementations are unsearched.
        const identity = localIdentity(source, 'before');
        return identity !== null && identity === localIdentity(destination, 'after');
    }
    function endpoint(span, side, category = 'callable') {
        const files = side === 'before' ? before : after;
        if (!validateSpan(span, files)) return { entry: null, reason: 'invalid-container-range', valid: false };
        if (strand && category === 'inventory') {
            const entries = inventories[side].entries.filter(e => e.path === span.path && e.start === span.start
                && e.end === span.end && e.kind === span.kind && e.name === span.name);
            return { entry: entries.length === 1 ? entries[0] : null, valid: true,
                reason: entries.length === 1 ? 'resolved-container' : 'container-boundary-mismatch' };
        }
        const eligible = inventories[side].entries.filter(e => e.path === span.path
            && (category === 'callable' ? e.callable : ['class', 'interface', 'type', 'enum'].includes(e.kind)));
        const named = eligible.filter(e => {
            const engineName = category === 'callable' ? span.name : span.name?.split('.').at(-1);
            return !engineName || engineName === e.name || (e.name === 'default' && engineName === 'anonymous');
        });
        const entries = named.filter(e => e.engineRanges.some(range => range.end === span.end && range.start <= span.start
            && /^(?:(?:export|default|declare|async|abstract|public|private|protected|static|readonly|override)\b|\s)*$/.test(files[e.path].slice(range.start, span.start))));
        return { entry: entries.length === 1 ? entries[0] : null, valid: true,
            reason: entries.length === 1 ? 'resolved-container' : !eligible.length ? 'no-inventoried-container'
                : !named.length ? 'container-name-mismatch' : !entries.length ? 'container-boundary-mismatch' : 'multiple-inventory-containers' };
    }
    const classMappers = (native?.classMappings || []).map(c => ({ ...c, category: 'type', origins: ['continuation'], mappings: [] }));
    for (const mapper of [...(native?.mappers || []), ...classMappers]) {
        const sourceResult = endpoint(mapper.source, 'before', mapper.category), destinationResult = endpoint(mapper.destination, 'after', mapper.category);
        const source = sourceResult.entry, destination = destinationResult.entry;
        if (!source || !destination) {
            if (!validateSpan(mapper.source, before) || !validateSpan(mapper.destination, after)) issues.push({ mapperId: mapper.id, reason: 'invalid-container-range' });
            const endpoints = [['before', mapper.source, sourceResult], ['after', mapper.destination, destinationResult]]
                .filter(([side, span]) => span && Object.hasOwn(side === 'before' ? before : after, span.path))
                .map(([side, span, result]) => ({ side, path: span.path, reason: result.reason,
                    ...(result.valid ? { start: span.start } : {}), ...(result.entry ? { symbolId: result.entry.id } : {}) }));
            rejected.push({ mapperId: mapper.id, reason: 'unresolved-container', source: mapper.source, destination: mapper.destination, endpoints });
            continue;
        }
        if (strand && /\.pyi?$/.test(source.path) !== /\.pyi?$/.test(destination.path)) {
            const reason = 'incompatible-container-language';
            issues.push({ mapperId: mapper.id, reason });
            rejected.push({ mapperId: mapper.id, reason, endpoints: [
                { side: 'before', path: source.path, start: source.start, symbolId: source.id },
                { side: 'after', path: destination.path, start: destination.start, symbolId: destination.id }
            ] });
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
            mappings, unmappedBefore, unmappedAfter, origins: mapper.origins,
            ...(strand ? { producer, match: mapper.match } : {}) };
        const kind = mapper.origins.includes('extract') ? 'extract' : mapper.origins.includes('inline') ? 'inline' : 'continuation';
        if (kind !== 'continuation') {
            groups.push({ kind, sourceId: source.id, destinationId: destination.id, evidence,
                status: engineCoversPair(source, destination) ? 'inferred' : 'unresolved', behavior: 'unassessed' });
        } else if (mapper.origins.includes('continuation')) {
            candidates.push({ sourceId: source.id, destinationId: destination.id, evidence: [evidence], producer });
        }
    }
    // Prefer an unchanged binding at its unique file/scope/name identity.
    // Still keep every occurrence as a competitor for cross-scope origins;
    // retaining a declaration does not establish where a copy came from.
    const key = e => JSON.stringify([e.kind, e.digest, e.declarationContext || '']);
    const buckets = (entries, identify = key) => {
        const out = new Map();
        for (const entry of entries) {
            const k = identify(entry);
            if (k !== undefined) out.set(k, [...(out.get(k) || []), entry]);
        }
        return out;
    };
    const scopedBuckets = entries => {
        const named = buckets(entries, e => JSON.stringify([e.path, e.qualifiedName]));
        return buckets(entries, e => {
            const scope = [];
            for (let parent = e.parent; parent;) {
                const owners = named.get(JSON.stringify([e.path, parent]));
                if (owners?.length !== 1) return undefined;
                const owner = owners[0];
                scope.push([owner.kind, owner.name]);
                parent = owner.parent;
            }
            return JSON.stringify([e.path, scope, e.kind, e.name]);
        });
    };
    const old = buckets(inventories.before.entries), current = buckets(inventories.after.entries);
    const unresolved = strand ? (native?.unresolved || []).map(group => ({ ...group,
        sources: group.sources.filter(id => byId.has(id) && byId.get(id).side === 'before'),
        destinations: group.destinations.filter(id => byId.has(id) && byId.get(id).side === 'after') })) : [];
    if (strand) for (const record of native?.rejectedCandidates || []) {
        const source = byId.get(record.sourceId), destination = byId.get(record.destinationId);
        if (!source || !destination) continue;
        rejected.push({ reason: record.reason, message: `Candidate score: ${record.score ?? 'unavailable'}; correspondence was not accepted.`,
            endpoints: [{ side: 'before', path: source.path, start: source.start, symbolId: source.id },
                { side: 'after', path: destination.path, start: destination.start, symbolId: destination.id }] });
    }
    if (options.exactFallback !== false && !invalidDocuments.length) {
        const scopedOld = scopedBuckets(inventories.before.entries), scopedCurrent = scopedBuckets(inventories.after.entries);
        for (const [identity, sources] of scopedOld) {
            const destinations = scopedCurrent.get(identity) || [];
            if (sources.length === 1 && destinations.length === 1 && key(sources[0]) === key(destinations[0])) {
                candidates.push({ sourceId: sources[0].id, destinationId: destinations[0].id, evidence: [], producer: 'exact-declaration' });
            }
        }
        const coveredSources = new Set(), coveredDestinations = new Set();
        for (const candidate of candidates) {
            if (key(byId.get(candidate.sourceId)) === key(byId.get(candidate.destinationId))) {
                coveredSources.add(candidate.sourceId); coveredDestinations.add(candidate.destinationId);
            }
        }
        for (const [k, sources] of old) {
            const destinations = current.get(k) || [];
            if (sources.length === 1 && destinations.length === 1) {
                candidates.push({ sourceId: sources[0].id, destinationId: destinations[0].id, evidence: [], producer: 'exact-declaration' });
            } else if (destinations.length && (sources.some(s => !coveredSources.has(s.id)) || destinations.some(d => !coveredDestinations.has(d.id)))) {
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
        const covered = engineCoversPair(byId.get(pair.sourceId), byId.get(pair.destinationId));
        const incomplete = !pair.producers.has('exact-declaration') && !covered;
        if (incomplete || sourceTargets.get(pair.sourceId).size > 1 || destinationSources.get(pair.destinationId).size > 1) {
            unresolved.push({ reason: incomplete ? 'incomplete-analysis' : 'conflicting-continuations', sources: [pair.sourceId], destinations: [pair.destinationId], evidence: pair.evidence });
            continue;
        }
        const source = byId.get(pair.sourceId), destination = byId.get(pair.destinationId);
        const a = before[source.path].slice(source.start, source.end), b = after[destination.path].slice(destination.start, destination.end);
        const id = digest(JSON.stringify([comparisonKey, pair.sourceId, pair.destinationId]));
        relations.push({ id, sourceId: source.id, destinationId: destination.id,
            ...(!engineComplete && covered ? { coverage: 'complete' } : {}),
            pathChanged: source.path !== destination.path, nameChanged: source.name !== destination.name,
            rawEqual: a === b, declarationContextChanged: source.declarationContext !== destination.declarationContext,
            localDiff: Diff.diffLines(a, b, { timeout: 100, maxEditLength: 2000 }) || [{ value: a, removed: true }, { value: b, added: true }], evidence: pair.evidence, producers: [...pair.producers].sort(), behavior: 'unassessed' });
    }
    const pairedBefore = new Set(relations.map(r => r.sourceId)), pairedAfter = new Set(relations.map(r => r.destinationId));
    for (let index = unresolved.length - 1; index >= 0; index--) {
        const group = unresolved[index];
        if (!['repeated-exact-occurrences', 'ambiguous-js-candidates', 'ambiguous-python-candidates'].includes(group.reason)) continue;
        // A retained local continuation is resolved, but remains a possible
        // origin of an unmatched copy. Keep that context outside its endpoints.
        group.competingSources = group.sources; group.competingDestinations = group.destinations;
        group.sources = group.sources.filter(id => !pairedBefore.has(id));
        group.destinations = group.destinations.filter(id => !pairedAfter.has(id));
        if (!group.sources.length && !group.destinations.length) unresolved.splice(index, 1);
    }
    const ambiguousIds = new Set(unresolved.flatMap(g => [...g.sources, ...g.destinations]));
    const rejectedIds = new Set(rejected.flatMap(r => r.endpoints.map(e => e.symbolId).filter(Boolean)));
    const relationshipIds = new Set(groups.flatMap(g => [g.sourceId, g.destinationId]));
    const unmatchedDiagnostics = ['before', 'after'].flatMap(side => inventories[side].entries
        .filter(e => !(side === 'before' ? pairedBefore : pairedAfter).has(e.id))
        .map(e => ({ side, symbolId: e.id, reason: ambiguousIds.has(e.id) ? 'ambiguous-symbol'
            : rejectedIds.has(e.id) ? 'candidate-endpoint-rejected' : relationshipIds.has(e.id) ? 'relationship-without-continuation' : 'no-candidate-supplied' })));
    return { version: 1, comparisonKey, status: engineComplete && !issues.length ? 'complete' : 'partial',
        scope: { before: Object.keys(before).sort(), after: Object.keys(after).sort(), engineProcessedPaths: native?.processedPaths,
            note: 'Supplied snapshots only; correspondence is inferred and does not establish editing history or behavior preservation.' },
        inventories, relations, groups, unresolved, rejected, issues, unmatchedDiagnostics,
        unmatchedBefore: inventories.before.entries.filter(e => !pairedBefore.has(e.id)).map(e => e.id),
        unmatchedAfter: inventories.after.entries.filter(e => !pairedAfter.has(e.id)).map(e => e.id),
        engine: { ...(strand ? { name: 'Bygone Strand', producer, version: 1 } : {}),
            status: native?.status || 'unavailable', reason: native?.reason, truncated: !!native?.truncated } };
}

module.exports = { normalizeMappings, validateSpan };
