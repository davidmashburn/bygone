import { createHash } from 'crypto';
import { parseSourceRef, resolveSourceRef, type SourceRef } from 'bygone-strand/source-references';
import { readPinnedFile } from './reviewWorkspace';
import type { DependencyLanguage } from './dependencyEvidence';
import type { Review } from './requirements';
import type { DependencyEvidence, DependencyInspection } from './reviewDependencies';

type ObjectValue = Record<string, unknown>;
type DependencySide = 'base' | 'head';
const DEFAULT_DEPENDENCY_LIMITS = Object.freeze({
    maxFiles: 2_000,
    maxFileBytes: 1024 * 1024,
    maxBytes: 16 * 1024 * 1024,
    maxRecords: 20_000,
    timeoutMs: 30_000
});
type LimitKey = keyof typeof DEFAULT_DEPENDENCY_LIMITS;
type DependencyLimits = { [K in LimitKey]: number };

const DEPENDENCY_LANGUAGES: readonly DependencyLanguage[] = ['python', 'typescript', 'go', 'rust', 'mojo'];
const NODE_KINDS = ['function', 'class', 'module-init'] as const;
const RELATIONS = ['import', 'reexport', 'call', 'construct', 'reference'] as const;
const PHASES = ['module-init', 'invocation', 'type', 'unknown'] as const;
const RESOLUTIONS = ['resolved', 'ambiguous', 'unresolved', 'external', 'unsupported'] as const;
const OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_STRING_LENGTH = 100_000;
const MAX_LIST_LENGTH = 20_000;
const MAX_ASSUMPTIONS = 1_000;
const MAX_DIAGNOSTICS = 1_000;

function dependencyLanguage(file: string): DependencyLanguage | undefined {
    if (/\.pyi?$/.test(file)) return 'python';
    if (/\.[cm]?[jt]sx?$/.test(file)) return 'typescript';
    if (/\.go$/.test(file)) return 'go';
    if (/\.rs$/.test(file)) return 'rust';
    if (/\.(mojo|🔥)$/.test(file)) return 'mojo';
    return undefined;
}

interface PinnedFile {
    text: string;
    blob: string;
}

interface SourceValidationState {
    readonly files: Set<string>;
    sourceBytes: number;
}

interface SourceValidationBudget {
    readonly cache: Map<string, PinnedFile | undefined>;
    totalBytes: number;
}

interface ValidatedSource {
    file: string;
    ref: SourceRef;
}

interface ValidatedNode {
    id: string;
    file: string;
    language: DependencyLanguage;
}

interface ValidatedSite {
    id: string;
    owner: string;
    relation: typeof RELATIONS[number];
    name: string;
    phase: typeof PHASES[number];
    resolution: typeof RESOLUTIONS[number];
    target?: string;
    candidates: string[];
    specifier?: string;
    loading?: 'eager' | 'deferred';
    producer: string;
    file: string;
    language: DependencyLanguage;
    source: SourceRef;
}

interface ValidatedDiagnostic {
    code: string;
    message: string;
    file?: string;
    language?: DependencyLanguage;
}

interface ValidatedSnapshot {
    side: DependencySide;
    oid: string;
    coverage: {
        candidateFiles: number;
        indexedFiles: number;
        omittedFiles: number;
        readBytes: number;
        indexComplete: boolean;
        unresolvedSites: number;
        omittedDiagnostics: number;
    };
    nodes: ValidatedNode[];
    sites: ValidatedSite[];
    diagnostics: ValidatedDiagnostic[];
}

/**
 * Validate and reduce the multilingual v2 report to navigation evidence.
 * Every source slice is rebuilt from the immutable Git snapshot before it is
 * exposed to the review UI; producer-owned targets remain labels, not claims
 * about runtime behavior.
 */
export function inspectDependencyEvidenceV2(
    root: string,
    review: Review,
    input: unknown
): DependencyInspection {
    const data = object(input, 'report');
    requireOnlyKeys(data, ['version', 'kind', 'range', 'configuration', 'limits', 'assumptions', 'base', 'head'], 'report');
    if (data.version !== 2 || data.kind !== 'dependency-evidence') {
        throw new Error('Unsupported dependency evidence report version or kind');
    }

    validateRange(data.range, review);
    const configuration = validateConfiguration(data.configuration);
    const limits = validateLimits(data.limits);
    const assumptions = list(data.assumptions, 'report.assumptions', MAX_ASSUMPTIONS).map((value, index) =>
        stringValue(value, `report.assumptions[${index}]`)
    );
    const deadline = Date.now() + limits.timeoutMs;
    const checkTime = () => {
        if (Date.now() >= deadline) throw new Error('Dependency source validation time budget exhausted');
    };
    const budget: SourceValidationBudget = { cache: new Map(), totalBytes: 0 };
    const base = validateSnapshot(root, data.base, 'base', review.base, configuration.scopes, limits, budget, deadline, checkTime);
    const head = validateSnapshot(root, data.head, 'head', review.head, configuration.scopes, limits, budget, deadline, checkTime);
    checkTime();

    const limitations = [...assumptions];
    limitations.push(
        'Static phase labels describe syntax, not observed execution, reachability, startup order, or runtime loading.',
        'Resolution labels identify only source targets within the indexed snapshot; unresolved, ambiguous, external, and unsupported sites remain unproven.',
        'Partial coverage or omitted diagnostics means missing sites cannot establish independence; this evidence is navigation context, not an impact or safety judgment.'
    );
    for (const snapshot of [base, head]) {
        const coverage = snapshot.coverage;
        limitations.push(`${snapshot.side}: ${coverage.indexedFiles}/${coverage.candidateFiles} files indexed; ${coverage.omittedFiles} omitted; ${snapshot.nodes.length} nodes; ${snapshot.sites.length} sites; ${coverage.unresolvedSites} unresolved sites; ${coverage.omittedDiagnostics} omitted diagnostics; index ${coverage.indexComplete ? 'complete within limits' : 'partial'}.`);
        for (const diagnostic of snapshot.diagnostics) {
            limitations.push(`${snapshot.side}: ${diagnostic.code}: ${diagnostic.message}${diagnostic.file ? ` (${diagnostic.file})` : ''}`);
        }
    }

    const links: DependencyEvidence[] = [];
    for (const snapshot of [base, head]) {
        for (const site of snapshot.sites) {
            const target = site.target ? ` → ${formatNodeId(site.target)}`
                : site.specifier !== undefined ? ` (${JSON.stringify(site.specifier)})`
                    : ' (no indexed target)';
            links.push({
                title: `${snapshot.side}: ${site.relation} ${site.name} at ${site.file}${target}`,
                ref: site.source,
                phase: site.phase,
                loading: site.loading ?? 'unspecified',
                resolution: site.resolution
            });
        }
    }
    return { links, limitations };
}

function validateRange(value: unknown, review: Review): void {
    const range = object(value, 'report.range');
    requireOnlyKeys(range, ['baseOid', 'headOid', 'dirtyWorkingTreeExcluded'], 'report.range');
    oidValue(range.baseOid, 'report.range.baseOid', review.base);
    oidValue(range.headOid, 'report.range.headOid', review.head);
    if (typeof range.dirtyWorkingTreeExcluded !== 'boolean') {
        throw new Error('Invalid dependency evidence schema at report.range.dirtyWorkingTreeExcluded');
    }
}

function validateConfiguration(value: unknown): { pythonRoots: string[]; scopes: string[] } {
    const configuration = object(value, 'report.configuration');
    requireOnlyKeys(configuration, ['pythonRoots', 'scopes'], 'report.configuration');
    const pythonRoots = list(configuration.pythonRoots, 'report.configuration.pythonRoots', 1_000)
        .map((root, index) => repositoryRelativePrefix(root, `report.configuration.pythonRoots[${index}]`));
    const scopes = list(configuration.scopes, 'report.configuration.scopes', 1_000)
        .map((scope, index) => repositoryScope(scope, `report.configuration.scopes[${index}]`));
    if (new Set(scopes).size !== scopes.length) {
        throw new Error('Invalid dependency evidence schema: report.configuration.scopes contains duplicates');
    }
    return { pythonRoots, scopes };
}

function validateLimits(value: unknown): DependencyLimits {
    const limits = object(value, 'report.limits');
    requireOnlyKeys(limits, Object.keys(DEFAULT_DEPENDENCY_LIMITS), 'report.limits');
    return {
        maxFiles: boundedLimit(limits.maxFiles, 'report.limits.maxFiles', 'maxFiles'),
        maxFileBytes: boundedLimit(limits.maxFileBytes, 'report.limits.maxFileBytes', 'maxFileBytes'),
        maxBytes: boundedLimit(limits.maxBytes, 'report.limits.maxBytes', 'maxBytes'),
        maxRecords: boundedLimit(limits.maxRecords, 'report.limits.maxRecords', 'maxRecords'),
        timeoutMs: boundedLimit(limits.timeoutMs, 'report.limits.timeoutMs', 'timeoutMs')
    };
}

function validateSnapshot(
    root: string,
    value: unknown,
    side: DependencySide,
    expectedOid: string,
    scopes: readonly string[],
    limits: DependencyLimits,
    budget: SourceValidationBudget,
    deadline: number,
    checkTime: () => void
): ValidatedSnapshot {
    const snapshot = object(value, `report.${side}`);
    requireOnlyKeys(snapshot, ['oid', 'nodes', 'sites', 'producers', 'diagnostics', 'coverage'], `report.${side}`);
    oidValue(snapshot.oid, `report.${side}.oid`, expectedOid);
    const coverage = validateCoverage(snapshot.coverage, side, limits);
    const producers = validateProducers(snapshot.producers, side);
    const diagnostics = validateDiagnostics(snapshot.diagnostics, side);
    const sourceState: SourceValidationState = { files: new Set(), sourceBytes: 0 };
    const nodeValues = list(snapshot.nodes, `report.${side}.nodes`, limits.maxRecords);
    const siteValues = list(snapshot.sites, `report.${side}.sites`, limits.maxRecords);
    const nodes: ValidatedNode[] = [];
    const nodeIds = new Map<string, ValidatedNode>();
    for (let index = 0; index < nodeValues.length; index++) {
        checkTime();
        const node = object(nodeValues[index], `report.${side}.nodes[${index}]`);
        requireOnlyKeys(node, ['id', 'name', 'kind', 'language', 'source'], `report.${side}.nodes[${index}]`);
        const id = stringValue(node.id, `report.${side}.nodes[${index}].id`);
        const name = stringValue(node.name, `report.${side}.nodes[${index}].name`);
        const kind = choice(node.kind, NODE_KINDS, `report.${side}.nodes[${index}].kind`);
        const language = choice(node.language, DEPENDENCY_LANGUAGES, `report.${side}.nodes[${index}].language`);
        const source = validateSource(root, node.source, `${side}.nodes[${index}].source`, side, expectedOid, scopes, limits,
            coverage.candidateFiles, coverage.readBytes, sourceState, budget, deadline, checkTime, kind === 'module-init');
        if (dependencyLanguage(source.file) !== language) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.nodes[${index}].language`);
        }
        if (nodeIdFile(id) !== source.file) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.nodes[${index}].id`);
        }
        if (nodeIds.has(id)) throw new Error(`Dependency evidence membership mismatch: duplicate node ID ${id}`);
        const validated = { id, file: source.file, language };
        nodes.push(validated);
        nodeIds.set(id, validated);
        // Keep the value live so a producer cannot smuggle an unvalidated name
        // through a structurally similar object without changing the schema.
        void name;
        void kind;
    }
    for (const language of new Set(nodes.map(node => node.language))) {
        if (!producers.has(language)) {
            throw new Error(`Dependency evidence membership mismatch: missing ${language} producer`);
        }
    }

    const sites: ValidatedSite[] = [];
    const siteIds = new Set<string>();
    for (let index = 0; index < siteValues.length; index++) {
        checkTime();
        const site = object(siteValues[index], `report.${side}.sites[${index}]`);
        requireOnlyKeys(site, [
            'id', 'owner', 'relation', 'name', 'phase', 'resolution', 'target', 'candidates', 'specifier',
            'loading', 'reason', 'evidence', 'producer', 'source'
        ], `report.${side}.sites[${index}]`);
        const id = stringValue(site.id, `report.${side}.sites[${index}].id`);
        if (siteIds.has(id)) throw new Error(`Dependency evidence membership mismatch: duplicate site ID ${id}`);
        siteIds.add(id);
        const owner = stringValue(site.owner, `report.${side}.sites[${index}].owner`);
        const relation = choice(site.relation, RELATIONS, `report.${side}.sites[${index}].relation`);
        const name = stringValue(site.name, `report.${side}.sites[${index}].name`);
        const phase = choice(site.phase, PHASES, `report.${side}.sites[${index}].phase`);
        const resolution = choice(site.resolution, RESOLUTIONS, `report.${side}.sites[${index}].resolution`);
        const target = optionalString(site.target, `report.${side}.sites[${index}].target`);
        const candidates = optionalStringArray(site.candidates, `report.${side}.sites[${index}].candidates`);
        const specifier = optionalString(site.specifier, `report.${side}.sites[${index}].specifier`, true);
        const loading = site.loading === undefined
            ? undefined
            : choice(site.loading, ['eager', 'deferred'] as const, `report.${side}.sites[${index}].loading`);
        optionalString(site.reason, `report.${side}.sites[${index}].reason`);
        if (site.evidence !== 'static') throw new Error(`Invalid dependency evidence schema at report.${side}.sites[${index}].evidence`);
        const producer = stringValue(site.producer, `report.${side}.sites[${index}].producer`);
        const source = validateSource(root, site.source, `${side}.sites[${index}].source`, side, expectedOid, scopes, limits,
            coverage.candidateFiles, coverage.readBytes, sourceState, budget, deadline, checkTime);
        const language = dependencyLanguage(source.file);
        if (!language) throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].source.file`);
        if (producer !== producers.get(language)) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].producer`);
        }
        if (!nodeIds.has(owner) || nodeIds.get(owner)!.file !== source.file) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].owner`);
        }
        if (resolution === 'resolved' && target === undefined) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].target`);
        }
        if (target !== undefined && (!nodeIds.has(target) || resolution !== 'resolved')) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].target`);
        }
        for (const candidate of candidates) {
            if (!nodeIds.has(candidate)) {
                throw new Error(`Dependency evidence membership mismatch at report.${side}.sites[${index}].candidates`);
            }
        }
        sites.push({ id, owner, relation, name, phase, resolution, ...(target !== undefined ? { target } : {}), candidates,
            ...(specifier !== undefined ? { specifier } : {}), ...(loading !== undefined ? { loading } : {}), producer,
            file: source.file, language, source: source.ref });
    }

    if (nodes.length + sites.length > limits.maxRecords) {
        throw new Error('Dependency evidence records exceed declared limits');
    }
    if (sourceState.files.size < coverage.indexedFiles || sourceState.files.size > coverage.candidateFiles || sourceState.files.size > limits.maxFiles
        || sourceState.sourceBytes > limits.maxBytes || sourceState.sourceBytes > coverage.readBytes) {
        throw new Error('Dependency sources exceed declared limits or coverage');
    }
    if (coverage.omittedFiles !== coverage.candidateFiles - coverage.indexedFiles
        || (coverage.indexComplete && coverage.omittedFiles > 0)
        || coverage.unresolvedSites !== sites.filter(site => site.resolution !== 'resolved').length) {
        throw new Error('Dependency coverage exceeds declared limits');
    }
    if (coverage.omittedDiagnostics > 0 && diagnostics.length !== MAX_DIAGNOSTICS) {
        throw new Error('Dependency coverage exceeds declared diagnostic limits');
    }
    return { side, oid: expectedOid, coverage, nodes, sites, diagnostics };
}

function validateCoverage(value: unknown, side: DependencySide, limits: DependencyLimits): ValidatedSnapshot['coverage'] {
    const coverage = object(value, `report.${side}.coverage`);
    requireOnlyKeys(coverage, [
        'candidateFiles', 'indexedFiles', 'omittedFiles', 'readBytes', 'indexComplete', 'unresolvedSites', 'omittedDiagnostics'
    ], `report.${side}.coverage`);
    const indexComplete = coverage.indexComplete;
    if (typeof indexComplete !== 'boolean') throw new Error(`Invalid dependency evidence schema at report.${side}.coverage.indexComplete`);
    const result = {
        candidateFiles: nonnegativeInteger(coverage.candidateFiles, `report.${side}.coverage.candidateFiles`),
        indexedFiles: nonnegativeInteger(coverage.indexedFiles, `report.${side}.coverage.indexedFiles`),
        omittedFiles: nonnegativeInteger(coverage.omittedFiles, `report.${side}.coverage.omittedFiles`),
        readBytes: nonnegativeInteger(coverage.readBytes, `report.${side}.coverage.readBytes`),
        indexComplete,
        unresolvedSites: nonnegativeInteger(coverage.unresolvedSites, `report.${side}.coverage.unresolvedSites`),
        omittedDiagnostics: nonnegativeInteger(coverage.omittedDiagnostics, `report.${side}.coverage.omittedDiagnostics`)
    };
    if (result.indexedFiles > limits.maxFiles || result.readBytes > limits.maxBytes) {
        throw new Error('Dependency coverage exceeds declared limits');
    }
    return result;
}

function validateProducers(value: unknown, side: DependencySide): Map<DependencyLanguage, string> {
    const producers = list(value, `report.${side}.producers`, DEPENDENCY_LANGUAGES.length);
    const result = new Map<DependencyLanguage, string>();
    for (let index = 0; index < producers.length; index++) {
        const producer = object(producers[index], `report.${side}.producers[${index}]`);
        requireOnlyKeys(producer, ['language', 'name'], `report.${side}.producers[${index}]`);
        const language = choice(producer.language, DEPENDENCY_LANGUAGES, `report.${side}.producers[${index}].language`);
        const name = stringValue(producer.name, `report.${side}.producers[${index}].name`);
        if (result.has(language)) throw new Error(`Dependency evidence membership mismatch: duplicate ${language} producer`);
        result.set(language, name);
    }
    return result;
}

function validateDiagnostics(value: unknown, side: DependencySide): ValidatedDiagnostic[] {
    const diagnostics = list(value, `report.${side}.diagnostics`, MAX_DIAGNOSTICS);
    return diagnostics.map((value, index) => {
        const diagnostic = object(value, `report.${side}.diagnostics[${index}]`);
        requireOnlyKeys(diagnostic, ['code', 'message', 'file', 'language'], `report.${side}.diagnostics[${index}]`);
        const code = stringValue(diagnostic.code, `report.${side}.diagnostics[${index}].code`);
        const message = stringValue(diagnostic.message, `report.${side}.diagnostics[${index}].message`);
        const file = diagnostic.file === undefined ? undefined : repositoryPath(diagnostic.file, `report.${side}.diagnostics[${index}].file`);
        const language = diagnostic.language === undefined ? undefined
            : choice(diagnostic.language, DEPENDENCY_LANGUAGES, `report.${side}.diagnostics[${index}].language`);
        if (file && language && dependencyLanguage(file) !== undefined && dependencyLanguage(file) !== language) {
            throw new Error(`Dependency evidence membership mismatch at report.${side}.diagnostics[${index}]`);
        }
        return { code, message, ...(file !== undefined ? { file } : {}), ...(language !== undefined ? { language } : {}) };
    });
}

function validateSource(
    root: string,
    value: unknown,
    label: string,
    side: DependencySide,
    expectedOid: string,
    scopes: readonly string[],
    limits: DependencyLimits,
    candidateFiles: number,
    readBytes: number,
    sourceState: SourceValidationState,
    budget: SourceValidationBudget,
    deadline: number,
    checkTime: () => void,
    allowEmptyModule = false
): ValidatedSource {
    const source = object(value, `report.${label}`);
    requireOnlyKeys(source, ['file', 'revision', 'oid', 'blobOid', 'start', 'end', 'line', 'column', 'digest', 'link'], `report.${label}`);
    const file = repositoryPath(source.file, `report.${label}.file`);
    if (!inScope(file, scopes)) throw new Error(`Dependency evidence membership mismatch at report.${label}.file`);
    if (source.revision !== side) throw new Error(`Dependency source provenance mismatch at report.${label}.revision`);
    oidValue(source.oid, `report.${label}.oid`, expectedOid);
    const blobOid = oidValue(source.blobOid, `report.${label}.blobOid`);
    const start = nonnegativeInteger(source.start, `report.${label}.start`);
    const end = nonnegativeInteger(source.end, `report.${label}.end`);
    const emptyModule = allowEmptyModule && start === 0 && end === 0;
    if (end <= start && !emptyModule) throw new Error(`Invalid dependency evidence schema at report.${label}.end`);
    const line = positiveInteger(source.line, `report.${label}.line`);
    const column = positiveInteger(source.column, `report.${label}.column`);
    const digest = hash(source.digest, `report.${label}.digest`);
    if (source.link !== undefined) stringValue(source.link, `report.${label}.link`);
    let ref: SourceRef;
    try {
        const candidate = { revision: expectedOid, path: file, start, end, digest };
        // Empty files have a module node but no navigable source slice.
        ref = emptyModule ? candidate : parseSourceRef(candidate);
    } catch {
        throw new Error(`Invalid dependency source reference at report.${label}`);
    }

    checkTime();
    const key = `${expectedOid}:${file}`;
    if (!budget.cache.has(key)) {
        const pinned = readPinnedFile(root, expectedOid, file, deadline);
        budget.cache.set(key, pinned);
        budget.totalBytes += pinned ? Buffer.byteLength(pinned.text) : 0;
        if (budget.totalBytes > 2 * limits.maxBytes) throw new Error('Dependency sources exceed declared combined snapshot limits');
    }
    const pinned = budget.cache.get(key);
    checkTime();
    if (!pinned || pinned.blob !== blobOid) throw new Error(`Dependency source blob mismatch at report.${label}`);
    if (!sourceState.files.has(file)) {
        sourceState.files.add(file);
        sourceState.sourceBytes += Buffer.byteLength(pinned.text);
        if (Buffer.byteLength(pinned.text) > limits.maxFileBytes || sourceState.files.size > limits.maxFiles
            || sourceState.files.size > candidateFiles || sourceState.sourceBytes > limits.maxBytes || sourceState.sourceBytes > readBytes) {
            throw new Error('Dependency sources exceed declared limits or coverage');
        }
    }
    if (emptyModule ? pinned.text !== '' || digest !== createHash('sha256').update('').digest('hex')
        : resolveSourceRef(ref, { revision: expectedOid, files: { [file]: pinned.text } }).status !== 'valid') {
        throw new Error(`Dependency source digest mismatch at report.${label}`);
    }
    const before = pinned.text.slice(0, start);
    const expectedLine = before.split(/\r\n|\r|\n/).length;
    const expectedColumn = start - Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
    if (line !== expectedLine || column !== expectedColumn) {
        throw new Error(`Dependency source coordinate mismatch at report.${label}`);
    }
    return { file, ref };
}

function formatNodeId(id: string): string {
    const parts = nodeIdParts(id);
    return `${parts[0]}#${parts[1]}`;
}

function nodeIdFile(id: string): string {
    return nodeIdParts(id)[0];
}

function nodeIdParts(value: string): [string, string] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error(`Dependency evidence membership mismatch: invalid node ID ${value}`);
    }
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string'
        || !parsed[0] || !parsed[1]) {
        throw new Error(`Dependency evidence membership mismatch: invalid node ID ${value}`);
    }
    return [parsed[0], parsed[1]];
}

function inScope(file: string, scopes: readonly string[]): boolean {
    return scopes.length === 0 || scopes.some(scope => scope === '' || file === scope || file.startsWith(`${scope}/`));
}

function object(value: unknown, label: string): ObjectValue {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Invalid dependency evidence object at ${label}`);
    }
    return value as ObjectValue;
}

function list(value: unknown, label: string, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > Math.min(maximum, MAX_LIST_LENGTH)) {
        throw new Error(`Invalid dependency evidence list at ${label}`);
    }
    return value;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
    if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH || (!allowEmpty && value.trim().length === 0)) {
        throw new Error(`Invalid dependency evidence text at ${label}`);
    }
    return value;
}

function optionalString(value: unknown, label: string, allowEmpty = false): string | undefined {
    return value === undefined ? undefined : stringValue(value, label, allowEmpty);
}

function optionalStringArray(value: unknown, label: string): string[] {
    if (value === undefined) return [];
    return list(value, label, MAX_LIST_LENGTH).map((item, index) => stringValue(item, `${label}[${index}]`));
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
    if (!choices.includes(value as T)) throw new Error(`Invalid dependency evidence value at ${label}`);
    return value as T;
}

function nonnegativeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid dependency evidence integer at ${label}`);
    return value as number;
}

function positiveInteger(value: unknown, label: string): number {
    const result = nonnegativeInteger(value, label);
    if (result < 1) throw new Error(`Invalid dependency evidence integer at ${label}`);
    return result;
}

function boundedLimit(value: unknown, label: string, key: LimitKey): number {
    const result = positiveInteger(value, label);
    if (result > DEFAULT_DEPENDENCY_LIMITS[key]) throw new Error('Invalid dependency limits');
    return result;
}

function oidValue(value: unknown, label: string, expected?: string): string {
    if (typeof value !== 'string' || !OID_PATTERN.test(value) || (expected !== undefined && value !== expected)) {
        throw new Error(expected === undefined ? `Invalid dependency evidence revision at ${label}` : 'Dependency report does not match pinned review');
    }
    return value;
}

function hash(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`Invalid dependency evidence digest at ${label}`);
    return value;
}

function repositoryPath(value: unknown, label: string): string {
    const path = stringValue(value, label);
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.includes('\0')
        || path.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid dependency evidence repository path at ${label}`);
    }
    return path;
}

function repositoryRelativePrefix(value: unknown, label: string): string {
    const prefix = stringValue(value, label, true);
    if (prefix.startsWith('/') || /^[A-Za-z]:/.test(prefix) || prefix.includes('\\') || prefix.includes('\0')
        || prefix.split('/').some(part => part === '..')) {
        throw new Error(`Invalid dependency evidence repository path at ${label}`);
    }
    return prefix;
}

function repositoryScope(value: unknown, label: string): string {
    const scope = stringValue(value, label, true);
    if (scope && (scope.startsWith('/') || /^[A-Za-z]:/.test(scope) || scope.includes('\\') || scope.includes('\0')
        || scope.split('/').some(part => !part || part === '.' || part === '..'))) {
        throw new Error(`Invalid dependency evidence repository scope at ${label}`);
    }
    return scope;
}

function requireOnlyKeys(value: ObjectValue, allowed: readonly string[], label: string): void {
    const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
    if (unexpected.length > 0) {
        throw new Error(`Invalid dependency evidence schema at ${label}: unknown field${unexpected.length === 1 ? '' : 's'} ${unexpected.join(', ')}`);
    }
}
