import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { resolveBranchReviewRange } from './gitComparison';
import { serializeDeepLink } from './deepLink';
import { DEFAULT_DEPENDENCY_LIMITS, type DependencySource, type DependencyGraphOptions } from './dependencyGraph';

export type DependencyLanguage = 'python' | 'typescript' | 'go' | 'rust' | 'mojo';
export interface EvidenceNode {
    id: string; name: string; kind: 'function' | 'class' | 'module-init';
    language: DependencyLanguage; source: DependencySource;
}
export interface EvidenceSite {
    id: string; owner: string; relation: 'import' | 'reexport' | 'call' | 'construct' | 'reference';
    name: string; phase: 'module-init' | 'invocation' | 'type' | 'unknown';
    resolution: 'resolved' | 'ambiguous' | 'unresolved' | 'external' | 'unsupported';
    target?: string; candidates?: string[]; specifier?: string; loading?: 'eager' | 'deferred'; reason?: string;
    evidence: 'static'; producer: string; source: DependencySource;
}
export interface EvidenceSnapshot {
    oid: string; nodes: EvidenceNode[]; sites: EvidenceSite[];
    producers: { language: DependencyLanguage; name: string }[];
    diagnostics: { code: string; message: string; file?: string; language?: DependencyLanguage }[];
    coverage: { candidateFiles: number; indexedFiles: number; omittedFiles: number; readBytes: number;
        indexComplete: boolean; unresolvedSites: number; omittedDiagnostics: number };
}
export interface DependencyEvidenceReport {
    version: 2; kind: 'dependency-evidence';
    range: { baseOid: string; headOid: string; dirtyWorkingTreeExcluded: boolean };
    configuration: { pythonRoots: string[]; scopes: string[] };
    limits: typeof DEFAULT_DEPENDENCY_LIMITS; assumptions: string[];
    base: EvidenceSnapshot; head: EvidenceSnapshot;
}
export interface DependencyEvidenceOptions extends DependencyGraphOptions { pythonRoots?: string[]; scopes?: string[]; }
const LANGUAGES: DependencyLanguage[] = ['python', 'typescript', 'go', 'rust', 'mojo'];
export function dependencyLanguage(file: string): DependencyLanguage | undefined {
    if (/\.pyi?$/.test(file)) return 'python';
    if (/\.[cm]?[jt]sx?$/.test(file)) return 'typescript';
    if (/\.go$/.test(file)) return 'go';
    if (/\.rs$/.test(file)) return 'rust';
    if (/\.(mojo|🔥)$/.test(file)) return 'mojo';
    return undefined;
}
const nodeKey = (file: string, id: string) => JSON.stringify([file, id]);
const MAX_BUFFER = 32 * 1024 * 1024;
interface AdapterNode {
    id: string; name: string; kind: EvidenceNode['kind']; start: number; end: number;
}
interface AdapterSite extends Pick<EvidenceSite, 'owner' | 'relation' | 'name' | 'phase' | 'resolution' | 'specifier' | 'loading' | 'reason'> {
    start: number; end: number; target?: unknown; candidates?: unknown;
}
interface AdapterOutput {
    producer: string;
    documents: Record<string, { status: string; nodes: AdapterNode[]; sites: AdapterSite[]; diagnostics: { code: string; message: string }[] }>;
}
interface PendingAdapterSite {
    file: string; language: DependencyLanguage; site: AdapterSite; producer: string;
}
interface RecordBuffer<T> {
    add(candidate: T): boolean;
    ordered(): T[];
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Keep enough per-file candidates for a deterministic fair pass, with a
 * bounded overflow for files whose fair-share quota is exhausted. The
 * adapter output is already bounded, but this buffer must not retain every
 * declaration or site across adapter outputs as parent-process pending state.
 */
function createRecordBuffer<T extends { file: string }>(fileOrder: readonly string[], maxRecords: number): RecordBuffer<T> {
    const perFileQuota = Math.max(1, Math.ceil(maxRecords / Math.max(1, fileOrder.length)));
    const balanced = new Map<string, T[]>();
    const overflowByFile = new Map<string, T[]>();
    let overflowCount = 0;
    return {
        add(candidate) {
            const queue = balanced.get(candidate.file) ?? [];
            if (queue.length < perFileQuota) {
                queue.push(candidate); balanced.set(candidate.file, queue); return true;
            }
            if (overflowCount >= maxRecords) return false;
            const overflowQueue = overflowByFile.get(candidate.file) ?? [];
            overflowQueue.push(candidate); overflowByFile.set(candidate.file, overflowQueue); overflowCount++;
            return true;
        },
        ordered() {
            const result: T[] = [];
            const active = fileOrder.filter(file => balanced.has(file) || overflowByFile.has(file));
            const maxBalanced = Math.max(0, ...active.map(file => balanced.get(file)?.length ?? 0));
            for (let round = 0; round < maxBalanced; round++) {
                for (const file of active) {
                    const candidate = balanced.get(file)?.[round];
                    if (candidate) result.push(candidate);
                }
            }
            const overflowFiles = fileOrder.filter(file => overflowByFile.has(file));
            const maxOverflow = Math.max(0, ...overflowFiles.map(file => overflowByFile.get(file)?.length ?? 0));
            for (let round = 0; round < maxOverflow; round++) {
                for (const file of overflowFiles) {
                    const candidate = overflowByFile.get(file)?.[round];
                    if (candidate) result.push(candidate);
                }
            }
            return result;
        }
    };
}

/** Analyze immutable Git blobs. Adapters run in bounded child processes and never execute repository code. */
export function buildDependencyEvidence(startPath: string, options: DependencyEvidenceOptions = {}): DependencyEvidenceReport {
    const limits = { ...DEFAULT_DEPENDENCY_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_DEPENDENCY_LIMITS[key as keyof typeof limits]) {
            throw new Error(`Invalid dependency limit: ${key}`);
        }
    }
    const pythonRoots = options.pythonRoots ?? ['', 'src'];
    if (pythonRoots.some(root => typeof root !== 'string' || root.startsWith('/') || root.includes('\\') || root.split('/').includes('..'))) {
        throw new Error('Python roots must be repository-relative paths without parent traversal.');
    }
    if (options.scopes?.some(scope => typeof scope !== 'string' || scope.startsWith('/') || /^[A-Za-z]:/.test(scope)
        || scope.includes('\\') || scope.split('/').includes('..'))) {
        throw new Error('Dependency scopes must be repository-relative paths without parent traversal.');
    }
    const scopes = [...new Set((options.scopes ?? []).map(scope => scope.split('/').filter(part => part && part !== '.').join('/')))];
    const inScope = (file: string) => !scopes.length || scopes.some(scope => !scope || file === scope || file.startsWith(scope + '/'));
    const deadline = Date.now() + limits.timeoutMs;
    const git = (args: string[], cwd: string, input?: string): Buffer => {
        if (Date.now() >= deadline) throw new Error('Dependency analysis time budget exhausted.');
        return execFileSync('git', args, { cwd, input, maxBuffer: MAX_BUFFER, timeout: deadline - Date.now(), stdio: ['pipe', 'pipe', 'pipe'] });
    };
    const range = options.range ?? resolveBranchReviewRange(startPath, options.headRef, options.baseRef,
        (args, cwd) => git([...args], cwd).toString('utf8').trimEnd());
    const snapshot = (revision: 'base' | 'head'): EvidenceSnapshot => {
        const oid = revision === 'base' ? range.mergeBaseOid : range.headOid;
        const result: EvidenceSnapshot = { oid, nodes: [], sites: [], producers: [], diagnostics: [], coverage: {
            candidateFiles: 0, indexedFiles: 0, omittedFiles: 0, readBytes: 0, indexComplete: true, unresolvedSites: 0, omittedDiagnostics: 0
        } };
        const diagnostic = (code: string, message: string, file?: string, language?: DependencyLanguage) => {
            if (result.diagnostics.length < 1000) result.diagnostics.push({ code, message, ...(file ? { file } : {}), ...(language ? { language } : {}) });
            else result.coverage.omittedDiagnostics++;
        };
        const contents: Record<string, string> = Object.create(null);
        const blobs = new Map<string, string>();
        try {
            const rows = git(['ls-tree', '-r', '-l', '-z', oid], range.repoRoot).toString('utf8').split('\0');
            const entries = rows.flatMap(row => {
                const m = /^(\d+) blob ([a-f\d]+)\s+(\d+)\t([\s\S]+)$/.exec(row);
                return m ? [{ mode: m[1], oid: m[2], size: Number(m[3]), file: m[4] }] : [];
            }).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
            const candidates = entries.filter(e => dependencyLanguage(e.file) && inScope(e.file));
            result.coverage.candidateFiles = candidates.length;
            const metadata = entries.filter(e => /(?:^|\/)(?:go\.mod|Cargo\.toml|(?:tsconfig|jsconfig|package)\.json)$/.test(e.file)
                && candidates.some(candidate => candidate.file.startsWith(e.file.slice(0, e.file.lastIndexOf('/') + 1))));
            const selected: typeof entries = [];
            let bytes = 0;
            // Source budgets favor the requested language priority. Metadata uses the same bounds.
            for (const entry of [...metadata, ...LANGUAGES.flatMap(language => candidates.filter(e => dependencyLanguage(e.file) === language))]) {
                if (!['100644', '100755'].includes(entry.mode) || entry.file.split('/').some(p => ['node_modules', '.venv', 'vendor', 'target'].includes(p))
                    || entry.size > limits.maxFileBytes || selected.length >= limits.maxFiles || bytes + entry.size > limits.maxBytes) {
                    result.coverage.indexComplete = false;
                    diagnostic('file-omitted', 'File excluded or exceeds the snapshot budget.', entry.file); continue;
                }
                selected.push(entry); bytes += entry.size;
            }
            if (selected.length) {
                const buffer = git(['cat-file', '--batch'], range.repoRoot, selected.map(e => e.oid).join('\n') + '\n');
                let offset = 0;
                for (const entry of selected) {
                    const end = buffer.indexOf(10, offset);
                    if (end < 0 || buffer.subarray(offset, end).toString() !== `${entry.oid} blob ${entry.size}`) throw new Error('Invalid Git blob response.');
                    const data = buffer.subarray(end + 1, end + 1 + entry.size);
                    offset = end + entry.size + 2;
                    const value = data.toString('utf8');
                    if (value.includes('\0') || !Buffer.from(value).equals(data)) {
                        diagnostic('encoding-unsupported', 'Only UTF-8 source without NUL is supported.', entry.file); continue;
                    }
                    contents[entry.file] = value; blobs.set(entry.file, entry.oid); result.coverage.readBytes += data.length;
                }
            }
        } catch {
            result.coverage.indexComplete = false;
            diagnostic('snapshot-unavailable', 'Committed tree/blob reading failed or exceeded the time/output budget.');
        }
        const source = (file: string, start: number, end: number): DependencySource => {
            const text = contents[file];
            const before = text.slice(0, start);
            const line = before.split(/\r\n|\r|\n/).length;
            const column = start - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
            const anchor: DependencySource = { file, revision, oid, blobOid: blobs.get(file)!, start, end, line, column,
                digest: createHash('sha256').update(text.slice(start, end)).digest('hex') };
            if (range.mergeBaseOid !== range.headOid) {
                try { anchor.link = serializeDeepLink({ kind: 'compare', repo: pathToFileURL(range.repoRoot).href,
                    revisions: [range.mergeBaseOid, range.headOid], file, revision: oid, line }); } catch { /* Coordinates remain usable. */ }
            }
            return anchor;
        };
        // Unknown adapter records are checked before they become trusted, revision-bound evidence.
        // Nodes are inventoried first; only then are these bounded site buffers drained.
        const sourceFiles = Object.keys(contents).filter(file => dependencyLanguage(file)).sort();
        const prioritySites = createRecordBuffer<PendingAdapterSite>(sourceFiles, limits.maxRecords);
        const referenceSites = createRecordBuffer<PendingAdapterSite>(sourceFiles, limits.maxRecords);
        const declarations = createRecordBuffer<{ file: string; language: DependencyLanguage; node: AdapterNode }>(sourceFiles, limits.maxRecords);
        const validDocuments: { file: string; language: DependencyLanguage; nodeCount: number }[] = [];
        const recordBudgetFiles = new Set<string>();
        const recordBudget = (file: string, language: DependencyLanguage) => {
            const key = `${language}\0${file}`;
            if (recordBudgetFiles.has(key)) return;
            recordBudgetFiles.add(key);
            result.coverage.indexComplete = false;
            diagnostic('record-budget', 'Additional graph records omitted.', file, language);
        };
        for (const language of LANGUAGES) {
            const files = Object.fromEntries(Object.entries(contents)
                .filter(([file]) => dependencyLanguage(file) === language || (language !== 'python' && !dependencyLanguage(file)))
                .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
            if (!Object.keys(files).some(file => dependencyLanguage(file) === language)) continue;
            let output: AdapterOutput;
            try {
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new Error('Time budget exhausted');
                const input = JSON.stringify({ files, pythonRoots });
                const stdout = language === 'python'
                    ? execFileSync('python3', ['-I', join(__dirname, '../cli/dependency-python.py')], { input, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: remaining, stdio: ['pipe', 'pipe', 'pipe'] })
                    : execFileSync(process.execPath, [join(__dirname, 'dependencyEvidenceWorker.js'), language], { input, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: remaining, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
                output = JSON.parse(stdout);
                if (typeof output.producer !== 'string' || !output.documents || typeof output.documents !== 'object') throw new Error('Invalid adapter output');
            } catch {
                result.coverage.indexComplete = false;
                diagnostic('adapter-unavailable', `The ${language} adapter failed, is unavailable, or exceeded its budget. Python requires python3; parser assets must be installed.`, undefined, language);
                continue;
            }
            result.producers.push({ language, name: output.producer });
            for (const [file, text] of Object.entries(files).filter(([file]) => dependencyLanguage(file) === language)) {
                const document = output.documents[file];
                const validRange = (n: unknown) => isRecord(n) && typeof n.start === 'number' && typeof n.end === 'number'
                    && Number.isSafeInteger(n.start) && Number.isSafeInteger(n.end) && n.start >= 0 && n.end >= n.start && n.end <= text.length;
                if (Array.isArray(document?.diagnostics)) for (const d of document.diagnostics.slice(0, 1000)) {
                    if (typeof d?.code === 'string' && typeof d?.message === 'string') {
                        diagnostic(d.code, d.message, file, language);
                        if (/budget|truncat|limit|parse|invalid|fail|unavailable/.test(d.code)) result.coverage.indexComplete = false;
                    }
                }
                const ids = new Set<string>();
                if (!document || document.status !== 'complete' || !Array.isArray(document.nodes) || !Array.isArray(document.sites)
                    || !Array.isArray(document.diagnostics) || !document.nodes.every(n => {
                        if (!validRange(n) || typeof n.id !== 'string' || ids.has(n.id) || typeof n.name !== 'string' || !['module-init', 'function', 'class'].includes(n.kind)) return false;
                        ids.add(n.id); return true;
                    }) || !ids.has('<init>')) {
                    diagnostic('document-invalid', 'Adapter could not produce a valid inventory for this file.', file, language); continue;
                }
                validDocuments.push({ file, language, nodeCount: document.nodes.length });
                for (const node of document.nodes) {
                    if (!declarations.add({ file, language, node })) recordBudget(file, language);
                }
                for (const site of document.sites) {
                    if (!validRange(site) || !ids.has(site.owner) || typeof site.name !== 'string'
                        || !['import', 'reexport', 'call', 'construct', 'reference'].includes(site.relation)
                        || !['module-init', 'invocation', 'type', 'unknown'].includes(site.phase)
                        || !['resolved', 'ambiguous', 'unresolved', 'external', 'unsupported'].includes(site.resolution)) {
                        diagnostic('site-invalid', 'Invalid adapter site omitted.', file, language); result.coverage.indexComplete = false; continue;
                    }
                    const candidate = { file, language, site, producer: output.producer };
                    const buffer = site.relation === 'reference' ? referenceSites : prioritySites;
                    if (!buffer.add(candidate)) recordBudget(file, language);
                }
            }
        }
        // Declaration inventory has priority over every site. Round-robin by
        // file keeps a large early file from consuming the node budget alone.
        const nodeIndexes = new Map<string, number>();
        let records = 0;
        for (const { file, language, node } of declarations.ordered()) {
            if (records >= limits.maxRecords) break;
            nodeIndexes.set(file, (nodeIndexes.get(file) ?? 0) + 1);
            result.nodes.push({ id: nodeKey(file, node.id), name: node.name, kind: node.kind, language,
                source: source(file, node.start, node.end) });
            records++;
        }
        for (const document of validDocuments) {
            if ((nodeIndexes.get(document.file) ?? 0) < document.nodeCount) recordBudget(document.file, document.language);
        }
        const nodes = new Set(result.nodes.map(n => n.id));
        result.coverage.indexedFiles = validDocuments.filter(document => nodeIndexes.get(document.file) === document.nodeCount).length;
        const pending = [...prioritySites.ordered(), ...referenceSites.ordered()];
        for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex++) {
            const { file, language, site, producer } = pending[pendingIndex];
            if (result.nodes.length + result.sites.length >= limits.maxRecords) {
                for (let index = pendingIndex; index < pending.length; index++) recordBudget(pending[index].file, pending[index].language);
                break;
            }
            if (!nodes.has(nodeKey(file, site.owner))) {
                recordBudget(file, language); continue;
            }
            const targetKey = (target: unknown): string | undefined => {
                if (!isRecord(target) || typeof target.file !== 'string' || (target.node !== undefined && typeof target.node !== 'string')) return undefined;
                if (target.node === undefined && !['import', 'reexport'].includes(site.relation)) return undefined;
                const key = nodeKey(target.file, target.node ?? '<init>');
                return nodes.has(key) ? key : undefined;
            };
            const target = targetKey(site.target);
            const resolution = site.resolution === 'resolved' && !target ? 'unresolved' : site.resolution;
            const candidates = Array.isArray(site.candidates) ? site.candidates.map(targetKey).filter((c: unknown): c is string => typeof c === 'string') : [];
            result.sites.push({ id: JSON.stringify([file, site.start, site.end, site.relation, result.sites.length]),
                owner: nodeKey(file, site.owner), relation: site.relation, name: site.name, phase: site.phase, resolution,
                ...(resolution === 'resolved' && target ? { target } : {}), ...(candidates.length ? { candidates } : {}),
                ...(typeof site.specifier === 'string' ? { specifier: site.specifier } : {}),
                ...(site.loading === 'eager' || site.loading === 'deferred' ? { loading: site.loading } : {}),
                ...(site.resolution === 'resolved' && !target ? { reason: 'Target is outside the validated snapshot inventory.' } : typeof site.reason === 'string' ? { reason: site.reason } : {}),
                evidence: 'static', producer, source: source(file, site.start, site.end) });
        }
        result.coverage.omittedFiles = result.coverage.candidateFiles - result.coverage.indexedFiles;
        result.coverage.indexComplete &&= result.coverage.omittedFiles === 0;
        result.coverage.unresolvedSites = result.sites.filter(site => site.resolution !== 'resolved').length;
        return result;
    };
    return { version: 2, kind: 'dependency-evidence', range: { baseOid: range.mergeBaseOid, headOid: range.headOid, dirtyWorkingTreeExcluded: range.dirty }, configuration: { pythonRoots: [...pythonRoots], scopes }, limits,
        assumptions: [
            'Static evidence from committed UTF-8 blobs only. Target code is never imported, built, or executed. Dirty files are excluded.',
            'Coverage counts apply only to configured repository-relative scopes (empty means the whole repository). Out-of-scope targets are not indexed.',
            'Resolved means a source binding was identified within adapter scope, not that a call executes or dispatches to that target at runtime.',
            'module-init is an evaluation phase, not a transitive startup graph. Invocation sites do not imply caller reachability.',
            'Python uses the installed isolated Python 3 AST parser and explicit source roots. External packages and dynamic attributes may remain unresolved.',
            'JS/TS uses the bundled TypeScript checker over snapshot files; installed libraries and bundler execution are excluded.',
            'Go/Rust use pinned syntax parsers with conservative lexical resolution. Build tags, cfg, macros, trait/interface dispatch and generated code are not evaluated.',
            'Mojo support is experimental and grammar-version-specific; uncertain evaluation phases are unknown.',
            'No runtime observations are collected. Missing edges are not proof of independence; inspect coverage and diagnostics.'
        ], base: snapshot('base'), head: snapshot('head') };
}
