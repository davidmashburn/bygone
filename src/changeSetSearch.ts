export type ChangeSetSnapshot = Readonly<{
    relativePath: string;
    sideIndex: number;
    label: string;
    content: string;
}>;

export type ChangeSetSearchMatch = Readonly<{
    relativePath: string;
    sideIndex: number;
    label: string;
    lineNumber: number;
    startColumn: number;
    endColumn: number;
    preview: string;
}>;

export function searchChangeSetSnapshots(
    snapshots: readonly ChangeSetSnapshot[],
    query: string,
    options: Readonly<{ regex?: boolean; caseSensitive?: boolean; limit?: number }> = {}
): ChangeSetSearchMatch[] {
    if (!query) return [];
    const limit = options.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Search limit must be a positive integer.');
    const flags = options.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(options.regex ? query : escapeRegExp(query), flags);
    const matches: ChangeSetSearchMatch[] = [];

    for (const snapshot of snapshots) {
        const lines = snapshot.content.replace(/\r\n/g, '\n').split('\n');
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            expression.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = expression.exec(lines[lineIndex])) !== null) {
                matches.push({
                    relativePath: snapshot.relativePath,
                    sideIndex: snapshot.sideIndex,
                    label: snapshot.label,
                    lineNumber: lineIndex + 1,
                    startColumn: match.index + 1,
                    endColumn: match.index + match[0].length + 1,
                    preview: lines[lineIndex]
                });
                if (matches.length >= limit) return matches;
                if (match[0].length === 0) expression.lastIndex += 1;
            }
        }
    }
    return matches;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
