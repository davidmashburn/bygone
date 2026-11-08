import { TOUR_OPTION_CHOICES, TourCoverage, TourOptionField, TourOptions, TourStyle, validateTourOptions } from './tourOptions';

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
    skill: WorkspacePromptSkill = {},
    options?: TourOptions,
    humanAuthor?: string
): string {
    validateTourOptions(options, 8);
    const style = options?.style || (kind === 'deconstructed' ? TourStyle.Deconstructed : TourStyle.Historical);
    const normalizedKind = style === TourStyle.Deconstructed ? 'deconstructed' : 'historical';
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
        `Create a v8 ${normalizedKind} tour.`,
        `Repository: ${JSON.stringify(repository ?? null)}`,
        `Selected paths: ${JSON.stringify(scope)}`,
        `Base: ${JSON.stringify(exactRange ? revisions[0] : null)}`,
        `Head: ${JSON.stringify(exactRange ? revisions[1] : null)}`,
        options ? `Tour options (record resolved values explicitly in the tour file): ${JSON.stringify(options)}\nInfer the dimensions listed in options.inferred from this request and code context; their displayed values are starting defaults. Preserve other dimensions as explicit choices. Record the resolved inferred dimensions in options.inferred, including emphasis: [] when no extra emphasis is inferred.`
            : `Requested style: ${style}. Infer omitted depth, audience, familiarity, coverage, and emphasis from this request and the code context. Record all resolved core options and list inferred dimensions in options.inferred. Explicit user choices take precedence.`,
        `Human author: ${JSON.stringify(nonEmptyString(humanAuthor) ?? null)}. Record known human attribution as author.name; ask if it cannot be established from supplied context. Never infer authorship from Git or invent a name.`,
        'Record generatedBy.model using the actual authoring model identifier, plus known provider, harness, and effort. Do not substitute the compiler or an integrating agent for the authoring runtime.',
        'Record selected paths as repository-relative options.paths (omit for the whole comparison). Never silently broaden the selected scope; resolve unknown scope before claiming complete coverage.',
        'Additional context: (optional)'
    ];

    if (options) {
        for (const field of [TourOptionField.Style, TourOptionField.Depth, TourOptionField.Audience, TourOptionField.Familiarity, TourOptionField.Coverage]) {
            lines.push(`${TOUR_OPTION_CHOICES[field].find(choice => choice.value === options[field])!.description}`);
        }
        for (const emphasis of options.emphasis || []) lines.push(TOUR_OPTION_CHOICES.emphasis.find(choice => choice.value === emphasis)!.description);
        if (options.notes) lines.push(`Audience/task context: ${JSON.stringify(options.notes)}`);
        if (options.coverage === TourCoverage.Complete) {
            lines.push('100% refers to the final-result inventory, even for Historical or Deconstructed styles. Include fully narrated endpoint evidence for both changed sides of every hunk; do not exclude generated files. Account for non-text and zero-hunk entries in coverage.accountedFiles with a path and explanation. Run bygone tour coverage --json; report strict main-path coverage separately from reader progress, optional detail, and correctness. A requested 100% tour is not verified complete until the strict report says so. Headlines + 100% still needs a complete detail path and cannot promise a tiny total reading time.');
        }
    }

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
