import type { ChangeTourFile, ChangeTourScene } from './changeTourManifest';

export interface TourPosition {
    sceneIndex: number;
    stepIndex: number;
}

export interface TourFileTarget {
    fileIndex: number;
    path: string;
}

export function resolveTourPosition(
    scenes: readonly ChangeTourScene[],
    requestedSceneId: string | null,
    requestedStepId: string | null
): TourPosition {
    const requestedSceneIndex = scenes.findIndex((scene) => scene.id === requestedSceneId);
    const sceneIndex = requestedSceneIndex >= 0 ? requestedSceneIndex : 0;
    const scene = scenes[sceneIndex];
    if (!scene || scene.kind !== 'walkthrough' || !requestedStepId) {
        return { sceneIndex, stepIndex: 0 };
    }
    const requestedStepIndex = scene.steps.findIndex((step) => step.id === requestedStepId);
    return { sceneIndex, stepIndex: requestedStepIndex >= 0 ? requestedStepIndex : 0 };
}

export function getLinearTourTarget(
    scenes: readonly ChangeTourScene[],
    position: TourPosition,
    direction: -1 | 1
): TourPosition | null {
    const scene = scenes[position.sceneIndex];
    if (!scene) {
        return null;
    }
    if (direction > 0) {
        if (scene.kind === 'walkthrough' && position.stepIndex < scene.steps.length - 1) {
            return { sceneIndex: position.sceneIndex, stepIndex: position.stepIndex + 1 };
        }
        return position.sceneIndex < scenes.length - 1
            ? { sceneIndex: position.sceneIndex + 1, stepIndex: 0 }
            : null;
    }
    if (scene.kind === 'walkthrough' && position.stepIndex > 0) {
        return { sceneIndex: position.sceneIndex, stepIndex: position.stepIndex - 1 };
    }
    if (position.sceneIndex === 0) {
        return null;
    }
    const previousScene = scenes[position.sceneIndex - 1];
    return {
        sceneIndex: position.sceneIndex - 1,
        stepIndex: previousScene.kind === 'walkthrough' ? previousScene.steps.length - 1 : 0
    };
}

export function getTourFileTarget(
    files: readonly ChangeTourFile[],
    currentPath: string | null,
    direction: -1 | 1
): TourFileTarget | null {
    if (!currentPath) {
        return null;
    }
    const renderable = files
        .map((file, fileIndex) => ({ file, fileIndex }))
        .filter(({ file }) => file.kind === 'text-diff');
    const currentIndex = renderable.findIndex(({ file }) => file.path === currentPath);
    const targetIndex = currentIndex + direction;
    const target = currentIndex >= 0 ? renderable[targetIndex] : null;
    return target
        ? { fileIndex: target.fileIndex, path: target.file.path }
        : null;
}
