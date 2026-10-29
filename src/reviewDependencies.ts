import { SourceRef, parseSourceRef, resolveSourceRef } from 'bygone-strand/source-references';
import { Review } from './requirements';
import { readPinnedFile } from './reviewWorkspace';
import { inspectDependencyEvidenceV2 } from './reviewDependencyEvidence';

export interface DependencyEvidence { title: string; ref: SourceRef; phase: string; loading: string; resolution: string }
export interface DependencyInspection { links: DependencyEvidence[]; limitations: string[] }
const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid dependency evidence object');
    return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
    if (typeof value !== 'string' || !value.length || value.length > 10000) throw new Error('Invalid dependency evidence text');
    return value;
};
const list = (value: unknown): unknown[] => {
    if (!Array.isArray(value) || value.length > 20000) throw new Error('Invalid dependency evidence list');
    return value;
};
/** Imported analysis is navigation evidence, never an impact/safety judgment. */
export function inspectDependencies(root: string, review: Review, input: unknown): DependencyInspection {
    if (isVersion2Report(input)) return inspectDependencyEvidenceV2(root, review, input);
    const data = object(input), range = object(data.range);
    if (data.version !== 1 || range.baseOid !== review.base || range.headOid !== review.head || typeof range.dirtyWorkingTreeExcluded !== 'boolean') throw new Error('Dependency report does not match pinned review');
    const limits = object(data.limits), producer = object(data.producer);
    if (producer.name !== 'bygone') throw new Error('Unsupported dependency producer');
    text(producer.typescript);
    for (const [key, maximum] of Object.entries({ maxFiles: 2000, maxFileBytes: 1024 * 1024, maxBytes: 16 * 1024 * 1024, maxRecords: 20000, timeoutMs: 30000 })) {
        if (!Number.isSafeInteger(limits[key]) || Number(limits[key]) < 1 || Number(limits[key]) > maximum) throw new Error('Invalid dependency limits');
    }
    const deadline = Date.now() + Number(limits.timeoutMs);
    const checkTime = () => {
        if (Date.now() >= deadline) throw new Error('Dependency source validation time budget exhausted');
    };
    const limitations = list(data.assumptions).map(text);
    limitations.push('Syntactic module evidence only. Unchanged edges do not prove unchanged imported bindings, behavior, or call relationships.',
        'Dirty buffers are excluded. TypeScript syntax/options and malformed package metadata may limit resolution; absent diagnostics do not prove complete analysis.');
    const links: DependencyEvidence[] = [];
    const changes = object(data.changes), consumers = object(data.unchangedConsumers);
    const identity = (value: unknown) => {
        const edge = object(value), s = object(edge.source);
        return JSON.stringify([s.revision, s.oid, s.blobOid, s.file, s.start, s.end, s.digest, edge.kind, edge.relationship, edge.phase, edge.loading, edge.specifier, edge.target, edge.resolution]);
    };
    const cache = new Map<string, ReturnType<typeof readPinnedFile>>();
    let totalBytes = 0;
    for (const side of ['base', 'head'] as const) {
        checkTime();
        const sourceFiles = new Set<string>();
        let sourceBytes = 0;
        const snapshot = object(data[side]), oid = side === 'base' ? review.base : review.head;
        if (snapshot.oid !== oid) throw new Error('Dependency snapshot revision mismatch');
        const coverage = object(snapshot.coverage);
        if (typeof coverage.indexComplete !== 'boolean') throw new Error('Invalid dependency coverage');
        for (const key of ['candidateFiles', 'indexedFiles', 'omittedFiles', 'readBytes', 'unresolvedEdges', 'omittedDiagnostics']) {
            if (!Number.isSafeInteger(coverage[key]) || Number(coverage[key]) < 0) throw new Error('Invalid dependency coverage');
        }
        limitations.push(`${side}: ${coverage.indexedFiles}/${coverage.candidateFiles} files indexed; ${coverage.omittedFiles} omitted; ${coverage.unresolvedEdges} unresolved edges; ${coverage.omittedDiagnostics} omitted diagnostics; index ${coverage.indexComplete ? 'complete within limits' : 'partial'}.`);
        for (const diagnostic of list(snapshot.diagnostics)) {
            const d = object(diagnostic); limitations.push(`${side}: ${text(d.code)}: ${text(d.message)}`);
        }
        const inventory = list(snapshot.edges), initialization = list(snapshot.initialization);
        if (inventory.length + initialization.length > Number(limits.maxRecords)
            || Number(coverage.indexedFiles) > Number(limits.maxFiles) || Number(coverage.readBytes) > Number(limits.maxBytes)
            || Number(coverage.indexedFiles) + Number(coverage.omittedFiles) !== Number(coverage.candidateFiles)
            || Number(coverage.unresolvedEdges) !== inventory.filter(value => object(value).resolution !== 'resolved').length
            || (coverage.indexComplete && Number(coverage.omittedFiles) > 0)) throw new Error('Dependency coverage exceeds declared limits');
        const inventoryKeys = new Set(inventory.map(identity));
        const changed = list(changes[side === 'base' ? 'removed' : 'added']);
        const unchanged = list(consumers[side]);
        for (const edge of [...changed, ...unchanged]) if (!inventoryKeys.has(identity(edge))) throw new Error('Dependency summary references unknown inventory evidence');
        const changedKeys = new Set(changed.map(identity)), consumerKeys = new Set(unchanged.map(identity));
        for (const value of [...inventory, ...initialization]) {
            checkTime();
            const edge = object(value), source = object(edge.source);
            if (edge.evidence !== 'syntactic' || source.revision !== side || source.oid !== oid) throw new Error('Invalid dependency source provenance');
            const ref = parseSourceRef({ revision: oid, path: source.file, start: source.start, end: source.end, digest: source.digest });
            const key = `${oid}:${ref.path}`;
            if (!cache.has(key)) {
                const file = readPinnedFile(root, oid, ref.path, deadline); totalBytes += file ? Buffer.byteLength(file.text) : 0;
                if (totalBytes > 2 * Number(limits.maxBytes)) throw new Error('Dependency sources exceed declared combined snapshot limits');
                cache.set(key, file);
            }
            const file = cache.get(key);
            checkTime();
            if (!file || file.blob !== source.blobOid) throw new Error('Dependency blob mismatch');
            if (!sourceFiles.has(ref.path)) {
                sourceFiles.add(ref.path);
                const bytes = Buffer.byteLength(file.text);
                sourceBytes += bytes;
                // Records reveal a lower bound: files without sites and resolver inputs
                // cannot be reconstructed from this report's inventory.
                if (bytes > Number(limits.maxFileBytes) || sourceFiles.size > Number(limits.maxFiles)
                    || sourceBytes > Number(limits.maxBytes) || sourceFiles.size > Number(coverage.indexedFiles)
                    || sourceBytes > Number(coverage.readBytes)) throw new Error('Dependency sources exceed declared limits or coverage');
            }
            if (resolveSourceRef(ref, { revision: oid, files: { [ref.path]: file.text } }).status !== 'valid') throw new Error('Dependency source digest mismatch');
            const keyInInventory = identity(value);
            const category = changedKeys.has(keyInInventory) ? `reported ${side === 'base' ? 'removed' : 'added'} edge`
                : consumerKeys.has(keyInInventory) ? 'direct unchanged consumer' : initialization.includes(value) ? 'initialization site' : undefined;
            if (!category) continue;
            const relationship = typeof edge.relationship === 'string' ? edge.relationship : String(edge.kind ?? 'dependency');
            const destination = typeof edge.target === 'string' ? edge.target
                : typeof edge.specifier === 'string' ? edge.specifier : '(computed target)';
            const detail = initialization.includes(value) ? `${relationship} ${ref.path}`
                : `${ref.path} — ${relationship} ${JSON.stringify(edge.specifier ?? '(computed)')} → ${destination}`;
            links.push({ title: `${side}: ${category} · ${detail}`, ref,
                phase: typeof edge.phase === 'string' ? edge.phase : 'unspecified',
                loading: typeof edge.loading === 'string' ? edge.loading : 'unspecified',
                resolution: typeof edge.resolution === 'string' ? edge.resolution : 'initialization site' });
        }
    }
    checkTime();
    return { links, limitations };
}

function isVersion2Report(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (value as Record<string, unknown>).version === 2;
}
