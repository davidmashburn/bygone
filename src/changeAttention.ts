import type { GitChangeKind } from './gitComparison';

export const CHANGE_ATTENTION_VERSION = 1 as const;

export type ChangeFileRole = 'production' | 'test' | 'documentation' | 'dependency' | 'generated';
export type ChangeAttentionClass = 'entry' | 'focus' | 'background' | 'mechanical';

export interface ChangeAttentionInputFile {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    additions: number | null;
    deletions: number | null;
    binary?: boolean;
    headText?: string;
    symbolHints?: readonly string[];
    commitCount?: number;
}

export interface ChangeAttentionFile {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    role: ChangeFileRole;
    attention: ChangeAttentionClass;
    additions: number | null;
    deletions: number | null;
    reason: string;
    score: number;
}

export interface ChangeAttention {
    version: typeof CHANGE_ATTENTION_VERSION;
    entryPath: string | null;
    entryReason: string;
    fallbackPath: string | null;
    focusPaths: string[];
    backgroundPaths: string[];
    mechanicalPaths: string[];
    files: ChangeAttentionFile[];
}

const LOCKFILES = new Set([
    'cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'poetry.lock', 'gemfile.lock', 'composer.lock'
]);
const MAX_FAN_IN_FILES = 250;
const MAX_FAN_IN_TEXT_BYTES = 64 * 1024;

export function classifyChangeFileRole(filePath: string): ChangeFileRole {
    const lower = filePath.toLowerCase();
    const fileName = lower.split('/').pop() || lower;
    if (/(^|\/)(dist|build|generated|vendor)(\/|$)/.test(lower) || /(?:\.min\.js|\.map)$/.test(lower)) return 'generated';
    if (/(^|\/)(tests?|__tests__)(\/|$)/.test(lower)
        || /(^|\/)test_[^/]+$/.test(lower)
        || /\.(test|spec)\.[^/]+$/.test(lower)) return 'test';
    if (lower.startsWith('docs/') || fileName === 'readme.md' || /\.(md|mdx|rst)$/.test(lower)) return 'documentation';
    if (LOCKFILES.has(fileName)
        || /(^|\/)(pyproject\.toml|package\.json|go\.mod|go\.sum|cargo\.toml)$/.test(lower)) return 'dependency';
    return 'production';
}

export function buildChangeAttention(inputs: readonly ChangeAttentionInputFile[]): ChangeAttention {
    const prepared = inputs.map((input) => prepareFile(input, inputs));
    const production = prepared.filter((file) => file.role === 'production' && !file.mechanical);
    const documentation = prepared.filter((file) => file.role === 'documentation' && !file.mechanical);
    const eligible = production.length > 0 ? production : documentation;
    const entry = [...eligible].sort(compareRanked)[0];
    const fallback = [...prepared]
        .filter((file) => !file.binary)
        .sort((left, right) => right.changedLines - left.changedLines || left.path.localeCompare(right.path))[0];

    const focusCandidates = prepared
        .filter((file) => file.path !== entry?.path && file.role === 'production' && !file.mechanical)
        .sort(compareRanked)
        .slice(0, Math.max(0, 7 - (entry ? 1 : 0)));
    const pairedTest = entry || focusCandidates.length > 0
        ? prepared
            .filter((file) => file.role === 'test'
                && !file.mechanical
                && file.changedLines >= 5
                && isTestForFocus(file.path, [entry, ...focusCandidates].filter(Boolean).map((candidate) => candidate!.path)))
            .sort(compareRanked)[0]
        : undefined;
    if (pairedTest && focusCandidates.length < Math.max(0, 7 - (entry ? 1 : 0))) focusCandidates.push(pairedTest);

    const focusPaths = focusCandidates.map((file) => file.path);
    const files = prepared.map((file): ChangeAttentionFile => {
        const attention: ChangeAttentionClass = file.path === entry?.path
            ? 'entry'
            : focusPaths.includes(file.path)
                ? 'focus'
                : file.mechanical
                    ? 'mechanical'
                    : 'background';
        return {
            path: file.path,
            previousPath: file.previousPath,
            changeKind: file.changeKind,
            role: file.role,
            attention,
            additions: file.additions,
            deletions: file.deletions,
            reason: attention === 'entry' ? entryReason(file, production.length) : attentionReason(file),
            score: file.score
        };
    }).sort((left, right) => left.path.localeCompare(right.path));

    return {
        version: CHANGE_ATTENTION_VERSION,
        entryPath: entry?.path || null,
        entryReason: entry ? entryReason(entry, production.length) : noEntryReason(prepared),
        fallbackPath: fallback?.path || null,
        focusPaths,
        backgroundPaths: files.filter((file) => file.attention === 'background').map((file) => file.path),
        mechanicalPaths: files.filter((file) => file.attention === 'mechanical').map((file) => file.path),
        files
    };
}

function prepareFile(input: ChangeAttentionInputFile, all: readonly ChangeAttentionInputFile[]) {
    const role = classifyChangeFileRole(input.path);
    const fileName = input.path.toLowerCase().split('/').pop() || input.path.toLowerCase();
    const mechanical = Boolean(input.binary) || role === 'generated' || LOCKFILES.has(fileName);
    const changedLines = (input.additions ?? 0) + (input.deletions ?? 0);
    const contract = /(^|[\/._-])(types?|schema|models?|contracts?|interfaces?)([\/._-]|$)/i.test(input.path);
    const referenceHints = new Set([
        fileName.replace(/\.[^.]+$/, ''),
        ...(input.symbolHints || []).map((hint) => hint.toLowerCase())
    ].filter((hint) => hint.length >= 4));
    const fanIn = [...all]
        .filter((candidate) => candidate.path !== input.path)
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, MAX_FAN_IN_FILES)
        .filter((candidate) => {
            const boundedText = candidate.headText?.slice(0, MAX_FAN_IN_TEXT_BYTES).toLowerCase();
            return Boolean(boundedText && [...referenceHints].some((hint) => boundedText.includes(hint)));
        }).length;
    const roleScore = role === 'production' ? 300 : role === 'documentation' ? 150 : role === 'dependency' ? 80 : role === 'test' ? 50 : 0;
    const sizePenalty = changedLines > 2000 ? 80 : changedLines > 500 ? 30 : 0;
    const readmePenalty = fileName === 'readme.md' && all.filter((candidate) => !candidate.binary).length > 1 ? 100 : 0;
    return {
        ...input,
        role,
        mechanical,
        changedLines,
        contract,
        fanIn,
        binary: Boolean(input.binary),
        score: mechanical ? -1000 : roleScore + (contract ? 100 : 0) + fanIn * 40 + (input.commitCount || 0) * 5 - sizePenalty - readmePenalty
    };
}

function compareRanked(left: ReturnType<typeof prepareFile>, right: ReturnType<typeof prepareFile>): number {
    return right.score - left.score
        || right.fanIn - left.fanIn
        || left.changedLines - right.changedLines
        || left.path.localeCompare(right.path);
}

function entryReason(file: ReturnType<typeof prepareFile>, productionCount: number): string {
    if (file.fanIn > 0) return `Referenced by ${file.fanIn} other changed file${file.fanIn === 1 ? '' : 's'}.`;
    if (file.contract) return 'Contract-shaped path central to the change.';
    if (productionCount === 1) return 'Only production file in this range.';
    return 'Highest-ranked production file for a first pass.';
}

function attentionReason(file: ReturnType<typeof prepareFile>): string {
    if (file.binary) return 'Binary file.';
    if (file.mechanical) return file.role === 'generated' ? 'Generated artifact.' : 'Dependency lockfile.';
    if (file.role === 'test') return 'Test or proof file.';
    if (file.role === 'documentation') return 'Documentation change.';
    if (file.role === 'dependency') return 'Dependency or packaging manifest.';
    return 'Additional production file.';
}

function noEntryReason(files: readonly ReturnType<typeof prepareFile>[]): string {
    if (files.every((file) => file.mechanical)) return 'This change is entirely mechanical or generated.';
    if (files.every((file) => file.mechanical || file.role === 'test')) return 'This change contains only tests and mechanical files.';
    return 'No single entry-point is reliable for this change.';
}

function isTestForFocus(testPath: string, focusPaths: readonly string[]): boolean {
    const normalizedTest = testPath.toLowerCase().replace(/\.(test|spec)(?=\.)/, '').replace(/^test_/, '');
    return focusPaths.some((candidate) => {
        const normalizedCandidate = candidate.toLowerCase();
        const stem = normalizedCandidate.split('/').pop()?.replace(/\.[^.]+$/, '') || normalizedCandidate;
        return stem.length >= 3 && normalizedTest.includes(stem);
    });
}
