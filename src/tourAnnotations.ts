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

export function getFirstChangeSourceRange(
    diffModel: TwoWayDiffModel | null | undefined,
    side: 'left' | 'right'
): TourAnnotationLineRange | undefined {
    const block = diffModel?.blocks[0];
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
        if (scene.kind !== 'stacked-diff') {
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
