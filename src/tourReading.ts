import type { ChangeTourManifest, ChangeTourScene } from './changeTourManifest';

export type TourReadingItem =
    | { kind: 'title'; key: 'title'; sceneIndex: 0; stepIndex: 0 }
    | { kind: 'chapter'; key: string; chapterId: string; sceneIndex: number; stepIndex: 0 }
    | { kind: 'scene'; key: string; sceneIndex: number; stepIndex: 0 }
    | { kind: 'step'; key: string; sceneIndex: number; stepIndex: number };

/**
 * Build the continuous reading order for a tour.
 *
 * Scene order is the manifest's scene order. Chapters annotate that order at
 * the first scene they contain; they do not become a second ordering axis.
 */
export function buildTourReadingItems(
    tour: Pick<ChangeTourManifest, 'scenes' | 'chapters'>,
    includeSingleChapter = false
): TourReadingItem[] {
    const items: TourReadingItem[] = [
        { kind: 'title', key: 'title', sceneIndex: 0, stepIndex: 0 }
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
        if ((includeSingleChapter || tour.chapters.length > 1) && chapterId && !emittedChapterIds.has(chapterId)) {
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
            sceneIndex,
            stepIndex: 0
        });

        if (isSteppedScene(scene)) {
            scene.steps.forEach((step, stepIndex) => {
                items.push({
                    kind: 'step',
                    key: `step:${scene.id}:${step.id}`,
                    sceneIndex,
                    stepIndex
                });
            });
        }
    });

    return items;
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
        if (!stepsOnly || items[next].kind === 'step') return items[next];
    }
    return null;
}

/** A screenshot guide has structural headings, but only its images are stops. */
export function isImageOnlyTour(tour: Pick<ChangeTourManifest, 'scenes'>): boolean {
    return tour.scenes.length > 0 && tour.scenes.every(scene => scene.kind === 'walkthrough'
        && scene.steps.length > 0 && scene.steps.every(step => Boolean(step.image)));
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
    view: 'tour' | 'chapter' | 'overview' | null = null
): TourReadingItem | null {
    if (view === 'tour') {
        return items.find((item) => item.kind === 'title') ?? null;
    }

    const sceneItemIndex = items.findIndex(
        (item) => item.kind === 'scene' && item.sceneIndex === sceneIndex
    );
    if (sceneItemIndex < 0) return null;

    if (view === 'overview') {
        return items[sceneItemIndex] ?? null;
    }

    if (view === 'chapter') {
        for (let index = sceneItemIndex - 1; index >= 0; index -= 1) {
            const item = items[index];
            if (item.kind === 'chapter') return item;
            if (item.kind === 'title') break;
        }
        // A single chapter is intentionally omitted as a redundant level.
        return items.find((item) => item.kind === 'title') ?? null;
    }

    return items.find(
        (item) => item.kind === 'step' && item.sceneIndex === sceneIndex && item.stepIndex === stepIndex
    ) ?? items[sceneItemIndex] ?? null;
}

function isSteppedScene(
    scene: ChangeTourScene
): scene is Extract<ChangeTourScene, { kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff' }> {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}
