import type {
    ChangeTourChapter,
    ChangeTourManifest,
    ChangeTourModeTour,
    ChangeTourScene,
    ChangeTourStackStep,
    ChangeTourStepBranch,
    ChangeTourWalkthroughStep
} from './changeTourManifest';
import { getTourStepBranch } from './tourReading';

/** The authored modes exposed by the presentation host's authoredTours helper. */
export const TOUR_RELATED_MODE = {
    HISTORICAL: 'historical',
    DECONSTRUCTED: 'deconstructed'
} as const;

export type TourRelatedMode = typeof TOUR_RELATED_MODE[keyof typeof TOUR_RELATED_MODE];

export const TOUR_RELATED_SIDE = {
    LEFT: 'left',
    RIGHT: 'right'
} as const;

export type TourRelatedSide = typeof TOUR_RELATED_SIDE[keyof typeof TOUR_RELATED_SIDE];

export const TOUR_RELATED_QUERY_KIND = {
    REAL: 'real',
    SYNTHETIC: 'synthetic'
} as const;

export type TourRelatedQueryKind = typeof TOUR_RELATED_QUERY_KIND[keyof typeof TOUR_RELATED_QUERY_KIND];

export const TOUR_RELATED_RESULT_KIND = {
    MATCHES: 'matches',
    NO_MATCH: 'no-match',
    UNAVAILABLE: 'unavailable',
    UNSUPPORTED: 'unsupported'
} as const;

export type TourRelatedResultKind = typeof TOUR_RELATED_RESULT_KIND[keyof typeof TOUR_RELATED_RESULT_KIND];

export const TOUR_RELATED_UNAVAILABLE_REASON = {
    MISSING_PANE_PATH: 'missing-pane-path',
    MISSING_COMMIT: 'missing-commit',
    MISSING_RANGE: 'missing-range',
    INVALID_RANGE: 'invalid-range',
    MISSING_SYNTHETIC_IDENTITY: 'missing-synthetic-identity',
    MODE_UNAVAILABLE: 'mode-unavailable',
    TARGET_SCENE_UNAVAILABLE: 'target-scene-unavailable',
    TARGET_STEP_UNAVAILABLE: 'target-step-unavailable',
    STALE_INDEX: 'stale-index',
    MISSING_INDEX: 'missing-index'
} as const;

export type TourRelatedUnavailableReason = typeof TOUR_RELATED_UNAVAILABLE_REASON[
    keyof typeof TOUR_RELATED_UNAVAILABLE_REASON
];

export const TOUR_RELATED_UNSUPPORTED_REASON = {
    INVALID_QUERY: 'invalid-query',
    INVALID_MODE: 'invalid-mode',
    SYNTHETIC_COMMIT: 'synthetic-commit',
    UNSUPPORTED_EVIDENCE: 'unsupported-evidence'
} as const;

export type TourRelatedUnsupportedReason = typeof TOUR_RELATED_UNSUPPORTED_REASON[
    keyof typeof TOUR_RELATED_UNSUPPORTED_REASON
];

export const TOUR_RELATED_TARGET_RESULT_KIND = {
    RESOLVED: 'resolved',
    UNAVAILABLE: 'unavailable',
    UNSUPPORTED: 'unsupported'
} as const;

export type TourRelatedTargetResultKind = typeof TOUR_RELATED_TARGET_RESULT_KIND[
    keyof typeof TOUR_RELATED_TARGET_RESULT_KIND
];

export const TOUR_RELATED_EVIDENCE_ROLE = {
    FOCUS: 'focus',
    CONNECTION_FROM: 'connection-from',
    CONNECTION_TO: 'connection-to',
    STACK_STEP: 'stack-step'
} as const;

export type TourRelatedEvidenceRole = typeof TOUR_RELATED_EVIDENCE_ROLE[
    keyof typeof TOUR_RELATED_EVIDENCE_ROLE
];

export interface TourRelatedRealQuery {
    /** The canonical path in the rendered pane, not a basename. */
    panePath: string;
    /** The exact rendered revision OID. */
    commit: string;
    synthetic?: never;
    side: TourRelatedSide;
    /** Existing 1-based inclusive source coordinates. */
    startLine: number;
    endLine: number;
}

export interface TourRelatedSyntheticIdentity {
    mode: TourRelatedMode;
    sceneId: string;
    /** The virtual panel id, not a real Git revision. */
    panelId: string;
}

export interface TourRelatedSyntheticQuery {
    /** Synthetic panes still use the path and inclusive range rendered by the host. */
    panePath: string;
    commit?: never;
    synthetic: TourRelatedSyntheticIdentity;
    side: TourRelatedSide;
    startLine: number;
    endLine: number;
}

export type TourRelatedQuery = TourRelatedRealQuery | TourRelatedSyntheticQuery;

export interface TourRelatedTarget {
    mode: TourRelatedMode;
    sceneId: string;
    stepId: string;
}

export type TourRelatedBranch = Readonly<ChangeTourStepBranch>;

export interface TourRelatedRealEvidence {
    kind: typeof TOUR_RELATED_QUERY_KIND.REAL;
    /** The loaded manifest's repository identity. Index instance identity is authoritative. */
    repository?: string;
    path: string;
    commit: string;
    side: TourRelatedSide;
    startLine: number;
    endLine: number;
}

export interface TourRelatedSyntheticEvidence {
    kind: typeof TOUR_RELATED_QUERY_KIND.SYNTHETIC;
    /** The loaded manifest's repository identity, when supplied by the manifest. */
    repository?: string;
    mode: TourRelatedMode;
    sceneId: string;
    panelId: string;
    path: string;
    side: TourRelatedSide;
    startLine: number;
    endLine: number;
}

export type TourRelatedEvidence = TourRelatedRealEvidence | TourRelatedSyntheticEvidence;

export interface TourRelatedEvidenceReference {
    role: TourRelatedEvidenceRole;
    evidence: TourRelatedEvidence;
}

export interface TourRelatedMatch {
    target: TourRelatedTarget;
    mode: TourRelatedMode;
    sceneId: string;
    sceneTitle: string;
    stepId: string;
    stepTitle: string;
    chapterId?: string;
    chapterTitle?: string;
    optional: boolean;
    branch?: TourRelatedBranch;
    /** A short, prose-oriented explanation preview for the result row. */
    preview: string;
    /** A stable, disambiguating location label for the result row. */
    label: string;
    /** The reference that caused this query to match. */
    evidence: TourRelatedEvidence;
    /** All supported evidence references on this step, including connection roles. */
    references: readonly TourRelatedEvidenceReference[];
}

export interface TourRelatedMatchesResult {
    kind: typeof TOUR_RELATED_RESULT_KIND.MATCHES;
    matches: readonly TourRelatedMatch[];
}

export interface TourRelatedNoMatchResult {
    kind: typeof TOUR_RELATED_RESULT_KIND.NO_MATCH;
    matches: readonly [];
}

export interface TourRelatedUnavailableResult {
    kind: typeof TOUR_RELATED_RESULT_KIND.UNAVAILABLE;
    reason: TourRelatedUnavailableReason;
}

export interface TourRelatedUnsupportedResult {
    kind: typeof TOUR_RELATED_RESULT_KIND.UNSUPPORTED;
    reason: TourRelatedUnsupportedReason;
}

export type TourRelatedResult = TourRelatedMatchesResult
    | TourRelatedNoMatchResult
    | TourRelatedUnavailableResult
    | TourRelatedUnsupportedResult;

export interface TourRelatedIndexedStep {
    target: TourRelatedTarget;
    mode: TourRelatedMode;
    sceneId: string;
    sceneTitle: string;
    stepId: string;
    stepTitle: string;
    chapterId?: string;
    chapterTitle?: string;
    optional: boolean;
    branch?: TourRelatedBranch;
    preview: string;
    label: string;
    references: readonly TourRelatedEvidenceReference[];
}

export interface TourRelatedIndex {
    /** The exact loaded manifest object this derived index belongs to. */
    readonly manifest: ChangeTourManifest;
    readonly repository?: string;
    /** Authored order: historical, deconstructed; then scene and step order. */
    readonly steps: readonly TourRelatedIndexedStep[];
}

export interface TourRelatedQueryOptions {
    /** A current manifest may be supplied to reject an index from an old load. */
    currentManifest?: ChangeTourManifest;
}

export interface TourRelatedResolvedTarget {
    kind: typeof TOUR_RELATED_TARGET_RESULT_KIND.RESOLVED;
    target: TourRelatedTarget;
    sceneIndex: number;
    stepIndex: number;
    readingKey: string;
    branch?: TourRelatedBranch;
    /** Direct owning step for an optional branch, for normal return navigation. */
    parentTarget?: TourRelatedTarget;
}

export interface TourRelatedTargetUnavailableResult {
    kind: typeof TOUR_RELATED_TARGET_RESULT_KIND.UNAVAILABLE;
    reason: TourRelatedUnavailableReason;
}

export interface TourRelatedTargetUnsupportedResult {
    kind: typeof TOUR_RELATED_TARGET_RESULT_KIND.UNSUPPORTED;
    reason: TourRelatedUnsupportedReason;
}

export type TourRelatedTargetResolution = TourRelatedResolvedTarget
    | TourRelatedTargetUnavailableResult
    | TourRelatedTargetUnsupportedResult;

type TourRelatedModeTour = Pick<ChangeTourModeTour, 'chapters' | 'scenes'>;
type TourRelatedSteppedScene = Extract<ChangeTourScene, {
    kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff'
}>;

type ValidatedTourRelatedQuery =
    | {
        kind: typeof TOUR_RELATED_QUERY_KIND.REAL;
        panePath: string;
        commit: string;
        side: TourRelatedSide;
        startLine: number;
        endLine: number;
    }
    | {
        kind: typeof TOUR_RELATED_QUERY_KIND.SYNTHETIC;
        panePath: string;
        mode: TourRelatedMode;
        sceneId: string;
        panelId: string;
        side: TourRelatedSide;
        startLine: number;
        endLine: number;
    };

const indexCache = new WeakMap<ChangeTourManifest, TourRelatedIndex>();

/**
 * Build or retrieve the derived index for one loaded manifest identity.
 * A newly loaded manifest object receives a separate index even when its bytes
 * happen to be identical to an older load.
 */
export function createTourRelatedIndex(manifest: ChangeTourManifest): TourRelatedIndex {
    const cached = indexCache.get(manifest);
    if (cached) return cached;
    const steps: TourRelatedIndexedStep[] = [];
    for (const [mode, tour] of authoredModeEntries(manifest)) {
        const chapterByScene = firstChapterByScene(tour.chapters);
        for (const scene of tour.scenes) {
            if (!isSteppedScene(scene)) continue;
            const chapter = chapterByScene.get(scene.id);
            for (const step of scene.steps) {
                const references = buildStepReferences(manifest, mode, scene, step);
                if (references.length === 0) continue;
                const branch = getTourStepBranch(step);
                const target: TourRelatedTarget = { mode, sceneId: scene.id, stepId: step.id };
                const preview = stepPreview(step, scene);
                steps.push({
                    target,
                    mode,
                    sceneId: scene.id,
                    sceneTitle: scene.title,
                    stepId: step.id,
                    stepTitle: step.title,
                    ...(chapter ? { chapterId: chapter.id, chapterTitle: chapter.title } : {}),
                    optional: Boolean(branch),
                    ...(branch ? { branch } : {}),
                    preview,
                    label: stepLabel(mode, chapter, scene.title, step.title, branch),
                    references
                });
            }
        }
    }
    const index: TourRelatedIndex = {
        manifest,
        ...(manifest.repository?.root ? { repository: manifest.repository.root } : {}),
        steps
    };
    indexCache.set(manifest, index);
    return index;
}

/** Index identity is deliberately reference-based; equal bytes are not an identity proof. */
function isTourRelatedIndexFor(index: TourRelatedIndex, manifest: ChangeTourManifest): boolean {
    return index.manifest === manifest;
}

/** Return the modes that the presentation host can open as authored tours. */
export function getTourRelatedAuthoredModes(manifest: ChangeTourManifest): TourRelatedMode[] {
    return authoredModeEntries(manifest).map(([mode]) => mode);
}

/**
 * Query exact rendered evidence. Real queries require the exact revision OID;
 * synthetic queries require mode/scene/panel identity and intentionally have no
 * commit field.
 */
export function queryTourRelated(
    index: TourRelatedIndex,
    query: TourRelatedQuery,
    options: TourRelatedQueryOptions = {}
): TourRelatedResult {
    if (!index) return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_INDEX);
    const currentManifest = options.currentManifest;
    if (currentManifest && !isTourRelatedIndexFor(index, currentManifest)) {
        return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.STALE_INDEX);
    }

    const validated = validateQuery(query);
    if ('result' in validated) return validated.result;
    const validatedQuery = validated.query;
    if (validatedQuery.kind === TOUR_RELATED_QUERY_KIND.SYNTHETIC) {
        if (!authoredModeEntries(index.manifest).some(([mode]) => mode === validatedQuery.mode)) {
            return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MODE_UNAVAILABLE);
        }
    }

    const matches: TourRelatedMatch[] = [];
    for (const step of index.steps) {
        const matchedReference = step.references.find(reference => evidenceMatches(reference.evidence, validatedQuery));
        if (!matchedReference) continue;
        matches.push({ ...step, evidence: matchedReference.evidence });
    }
    return matches.length > 0 ? { kind: TOUR_RELATED_RESULT_KIND.MATCHES, matches } : noMatch();
}

/**
 * Resolve a stable mode/scene/step target through the same authored-mode
 * mapping used by the host. The returned indexes and reading key can be handed
 * to normal tour navigation; optional branches also expose their owning step.
 */
export function resolveTourRelatedTarget(
    manifest: ChangeTourManifest,
    target: TourRelatedTarget
): TourRelatedTargetResolution {
    if (!manifest || !target || typeof target !== 'object') {
        return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_INDEX) as TourRelatedTargetUnavailableResult;
    }
    if (!isTourRelatedMode(target.mode)) {
        return unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_MODE) as TourRelatedTargetUnsupportedResult;
    }
    if (typeof target.sceneId !== 'string' || !target.sceneId
        || typeof target.stepId !== 'string' || !target.stepId) {
        return unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_QUERY) as TourRelatedTargetUnsupportedResult;
    }
    const tour = authoredModeEntries(manifest).find(([mode]) => mode === target.mode)?.[1];
    if (!tour) return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MODE_UNAVAILABLE) as TourRelatedTargetUnavailableResult;
    const sceneIndex = tour.scenes.findIndex(scene => scene.id === target.sceneId);
    if (sceneIndex < 0) return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.TARGET_SCENE_UNAVAILABLE) as TourRelatedTargetUnavailableResult;
    const scene = tour.scenes[sceneIndex];
    if (!isSteppedScene(scene)) {
        return unsupported(TOUR_RELATED_UNSUPPORTED_REASON.UNSUPPORTED_EVIDENCE) as TourRelatedTargetUnsupportedResult;
    }
    const stepIndex = scene.steps.findIndex(step => step.id === target.stepId);
    if (stepIndex < 0) return unavailable(TOUR_RELATED_UNAVAILABLE_REASON.TARGET_STEP_UNAVAILABLE) as TourRelatedTargetUnavailableResult;
    const step = scene.steps[stepIndex];
    const branch = getTourStepBranch(step);
    const parentTarget = branch && scene.steps.some(candidate => candidate.id === branch.parentStepId)
        ? { mode: target.mode, sceneId: target.sceneId, stepId: branch.parentStepId }
        : undefined;
    return {
        kind: TOUR_RELATED_TARGET_RESULT_KIND.RESOLVED,
        target: { ...target },
        sceneIndex,
        stepIndex,
        readingKey: `step:${scene.id}:${step.id}`,
        ...(branch ? { branch } : {}),
        ...(parentTarget ? { parentTarget } : {})
    };
}

function authoredModeEntries(manifest: ChangeTourManifest): Array<[TourRelatedMode, TourRelatedModeTour]> {
    if (manifest.tours) {
        const entries: Array<[TourRelatedMode, TourRelatedModeTour]> = [];
        if (manifest.tours.historical) entries.push([TOUR_RELATED_MODE.HISTORICAL, manifest.tours.historical]);
        if (manifest.tours.deconstructed) entries.push([TOUR_RELATED_MODE.DECONSTRUCTED, manifest.tours.deconstructed]);
        return entries;
    }

    const hasDeconstructed = manifest.scenes.some(scene => scene.kind === 'deconstructed-diff');
    if (!hasDeconstructed) {
        return [[TOUR_RELATED_MODE.HISTORICAL, manifest]];
    }

    const final = manifest.zoom?.final;
    const legacyHistorical = final && final.scenes.some(scene => scene.kind === 'walkthrough')
        ? final
        : undefined;
    return [
        ...(legacyHistorical ? [[TOUR_RELATED_MODE.HISTORICAL, legacyHistorical] as [TourRelatedMode, TourRelatedModeTour]] : []),
        [TOUR_RELATED_MODE.DECONSTRUCTED, manifest]
    ];
}

function firstChapterByScene(chapters: readonly ChangeTourChapter[]): Map<string, ChangeTourChapter> {
    const result = new Map<string, ChangeTourChapter>();
    for (const chapter of chapters) {
        for (const sceneId of chapter.sceneIds) {
            if (!result.has(sceneId)) result.set(sceneId, chapter);
        }
    }
    return result;
}

function isSteppedScene(scene: ChangeTourScene): scene is TourRelatedSteppedScene {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}

function buildStepReferences(
    manifest: ChangeTourManifest,
    mode: TourRelatedMode,
    scene: TourRelatedSteppedScene,
    step: TourRelatedSteppedScene['steps'][number]
): TourRelatedEvidenceReference[] {
    if (scene.kind === 'walkthrough') {
        const walkthroughStep = step as ChangeTourWalkthroughStep;
        const references: TourRelatedEvidenceReference[] = [];
        const focus = realAnchorEvidence(manifest, walkthroughStep.focus);
        if (focus) references.push({ role: TOUR_RELATED_EVIDENCE_ROLE.FOCUS, evidence: focus });
        if (walkthroughStep.connection) {
            const from = realAnchorEvidence(manifest, walkthroughStep.connection.from);
            const to = realAnchorEvidence(manifest, walkthroughStep.connection.to);
            if (from) references.push({ role: TOUR_RELATED_EVIDENCE_ROLE.CONNECTION_FROM, evidence: from });
            if (to) references.push({ role: TOUR_RELATED_EVIDENCE_ROLE.CONNECTION_TO, evidence: to });
        }
        return references;
    }

    if (scene.kind === 'stacked-diff') {
        const evidence = stackStepEvidence(manifest, scene, step as ChangeTourStackStep);
        return evidence ? [{ role: TOUR_RELATED_EVIDENCE_ROLE.STACK_STEP, evidence }] : [];
    }

    const evidence = syntheticStepEvidence(manifest, mode, scene, step as Extract<ChangeTourScene, { kind: 'deconstructed-diff' }>['steps'][number]);
    return evidence ? [{ role: TOUR_RELATED_EVIDENCE_ROLE.STACK_STEP, evidence }] : [];
}

function realAnchorEvidence(
    manifest: ChangeTourManifest,
    anchor: ChangeTourWalkthroughStep['focus']
): TourRelatedRealEvidence | null {
    const range = anchor && lineRange(anchor.startLine, anchor.endLine);
    if (!anchor || typeof anchor.path !== 'string' || !anchor.path || !range
        || (anchor.revision !== 'base' && anchor.revision !== 'head')) return null;
    const commit = anchor.revision === 'base' ? manifest.range.mergeBaseOid : manifest.range.headOid;
    if (typeof commit !== 'string' || !commit) return null;
    return {
        kind: TOUR_RELATED_QUERY_KIND.REAL,
        ...(manifest.repository?.root ? { repository: manifest.repository.root } : {}),
        path: anchor.path,
        commit,
        side: anchor.revision === 'base' ? TOUR_RELATED_SIDE.LEFT : TOUR_RELATED_SIDE.RIGHT,
        startLine: range.startLine,
        endLine: range.endLine
    };
}

function stackStepEvidence(
    manifest: ChangeTourManifest,
    scene: Extract<ChangeTourScene, { kind: 'stacked-diff' }>,
    step: ChangeTourStackStep
): TourRelatedRealEvidence | null {
    const range = lineRange(step.startLine, step.endLine);
    if (!range) return null;
    if ((step.side !== TOUR_RELATED_SIDE.LEFT && step.side !== TOUR_RELATED_SIDE.RIGHT)
        || !Number.isInteger(step.pairIndex) || step.pairIndex < 0) return null;
    const panelIndex = step.pairIndex + (step.side === TOUR_RELATED_SIDE.RIGHT ? 1 : 0);
    const panel = scene.stack[panelIndex];
    const file = scene.files.find(candidate => candidate.path === step.file);
    const filePanel = file?.panels[panelIndex];
    if (!panel || !file || !filePanel || filePanel.exists === false) return null;
    const path = filePanel?.path || file.path;
    if (typeof path !== 'string' || !path || typeof panel.oid !== 'string' || !panel.oid) return null;
    return {
        kind: TOUR_RELATED_QUERY_KIND.REAL,
        ...(manifest.repository?.root ? { repository: manifest.repository.root } : {}),
        path,
        commit: panel.oid,
        side: step.side,
        startLine: range.startLine,
        endLine: range.endLine
    };
}

function syntheticStepEvidence(
    manifest: ChangeTourManifest,
    mode: TourRelatedMode,
    scene: Extract<ChangeTourScene, { kind: 'deconstructed-diff' }>,
    step: Extract<ChangeTourScene, { kind: 'deconstructed-diff' }>['steps'][number]
): TourRelatedSyntheticEvidence | null {
    const range = lineRange(step.startLine, step.endLine);
    if (!range) return null;
    if ((step.side !== TOUR_RELATED_SIDE.LEFT && step.side !== TOUR_RELATED_SIDE.RIGHT)
        || !Number.isInteger(step.pairIndex) || step.pairIndex < 0) return null;
    const panelIndex = step.pairIndex + (step.side === TOUR_RELATED_SIDE.RIGHT ? 1 : 0);
    const virtualPanel = scene.panels[panelIndex];
    const file = scene.files.find(candidate => candidate.path === step.file);
    const filePanel = file?.panels[panelIndex];
    if (!virtualPanel || !file || !filePanel || filePanel.exists === false) return null;
    const path = filePanel?.path || file.path;
    if (typeof path !== 'string' || !path || typeof virtualPanel.id !== 'string' || !virtualPanel.id) return null;
    return {
        kind: TOUR_RELATED_QUERY_KIND.SYNTHETIC,
        ...(manifest.repository?.root ? { repository: manifest.repository.root } : {}),
        mode,
        sceneId: scene.id,
        panelId: virtualPanel.id,
        path,
        side: step.side,
        startLine: range.startLine,
        endLine: range.endLine
    };
}

function evidenceMatches(evidence: TourRelatedEvidence, query: ValidatedTourRelatedQuery): boolean {
    if (evidence.path !== query.panePath || evidence.side !== query.side) return false;
    if (!rangesIntersect(evidence.startLine, evidence.endLine, query.startLine, query.endLine)) return false;
    if (query.kind === TOUR_RELATED_QUERY_KIND.REAL) {
        return evidence.kind === TOUR_RELATED_QUERY_KIND.REAL && evidence.commit === query.commit;
    }
    return evidence.kind === TOUR_RELATED_QUERY_KIND.SYNTHETIC
        && evidence.mode === query.mode
        && evidence.sceneId === query.sceneId
        && evidence.panelId === query.panelId;
}

function validateQuery(
    query: TourRelatedQuery
): { query: ValidatedTourRelatedQuery } | { result: TourRelatedResult } {
    if (!query || typeof query !== 'object') return { result: unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_QUERY) };
    const candidate = query as unknown as Record<string, unknown>;
    const side = candidate.side;
    if (!isRelatedSide(side)) return { result: unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_QUERY) };
    if (typeof candidate.panePath !== 'string' || !candidate.panePath) {
        return { result: unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_PANE_PATH) };
    }
    const range = lineRange(candidate.startLine, candidate.endLine);
    if (!range) {
        return {
            result: candidate.startLine === undefined || candidate.endLine === undefined
                ? unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_RANGE)
                : unavailable(TOUR_RELATED_UNAVAILABLE_REASON.INVALID_RANGE)
        };
    }

    if (candidate.synthetic !== undefined) {
        if (candidate.commit !== undefined) {
            return { result: unsupported(TOUR_RELATED_UNSUPPORTED_REASON.SYNTHETIC_COMMIT) };
        }
        if (!candidate.synthetic || typeof candidate.synthetic !== 'object') {
            return { result: unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_QUERY) };
        }
        const synthetic = candidate.synthetic as Record<string, unknown>;
        if (!isTourRelatedMode(synthetic.mode)) {
            return { result: unsupported(TOUR_RELATED_UNSUPPORTED_REASON.INVALID_MODE) };
        }
        if (typeof synthetic.sceneId !== 'string' || !synthetic.sceneId
            || typeof synthetic.panelId !== 'string' || !synthetic.panelId) {
            return { result: unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_SYNTHETIC_IDENTITY) };
        }
        return {
            query: {
                kind: TOUR_RELATED_QUERY_KIND.SYNTHETIC,
                panePath: candidate.panePath,
                mode: synthetic.mode,
                sceneId: synthetic.sceneId,
                panelId: synthetic.panelId,
                side,
                startLine: range.startLine,
                endLine: range.endLine
            }
        };
    }

    if (typeof candidate.commit !== 'string' || !candidate.commit) {
        return { result: unavailable(TOUR_RELATED_UNAVAILABLE_REASON.MISSING_COMMIT) };
    }
    return {
        query: {
            kind: TOUR_RELATED_QUERY_KIND.REAL,
            panePath: candidate.panePath,
            commit: candidate.commit,
            side,
            startLine: range.startLine,
            endLine: range.endLine
        }
    };
}

function isTourRelatedMode(value: unknown): value is TourRelatedMode {
    return value === TOUR_RELATED_MODE.HISTORICAL || value === TOUR_RELATED_MODE.DECONSTRUCTED;
}

function isRelatedSide(value: unknown): value is TourRelatedSide {
    return value === TOUR_RELATED_SIDE.LEFT || value === TOUR_RELATED_SIDE.RIGHT;
}

function lineRange(startLine: unknown, endLine: unknown): { startLine: number; endLine: number } | null {
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;
    const normalizedStartLine = Number(startLine);
    const normalizedEndLine = Number(endLine);
    return normalizedStartLine >= 1 && normalizedEndLine >= normalizedStartLine
        ? { startLine: normalizedStartLine, endLine: normalizedEndLine }
        : null;
}

function rangesIntersect(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
    return leftStart <= rightEnd && rightStart <= leftEnd;
}

function stepPreview(step: TourRelatedSteppedScene['steps'][number], scene: TourRelatedSteppedScene): string {
    const connection = 'connection' in step ? step.connection?.label : undefined;
    const candidates = [step.body, connection, scene.summary, step.title];
    const preview = candidates.find(value => typeof value === 'string' && value.trim());
    return preview ? preview.trim().slice(0, 240) : step.title;
}

function stepLabel(
    mode: TourRelatedMode,
    chapter: ChangeTourChapter | undefined,
    sceneTitle: string,
    stepTitle: string,
    branch: TourRelatedBranch | undefined
): string {
    return [
        mode,
        chapter?.title,
        sceneTitle,
        stepTitle,
        branch ? `Optional · ${branch.title}` : undefined
    ].filter((part): part is string => Boolean(part && part.trim())).join(' · ');
}

function unavailable(reason: TourRelatedUnavailableReason): TourRelatedUnavailableResult {
    return { kind: TOUR_RELATED_RESULT_KIND.UNAVAILABLE, reason };
}

function unsupported(reason: TourRelatedUnsupportedReason): TourRelatedUnsupportedResult {
    return { kind: TOUR_RELATED_RESULT_KIND.UNSUPPORTED, reason };
}

function noMatch(): TourRelatedNoMatchResult {
    return { kind: TOUR_RELATED_RESULT_KIND.NO_MATCH, matches: [] };
}
