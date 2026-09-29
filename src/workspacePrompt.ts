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

export interface WorkspacePromptSkill {
    path?: string;
    name?: string;
}

const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const DEFAULT_SKILL_NAME = 'bygone-tour-skill.md';

/**
 * Build a compact provider-neutral authoring handoff without inspecting the
 * workspace or performing any I/O.
 */
export function buildWorkspacePrompt(
    kind: WorkspacePromptKind,
    context: WorkspacePromptContext = {},
    skill: WorkspacePromptSkill = {}
): string {
    const normalizedKind = kind === 'deconstructed' ? 'deconstructed' : 'historical';
    const repository = nonEmptyString(context.repository);
    const paths = stringList(context.paths);
    const rootScope = repository !== undefined
        && Array.isArray(context.paths)
        && context.paths.length === 0;
    const scope = rootScope ? ['.'] : paths.length > 0 ? paths : null;
    const revisions = stringList(context.revisions);
    const exactRange = isExactRange(repository, revisions, context.rangeStatus);
    const warningStatus = context.rangeStatus || 'unavailable';

    const lines = [
        buildSkillInstruction(skill),
        `Create a v3 ${normalizedKind} tour.`,
        `Repository: ${JSON.stringify(repository ?? null)}`,
        `Selected paths: ${JSON.stringify(scope)}`,
        `Base: ${JSON.stringify(exactRange ? revisions[0] : null)}`,
        `Head: ${JSON.stringify(exactRange ? revisions[1] : null)}`,
        'Additional context: (optional)'
    ];

    if (!exactRange) {
        lines.push(
            `Warning: range status ${JSON.stringify(warningStatus)} is not an exact committed range; choose revisions in Compare. Do not silently substitute a merge-base, swap endpoints, or drop revisions.`,
            `All revisions: ${JSON.stringify(revisions)}`
        );
    }

    return lines.join('\n');
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

function buildSkillInstruction(skill: WorkspacePromptSkill): string {
    const path = nonEmptyString(skill.path);
    if (path) {
        return `Read and follow the Bygone tour skill at ${JSON.stringify(path)}.`;
    }

    const name = nonEmptyString(skill.name) || DEFAULT_SKILL_NAME;
    return `Read and follow the Bygone tour skill in attached ${JSON.stringify(name)}.`;
}

function stringList(values: readonly string[] | undefined): string[] {
    if (!Array.isArray(values)) return [];
    return values
        .filter((value): value is string => typeof value === 'string')
        .filter((value) => value.length > 0);
}

function nonEmptyString(value: string | undefined): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
