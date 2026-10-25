/** All offsets in this bridge are UTF-16 offsets into the exact TextDocument. */
export interface OffsetRange { start: number; end: number }
export interface OffsetChange { rangeOffset: number; rangeLength: number; text: string }

export function minimalEdit(before: string, after: string): OffsetChange | undefined {
    if (before === after) return undefined;
    let start = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    // Never split a surrogate pair or CRLF, even when its first unit is shared.
    if (start && (/[\uD800-\uDBFF\r]/.test(before[start - 1]))) start--;
    let end = before.length, tail = after.length;
    while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
    if (end < before.length && /[\uDC00-\uDFFF\n]/.test(before[end])) { end++; tail++; }
    return { rangeOffset: start, rangeLength: end - start, text: after.slice(start, tail) };
}

/** Keep a projection through edits, but never attach it to a replacement declaration. */
export function trackRange(range: OffsetRange, changes: readonly OffsetChange[], ownEdit = false): OffsetRange | undefined {
    let { start, end } = range;
    for (const change of [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
        const a = change.rangeOffset, b = a + change.rangeLength;
        const delta = change.text.length - change.rangeLength;
        if (b <= start && a < start) { start += delta; end += delta; }
        else if (a > end || (a === end && change.rangeLength > 0)) continue;
        else if (a >= start && b <= end && (ownEdit || a > start || b < end || change.rangeLength === 0)) end += delta;
        else return undefined;
    }
    return end > start ? { start, end } : undefined;
}

export interface FollowEditRequest { type: 'followEdit'; id: number; token: string; content: string }
export function isFollowEdit(value: unknown): value is FollowEditRequest {
    if (!value || typeof value !== 'object') return false;
    const v = value as Partial<FollowEditRequest>;
    return v.type === 'followEdit' && Number.isSafeInteger(v.id) && (v.id ?? 0) > 0
        && typeof v.token === 'string' && v.token.length < 256
        && typeof v.content === 'string';
}
