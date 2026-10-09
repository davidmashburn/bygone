import type { ChangeTourManifest } from './changeTourManifest';
import type { TourReadingItem } from './tourReading';
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

export interface TourRouteEntry {
    sceneIndex: number;
    title: string;
    evidence: string;
}

/** Describe the authored route without treating scenes as commit or PR boundaries. */
export function buildTourRoute(tour: ChangeTourManifest): { summary: string; scenes: TourRouteEntry[] } {
    return {
        summary: `${tour.scenes.length} ${tour.scenes.length === 1 ? 'scene' : 'scenes'} in this tour. Scenes organize the explanation; steps point to the evidence. A scene can visit several files or revision pairs. The route below names those changes.`,
        scenes: tour.scenes.map((scene, sceneIndex) => ({ sceneIndex, title: scene.title, evidence: describeSceneRoute(tour, sceneIndex) }))
    };
}

export function describeSceneRoute(tour: ChangeTourManifest, sceneIndex: number): string {
    const scene = tour.scenes[sceneIndex];
    if (scene.kind === 'discussion') return 'Discussion: pause to connect the findings. No code comparison is displayed.';
    if (scene.kind === 'walkthrough' && scene.steps.every(step => step.image)) {
        return `${scene.steps.length} images in reading order. Each step explains what to notice in its image.`;
    }
    const items: TourReadingItem[] = 'steps' in scene
        ? scene.steps.flatMap((step, stepIndex) => 'image' in step && step.image ? [] : [{ kind: 'step' as const, key: `step:${scene.id}:${step.id}`, sceneIndex, stepIndex }])
        : [{ kind: 'scene', key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 }];
    const imageCount = scene.kind === 'walkthrough' ? scene.steps.filter(step => step.image).length : 0;
    const contexts = items.map(item => resolveTourEvidenceContext(tour, item)!).filter(Boolean);
    const files = contexts.map(context => context.scope).filter((path, index, paths) => index === 0 || path !== paths[index - 1]);
    const pairs = contexts.filter((context, index) => index === 0 || context.comparisonKey !== contexts[index - 1].comparisonKey);
    const evidence = `${'steps' in scene ? `${scene.steps.length} steps. ` : ''}${files.length === 1 ? 'File' : 'Files in order'}: ${files.join(' → ')}.`;
    const comparisons = `${scene.kind === 'deconstructed-diff' ? 'Explanation stages (constructed, not commits)' : 'Revisions'}: ${pairs.map(pair => pair.labels.join(' → ')).join('; then ')}.`;
    const overviewContext = 'overview' in scene && scene.overview
        ? resolveTourEvidenceContext(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 }) : null;
    const overview = overviewContext ? `Starts with a directory overview${overviewContext.comparisonKey !== contexts[0]?.comparisonKey ? ` (${overviewContext.labels.join(' → ')})` : ''}, then follows the evidence. ` : '';
    return `${overview}${evidence} ${comparisons}${imageCount ? ` Also includes ${imageCount} image ${imageCount === 1 ? 'step' : 'steps'}.` : ''}`;
}

/** Fixed reading-order cues also work on direct links and in audio playback. */
export function describeStepOrientation(tour: ChangeTourManifest, sceneIndex: number, stepIndex: number): string {
    const scene = tour.scenes[sceneIndex];
    if (!('steps' in scene)) return '';
    const step = scene.steps[stepIndex];
    const prefix = `Step ${stepIndex + 1} of ${scene.steps.length}.`;
    if ('image' in step && step.image) return `${prefix} Image: ${step.title}.`;
    const item = { kind: 'step' as const, key: `step:${scene.id}:${step.id}`, sceneIndex, stepIndex };
    const current = resolveTourEvidenceContext(tour, item)!;
    const previous = stepIndex > 0 && !(scene.kind === 'walkthrough' && scene.steps[stepIndex - 1].image)
        ? resolveTourEvidenceContext(tour, { ...item, stepIndex: stepIndex - 1 }) : null;
    if (!previous) return `${prefix} Evidence in ${current.scope}.`;
    const pairChanged = previous.comparisonKey !== current.comparisonKey;
    const fileChanged = previous.scope !== current.scope;
    const revisions = current.kind === 'synthetic' ? 'explanation stages' : 'revisions';
    const movement = pairChanged ? `Switch ${revisions} to ${current.labels.join(' → ')}.` : `Keep the same ${revisions}.`;
    return `${prefix} ${movement} ${fileChanged ? `Move from ${previous.scope} to ${current.scope}.` : `Continue in ${current.scope}.`}`;
}
