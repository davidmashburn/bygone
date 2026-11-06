import type { ChangeTourManifest, ChangeTourScene, ChangeTourStepBranch } from './changeTourManifest';

export type { ChangeTourStepBranch } from './changeTourManifest';

export interface TourBranchLocation {
    sceneIndex: number;
    branchId: string;
}

export type TourReadingItem =
    | { kind: 'title'; key: 'title'; authored?: boolean; sceneIndex: 0; stepIndex: 0 }
    | { kind: 'conclusion'; key: 'conclusion'; sceneIndex: -1; stepIndex: 0 }
    | { kind: 'chapter'; key: string; chapterId: string; sceneIndex: number; stepIndex: 0 }
    | { kind: 'scene'; key: string; chapterId?: string; sceneIndex: number; stepIndex: 0 }
    | { kind: 'step'; key: string; sceneIndex: number; stepIndex: number };

/**
 * Build the continuous reading order for a tour.
 *
 * Scene order is the manifest's scene order. Chapters annotate that order at
 * the first scene they contain; they do not become a second ordering axis.
 */
export function buildTourReadingItems(
    tour: Pick<ChangeTourManifest, 'scenes' | 'chapters' | 'opening' | 'conclusion'>,
    branch: TourBranchLocation | null = null
): TourReadingItem[] {
    if (branch) return buildBranchReadingItems(tour, branch);
    return buildStructuredReadingItems(tour, false);
}

/** Build lookup items without hiding optional steps from stable-key resolution. */
export function buildAllTourReadingItems(
    tour: Pick<ChangeTourManifest, 'scenes' | 'chapters' | 'opening' | 'conclusion'>
): TourReadingItem[] {
    return buildStructuredReadingItems(tour, true);
}

function buildStructuredReadingItems(
    tour: Pick<ChangeTourManifest, 'scenes' | 'chapters' | 'opening' | 'conclusion'>,
    includeOptionalSteps: boolean
): TourReadingItem[] {
    const items: TourReadingItem[] = [
        { kind: 'title', key: 'title', sceneIndex: 0, stepIndex: 0, ...(tour.opening ? { authored: true } : {}) }
    ];
    const chapterBySceneId = new Map<string, string>();
    for (const chapter of tour.chapters) {
        for (const sceneId of chapter.sceneIds) {
            if (!chapterBySceneId.has(sceneId)) chapterBySceneId.set(sceneId, chapter.id);
        }
    }

    const emittedChapterIds = new Set<string>();
    tour.scenes.forEach((scene, sceneIndex) => {
        const chapterId = chapterBySceneId.get(scene.id);
        const chapter = tour.chapters.find(chapter => chapter.id === chapterId);
        if (chapter?.summary?.trim() && chapterId && !emittedChapterIds.has(chapterId)) {
            items.push({
                kind: 'chapter',
                key: `chapter:${chapterId}`,
                chapterId,
                sceneIndex,
                stepIndex: 0
            });
            emittedChapterIds.add(chapterId);
        }

        items.push({
            kind: 'scene',
            key: `scene:${scene.id}`,
            ...(chapterId ? { chapterId } : {}),
            sceneIndex,
            stepIndex: 0
        });

        if (isSteppedScene(scene)) {
            scene.steps.forEach((step, stepIndex) => {
                if (!includeOptionalSteps && getTourStepBranch(step)) return;
                items.push({
                    kind: 'step',
                    key: `step:${scene.id}:${step.id}`,
                    sceneIndex,
                    stepIndex
                });
            });
        }
    });

    if (tour.conclusion) items.push({ kind: 'conclusion', key: 'conclusion', sceneIndex: -1, stepIndex: 0 });
    return items;
}

function buildBranchReadingItems(
    tour: Pick<ChangeTourManifest, 'scenes'>,
    location: TourBranchLocation
): TourReadingItem[] {
    if (!Number.isInteger(location.sceneIndex) || location.sceneIndex < 0 || typeof location.branchId !== 'string') return [];
    const scene = tour.scenes[location.sceneIndex];
    if (!scene || !isSteppedScene(scene)) return [];
    const items: TourReadingItem[] = [];
    scene.steps.forEach((step, stepIndex) => {
        const branch = getTourStepBranch(step);
        if (branch?.id === location.branchId) items.push(makeStepReadingItem(scene.id, location.sceneIndex, step, stepIndex));
    });
    return items;
}

function makeStepReadingItem(sceneId: string, sceneIndex: number, step: { id: string }, stepIndex: number): TourReadingItem {
    return {
        kind: 'step',
        key: `step:${sceneId}:${step.id}`,
        sceneIndex,
        stepIndex
    };
}

/** Return the adjacent item in the continuous reading order, if one exists. */
export function getTourReadingTarget(
    items: readonly TourReadingItem[],
    key: string,
    direction: -1 | 1,
    stepsOnly = false
): TourReadingItem | null {
    if (direction !== -1 && direction !== 1) return null;
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return null;
    for (let next = index + direction; next >= 0 && next < items.length; next += direction) {
        const item = items[next];
        if (!stepsOnly || item.kind === 'step' || item.kind === 'conclusion' || item.kind === 'title') return item;
    }
    return null;
}

/** A screenshot guide has structural headings, but only its images are stops. */
export function isImageOnlyTour(tour: Pick<ChangeTourManifest, 'scenes'>): boolean {
    return tour.scenes.length > 0 && tour.scenes.every(scene => {
        if (scene.kind !== 'walkthrough') return false;
        const mainSteps = scene.steps.filter(step => !getTourStepBranch(step));
        return mainSteps.length > 0 && mainSteps.every(step => Boolean(step.image));
    });
}

/** Return the validated branch metadata attached to a compiled step, if any. */
export function getTourStepBranch(step: unknown): ChangeTourStepBranch | undefined {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return undefined;
    const candidate = (step as { branch?: unknown }).branch;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const branch = candidate as Record<string, unknown>;
    if (typeof branch.id !== 'string' || typeof branch.title !== 'string' || typeof branch.parentStepId !== 'string') {
        return undefined;
    }
    return { id: branch.id, title: branch.title, parentStepId: branch.parentStepId };
}

/** Return unique direct branches whose owning step is parentStepId. */
export function getTourBranchOptions(
    tour: Pick<ChangeTourManifest, 'scenes'>,
    sceneIndex: number,
    parentStepId: string
): ChangeTourStepBranch[] {
    const scene = tour.scenes[sceneIndex];
    if (!scene || !isSteppedScene(scene) || typeof parentStepId !== 'string') return [];
    if (!scene.steps.some(step => step.id === parentStepId)) return [];
    const seen = new Set<string>();
    const options: ChangeTourStepBranch[] = [];
    for (const step of scene.steps) {
        const branch = getTourStepBranch(step);
        if (!branch || branch.parentStepId !== parentStepId || seen.has(branch.id)) continue;
        seen.add(branch.id);
        options.push(branch);
    }
    return options;
}

/** Return the physical owning step for a branch location. */
export function getTourBranchParent(
    tour: Pick<ChangeTourManifest, 'scenes'>,
    location: TourBranchLocation
): TourReadingItem | null {
    const scene = tour.scenes[location.sceneIndex];
    if (!scene || !isSteppedScene(scene)) return null;
    let branch: ChangeTourStepBranch | undefined;
    for (const step of scene.steps) {
        const candidate = getTourStepBranch(step);
        if (candidate?.id === location.branchId) {
            branch = candidate;
            break;
        }
    }
    if (!branch) return null;
    const parentStepId = branch.parentStepId;
    let parentStepIndex = -1;
    for (let stepIndex = 0; stepIndex < scene.steps.length; stepIndex += 1) {
        if (scene.steps[stepIndex].id === parentStepId) {
            parentStepIndex = stepIndex;
            break;
        }
    }
    return parentStepIndex >= 0
        ? makeStepReadingItem(scene.id, location.sceneIndex, scene.steps[parentStepIndex], parentStepIndex)
        : null;
}

/** Continue on the immediate parent's path, never implicitly climb another level. */
export function getTourBranchContinueTarget(
    tour: Pick<ChangeTourManifest, 'scenes' | 'chapters' | 'opening' | 'conclusion'>,
    location: TourBranchLocation
): TourReadingItem | null {
    const parent = getTourBranchParent(tour, location);
    if (!parent) return null;
    const scene = tour.scenes[parent.sceneIndex];
    const branch = isSteppedScene(scene) ? getTourStepBranch(scene.steps[parent.stepIndex]) : undefined;
    const items = buildTourReadingItems(tour, branch ? { sceneIndex: parent.sceneIndex, branchId: branch.id } : null);
    return getTourReadingTarget(items, parent.key, 1, isImageOnlyTour(tour));
}

/** Return branch ancestry from the outermost branch to the selected branch. */
export function getTourBranchTrail(
    tour: Pick<ChangeTourManifest, 'scenes'>,
    location: TourBranchLocation
): ChangeTourStepBranch[] {
    const scene = tour.scenes[location.sceneIndex];
    if (!scene || !isSteppedScene(scene)) return [];
    const trail: ChangeTourStepBranch[] = [];
    const seenBranchIds = new Set<string>();
    let branchId: string | undefined = location.branchId;
    while (branchId && !seenBranchIds.has(branchId)) {
        let branch: ChangeTourStepBranch | undefined;
        for (const step of scene.steps) {
            const candidate = getTourStepBranch(step);
            if (candidate?.id === branchId) {
                branch = candidate;
                break;
            }
        }
        if (!branch) break;
        seenBranchIds.add(branch.id);
        trail.unshift(branch);
        const parentStepId = branch.parentStepId;
        let parentStep: (typeof scene.steps)[number] | undefined;
        for (const step of scene.steps) {
            if (step.id === parentStepId) {
                parentStep = step;
                break;
            }
        }
        branchId = parentStep ? getTourStepBranch(parentStep)?.id : undefined;
    }
    return trail;
}

export interface TourReadingCost {
    main: { steps: number; words: number };
    optional: { steps: number; words: number };
}

/** Count narrated prose separately for the default route and optional branches. */
export function getTourReadingCost(tour: ChangeTourManifest): TourReadingCost {
    const mainText: string[] = [];
    const optionalText: string[] = [];
    const optionalBranchIds = new Set<string>();
    const addPassage = (passage: ChangeTourManifest['opening'] | ChangeTourManifest['conclusion'] | undefined, target: string[]) => {
        if (!passage) return;
        target.push(passage.title, passage.summary, ...(passage.bullets || []));
    };
    const addStepText = (step: unknown, target: string[]) => {
        if (!step || typeof step !== 'object') return;
        const value = step as { title?: unknown; body?: unknown; connection?: { label?: unknown } };
        if (typeof value.title === 'string') target.push(value.title);
        if (typeof value.body === 'string') target.push(value.body);
        if (typeof value.connection?.label === 'string') target.push(value.connection.label);
    };

    mainText.push(tour.title);
    addPassage(tour.opening, mainText);
    addPassage(tour.conclusion, mainText);
    for (const chapter of tour.chapters) {
        mainText.push(chapter.title);
        if (chapter.summary) mainText.push(chapter.summary);
    }
    let mainSteps = 0;
    let optionalSteps = 0;
    for (const scene of tour.scenes) {
        mainText.push(scene.title, scene.summary, ...scene.bullets, scene.takeaway);
        if ('overview' in scene && scene.overview?.purpose) mainText.push(scene.overview.purpose);
        if (!isSteppedScene(scene)) continue;
        for (const step of scene.steps) {
            const branch = getTourStepBranch(step);
            if (!branch) {
                mainSteps += 1;
                addStepText(step, mainText);
            } else {
                optionalSteps += 1;
                if (!optionalBranchIds.has(`${scene.id}:${branch.id}`)) {
                    optionalBranchIds.add(`${scene.id}:${branch.id}`);
                    optionalText.push(branch.title);
                }
                addStepText(step, optionalText);
            }
        }
    }
    return {
        main: { steps: mainSteps, words: countWords(mainText) },
        optional: { steps: optionalSteps, words: countWords(optionalText) }
    };
}

function countWords(values: readonly unknown[]): number {
    return values.reduce<number>((count, value) => count + (typeof value === 'string' ? value.trim().split(/\s+/u).filter(Boolean).length : 0), 0);
}

/**
 * Resolve a scene/step position to the corresponding reading item.
 * Parent views intentionally resolve to their own item while the default
 * resolves to the deepest available item at the supplied position.
 */
export function resolveTourReadingItem(
    items: readonly TourReadingItem[],
    sceneIndex: number,
    stepIndex: number,
    view: 'tour' | 'chapter' | 'overview' | 'conclusion' | null = null
): TourReadingItem | null {
    if (view === 'conclusion') return items.find(item => item.kind === 'conclusion') ?? null;
    if (view === 'tour') {
        return items.find((item) => item.kind === 'title') ?? null;
    }

    const stepItem = items.find(
        (item) => item.kind === 'step' && item.sceneIndex === sceneIndex && item.stepIndex === stepIndex
    );
    if (view === null && stepItem) return stepItem;

    const sceneItemIndex = items.findIndex(
        (item) => item.kind === 'scene' && item.sceneIndex === sceneIndex
    );
    if (sceneItemIndex < 0) return null;

    if (view === 'overview') {
        return items[sceneItemIndex] ?? null;
    }

    if (view === 'chapter') {
        const sceneItem = items[sceneItemIndex];
        if (sceneItem.kind !== 'scene') return null;
        // Title-only chapters remain headings, so their links open the scene.
        return items.find(item => item.kind === 'chapter' && item.chapterId === sceneItem.chapterId) ?? sceneItem;
    }

    return stepItem ?? items[sceneItemIndex] ?? null;
}

function isSteppedScene(
    scene: ChangeTourScene
): scene is Extract<ChangeTourScene, { kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff' }> {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}
