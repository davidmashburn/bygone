import type { ChangeTourManifest, ChangeTourScene } from './changeTourManifest';

export type TourSearchScope = 'all' | 'narrative' | 'code';

export type TourSearchMatch = Readonly<{
    kind: 'narrative';
    sceneIndex: number;
    stepIndex?: number;
    label: string;
    preview: string;
} | {
    kind: 'code';
    fileIndex: number;
    sideIndex: 0 | 1;
    lineNumber: number;
    startColumn: number;
    endColumn: number;
    label: string;
    preview: string;
}>;

export function searchTour(
    tour: ChangeTourManifest,
    query: string,
    scope: TourSearchScope = 'all',
    limit = 300
): TourSearchMatch[] {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || limit <= 0) return [];
    const matches: TourSearchMatch[] = [];

    if (scope !== 'code') {
        const chapterTitleByScene = new Map<string, string>();
        tour.chapters.forEach((chapter) => chapter.sceneIds.forEach((sceneId) => chapterTitleByScene.set(sceneId, chapter.title)));
        tour.scenes.forEach((scene, sceneIndex) => {
            const sceneText = [
                chapterTitleByScene.get(scene.id), scene.title, scene.summary,
                ...scene.bullets, ...scene.tags, scene.takeaway
            ];
            const scenePreview = firstContaining(sceneText, needle);
            if (scenePreview) {
                matches.push({ kind: 'narrative', sceneIndex, label: scene.title, preview: scenePreview });
            }
            if (isSteppedScene(scene)) {
                scene.steps.forEach((step, stepIndex) => {
                    const stepPreview = firstContaining([
                        step.title, step.body,
                        'connection' in step ? step.connection?.label : undefined
                    ], needle);
                    if (stepPreview) {
                        matches.push({
                            kind: 'narrative', sceneIndex, stepIndex,
                            label: `${scene.title} · ${step.title}`,
                            preview: stepPreview
                        });
                    }
                });
            }
        });
    }

    if (scope !== 'narrative' && matches.length < limit) {
        for (let fileIndex = 0; fileIndex < tour.files.length; fileIndex += 1) {
            const file = tour.files[fileIndex];
            if (file.kind !== 'text-diff') continue;
            for (const [sideIndex, content] of [[0, file.leftContent], [1, file.rightContent]] as const) {
                for (const match of findCodeMatches(content, needle)) {
                    matches.push({
                        kind: 'code', fileIndex, sideIndex, label: `${file.path} · ${sideIndex === 0 ? 'base' : 'head'}`,
                        ...match
                    });
                    if (matches.length >= limit) return matches;
                }
            }
        }
    }
    return matches.slice(0, limit);
}

function firstContaining(values: Array<string | undefined>, needle: string): string | undefined {
    return values.find((value) => value?.toLocaleLowerCase().includes(needle));
}

function findCodeMatches(content: string, needle: string) {
    const matches: Array<{ lineNumber: number; startColumn: number; endColumn: number; preview: string }> = [];
    content.replace(/\r\n/g, '\n').split('\n').forEach((line, lineIndex) => {
        const haystack = line.toLocaleLowerCase();
        let offset = 0;
        while (offset <= haystack.length - needle.length) {
            const index = haystack.indexOf(needle, offset);
            if (index < 0) break;
            matches.push({
                lineNumber: lineIndex + 1,
                startColumn: index + 1,
                endColumn: index + needle.length + 1,
                preview: line
            });
            offset = index + Math.max(needle.length, 1);
        }
    });
    return matches;
}

function isSteppedScene(
    scene: ChangeTourScene
): scene is Extract<ChangeTourScene, { kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff' }> {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}
