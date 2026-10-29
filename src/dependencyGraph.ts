import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { posix as path } from 'path';
import { pathToFileURL } from 'url';
import * as ts from 'dependency-typescript';
import { resolveBranchReviewRange, type BranchReviewRange } from './gitComparison';
import { serializeDeepLink } from './deepLink';
import { extractModuleDependencies, type ModuleDependencySite, type ModuleInitializationSite } from './moduleDependencies';

// Reuse the isolated parser bundle for focused extractor tests.
export { extractModuleDependencies } from './moduleDependencies';

export const DEPENDENCY_GRAPH_VERSION = 1 as const;
export const DEFAULT_DEPENDENCY_LIMITS = Object.freeze({
    maxFiles: 2000, maxFileBytes: 1024 * 1024, maxBytes: 16 * 1024 * 1024,
    maxRecords: 20000, timeoutMs: 30000
});
type Limits = typeof DEFAULT_DEPENDENCY_LIMITS;
export interface DependencySource {
    file: string; revision: 'base' | 'head'; oid: string; blobOid: string;
    start: number; end: number; line: number; column: number;
    digest: string; link?: string;
}
export interface DependencyEdge extends Omit<ModuleDependencySite, 'start' | 'end' | 'line' | 'column'> {
    source: DependencySource;
    evidence: 'syntactic';
    resolution: 'resolved' | 'unresolved' | 'computed' | 'invalid-config';
    target?: string;
}
export interface DependencyEffect extends Omit<ModuleInitializationSite, 'start' | 'end' | 'line' | 'column'> {
    source: DependencySource; evidence: 'syntactic';
}
export interface DependencyDiagnostic { code: string; message: string; file?: string; }
export interface DependencySnapshot {
    oid: string;
    coverage: {
        candidateFiles: number; indexedFiles: number; omittedFiles: number; readBytes: number;
        indexComplete: boolean; unresolvedEdges: number; omittedDiagnostics: number;
    };
    edges: DependencyEdge[];
    initialization: DependencyEffect[];
    diagnostics: DependencyDiagnostic[];
}
export interface DependencyGraphReport {
    version: typeof DEPENDENCY_GRAPH_VERSION;
    producer: { name: 'bygone'; typescript: string };
    range: { baseOid: string; headOid: string; dirtyWorkingTreeExcluded: boolean };
    limits: Limits;
    assumptions: string[];
    base: DependencySnapshot;
    head: DependencySnapshot;
    changes: { added: DependencyEdge[]; removed: DependencyEdge[] };
    unchangedConsumers: { base: DependencyEdge[]; head: DependencyEdge[] };
}
export interface DependencyGraphOptions {
    headRef?: string; baseRef?: string; limits?: Partial<Limits>;
    /** Reuse an already pinned range, e.g. from a tour context. */
    range?: BranchReviewRange;
}
const VIRTUAL_ROOT = '/__bygone_snapshot__/';
const SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?)$/i;
const MAX_TREE_BYTES = 16 * 1024 * 1024;
const MAX_DIAGNOSTICS = 1000;
interface Entry { file: string; oid: string; size: number; mode: string; }

export function buildDependencyGraph(startPath: string, options: DependencyGraphOptions = {}): DependencyGraphReport {
    const limits = { ...DEFAULT_DEPENDENCY_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) {
        if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_DEPENDENCY_LIMITS[key as keyof Limits]) {
            throw new Error(`${key} must be an integer from 1 to ${DEFAULT_DEPENDENCY_LIMITS[key as keyof Limits]}.`);
        }
    }
    const deadline = Date.now() + limits.timeoutMs;
    const range = options.range ?? resolveBranchReviewRange(startPath, options.headRef, options.baseRef, (args, cwd) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Dependency analysis time budget exhausted during Git range discovery.');
        try {
            return execFileSync('git', ['--no-replace-objects', ...args], {
                cwd, encoding: 'utf8', maxBuffer: MAX_TREE_BYTES, timeout: remaining, stdio: ['ignore', 'pipe', 'pipe']
            }).trimEnd();
        } catch (error) {
            if (Date.now() >= deadline) throw new Error('Dependency analysis time budget exhausted during Git range discovery.');
            throw error;
        }
    });
    const base = indexSnapshot(range, 'base', limits, deadline);
    const head = indexSnapshot(range, 'head', limits, deadline);
    const renames = new Map(range.changedPaths.filter(p => p.kind === 'renamed' && p.previousPath).map(p => [p.previousPath!, p.path]));
    const key = (edge: DependencyEdge, rename: boolean): string => {
        const normalize = (file: string) => rename ? renames.get(file) ?? file : file;
        return JSON.stringify([normalize(edge.source.file), edge.relationship, edge.phase, edge.loading,
            edge.target ? ['target', normalize(edge.target)] : [edge.resolution, edge.specifier ?? null]]);
    };
    const before = new Set(base.edges.map(edge => key(edge, true)));
    const after = new Set(head.edges.map(edge => key(edge, false)));
    const changedBase = new Set(range.changedPaths.map(p => p.previousPath ?? p.path));
    const changedHead = new Set(range.changedPaths.map(p => p.path));
    const consumers = (snapshot: DependencySnapshot, changed: Set<string>) => snapshot.edges.filter(edge =>
        !changed.has(edge.source.file) && edge.target !== undefined && changed.has(edge.target));
    return {
        version: DEPENDENCY_GRAPH_VERSION, producer: { name: 'bygone', typescript: ts.version },
        range: { baseOid: range.mergeBaseOid, headOid: range.headOid, dirtyWorkingTreeExcluded: range.dirty }, limits,
        assumptions: [
            'Static JS/TS syntax and TypeScript resolution against committed blobs only; no target code is executed.',
            'module-init describes a syntactic evaluation phase, not proof of execution or process startup. Conditions and dispatch are not evaluated.',
            'Runtime observations, symbol/call target resolution, non-JS/TS languages, bundler plugins and installed node_modules are outside scope.',
            'Nearest committed tsconfig.json/jsconfig.json supplies compiler options; without one, Node-style TypeScript resolution is used.',
            'Delta identity is module endpoint, relationship, phase and loading; occurrence counts and source spelling changes alone are not edge changes.',
            'Unchanged consumers are direct resolved imports only. Missing edges are not proof of independence; inspect coverage and diagnostics.'
        ],
        base, head,
        changes: { added: head.edges.filter(edge => !before.has(key(edge, false))), removed: base.edges.filter(edge => !after.has(key(edge, true))) },
        unchangedConsumers: { base: consumers(base, changedBase), head: consumers(head, changedHead) }
    };
}

function indexSnapshot(range: BranchReviewRange, revision: 'base' | 'head', limits: Limits, deadline: number): DependencySnapshot {
    const oid = revision === 'base' ? range.mergeBaseOid : range.headOid;
    const result: DependencySnapshot = {
        oid, coverage: { candidateFiles: 0, indexedFiles: 0, omittedFiles: 0, readBytes: 0,
            indexComplete: true, unresolvedEdges: 0, omittedDiagnostics: 0 },
        edges: [], initialization: [], diagnostics: []
    };
    const diagnostic = (code: string, message: string, file?: string) => {
        if (result.diagnostics.length < MAX_DIAGNOSTICS) result.diagnostics.push({ code, message, ...(file ? { file } : {}) });
        else result.coverage.omittedDiagnostics++;
    };
    const remaining = () => Math.max(1, deadline - Date.now());
    if (Date.now() >= deadline) {
        result.coverage.indexComplete = false;
        diagnostic('timeout', 'Snapshot was not enumerated because the analysis time budget was exhausted.');
        return result;
    }
    let entries: Entry[];
    try {
        const tree = execFileSync('git', ['--no-replace-objects', 'ls-tree', '-r', '-l', '-z', oid], {
            cwd: range.repoRoot, maxBuffer: MAX_TREE_BYTES, timeout: remaining(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
        });
        entries = tree.split('\0').filter(Boolean).flatMap(row => {
            const match = /^(\d+) blob ([a-f\d]+)\s+(\d+)\t([\s\S]+)$/.exec(row);
            return match ? [{ mode: match[1], oid: match[2], size: Number(match[3]), file: match[4] }] : [];
        });
    } catch {
        result.coverage.indexComplete = false;
        diagnostic('tree-unavailable', 'Could not enumerate the committed tree within the time/output budget.');
        return result;
    }
    const supported = (e: Entry) => SOURCE_PATTERN.test(e.file);
    const excluded = (e: Entry) => e.file.split('/').includes('node_modules');
    const regular = (e: Entry) => e.mode === '100644' || e.mode === '100755';
    result.coverage.candidateFiles = entries.filter(supported).length;
    const manifest = new Map(entries.filter(e => regular(e) && !excluded(e)).map(e => [VIRTUAL_ROOT + e.file, e]));
    // Only compiler/package metadata belongs in the resolver input budget. Config
    // inheritance can name arbitrary JSON files, so discover that bounded closure.
    const sourceDirectories = new Set<string>();
    for (const entry of entries.filter(e => supported(e) && regular(e) && !excluded(e))) {
        for (let dir = path.dirname(entry.file);; dir = path.dirname(dir)) {
            sourceDirectories.add(dir);
            if (dir === '.') break;
        }
    }
    const metadata = (e: Entry) => sourceDirectories.has(path.dirname(e.file))
        && /^(?:tsconfig|jsconfig|package)\.json$/i.test(path.basename(e.file));
    const sorted = [...entries].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
    const byFile = new Map(entries.map(e => [e.file, e]));
    const selected: Entry[] = [];
    const attempted = new Set<string>();
    const contents = new Map<string, string>();
    let bytes = 0;
    const readBatch = (candidates: Entry[]) => {
        const batch: Entry[] = [];
        for (const entry of candidates) {
            if (attempted.has(entry.file)) continue;
            attempted.add(entry.file);
            let reason: string | undefined;
            if (!regular(entry)) reason = 'Non-regular file (for example, a symlink) is not followed.';
            else if (excluded(entry)) reason = 'Tracked node_modules are outside the resolution/index scope.';
            else if (entry.size > limits.maxFileBytes) reason = 'File exceeds maxFileBytes.';
            else if (selected.length >= limits.maxFiles || bytes + entry.size > limits.maxBytes) reason = 'Snapshot file/byte budget exhausted.';
            else if (Date.now() >= deadline) reason = 'Snapshot time budget exhausted.';
            if (reason) {
                result.coverage.indexComplete = false;
                diagnostic('file-omitted', reason, entry.file); continue;
            }
            selected.push(entry); batch.push(entry); bytes += entry.size;
        }
        if (!batch.length) return;
        try {
            const buffer = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch'], {
                cwd: range.repoRoot, input: batch.map(e => e.oid).join('\n') + '\n',
                maxBuffer: batch.reduce((sum, e) => sum + e.size + 128, 0), timeout: remaining(), stdio: ['pipe', 'pipe', 'pipe']
            });
            let offset = 0;
            const loaded = new Map<string, string>();
            for (const entry of batch) {
                const end = buffer.indexOf(10, offset);
                const header = buffer.subarray(offset, end).toString('utf8');
                if (header !== `${entry.oid} blob ${entry.size}`) throw new Error('Unexpected Git batch response.');
                const data = buffer.subarray(end + 1, end + 1 + entry.size);
                offset = end + entry.size + 2;
                const content = data.toString('utf8');
                if (content.includes('\0') || !Buffer.from(content).equals(data)) {
                    result.coverage.indexComplete = false;
                    diagnostic('encoding-unsupported', 'Only UTF-8 text without NUL bytes is indexed.', entry.file); continue;
                }
                loaded.set(VIRTUAL_ROOT + entry.file, content);
            }
            for (const [file, content] of loaded) {
                contents.set(file, content); result.coverage.readBytes += Buffer.byteLength(content);
            }
        } catch {
            result.coverage.indexComplete = false;
            diagnostic('blobs-unavailable', 'Could not read snapshot blobs within the time/output budget.');
        }
    };
    let configBatch = sorted.filter(metadata);
    while (configBatch.length) {
        readBatch(configBatch);
        const parents: Entry[] = [];
        for (const entry of configBatch) {
            if (path.basename(entry.file) === 'package.json') continue;
            const content = contents.get(VIRTUAL_ROOT + entry.file);
            if (content === undefined) continue;
            const config = ts.parseConfigFileTextToJson(entry.file, content).config;
            const extensions: unknown[] = Array.isArray(config?.extends) ? config.extends : [config?.extends];
            for (const extension of extensions) {
                if (typeof extension !== 'string' || !extension.startsWith('.')) continue;
                const name = path.normalize(path.join(path.dirname(entry.file), extension));
                const parent = byFile.get(name) ?? byFile.get(name + '.json');
                if (parent && !attempted.has(parent.file)) parents.push(parent);
            }
        }
        configBatch = [...new Set(parents)];
    }
    readBatch(sorted.filter(supported));
    const invalidPackages = new Set<string>();
    const checkedPackages = new Set<string>();
    const validatePackage = (file: string) => {
        const content = contents.get(file);
        if (content === undefined || checkedPackages.has(file)) return;
        checkedPackages.add(file);
        try {
            const value: unknown = JSON.parse(content);
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a package object');
        } catch {
            invalidPackages.add(file); result.coverage.indexComplete = false;
            diagnostic('package-invalid', 'Committed package.json must contain a valid JSON object; resolver fallback is not reliable.', file.slice(VIRTUAL_ROOT.length));
        }
    };
    for (const file of contents.keys()) if (path.basename(file) === 'package.json') validatePackage(file);
    let metadataFailure = false;
    const directories = new Set<string>([VIRTUAL_ROOT.slice(0, -1)]);
    for (const file of manifest.keys()) {
        for (let dir = path.dirname(file); dir.startsWith(VIRTUAL_ROOT.slice(0, -1)); dir = path.dirname(dir)) directories.add(dir);
    }
    const host: ts.ModuleResolutionHost = {
        fileExists: name => manifest.has(path.normalize(name)),
        readFile: name => {
            const file = path.normalize(name);
            if (path.basename(file) === 'package.json') {
                // A relative directory import can need a package outside every
                // source ancestor. Load it on demand through the same budgets.
                const entry = manifest.get(file);
                if (entry && !attempted.has(entry.file)) readBatch([entry]);
                validatePackage(file);
                if (invalidPackages.has(file) || (entry && !contents.has(file))) {
                    metadataFailure = true;
                    throw new Error('Unavailable or invalid committed package metadata');
                }
            }
            return contents.get(file);
        },
        directoryExists: name => directories.has(path.normalize(name)),
        getCurrentDirectory: () => VIRTUAL_ROOT, realpath: name => name
    };
    const configs = new Map<string, ts.CompilerOptions | null>();
    const compilerOptions = (file: string): ts.CompilerOptions | null => {
        let config: string | undefined;
        for (let dir = path.dirname(file); dir.startsWith(VIRTUAL_ROOT.slice(0, -1)); dir = path.dirname(dir)) {
            config = ['tsconfig.json', 'jsconfig.json'].map(name => path.join(dir, name)).find(name => manifest.has(name));
            if (config) break;
        }
        if (!config) return { allowJs: true, moduleResolution: ts.ModuleResolutionKind.NodeJs, module: ts.ModuleKind.CommonJS };
        if (configs.has(config)) return configs.get(config)!;
        let options: ts.CompilerOptions | null;
        try {
            const read = ts.readConfigFile(config, host.readFile!);
            const parsed = read.error ? undefined : ts.parseJsonConfigFileContent(read.config, {
                useCaseSensitiveFileNames: true, fileExists: host.fileExists, readFile: host.readFile!, readDirectory: () => []
            }, path.dirname(config), undefined, config);
            // File selection is ours: a config with no include matches still supplies resolution options.
            const errors = [read.error, ...(parsed?.errors ?? []).filter(error => error.code !== 18003)].filter((e): e is ts.Diagnostic => !!e);
            if (errors.length) result.coverage.indexComplete = false;
            for (const error of errors) diagnostic('config-invalid', ts.flattenDiagnosticMessageText(error.messageText, '\n'), config.slice(VIRTUAL_ROOT.length));
            options = errors.length ? null : parsed!.options;
        } catch {
            result.coverage.indexComplete = false;
            diagnostic('config-invalid', 'The compiler could not parse the committed configuration.', config.slice(VIRTUAL_ROOT.length));
            options = null;
        }
        configs.set(config, options);
        return options;
    };
    const makeSource = (entry: Entry, content: string, site: { start: number; end: number; line: number; column: number }): DependencySource => {
        const source: DependencySource = { file: entry.file, revision, oid, blobOid: entry.oid,
            start: site.start, end: site.end, line: site.line, column: site.column,
            digest: createHash('sha256').update(content.slice(site.start, site.end)).digest('hex') };
        if (range.mergeBaseOid !== range.headOid) {
            try {
                source.link = serializeDeepLink({ kind: 'compare', repo: pathToFileURL(range.repoRoot).href,
                    revisions: [range.mergeBaseOid, range.headOid], file: entry.file, revision: oid, line: site.line });
            } catch { /* Unusual Git paths may be outside the deep-link path grammar. Exact coordinates remain available. */ }
        }
        return source;
    };
    for (const entry of selected.filter(supported)) {
        const filename = VIRTUAL_ROOT + entry.file;
        const content = contents.get(filename);
        if (content === undefined) continue;
        if (Date.now() >= deadline || result.edges.length + result.initialization.length >= limits.maxRecords) {
            diagnostic('index-budget', 'Indexing stopped at the time/record budget.', entry.file); break;
        }
        let extracted: ReturnType<typeof extractModuleDependencies>;
        try { extracted = extractModuleDependencies(entry.file, content); }
        catch { diagnostic('parse-failed', 'Could not parse this file.', entry.file); continue; }
        const options = compilerOptions(filename);
        for (const item of extracted.diagnostics) diagnostic(item.code, item.message, entry.file);
        if (extracted.diagnostics.some(item => /^(?:ts-|parser-|traversal-)/.test(item.code))) result.coverage.indexComplete = false;
        result.coverage.indexedFiles++;
        for (const site of extracted.edges) {
            if (Date.now() >= deadline || result.edges.length + result.initialization.length >= limits.maxRecords) {
                result.coverage.indexComplete = false; diagnostic('record-or-time-budget', 'Additional dependency sites were omitted.', entry.file); break;
            }
            const { specifier, relationship, phase, loading } = site;
            const fields = { ...(specifier !== undefined ? { specifier } : {}), relationship, phase, loading };
            let resolution: DependencyEdge['resolution'] = site.specifier === undefined ? 'computed' : options === null ? 'invalid-config' : 'unresolved';
            let target: string | undefined;
            if (site.specifier !== undefined && options) {
                metadataFailure = false;
                try {
                    const mode = site.relationship === 'require' ? ts.ModuleKind.CommonJS : site.relationship === 'dynamic-import' ? ts.ModuleKind.ESNext
                        : ts.getImpliedNodeFormatForFile(filename as ts.Path, undefined, host, options);
                    const resolved = ts.resolveModuleName(site.specifier, filename, options, host, undefined, undefined, mode).resolvedModule;
                    if (resolved && manifest.has(resolved.resolvedFileName)) {
                        target = resolved.resolvedFileName.slice(VIRTUAL_ROOT.length); resolution = 'resolved';
                    }
                } catch {
                    result.coverage.indexComplete = false;
                    if (metadataFailure) resolution = 'invalid-config';
                    diagnostic(metadataFailure ? 'package-unavailable' : 'resolution-failed',
                        metadataFailure ? 'Resolution requires unavailable or invalid committed package metadata.' : 'Compiler resolution failed for an import site.', entry.file);
                }
            }
            if (resolution !== 'resolved') result.coverage.unresolvedEdges++;
            result.edges.push({ ...fields, evidence: 'syntactic', resolution, ...(target ? { target } : {}), source: makeSource(entry, content, site) });
        }
        for (const site of extracted.effects) {
            if (Date.now() >= deadline || result.edges.length + result.initialization.length >= limits.maxRecords) {
                result.coverage.indexComplete = false; diagnostic('record-or-time-budget', 'Additional initialization sites were omitted.', entry.file); break;
            }
            result.initialization.push({ kind: site.kind, phase: site.phase, evidence: 'syntactic', source: makeSource(entry, content, site) });
        }
    }
    result.coverage.omittedFiles = result.coverage.candidateFiles - result.coverage.indexedFiles;
    result.coverage.indexComplete &&= result.coverage.omittedFiles === 0;
    return result;
}
