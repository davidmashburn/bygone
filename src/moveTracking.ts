import { buildTwoWayDiffModel, type DiffBuildOptions, type TwoWayDiffModel } from './diffEngine';

// Slice 0 of plans/text-block-move-tracking.md: a diagnostic, exact-only
// correspondence layer beside the ordinary diff. Nothing here changes rows,
// blocks, scroll anchors, or copy-across; the thresholds are sweep hypotheses.

export const MOVE_ANALYSIS_VERSION = 'exact-v0';

export interface LineRange {
    start: number; // zero-based, inclusive
    end: number;   // zero-based, exclusive
}

export interface MoveRelation {
    id: string;
    kind: 'move' | 'copy';
    source: LineRange;
    destination: LineRange;
    matchMode: 'raw';
}

export interface UnresolvedCorrespondence {
    id: string;
    reason: 'competing-origins' | 'fan-out';
    destinations: LineRange[];
    sources: LineRange[];
}

export interface ChangeAccounting {
    raw: { added: number; removed: number };
    interpreted: {
        movedSource: number;
        movedDestination: number;
        copiedDestination: number;
        modifiedAdded: number;
        modifiedRemoved: number;
        added: number;
        removed: number;
        unresolvedAdded: number;
        unresolvedRemoved: number;
    };
}

export interface MoveAnalysis {
    version: string;
    policy: MovePolicy;
    status: 'complete' | 'unavailable';
    reason?: 'fallback-diff' | 'work-budget';
    relations: MoveRelation[];
    unresolved: UnresolvedCorrespondence[];
    accounting: ChangeAccounting;
}

export interface MovePolicy {
    minNonblankLines: number;
    minInformativeChars: number;
    singleLineMinChars: number;
    maxSeedFrequency: number;
    maxCandidatePairs: number;
}

export const DEFAULT_MOVE_POLICY: MovePolicy = {
    minNonblankLines: 3,
    minInformativeChars: 40,
    singleLineMinChars: 80,
    maxSeedFrequency: 16,
    maxCandidatePairs: 200_000
};

type LeftClass = 'retained' | 'removed';

interface Candidate {
    kind: 'move' | 'copy';
    source: LineRange;
    destination: LineRange;
}

const INFORMATIVE = /[\p{L}\p{N}]/gu;

function informativeChars(line: string): number {
    return line.match(INFORMATIVE)?.length ?? 0;
}

function overlaps(a: LineRange, b: LineRange): boolean {
    return a.start < b.end && b.start < a.end;
}

function sameRange(a: LineRange, b: LineRange): boolean {
    return a.start === b.start && a.end === b.end;
}

export function analyzeMoves(
    leftContent: string,
    rightContent: string,
    options: { policy?: Partial<MovePolicy>; diff?: DiffBuildOptions; model?: TwoWayDiffModel } = {}
): MoveAnalysis {
    const policy = { ...DEFAULT_MOVE_POLICY, ...options.policy };
    const model = options.model ?? buildTwoWayDiffModel(leftContent, rightContent, options.diff);
    const leftLines = model.leftLines.map(line => line.content);
    const rightLines = model.rightLines.map(line => line.content);
    const leftClass: LeftClass[] = model.leftLines.map(line => line.kind === 'context' ? 'retained' : 'removed');
    const rightAdded = model.rightLines.map(line => line.kind === 'added');
    const empty = (status: MoveAnalysis['status'], reason?: MoveAnalysis['reason']): MoveAnalysis => ({
        version: MOVE_ANALYSIS_VERSION, policy, status, reason, relations: [], unresolved: [],
        accounting: account(model, [], [])
    });
    // A whole-file delete/insert fallback is not evidence of relocation.
    if (model.quality === 'fallback') return empty('unavailable', 'fallback-diff');

    const candidates = findExactCandidates(leftLines, rightLines, leftClass, rightAdded, policy);
    if (!candidates) return empty('unavailable', 'work-budget');
    const eligible = candidates.filter(candidate => isInformative(candidate, leftLines, rightLines, policy));
    const { relations, unresolved } = resolve(eligible);
    return {
        version: MOVE_ANALYSIS_VERSION, policy, status: 'complete', relations, unresolved,
        accounting: account(model, relations, unresolved)
    };
}

// Maximal exact runs whose destination lines are all added and whose source
// lines share one class. Removed sources propose moves; retained sources copies.
function findExactCandidates(
    leftLines: string[], rightLines: string[], leftClass: LeftClass[], rightAdded: boolean[], policy: MovePolicy
): Candidate[] | null {
    const positions = new Map<string, number[]>();
    leftLines.forEach((line, index) => {
        const list = positions.get(line);
        if (list) list.push(index); else positions.set(line, [index]);
    });
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    let work = 0;
    for (let j = 0; j < rightLines.length; j++) {
        if (!rightAdded[j] || informativeChars(rightLines[j]) === 0) continue;
        const sources = positions.get(rightLines[j]);
        // Frequent lines may extend a run but cannot start one.
        if (!sources || sources.length > policy.maxSeedFrequency) continue;
        for (const i of sources) {
            if (++work > policy.maxCandidatePairs) return null;
            const kind = leftClass[i];
            let start = 0;
            while (i - start > 0 && j - start > 0 && rightAdded[j - start - 1] && leftClass[i - start - 1] === kind
                && leftLines[i - start - 1] === rightLines[j - start - 1]) start++;
            let end = 1;
            while (i + end < leftLines.length && j + end < rightLines.length && rightAdded[j + end]
                && leftClass[i + end] === kind && leftLines[i + end] === rightLines[j + end]) end++;
            const key = `${i - start}:${j - start}:${start + end}`;
            work += start + end;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
                kind: kind === 'removed' ? 'move' : 'copy',
                source: { start: i - start, end: i + end },
                destination: { start: j - start, end: j + end }
            });
        }
    }
    return candidates;
}

function isInformative(candidate: Candidate, leftLines: string[], rightLines: string[], policy: MovePolicy): boolean {
    const lines = rightLines.slice(candidate.destination.start, candidate.destination.end);
    const nonblank = lines.filter(line => line.trim()).length;
    const chars = lines.reduce((sum, line) => sum + informativeChars(line), 0);
    if (nonblank >= policy.minNonblankLines && chars >= policy.minInformativeChars) return true;
    // A rare substantive single line must be unique on both sides.
    if (lines.length !== 1 || chars < policy.singleLineMinChars) return false;
    const count = (source: string[]) => source.filter(line => line === lines[0]).length;
    return count(leftLines) === 1 && count(rightLines) === 1;
}

// Conservative, deterministic resolution: a candidate is accepted only when it
// is strictly longer than every overlapping competitor with a different
// explanation. Ties stay unresolved; they are never broken by source order.
function resolve(candidates: Candidate[]): { relations: MoveRelation[]; unresolved: UnresolvedCorrespondence[] } {
    const length = (candidate: Candidate) => candidate.destination.end - candidate.destination.start;
    const ordered = [...candidates].sort((a, b) => length(b) - length(a)
        || a.destination.start - b.destination.start || a.source.start - b.source.start);
    const accepted: Candidate[] = [];
    const tied: Candidate[][] = [];
    const settled = new Set<Candidate>();
    for (const candidate of ordered) {
        if (settled.has(candidate)) continue;
        settled.add(candidate);
        // A longer accepted or tied explanation already owns part of this destination.
        const claimed = (other: Candidate) => accepted.some(owner => overlaps(owner.destination, other.destination))
            || tied.some(group => group.some(owner => overlaps(owner.destination, other.destination)));
        if (claimed(candidate)) continue;
        const equal = ordered.filter(other => other !== candidate && !settled.has(other) && !claimed(other)
            && length(other) === length(candidate) && overlaps(other.destination, candidate.destination)
            && !sameRange(other.source, candidate.source));
        if (equal.length) {
            equal.forEach(other => settled.add(other));
            tied.push([candidate, ...equal]);
            continue;
        }
        accepted.push(candidate);
    }

    // A removed source has at most one continuation. Fan-out of a disappearing
    // occurrence is reported rather than assigned to an arbitrary destination.
    const fanOut: Candidate[][] = [];
    const moves = accepted.filter(candidate => candidate.kind === 'move');
    const blocked = new Set<Candidate>();
    for (const move of moves) {
        if (blocked.has(move)) continue;
        const group = moves.filter(other => overlaps(other.source, move.source));
        if (group.length > 1) {
            group.forEach(other => blocked.add(other));
            fanOut.push(group);
        }
    }

    const relations = accepted.filter(candidate => !blocked.has(candidate))
        .sort((a, b) => a.destination.start - b.destination.start)
        .map((candidate, index): MoveRelation => ({
            id: `${candidate.kind === 'move' ? 'M' : 'C'}${index + 1}`,
            kind: candidate.kind, source: candidate.source, destination: candidate.destination, matchMode: 'raw'
        }));
    const group = (reason: UnresolvedCorrespondence['reason'], members: Candidate[], index: number): UnresolvedCorrespondence => ({
        id: `U${index + 1}`, reason,
        destinations: uniqueRanges(members.map(member => member.destination)),
        sources: uniqueRanges(members.map(member => member.source))
    });
    const unresolved = [
        ...tied.map(members => ({ reason: 'competing-origins' as const, members })),
        ...fanOut.map(members => ({ reason: 'fan-out' as const, members }))
    ].sort((a, b) => a.members[0].destination.start - b.members[0].destination.start)
        .map(({ reason, members }, index) => group(reason, members, index));
    return { relations, unresolved };
}

function uniqueRanges(ranges: LineRange[]): LineRange[] {
    return ranges.filter((range, index) => ranges.findIndex(other => sameRange(other, range)) === index)
        .sort((a, b) => a.start - b.start);
}

// Partition raw changed lines by range intersection. Every raw added/removed
// line lands in exactly one interpreted category; retained copy sources are
// references and are not counted as removals.
function account(model: TwoWayDiffModel, relations: MoveRelation[], unresolved: UnresolvedCorrespondence[]): ChangeAccounting {
    const leftOwner = new Array<string | undefined>(model.leftLines.length);
    const rightOwner = new Array<string | undefined>(model.rightLines.length);
    const mark = (owner: Array<string | undefined>, range: LineRange, label: string) => {
        for (let line = range.start; line < range.end; line++) owner[line] ??= label;
    };
    for (const relation of relations) {
        mark(rightOwner, relation.destination, relation.kind === 'move' ? 'movedDestination' : 'copiedDestination');
        if (relation.kind === 'move') mark(leftOwner, relation.source, 'movedSource');
    }
    for (const group of unresolved) {
        group.destinations.forEach(range => mark(rightOwner, range, 'unresolvedAdded'));
        group.sources.forEach(range => mark(leftOwner, range, 'unresolvedRemoved'));
    }
    const inReplace = (side: 'left' | 'right', line: number) => model.blocks.some(block => block.kind === 'replace'
        && line >= block[`${side}Start`] && line < block[`${side}End`]);
    const interpreted: ChangeAccounting['interpreted'] = {
        movedSource: 0, movedDestination: 0, copiedDestination: 0, modifiedAdded: 0, modifiedRemoved: 0,
        added: 0, removed: 0, unresolvedAdded: 0, unresolvedRemoved: 0
    };
    const raw = { added: 0, removed: 0 };
    model.leftLines.forEach((line, index) => {
        if (line.kind !== 'removed') return;
        raw.removed++;
        const owner = leftOwner[index] as keyof typeof interpreted | undefined;
        interpreted[owner ?? (inReplace('left', index) ? 'modifiedRemoved' : 'removed')]++;
    });
    model.rightLines.forEach((line, index) => {
        if (line.kind !== 'added') return;
        raw.added++;
        const owner = rightOwner[index] as keyof typeof interpreted | undefined;
        interpreted[owner ?? (inReplace('right', index) ? 'modifiedAdded' : 'added')]++;
    });
    return { raw, interpreted };
}

// One-based inclusive labels are produced only at this presentation boundary.
export function formatMoveAnalysis(analysis: MoveAnalysis): string {
    const label = (side: 'L' | 'R', range: LineRange) => range.end - range.start === 1
        ? `${side}${range.start + 1}` : `${side}${range.start + 1}-${range.end}`;
    const lines = [`status: ${analysis.status}${analysis.reason ? ` (${analysis.reason})` : ''} · ${analysis.version}`];
    for (const relation of analysis.relations) {
        const note = relation.kind === 'copy' ? ' (source retained)' : '';
        lines.push(`${relation.id} ${relation.kind} ${label('L', relation.source)} → ${label('R', relation.destination)}${note}`);
    }
    for (const group of analysis.unresolved) {
        lines.push(`${group.id} unresolved ${group.reason}: ${group.sources.map(range => label('L', range)).join(', ')} → ${group.destinations.map(range => label('R', range)).join(', ')}`);
    }
    const { raw, interpreted: i } = analysis.accounting;
    lines.push(`raw: +${raw.added} -${raw.removed}`);
    lines.push(`interpreted: moved -${i.movedSource}/+${i.movedDestination}, copied +${i.copiedDestination}, modified -${i.modifiedRemoved}/+${i.modifiedAdded}, added +${i.added}, removed -${i.removed}, unresolved -${i.unresolvedRemoved}/+${i.unresolvedAdded}`);
    return lines.join('\n');
}
