/** Browser-safe authoring intent. These choices are not quality or completion scores. */
export enum TourStyle { Final = 'final', Historical = 'historical', Deconstructed = 'deconstructed' }
export enum TourDepth { Headlines = 'headlines', Overview = 'overview', Guided = 'guided', Deep = 'deep', LineByLine = 'line-by-line' }
export enum TourAudience {
    Peer = 'peer', NewContributor = 'new-contributor', Maintainer = 'maintainer', Architect = 'architect',
    Product = 'product', QA = 'qa', Operations = 'operations', Security = 'security', Leadership = 'leadership', Consumer = 'consumer'
}
export enum TourFamiliarity { New = 'new', Some = 'some', Familiar = 'familiar' }
export enum TourCoverage { KeyChanges = 'key-changes', Complete = 'complete' }
export enum TourEmphasis {
    Behavior = 'behavior', Design = 'design', Correctness = 'correctness', Tests = 'tests',
    Performance = 'performance', Security = 'security', Rollout = 'rollout'
}
export enum TourOptionField {
    Style = 'style', Depth = 'depth', Audience = 'audience', Familiarity = 'familiarity', Coverage = 'coverage', Emphasis = 'emphasis'
}
export interface TourOptions {
    style: TourStyle;
    depth: TourDepth;
    audience: TourAudience;
    familiarity: TourFamiliarity;
    coverage: TourCoverage;
    emphasis?: TourEmphasis[];
    notes?: string;
    /** Repo-relative paths/directories; omitted or empty means the whole comparison. */
    paths?: string[];
    /** Choices inferred by the authoring agent, rather than explicitly requested. */
    inferred?: TourOptionField[];
}
interface Choice<T extends string> { value: T; label: string; description: string }
function choice<T extends string>(value: T, label: string, description: string): Choice<T> { return { value, label, description }; }
export const TOUR_OPTION_CHOICES: Record<TourOptionField, readonly Choice<string>[]> = {
    style: [
        choice(TourStyle.Final, 'Final result', 'Explain the finished endpoint change and what survives in the result.'),
        choice(TourStyle.Historical, 'Historical', 'Explain real revisions, decisions, updates, and reversals.'),
        choice(TourStyle.Deconstructed, 'Deconstructed', 'Teach through synthetic cumulative stages; distinguish them from actual commits.')
    ],
    depth: [
        choice(TourDepth.Headlines, 'Headlines', 'A few takeaways: what changed, why it matters, and the main caveat.'),
        choice(TourDepth.Overview, 'Overview', 'Explain behavior before/after, affected components, major decisions, and consequences.'),
        choice(TourDepth.Guided, 'Guided walkthrough', 'Follow the relevant flow, explaining key mechanisms, contracts, and how the pieces fit together.'),
        choice(TourDepth.Deep, 'Deep dive', 'Explain invariants, alternatives, dependencies, edge cases, test evidence, and tradeoffs supported by the change.'),
        choice(TourDepth.LineByLine, 'Line by line', 'Explain individual edits and their local interactions; explicitly group repetitive mechanical edits.')
    ],
    audience: [
        choice(TourAudience.Peer, 'Peer engineer / reviewer', 'Emphasize contracts, correctness, test evidence, and areas deserving close inspection.'),
        choice(TourAudience.NewContributor, 'New contributor', 'Explain project vocabulary, component roles, entry points, and how to investigate further; assume general coding knowledge.'),
        choice(TourAudience.Maintainer, 'Maintainer / code owner', 'Emphasize invariants, compatibility, maintenance, extension points, and future failure modes.'),
        choice(TourAudience.Architect, 'Architect / technical lead', 'Explain boundaries, dependencies, alternatives, architectural consequences, and long-term tradeoffs.'),
        choice(TourAudience.Product, 'Product / design', 'Explain user journeys, behavior changes, constraints, edge states, and acceptance criteria.'),
        choice(TourAudience.QA, 'QA / test engineer', 'Emphasize observable behavior, scenarios, regressions, boundaries, and verified versus unverified test coverage.'),
        choice(TourAudience.Operations, 'Operations / SRE', 'Explain applicable deployment, configuration, observability, failure handling, rollback, and migration implications.'),
        choice(TourAudience.Security, 'Security / privacy reviewer', 'Examine trust boundaries, access, data handling, abuse cases, and evidence gaps without inventing vulnerabilities.'),
        choice(TourAudience.Leadership, 'Leadership / stakeholder', 'Explain outcomes, scope, tradeoffs, dependencies, and unresolved risks in plain language without unsupported impact estimates.'),
        choice(TourAudience.Consumer, 'Library / API consumer', 'Explain public behavior, migration examples, compatibility, and adoption without assuming internal familiarity.')
    ],
    familiarity: [
        choice(TourFamiliarity.New, 'New to this codebase', 'Supply codebase background and define project-specific vocabulary.'),
        choice(TourFamiliarity.Some, 'Some context', 'Supply the context needed for this change without a general project introduction.'),
        choice(TourFamiliarity.Familiar, 'Already familiar', 'Assume codebase familiarity, while explaining new concepts and changed assumptions.')
    ],
    coverage: [
        choice(TourCoverage.KeyChanges, 'Key changes', 'Select relevant changes and explicitly disclose the selection; depth does not imply completeness.'),
        choice(TourCoverage.Complete, '100% of changes', 'Explain every textual hunk in the final comparison and explicitly account for all other changed entries. No exclusions.')
    ],
    emphasis: [
        choice(TourEmphasis.Behavior, 'Behavior', 'Emphasize observable before/after behavior.'),
        choice(TourEmphasis.Design, 'Design decisions', 'Emphasize supported rationale and alternatives.'),
        choice(TourEmphasis.Correctness, 'Correctness / edge cases', 'Emphasize invariants, error paths, and boundary cases.'),
        choice(TourEmphasis.Tests, 'Tests', 'Distinguish tests actually run from proposed test scenarios.'),
        choice(TourEmphasis.Performance, 'Performance', 'Distinguish measurements from unverified performance expectations.'),
        choice(TourEmphasis.Security, 'Security / privacy', 'Emphasize trust boundaries and data handling where applicable.'),
        choice(TourEmphasis.Rollout, 'Rollout / compatibility', 'Emphasize deployment, migrations, rollback, and compatibility where applicable.')
    ]
} as const;
export enum TourPreset {
    CatchUp = 'catch-up', Briefing = 'briefing', Product = 'product', Review = 'review', Complete = 'complete',
    LineByLine = 'line-by-line', Onboard = 'onboard', Architecture = 'architecture', History = 'history',
    Tests = 'tests', Deployment = 'deployment', Security = 'security'
}
function preset(id: TourPreset, label: string, style: TourStyle, depth: TourDepth, audience: TourAudience,
    coverage = TourCoverage.KeyChanges, emphasis: TourEmphasis[] = []): { id: TourPreset; label: string; options: TourOptions } {
    return { id, label, options: { style, depth, audience, coverage, emphasis,
        familiarity: audience === TourAudience.NewContributor ? TourFamiliarity.New : TourFamiliarity.Some } };
}
export const TOUR_PRESETS = [
    preset(TourPreset.CatchUp, 'Catch me up', TourStyle.Final, TourDepth.Overview, TourAudience.Peer),
    preset(TourPreset.Briefing, 'Stakeholder briefing', TourStyle.Final, TourDepth.Headlines, TourAudience.Leadership),
    preset(TourPreset.Product, 'Product walkthrough', TourStyle.Final, TourDepth.Overview, TourAudience.Product),
    preset(TourPreset.Review, 'Help me review this', TourStyle.Final, TourDepth.Deep, TourAudience.Peer, TourCoverage.KeyChanges, [TourEmphasis.Correctness, TourEmphasis.Tests]),
    preset(TourPreset.Complete, 'Explain every change / 100%', TourStyle.Final, TourDepth.Guided, TourAudience.Peer, TourCoverage.Complete),
    preset(TourPreset.LineByLine, 'Line-by-line review', TourStyle.Final, TourDepth.LineByLine, TourAudience.Maintainer, TourCoverage.Complete),
    preset(TourPreset.Onboard, 'Onboard me', TourStyle.Deconstructed, TourDepth.Guided, TourAudience.NewContributor),
    preset(TourPreset.Architecture, 'Architecture deep dive', TourStyle.Deconstructed, TourDepth.Deep, TourAudience.Architect),
    preset(TourPreset.History, 'How we got here', TourStyle.Historical, TourDepth.Guided, TourAudience.Peer),
    preset(TourPreset.Tests, 'Test planning', TourStyle.Final, TourDepth.Deep, TourAudience.QA, TourCoverage.KeyChanges, [TourEmphasis.Tests]),
    preset(TourPreset.Deployment, 'Deployment readiness', TourStyle.Final, TourDepth.Deep, TourAudience.Operations, TourCoverage.KeyChanges, [TourEmphasis.Rollout]),
    preset(TourPreset.Security, 'Security review tour', TourStyle.Final, TourDepth.Deep, TourAudience.Security, TourCoverage.KeyChanges, [TourEmphasis.Security])
];
export function tourOptionLabel(field: TourOptionField, value: string): string {
    return TOUR_OPTION_CHOICES[field].find(option => option.value === value)?.label || value;
}
export function validateTourOptions(value: unknown, version: number, path = 'options'): asserts value is TourOptions | undefined {
    if (value === undefined) return;
    if (version < 8) throw new Error(`${path} requires tour version 8.`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    const options = value as Record<string, unknown>;
    const allowed = [...Object.values(TourOptionField), 'notes', 'paths', 'inferred'];
    for (const key of Object.keys(options)) if (!allowed.includes(key)) throw new Error(`${path} contains unknown field: ${key}`);
    for (const field of [TourOptionField.Style, TourOptionField.Depth, TourOptionField.Audience, TourOptionField.Familiarity, TourOptionField.Coverage]) {
        if (!TOUR_OPTION_CHOICES[field].some(choice => choice.value === options[field])) throw new Error(`${path}.${field} must be one of ${TOUR_OPTION_CHOICES[field].map(choice => choice.value).join(', ')}.`);
    }
    for (const field of [TourOptionField.Emphasis, 'inferred'] as const) {
        if (options[field] === undefined) continue;
        const entries = options[field];
        const values: readonly string[] = field === TourOptionField.Emphasis ? Object.values(TourEmphasis) : Object.values(TourOptionField);
        if (!Array.isArray(entries) || entries.some(item => !values.includes(item)) || new Set(entries).size !== entries.length) throw new Error(`${path}.${field} must contain distinct supported values.`);
    }
    if (Array.isArray(options.inferred) && options.inferred.includes(TourOptionField.Emphasis) && options.emphasis === undefined) throw new Error(`${path}.emphasis must record the inferred value, including [] for no extra emphasis.`);
    if (options.notes !== undefined && (typeof options.notes !== 'string' || !options.notes.trim())) throw new Error(`${path}.notes must be a non-empty string.`);
    if (options.paths !== undefined && (!Array.isArray(options.paths) || options.paths.some(item => typeof item !== 'string' || !item || item.startsWith('/') || item.includes('\\') || item.split('/').some(part => !part || part === '..' || part === '.') || /^[A-Za-z]:/.test(item)))) throw new Error(`${path}.paths must contain repository-relative file or directory paths without traversal.`);
}
