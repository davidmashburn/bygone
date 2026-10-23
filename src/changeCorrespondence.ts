import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { diffLines } from 'diff';

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export interface CorrespondenceRange { baseOid: string; headOid: string }
export interface CorrespondenceDocument { path: string; digest: string; status: string; text?: string }
export interface CorrespondenceSymbol {
    id: string; path: string; name: string; kind: string; start: number; end: number;
    digest: string; startLine: number; endLine: number; text: string;
}
export interface CorrespondenceRelation {
    id: string; sourceId: string; destinationId: string; producers: string[];
    coverage?: 'complete';
    pathChanged: boolean; nameChanged: boolean; rawEqual: boolean;
    behavior: 'unassessed'; localDiff: Array<{ value: string; added?: boolean; removed?: boolean }>;
}
export interface CorrespondenceDiagnostic {
    category: 'outside' | 'syntax' | 'rejected' | 'unmatched' | 'relationship' | 'problem';
    reason: string; message?: string; producerId?: string;
    locations: Array<{ side?: 'before' | 'after'; path: string; start?: number; line?: number; symbolId?: string; reason?: string }>;
}
export interface ChangeCorrespondence {
    version: 1; range: CorrespondenceRange; producer: string;
    status: 'complete' | 'partial' | 'unavailable';
    documents: { before: CorrespondenceDocument[]; after: CorrespondenceDocument[] };
    symbols: { before: CorrespondenceSymbol[]; after: CorrespondenceSymbol[] };
    relations: CorrespondenceRelation[];
    unresolved: Array<{ reason: string; sourceIds: string[]; destinationIds: string[] }>;
    limitations: string[];
    diagnostics?: { version: 1; scope: string[]; records: CorrespondenceDiagnostic[] };
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
    const documentsBySide = { before: new Map<string, string>(), after: new Map<string, string>() };
    const lineIndexes = new Map<string, number[]>();
    const lineAt = (side: 'before' | 'after', path: string, start: number) => {
        const key = `${side}:${path}`;
        let lines = lineIndexes.get(key);
        if (!lines) {
            const text = documentsBySide[side].get(path)!;
            lines = [0];
            for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) lines.push(at + 1);
            lineIndexes.set(key, lines);
        }
        let low = 0, high = lines.length;
        while (low < high) { const mid = Math.floor((low + high) / 2); if (lines[mid] <= start) low = mid + 1; else high = mid; }
        return low;
    };
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
            documentsBySide[side].set(name, text);
            result.documents[side].push({ path: name, digest: expectedDigest, status: documentStatus, text });
        }
        for (const value of list(symbols[side])) {
            const entry = object(value), name = filePath(entry.path), doc = texts.get(name);
            const id = string(entry.id), start = integer(entry.start), end = integer(entry.end);
            if (!doc || start >= end || end > doc.text.length || entries.has(id)) throw new Error('Invalid correspondence symbol ownership/range/ID.');
            const text = doc.text.slice(start, end);
            symbolBytes += Buffer.byteLength(text);
            if (symbolBytes > MAX_SOURCE_BYTES || digest(text) !== hash(entry.digest)) throw new Error(`Correspondence symbol digest mismatch or budget exceeded: ${name}`);
            const symbol: CorrespondenceSymbol = { id, path: name, name: string(entry.name), kind: string(entry.kind), start, end,
                digest: digest(text), text, startLine: lineAt(side, name, start), endLine: lineAt(side, name, end - 1) };
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
        if (relation.coverage !== undefined && relation.coverage !== 'complete') throw new Error('Invalid correspondence relation coverage.');
        // A partial comparison can contain a producer-validated, fully searched
        // pair. Older reports without that claim retain the exact-only guard.
        const covered = result.status === 'partial' && relation.coverage === 'complete'
            && producers.some(producer => ['refactoring-miner', 'bygone-strand'].includes(producer));
        if (result.status !== 'complete' && !covered && !(producers.includes('exact-declaration') && source.symbol.text === destination.symbol.text)) continue;
        const a = source.symbol, b = destination.symbol;
        result.relations.push({ id, sourceId, destinationId, producers, pathChanged: a.path !== b.path, nameChanged: a.name !== b.name,
            ...(relation.coverage === 'complete' ? { coverage: 'complete' as const } : {}),
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
    if (data.diagnostics !== undefined) {
        const diagnostics = object(data.diagnostics);
        if (diagnostics.version !== 1) throw new Error('Unsupported correspondence diagnostics version.');
        let locationCount = 0;
        result.diagnostics = { version: 1, scope: list(diagnostics.scope, 20).map(string), records: list(diagnostics.records).map(value => {
            const record = object(value), category = string(record.category) as CorrespondenceDiagnostic['category'];
            if (!['outside', 'syntax', 'rejected', 'unmatched', 'relationship', 'problem'].includes(category)) throw new Error('Invalid correspondence diagnostic category.');
            return { category, reason: string(record.reason),
                ...(record.message !== undefined ? { message: string(record.message) } : {}),
                ...(record.producerId !== undefined ? { producerId: string(record.producerId) } : {}),
                locations: list(record.locations, 100).map(value => {
                    if (++locationCount > 40000) throw new Error('Correspondence diagnostic location budget exceeded.');
                    const location = object(value), path = filePath(location.path);
                    const side = location.side as 'before' | 'after' | undefined;
                    if (side !== undefined && side !== 'before' && side !== 'after') throw new Error('Invalid diagnostic revision side.');
                    const symbolId = location.symbolId === undefined ? undefined : string(location.symbolId);
                    if (symbolId && (entries.get(symbolId)?.side !== side || entries.get(symbolId)?.symbol.path !== path)) throw new Error('Invalid diagnostic symbol reference.');
                    const start = location.start === undefined ? (symbolId ? entries.get(symbolId)!.symbol.start : undefined) : integer(location.start);
                    const text = side ? documentsBySide[side].get(path) : undefined;
                    if (start !== undefined && (text === undefined || start > text.length)) throw new Error('Invalid diagnostic source location.');
                    return { path, ...(side ? { side } : {}), ...(symbolId ? { symbolId } : {}),
                        ...(start !== undefined ? { start, line: lineAt(side!, path, start) } : {}),
                        ...(location.reason !== undefined ? { reason: string(location.reason) } : {}) };
                }) };
        }) };
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
    const inventoryEntries = { before: new Map(list(before.entries).map(object).map(e => [e.id, e])),
        after: new Map(list(after.entries).map(object).map(e => [e.id, e])) };
    const unresolved = list(analysis.unresolved).map(value => {
        const candidate = object(value);
        return { reason: candidate.reason || candidate.kind || 'competing-origins',
            sourceIds: candidate.sources || candidate.sourceIds || [], destinationIds: candidate.destinations || candidate.destinationIds || [] };
    });
    const limitations = ['Correspondence is inferred from externally supplied analysis; source checks do not prove lineage or behavior.',
        'Symbol slices can exclude enclosing export/const/let syntax and surrounding bindings/imports; inspect complete file diffs for that context.',
        'Analysis covers only the supplied documents and inventoried declarations; unmatched does not mean repository-wide absence.',
        `${list(analysis.groups).length} extraction/inline groups are not accepted continuations.`,
        `${list(analysis.rejected).length} producer candidates were rejected; ${list(analysis.issues).length} producer issues.`,
        `${list(before.exclusions || []).length + list(after.exclusions || []).length} inventoried syntax exclusions (for example unsupported declaration forms).`,
        `${list(analysis.unmatchedBefore).length} unmatched before symbols; ${list(analysis.unmatchedAfter).length} unmatched after symbols.`];
    const engine = object(analysis.engine);
    if (analysis.status === 'complete' && (engine.truncated === true || engine.status !== 'complete')) throw new Error('Incomplete engine analysis cannot be complete.');
    if ((engine.truncated === true || engine.status !== 'complete')
        && list(analysis.relations).some(value => object(value).coverage === 'complete')) {
        throw new Error('Incomplete engine analysis cannot claim complete relation coverage.');
    }
    // Diagnostics are optional for old producer artifacts. Never reconstruct lost
    // details by parsing summary prose or present an absent field as zero records.
    const detailed = ['before', 'after'].every(side => Array.isArray(object(inventories[side]).exclusions)
        && list(object(inventories[side]).documents).every(doc => Array.isArray(object(doc).diagnostics)));
    const records: CorrespondenceDiagnostic[] = [];
    const add = (category: CorrespondenceDiagnostic['category'], raw: unknown, locations: CorrespondenceDiagnostic['locations'] = []) => {
        const value = object(raw);
        records.push({ category, reason: string(value.reason), locations,
            ...(value.message ? { message: string(value.message).slice(0, 4000) } : {}),
            ...(value.mapperId ? { producerId: string(value.mapperId) } : {}) });
    };
    const location = (raw: unknown, side?: 'before' | 'after', offsets = true): CorrespondenceDiagnostic['locations'] => {
        if (!raw || typeof raw !== 'object') return [];
        const value = object(raw);
        if (!value.path) return [];
        return [{ path: filePath(value.path), ...(side ? { side } : {}),
            ...(offsets && Number.isSafeInteger(value.start) && (value.start as number) >= 0 ? { start: value.start as number } : {}),
            ...(value.symbolId ? { symbolId: string(value.symbolId) } : {}),
            ...(value.reason ? { reason: string(value.reason) } : {}) }];
    };
    if (detailed) {
        for (const side of ['before', 'after'] as const) {
            const inventory = object(inventories[side]);
            for (const exclusion of list(inventory.exclusions)) add('syntax', exclusion, location(exclusion, side));
            for (const raw of list(inventory.documents)) {
                const doc = object(raw);
                for (const diagnostic of list(doc.diagnostics)) add('problem', { ...object(diagnostic), reason: 'parser-diagnostic' }, location({ ...object(diagnostic), path: doc.path }, side));
            }
        }
        for (const raw of list(analysis.rejected)) {
            const record = object(raw);
            // Invalid producer ranges remain path-only records. They must not
            // become trusted navigation offsets just because they are reported.
            const endpoints = record.endpoints === undefined ? [] : list(record.endpoints, 2);
            add('rejected', record, endpoints.length ? endpoints.flatMap(endpoint => {
                const e = object(endpoint); return location(e, e.side as 'before' | 'after');
            }) : [...location(record.source, 'before', false), ...location(record.destination, 'after', false)]);
        }
        for (const raw of list(analysis.issues)) {
            const issue = object(raw), side = issue.side === 'before' || issue.side === 'after' ? issue.side : undefined;
            const mapping = issue.mapping ? object(issue.mapping) : undefined;
            add('problem', issue, [...location(issue, side, false), ...location(issue.span, side, false),
                ...location(mapping?.source, 'before', false), ...location(mapping?.destination, 'after', false)]);
        }
        for (const raw of list(analysis.groups)) {
            const group = object(raw), locations: CorrespondenceDiagnostic['locations'] = [];
            for (const [side, id] of [['before', group.sourceId], ['after', group.destinationId]] as const) {
                const entry = inventoryEntries[side].get(id);
                if (entry) locations.push(...location({ ...entry, symbolId: id }, side));
            }
            add('relationship', { reason: group.kind, message: 'Detected relationship; not an accepted continuation. Behavior unassessed.' }, locations);
        }
        for (const raw of list(analysis.unresolved)) {
            const group = object(raw);
            if (!['repeated-exact-occurrences', 'ambiguous-js-candidates'].includes(String(group.reason)) || group.competingSources === undefined) continue;
            const locations: CorrespondenceDiagnostic['locations'] = [];
            for (const side of ['before', 'after'] as const) {
                for (const id of list(side === 'before' ? group.competingSources : group.competingDestinations)) {
                    const entry = inventoryEntries[side].get(id);
                    if (!entry) throw new Error('Invalid competing-origin diagnostic symbol.');
                    locations.push(...location({ ...entry, symbolId: id }, side));
                }
            }
            add('unmatched', { reason: group.reason,
                message: 'Competing origins; retained local continuations are included as reference points, not unresolved bindings.' }, locations);
        }
        for (const raw of list(analysis.unmatchedDiagnostics || [])) {
            const record = object(raw), side = record.side;
            if (side !== 'before' && side !== 'after') throw new Error('Invalid unmatched diagnostic side.');
            const entry = inventoryEntries[side].get(record.symbolId);
            if (!entry) throw new Error('Invalid unmatched diagnostic symbol.');
            add('unmatched', record, location({ ...entry, symbolId: record.symbolId }, side));
        }
        if (engine.status !== 'complete' || engine.truncated === true) add('problem', { reason: engine.truncated === true ? 'engine-truncated' : 'engine-incomplete',
            message: `Engine status: ${string(engine.status)}${engine.reason ? `; ${string(engine.reason)}` : '; no reason supplied'}.` });
        const scope = analysis.scope === undefined ? {} : object(analysis.scope);
        for (const raw of list(scope.excluded || [])) {
            const record = object(raw), side = record.oid === range.baseOid ? 'before' : record.oid === range.headOid ? 'after' : undefined;
            add('outside', record, location(record, side, false));
        }
    }
    const producer = engine.producer === 'bygone-strand' ? 'Bygone Strand correspondence engine v1' : 'RefactoringMiner research mapping adapter v1';
    const artifact = { version: 1, range, producer, status: analysis.status,
        documents: { before: before.documents, after: after.documents }, symbols: { before: before.entries, after: after.entries },
        relations: analysis.relations, unresolved, limitations,
        ...(detailed ? { diagnostics: { version: 1, scope: [String(object(analysis.scope || {}).note || 'Supplied documents only; repository-wide origins were not searched.')], records } } : {}) };
    return validateChangeCorrespondence(repoRoot, artifact, range);
}
