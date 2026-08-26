import type { ChangeTourFile, ChangeTourScene, ChangeTourStackFile } from './changeTourManifest';

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

/** The state of a file in one adjacent pair of a multi-panel comparison. */
export type MultiPanelFileState =
    | 'modified-here'
    | 'created-here'
    | 'deleted-here'
    | 'unchanged-here'
    | 'not-created-yet'
    | 'already-deleted';

export interface MultiPanelComparisonFileTarget {
    pairIndex: number;
    fileIndex: number;
    path: string;
}

const CHANGED_MULTI_PANEL_FILE_STATES: ReadonlySet<MultiPanelFileState> = new Set([
    'modified-here',
    'created-here',
    'deleted-here'
]);

/**
 * Classifies one file against an adjacent pair of virtual panels.
 *
 * A file absent from both sides is classified from the surrounding virtual
 * states: an existing earlier panel means it was already deleted; otherwise
 * an existing later panel means it has not been created yet. If no surrounding
 * panel contains it, the lifecycle has not started, so it is treated as not
 * created yet.
 */
export function classifyMultiPanelFile(
    file: Pick<ChangeTourStackFile, 'panels'>,
    pairIndex: number
): MultiPanelFileState {
    const left = file.panels[pairIndex];
    const right = file.panels[pairIndex + 1];
    if (!left || !right) {
        return 'unchanged-here';
    }
    if (left.exists && right.exists) {
        return left.content === right.content ? 'unchanged-here' : 'modified-here';
    }
    if (!left.exists && right.exists) {
        return 'created-here';
    }
    if (left.exists && !right.exists) {
        return 'deleted-here';
    }

    const existedEarlier = file.panels
        .slice(0, pairIndex)
        .some((panel) => panel.exists);
    if (existedEarlier) {
        return 'already-deleted';
    }
    const existsLater = file.panels
        .slice(pairIndex + 2)
        .some((panel) => panel.exists);
    if (existsLater) {
        return 'not-created-yet';
    }
    // No surrounding occurrence means the file has not started its lifecycle.
    return 'not-created-yet';
}

/**
 * Returns the bounded changed-file target in an adjacent pair. Empty file
 * states are skipped, and the pair and source file order are retained.
 */
export function getMultiPanelChangedFileTarget(
    files: readonly ChangeTourStackFile[],
    pairIndex: number,
    currentPath: string | null,
    direction: -1 | 1
): MultiPanelComparisonFileTarget | null {
    if ((direction !== -1 && direction !== 1) || !currentPath) {
        return null;
    }
    const currentIndex = files.findIndex((file) => file.path === currentPath);
    if (currentIndex < 0) {
        return null;
    }
    const changedIndices = files
        .map((file, fileIndex) => ({ file, fileIndex, state: classifyMultiPanelFile(file, pairIndex) }))
        .filter(({ state }) => CHANGED_MULTI_PANEL_FILE_STATES.has(state));
    const target = direction < 0
        ? [...changedIndices].reverse().find(({ fileIndex }) => fileIndex < currentIndex)
        : changedIndices.find(({ fileIndex }) => fileIndex > currentIndex);
    return target
        ? { pairIndex, fileIndex: target.fileIndex, path: target.file.path }
        : null;
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
