import type { ChangeCorrespondence, CorrespondenceSymbol } from './changeCorrespondence';
import type { ChangeTourResolvedAnchor } from './changeTourManifest';

export interface TourSymbolEvidence {
    id: string;
    range: { baseOid: string; headOid: string };
    status: 'inferred' | 'unmatched' | 'ambiguous';
    before?: CorrespondenceSymbol;
    after?: CorrespondenceSymbol;
    context: { leftContent: string; rightContent: string };
    behavior: 'unassessed';
}

export function compileTourSymbol(evidence: ChangeCorrespondence, selector: { relation?: string; symbol?: string }, focus: ChangeTourResolvedAnchor): TourSymbolEvidence {
    let before: CorrespondenceSymbol | undefined, after: CorrespondenceSymbol | undefined;
    let status: TourSymbolEvidence['status'] = 'inferred';
    if (selector.relation) {
        const relation = evidence.relations.find(item => item.id === selector.relation);
        if (!relation) throw new Error(`No accepted correspondence: ${selector.relation}`);
        before = evidence.symbols.before.find(item => item.id === relation.sourceId);
        after = evidence.symbols.after.find(item => item.id === relation.destinationId);
    } else {
        const id = selector.symbol!;
        if (evidence.relations.some(item => item.sourceId === id || item.destinationId === id)) throw new Error('Matched symbols must use their accepted relation ID.');
        before = evidence.symbols.before.find(item => item.id === id);
        after = evidence.symbols.after.find(item => item.id === id);
        if (!before && !after) throw new Error(`Unknown correspondence symbol: ${id}`);
        status = evidence.unresolved.some(group => [...group.sourceIds, ...group.destinationIds].includes(id)) ? 'ambiguous' : 'unmatched';
    }
    const endpoint = focus.revision === 'base' ? before : after;
    if (!endpoint || endpoint.path !== focus.path || focus.startLine < endpoint.startLine || focus.endLine > endpoint.endLine) throw new Error('Symbol stop focus must lie within the selected declaration on its revision side.');
    const text = (side: 'before' | 'after', entry?: CorrespondenceSymbol) => entry ? evidence.documents[side].find(doc => doc.path === entry.path)!.text! : '';
    const result: TourSymbolEvidence = { id: selector.relation || selector.symbol!, range: evidence.range, status, before, after,
        context: { leftContent: text('before', before), rightContent: text('after', after) }, behavior: 'unassessed' };
    validateTourSymbol(result);
    return result;
}

/** Portable manifests preserve exact spans, full context and explicit uncertainty. */
export function validateTourSymbol(value: unknown): asserts value is TourSymbolEvidence {
    const fail = (): never => { throw new Error('Invalid pinned symbol tour evidence.'); };
    if (!value || typeof value !== 'object') fail();
    const data = value as TourSymbolEvidence;
    if (typeof data.id !== 'string' || !data.id.trim() || !data.range || ![data.range.baseOid, data.range.headOid].every(oid => typeof oid === 'string' && /^[0-9a-f]{40,64}$/.test(oid))
        || !['inferred', 'unmatched', 'ambiguous'].includes(data.status) || data.behavior !== 'unassessed' || !data.context) fail();
    const count = Number(!!data.before) + Number(!!data.after);
    if (count !== (data.status === 'inferred' ? 2 : 1)) fail();
    for (const [entry, content] of [[data.before, data.context.leftContent], [data.after, data.context.rightContent]] as const) {
        if (typeof content !== 'string') fail();
        if (!entry) { if (content !== '') fail(); continue; }
        if (typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name || typeof entry.kind !== 'string' || !entry.kind
            || typeof entry.path !== 'string' || entry.path.includes('\0') || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(part => !part || part === '.' || part === '..')
            || typeof entry.digest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.digest) || !Number.isSafeInteger(entry.start) || !Number.isSafeInteger(entry.end)
            || entry.start < 0 || entry.end <= entry.start || entry.end > content.length
            || content.slice(entry.start, entry.end) !== entry.text
            || entry.startLine !== content.slice(0, entry.start).split('\n').length
            || entry.endLine !== content.slice(0, entry.end - 1).split('\n').length) fail();
    }
}
