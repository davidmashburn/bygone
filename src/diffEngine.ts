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
}

export interface TwoWayDiffModel {
    rows: DiffRow[];
    leftLines: DiffLine[];
    rightLines: DiffLine[];
    blocks: DiffBlock[];
    hasChanges: boolean;
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

const DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH = 500;
const MAX_INLINE_HIGHLIGHT_LINE_LENGTH = readPositiveIntegerEnv(
    'BYGONE_MAX_INLINE_HIGHLIGHT_LINE_LENGTH',
    DEFAULT_MAX_INLINE_HIGHLIGHT_LINE_LENGTH
);

export function buildTwoWayDiffModel(leftContent: string, rightContent: string): TwoWayDiffModel {
    const leftLines = normalizeLines(leftContent);
    const rightLines = normalizeLines(rightContent);
    const changes = Diff.diffArrays(leftLines, rightLines);

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
            const leftStart = renderedLeftLines.length;
            const rightStart = renderedRightLines.length;
            const alignedLines = alignReplacementLines(removedLines, nextChange.value);

            for (const { left: removedLine, right: addedLine } of alignedLines) {
                let renderedLeftLine: DiffLine | undefined;
                let renderedRightLine: DiffLine | undefined;

                if (removedLine !== undefined) {
                    renderedLeftLine = makeDiffLine('removed', removedLine, leftLineNumber);
                    renderedLeftLines.push(renderedLeftLine);
                }

                if (addedLine !== undefined) {
                    renderedRightLine = makeDiffLine('added', addedLine, rightLineNumber);
                    renderedRightLines.push(renderedRightLine);
                }

                if (renderedLeftLine && renderedRightLine) {
                    applyInlineHighlightPair(renderedLeftLine, renderedRightLine);
                }

                rows.push(makeDiffRow(
                    removedLine === undefined
                        ? makePlaceholder()
                        : makeDiffCell('removed', removedLine, leftLineNumber++),
                    addedLine === undefined
                        ? makePlaceholder()
                        : makeDiffCell('added', addedLine, rightLineNumber++)
                ));
            }

            blocks.push(makeDiffBlock('replace', leftStart, renderedLeftLines.length, rightStart, renderedRightLines.length));

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
        blocks,
        hasChanges
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

interface AlignedReplacementLine {
    left?: string;
    right?: string;
}

function alignReplacementLines(leftLines: string[], rightLines: string[]): AlignedReplacementLine[] {
    const maxAlignmentCells = 10_000;
    if (leftLines.length * rightLines.length > maxAlignmentCells) {
        return alignReplacementLinesByPosition(leftLines, rightLines);
    }

    const gapPenalty = 0;
    const minimumSimilarity = 0.45;
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
        scores[leftIndex][0] = scores[leftIndex - 1][0] + gapPenalty;
        moves[leftIndex][0] = 'left';
    }
    for (let rightIndex = 1; rightIndex <= rightLines.length; rightIndex++) {
        scores[0][rightIndex] = scores[0][rightIndex - 1] + gapPenalty;
        moves[0][rightIndex] = 'right';
    }

    for (let leftIndex = 1; leftIndex <= leftLines.length; leftIndex++) {
        for (let rightIndex = 1; rightIndex <= rightLines.length; rightIndex++) {
            const similarity = lineSimilarity(leftLines[leftIndex - 1], rightLines[rightIndex - 1]);
            const candidates = [
                {
                    move: 'match' as const,
                    score: similarity > minimumSimilarity
                        ? scores[leftIndex - 1][rightIndex - 1] + Math.pow(similarity - minimumSimilarity, 2)
                        : Number.NEGATIVE_INFINITY
                },
                { move: 'left' as const, score: scores[leftIndex - 1][rightIndex] + gapPenalty },
                { move: 'right' as const, score: scores[leftIndex][rightIndex - 1] + gapPenalty }
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

function alignReplacementLinesByPosition(leftLines: string[], rightLines: string[]): AlignedReplacementLine[] {
    const length = Math.max(leftLines.length, rightLines.length);
    return Array.from({ length }, (_value, index) => ({
        left: leftLines[index],
        right: rightLines[index]
    }));
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

        const emphasis = /[^\s]/.test(value);
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
