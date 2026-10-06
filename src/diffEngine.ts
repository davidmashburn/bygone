import * as Diff from 'diff';

export type DiffCellKind = 'context' | 'added' | 'removed' | 'placeholder';

export interface DiffCell {
    kind: DiffCellKind;
    content: string;
    lineNumber: number | null;
}

export interface DiffRow {
    left: DiffCell;
    right: DiffCell;
}

export interface DiffLine {
    kind: Exclude<DiffCellKind, 'placeholder'>;
    content: string;
    lineNumber: number;
    segments?: DiffSegment[];
}

export interface DiffSegment {
    kind: 'context' | 'removed' | 'added';
    text: string;
    emphasis: boolean;
}

export interface DiffBlock {
    kind: 'insert' | 'delete' | 'replace';
    leftStart: number;
    leftEnd: number;
    rightStart: number;
    rightEnd: number;
    reflow?: boolean;
}

export interface TwoWayDiffModel {
    rows: DiffRow[];
    leftLines: DiffLine[];
    rightLines: DiffLine[];
    blocks: DiffBlock[];
    reflows?: DiffBlock[];
    hasChanges: boolean;
    quality: 'exact' | 'fallback';
}

export interface ThreeWayMergeModel {
    baseLines: string[];
    leftLines: string[];
    rightLines: string[];
    resultLines: string[];
    conflictCount: number;
    isExperimental: boolean;
}

interface Edit {
    start: number;
    end: number;
    newLines: string[];
}

export interface DiffBuildOptions {
    timeoutMs?: number;
}

const DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH = 500;
const DEFAULT_DIFF_TIMEOUT_MS = 100;
const MAX_INLINE_HIGHLIGHT_LINE_LENGTH = readPositiveIntegerEnv(
    'BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH',
    DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH
);
const DIFF_TIMEOUT_MS = readPositiveIntegerEnv('BYGONE_DIFF_TIMEOUT_MS', DEFAULT_DIFF_TIMEOUT_MS);

export function buildTwoWayDiffModel(
    leftContent: string,
    rightContent: string,
    options: DiffBuildOptions = {}
): TwoWayDiffModel {
    const leftLines = normalizeLines(leftContent);
    const rightLines = normalizeLines(rightContent);

    if (leftContent === rightContent) {
        return buildIdenticalTwoWayDiffModel(leftLines);
    }

    const interned = internDiffLines(leftLines, rightLines);
    const internedChanges = Diff.diffArrays(interned.left, interned.right, {
        timeout: options.timeoutMs ?? DIFF_TIMEOUT_MS
    });

    if (!internedChanges) {
        return buildConservativeTwoWayDiffModel(leftLines, rightLines);
    }

    const changes = internedChanges.map((change) => ({
        ...change,
        value: change.value.map((lineId) => interned.lines[lineId])
    }));

    const rows: DiffRow[] = [];
    const renderedLeftLines: DiffLine[] = [];
    const renderedRightLines: DiffLine[] = [];
    const blocks: DiffBlock[] = [];
    let leftLineNumber = 1;
    let rightLineNumber = 1;

    for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        const removedLines = change.removed ? change.value : [];
        const addedLines = change.added ? change.value : [];

        if (!change.added && !change.removed) {
            for (const line of change.value) {
                renderedLeftLines.push(makeDiffLine('context', line, leftLineNumber));
                renderedRightLines.push(makeDiffLine('context', line, rightLineNumber));
                rows.push(makeDiffRow(
                    makeDiffCell('context', line, leftLineNumber++),
                    makeDiffCell('context', line, rightLineNumber++)
                ));
            }
            continue;
        }

        if (change.removed && index + 1 < changes.length && changes[index + 1].added) {
            const nextChange = changes[index + 1];
            const nextLineNumbers = appendReplacementCandidate(
                removedLines,
                nextChange.value,
                leftLineNumber,
                rightLineNumber,
                rows,
                renderedLeftLines,
                renderedRightLines,
                blocks
            );
            leftLineNumber = nextLineNumbers.left;
            rightLineNumber = nextLineNumbers.right;

            index++;
            continue;
        }

        if (change.removed) {
            const leftStart = renderedLeftLines.length;
            const rightStart = renderedRightLines.length;
            for (const line of removedLines) {
                renderedLeftLines.push(makeDiffLine('removed', line, leftLineNumber));
                rows.push(makeDiffRow(
                    makeDiffCell('removed', line, leftLineNumber++),
                    makePlaceholder()
                ));
            }

            blocks.push(makeDiffBlock('delete', leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));
            continue;
        }

        if (change.added) {
            const leftStart = renderedLeftLines.length;
            const rightStart = renderedRightLines.length;
            for (const line of addedLines) {
                renderedRightLines.push(makeDiffLine('added', line, rightLineNumber));
                rows.push(makeDiffRow(
                    makePlaceholder(),
                    makeDiffCell('added', line, rightLineNumber++)
                ));
            }

            blocks.push(makeDiffBlock('insert', leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));
        }
    }

    const hasChanges = rows.some((row) => row.left.kind !== 'context' || row.right.kind !== 'context');

    return {
        rows,
        leftLines: renderedLeftLines,
        rightLines: renderedRightLines,
        blocks: mergeTouchingBlocks(blocks),
        reflows: blocks.filter(block => block.reflow),
        hasChanges,
        quality: 'exact'
    };
}

// Visual/navigation regions can merge without losing paragraph scroll anchors.
function mergeTouchingBlocks(blocks: DiffBlock[]): DiffBlock[] {
    const merged: DiffBlock[] = [];
    for (const original of blocks) {
        const block = {...original};
        delete block.reflow;
        const previous = merged[merged.length - 1];
        if (previous?.kind === block.kind && previous.leftEnd === block.leftStart
            && previous.rightEnd === block.rightStart) {
            previous.leftEnd = block.leftEnd;
            previous.rightEnd = block.rightEnd;
        } else merged.push(block);
    }
    return merged;
}

function internDiffLines(leftLines: string[], rightLines: string[]): {
    left: number[];
    right: number[];
    lines: string[];
} {
    const lineIds = new Map<string, number>();
    const lines: string[] = [];
    const intern = (line: string): number => {
        const existingId = lineIds.get(line);
        if (existingId !== undefined) {
            return existingId;
        }

        const lineId = lines.length;
        lineIds.set(line, lineId);
        lines.push(line);
        return lineId;
    };

    return {
        left: leftLines.map(intern),
        right: rightLines.map(intern),
        lines
    };
}

function buildIdenticalTwoWayDiffModel(lines: string[]): TwoWayDiffModel {
    return {
        rows: lines.map((line, index) => makeDiffRow(
            makeDiffCell('context', line, index + 1),
            makeDiffCell('context', line, index + 1)
        )),
        leftLines: lines.map((line, index) => makeDiffLine('context', line, index + 1)),
        rightLines: lines.map((line, index) => makeDiffLine('context', line, index + 1)),
        blocks: [],
        hasChanges: false,
        quality: 'exact'
    };
}

function buildConservativeTwoWayDiffModel(leftLines: string[], rightLines: string[]): TwoWayDiffModel {
    const renderedLeftLines = leftLines.map((line, index) => makeDiffLine('removed', line, index + 1));
    const renderedRightLines = rightLines.map((line, index) => makeDiffLine('added', line, index + 1));
    const rows: DiffRow[] = [
        ...leftLines.map((line, index) => makeDiffRow(
            makeDiffCell('removed', line, index + 1),
            makePlaceholder()
        )),
        ...rightLines.map((line, index) => makeDiffRow(
            makePlaceholder(),
            makeDiffCell('added', line, index + 1)
        ))
    ];

    let blockKind: DiffBlock['kind'] = 'replace';
    if (leftLines.length === 0) {
        blockKind = 'insert';
    } else if (rightLines.length === 0) {
        blockKind = 'delete';
    }

    return {
        rows,
        leftLines: renderedLeftLines,
        rightLines: renderedRightLines,
        blocks: rows.length === 0
            ? []
            : [makeDiffBlock(blockKind, 0, leftLines.length, 0, rightLines.length)],
        hasChanges: rows.length > 0,
        quality: 'fallback'
    };
}

export function mergeText(baseContent: string, leftContent: string, rightContent: string): ThreeWayMergeModel {
    const baseLines = normalizeLines(baseContent);
    const leftLines = normalizeLines(leftContent);
    const rightLines = normalizeLines(rightContent);
    const leftEdits = buildEdits(baseLines, leftLines);
    const rightEdits = buildEdits(baseLines, rightLines);

    const resultLines: string[] = [];
    let conflictCount = 0;
    let baseIndex = 0;
    let leftIndex = 0;
    let rightIndex = 0;

    while (baseIndex <= baseLines.length) {
        const leftEdit = leftEdits[leftIndex];
        const rightEdit = rightEdits[rightIndex];

        if (!leftEdit && !rightEdit) {
            if (baseIndex < baseLines.length) {
                resultLines.push(baseLines[baseIndex]);
                baseIndex++;
                continue;
            }

            break;
        }

        const nextEditStart = Math.min(
            leftEdit ? leftEdit.start : Number.POSITIVE_INFINITY,
            rightEdit ? rightEdit.start : Number.POSITIVE_INFINITY
        );

        if (baseIndex < nextEditStart) {
            resultLines.push(...baseLines.slice(baseIndex, nextEditStart));
            baseIndex = nextEditStart;
            continue;
        }

        const leftStartsHere = leftEdit && leftEdit.start === baseIndex;
        const rightStartsHere = rightEdit && rightEdit.start === baseIndex;

        if (leftStartsHere && !rightStartsHere) {
            const nextRightOverlaps = rightEdit && rightEdit.start < leftEdit.end;

            if (!nextRightOverlaps) {
                resultLines.push(...leftEdit.newLines);
                leftIndex++;
                baseIndex = leftEdit.end;
                continue;
            }
        }

        if (rightStartsHere && !leftStartsHere) {
            const nextLeftOverlaps = leftEdit && leftEdit.start < rightEdit.end;

            if (!nextLeftOverlaps) {
                resultLines.push(...rightEdit.newLines);
                rightIndex++;
                baseIndex = rightEdit.end;
                continue;
            }
        }

        if (leftStartsHere && rightStartsHere &&
            leftEdit.end === rightEdit.end &&
            linesEqual(leftEdit.newLines, rightEdit.newLines)) {
            resultLines.push(...leftEdit.newLines);
            leftIndex++;
            rightIndex++;
            baseIndex = leftEdit.end;
            continue;
        }

        if (leftStartsHere && rightStartsHere) {
            const baseSlice = baseLines.slice(baseIndex, Math.max(leftEdit.end, rightEdit.end));

            if (leftEdit.end === rightEdit.end && linesEqual(leftEdit.newLines, baseSlice)) {
                resultLines.push(...rightEdit.newLines);
                leftIndex++;
                rightIndex++;
                baseIndex = rightEdit.end;
                continue;
            }

            if (leftEdit.end === rightEdit.end && linesEqual(rightEdit.newLines, baseSlice)) {
                resultLines.push(...leftEdit.newLines);
                leftIndex++;
                rightIndex++;
                baseIndex = leftEdit.end;
                continue;
            }
        }

        const region = collectConflictRegion(baseLines, leftEdits, rightEdits, leftIndex, rightIndex, baseIndex);
        const baseSlice = baseLines.slice(region.start, region.end);

        if (linesEqual(region.leftLines, region.rightLines)) {
            resultLines.push(...region.leftLines);
        } else if (linesEqual(region.leftLines, baseSlice)) {
            resultLines.push(...region.rightLines);
        } else if (linesEqual(region.rightLines, baseSlice)) {
            resultLines.push(...region.leftLines);
        } else {
            conflictCount++;
            resultLines.push(
                '<<<<<<< LEFT',
                ...region.leftLines,
                '=======',
                ...region.rightLines,
                '>>>>>>> RIGHT'
            );
        }

        leftIndex = region.nextLeftIndex;
        rightIndex = region.nextRightIndex;
        baseIndex = region.end;
    }

    return {
        baseLines,
        leftLines,
        rightLines,
        resultLines,
        conflictCount,
        isExperimental: true
    };
}

function normalizeLines(content: string): string[] {
    if (content.length === 0) {
        return [];
    }

    const lines = content.replace(/\r\n/g, '\n').split('\n');

    if (lines[lines.length - 1] === '') {
        lines.pop();
    }

    return lines;
}

export interface AlignedReplacementLine {
    left?: string;
    right?: string;
    reflow?: { start: boolean; leftSegments?: DiffSegment[]; rightSegments?: DiffSegment[] };
}

function appendReplacementCandidate(
    leftLines: string[],
    rightLines: string[],
    initialLeftLineNumber: number,
    initialRightLineNumber: number,
    rows: DiffRow[],
    renderedLeftLines: DiffLine[],
    renderedRightLines: DiffLine[],
    blocks: DiffBlock[]
): { left: number; right: number } {
    const aligned = alignReplacementLines(leftLines, rightLines);
    const crediblePairs = aligned.filter((row) => (
        row.left !== undefined
        && row.right !== undefined
        && hasCredibleLineCorrespondence(row.left, row.right)
    )).length;
    // Paragraph units already establish their own correspondence; unmatched
    // neighboring items must remain additions/deletions even in a mostly paired hunk.
    const coherentBlock = !aligned.some(row => row.reflow)
        && hasCoherentBlockCorrespondence(leftLines, rightLines, crediblePairs);
    const normalized = aligned.flatMap((row) => {
        if (row.reflow || row.left === undefined || row.right === undefined
            || hasCredibleLineCorrespondence(row.left, row.right)) {
            return [row];
        }
        return [{ left: row.left }, { right: row.right }];
    });
    let leftLineNumber = initialLeftLineNumber;
    let rightLineNumber = initialRightLineNumber;
    let blockKind: DiffBlock['kind'] | undefined;
    let blockReflow = false;
    let blockLeftStart = renderedLeftLines.length;
    let blockRightStart = renderedRightLines.length;
    const flushBlock = (): void => {
        if (!blockKind) return;
        const block = makeDiffBlock(
            blockKind,
            blockLeftStart,
            renderedLeftLines.length,
            blockRightStart,
            renderedRightLines.length
        );
        if (blockReflow) block.reflow = true;
        blocks.push(block);
    };

    for (const { left, right, reflow } of normalized) {
        const nextKind: DiffBlock['kind'] = coherentBlock || reflow
            ? 'replace'
            : left !== undefined && right !== undefined
                ? 'replace'
                : left !== undefined ? 'delete' : 'insert';
        if (blockKind !== nextKind || blockReflow !== Boolean(reflow) || reflow?.start) {
            flushBlock();
            blockKind = nextKind;
            blockReflow = Boolean(reflow);
            blockLeftStart = renderedLeftLines.length;
            blockRightStart = renderedRightLines.length;
        }

        let renderedLeftLine: DiffLine | undefined;
        let renderedRightLine: DiffLine | undefined;
        if (left !== undefined) {
            renderedLeftLine = makeDiffLine('removed', left, leftLineNumber);
            renderedLeftLines.push(renderedLeftLine);
        }
        if (right !== undefined) {
            renderedRightLine = makeDiffLine('added', right, rightLineNumber);
            renderedRightLines.push(renderedRightLine);
        }
        if (reflow) {
            if (renderedLeftLine) renderedLeftLine.segments = reflow.leftSegments;
            if (renderedRightLine) renderedRightLine.segments = reflow.rightSegments;
        } else if (renderedLeftLine && renderedRightLine) {
            applyInlineHighlightPair(renderedLeftLine, renderedRightLine);
        } else if (coherentBlock) {
            if (renderedLeftLine) applyFullLineHighlight(renderedLeftLine);
            if (renderedRightLine) applyFullLineHighlight(renderedRightLine);
        }
        rows.push(makeDiffRow(
            left === undefined
                ? makePlaceholder()
                : makeDiffCell('removed', left, leftLineNumber++),
            right === undefined
                ? makePlaceholder()
                : makeDiffCell('added', right, rightLineNumber++)
        ));
    }
    flushBlock();
    return { left: leftLineNumber, right: rightLineNumber };
}

function hasCredibleLineCorrespondence(left: string, right: string): boolean {
    if (!left.trim() && !right.trim()) return true;
    const score = scoreReplacementLinePair(left, right);
    if (score.eligible) return true;
    const leftAnchor = declarationAnchorKey(left);
    if (leftAnchor && leftAnchor === declarationAnchorKey(right)) return true;
    const leftTokens = new Set(tokenizeMatchingContent(normalizeMatchingContent(left)).filter(isSharedContentToken));
    return tokenizeMatchingContent(normalizeMatchingContent(right))
        .some((token) => leftTokens.has(token) && isSharedContentToken(token));
}

const NON_SUBSTANTIVE_SHARED_TOKENS = new Set([
    'and', 'are', 'for', 'from', 'into', 'that', 'the', 'this', 'to', 'with'
]);

function isSharedContentToken(token: string): boolean {
    return token.length >= 3
        && /^[\p{L}\p{N}_$]+$/u.test(token)
        && !NON_SUBSTANTIVE_SHARED_TOKENS.has(token);
}

function hasCoherentBlockCorrespondence(
    leftLines: string[],
    rightLines: string[],
    crediblePairs: number
): boolean {
    if (crediblePairs === 0) return false;
    const longestSide = Math.max(leftLines.length, rightLines.length);
    if (longestSide <= 2 || crediblePairs * 2 >= longestSide) return true;
    const roles = [...leftLines, ...rightLines].map(collectionLineRole);
    return roles[0] !== null && roles.every((role) => role === roles[0]);
}

function collectionLineRole(line: string): 'bullet' | 'ordered' | 'quote' | null {
    const normalized = line.trimStart();
    if (/^[-*+]\s+/.test(normalized)) return 'bullet';
    if (/^\d+[.)]\s+/.test(normalized)) return 'ordered';
    if (/^>\s+/.test(normalized)) return 'quote';
    return null;
}

export interface ReplacementLineScore {
    score: number;
    eligible: boolean;
    characterSimilarity: number;
    tokenSimilarity: number;
    lengthSimilarity: number;
}

const MAX_ALIGNMENT_CELLS = 10_000;
const MAX_SCORING_LINE_LENGTH = 2_000;
const MINIMUM_MATCH_SCORE = 0.52;
const MINIMUM_SINGLE_PAIR_SCORE = 0.35;
const MINIMUM_CONTEXTUAL_MATCH_SCORE = 0.38;
const MINIMUM_CONTEXTUAL_RUN_SCORE = 0.33;
const HIGH_CONFIDENCE_MATCH_SCORE = 0.86;
const AMBIGUITY_MARGIN = 0.08;
const CONTEXTUAL_AMBIGUITY_MARGIN = 0.05;
const GAP_PENALTY = -0.12;
const MAX_BOUNDED_CANDIDATES = 5_000;
const MAX_LARGE_HUNK_ANCHORS = 2_000;
const MAX_ALIGNMENT_CHARACTER_CELLS = 50_000_000;
const MAX_RARE_TOKEN_OCCURRENCES = 4;
const MAX_CONTEXTUAL_HUNK_LINES = 8;
const MAX_CONTEXTUAL_LENGTH_DELTA = 4;

// Treat indented scalar/list continuations as a unit when physical wrapping
// changes. Blank lines, new keys/items, and block scalar headers are boundaries.
function wrappedTextUnits(lines: string[]): string[] {
    const units: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        const first = lines[index];
        const paragraph = [first];
        const start = first.match(/^(\s*)(?:[\w-]+:\s+|[-*+]\s+)(\S.*)$/);
        if (start && !/^[|>\[{]/.test(start[2])) {
            while (index + 1 < lines.length) {
                const next = lines[index + 1];
                if (!next.trim() || next.length - next.trimStart().length <= start[1].length
                    || /^\s*(?:[\w-]+:|[-*+]\s|\d+[.)]\s|#)/.test(next)) break;
                paragraph.push(next);
                index++;
            }
        }
        units.push(paragraph.join('\n'));
    }
    return units;
}

export function alignReplacementLines(leftLines: string[], rightLines: string[]): AlignedReplacementLine[] {
    // Joined units must not be regrouped by recursive alignment of bounded gaps.
    if ([...leftLines, ...rightLines].some(line => line.includes('\n'))) {
        return alignPhysicalReplacementLines(leftLines, rightLines);
    }
    const leftUnits = wrappedTextUnits(leftLines);
    const rightUnits = wrappedTextUnits(rightLines);
    if (leftUnits.length === leftLines.length && rightUnits.length === rightLines.length) {
        return alignPhysicalReplacementLines(leftLines, rightLines);
    }
    return alignPhysicalReplacementLines(leftUnits, rightUnits).flatMap(row => {
        const left = row.left?.split('\n') || [];
        const right = row.right?.split('\n') || [];
        if (!left.length || !right.length) {
            return [...left.map(left => ({left})), ...right.map(right => ({right}))];
        }
        if (left.length === 1 && right.length === 1) return [row];
        const whitespace = buildWhitespaceOnlySegments(row.left!, row.right!);
        // Bound the word diff for substantive edits; whitespace-only reflows
        // remain linear even for very large paragraphs.
        const segments = whitespace || (row.left!.length + row.right!.length <= 20_000
            ? buildInlineSegments(row.left!, row.right!) : undefined);
        const leftSegments = segments && splitSegmentsIntoLines(segments.leftSegments);
        const rightSegments = segments && splitSegmentsIntoLines(segments.rightSegments);
        return Array.from({length: Math.max(left.length, right.length)}, (_, index) => ({
            left: left[index], right: right[index],
            reflow: {start: index === 0, leftSegments: leftSegments?.[index], rightSegments: rightSegments?.[index]}
        }));
    });
}

function alignPhysicalReplacementLines(leftLines: string[], rightLines: string[]): AlignedReplacementLine[] {
    if (leftLines.length === 0) {
        return rightLines.map((right) => ({ right }));
    }
    if (rightLines.length === 0) {
        return leftLines.map((left) => ({ left }));
    }
    // Keep matching boundary lines outside a reflow so scroll correspondence
    // changes only where physical line breaks actually changed.
    let prefix = 0;
    while (prefix < Math.min(leftLines.length, rightLines.length)
        && leftLines[prefix].trim() === rightLines[prefix].trim()) prefix++;
    if (prefix) {
        return [
            ...leftLines.slice(0, prefix).map((left, index) => ({ left, right: rightLines[index] })),
            ...alignReplacementLines(leftLines.slice(prefix), rightLines.slice(prefix))
        ];
    }
    // Recognize the smallest whitespace-equivalent prefix, even when followed
    // by substantive edits, without character similarity on long prose.
    let leftEnd = 1;
    let rightEnd = 1;
    let leftText = leftLines[0].trim().replace(/\s+/g, ' ');
    let rightText = rightLines[0].trim().replace(/\s+/g, ' ');
    while (leftText && rightText && leftText !== rightText) {
        if (rightText.startsWith(leftText + ' ') && leftEnd < leftLines.length) {
            leftText += ' ' + leftLines[leftEnd++].trim().replace(/\s+/g, ' ');
        } else if (leftText.startsWith(rightText + ' ') && rightEnd < rightLines.length) {
            rightText += ' ' + rightLines[rightEnd++].trim().replace(/\s+/g, ' ');
        } else break;
    }
    if (leftText === rightText && (leftEnd > 1 || rightEnd > 1)
        && ![...leftLines, ...rightLines].some(line => line.includes('\n'))) {
        const reflow = buildWhitespaceOnlySegments(leftLines.slice(0, leftEnd).join('\n'), rightLines.slice(0, rightEnd).join('\n'));
        if (reflow) {
            const leftSegments = splitSegmentsIntoLines(reflow.leftSegments);
            const rightSegments = splitSegmentsIntoLines(reflow.rightSegments);
            return [
                ...Array.from({ length: Math.max(leftEnd, rightEnd) }, (_, index) => ({
                    left: index < leftEnd ? leftLines[index] : undefined,
                    right: index < rightEnd ? rightLines[index] : undefined,
                    reflow: { start: index === 0, leftSegments: leftSegments[index], rightSegments: rightSegments[index] }
                })),
                ...alignReplacementLines(leftLines.slice(leftEnd), rightLines.slice(rightEnd))
            ];
        }
    }
    const leftCharacterCount = leftLines.reduce((total, line) => total + Math.min(line.length, MAX_SCORING_LINE_LENGTH), 0);
    const rightCharacterCount = rightLines.reduce((total, line) => total + Math.min(line.length, MAX_SCORING_LINE_LENGTH), 0);
    if (leftCharacterCount * rightCharacterCount > MAX_ALIGNMENT_CHARACTER_CELLS) {
        // Reindentation can make a large hunk without requiring fuzzy scoring.
        // Split at cheap normalized matches, then score only bounded gaps.
        return alignLargeReplacementLines(leftLines, rightLines, true);
    }
    if (leftLines.length === 1 && rightLines.length === 1) {
        const singletonScore = scoreReplacementLinePair(leftLines[0], rightLines[0]);
        if ((!leftLines[0].trim() && !rightLines[0].trim()) || ((singletonScore.eligible || singletonScore.score >= MINIMUM_SINGLE_PAIR_SCORE)
            && hasCredibleLineCorrespondence(leftLines[0], rightLines[0])
            && haveCompatibleLineRoles(leftLines[0], rightLines[0])
            && isInformativeLine(normalizeMatchingContent(leftLines[0]))
            && isInformativeLine(normalizeMatchingContent(rightLines[0])))) {
            return [{ left: leftLines[0], right: rightLines[0] }];
        }
        return [{ left: leftLines[0] }, { right: rightLines[0] }];
    }
    if (leftLines.length * rightLines.length > MAX_ALIGNMENT_CELLS) {
        return alignLargeReplacementLines(leftLines, rightLines);
    }

    const pairScores = buildPairScores(leftLines, rightLines);
    const scores = Array.from(
        { length: leftLines.length + 1 },
        () => new Array<number>(rightLines.length + 1).fill(Number.NEGATIVE_INFINITY)
    );
    const moves = Array.from(
        { length: leftLines.length + 1 },
        () => new Array<'match' | 'left' | 'right' | null>(rightLines.length + 1).fill(null)
    );
    scores[0][0] = 0;

    for (let leftIndex = 1; leftIndex <= leftLines.length; leftIndex++) {
        scores[leftIndex][0] = scores[leftIndex - 1][0] + GAP_PENALTY;
        moves[leftIndex][0] = 'left';
    }
    for (let rightIndex = 1; rightIndex <= rightLines.length; rightIndex++) {
        scores[0][rightIndex] = scores[0][rightIndex - 1] + GAP_PENALTY;
        moves[0][rightIndex] = 'right';
    }

    for (let leftIndex = 1; leftIndex <= leftLines.length; leftIndex++) {
        for (let rightIndex = 1; rightIndex <= rightLines.length; rightIndex++) {
            const pairScore = pairScores[leftIndex - 1][rightIndex - 1];
            const candidates = [
                { move: 'left' as const, score: scores[leftIndex - 1][rightIndex] + GAP_PENALTY },
                { move: 'right' as const, score: scores[leftIndex][rightIndex - 1] + GAP_PENALTY },
                {
                    move: 'match' as const,
                    score: pairScore === null
                        ? Number.NEGATIVE_INFINITY
                        : scores[leftIndex - 1][rightIndex - 1] + pairScore
                }
            ];
            const best = candidates.reduce((current, candidate) => (
                candidate.score > current.score ? candidate : current
            ));
            scores[leftIndex][rightIndex] = best.score;
            moves[leftIndex][rightIndex] = best.move;
        }
    }

    const aligned: AlignedReplacementLine[] = [];
    let leftIndex = leftLines.length;
    let rightIndex = rightLines.length;
    while (leftIndex > 0 || rightIndex > 0) {
        const move = moves[leftIndex][rightIndex];
        if (move === 'match') {
            aligned.push({ left: leftLines[--leftIndex], right: rightLines[--rightIndex] });
        } else if (move === 'left') {
            aligned.push({ left: leftLines[--leftIndex] });
        } else {
            aligned.push({ right: rightLines[--rightIndex] });
        }
    }

    return aligned.reverse();
}

export function scoreReplacementLinePair(left: string, right: string): ReplacementLineScore {
    const normalizedLeft = normalizeMatchingContent(left);
    const normalizedRight = normalizeMatchingContent(right);
    const leftInformative = isInformativeLine(normalizedLeft);
    const rightInformative = isInformativeLine(normalizedRight);

    if (leftInformative && rightInformative && normalizedLeft === normalizedRight) {
        return {
            score: 1,
            eligible: true,
            characterSimilarity: 1,
            tokenSimilarity: 1,
            lengthSimilarity: 1
        };
    }

    if (!leftInformative || !rightInformative) {
        return {
            score: 0,
            eligible: false,
            characterSimilarity: 0,
            tokenSimilarity: 0,
            lengthSimilarity: 0
        };
    }

    const leftTokens = tokenizeMatchingContent(normalizedLeft);
    const rightTokens = tokenizeMatchingContent(normalizedRight);
    // Sample across long lines to bound character diff cost; token evidence still
    // covers the entire line, so a shared prefix alone cannot force a match.
    const sample = (text: string): string => text.length <= MAX_SCORING_LINE_LENGTH ? text
        : [0, Math.floor(text.length / 2) - 300, text.length - 600].map(start => text.slice(start, start + 600)).join(' ');
    const characterSimilarity = lineSimilarity(sample(normalizedLeft), sample(normalizedRight));
    const tokenSimilarity = multisetDiceSimilarity(leftTokens, rightTokens);
    const lengthSimilarity = Math.min(normalizedLeft.length, normalizedRight.length)
        / Math.max(normalizedLeft.length, normalizedRight.length);
    const boundarySimilarity = tokenBoundarySimilarity(leftTokens, rightTokens);
    // A complete field/assignment name is useful evidence independently of
    // neighboring matches. Keywords and punctuation alone earn no bonus.
    const prefix = (text: string): string | undefined => text
        .match(/^(?:(?:const|let|var)\s+)?([\p{L}_$][\p{L}\p{N}_$.-]*\s*(?::|=(?!=)))\s*/u)?.[1].replace(/\s+/g, '');
    const leftPrefix = prefix(normalizedLeft);
    const prefixBonus = leftPrefix && leftPrefix === prefix(normalizedRight) ? 0.12 : 0;
    const score = Math.min(1, (characterSimilarity * 0.52)
        + (tokenSimilarity * 0.32)
        + (lengthSimilarity * 0.10)
        + (boundarySimilarity * 0.06) + prefixBonus);
    const hasContentEvidence = prefixBonus > 0 || characterSimilarity >= 0.52
        || tokenSimilarity >= 0.45
        || (characterSimilarity >= 0.48 && tokenSimilarity >= 0.28);

    return {
        score,
        eligible: hasContentEvidence && score >= MINIMUM_MATCH_SCORE,
        characterSimilarity,
        tokenSimilarity,
        lengthSimilarity
    };
}

function buildPairScores(leftLines: string[], rightLines: string[]): Array<Array<number | null>> {
    const scored = leftLines.map((left) => rightLines.map((right) => scoreReplacementLinePair(left, right)));
    const structuralPairs = collectUniqueStructuralPairs(leftLines, rightLines);
    const leftRankings = scored.map((row) => rankEligibleScores(row));
    const rightRankings = rightLines.map((_right, rightIndex) => (
        rankEligibleScores(scored.map((row) => row[rightIndex]))
    ));
    const accepted = scored.map((row, leftIndex) => row.map((candidate, rightIndex) => {
        if (structuralPairs.has(`${leftIndex}:${rightIndex}`)) {
            return Math.max(candidate.score, 1);
        }
        if (!candidate.eligible) {
            return null;
        }

        const leftRanking = leftRankings[leftIndex];
        const rightRanking = rightRankings[rightIndex];
        const isBestOnBothSides = candidate.score === leftRanking.best
            && candidate.score === rightRanking.best;
        const requiredMargin = candidate.score >= HIGH_CONFIDENCE_MATCH_SCORE
            ? AMBIGUITY_MARGIN / 2
            : AMBIGUITY_MARGIN;
        const hasLeftMargin = leftRanking.best - leftRanking.second >= requiredMargin;
        const hasRightMargin = rightRanking.best - rightRanking.second >= requiredMargin;
        return isBestOnBothSides && hasLeftMargin && hasRightMargin ? candidate.score : null;
    }));

    if (Math.max(leftLines.length, rightLines.length) > MAX_CONTEXTUAL_HUNK_LINES
        || Math.abs(leftLines.length - rightLines.length) > MAX_CONTEXTUAL_LENGTH_DELTA) {
        return accepted;
    }

    const isContextualCandidate = (candidate: ReplacementLineScore, leftIndex: number, rightIndex: number) => (
        candidate.score >= MINIMUM_CONTEXTUAL_MATCH_SCORE
        && haveCompatibleLineRoles(leftLines[leftIndex], rightLines[rightIndex])
        && Math.abs(leftIndex - rightIndex) <= MAX_CONTEXTUAL_LENGTH_DELTA
    );
    const leftContextRankings = scored.map((row, leftIndex) => (
        rankScores(row, (candidate, rightIndex) => isContextualCandidate(candidate, leftIndex, rightIndex))
    ));
    const rightContextRankings = rightLines.map((_right, rightIndex) => (
        rankScores(
            scored.map((row) => row[rightIndex]),
            (candidate, leftIndex) => isContextualCandidate(candidate, leftIndex, rightIndex)
        )
    ));
    const isWeakRunCandidate = (candidate: ReplacementLineScore, leftIndex: number, rightIndex: number) => (
        candidate.score >= MINIMUM_CONTEXTUAL_RUN_SCORE
        && haveCompatibleLineRoles(leftLines[leftIndex], rightLines[rightIndex])
        && Math.abs(leftIndex - rightIndex) <= MAX_CONTEXTUAL_LENGTH_DELTA
    );
    const leftWeakRankings = scored.map((row, leftIndex) => (
        rankScores(row, (candidate, rightIndex) => isWeakRunCandidate(candidate, leftIndex, rightIndex))
    ));
    const rightWeakRankings = rightLines.map((_right, rightIndex) => (
        rankScores(
            scored.map((row) => row[rightIndex]),
            (candidate, leftIndex) => isWeakRunCandidate(candidate, leftIndex, rightIndex)
        )
    ));

    const isUnambiguousContextualCandidate = (leftIndex: number, rightIndex: number): boolean => {
        const candidate = scored[leftIndex][rightIndex];
        if (!isContextualCandidate(candidate, leftIndex, rightIndex)) {
            return false;
        }
        const leftRanking = leftContextRankings[leftIndex];
        const rightRanking = rightContextRankings[rightIndex];
        return candidate.score === leftRanking.best
            && candidate.score === rightRanking.best
            && leftRanking.best - leftRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN
            && rightRanking.best - rightRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN;
    };
    const isUnambiguousWeakRunAnchor = (leftIndex: number, rightIndex: number): boolean => {
        const candidate = scored[leftIndex][rightIndex];
        if (!isWeakRunCandidate(candidate, leftIndex, rightIndex)) {
            return false;
        }
        const leftRanking = leftWeakRankings[leftIndex];
        const rightRanking = rightWeakRankings[rightIndex];
        return candidate.score === leftRanking.best
            && candidate.score === rightRanking.best
            && leftRanking.best - leftRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN
            && rightRanking.best - rightRanking.second >= CONTEXTUAL_AMBIGUITY_MARGIN;
    };

    return accepted.map((row, leftIndex) => row.map((acceptedScore, rightIndex) => {
        if (acceptedScore !== null) {
            return acceptedScore;
        }
        const hasLocalSupport = isUnambiguousContextualCandidate(leftIndex, rightIndex)
            && (hasAcceptedDiagonalNeighbor(accepted, leftIndex, rightIndex)
                || hasContextualDiagonalNeighbor(
                    scored,
                    leftIndex,
                    rightIndex,
                    isUnambiguousContextualCandidate
                ));
        const hasRunSupport = hasAnchoredWeakDiagonalRun(
            scored,
            leftIndex,
            rightIndex,
            (candidateLeftIndex, candidateRightIndex) => isWeakRunCandidate(
                scored[candidateLeftIndex][candidateRightIndex],
                candidateLeftIndex,
                candidateRightIndex
            ),
            isUnambiguousWeakRunAnchor
        );
        if (!hasLocalSupport && !hasRunSupport) {
            return null;
        }
        return scored[leftIndex][rightIndex].score;
    }));
}

function hasAcceptedDiagonalNeighbor(
    accepted: Array<Array<number | null>>,
    leftIndex: number,
    rightIndex: number
): boolean {
    return (leftIndex > 0 && rightIndex > 0 && accepted[leftIndex - 1][rightIndex - 1] !== null)
        || (leftIndex + 1 < accepted.length
            && rightIndex + 1 < accepted[leftIndex + 1].length
            && accepted[leftIndex + 1][rightIndex + 1] !== null);
}

function hasContextualDiagonalNeighbor(
    scored: ReplacementLineScore[][],
    leftIndex: number,
    rightIndex: number,
    isCandidate: (leftIndex: number, rightIndex: number) => boolean
): boolean {
    return (leftIndex > 0 && rightIndex > 0 && isCandidate(leftIndex - 1, rightIndex - 1))
        || (leftIndex + 1 < scored.length
            && rightIndex + 1 < scored[leftIndex + 1].length
            && isCandidate(leftIndex + 1, rightIndex + 1));
}

function hasAnchoredWeakDiagonalRun(
    scored: ReplacementLineScore[][],
    leftIndex: number,
    rightIndex: number,
    isCandidate: (leftIndex: number, rightIndex: number) => boolean,
    isAnchor: (leftIndex: number, rightIndex: number) => boolean
): boolean {
    let startLeft = leftIndex;
    let startRight = rightIndex;
    while (startLeft > 0 && startRight > 0 && isCandidate(startLeft - 1, startRight - 1)) {
        startLeft--;
        startRight--;
    }

    let endLeft = leftIndex;
    let endRight = rightIndex;
    let scoreTotal = scored[leftIndex][rightIndex].score;
    let length = 1;
    while (endLeft + 1 < scored.length
        && endRight + 1 < scored[endLeft + 1].length
        && isCandidate(endLeft + 1, endRight + 1)) {
        endLeft++;
        endRight++;
        scoreTotal += scored[endLeft][endRight].score;
        length++;
    }
    for (let scanLeft = leftIndex - 1, scanRight = rightIndex - 1;
        scanLeft >= startLeft && scanRight >= startRight;
        scanLeft--, scanRight--) {
        scoreTotal += scored[scanLeft][scanRight].score;
        length++;
    }

    return length >= 3
        && scoreTotal / length >= MINIMUM_CONTEXTUAL_MATCH_SCORE
        && isAnchor(startLeft, startRight)
        && isAnchor(endLeft, endRight);
}

function rankScores(
    scores: ReplacementLineScore[],
    include: (candidate: ReplacementLineScore, index: number) => boolean
): { best: number; second: number } {
    let best = Number.NEGATIVE_INFINITY;
    let second = Number.NEGATIVE_INFINITY;
    scores.forEach((candidate, index) => {
        if (!include(candidate, index)) {
            return;
        }
        if (candidate.score > best) {
            second = best;
            best = candidate.score;
        } else if (candidate.score > second) {
            second = candidate.score;
        }
    });
    return { best, second };
}

function rankEligibleScores(scores: ReplacementLineScore[]): { best: number; second: number } {
    let best = Number.NEGATIVE_INFINITY;
    let second = Number.NEGATIVE_INFINITY;
    for (const candidate of scores) {
        if (!candidate.eligible) {
            continue;
        }
        if (candidate.score > best) {
            second = best;
            best = candidate.score;
        } else if (candidate.score > second) {
            second = candidate.score;
        }
    }
    return { best, second };
}

function alignLargeReplacementLines(
    leftLines: string[],
    rightLines: string[],
    exactOnly = false
): AlignedReplacementLine[] {
    const anchors = collectLargeHunkAnchors(leftLines, rightLines, exactOnly);
    if (anchors.length === 0) {
        return [...leftLines.map((left) => ({ left })), ...rightLines.map((right) => ({ right }))];
    }
    const aligned: AlignedReplacementLine[] = [];
    let leftStart = 0;
    let rightStart = 0;

    for (const anchor of anchors) {
        appendBoundedSegment(
            aligned,
            leftLines.slice(leftStart, anchor.leftIndex),
            rightLines.slice(rightStart, anchor.rightIndex)
        );
        aligned.push({ left: leftLines[anchor.leftIndex], right: rightLines[anchor.rightIndex] });
        leftStart = anchor.leftIndex + 1;
        rightStart = anchor.rightIndex + 1;
    }
    appendBoundedSegment(aligned, leftLines.slice(leftStart), rightLines.slice(rightStart));
    return aligned;
}

function collectLargeHunkAnchors(
    leftLines: string[],
    rightLines: string[],
    exactOnly: boolean
): Array<{ leftIndex: number; rightIndex: number }> {
    const candidatePairs = collectRareTokenCandidatePairs(leftLines, rightLines, exactOnly);
    if (candidatePairs === null) {
        return [];
    }
    const structuralPairs = collectUniqueStructuralPairs(leftLines, rightLines);
    const scored = candidatePairs
        .map(({ leftIndex, rightIndex, exact }) => ({
            leftIndex,
            rightIndex,
            exact,
            structural: structuralPairs.has(`${leftIndex}:${rightIndex}`),
            match: scoreReplacementLinePair(leftLines[leftIndex], rightLines[rightIndex])
        }))
        .filter((candidate) => candidate.exact || candidate.structural || candidate.match.eligible);
    const leftRankings = rankAnchorCandidates(scored, 'leftIndex');
    const rightRankings = rankAnchorCandidates(scored, 'rightIndex');
    const confident = scored.filter((candidate) => {
        if (candidate.exact || candidate.structural) {
            return true;
        }
        const leftRanking = leftRankings.get(candidate.leftIndex);
        const rightRanking = rightRankings.get(candidate.rightIndex);
        if (!leftRanking || !rightRanking
            || candidate.match.score !== leftRanking.best
            || candidate.match.score !== rightRanking.best) {
            return false;
        }
        const requiredMargin = candidate.match.score >= HIGH_CONFIDENCE_MATCH_SCORE
            ? AMBIGUITY_MARGIN / 2
            : AMBIGUITY_MARGIN;
        return leftRanking.best - leftRanking.second >= requiredMargin
            && rightRanking.best - rightRanking.second >= requiredMargin;
    });
    const anchors = selectMaximumWeightMonotonicAnchors(confident, rightLines.length);
    return anchors.length <= MAX_LARGE_HUNK_ANCHORS ? anchors : [];
}

interface ReplacementAnchorCandidate {
    leftIndex: number;
    rightIndex: number;
    exact: boolean;
    structural: boolean;
    match: ReplacementLineScore;
}

function collectRareTokenCandidatePairs(
    leftLines: string[],
    rightLines: string[],
    exactOnly: boolean
): Array<{ leftIndex: number; rightIndex: number; exact: boolean }> | null {
    const leftExact = buildLinePostings(leftLines, normalizeMatchingContent);
    const rightExact = buildLinePostings(rightLines, normalizeMatchingContent);
    const pairs = new Map<string, { leftIndex: number; rightIndex: number; exact: boolean }>();

    for (const [line, leftIndices] of leftExact) {
        const rightIndices = rightExact.get(line);
        if (!isInformativeLine(line) || leftIndices.length !== 1 || rightIndices?.length !== 1) {
            continue;
        }
        const leftIndex = leftIndices[0];
        const rightIndex = rightIndices[0];
        pairs.set(`${leftIndex}:${rightIndex}`, { leftIndex, rightIndex, exact: true });
        if (pairs.size > MAX_BOUNDED_CANDIDATES) {
            return null;
        }
    }

    if (exactOnly) {
        return [...pairs.values()];
    }

    const leftTokens = buildTokenPostings(leftLines);
    const rightTokens = buildTokenPostings(rightLines);
    for (const [token, leftIndices] of leftTokens) {
        const rightIndices = rightTokens.get(token);
        if (!rightIndices
            || leftIndices.length > MAX_RARE_TOKEN_OCCURRENCES
            || rightIndices.length > MAX_RARE_TOKEN_OCCURRENCES) {
            continue;
        }
        for (const leftIndex of leftIndices) {
            for (const rightIndex of rightIndices) {
                const key = `${leftIndex}:${rightIndex}`;
                if (!pairs.has(key)) {
                    pairs.set(key, { leftIndex, rightIndex, exact: false });
                    if (pairs.size > MAX_BOUNDED_CANDIDATES) {
                        return null;
                    }
                }
            }
        }
    }
    return [...pairs.values()];
}

function buildLinePostings(
    lines: string[],
    keyForLine: (line: string) => string
): Map<string, number[]> {
    const postings = new Map<string, number[]>();
    lines.forEach((line, index) => {
        const key = keyForLine(line);
        const indices = postings.get(key) ?? [];
        indices.push(index);
        postings.set(key, indices);
    });
    return postings;
}

function buildTokenPostings(lines: string[]): Map<string, number[]> {
    const postings = new Map<string, number[]>();
    lines.forEach((line, index) => {
        const tokens = new Set(tokenizeMatchingContent(normalizeMatchingContent(line)).filter(isMeaningfulAnchorToken));
        for (const token of tokens) {
            const indices = postings.get(token) ?? [];
            indices.push(index);
            postings.set(token, indices);
        }
    });
    return postings;
}

function isMeaningfulAnchorToken(token: string): boolean {
    return token.length >= 2 && /[\p{L}\p{N}_$]/u.test(token);
}

function rankAnchorCandidates(
    candidates: ReplacementAnchorCandidate[],
    indexKey: 'leftIndex' | 'rightIndex'
): Map<number, { best: number; second: number }> {
    const grouped = new Map<number, ReplacementLineScore[]>();
    for (const candidate of candidates) {
        const scores = grouped.get(candidate[indexKey]) ?? [];
        scores.push(candidate.match);
        grouped.set(candidate[indexKey], scores);
    }
    return new Map([...grouped].map(([index, scores]) => [index, rankEligibleScores(scores)]));
}

function selectMaximumWeightMonotonicAnchors(
    candidates: ReplacementAnchorCandidate[],
    rightLength: number
): Array<{ leftIndex: number; rightIndex: number }> {
    const ordered = [...candidates].sort((left, right) => (
        left.leftIndex - right.leftIndex || left.rightIndex - right.rightIndex
    ));
    const treeScores = new Array<number>(rightLength + 2).fill(0);
    const treeCandidates = new Array<number>(rightLength + 2).fill(-1);
    const bestScores = new Array<number>(ordered.length).fill(0);
    const previous = new Array<number>(ordered.length).fill(-1);

    for (let start = 0; start < ordered.length;) {
        let end = start + 1;
        while (end < ordered.length && ordered[end].leftIndex === ordered[start].leftIndex) {
            end++;
        }
        for (let index = start; index < end; index++) {
            const prior = queryAnchorTree(treeScores, treeCandidates, ordered[index].rightIndex);
            const anchorBonus = ordered[index].exact || ordered[index].structural ? 0.5 : 0;
            bestScores[index] = prior.score + ordered[index].match.score + anchorBonus;
            previous[index] = prior.candidateIndex;
        }
        for (let index = start; index < end; index++) {
            updateAnchorTree(
                treeScores,
                treeCandidates,
                ordered[index].rightIndex + 1,
                bestScores[index],
                index
            );
        }
        start = end;
    }

    const best = queryAnchorTree(treeScores, treeCandidates, rightLength + 1);
    const anchors: Array<{ leftIndex: number; rightIndex: number }> = [];
    for (let index = best.candidateIndex; index >= 0; index = previous[index]) {
        anchors.push({ leftIndex: ordered[index].leftIndex, rightIndex: ordered[index].rightIndex });
    }
    return anchors.reverse();
}

function queryAnchorTree(
    scores: number[],
    candidates: number[],
    position: number
): { score: number; candidateIndex: number } {
    let score = 0;
    let candidateIndex = -1;
    for (let index = position; index > 0; index -= index & -index) {
        if (scores[index] > score) {
            score = scores[index];
            candidateIndex = candidates[index];
        }
    }
    return { score, candidateIndex };
}

function updateAnchorTree(
    scores: number[],
    candidates: number[],
    position: number,
    score: number,
    candidateIndex: number
): void {
    for (let index = position; index < scores.length; index += index & -index) {
        if (score > scores[index]) {
            scores[index] = score;
            candidates[index] = candidateIndex;
        }
    }
}

function appendBoundedSegment(
    aligned: AlignedReplacementLine[],
    leftLines: string[],
    rightLines: string[]
): void {
    if (leftLines.length * rightLines.length <= MAX_ALIGNMENT_CELLS) {
        aligned.push(...alignReplacementLines(leftLines, rightLines));
        return;
    }
    aligned.push(...leftLines.map((left) => ({ left })));
    aligned.push(...rightLines.map((right) => ({ right })));
}

function normalizeMatchingContent(line: string): string {
    return line.trim().replace(/\s+/g, ' ');
}

function collectUniqueStructuralPairs(leftLines: string[], rightLines: string[]): Set<string> {
    const leftPostings = buildStructuralPostings(leftLines);
    const rightPostings = buildStructuralPostings(rightLines);
    const pairs = new Set<string>();
    for (const [key, leftIndices] of leftPostings) {
        const rightIndices = rightPostings.get(key);
        if (leftIndices.length === 1 && rightIndices?.length === 1) {
            pairs.add(`${leftIndices[0]}:${rightIndices[0]}`);
        }
    }
    return pairs;
}

function buildStructuralPostings(lines: string[]): Map<string, number[]> {
    const postings = new Map<string, number[]>();
    lines.forEach((line, index) => {
        const key = declarationAnchorKey(line);
        if (!key) {
            return;
        }
        const indices = postings.get(key) ?? [];
        indices.push(index);
        postings.set(key, indices);
    });
    return postings;
}

function haveCompatibleLineRoles(left: string, right: string): boolean {
    const leftKey = declarationAnchorKey(left);
    const rightKey = declarationAnchorKey(right);
    if (!leftKey || !rightKey) {
        return leftKey === rightKey;
    }
    return leftKey.split(':', 1)[0] === rightKey.split(':', 1)[0];
}

function declarationAnchorKey(line: string): string | null {
    const normalized = normalizeMatchingContent(line);
    const patterns: Array<[string, RegExp]> = [
        ['function', /^(?:(?:export|default)\s+)*(?:async\s+)?function\s*\*?\s*([\p{L}_$][\p{L}\p{N}_$]*)\s*\(/u],
        ['function', /^(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u],
        ['function', /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([\p{L}_][\p{L}\p{N}_]*)\s*(?:<[^>]*>)?\s*\(/u],
        ['function', /^func\s+(?:\([^)]*\)\s*)?([\p{L}_][\p{L}\p{N}_]*)\s*\(/u],
        ['class', /^(?:(?:export|default|abstract|public)\s+)*class\s+([\p{L}_$][\p{L}\p{N}_$]*)\b/u]
    ];
    for (const [kind, pattern] of patterns) {
        const match = normalized.match(pattern);
        if (match) {
            return `${kind}:${match[1]}`;
        }
    }
    return null;
}

function isInformativeLine(line: string): boolean {
    if (line.length < 3) {
        return false;
    }
    return /[\p{L}\p{N}_$]/u.test(line)
        && !/^[\s()[\]{};,.:+\-*/=>|&!?'"`]+$/.test(line);
}

function tokenizeMatchingContent(line: string): string[] {
    return line.toLowerCase().match(/[\p{L}_$][\p{L}\p{N}_$]*|\p{N}+(?:\.\p{N}+)?|[^\s\p{L}\p{N}_$]/gu) ?? [];
}

function multisetDiceSimilarity(leftTokens: string[], rightTokens: string[]): number {
    if (leftTokens.length + rightTokens.length === 0) {
        return 1;
    }
    const remaining = new Map<string, number>();
    leftTokens.forEach((token) => remaining.set(token, (remaining.get(token) ?? 0) + 1));
    let common = 0;
    for (const token of rightTokens) {
        const count = remaining.get(token) ?? 0;
        if (count > 0) {
            common++;
            remaining.set(token, count - 1);
        }
    }
    return (2 * common) / (leftTokens.length + rightTokens.length);
}

function tokenBoundarySimilarity(leftTokens: string[], rightTokens: string[]): number {
    if (leftTokens.length === 0 || rightTokens.length === 0) {
        return 0;
    }
    const sameStart = leftTokens[0] === rightTokens[0] ? 0.5 : 0;
    const sameEnd = leftTokens[leftTokens.length - 1] === rightTokens[rightTokens.length - 1] ? 0.5 : 0;
    return sameStart + sameEnd;
}

function lineSimilarity(left: string, right: string): number {
    const maxLength = left.length + right.length;
    if (maxLength === 0) {
        return 1;
    }
    const commonLength = Diff.diffChars(left, right)
        .filter((change) => !change.added && !change.removed)
        .reduce((total, change) => total + change.value.length, 0);
    return (2 * commonLength) / maxLength;
}

function applyInlineHighlightPair(leftLine: DiffLine, rightLine: DiffLine): void {
    // Whitespace-only changes need no quadratic diff, even on very long lines.
    const whitespace = buildWhitespaceOnlySegments(leftLine.content, rightLine.content);
    if (whitespace) {
        if (leftLine.content !== rightLine.content) {
            leftLine.segments = whitespace.leftSegments;
            rightLine.segments = whitespace.rightSegments;
        }
        return;
    }
    if (leftLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH
        || rightLine.content.length > MAX_INLINE_HIGHLIGHT_LINE_LENGTH) {
        return;
    }

    const { leftSegments, rightSegments, hasInlineChanges } = buildInlineSegments(leftLine.content, rightLine.content);
    if (hasInlineChanges) {
        leftLine.segments = leftSegments;
        rightLine.segments = rightSegments;
    }
}

function applyFullLineHighlight(line: DiffLine): void {
    if (/[^\s]/.test(line.content)) {
        line.segments = [{ kind: line.kind, text: line.content, emphasis: true }];
    }
}

function buildInlineSegments(
    leftContent: string,
    rightContent: string
): {
    leftSegments: DiffSegment[];
    rightSegments: DiffSegment[];
    hasInlineChanges: boolean;
} {
    const changes = Diff.diffWordsWithSpace(leftContent, rightContent);
    const leftSegments: DiffSegment[] = [];
    const rightSegments: DiffSegment[] = [];
    let hasInlineChanges = false;

    for (const change of changes) {
        const value = change.value;

        if (!change.added && !change.removed) {
            const contextSegment: DiffSegment = {
                kind: 'context',
                text: value,
                emphasis: false
            };
            leftSegments.push(contextSegment);
            rightSegments.push(contextSegment);
            continue;
        }

        const emphasis = value.length > 0;
        hasInlineChanges = hasInlineChanges || emphasis;

        if (change.removed) {
            leftSegments.push({
                kind: 'removed',
                text: value,
                emphasis
            });
        }

        if (change.added) {
            rightSegments.push({
                kind: 'added',
                text: value,
                emphasis
            });
        }
    }

    return {
        leftSegments,
        rightSegments,
        hasInlineChanges
    };
}

function buildWhitespaceOnlySegments(left: string, right: string): {
    leftSegments: DiffSegment[]; rightSegments: DiffSegment[];
} | undefined {
    const leftParts = left.split(/(\S+)/);
    const rightParts = right.split(/(\S+)/);
    if (leftParts.length !== rightParts.length
        || leftParts.some((part, index) => index % 2 === 1 && part !== rightParts[index])) return undefined;
    const leftSegments: DiffSegment[] = [];
    const rightSegments: DiffSegment[] = [];
    const append = (segments: DiffSegment[], kind: DiffSegment['kind'], text: string): void => {
        if (!text) return;
        const previous = segments[segments.length - 1];
        if (previous?.kind === kind) previous.text += text;
        else segments.push({ kind, text, emphasis: kind !== 'context' });
    };
    leftParts.forEach((part, index) => {
        const other = rightParts[index];
        let prefix = 0;
        // Anchor indentation to the first token: added/removed leading spaces
        // belong at the start of the line, not beside the first character.
        if (index > 0) {
            while (prefix < Math.min(part.length, other.length) && part[prefix] === other[prefix]) prefix++;
        }
        let suffix = 0;
        while (suffix < Math.min(part.length, other.length) - prefix
            && part[part.length - suffix - 1] === other[other.length - suffix - 1]) suffix++;
        if (index === 0) {
            while (prefix < Math.min(part.length, other.length) - suffix && part[prefix] === other[prefix]) prefix++;
        }
        append(leftSegments, 'context', part.slice(0, prefix));
        append(rightSegments, 'context', other.slice(0, prefix));
        append(leftSegments, 'removed', part.slice(prefix, part.length - suffix));
        append(rightSegments, 'added', other.slice(prefix, other.length - suffix));
        append(leftSegments, 'context', part.slice(part.length - suffix));
        append(rightSegments, 'context', other.slice(other.length - suffix));
    });
    return { leftSegments, rightSegments };
}

function splitSegmentsIntoLines(segments: DiffSegment[]): DiffSegment[][] {
    const lines: DiffSegment[][] = [[]];
    for (const segment of segments) {
        segment.text.split('\n').forEach((text, index) => {
            if (index > 0) lines.push([]);
            if (text) lines[lines.length - 1].push({ ...segment, text });
        });
    }
    return lines;
}

function makePlaceholder(): DiffCell {
    return {
        kind: 'placeholder',
        content: '',
        lineNumber: null
    };
}

function makeDiffCell(kind: DiffCellKind, content: string, lineNumber: number): DiffCell {
    return { kind, content, lineNumber };
}

function makeDiffLine(kind: DiffLine['kind'], content: string, lineNumber: number): DiffLine {
    return { kind, content, lineNumber };
}

function makeDiffRow(left: DiffCell, right: DiffCell): DiffRow {
    return { left, right };
}

function makeDiffBlock(
    kind: DiffBlock['kind'],
    leftStart: number,
    leftEnd: number,
    rightStart: number,
    rightEnd: number
): DiffBlock {
    return { kind, leftStart, leftEnd, rightStart, rightEnd };
}

function buildEdits(baseLines: string[], targetLines: string[]): Edit[] {
    const changes = Diff.diffArrays(baseLines, targetLines);
    if (!changes) {
        return [{ start: 0, end: baseLines.length, newLines: [...targetLines] }];
    }
    const edits: Edit[] = [];
    let baseIndex = 0;

    for (let index = 0; index < changes.length; index++) {
        const change = changes[index];

        if (!change.added && !change.removed) {
            baseIndex += change.value.length;
            continue;
        }

        if (change.removed && index + 1 < changes.length && changes[index + 1].added) {
            edits.push({
                start: baseIndex,
                end: baseIndex + change.value.length,
                newLines: [...changes[index + 1].value]
            });
            baseIndex += change.value.length;
            index++;
            continue;
        }

        if (change.removed) {
            edits.push({
                start: baseIndex,
                end: baseIndex + change.value.length,
                newLines: []
            });
            baseIndex += change.value.length;
            continue;
        }

        edits.push({
            start: baseIndex,
            end: baseIndex,
            newLines: [...change.value]
        });
    }

    return edits;
}

function collectConflictRegion(
    baseLines: string[],
    leftEdits: Edit[],
    rightEdits: Edit[],
    leftIndex: number,
    rightIndex: number,
    baseIndex: number
): {
    start: number;
    end: number;
    leftLines: string[];
    rightLines: string[];
    nextLeftIndex: number;
    nextRightIndex: number;
} {
    let end = baseIndex;
    let nextLeftIndex = leftIndex;
    let nextRightIndex = rightIndex;
    let changed = true;

    while (changed) {
        changed = false;

        while (nextLeftIndex < leftEdits.length && leftEdits[nextLeftIndex].start <= end) {
            end = Math.max(end, leftEdits[nextLeftIndex].end);
            nextLeftIndex++;
            changed = true;
        }

        while (nextRightIndex < rightEdits.length && rightEdits[nextRightIndex].start <= end) {
            end = Math.max(end, rightEdits[nextRightIndex].end);
            nextRightIndex++;
            changed = true;
        }
    }

    return {
        start: baseIndex,
        end,
        leftLines: materializeRegion(baseLines, leftEdits.slice(leftIndex, nextLeftIndex), baseIndex, end),
        rightLines: materializeRegion(baseLines, rightEdits.slice(rightIndex, nextRightIndex), baseIndex, end),
        nextLeftIndex,
        nextRightIndex
    };
}

function materializeRegion(baseLines: string[], edits: Edit[], start: number, end: number): string[] {
    const lines: string[] = [];
    let cursor = start;

    for (const edit of edits) {
        lines.push(...baseLines.slice(cursor, edit.start));
        lines.push(...edit.newLines);
        cursor = edit.end;
    }

    lines.push(...baseLines.slice(cursor, end));
    return lines;
}

function linesEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((line, index) => line === right[index]);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
    const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
