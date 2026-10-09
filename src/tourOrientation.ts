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
    if (previous.comparisonKey !== current.comparisonKey) return `Comparison changed: ${previous.labels.join(' → ')} to ${current.labels.join(' → ')} · ${current.scope}`;
    return `Same comparison${previous.scopeKey !== current.scopeKey ? '; scope changed' : ''}: ${current.labels.join(' → ')} · ${current.scope}`;
}

function realLabel(label: string, oid: string): string {
    return label === oid || label === oid.slice(0, 7) ? oid.slice(0, 7) : `${label} (${oid.slice(0, 7)})`;
}
