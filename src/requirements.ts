import { createHash } from 'crypto';
import { parseSourceRef, resolveSourceRef, relocateSourceRefs, SourceRef, SourceSnapshot, SourcePair, SourceTransition } from 'bygone-strand/source-references';
import type { ChangeCorrespondence } from './changeCorrespondence';

// Experimental Bygone review policy. Source-reference mechanics belong to Strand.
export type Source = { title: string; text: string; quote: string };
export type Requirement = { id: string; text: string; sources: Source[] };
export type Question = { id: string; requirement: string; text: string; alternatives: { text: string; sources: Source[] }[] }
    & ({ status: 'open' } | { status: 'resolved'; resolution: string });
export type Link = { id: string; requirement: string; role: 'implementation' | 'test' | 'context' | 'counterexample'; rationale: string; ref: SourceRef };
export type Run = { revision: string; requirements: { requirement: string; fingerprint: string; scope: string }[]; command: string; outcome: 'passed' | 'failed'; outputDigest: string };
export type Analysis = { base: string; head: string; producer: string; status: 'complete' | 'partial' | 'unavailable'; scope: string[]; limitations: string[]; artifactDigest: string };
export type CorrespondenceEvidence = { pairs: SourcePair[]; analysis: Analysis };
export type Review = {
    version: 2; repository: string; base: string; head: string;
    requirements: Requirement[]; questions: Question[]; links: Link[]; runs: Run[]; analyses: Analysis[];
    decisions: { requirement: string; fingerprint: string; note: string }[];
};
export type Snapshot = SourceSnapshot & { repository: string };
export type Pair = SourcePair;
export const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
    return value as Record<string, unknown>;
}
function string(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 100_000) throw new Error('Expected bounded nonempty string');
    return value;
}
function list(value: unknown): unknown[] {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('Expected bounded array');
    return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
    if (!choices.includes(value as T)) throw new Error(`Expected ${choices.join('/')}`);
    return value as T;
}
function hash(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Expected SHA-256');
    return value;
}
function revision(value: unknown): string {
    if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error('Expected immutable Git revision');
    return value;
}
function sourceRef(value: unknown): SourceRef {
    const ref = parseSourceRef(value);
    revision(ref.revision);
    return ref;
}
function unique(values: string[]): void {
    if (new Set(values).size !== values.length) throw new Error('Duplicate ID');
}
function sources(value: unknown): Source[] {
    const result = list(value).map(value => {
        const s = record(value);
        const source = { title: string(s.title), text: string(s.text), quote: string(s.quote) };
        if (!source.text.includes(source.quote)) throw new Error('Source quotation does not exist');
        return source;
    });
    if (!result.length) throw new Error('Expected at least one source');
    return result;
}
function parseAnalysis(value: unknown): Analysis {
    const a = record(value), scope = list(a.scope).map(string);
    if (!scope.length) throw new Error('Expected analysis scope');
    return { base: revision(a.base), head: revision(a.head), producer: string(a.producer),
        status: choice(a.status, ['complete', 'partial', 'unavailable'] as const), scope,
        limitations: list(a.limitations).map(string), artifactDigest: hash(a.artifactDigest) };
}

/** Host must validate the artifact against Git before accepting it. No I/O or authenticity check here.
 * Scope describes the supplied inputs; complete means complete only within that scope.
 * The digest identifies the JSON serialization of the supplied, validated artifact.
 */
export function correspondenceEvidence(artifact: ChangeCorrespondence, scope: string[]): CorrespondenceEvidence {
    const ref = (side: 'before' | 'after', id: string): SourceRef => {
        const symbol = artifact.symbols[side].find(s => s.id === id);
        if (!symbol) throw new Error('Unknown correspondence symbol');
        return sourceRef({ revision: side === 'before' ? artifact.range.baseOid : artifact.range.headOid,
            path: symbol.path, start: symbol.start, end: symbol.end, digest: symbol.digest });
    };
    return { pairs: artifact.relations.map(r => ({ before: ref('before', r.sourceId), after: ref('after', r.destinationId) })),
        analysis: parseAnalysis({ base: artifact.range.baseOid, head: artifact.range.headOid, producer: artifact.producer,
            status: artifact.status, scope: [...scope, ...(artifact.diagnostics?.scope || [])],
            limitations: artifact.limitations, artifactDigest: digest(JSON.stringify(artifact)) }) };
}

/** Runtime boundary for authored/imported JSON; unknown fields are discarded. */
export function parseReview(value: unknown): Review {
    const r = record(value);
    if (r.version !== 2) throw new Error('Unsupported review version');
    const requirements = list(r.requirements).map(value => {
        const x = record(value);
        return { id: string(x.id), text: string(x.text), sources: sources(x.sources) };
    });
    unique(requirements.map(r => r.id));
    const requirement = (value: unknown): string => {
        const id = string(value);
        if (!requirements.some(r => r.id === id)) throw new Error(`Unknown requirement: ${id}`);
        return id;
    };
    const questions = list(r.questions).map((value): Question => {
        const q = record(value);
        const alternatives = list(q.alternatives).map(value => {
            const a = record(value);
            return { text: string(a.text), sources: sources(a.sources) };
        });
        const common = { id: string(q.id), requirement: requirement(q.requirement), text: string(q.text), alternatives };
        const status = choice(q.status, ['open', 'resolved'] as const);
        if (status === 'open' && q.resolution !== undefined) throw new Error('Open question cannot have a resolution');
        return status === 'open' ? { ...common, status } : { ...common, status, resolution: string(q.resolution) };
    });
    unique(questions.map(q => q.id));
    const links = list(r.links).map(value => {
        const x = record(value);
        return { id: string(x.id), requirement: requirement(x.requirement), role: choice(x.role, ['implementation', 'test', 'context', 'counterexample'] as const), rationale: string(x.rationale), ref: sourceRef(x.ref) };
    });
    unique(links.map(l => l.id));
    const runs = list(r.runs).map(value => {
        const x = record(value), associations = list(x.requirements).map(value => {
            const a = record(value);
            return { requirement: requirement(a.requirement), fingerprint: hash(a.fingerprint), scope: string(a.scope) };
        });
        unique(associations.map(a => a.requirement));
        return { revision: revision(x.revision), requirements: associations, command: string(x.command), outcome: choice(x.outcome, ['passed', 'failed'] as const), outputDigest: hash(x.outputDigest) };
    });
    const decisions = list(r.decisions).map(value => {
        const x = record(value);
        return { requirement: requirement(x.requirement), fingerprint: hash(x.fingerprint), note: string(x.note) };
    });
    unique(decisions.map(d => d.requirement));
    return { version: 2, repository: string(r.repository), base: revision(r.base), head: revision(r.head), requirements, questions, links, runs, analyses: list(r.analyses).map(parseAnalysis), decisions };
}

function snapshotsMatch(review: Review, base: Snapshot, head: Snapshot): void {
    if (review.repository !== base.repository || review.repository !== head.repository || review.base !== base.revision || review.head !== head.revision) throw new Error('Repository or comparison mismatch');
}
function sourceSubset(snapshot: Snapshot, paths: string[]): SourceSnapshot {
    // Strand bounds the sources it operates on, not the host's entire repository.
    const present = [...new Set(paths)].filter(path => Object.prototype.hasOwnProperty.call(snapshot.files, path));
    return { revision: snapshot.revision, files: Object.fromEntries(present.map(path => [path, snapshot.files[path]])) };
}
function resolveReference(ref: SourceRef, snapshot: Snapshot) {
    return resolveSourceRef(ref, sourceSubset(snapshot, [ref.path]));
}
export function requirementFingerprint(review: Review, id: string): string {
    const requirement = review.requirements.find(r => r.id === id);
    if (!requirement) throw new Error(`Unknown requirement: ${id}`);
    return digest(JSON.stringify({ repository: review.repository, requirement, questions: review.questions.filter(q => q.requirement === id) }));
}
export function fingerprint(review: Review, id: string): string {
    // Conservative by design: every new comparison needs review, even when local bytes match.
    return digest(JSON.stringify({ repository: review.repository, base: review.base, head: review.head,
        requirement: requirementFingerprint(review, id), links: review.links.filter(l => l.requirement === id),
        runs: review.runs.filter(r => r.requirements.some(a => a.requirement === id)), analyses: review.analyses }));
}
export function inspect(review: Review, base: Snapshot, head: Snapshot) {
    snapshotsMatch(review, base, head);
    const links = review.links.map(link => ({ ...link, resolution: resolveReference(link.ref, link.ref.revision === base.revision ? base : head) }));
    const requirements = review.requirements.map(requirement => {
        const attached = links.filter(l => l.requirement === requirement.id);
        const valid = attached.filter(l => l.resolution.status === 'valid');
        const key = requirementFingerprint(review, requirement.id);
        const runs = review.runs.flatMap(run => run.requirements.filter(a => a.requirement === requirement.id).map(association => ({
            ...run, association, applicability: run.revision !== head.revision ? 'historical-revision'
                : association.fingerprint === key ? 'current' : 'stale-requirement'
        })));
        const currentRuns = runs.filter(r => r.applicability === 'current');
        const decision = review.decisions.find(d => d.requirement === requirement.id);
        return { ...requirement, questions: review.questions.filter(q => q.requirement === requirement.id), runs, links: attached, implementationLinked: valid.some(l => l.role === 'implementation'),
            testLinked: valid.some(l => l.role === 'test'), counterexampleLinked: valid.some(l => l.role === 'counterexample'),
            verification: currentRuns.length ? (currentRuns.some(r => r.outcome === 'failed') ? 'recorded-failure' : 'recorded-pass')
                : runs.some(r => r.applicability === 'stale-requirement') ? 'needs-reassessment' : 'not-recorded',
            reviewer: !decision ? 'unreviewed' : decision.fingerprint === fingerprint(review, requirement.id) && attached.every(l => l.resolution.status === 'valid') ? 'inspected' : 'needs-review',
            note: decision?.note };
    });
    const changedPaths = [...new Set([...Object.keys(base.files), ...Object.keys(head.files)])].filter(p => base.files[p] !== head.files[p]).sort();
    return { requirements, analyses: review.analyses.map(analysis => ({ ...analysis,
        relevance: analysis.head !== review.head ? 'historical' : analysis.base === review.base ? 'current-comparison' : 'current-head-delta' })),
        changedPathsWithoutLinks: changedPaths.filter(p => !links.some(l => l.ref.path === p && l.resolution.status === 'valid')) };
}

/** Pairs must come from an accepted, validated correspondence artifact for old-head → new-head.
 * This layer rechecks endpoints, rejects competing pairs, and never promotes unmatched evidence.
 * Only whole-declaration references follow Strand in this experiment; arbitrary subranges do not.
 * Same-revision requirement updates retain references and accept no correspondence pairs.
 */
export function refresh(review: Review, oldHead: Snapshot, newHead: Snapshot, evidence?: CorrespondenceEvidence, requirements = review.requirements) {
    if (review.repository !== oldHead.repository || review.repository !== newHead.repository || review.head !== oldHead.revision) throw new Error('Repository or old head mismatch');
    revision(oldHead.revision); revision(newHead.revision);
    if (evidence !== undefined) {
        record(evidence);
        if (!Array.isArray(evidence.pairs)) throw new Error('Expected correspondence pairs');
    }
    const analysis = evidence === undefined ? undefined : parseAnalysis(evidence.analysis);
    const pairs = evidence === undefined ? [] : evidence.pairs;
    if (analysis && (analysis.base !== oldHead.revision || analysis.head !== newHead.revision)) throw new Error('Analysis comparison mismatch');
    if (analysis?.status === 'unavailable' && pairs.length) throw new Error('Unavailable analysis cannot supply pairs');
    const current = review.links.filter(link => link.ref.revision !== review.base);
    let relocated: SourceTransition[];
    if (oldHead.revision === newHead.revision) {
        if (pairs.length) throw new Error('Same-revision updates cannot supply correspondence pairs');
        relocated = current.map(({ ref }) => resolveReference(ref, oldHead).status === 'valid' && resolveReference(ref, newHead).status === 'valid'
            ? { status: 'unchanged', before: ref, after: ref }
            : { status: 'unresolved', before: ref });
    } else {
        const paths = current.map(link => link.ref.path);
        // Keep every supplied endpoint in scope so even unused pairs are validated.
        const before = sourceSubset(oldHead, [...paths, ...pairs.map(pair => pair.before.path)]);
        const after = sourceSubset(newHead, [...paths, ...pairs.map(pair => pair.after.path)]);
        relocated = relocateSourceRefs(current.map(link => link.ref), before, after, pairs);
    }
    const transitions: ((SourceTransition | { status: 'base-evidence'; before: SourceRef }) & { link: string })[] = [];
    let index = 0;
    const links = review.links.map(link => {
        const before = link.ref;
        if (before.revision === review.base) {
            transitions.push({ link: link.id, status: 'base-evidence', before }); return link;
        }
        const transition = relocated[index++];
        transitions.push({ ...transition, link: link.id });
        return transition.status === 'unresolved' ? link : { ...link, ref: transition.after };
    });
    // Reparse to enforce referential integrity if the requirement set was edited.
    const next = parseReview({ ...review, head: newHead.revision, requirements, links, analyses: analysis ? [...review.analyses, analysis] : review.analyses });
    return { review: next, transitions };
}
