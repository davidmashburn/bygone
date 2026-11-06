import type {
    ChangeTourDeconstructedStep,
    ChangeTourManifest,
    ChangeTourScene,
    ChangeTourStackStep,
    ChangeTourWalkthroughStep
} from './changeTourManifest';
import type { TourReadingItem } from './tourReading';
import { getTourStepBranch } from './tourReading';
import { buildTourDirectoryEvidence } from './tourDirectoryEvidence';

export interface TourEvidenceContext {
    kind: 'real' | 'synthetic';
    /** Ordered resolved endpoints; labels never participate in equality. */
    comparisonKey: string;
    labels: [string, string];
    scope: string;
    scopeKey: string;
    overview: boolean;
}

export type TourLanding = 'narrative' | 'overview' | 'preview' | 'evidence';

export function tourLanding(tour: ChangeTourManifest, item: TourReadingItem): TourLanding {
    if (item.kind === 'title' || item.kind === 'chapter' || item.kind === 'conclusion') return 'narrative';
    const scene = tour.scenes[item.sceneIndex];
    if (!scene || scene.kind === 'discussion') return 'narrative';
    if (item.kind === 'step' || scene.kind === 'text-diff') return 'evidence';
    return scene.overview ? 'overview' : 'preview';
}

export function resolveTourEvidenceContext(
    tour: ChangeTourManifest, item: TourReadingItem, documentKey = '', activePairIndex?: number
): TourEvidenceContext | null {
    const landing = tourLanding(tour, item);
    if (landing === 'narrative') return null;
    const scene = tour.scenes[item.sceneIndex];
    const overview = landing === 'overview';
    const step = 'steps' in scene ? scene.steps[item.kind === 'step' ? item.stepIndex : 0] : undefined;
    let endpoints = [tour.range.mergeBaseOid, tour.range.headOid];
    let labels: [string, string] = [realLabel(tour.range.baseRef, endpoints[0]), realLabel(tour.range.headRef, endpoints[1])];
    const kind = scene.kind === 'deconstructed-diff' ? 'synthetic' : 'real';
    if (scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff') {
        const panels = scene.kind === 'stacked-diff' ? scene.stack : scene.panels;
        const pair = activePairIndex ?? (step && 'pairIndex' in step ? step.pairIndex : 0);
        const from = overview ? (scene.overview?.comparison ? panels.findIndex(panel => panel.id === scene.overview?.comparison?.from) : 0) : pair;
        const to = overview ? (scene.overview?.comparison ? panels.findIndex(panel => panel.id === scene.overview?.comparison?.to) : panels.length - 1) : pair + 1;
        if (!panels[from] || !panels[to]) throw new Error(`Scene ${scene.id} has unavailable comparison endpoints.`);
        if (scene.kind === 'stacked-diff') {
            endpoints = [scene.stack[from].oid, scene.stack[to].oid];
            labels = [realLabel(panels[from].label, endpoints[0]), realLabel(panels[to].label, endpoints[1])];
        } else {
            endpoints = [panels[from].id, panels[to].id];
            labels = [panels[from].label, panels[to].label];
        }
    }
    const scope = overview ? `Directory: ${('overview' in scene && scene.overview?.path) || '/'} (authored inventory)`
        : scene.kind === 'text-diff' ? scene.path : step && 'diff' in step ? step.diff.path : step && 'file' in step ? step.file : '';
    const inventory = overview ? buildTourDirectoryEvidence(tour, scene) : null;
    return {
        kind, labels, scope, overview,
        comparisonKey: JSON.stringify(kind === 'real' ? [kind, ...endpoints]
            : [kind, documentKey, tour.generatedAt, tour.range.mergeBaseOid, tour.range.headOid, scene.id, ...endpoints]),
        scopeKey: JSON.stringify([scope, ...(inventory ? [...inventory.files, ...inventory.omitted].map(file => file.path).sort() : [])])
    };
}

/** File exploration and search can display the enclosing real range outside a scene. */
export function resolveTourRangeEvidenceContext(tour: ChangeTourManifest, path: string): TourEvidenceContext {
    const endpoints = [tour.range.mergeBaseOid, tour.range.headOid];
    return {
        kind: 'real', comparisonKey: JSON.stringify(['real', ...endpoints]),
        labels: [realLabel(tour.range.baseRef, endpoints[0]), realLabel(tour.range.headRef, endpoints[1])],
        scope: path, scopeKey: JSON.stringify([path]), overview: false
    };
}

export function describeTourComparison(context: TourEvidenceContext): string {
    return `${context.kind === 'synthetic' ? 'Explanation stages' : 'Comparison'}: ${context.labels.join(' → ')} · ${context.scope}`;
}

export function describeTourTransition(previous: TourEvidenceContext | null, current: TourEvidenceContext): string {
    if (!previous) return describeTourComparison(current);
    if (previous.kind !== current.kind) return `${current.kind === 'synthetic' ? 'Switching to explanation stages' : 'Switching to real revisions'}. ${describeTourComparison(current)}`;
    if (previous.comparisonKey !== current.comparisonKey) return `${current.kind === 'synthetic' ? 'Explanation stages changed' : 'Revision comparison changed'}: ${previous.labels.join(' → ')} to ${current.labels.join(' → ')} · ${current.scope}`;
    const movement = previous.scopeKey !== current.scopeKey
        ? `${previous.overview || current.overview ? 'view' : 'file'} changed from ${previous.scope} to ${current.scope}`
        : `same ${current.overview ? 'directory view' : 'file'}: ${current.scope}`;
    return `Same ${current.kind === 'synthetic' ? 'explanation stages' : 'revision comparison'}; ${movement} · ${current.labels.join(' → ')}`;
}

function realLabel(label: string, oid: string): string {
    return label === oid || label === oid.slice(0, 7) ? oid.slice(0, 7) : `${label} (${oid.slice(0, 7)})`;
}

export function tourReadingTitle(tour: ChangeTourManifest, item: TourReadingItem): string {
    if (item.kind === 'title') return tour.opening?.title || tour.title;
    if (item.kind === 'conclusion') return tour.conclusion?.title || 'Conclusion';
    if (item.kind === 'chapter') {
        const index = tour.chapters.findIndex(chapter => chapter.id === item.chapterId);
        return tour.chapters[index].title;
    }
    const scene = tour.scenes[item.sceneIndex];
    if (item.kind === 'step' && 'steps' in scene) return scene.steps[item.stepIndex].title;
    return scene.title;
}

export interface TourRouteEntry {
    sceneIndex: number;
    title: string;
    purpose: string;
    evidence: string;
}

export interface TourChapterRoute {
    chapterIndex: number;
    chapterId: string;
    title: string;
    summary?: string;
    evidence: string;
    scenes: TourRouteEntry[];
}

function sceneEvidenceContexts(tour: ChangeTourManifest, sceneIndex: number): TourEvidenceContext[] {
    const scene = tour.scenes[sceneIndex];
    if (scene.kind === 'discussion') return [];
    const steps = 'steps' in scene ? mainSceneSteps(scene) : [];
    const allSteps = 'steps' in scene ? steppedSceneSteps(scene) : [];
    const items: TourReadingItem[] = 'steps' in scene
        ? steps.flatMap((step: TourStep) => 'image' in step && step.image ? [] : [{ kind: 'step' as const, key: `step:${scene.id}:${step.id}`, sceneIndex, stepIndex: allSteps.findIndex(candidate => candidate.id === step.id) }])
        : [{ kind: 'scene', key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 }];
    return items.map(item => resolveTourEvidenceContext(tour, item)!).filter(Boolean);
}

/** Describe the authored route without treating chapters or scenes as commit or PR boundaries. */
export function buildTourRoute(tour: ChangeTourManifest): { summary: string; chapters: TourChapterRoute[]; scenes: TourRouteEntry[] } {
    const scenes = tour.scenes.map((scene, sceneIndex) => ({ sceneIndex,
        title: tourReadingTitle(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 }),
        purpose: scene.summary, evidence: describeSceneRoute(tour, sceneIndex) }));
    const chapters = (tour.chapters || []).map((chapter, chapterIndex) => {
        const entries = scenes.filter(entry => chapter.sceneIds.includes(tour.scenes[entry.sceneIndex].id));
        const contexts = entries.flatMap(entry => sceneEvidenceContexts(tour, entry.sceneIndex));
        const comparisons = [...contexts];
        for (const entry of entries) {
            const scene = tour.scenes[entry.sceneIndex];
            if ('overview' in scene && scene.overview && !(scene.kind === 'walkthrough' && mainSceneSteps(scene).every(step => 'image' in step && step.image))) {
                const context = resolveTourEvidenceContext(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex: entry.sceneIndex, stepIndex: 0 });
                if (context) comparisons.push(context);
            }
        }
        const pairs = comparisons.filter((context, index) => comparisons.findIndex(candidate => candidate.comparisonKey === context.comparisonKey) === index);
        const files = [...new Set(contexts.map(context => context.scope))];
        const steps = entries.reduce((total, entry) => {
            const scene = tour.scenes[entry.sceneIndex];
            return total + ('steps' in scene ? mainSceneSteps(scene).length : 0);
        }, 0);
        const scope = files.length ? `Focus files: ${files.join(', ')}.` : 'No code steps; this chapter uses discussion or images.';
        const ranges = pairs.map(pair => `${pair.kind === 'synthetic' ? 'Constructed stages' : 'Revisions'}: ${pair.labels.join(' → ')}.`).join(' ');
        return { chapterIndex, chapterId: chapter.id, title: chapter.title,
            ...(chapter.summary ? { summary: chapter.summary } : {}),
            evidence: `${entries.length} ${entries.length === 1 ? 'scene' : 'scenes'} · ${steps} ${steps === 1 ? 'step' : 'steps'}. ${scope}${ranges ? ` ${ranges}` : ''}`, scenes: entries };
    });
    const stepCount = tour.scenes.reduce((count, scene) => count + ('steps' in scene ? mainSceneSteps(scene).length : 0), 0);
    return {
        summary: `${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'} → ${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} → ${stepCount} ${stepCount === 1 ? 'step' : 'steps'}. Chapters group topics; scenes explain one idea; steps show the evidence.`,
        chapters, scenes
    };
}

export function describeSceneRoute(tour: ChangeTourManifest, sceneIndex: number): string {
    const scene = tour.scenes[sceneIndex];
    if (scene.kind === 'discussion') return 'Discussion: pause to connect the findings. No code comparison is displayed.';
    const steps = 'steps' in scene ? mainSceneSteps(scene) : [];
    if (scene.kind === 'walkthrough' && steps.length > 0 && steps.every(step => 'image' in step && step.image)) {
        return `${steps.length} images in reading order. Each step explains what to notice in its image.`;
    }
    const imageCount = scene.kind === 'walkthrough' ? steps.filter(step => 'image' in step && step.image).length : 0;
    const contexts = sceneEvidenceContexts(tour, sceneIndex);
    const files = contexts.map(context => context.scope).filter((path, index, paths) => index === 0 || path !== paths[index - 1]);
    const pairs = contexts.filter((context, index) => index === 0 || context.comparisonKey !== contexts[index - 1].comparisonKey);
    const evidence = `${'steps' in scene ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}. ` : ''}${files.length === 1 ? 'File' : 'Files in order'}: ${files.join(' → ')}.`;
    const comparisons = `${scene.kind === 'deconstructed-diff' ? 'Explanation stages (constructed, not commits)' : 'Revisions'}: ${pairs.map(pair => pair.labels.join(' → ')).join('; then ')}.`;
    const overviewContext = 'overview' in scene && scene.overview
        ? resolveTourEvidenceContext(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 }) : null;
    const overview = overviewContext ? `Starts with a directory overview${overviewContext.comparisonKey !== contexts[0]?.comparisonKey ? ` (${overviewContext.labels.join(' → ')})` : ''}, then follows the evidence. ` : '';
    return `${overview}${evidence} ${comparisons}${imageCount ? ` Also includes ${imageCount} image ${imageCount === 1 ? 'step' : 'steps'}.` : ''}`;
}

/** Fixed reading-order cues also work on direct links and in audio playback. */
export enum TourOrientationDetail {
    Full = 'full',
    Changes = 'changes'
}

/** Short names remain unambiguous when a tour contains duplicate basenames. */
export function tourEvidenceName(tour: ChangeTourManifest, path: string): string {
    const basename = path.split('/').at(-1) || path;
    const paths = new Set(tour.scenes.flatMap(scene => scene.kind === 'text-diff' ? [scene.path]
        : 'steps' in scene ? scene.steps.map(step => 'diff' in step ? step.diff.path : 'file' in step ? step.file : '') : []));
    return [...paths].filter(candidate => candidate.split('/').at(-1) === basename).length > 1 ? path : basename;
}

export function describeStepOrientation(tour: ChangeTourManifest, sceneIndex: number, stepIndex: number, detail = TourOrientationDetail.Changes): string {
    const scene = tour.scenes[sceneIndex];
    if (!('steps' in scene)) return '';
    const allSteps = steppedSceneSteps(scene);
    const step = allSteps[stepIndex];
    if ('image' in step && step.image) return '';
    const branch = getTourStepBranch(step);
    const routeSteps = branch
        ? allSteps.filter(candidate => getTourStepBranch(candidate)?.id === branch.id)
        : mainSceneSteps(scene);
    const routeIndex = routeSteps.findIndex(candidate => candidate.id === step.id);
    const item = { kind: 'step' as const, key: `step:${scene.id}:${step.id}`, sceneIndex, stepIndex };
    const current = resolveTourEvidenceContext(tour, item)!;
    const name = tourEvidenceName(tour, current.scope);
    const revisions = current.kind === 'synthetic' ? 'Explanation stages' : 'Revisions';
    if (detail === TourOrientationDetail.Full) return `Evidence: ${name}.`
        + (scene.kind === 'walkthrough' ? '' : ` ${revisions}: ${current.labels.join(' → ')}.`);
    const previousStep = routeSteps[routeIndex - 1];
    const previousStepIndex = previousStep ? allSteps.findIndex(candidate => candidate.id === previousStep.id) : -1;
    const previous = previousStepIndex >= 0 && !('image' in previousStep && previousStep.image)
        ? resolveTourEvidenceContext(tour, { ...item, stepIndex: previousStepIndex }) : null;
    if (!previous) return current.kind === 'synthetic'
        ? `Explanation stages: ${current.labels.join(' → ')}. Evidence: ${name}.` : `Evidence: ${name}.`;
    const movement = previous.comparisonKey !== current.comparisonKey
        ? `${revisions} changed: ${current.labels.join(' → ')}.` : '';
    const location = previous.scope !== current.scope ? `File changed: ${name}.` : '';
    return [movement, location].filter(Boolean).join(' ');
}

type SteppedScene = Extract<ChangeTourScene, { kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff' }>;
type TourStep = ChangeTourWalkthroughStep | ChangeTourStackStep | ChangeTourDeconstructedStep;

function steppedSceneSteps(scene: SteppedScene): TourStep[] {
    const steps: TourStep[] = [];
    for (const step of scene.steps) steps.push(step);
    return steps;
}

function mainSceneSteps(scene: SteppedScene): TourStep[] {
    return steppedSceneSteps(scene).filter(step => !getTourStepBranch(step));
}
