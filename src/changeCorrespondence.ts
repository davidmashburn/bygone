import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { diffLines } from 'diff';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export interface CorrespondenceRange { baseOid: string; headOid: string }
export interface CorrespondenceDocument { path: string; digest: string; status: string }
export interface CorrespondenceSymbol {
    id: string; path: string; name: string; kind: string; start: number; end: number;
    digest: string; startLine: number; endLine: number; text: string;
}
export interface CorrespondenceRelation {
    id: string; sourceId: string; destinationId: string; producers: string[];
    pathChanged: boolean; nameChanged: boolean; rawEqual: boolean;
    behavior: 'unassessed'; localDiff: Array<{ value: string; added?: boolean; removed?: boolean }>;
}
export interface ChangeCorrespondence {
    version: 1; range: CorrespondenceRange; producer: string;
    status: 'complete' | 'partial' | 'unavailable';
    documents: { before: CorrespondenceDocument[]; after: CorrespondenceDocument[] };
    symbols: { before: CorrespondenceSymbol[]; after: CorrespondenceSymbol[] };
    relations: CorrespondenceRelation[];
    unresolved: Array<{ reason: string; sourceIds: string[]; destinationIds: string[] }>;
    limitations: string[];
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid correspondence object.');
    return value as ObjectValue;
}
function list(value: unknown, max = 20000): unknown[] {
    if (!Array.isArray(value) || value.length > max) throw new Error('Invalid or over-budget correspondence array.');
    return value;
}
function string(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 4096) throw new Error('Invalid correspondence string.');
    return value;
}
function integer(value: unknown): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid correspondence offset.');
    return value as number;
}
function filePath(value: unknown): string {
    const name = string(value);
    if (name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(p => !p || p === '.' || p === '..')) {
        throw new Error('Invalid correspondence repository path.');
    }
    return name;
}
function hash(value: unknown): string {
    const result = string(value);
    if (!/^[0-9a-f]{64}$/.test(result)) throw new Error('Invalid correspondence digest.');
    return result;
}
function status(value: unknown): ChangeCorrespondence['status'] {
    if (value !== 'complete' && value !== 'partial' && value !== 'unavailable') throw new Error('Invalid correspondence analysis status.');
    return value;
}
export function readCorrespondenceJson(file: string): unknown {
    if (statSync(file).size > MAX_BYTES) throw new Error('Correspondence file exceeds 16 MiB.');
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
function validateRange(value: unknown, expected: CorrespondenceRange): CorrespondenceRange {
    const input = object(value);
    for (const key of ['baseOid', 'headOid'] as const) {
        if (input[key] !== expected[key] || !/^[0-9a-f]{40,64}$/.test(expected[key])) {
            throw new Error('Correspondence revisions do not match the selected merge-base/head comparison.');
        }
    }
    return { ...expected };
}

/** Rebuild every source slice and local diff from pinned Git, never producer prose. */
export function validateChangeCorrespondence(repoRoot: string, input: unknown, expected: CorrespondenceRange): ChangeCorrespondence {
    const data = object(input);
    if (data.version !== 1) throw new Error('Unsupported correspondence version.');
    const range = validateRange(data.range, expected);
    const documents = object(data.documents), symbols = object(data.symbols);
    const result: ChangeCorrespondence = { version: 1, range, producer: string(data.producer), status: status(data.status),
        documents: { before: [], after: [] }, symbols: { before: [], after: [] }, relations: [], unresolved: [],
        limitations: list(data.limitations, 100).map(string) };
    const entries = new Map<string, { side: string; symbol: CorrespondenceSymbol; documentStatus: string }>();
    let sourceBytes = 0, symbolBytes = 0;
    for (const side of ['before', 'after'] as const) {
        const texts = new Map<string, { text: string; status: string }>();
        const oid = side === 'before' ? range.baseOid : range.headOid;
        for (const value of list(documents[side], 128)) {
            const doc = object(value), name = filePath(doc.path), expectedDigest = hash(doc.digest);
            const documentStatus = string(doc.status);
            if (!['complete', 'invalid', 'unsupported'].includes(documentStatus) || texts.has(name)) throw new Error('Invalid or duplicate correspondence document.');
            const bytes = execFileSync('git', ['show', `${oid}:${name}`], { cwd: repoRoot, timeout: 10000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
            const text = bytes.toString('utf8');
            sourceBytes += bytes.length;
            if (sourceBytes > MAX_SOURCE_BYTES || !Buffer.from(text, 'utf8').equals(bytes) || digest(text) !== expectedDigest) {
                throw new Error(`Correspondence source digest mismatch or source budget exceeded: ${side}/${name}`);
            }
            texts.set(name, { text, status: documentStatus });
            result.documents[side].push({ path: name, digest: expectedDigest, status: documentStatus });
        }
        for (const value of list(symbols[side])) {
            const entry = object(value), name = filePath(entry.path), doc = texts.get(name);
            const id = string(entry.id), start = integer(entry.start), end = integer(entry.end);
            if (!doc || start >= end || end > doc.text.length || entries.has(id)) throw new Error('Invalid correspondence symbol ownership/range/ID.');
            const text = doc.text.slice(start, end);
            symbolBytes += Buffer.byteLength(text);
            if (symbolBytes > MAX_SOURCE_BYTES || digest(text) !== hash(entry.digest)) throw new Error(`Correspondence symbol digest mismatch or budget exceeded: ${name}`);
            const symbol: CorrespondenceSymbol = { id, path: name, name: string(entry.name), kind: string(entry.kind), start, end,
                digest: digest(text), text, startLine: doc.text.slice(0, start).split('\n').length,
                endLine: doc.text.slice(0, end - 1).split('\n').length };
            entries.set(id, { side, symbol, documentStatus: doc.status }); result.symbols[side].push(symbol);
        }
    }
    const ids = new Set<string>(), sources = new Set<string>(), destinations = new Set<string>();
    for (const value of list(data.relations)) {
        const relation = object(value), id = string(relation.id), sourceId = string(relation.sourceId), destinationId = string(relation.destinationId);
        const source = entries.get(sourceId), destination = entries.get(destinationId);
        if (ids.has(id) || sources.has(sourceId) || destinations.has(destinationId)) throw new Error('Conflicting correspondence continuations; preserve them as unresolved candidates.');
        if (source?.side !== 'before' || destination?.side !== 'after' || source.documentStatus !== 'complete' || destination.documentStatus !== 'complete') {
            throw new Error('Correspondence endpoints must resolve to valid, parsed before/after documents.');
        }
        ids.add(id); sources.add(sourceId); destinations.add(destinationId);
        const producers = list(relation.producers, 10).map(string);
        // Partial searches may omit competitors. Only independent exact evidence survives.
        if (result.status !== 'complete' && !(producers.includes('exact-declaration') && source.symbol.text === destination.symbol.text)) continue;
        const a = source.symbol, b = destination.symbol;
        result.relations.push({ id, sourceId, destinationId, producers, pathChanged: a.path !== b.path, nameChanged: a.name !== b.name,
            rawEqual: a.text === b.text, behavior: 'unassessed', localDiff: (diffLines(a.text, b.text, { timeout: 100, maxEditLength: 2000 }) || [{ value: a.text, removed: true }, { value: b.text, added: true }]).map(part => ({ value: part.value,
                ...(part.added ? { added: true } : {}), ...(part.removed ? { removed: true } : {}) })) });
    }
    for (const value of list(data.unresolved)) {
        const candidate = object(value);
        const sourceIds = list(candidate.sourceIds).map(string), destinationIds = list(candidate.destinationIds).map(string);
        if (!sourceIds.length && !destinationIds.length) throw new Error('Unresolved correspondence needs candidate endpoints.');
        if (sourceIds.some(id => entries.get(id)?.side !== 'before') || destinationIds.some(id => entries.get(id)?.side !== 'after')) {
            throw new Error('Unresolved correspondence references unknown endpoints.');
        }
        if (sourceIds.some(id => sources.has(id)) || destinationIds.some(id => destinations.has(id))) throw new Error('Ambiguous endpoints cannot also be accepted continuations.');
        result.unresolved.push({ reason: string(candidate.reason), sourceIds, destinationIds });
    }
    return result;
}

export function loadChangeCorrespondence(repoRoot: string, file: string, range: CorrespondenceRange): ChangeCorrespondence {
    return validateChangeCorrespondence(repoRoot, readCorrespondenceJson(file), range);
}

/** Adapt one selected research/API analysis; no engine, parser or Java dependency. */
export function importChangeCorrespondence(repoRoot: string, input: unknown, range: CorrespondenceRange): ChangeCorrespondence {
    const analysis = object(object(input).analysis);
    if (analysis.version !== 1) throw new Error('Unsupported producer analysis version.');
    const inventories = object(analysis.inventories);
    const before = object(inventories.before), after = object(inventories.after);
    const unresolved = list(analysis.unresolved).map(value => {
        const candidate = object(value);
        return { reason: candidate.reason || candidate.kind || 'competing-origins',
            sourceIds: candidate.sources || candidate.sourceIds || [], destinationIds: candidate.destinations || candidate.destinationIds || [] };
    });
    const limitations = ['Correspondence is inferred from externally supplied analysis; source checks do not prove lineage or behavior.',
        'Symbol slices can exclude enclosing export/const/let syntax and surrounding bindings/imports; inspect complete file diffs for that context.',
        'Analysis covers only the supplied documents and inventoried declarations; unmatched does not mean repository-wide absence.',
        `${list(analysis.groups).length} extraction/inline groups are not navigable in this first slice.`,
        `${list(analysis.rejected).length} producer containers were rejected; ${list(analysis.issues).length} producer issues.`,
        `${list(before.exclusions || []).length + list(after.exclusions || []).length} inventoried syntax exclusions (for example unsupported declaration forms).`,
        `${list(analysis.unmatchedBefore).length} unmatched before symbols; ${list(analysis.unmatchedAfter).length} unmatched after symbols.`];
    const engine = object(analysis.engine);
    if (analysis.status === 'complete' && (engine.truncated === true || engine.status !== 'complete')) throw new Error('Incomplete engine analysis cannot be complete.');
    const artifact = { version: 1, range, producer: 'RefactoringMiner research mapping adapter v1', status: analysis.status,
        documents: { before: before.documents, after: after.documents }, symbols: { before: before.entries, after: after.entries },
        relations: analysis.relations, unresolved, limitations };
    return validateChangeCorrespondence(repoRoot, artifact, range);
}
