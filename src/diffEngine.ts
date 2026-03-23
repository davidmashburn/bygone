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

export interface DiffConnection {
    type: 'context' | 'boundary';
    row: number;
    targetRow?: number;
    direction?: 'start' | 'end';
}

export interface TwoWayDiffModel {
    rows: DiffRow[];
    connections: DiffConnection[];
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

export function buildTwoWayDiffModel(leftContent: string, rightContent: string): TwoWayDiffModel {
    const leftLines = normalizeLines(leftContent);
    const rightLines = normalizeLines(rightContent);
    const changes = Diff.diffArrays(leftLines, rightLines);

    const rows: DiffRow[] = [];
    let leftLineNumber = 1;
    let rightLineNumber = 1;

    for (let index = 0; index < changes.length; index++) {
        const change = changes[index];
        const removedLines = change.removed ? change.value : [];
        const addedLines = change.added ? change.value : [];

        if (!change.added && !change.removed) {
            for (const line of change.value) {
                rows.push({
                    left: { kind: 'context', content: line, lineNumber: leftLineNumber++ },
                    right: { kind: 'context', content: line, lineNumber: rightLineNumber++ }
                });
            }
            continue;
        }

        if (change.removed && index + 1 < changes.length && changes[index + 1].added) {
            const nextChange = changes[index + 1];
            const pairedLength = Math.max(removedLines.length, nextChange.value.length);

            for (let rowIndex = 0; rowIndex < pairedLength; rowIndex++) {
                const removedLine = removedLines[rowIndex];
                const addedLine = nextChange.value[rowIndex];

                rows.push({
                    left: removedLine === undefined
                        ? makePlaceholder()
                        : { kind: 'removed', content: removedLine, lineNumber: leftLineNumber++ },
                    right: addedLine === undefined
                        ? makePlaceholder()
                        : { kind: 'added', content: addedLine, lineNumber: rightLineNumber++ }
                });
            }

            index++;
            continue;
        }

        if (change.removed) {
            for (const line of removedLines) {
                rows.push({
                    left: { kind: 'removed', content: line, lineNumber: leftLineNumber++ },
                    right: makePlaceholder()
                });
            }
            continue;
        }

        if (change.added) {
            for (const line of addedLines) {
                rows.push({
                    left: makePlaceholder(),
                    right: { kind: 'added', content: line, lineNumber: rightLineNumber++ }
                });
            }
        }
    }

    return {
        rows,
        connections: buildConnections(rows),
        hasChanges: rows.some((row) => row.left.kind !== 'context' || row.right.kind !== 'context')
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

function makePlaceholder(): DiffCell {
    return {
        kind: 'placeholder',
        content: '',
        lineNumber: null
    };
}

function buildConnections(rows: DiffRow[]): DiffConnection[] {
    const connections: DiffConnection[] = [];
    let row = 0;

    while (row < rows.length) {
        const isContextRow = rows[row].left.kind === 'context' && rows[row].right.kind === 'context';
        const start = row;

        while (row < rows.length) {
            const currentIsContext = rows[row].left.kind === 'context' && rows[row].right.kind === 'context';
            if (currentIsContext !== isContextRow) {
                break;
            }
            row++;
        }

        const end = row - 1;

        if (isContextRow) {
            for (let marker = start; marker <= end; marker += 20) {
                connections.push({ type: 'context', row: marker });
            }
        } else {
            if (start > 0) {
                connections.push({ type: 'boundary', direction: 'start', row: start - 1, targetRow: start });
            }

            if (end < rows.length - 1) {
                connections.push({ type: 'boundary', direction: 'end', row: end, targetRow: end + 1 });
            }
        }
    }

    return connections;
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
