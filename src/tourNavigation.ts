import type { ChangeTourScene } from './changeTourManifest';

export interface TourPosition {
    sceneIndex: number;
    stepIndex: number;
}

export interface TourFileTarget extends TourPosition {
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
    scenes: readonly ChangeTourScene[],
    position: TourPosition,
    direction: -1 | 1
): TourFileTarget | null {
    const targets: TourFileTarget[] = [];
    const seenPaths = new Set<string>();
    const addTarget = (target: TourFileTarget) => {
        if (!seenPaths.has(target.path)) {
            seenPaths.add(target.path);
            targets.push(target);
        }
    };

    scenes.forEach((scene, sceneIndex) => {
        if (scene.kind === 'text-diff') {
            addTarget({ sceneIndex, stepIndex: 0, path: scene.path });
            return;
        }
        if (scene.kind === 'walkthrough') {
            scene.steps.forEach((step, stepIndex) => {
                addTarget({ sceneIndex, stepIndex, path: step.diff.path });
            });
        }
    });

    const scene = scenes[position.sceneIndex];
    const currentPath = scene?.kind === 'text-diff'
        ? scene.path
        : scene?.kind === 'walkthrough'
            ? scene.steps[position.stepIndex]?.diff.path
            : null;
    if (!currentPath) {
        return null;
    }
    const currentIndex = targets.findIndex((target) => target.path === currentPath);
    const targetIndex = currentIndex + direction;
    return currentIndex >= 0 && targetIndex >= 0 && targetIndex < targets.length
        ? targets[targetIndex]
        : null;
}
