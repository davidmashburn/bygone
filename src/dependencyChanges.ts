import type { ChangeCorrespondence, CorrespondenceRelation, CorrespondenceSymbol } from './changeCorrespondence';
import type { DependencyEvidenceReport, EvidenceNode, EvidenceSite } from './dependencyEvidence';
import type { DependencySource } from './dependencyGraph';

export const DEPENDENCY_CHANGES_VERSION = 1 as const;

export type DependencyChangeSide = 'base' | 'head';
export type DependencyContinuationBasis = 'correspondence' | 'unchanged-source';
export type DependencyContinuationUnknownReason = 'ambiguous-correspondence' | 'no-trusted-continuation';
export type DependencyCallUnknownReason =
    | 'consumer-continuation-unknown'
    | 'target-continuation-unknown'
    | 'target-unresolved'
    | 'ambiguous-call-identity'
    | 'snapshot-coverage-incomplete';

/** A node reference carries the exact committed source anchor needed for navigation. */
export interface DependencyNodeReference {
    id: string;
    name: string;
    kind: EvidenceNode['kind'];
    language: EvidenceNode['language'];
    source: DependencySource;
}

/** A trusted node pairing across the two snapshot-local evidence graphs. */
export interface DependencyContinuation {
    id: string;
    basis: DependencyContinuationBasis;
    before: DependencyNodeReference;
    after: DependencyNodeReference;
    relationId?: string;
}

export interface DependencyUnknownContinuation {
    side: DependencyChangeSide;
    node: DependencyNodeReference;
    reason: DependencyContinuationUnknownReason;
    candidates?: DependencyNodeReference[];
}

export interface DependencyCallChange {
    side: DependencyChangeSide;
    consumerContinuationId: string;
    targetContinuationId: string;
    consumer: DependencyNodeReference;
    target: DependencyNodeReference;
    site: EvidenceSite;
}

export interface DependencyUnknownCall {
    side: DependencyChangeSide;
    reason: DependencyCallUnknownReason;
    consumer?: DependencyNodeReference;
    target?: DependencyNodeReference;
    site: EvidenceSite;
}

export interface DependencyAffectedConsumer {
    id: string;
    before?: DependencyNodeReference;
    after?: DependencyNodeReference;
    added: DependencyCallChange[];
    removed: DependencyCallChange[];
    unknown: DependencyUnknownCall[];
}

export interface DependencyChanges {
    version: typeof DEPENDENCY_CHANGES_VERSION;
    range: { baseOid: string; headOid: string };
    continuations: DependencyContinuation[];
    unknownContinuations: DependencyUnknownContinuation[];
    changes: {
        added: DependencyCallChange[];
        removed: DependencyCallChange[];
        unknown: DependencyUnknownCall[];
    };
    affectedConsumers: DependencyAffectedConsumer[];
    limitations: string[];
}

export type DependencyChangeResult = DependencyChanges;

interface NodeIndex {
    byId: Map<string, EvidenceNode>;
    duplicateIds: Set<string>;
    byAnchor: Map<string, EvidenceNode[]>;
}

interface Pair {
    id: string;
    basis: DependencyContinuationBasis;
    before: EvidenceNode;
    after: EvidenceNode;
    relationId?: string;
}

interface KnownCall {
    signature: string;
    siteIdentity: string;
    site: EvidenceSite;
    consumer: EvidenceNode;
    target: EvidenceNode;
    consumerPair: Pair;
    targetPair: Pair;
}

interface ConsumerAccumulator {
    id: string;
    before?: DependencyNodeReference;
    after?: DependencyNodeReference;
    added: DependencyCallChange[];
    removed: DependencyCallChange[];
    unknown: DependencyUnknownCall[];
}

function sourceAnchorKey(source: Pick<DependencySource, 'file' | 'start' | 'end' | 'digest'>): string {
    return JSON.stringify([source.file, source.start, source.end, source.digest]);
}

function symbolAnchorKey(symbol: CorrespondenceSymbol): string {
    return JSON.stringify([symbol.path, symbol.start, symbol.end, symbol.digest]);
}

function nodeIdentityKey(node: EvidenceNode): string {
    return JSON.stringify([sourceAnchorKey(node.source), node.name, node.kind, node.language]);
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: Pick<DependencySource, 'file' | 'start' | 'end' | 'digest'>,
    right: Pick<DependencySource, 'file' | 'start' | 'end' | 'digest'>): number {
    return compareStrings(left.file, right.file)
        || left.start - right.start
        || left.end - right.end
        || compareStrings(left.digest, right.digest);
}

function compareNodes(left: EvidenceNode, right: EvidenceNode): number {
    return compareSources(left.source, right.source)
        || compareStrings(left.kind, right.kind)
        || compareStrings(left.language, right.language)
        || compareStrings(left.name, right.name)
        || compareStrings(left.id, right.id);
}

function compareSites(left: EvidenceSite, right: EvidenceSite): number {
    return compareSources(left.source, right.source) || compareStrings(left.id, right.id);
}

function cloneSource(source: DependencySource): DependencySource {
    return { ...source };
}

function nodeReference(node: EvidenceNode): DependencyNodeReference {
    return { id: node.id, name: node.name, kind: node.kind, language: node.language, source: cloneSource(node.source) };
}

function siteReference(site: EvidenceSite): EvidenceSite {
    return { ...site, source: cloneSource(site.source), ...(site.candidates ? { candidates: [...site.candidates] } : {}) };
}

function indexNodes(nodes: readonly EvidenceNode[]): NodeIndex {
    const byId = new Map<string, EvidenceNode>();
    const duplicateIds = new Set<string>();
    const byAnchor = new Map<string, EvidenceNode[]>();
    for (const node of nodes) {
        if (byId.has(node.id)) {
            duplicateIds.add(node.id);
        } else {
            byId.set(node.id, node);
        }
        const key = sourceAnchorKey(node.source);
        const candidates = byAnchor.get(key) ?? [];
        candidates.push(node);
        byAnchor.set(key, candidates);
    }
    for (const candidates of byAnchor.values()) candidates.sort(compareNodes);
    return { byId, duplicateIds, byAnchor };
}

function nodeForId(index: NodeIndex, id: string): EvidenceNode | undefined {
    return index.duplicateIds.has(id) ? undefined : index.byId.get(id);
}

function relationSort(left: CorrespondenceRelation, right: CorrespondenceRelation): number {
    return compareStrings(left.id, right.id)
        || compareStrings(left.sourceId, right.sourceId)
        || compareStrings(left.destinationId, right.destinationId);
}

function symbolsById(symbols: readonly CorrespondenceSymbol[]): Map<string, CorrespondenceSymbol> {
    return new Map(symbols.map(symbol => [symbol.id, symbol]));
}

function addCandidate(blocked: Set<string>, symbol: CorrespondenceSymbol | undefined): void {
    if (symbol) blocked.add(symbolAnchorKey(symbol));
}

function continuationId(before: EvidenceNode, after: EvidenceNode): string {
    return JSON.stringify([before.id, after.id]);
}

function callSignature(targetPair: Pair, site: EvidenceSite): string {
    return JSON.stringify([targetPair.id, site.phase, site.loading ?? null]);
}

function siteIdentityKey(site: EvidenceSite): string {
    return sourceAnchorKey(site.source);
}

function unmatchedCallsByExactSite(baseCalls: readonly KnownCall[], headCalls: readonly KnownCall[]): {
    base: KnownCall[];
    head: KnownCall[];
} {
    const baseBySite = new Map<string, KnownCall[]>();
    const headBySite = new Map<string, KnownCall[]>();
    for (const call of baseCalls) appendGrouped(baseBySite, call.siteIdentity, call);
    for (const call of headCalls) appendGrouped(headBySite, call.siteIdentity, call);
    const matchedBase = new Set<KnownCall>();
    const matchedHead = new Set<KnownCall>();
    const sites = [...new Set([...baseBySite.keys(), ...headBySite.keys()])].sort(compareStrings);
    for (const site of sites) {
        const base = baseBySite.get(site) ?? [];
        const head = headBySite.get(site) ?? [];
        if (base.length === 1 && head.length === 1) {
            matchedBase.add(base[0]);
            matchedHead.add(head[0]);
        }
    }
    return {
        base: baseCalls.filter(call => !matchedBase.has(call)),
        head: headCalls.filter(call => !matchedHead.has(call))
    };
}

function unknownPhaseAndLoadingCompatible(unknown: DependencyUnknownCall, known: KnownCall): boolean {
    const unknownPhase = unknown.site.phase;
    const knownPhase = known.site.phase;
    if (unknownPhase !== 'unknown' && knownPhase !== 'unknown' && unknownPhase !== knownPhase) return false;
    return unknown.site.loading === undefined || known.site.loading === undefined || unknown.site.loading === known.site.loading;
}

function sourceOrder(left: DependencyNodeReference | undefined, right: DependencyNodeReference | undefined): number {
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return compareSources(left.source, right.source) || compareStrings(left.id, right.id);
}

function appendGrouped<T>(groups: Map<string, T[]>, key: string, value: T): void {
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
}

/**
 * Compare the bounded v2 evidence snapshots without doing I/O or inferring a
 * runtime graph. Snapshot-local IDs and names are deliberately not identities.
 */
export function compareDependencyEvidence(
    report: DependencyEvidenceReport,
    correspondence?: ChangeCorrespondence
): DependencyChanges {
    if (report.version !== 2 || report.kind !== 'dependency-evidence') {
        throw new Error('Expected a version 2 dependency evidence report.');
    }

    const limitations: string[] = [];
    const limitationSet = new Set<string>();
    const limit = (message: string): void => {
        if (!limitationSet.has(message)) {
            limitationSet.add(message);
            limitations.push(message);
        }
    };

    for (const assumption of report.assumptions) limit(assumption);
    limit('Only statically resolved call sites with trusted owner and target continuations are asserted as added or removed; no runtime reachability or dispatch is inferred.');

    const baseNodes = [...report.base.nodes].sort(compareNodes);
    const headNodes = [...report.head.nodes].sort(compareNodes);
    const baseIndex = indexNodes(baseNodes);
    const headIndex = indexNodes(headNodes);
    const pairsByBase = new Map<string, Pair>();
    const pairsByHead = new Map<string, Pair>();
    const blockedBaseAnchors = new Set<string>();
    const blockedHeadAnchors = new Set<string>();
    const relationSymbols = correspondence ? {
        before: symbolsById(correspondence.symbols.before),
        after: symbolsById(correspondence.symbols.after)
    } : undefined;
    let usableCorrespondence = correspondence;

    if (correspondence && (correspondence.range.baseOid !== report.range.baseOid
        || correspondence.range.headOid !== report.range.headOid)) {
        usableCorrespondence = undefined;
        limit('The supplied correspondence range does not match the evidence range and was ignored.');
    }

    if (usableCorrespondence) {
        for (const unresolved of usableCorrespondence.unresolved) {
            for (const id of unresolved.sourceIds) addCandidate(blockedBaseAnchors, relationSymbols?.before.get(id));
            for (const id of unresolved.destinationIds) addCandidate(blockedHeadAnchors, relationSymbols?.after.get(id));
        }
        for (const relation of [...usableCorrespondence.relations].sort(relationSort)) {
            const source = relationSymbols?.before.get(relation.sourceId);
            const destination = relationSymbols?.after.get(relation.destinationId);
            const beforeCandidates = source ? (baseIndex.byAnchor.get(symbolAnchorKey(source)) ?? []) : [];
            const afterCandidates = destination ? (headIndex.byAnchor.get(symbolAnchorKey(destination)) ?? []) : [];
            if (!source || !destination || beforeCandidates.length !== 1 || afterCandidates.length !== 1) {
                addCandidate(blockedBaseAnchors, source);
                addCandidate(blockedHeadAnchors, destination);
                continue;
            }
            const before = beforeCandidates[0];
            const after = afterCandidates[0];
            if (pairsByBase.has(before.id) || pairsByHead.has(after.id)) {
                blockedBaseAnchors.add(sourceAnchorKey(before.source));
                blockedHeadAnchors.add(sourceAnchorKey(after.source));
                continue;
            }
            const pair: Pair = { id: continuationId(before, after), basis: 'correspondence', before, after, relationId: relation.id };
            pairsByBase.set(before.id, pair);
            pairsByHead.set(after.id, pair);
        }
        if (usableCorrespondence.status !== 'complete') {
            limit(`Correspondence status is ${usableCorrespondence.status}; nodes without exact trusted pairings remain unknown.`);
        }
        for (const message of usableCorrespondence.limitations) limit(message);
    } else if (!correspondence) {
        limit('No validated correspondence was supplied; edited, moved, added, and removed nodes remain unknown unless exact unchanged source identity is sound.');
    }

    // An exact source anchor is a narrow fallback for unchanged declarations.
    // It cannot cross a rename, a path, a range, a digest, or node metadata.
    for (const before of baseNodes) {
        if (pairsByBase.has(before.id) || blockedBaseAnchors.has(sourceAnchorKey(before.source))) continue;
        const candidates = (headIndex.byAnchor.get(sourceAnchorKey(before.source)) ?? [])
            .filter(candidate => nodeIdentityKey(candidate) === nodeIdentityKey(before));
        if (candidates.length !== 1 || pairsByHead.has(candidates[0].id)
            || blockedHeadAnchors.has(sourceAnchorKey(candidates[0]?.source ?? before.source))) continue;
        const after = candidates[0];
        const pair: Pair = { id: continuationId(before, after), basis: 'unchanged-source', before, after };
        pairsByBase.set(before.id, pair);
        pairsByHead.set(after.id, pair);
    }

    const continuations = [...pairsByBase.values()]
        .sort((left, right) => compareSources(left.before.source, right.before.source) || compareStrings(left.id, right.id))
        .map(pair => ({ id: pair.id, basis: pair.basis, before: nodeReference(pair.before), after: nodeReference(pair.after),
            ...(pair.relationId ? { relationId: pair.relationId } : {}) }));

    const unknownContinuations: DependencyUnknownContinuation[] = [];
    const recordUnknownContinuations = (side: DependencyChangeSide, nodes: readonly EvidenceNode[], index: NodeIndex,
        pairs: Map<string, Pair>, blocked: Set<string>, otherIndex: NodeIndex): void => {
        for (const node of nodes) {
            if (pairs.has(node.id)) continue;
            const anchor = sourceAnchorKey(node.source);
            const sourceCandidates = (otherIndex.byAnchor.get(anchor) ?? [])
                .filter(candidate => nodeIdentityKey(candidate) === nodeIdentityKey(node));
            const ambiguous = blocked.has(anchor) || sourceCandidates.length > 1 || index.duplicateIds.has(node.id);
            unknownContinuations.push({ side, node: nodeReference(node),
                reason: ambiguous ? 'ambiguous-correspondence' : 'no-trusted-continuation',
                ...(sourceCandidates.length > 1 ? { candidates: sourceCandidates.map(nodeReference) } : {}) });
        }
    };
    recordUnknownContinuations('base', baseNodes, baseIndex, pairsByBase, blockedBaseAnchors, headIndex);
    recordUnknownContinuations('head', headNodes, headIndex, pairsByHead, blockedHeadAnchors, baseIndex);
    if (unknownContinuations.length) limit(`${unknownContinuations.length} node continuations could not be established without guessing identity.`);

    const completeCoverage = report.base.coverage.indexComplete && report.head.coverage.indexComplete;
    if (!completeCoverage) limit('One or both evidence snapshots have incomplete coverage; omitted records prevent asserted call removals or additions.');
    if (report.base.coverage.unresolvedSites || report.head.coverage.unresolvedSites) {
        limit('Unresolved, ambiguous, external, and unsupported sites remain unknown and are not treated as call deltas.');
    }

    const changes = { added: [] as DependencyCallChange[], removed: [] as DependencyCallChange[], unknown: [] as DependencyUnknownCall[] };
    const consumers = new Map<string, ConsumerAccumulator>();
    const knownByConsumer = new Map<string, { base: KnownCall[]; head: KnownCall[] }>();
    const observedUnknowns = { base: [] as DependencyUnknownCall[], head: [] as DependencyUnknownCall[] };
    const observedUnknownsByConsumer = new Map<string, DependencyUnknownCall[]>();

    const ensureConsumer = (pair: Pair | undefined, side: DependencyChangeSide, owner: EvidenceNode | undefined): ConsumerAccumulator => {
        const id = pair?.id ?? JSON.stringify([side, owner?.id ?? '<unknown-owner>']);
        let consumer = consumers.get(id);
        if (!consumer) {
            consumer = { id, ...(pair ? { before: nodeReference(pair.before), after: nodeReference(pair.after) } : {}),
                added: [], removed: [], unknown: [] };
            if (!pair && side === 'base' && owner) consumer.before = nodeReference(owner);
            if (!pair && side === 'head' && owner) consumer.after = nodeReference(owner);
            consumers.set(id, consumer);
        } else if (!pair && side === 'base' && owner) {
            consumer.before ??= nodeReference(owner);
        } else if (!pair && side === 'head' && owner) {
            consumer.after ??= nodeReference(owner);
        }
        return consumer;
    };

    const addUnknown = (unknown: DependencyUnknownCall, pair: Pair | undefined, owner: EvidenceNode | undefined): void => {
        changes.unknown.push(unknown);
        ensureConsumer(pair, unknown.side, owner).unknown.push(unknown);
    };

    const addObservedUnknown = (unknown: DependencyUnknownCall, pair: Pair | undefined, owner: EvidenceNode | undefined): void => {
        addUnknown(unknown, pair, owner);
        observedUnknowns[unknown.side].push(unknown);
        if (pair) appendGrouped(observedUnknownsByConsumer, JSON.stringify([unknown.side, pair.id]), unknown);
    };

    const collectKnownCalls = (side: DependencyChangeSide, sites: readonly EvidenceSite[], index: NodeIndex,
        pairs: Map<string, Pair>): void => {
        for (const site of [...sites].filter(site => site.relation === 'call').sort(compareSites)) {
            const owner = nodeForId(index, site.owner);
            const ownerPair = owner ? pairs.get(owner.id) : undefined;
            if (!owner || !ownerPair) {
                addObservedUnknown({ side, reason: 'consumer-continuation-unknown', ...(owner ? { consumer: nodeReference(owner) } : {}), site: siteReference(site) }, ownerPair, owner);
                continue;
            }
            if (site.resolution !== 'resolved' || !site.target) {
                addObservedUnknown({ side, reason: 'target-unresolved', consumer: nodeReference(owner), site: siteReference(site) }, ownerPair, owner);
                continue;
            }
            const target = nodeForId(index, site.target);
            const targetPair = target ? pairs.get(target.id) : undefined;
            if (!target || !targetPair) {
                addObservedUnknown({ side, reason: 'target-continuation-unknown', consumer: nodeReference(owner),
                    ...(target ? { target: nodeReference(target) } : {}), site: siteReference(site) }, ownerPair, owner);
                continue;
            }
            const known: KnownCall = { signature: callSignature(targetPair, site), siteIdentity: siteIdentityKey(site), site, consumer: owner, target,
                consumerPair: ownerPair, targetPair };
            const entry = knownByConsumer.get(ownerPair.id) ?? { base: [], head: [] };
            entry[side].push(known);
            knownByConsumer.set(ownerPair.id, entry);
        }
    };

    collectKnownCalls('base', report.base.sites, baseIndex, pairsByBase);
    collectKnownCalls('head', report.head.sites, headIndex, pairsByHead);

    const hasUnknownCounterpart = (side: DependencyChangeSide, call: KnownCall): boolean => {
        const opposite: DependencyChangeSide = side === 'base' ? 'head' : 'base';
        if (observedUnknowns[opposite].some(unknown => siteIdentityKey(unknown.site) === call.siteIdentity)) return true;
        const sameConsumer = observedUnknownsByConsumer.get(JSON.stringify([opposite, call.consumerPair.id])) ?? [];
        return sameConsumer.some(unknown =>
            (unknown.reason === 'target-unresolved' || unknown.reason === 'target-continuation-unknown')
            && unknownPhaseAndLoadingCompatible(unknown, call));
    };

    const makeChange = (side: DependencyChangeSide, call: KnownCall): DependencyCallChange => ({
        side, consumerContinuationId: call.consumerPair.id, targetContinuationId: call.targetPair.id,
        consumer: nodeReference(call.consumer), target: nodeReference(call.target), site: siteReference(call.site)
    });
    const addKnownChange = (side: DependencyChangeSide, call: KnownCall): void => {
        const change = makeChange(side, call);
        const consumer = ensureConsumer(call.consumerPair, side, call.consumer);
        if (side === 'base') { changes.removed.push(change); consumer.removed.push(change); }
        else { changes.added.push(change); consumer.added.push(change); }
    };
    const addCoverageUnknown = (side: DependencyChangeSide, call: KnownCall): void => {
        addUnknown({ side, reason: 'snapshot-coverage-incomplete', consumer: nodeReference(call.consumer),
            target: nodeReference(call.target), site: siteReference(call.site) }, call.consumerPair, call.consumer);
    };

    const addAmbiguousCallUnknown = (side: DependencyChangeSide, call: KnownCall): void => {
        addUnknown({ side, reason: 'ambiguous-call-identity', consumer: nodeReference(call.consumer),
            target: nodeReference(call.target), site: siteReference(call.site) }, call.consumerPair, call.consumer);
    };

    const addUnmatchedKnownChange = (side: DependencyChangeSide, call: KnownCall): void => {
        if (hasUnknownCounterpart(side, call)) return;
        if (completeCoverage) addKnownChange(side, call);
        else addCoverageUnknown(side, call);
    };

    for (const entry of knownByConsumer.values()) {
        const baseBySignature = new Map<string, KnownCall[]>();
        const headBySignature = new Map<string, KnownCall[]>();
        for (const call of entry.base) appendGrouped(baseBySignature, call.signature, call);
        for (const call of entry.head) appendGrouped(headBySignature, call.signature, call);
        const signatures = [...new Set([...baseBySignature.keys(), ...headBySignature.keys()])].sort(compareStrings);
        for (const signature of signatures) {
            const unmatched = unmatchedCallsByExactSite(baseBySignature.get(signature) ?? [], headBySignature.get(signature) ?? []);
            if (unmatched.base.length > unmatched.head.length) {
                if (unmatched.head.length) {
                    for (const call of unmatched.base) {
                        if (completeCoverage) addAmbiguousCallUnknown('base', call);
                        else addCoverageUnknown('base', call);
                    }
                } else {
                    for (const call of unmatched.base) addUnmatchedKnownChange('base', call);
                }
            } else if (unmatched.head.length > unmatched.base.length) {
                if (unmatched.base.length) {
                    for (const call of unmatched.head) {
                        if (completeCoverage) addAmbiguousCallUnknown('head', call);
                        else addCoverageUnknown('head', call);
                    }
                } else {
                    for (const call of unmatched.head) addUnmatchedKnownChange('head', call);
                }
            }
        }
    }

    changes.added.sort((left, right) => compareSources(left.site.source, right.site.source) || compareStrings(left.consumerContinuationId, right.consumerContinuationId));
    changes.removed.sort((left, right) => compareSources(left.site.source, right.site.source) || compareStrings(left.consumerContinuationId, right.consumerContinuationId));
    changes.unknown.sort((left, right) => compareSources(left.site.source, right.site.source) || compareStrings(left.reason, right.reason));
    if (changes.unknown.length) limit(`${changes.unknown.length} call sites remain unknown and are excluded from asserted additions/removals.`);

    const affectedConsumers = [...consumers.values()]
        .filter(consumer => consumer.added.length || consumer.removed.length || consumer.unknown.length)
        .sort((left, right) => sourceOrder(left.before, right.before) || sourceOrder(left.after, right.after) || compareStrings(left.id, right.id));
    for (const consumer of affectedConsumers) {
        consumer.added.sort((left, right) => compareSources(left.site.source, right.site.source));
        consumer.removed.sort((left, right) => compareSources(left.site.source, right.site.source));
        consumer.unknown.sort((left, right) => compareSources(left.site.source, right.site.source) || compareStrings(left.reason, right.reason));
    }

    return {
        version: DEPENDENCY_CHANGES_VERSION,
        range: { baseOid: report.range.baseOid, headOid: report.range.headOid },
        continuations,
        unknownContinuations,
        changes,
        affectedConsumers,
        limitations
    };
}
