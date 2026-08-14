import type { ChangeTourManifest } from './changeTourManifest';

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
    activeStepIndex: number
): TourAnnotation[] {
    const annotations: TourAnnotation[] = [];
    tour.scenes.forEach((scene, sceneIndex) => {
        if (scene.kind !== 'stacked-diff') {
            return;
        }

        scene.steps.forEach((candidate, stepIndex) => {
            if (candidate.file !== filePath || candidate.startLine === undefined) {
                return;
            }

            const endLine = candidate.endLine ?? candidate.startLine;
            const panelIndex = candidate.pairIndex + (candidate.side === 'right' ? 1 : 0);
            annotations.push({
                pairIndex: candidate.pairIndex,
                panelIndex,
                side: candidate.side,
                startLine: candidate.startLine,
                endLine,
                label: `${scene.title} · ${candidate.title}: ${candidate.body}`,
                active: sceneIndex === activeSceneIndex && stepIndex === activeStepIndex,
                jumpTarget: { sceneIndex, stepIndex }
            });
        });
    });
    return annotations;
}
