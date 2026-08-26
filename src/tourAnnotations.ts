import type { ChangeTourManifest } from './changeTourManifest';
import type { TwoWayDiffModel } from './diffEngine';

export interface TourAnnotation {
    side: 'left' | 'right';
    startLine: number;
    endLine: number;
    label: string;
    active: boolean;
    jumpTarget?: {
        sceneIndex: number;
        stepIndex: number;
    };
    pairIndex?: number;
    panelIndex?: number;
}

export interface TourAnnotationLineRange {
    startLine: number;
    endLine: number;
}

export type StackedTourAnnotationLineResolver = (
    pairIndex: number,
    side: 'left' | 'right'
) => TourAnnotationLineRange | undefined;

export const MAX_AUTOMATIC_TOUR_FOCUS_RANGES = 4;
const NEARBY_TOUR_FOCUS_LINE_GAP = 8;
const LARGE_TOUR_FOCUS_RANGE_LINES = 120;
const TOUR_FOCUS_BOUNDARY_SEARCH_LINES = 12;

export function getFirstChangeSourceRange(
    diffModel: TwoWayDiffModel | null | undefined,
    side: 'left' | 'right'
): TourAnnotationLineRange | undefined {
    return getChangeSourceRange(diffModel, 0, side);
}

export function getChangeSourceRange(
    diffModel: TwoWayDiffModel | null | undefined,
    blockIndex: number,
    side: 'left' | 'right'
): TourAnnotationLineRange | undefined {
    const block = diffModel?.blocks[blockIndex];
    const lines = side === 'left' ? diffModel?.leftLines : diffModel?.rightLines;
    if (!block || !lines?.length) {
        return undefined;
    }

    const start = side === 'left' ? block.leftStart : block.rightStart;
    const end = side === 'left' ? block.leftEnd : block.rightEnd;
    const changedLines = lines.slice(start, end);
    const startLine = changedLines[0]?.lineNumber
        ?? lines[Math.min(start, lines.length - 1)]?.lineNumber;
    if (!Number.isInteger(startLine)) {
        return undefined;
    }

    return {
        startLine,
        endLine: changedLines.at(-1)?.lineNumber ?? startLine
    };
}

export function buildTourFocusRanges(
    diffModel: TwoWayDiffModel,
    side: 'left' | 'right'
): TourAnnotationLineRange[] {
    const ranges = diffModel.blocks
        .map((_, blockIndex) => getChangeSourceRange(diffModel, blockIndex, side))
        .filter((range): range is TourAnnotationLineRange => Boolean(range));
    if (ranges.length === 0) return [];

    const nearby = ranges.reduce<TourAnnotationLineRange[]>((grouped, range) => {
        const previous = grouped.at(-1);
        if (previous && range.startLine - previous.endLine <= NEARBY_TOUR_FOCUS_LINE_GAP) {
            previous.endLine = Math.max(previous.endLine, range.endLine);
        } else {
            grouped.push({ ...range });
        }
        return grouped;
    }, []);
    const capped = capFocusRanges(nearby, MAX_AUTOMATIC_TOUR_FOCUS_RANGES);
    if (capped.length !== 1) return capped;

    const [only] = capped;
    const lineCount = only.endLine - only.startLine + 1;
    if (lineCount < LARGE_TOUR_FOCUS_RANGE_LINES) return capped;
    const lines = side === 'left' ? diffModel.leftLines : diffModel.rightLines;
    const partCount = Math.min(
        MAX_AUTOMATIC_TOUR_FOCUS_RANGES,
        Math.ceil(lineCount / LARGE_TOUR_FOCUS_RANGE_LINES)
    );
    const boundaries: number[] = [];
    for (let partIndex = 1; partIndex < partCount; partIndex += 1) {
        const target = only.startLine + Math.round((lineCount * partIndex) / partCount) - 1;
        boundaries.push(findBlankLineBoundary(lines, target, only.startLine, only.endLine));
    }
    const uniqueBoundaries = [...new Set(boundaries)]
        .filter((line) => line >= only.startLine && line < only.endLine)
        .sort((left, right) => left - right);
    const split: TourAnnotationLineRange[] = [];
    let startLine = only.startLine;
    for (const endLine of uniqueBoundaries) {
        split.push({ startLine, endLine });
        startLine = endLine + 1;
    }
    split.push({ startLine, endLine: only.endLine });
    return split;
}

function capFocusRanges(
    ranges: readonly TourAnnotationLineRange[],
    maximum: number
): TourAnnotationLineRange[] {
    if (ranges.length <= maximum) return ranges.map((range) => ({ ...range }));
    const capped: TourAnnotationLineRange[] = [];
    for (let index = 0; index < maximum; index += 1) {
        const startIndex = Math.floor((index * ranges.length) / maximum);
        const endIndex = Math.floor(((index + 1) * ranges.length) / maximum) - 1;
        capped.push({
            startLine: ranges[startIndex].startLine,
            endLine: ranges[endIndex].endLine
        });
    }
    return capped;
}

function findBlankLineBoundary(
    lines: TwoWayDiffModel['leftLines'],
    target: number,
    minimum: number,
    maximum: number
): number {
    for (let distance = 0; distance <= TOUR_FOCUS_BOUNDARY_SEARCH_LINES; distance += 1) {
        for (const candidate of distance === 0 ? [target] : [target + distance, target - distance]) {
            if (candidate < minimum || candidate >= maximum) continue;
            const line = lines.find((entry) => entry.lineNumber === candidate);
            if (line?.content.trim() === '') return candidate;
        }
    }
    return Math.min(Math.max(target, minimum), maximum - 1);
}

export function buildWalkthroughTourAnnotations(
    tour: ChangeTourManifest,
    filePath: string,
    activeSceneIndex: number,
    activeStepIndex: number
): TourAnnotation[] {
    const annotations: TourAnnotation[] = [];
    tour.scenes.forEach((scene, sceneIndex) => {
        if (scene.kind !== 'walkthrough') {
            return;
        }

        scene.steps.forEach((candidate, stepIndex) => {
            if (candidate.diff.path !== filePath) {
                return;
            }

            annotations.push({
                side: candidate.focus.revision === 'base' ? 'left' : 'right',
                startLine: candidate.focus.startLine,
                endLine: candidate.focus.endLine,
                label: `${scene.title} · ${candidate.title}: ${candidate.body}`,
                active: sceneIndex === activeSceneIndex && stepIndex === activeStepIndex,
                jumpTarget: { sceneIndex, stepIndex }
            });
        });
    });
    return annotations;
}

export function buildStackedTourAnnotations(
    tour: ChangeTourManifest,
    filePath: string,
    activeSceneIndex: number,
    activeStepIndex: number,
    resolveLineRange?: StackedTourAnnotationLineResolver
): TourAnnotation[] {
    const annotations: TourAnnotation[] = [];
    tour.scenes.forEach((scene, sceneIndex) => {
        if (scene.kind !== 'stacked-diff' && scene.kind !== 'deconstructed-diff') {
            return;
        }

        scene.steps.forEach((candidate, stepIndex) => {
            if (candidate.file !== filePath) {
                return;
            }

            const lineRange = candidate.startLine === undefined
                ? resolveLineRange?.(candidate.pairIndex, candidate.side)
                : {
                    startLine: candidate.startLine,
                    endLine: candidate.endLine ?? candidate.startLine
                };
            if (!lineRange) {
                return;
            }

            const panelIndex = candidate.pairIndex + (candidate.side === 'right' ? 1 : 0);
            annotations.push({
                pairIndex: candidate.pairIndex,
                panelIndex,
                side: candidate.side,
                startLine: lineRange.startLine,
                endLine: lineRange.endLine,
                label: `${scene.title} · ${candidate.title}: ${candidate.body}`,
                active: sceneIndex === activeSceneIndex && stepIndex === activeStepIndex,
                jumpTarget: { sceneIndex, stepIndex }
            });
        });
    });
    return annotations;
}
