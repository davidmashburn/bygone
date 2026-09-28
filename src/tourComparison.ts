export interface TourComparisonSelectionInput {
    commits?: unknown;
    from?: unknown;
    to?: unknown;
    path?: unknown;
}

export interface TourComparisonSelection {
    commits: string[];
    path?: string;
}

export function normalizeTourComparisonSelection(
    input: TourComparisonSelectionInput | null | undefined,
    chronologicalCommits: readonly string[]
): TourComparisonSelection {
    const knownOrder = new Map<string, number>();
    for (const commit of chronologicalCommits) {
        if (!knownOrder.has(commit)) knownOrder.set(commit, knownOrder.size);
    }
    const candidateCommits = input?.commits;
    const raw = Array.isArray(candidateCommits) ? candidateCommits : [input?.from, input?.to];
    const commits = [...new Set(raw.filter(
        (commit): commit is string => typeof commit === 'string' && knownOrder.has(commit)
    ))];
    if (commits.length < 2) throw new Error('Select at least two revisions to compare.');
    commits.sort((left, right) => knownOrder.get(left)! - knownOrder.get(right)!);
    return {
        commits,
        ...(typeof input?.path === 'string' && input.path ? { path: input.path } : {})
    };
}
