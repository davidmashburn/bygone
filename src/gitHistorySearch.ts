import type { FileHistoryEntry } from './gitHistory';

export type GitHistorySearchMode = 'content' | 'change';

export type GitHistorySearchMatch = Readonly<{
    historyIndex: number;
    commit: string;
    label: string;
    sideIndex: 0 | 1;
    lineNumber: number;
    startColumn: number;
    endColumn: number;
    preview: string;
    occurrenceDelta?: number;
}>;

export function searchFileHistory(
    entries: readonly FileHistoryEntry[],
    query: string,
    mode: GitHistorySearchMode,
    options: Readonly<{ regex?: boolean; caseSensitive?: boolean; limit?: number }> = {}
): GitHistorySearchMatch[] {
    if (!query) return [];
    const limit = options.limit ?? 500;
    const expression = compileExpression(query, options);
    const matches: GitHistorySearchMatch[] = [];

    for (let historyIndex = 0; historyIndex < entries.length; historyIndex += 1) {
        const entry = entries[historyIndex];
        if (mode === 'change') {
            const leftCount = countMatches(entry.leftContent, expression);
            const rightMatches = findLineMatches(entry.rightContent, expression);
            const delta = rightMatches.length - leftCount;
            if (delta === 0) continue;
            const leftMatches = delta < 0 ? findLineMatches(entry.leftContent, expression) : [];
            const sideIndex = delta < 0 ? 0 : 1;
            const location = (sideIndex === 0 ? leftMatches[0] : rightMatches[0]) || emptyLocation();
            matches.push(toResult(entry, historyIndex, sideIndex, location, delta));
        } else {
            for (const location of findLineMatches(entry.rightContent, expression)) {
                matches.push(toResult(entry, historyIndex, 1, location));
                if (matches.length >= limit) return matches;
            }
        }
        if (matches.length >= limit) return matches;
    }
    return matches;
}

function compileExpression(query: string, options: Readonly<{ regex?: boolean; caseSensitive?: boolean }>): RegExp {
    return new RegExp(options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'g' : 'gi');
}

function findLineMatches(content: string, expression: RegExp) {
    const results: Array<{ lineNumber: number; startColumn: number; endColumn: number; preview: string }> = [];
    content.replace(/\r\n/g, '\n').split('\n').forEach((line, lineIndex) => {
        expression.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = expression.exec(line)) !== null) {
            results.push({ lineNumber: lineIndex + 1, startColumn: match.index + 1, endColumn: match.index + match[0].length + 1, preview: line });
            if (match[0].length === 0) expression.lastIndex += 1;
        }
    });
    return results;
}

function countMatches(content: string, expression: RegExp): number {
    return findLineMatches(content, expression).length;
}

function emptyLocation() {
    return { lineNumber: 1, startColumn: 1, endColumn: 1, preview: '' };
}

function toResult(
    entry: FileHistoryEntry,
    historyIndex: number,
    sideIndex: 0 | 1,
    location: ReturnType<typeof emptyLocation>,
    occurrenceDelta?: number
): GitHistorySearchMatch {
    const deltaLabel = occurrenceDelta === undefined ? '' : ` · ${occurrenceDelta > 0 ? '+' : ''}${occurrenceDelta} occurrences`;
    return {
        historyIndex,
        commit: entry.commit,
        sideIndex,
        label: `${entry.shortCommit} ${entry.summary}${deltaLabel}`.trim(),
        ...location,
        ...(occurrenceDelta === undefined ? {} : { occurrenceDelta })
    };
}
