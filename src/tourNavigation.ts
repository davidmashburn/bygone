import type { ChangeTourFile, ChangeTourScene } from './changeTourManifest';

export interface TourPosition {
    sceneIndex: number;
    stepIndex: number;
}

export interface TourFileTarget {
    fileIndex: number;
    path: string;
}

export interface MultiPanelTourFileTarget extends TourPosition {
    sceneIndex: number;
    stepIndex: number;
}

export function resolveTourPosition(
    scenes: readonly ChangeTourScene[],
    requestedSceneId: string | null,
    requestedStepId: string | null
): TourPosition {
    const requestedSceneIndex = scenes.findIndex((scene) => scene.id === requestedSceneId);
    const sceneIndex = requestedSceneIndex >= 0 ? requestedSceneIndex : 0;
    const scene = scenes[sceneIndex];
    if (!scene || (scene.kind !== 'walkthrough' && scene.kind !== 'stacked-diff' && scene.kind !== 'deconstructed-diff') || !requestedStepId) {
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
        if ((scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff') && position.stepIndex < scene.steps.length - 1) {
            return { sceneIndex: position.sceneIndex, stepIndex: position.stepIndex + 1 };
        }
        return position.sceneIndex < scenes.length - 1
            ? { sceneIndex: position.sceneIndex + 1, stepIndex: 0 }
            : null;
    }
    if ((scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff') && position.stepIndex > 0) {
        return { sceneIndex: position.sceneIndex, stepIndex: position.stepIndex - 1 };
    }
    if (position.sceneIndex === 0) {
        return null;
    }
    const previousScene = scenes[position.sceneIndex - 1];
    return {
        sceneIndex: position.sceneIndex - 1,
        stepIndex: previousScene.kind === 'walkthrough' || previousScene.kind === 'stacked-diff' || previousScene.kind === 'deconstructed-diff'
            ? previousScene.steps.length - 1
            : 0
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

export function getMultiPanelTourFileTarget(
    scenes: readonly ChangeTourScene[],
    position: TourPosition,
    filePath: string
): MultiPanelTourFileTarget | null {
    const activeScene = scenes[position.sceneIndex];
    const activeTarget = getSceneFileTarget(activeScene, position.sceneIndex, position.stepIndex, filePath);
    if (activeTarget) {
        return activeTarget;
    }

    for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
        if (sceneIndex === position.sceneIndex) {
            continue;
        }
        const target = getSceneFileTarget(scenes[sceneIndex], sceneIndex, 0, filePath);
        if (target) {
            return target;
        }
    }
    return null;
}

function getSceneFileTarget(
    scene: ChangeTourScene | undefined,
    sceneIndex: number,
    preferredStepIndex: number,
    filePath: string
): MultiPanelTourFileTarget | null {
    if (!scene || (scene.kind !== 'stacked-diff' && scene.kind !== 'deconstructed-diff')) {
        return null;
    }
    if (!scene.files.some((file) => file.path === filePath)) {
        return null;
    }

    const preferredStep = scene.steps[preferredStepIndex];
    const matchingStepIndex = preferredStep?.file === filePath
        ? preferredStepIndex
        : scene.steps.findIndex((step) => step.file === filePath);
    return {
        sceneIndex,
        stepIndex: matchingStepIndex >= 0 ? matchingStepIndex : Math.max(preferredStepIndex, 0)
    };
}
