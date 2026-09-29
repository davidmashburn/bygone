export type WorkspacePromptKind = 'historical' | 'deconstructed';

export type WorkspacePromptRangeStatus =
    | 'exact'
    | 'none'
    | 'multiple'
    | 'uncommitted'
    | 'reversed'
    | 'divergent'
    | 'unavailable';

export interface WorkspacePromptContext {
    repository?: string;
    paths?: readonly string[];
    revisions?: readonly string[];
    rangeStatus?: WorkspacePromptRangeStatus;
    reason?: string;
}

const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Build the provider-neutral authoring handoff shown when a tour kind is not
 * available in the current workspace.  This function deliberately describes
 * evidence and boundaries; it does not inspect files, buffers, or providers.
 */
export function buildWorkspacePrompt(
    kind: WorkspacePromptKind,
    context: WorkspacePromptContext = {}
): string {
    const normalizedKind = kind === 'deconstructed' ? 'deconstructed' : 'historical';
    const repository = nonEmptyString(context.repository);
    const paths = stringList(context.paths);
    const wholeRepositoryScope = Boolean(repository && Array.isArray(context.paths) && paths.length === 0);
    const revisions = stringList(context.revisions);
    const status = context.rangeStatus;
    const reason = singleLine(context.reason);
    const exactRange = isExactRange(repository, revisions, status);
    const modeLabel = normalizedKind === 'historical' ? 'Historical' : 'Deconstructed';
    const modeGuidance = normalizedKind === 'historical'
        ? [
            'Use actual chronological Git revisions for the panels and anchors.',
            'Explain facts, decisions, reversals, and interpretation without inventing intermediate commits.',
            'Every revision named by the tour must remain an exact, resolvable Git OID.'
        ]
        : [
            'Use explicitly synthetic explanatory stages to make the change understandable.',
            'Tie each stage to real bounded hunk evidence and label it as an explanation stage.',
            'Never present a synthetic stage as a commit or as an observed repository state.'
        ];

    const lines = [
        `# ${modeLabel} tour authoring prompt`,
        '',
        `Author a provider-neutral ${modeLabel.toLowerCase()} change tour for the workspace context below.`,
        'This is an authoring draft only: no provider, model request, automatic generation, shell execution, or file write is implied.',
        '',
        '## Requested tour kind',
        `- Kind: ${modeLabel} tour`,
        ...modeGuidance.map((item) => `- ${item}`),
        '',
        '## Workspace context',
        `- Repository: ${repository || '(not resolved)'}`,
        `- Selected paths/directories: ${paths.length > 0 ? paths.join(', ') : wholeRepositoryScope ? '. (repository root; full requested scope)' : '(not supplied; keep the requested scope explicit)'}`,
        `- Revisions: ${revisions.length > 0 ? revisions.join(', ') : '(none reported)'}`,
        `- Range status: ${status || 'unavailable'}`,
        ...(reason ? [`- Host note: ${reason}`] : []),
        '',
        'The selected paths/directories are the requested scope. The `bygone tour context` command has no path filter: constrain the authored tour to this scope yourself and do not claim that the context command filtered its output.',
        'Do not read or paste unsaved editor buffers, full source files, secrets, or unrelated paths into this draft.',
        '',
        '## Revision boundary',
        ...buildRangeGuidance({ repository, revisions, status, reason, exactRange }),
        '',
        '## Bounded evidence and authoring rules',
        '- Use bounded change context and real source anchors for every factual claim; keep interpretation clearly distinct from evidence.',
        '- Inspect `bygone tour schema` and author a document that conforms to that schema.',
        '- Before opening the result, run `bygone tour validate <file.bygone> --json` and repair every reported error.',
        '- Preserve exact revisions and selected path scope. Do not silently substitute a merge base, drop a selected revision, or broaden a file request to the repository.',
        '- Keep patches and excerpts bounded. Do not embed full source contents or claim that unsaved buffers are committed evidence.',
        '- A deconstructed explanation may describe a constructed stage, but it must never be presented as a commit.',
        '',
        '## Handoff',
        'Write the tour file explicitly, validate it, and then open it through the normal Bygone tour flow. Do not execute a copied command automatically.'
    ];

    return lines.join('\n');
}

function buildRangeGuidance({
    repository,
    revisions,
    status,
    reason,
    exactRange
}: {
    repository?: string;
    revisions: string[];
    status?: WorkspacePromptRangeStatus;
    reason?: string;
    exactRange: boolean;
}): string[] {
    if (exactRange) {
        const [base, head] = revisions;
        return [
            `- Exact host-resolved range: base ${base} → head ${head}. The host confirmed base is a known ancestor of head.`,
            '- Bounded context command (read-only; do not execute automatically):',
            '```sh',
            `cd -- ${shellQuote(repository!)} && bygone tour context ${head} --base ${base}`,
            '```'
        ];
    }

    const revisionList = revisions.length > 0
        ? ` Reported revisions: ${revisions.join(', ')}.`
        : '';
    const note = reason ? ` Host note: ${reason}.` : '';
    const placeholders = [
        '- Base: (placeholder; choose a committed boundary in Compare).',
        '- Head: (placeholder; choose a committed boundary in Compare).'
    ];

    switch (status) {
        case 'multiple':
            return [
                ...placeholders,
                `- More than one comparison boundary is present.${revisionList}`,
                '- Keep every listed revision visible, choose the intended base and head deliberately in Compare, and do not silently drop intermediate or unrelated revisions.',
                '- Choose revisions in Compare before collecting an exact context dossier.'
            ];
        case 'uncommitted':
            return [
                ...placeholders,
                `- The comparison includes an uncommitted WORKTREE or INDEX state.${revisionList}`,
                '- Do not fabricate a committed OID or describe an unsaved buffer as committed evidence.',
                '- Choose revisions in Compare, using committed boundaries, before collecting an exact context dossier.'
            ];
        case 'reversed':
            return [
                ...placeholders,
                `- The requested endpoints are reversed.${revisionList}`,
                '- Preserve that distinction in the draft; do not silently swap the endpoints or turn the range into a different history.',
                '- Choose revisions in Compare to set the intended base and head deliberately before collecting context.'
            ];
        case 'divergent':
            return [
                ...placeholders,
                `- The endpoints are not a known ancestor/descendant range.${revisionList}`,
                '- Do not silently replace this comparison with a merge-base range. Explain the distinction and make a deliberate choice in Compare.',
                '- Choose revisions in Compare before collecting an exact context dossier.'
            ];
        case 'unavailable':
            return [
                ...placeholders,
                `- An exact committed range is unavailable.${note}${revisionList}`,
                '- Keep base and head as placeholders rather than inventing provenance.',
                '- Choose revisions in Compare when the repository and committed boundaries are available.'
            ];
        case 'none':
            return [
                ...placeholders,
                '- No meaningful revision range is selected.',
                '- Keep base and head as explicit placeholders; do not invent a base or claim a context dossier exists.',
                '- Choose revisions in Compare before collecting an exact context dossier.'
            ];
        case 'exact':
            return [
                ...placeholders,
                `- The host marked the range exact, but it did not provide exactly two full OIDs and a repository.${revisionList}${note}`,
                '- Keep base and head as placeholders; an exact command is intentionally withheld until the host resolves both boundaries.',
                '- Choose revisions in Compare before collecting an exact context dossier.'
            ];
        default:
            return [
                ...placeholders,
                `- No exact two-revision range is available.${revisionList}${note}`,
                '- Keep base and head as explicit placeholders rather than inventing ancestry or silently substituting a merge base.',
                '- Choose revisions in Compare before collecting an exact context dossier.'
            ];
    }
}

function isExactRange(
    repository: string | undefined,
    revisions: readonly string[],
    status: WorkspacePromptRangeStatus | undefined
): boolean {
    return status === 'exact'
        && Boolean(repository)
        && revisions.length === 2
        && revisions.every((revision) => FULL_OID_PATTERN.test(revision));
}

function shellQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function stringList(values: readonly string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}

function nonEmptyString(value: string | undefined): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function singleLine(value: string | undefined): string | undefined {
    const normalized = nonEmptyString(value)?.replace(/\s+/g, ' ');
    return normalized || undefined;
}
