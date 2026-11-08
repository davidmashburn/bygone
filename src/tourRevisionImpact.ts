import {
    pinSourceRef,
    relocateSourceRefs,
    type SourceRef,
    type SourceSnapshot,
    type SourceTransition
} from 'bygone-strand/source-references';
import {
    buildChangeInventory,
    type ChangeInventory,
    type ChangeInventoryFile,
    type ChangeUnit
} from './changeInventory';
import {
    type ChangeTourDeconstructedScene,
    type ChangeTourManifest,
    type ChangeTourModeTour,
    type ChangeTourScene,
    type ChangeTourStackedScene,
    type ChangeTourStackStep,
    type ChangeTourWalkthroughScene,
    type ChangeTourWalkthroughStep
} from './changeTourManifest';
import { serializeDocumentFragment } from './deepLink';
import { loadChangeCorrespondence, type ChangeCorrespondence } from './changeCorrespondence';
import { correspondenceEvidence } from './requirements';
import { commitOid, git, readPinnedFile, repositoryRoot } from './reviewWorkspace';

export const TOUR_REVISION_IMPACT_REPORT_VERSION = 1 as const;

/** The only modes which the presentation host exposes as authored tours. */
export const TOUR_REVISION_IMPACT_MODE = {
    HISTORICAL: 'historical',
    DECONSTRUCTED: 'deconstructed'
} as const;

export type TourRevisionImpactMode = typeof TOUR_REVISION_IMPACT_MODE[
    keyof typeof TOUR_REVISION_IMPACT_MODE
];

export const TOUR_REVISION_IMPACT_REFERENCE_ROLE = {
    FOCUS: 'focus',
    CONNECTION_FROM: 'connection-from',
    CONNECTION_TO: 'connection-to',
    STACK_STEP: 'stack-step'
} as const;

export type TourRevisionImpactReferenceRole = typeof TOUR_REVISION_IMPACT_REFERENCE_ROLE[
    keyof typeof TOUR_REVISION_IMPACT_REFERENCE_ROLE
];

export const TOUR_REVISION_IMPACT_REFERENCE_SCOPE = {
    BASELINE: 'baseline',
    OLD_HEAD: 'old-head',
    INTERMEDIATE: 'intermediate',
    SYNTHETIC: 'synthetic',
    UNKNOWN: 'unknown'
} as const;

export type TourRevisionImpactReferenceScope = typeof TOUR_REVISION_IMPACT_REFERENCE_SCOPE[
    keyof typeof TOUR_REVISION_IMPACT_REFERENCE_SCOPE
];

export const TOUR_REVISION_IMPACT_STATUS = {
    UNCHANGED: 'unchanged',
    RELOCATED: 'relocated',
    CHANGED: 'changed',
    MISSING: 'missing',
    INCOMPLETE: 'incomplete'
} as const;

export type TourRevisionImpactStatus = typeof TOUR_REVISION_IMPACT_STATUS[
    keyof typeof TOUR_REVISION_IMPACT_STATUS
];

export const TOUR_REVISION_IMPACT_REASON = {
    MISSING_SOURCE: 'missing-source',
    INVALID_LINE_RANGE: 'invalid-line-range',
    INVALID_COMMIT: 'invalid-commit',
    EXCERPT_MISMATCH: 'excerpt-mismatch',
    SYNTHETIC_REFERENCE: 'synthetic-reference',
    UNSUPPORTED_SCENE: 'unsupported-scene',
    NEW_HEAD_SOURCE_MISSING: 'new-head-source-missing',
    NO_ACCEPTED_CORRESPONDENCE: 'no-accepted-correspondence',
    CORRESPONDENCE_INCOMPLETE: 'correspondence-incomplete',
    CHANGE_INVENTORY_UNAVAILABLE: 'change-inventory-unavailable',
    CORRESPONDENCE_SOURCE_UNAVAILABLE: 'correspondence-source-unavailable'
} as const;

export type TourRevisionImpactReason = typeof TOUR_REVISION_IMPACT_REASON[
    keyof typeof TOUR_REVISION_IMPACT_REASON
];

export interface TourRevisionImpactBaseline {
    mergeBaseOid: string;
    headOid: string;
}

export interface TourRevisionImpactNewHead {
    ref: string;
    oid: string;
}

export interface TourRevisionImpactSyntheticReference {
    panelId?: string;
    path?: string;
    startLine?: number;
    endLine?: number;
}

export interface TourRevisionImpactReference {
    role: TourRevisionImpactReferenceRole;
    scope: TourRevisionImpactReferenceScope;
    status: TourRevisionImpactStatus;
    oldRef?: SourceRef;
    newRef?: SourceRef;
    synthetic?: TourRevisionImpactSyntheticReference;
    reason?: TourRevisionImpactReason;
}

export interface TourRevisionImpactObservation {
    mode: TourRevisionImpactMode;
    sceneId: string;
    stepId: string;
    fragment: string;
    references: TourRevisionImpactReference[];
    incomplete: boolean;
    reasons?: TourRevisionImpactReason[];
}

export interface TourRevisionImpactUncoveredHunk {
    id: string;
    path: string;
    previousPath?: string;
    changeKind: ChangeUnit['changeKind'];
    baseStart: number;
    baseCount: number;
    headStart: number;
    headCount: number;
    additions: number;
    deletions: number;
    contextHash: string;
}

export interface TourRevisionImpactUncoveredChange {
    path: string;
    previousPath?: string;
    material: ChangeInventoryFile['material'];
    uncoveredHunks: string[];
    hunks: TourRevisionImpactUncoveredHunk[];
}

export interface TourRevisionImpactIncomplete {
    mode?: TourRevisionImpactMode;
    sceneId?: string;
    stepId?: string;
    role?: TourRevisionImpactReferenceRole;
    reason: TourRevisionImpactReason;
}

export interface TourRevisionImpactCorrespondence {
    status: ChangeCorrespondence['status'];
    producer: string;
    acceptedPairs: number;
    limitations: string[];
}

export interface TourRevisionImpactUnsupportedChange {
    path: string;
    previousPath?: string;
    material: ChangeInventoryFile['material'];
}

export interface TourRevisionImpactReport {
    version: typeof TOUR_REVISION_IMPACT_REPORT_VERSION;
    baseline: TourRevisionImpactBaseline;
    newHead: TourRevisionImpactNewHead;
    needsRenewedInspection: true;
    observations: TourRevisionImpactObservation[];
    uncoveredChanges: TourRevisionImpactUncoveredChange[];
    unsupportedChanges: TourRevisionImpactUnsupportedChange[];
    incomplete: TourRevisionImpactIncomplete[];
    correspondence?: TourRevisionImpactCorrespondence;
}

export interface BuildTourRevisionImpactReportOptions {
    newHeadRef: string;
    correspondencePath?: string;
}

interface CachedSource {
    text: string;
}

interface LineReferenceResult {
    ref?: SourceRef;
    reason?: typeof TOUR_REVISION_IMPACT_REASON[keyof typeof TOUR_REVISION_IMPACT_REASON];
}

interface PendingReference {
    output: TourRevisionImpactReference;
    oldRef: SourceRef;
    oldPath: string;
    mode: TourRevisionImpactMode;
    sceneId: string;
    stepId: string;
}

interface StepWork {
    observation: TourRevisionImpactObservation;
    pending: PendingReference[];
}

const FULL_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/**
 * Build an impact report without recompiling the manifest.  The manifest's
 * merge-base and head IDs are the immutable comparison baseline; only the
 * explicitly supplied new head is resolved.
 */
export function buildTourRevisionImpactReport(
    manifest: ChangeTourManifest,
    repoRoot: string,
    options: BuildTourRevisionImpactReportOptions
): TourRevisionImpactReport {
    const root = repositoryRoot(repoRoot);
    const baseline = validateBaseline(root, manifest);
    if (!options || typeof options.newHeadRef !== 'string' || !options.newHeadRef.trim()) {
        throw new Error('Tour revision impact requires an explicit new head reference.');
    }

    const newHeadOid = commitOid(root, options.newHeadRef);
    requireAncestor(root, baseline.mergeBaseOid, baseline.headOid,
        'The compiled tour baseline is not an ancestor of its head.');
    requireAncestor(root, baseline.headOid, newHeadOid,
        'The new head must descend from the compiled tour head; rewritten or divergent history is unsupported.');

    const cache = new PinnedSourceCache(root);
    const correspondence = options.correspondencePath
        ? loadChangeCorrespondence(root, options.correspondencePath, {
            baseOid: baseline.headOid,
            headOid: newHeadOid
        })
        : undefined;
    const evidence = correspondence
        ? correspondenceEvidence(correspondence, ['Tour revision impact head-reference relocation'])
        : undefined;

    let inventory: ChangeInventory | undefined;
    let inventoryUnavailable = false;
    try {
        inventory = buildChangeInventory(root, {
            baseRef: baseline.headOid,
            headRef: newHeadOid
        });
    } catch {
        // A valid commit can still contain an unavailable blob. Keep the
        // baseline and step observations, and make that loss explicit below.
        inventoryUnavailable = true;
    }
    if (inventory && (inventory.range.baseOid !== baseline.headOid || inventory.range.headOid !== newHeadOid)) {
        throw new Error('Change inventory did not preserve the requested old-head to new-head range.');
    }

    const observations: TourRevisionImpactObservation[] = [];
    const stepWorks: StepWork[] = [];
    const incomplete: TourRevisionImpactIncomplete[] = [];
    for (const [mode, tour] of authoredModeEntries(manifest)) {
        for (const scene of tour.scenes) {
            if (!isSteppedScene(scene)) continue;
            for (const step of scene.steps) {
                const observation: TourRevisionImpactObservation = {
                    mode,
                    sceneId: scene.id,
                    stepId: step.id,
                    fragment: serializeDocumentFragment(mode, { part: 'step', scene: scene.id, step: step.id }),
                    references: [],
                    incomplete: false
                };
                const work: StepWork = { observation, pending: [] };
                observations.push(observation);
                stepWorks.push(work);
                collectStepReferences(root, cache, baseline, scene, step, work, incomplete);
            }
        }
    }

    const oldHeadPending = stepWorks.flatMap(work => work.pending);
    const pairCandidates = usablePairs(cache, evidence?.pairs || []);
    const transitions = relocatePendingReferences(
        cache,
        baseline.headOid,
        newHeadOid,
        oldHeadPending,
        pairCandidates
    );
    applyTransitions(
        oldHeadPending,
        transitions,
        inventory,
        evidence?.analysis.status,
        incomplete
    );

    for (const work of stepWorks) {
        const reasons = work.observation.references
            .map(reference => reference.reason)
            .filter((reason): reason is TourRevisionImpactReason => reason !== undefined);
        if (reasons.length) {
            work.observation.incomplete = true;
            work.observation.reasons = [...new Set(reasons)];
        }
    }

    if (inventoryUnavailable) incomplete.push({ reason: TOUR_REVISION_IMPACT_REASON.CHANGE_INVENTORY_UNAVAILABLE });
    if (evidence && pairCandidates.length !== evidence.pairs.length) {
        incomplete.push({ reason: TOUR_REVISION_IMPACT_REASON.CORRESPONDENCE_SOURCE_UNAVAILABLE });
    }

    const coveredUnits = new Set<string>();
    for (const work of stepWorks) {
        for (const reference of work.observation.references) {
            if (reference.oldRef && reference.oldRef.revision === baseline.headOid) {
                coverIntersectingUnits(cache, reference.oldRef, inventory, coveredUnits, 'base');
            }
            if (reference.newRef && reference.newRef.revision === newHeadOid) {
                coverIntersectingUnits(cache, reference.newRef, inventory, coveredUnits, 'head');
            }
        }
    }

    const unsupportedChanges: TourRevisionImpactUnsupportedChange[] = [];
    const uncoveredChanges: TourRevisionImpactUncoveredChange[] = [];
    for (const file of inventory?.files || []) {
        if (file.material !== 'text') {
            unsupportedChanges.push({
                path: file.path,
                ...(file.previousPath ? { previousPath: file.previousPath } : {}),
                material: file.material
            });
            continue;
        }
        const hunks = file.units.filter(unit => !coveredUnits.has(unit.id)).map(toUncoveredHunk);
        if (hunks.length) {
            uncoveredChanges.push({
                path: file.path,
                ...(file.previousPath ? { previousPath: file.previousPath } : {}),
                material: file.material,
                uncoveredHunks: hunks.map(hunk => hunk.id),
                hunks
            });
        }
    }

    const report: TourRevisionImpactReport = {
        version: TOUR_REVISION_IMPACT_REPORT_VERSION,
        baseline,
        newHead: { ref: options.newHeadRef, oid: newHeadOid },
        needsRenewedInspection: true,
        observations,
        uncoveredChanges,
        unsupportedChanges,
        incomplete
    };
    if (correspondence) {
        report.correspondence = {
            status: correspondence.status,
            producer: correspondence.producer,
            acceptedPairs: correspondence.relations.length,
            limitations: [...correspondence.limitations]
        };
    }
    return report;
}

function validateBaseline(root: string, manifest: ChangeTourManifest): TourRevisionImpactBaseline {
    const mergeBaseOid = fullOid(manifest.range?.mergeBaseOid, 'manifest.range.mergeBaseOid');
    const headOid = fullOid(manifest.range?.headOid, 'manifest.range.headOid');
    if (commitOid(root, mergeBaseOid) !== mergeBaseOid || commitOid(root, headOid) !== headOid) {
        throw new Error('The compiled tour baseline requires full immutable Git commit IDs.');
    }
    return { mergeBaseOid, headOid };
}

function fullOid(value: unknown, label: string): string {
    if (typeof value !== 'string' || !FULL_OID.test(value)) throw new Error(`${label} must be a full Git commit ID.`);
    return value;
}

function requireAncestor(root: string, ancestor: string, descendant: string, message: string): void {
    try {
        git(root, ['merge-base', '--is-ancestor', ancestor, descendant]);
    } catch {
        throw new Error(message);
    }
}

function authoredModeEntries(manifest: ChangeTourManifest): Array<[TourRevisionImpactMode, ChangeTourModeTour]> {
    // Keep this in lockstep with web/host.js authoredTours(). Explicit mode
    // tours are independent and must never borrow root scenes.
    if (manifest.tours) {
        return [
            ...(manifest.tours.historical ? [[TOUR_REVISION_IMPACT_MODE.HISTORICAL, manifest.tours.historical] as [TourRevisionImpactMode, ChangeTourModeTour]] : []),
            ...(manifest.tours.deconstructed ? [[TOUR_REVISION_IMPACT_MODE.DECONSTRUCTED, manifest.tours.deconstructed] as [TourRevisionImpactMode, ChangeTourModeTour]] : [])
        ];
    }
    const deconstructed = manifest.scenes.some(scene => scene.kind === 'deconstructed-diff');
    if (!deconstructed) return [[TOUR_REVISION_IMPACT_MODE.HISTORICAL, manifest]];
    const final = manifest.zoom?.final;
    const historical = final && final.scenes.some(scene => scene.kind === 'walkthrough') ? final : undefined;
    return [
        ...(historical ? [[TOUR_REVISION_IMPACT_MODE.HISTORICAL, historical] as [TourRevisionImpactMode, ChangeTourModeTour]] : []),
        [TOUR_REVISION_IMPACT_MODE.DECONSTRUCTED, manifest]
    ];
}

function isSteppedScene(scene: ChangeTourScene): scene is ChangeTourWalkthroughScene | ChangeTourStackedScene | ChangeTourDeconstructedScene {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}

function collectStepReferences(
    root: string,
    cache: PinnedSourceCache,
    baseline: TourRevisionImpactBaseline,
    scene: ChangeTourWalkthroughScene | ChangeTourStackedScene | ChangeTourDeconstructedScene,
    step: (ChangeTourWalkthroughScene | ChangeTourStackedScene | ChangeTourDeconstructedScene)['steps'][number],
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[]
): void {
    if (scene.kind === 'walkthrough') {
        const walkthroughStep = step as ChangeTourWalkthroughStep;
        addAnchorReference(cache, baseline, work, incomplete,
            TOUR_REVISION_IMPACT_REFERENCE_ROLE.FOCUS, walkthroughStep.focus);
        if (walkthroughStep.connection) {
            addAnchorReference(cache, baseline, work, incomplete,
                TOUR_REVISION_IMPACT_REFERENCE_ROLE.CONNECTION_FROM, walkthroughStep.connection.from);
            addAnchorReference(cache, baseline, work, incomplete,
                TOUR_REVISION_IMPACT_REFERENCE_ROLE.CONNECTION_TO, walkthroughStep.connection.to);
        }
        return;
    }
    if (scene.kind === 'stacked-diff') {
        addStackReference(root, cache, baseline, scene, step as ChangeTourStackStep, work, incomplete);
        return;
    }
    addSyntheticReference(scene, step as ChangeTourDeconstructedScene['steps'][number], work, incomplete);
}

function addAnchorReference(
    cache: PinnedSourceCache,
    baseline: TourRevisionImpactBaseline,
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[],
    role: TourRevisionImpactReferenceRole,
    anchor: { path: string; revision: 'base' | 'head'; startLine: number; endLine: number; excerpt: string }
): void {
    const revision = anchor.revision === 'base' ? baseline.mergeBaseOid : baseline.headOid;
    const scope = anchor.revision === 'base'
        ? TOUR_REVISION_IMPACT_REFERENCE_SCOPE.BASELINE
        : TOUR_REVISION_IMPACT_REFERENCE_SCOPE.OLD_HEAD;
    addPinnedReference(cache, work, incomplete, role, scope, revision, anchor.path,
        anchor.startLine, anchor.endLine, anchor.excerpt);
}

function addStackReference(
    root: string,
    cache: PinnedSourceCache,
    baseline: TourRevisionImpactBaseline,
    scene: ChangeTourStackedScene,
    step: ChangeTourStackStep,
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[]
): void {
    const panelIndex = step.pairIndex + (step.side === 'right' ? 1 : 0);
    const panel = scene.stack[panelIndex];
    const file = scene.files.find(candidate => candidate.path === step.file);
    const filePanel = file?.panels[panelIndex];
    const startLine = step.startLine;
    const endLine = step.endLine;
    const path = filePanel?.path || file?.path;
    if (!panel || !file || !filePanel || filePanel.exists === false || !path
        || typeof startLine !== 'number' || typeof endLine !== 'number'
        || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)) {
        addIncompleteReference(work, incomplete, {
            role: TOUR_REVISION_IMPACT_REFERENCE_ROLE.STACK_STEP,
            scope: TOUR_REVISION_IMPACT_REFERENCE_SCOPE.UNKNOWN,
            status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
            reason: !Number.isSafeInteger(step.startLine) || !Number.isSafeInteger(step.endLine)
                ? TOUR_REVISION_IMPACT_REASON.INVALID_LINE_RANGE
                : TOUR_REVISION_IMPACT_REASON.MISSING_SOURCE
        });
        return;
    }
    const revision = fullOidOrUndefined(panel.oid);
    if (!revision) {
        addIncompleteReference(work, incomplete, {
            role: TOUR_REVISION_IMPACT_REFERENCE_ROLE.STACK_STEP,
            scope: TOUR_REVISION_IMPACT_REFERENCE_SCOPE.UNKNOWN,
            status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
            reason: TOUR_REVISION_IMPACT_REASON.INVALID_COMMIT
        });
        return;
    }
    const scope = revision === baseline.mergeBaseOid
        ? TOUR_REVISION_IMPACT_REFERENCE_SCOPE.BASELINE
        : revision === baseline.headOid
            ? TOUR_REVISION_IMPACT_REFERENCE_SCOPE.OLD_HEAD
            : TOUR_REVISION_IMPACT_REFERENCE_SCOPE.INTERMEDIATE;
    if (scope === TOUR_REVISION_IMPACT_REFERENCE_SCOPE.INTERMEDIATE) {
        try {
            if (commitOid(root, revision) !== revision) throw new Error('not immutable');
        } catch {
            addIncompleteReference(work, incomplete, {
                role: TOUR_REVISION_IMPACT_REFERENCE_ROLE.STACK_STEP,
                scope,
                status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
                reason: TOUR_REVISION_IMPACT_REASON.INVALID_COMMIT
            });
            return;
        }
    }
    addPinnedReference(cache, work, incomplete, TOUR_REVISION_IMPACT_REFERENCE_ROLE.STACK_STEP,
        scope, revision, path, startLine, endLine);
}

function addSyntheticReference(
    scene: ChangeTourDeconstructedScene,
    step: ChangeTourDeconstructedScene['steps'][number],
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[]
): void {
    const panelIndex = step.pairIndex + (step.side === 'right' ? 1 : 0);
    const panel = scene.panels[panelIndex];
    const file = scene.files.find(candidate => candidate.path === step.file);
    const filePanel = file?.panels[panelIndex];
    const synthetic: TourRevisionImpactSyntheticReference = {
        ...(panel?.id ? { panelId: panel.id } : {}),
        ...(filePanel?.path || file?.path ? { path: filePanel?.path || file?.path } : {}),
        ...(Number.isSafeInteger(step.startLine) ? { startLine: step.startLine } : {}),
        ...(Number.isSafeInteger(step.endLine) ? { endLine: step.endLine } : {})
    };
    addIncompleteReference(work, incomplete, {
        role: TOUR_REVISION_IMPACT_REFERENCE_ROLE.STACK_STEP,
        scope: TOUR_REVISION_IMPACT_REFERENCE_SCOPE.SYNTHETIC,
        status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
        ...(Object.keys(synthetic).length ? { synthetic } : {}),
        reason: TOUR_REVISION_IMPACT_REASON.SYNTHETIC_REFERENCE
    });
}

function addPinnedReference(
    cache: PinnedSourceCache,
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[],
    role: TourRevisionImpactReferenceRole,
    scope: Exclude<TourRevisionImpactReferenceScope, 'synthetic' | 'unknown'>,
    revision: string,
    path: string,
    startLine: number,
    endLine: number,
    expectedExcerpt?: string
): void {
    const pinned = cache.pinLine(revision, path, startLine, endLine);
    if (!pinned.ref) {
        addIncompleteReference(work, incomplete, {
            role,
            scope,
            status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
            reason: pinned.reason || TOUR_REVISION_IMPACT_REASON.MISSING_SOURCE
        });
        return;
    }
    if (expectedExcerpt !== undefined
        && (typeof expectedExcerpt !== 'string'
            || !(cache.textForRef(pinned.ref) || '').includes(expectedExcerpt))) {
        addIncompleteReference(work, incomplete, {
            role,
            scope,
            status: TOUR_REVISION_IMPACT_STATUS.INCOMPLETE,
            reason: TOUR_REVISION_IMPACT_REASON.EXCERPT_MISMATCH
        });
        return;
    }
    const output: TourRevisionImpactReference = {
        role,
        scope,
        status: scope === TOUR_REVISION_IMPACT_REFERENCE_SCOPE.OLD_HEAD
            ? TOUR_REVISION_IMPACT_STATUS.INCOMPLETE
            : TOUR_REVISION_IMPACT_STATUS.UNCHANGED,
        oldRef: pinned.ref
    };
    work.observation.references.push(output);
    if (scope === TOUR_REVISION_IMPACT_REFERENCE_SCOPE.OLD_HEAD) {
        work.pending.push({
            output,
            oldRef: pinned.ref,
            oldPath: path,
            mode: work.observation.mode,
            sceneId: work.observation.sceneId,
            stepId: work.observation.stepId
        });
    }
}

function addIncompleteReference(
    work: StepWork,
    incomplete: TourRevisionImpactIncomplete[],
    reference: TourRevisionImpactReference
): void {
    work.observation.references.push(reference);
    incomplete.push({
        mode: work.observation.mode,
        sceneId: work.observation.sceneId,
        stepId: work.observation.stepId,
        role: reference.role,
        reason: reference.reason || TOUR_REVISION_IMPACT_REASON.UNSUPPORTED_SCENE
    });
}

function usablePairs(cache: PinnedSourceCache, pairs: readonly { before: SourceRef; after: SourceRef }[]): Array<{ before: SourceRef; after: SourceRef }> {
    return pairs.filter(pair => cache.get(pair.before.revision, pair.before.path) !== undefined
        && cache.get(pair.after.revision, pair.after.path) !== undefined);
}

function relocatePendingReferences(
    cache: PinnedSourceCache,
    oldHeadOid: string,
    newHeadOid: string,
    pending: readonly PendingReference[],
    pairs: readonly { before: SourceRef; after: SourceRef }[]
): SourceTransition[] {
    if (!pending.length) return [];
    if (oldHeadOid === newHeadOid) {
        return pending.map(entry => ({ status: 'unchanged' as const, before: entry.oldRef, after: entry.oldRef }));
    }
    const before = cache.snapshot(oldHeadOid, [
        ...pending.map(entry => entry.oldRef.path),
        ...pairs.map(pair => pair.before.path)
    ]);
    const after = cache.snapshot(newHeadOid, [
        ...pending.map(entry => entry.oldRef.path),
        ...pairs.map(pair => pair.after.path)
    ]);
    return relocateSourceRefs(pending.map(entry => entry.oldRef), before, after, [...pairs]);
}

function applyTransitions(
    pending: readonly PendingReference[],
    transitions: readonly SourceTransition[],
    inventory: ChangeInventory | undefined,
    correspondenceStatus: ChangeCorrespondence['status'] | undefined,
    incomplete: TourRevisionImpactIncomplete[]
): void {
    for (const [index, entry] of pending.entries()) {
        const transition = transitions[index];
        if (!transition || transition.status === 'unresolved') {
            const missing = isDeletedAtNewHead(entry.oldPath, inventory);
            entry.output.status = missing
                ? TOUR_REVISION_IMPACT_STATUS.MISSING
                : TOUR_REVISION_IMPACT_STATUS.INCOMPLETE;
            entry.output.reason = missing
                ? undefined
                : correspondenceStatus && correspondenceStatus !== 'complete'
                    ? TOUR_REVISION_IMPACT_REASON.CORRESPONDENCE_INCOMPLETE
                    : TOUR_REVISION_IMPACT_REASON.NO_ACCEPTED_CORRESPONDENCE;
            if (entry.output.reason) incomplete.push({
                mode: entry.mode,
                sceneId: entry.sceneId,
                stepId: entry.stepId,
                role: entry.output.role,
                reason: entry.output.reason
            });
            continue;
        }
        entry.output.status = transition.status;
        entry.output.newRef = transition.after;
    }
}

function isDeletedAtNewHead(
    path: string,
    inventory: ChangeInventory | undefined
): boolean {
    const file = inventory?.files.find(candidate => candidate.path === path || candidate.previousPath === path);
    return file?.changeKind === 'deleted';
}

function coverIntersectingUnits(
    cache: PinnedSourceCache,
    reference: SourceRef,
    inventory: ChangeInventory | undefined,
    covered: Set<string>,
    side: 'base' | 'head'
): void {
    if (!inventory) return;
    const source = cache.get(reference.revision, reference.path);
    if (!source) return;
    const lines = sourceLineRange(source.text, reference.start, reference.end);
    if (!lines) return;
    for (const file of inventory.files) {
        for (const unit of file.units) {
            const pathMatches = unit.path === reference.path || unit.previousPath === reference.path;
            if (!pathMatches) continue;
            const start = side === 'base' ? unit.baseStart : unit.headStart;
            const count = side === 'base' ? unit.baseCount : unit.headCount;
            if (count === 0) continue;
            const end = start + count - 1;
            if (lines.start <= end && lines.end >= start) covered.add(unit.id);
        }
    }
}

function sourceLineRange(text: string, start: number, end: number): { start: number; end: number } | undefined {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) return undefined;
    let beforeStart = 0;
    for (let index = 0; index < start; index += 1) if (text[index] === '\n') beforeStart += 1;
    let beforeEnd = 0;
    for (let index = 0; index < end; index += 1) if (text[index] === '\n') beforeEnd += 1;
    const endLine = text[end - 1] === '\n' ? Math.max(1, beforeEnd) : beforeEnd + 1;
    return { start: beforeStart + 1, end: endLine };
}

function toUncoveredHunk(unit: ChangeUnit): TourRevisionImpactUncoveredHunk {
    return {
        id: unit.id,
        path: unit.path,
        ...(unit.previousPath ? { previousPath: unit.previousPath } : {}),
        changeKind: unit.changeKind,
        baseStart: unit.baseStart,
        baseCount: unit.baseCount,
        headStart: unit.headStart,
        headCount: unit.headCount,
        additions: unit.additions,
        deletions: unit.deletions,
        contextHash: unit.contextHash
    };
}

function fullOidOrUndefined(value: string): string | undefined {
    return FULL_OID.test(value) ? value : undefined;
}

class PinnedSourceCache {
    private readonly entries = new Map<string, CachedSource | undefined>();

    public constructor(private readonly root: string) {}

    public get(revision: string, path: string): CachedSource | undefined {
        const key = `${revision}\u0000${path}`;
        if (this.entries.has(key)) return this.entries.get(key);
        let source: CachedSource | undefined;
        try {
            const pinned = readPinnedFile(this.root, revision, path);
            source = pinned ? { text: pinned.text } : undefined;
        } catch {
            source = undefined;
        }
        this.entries.set(key, source);
        return source;
    }

    public textForRef(ref: SourceRef): string | undefined {
        const source = this.get(ref.revision, ref.path);
        return source?.text.slice(ref.start, ref.end);
    }

    public pinLine(revision: string, path: string, start: number, end: number): LineReferenceResult {
        const source = this.get(revision, path);
        if (!source) return { reason: TOUR_REVISION_IMPACT_REASON.MISSING_SOURCE };
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
            return { reason: TOUR_REVISION_IMPACT_REASON.INVALID_LINE_RANGE };
        }
        const offsets = [0];
        for (let index = 0; index < source.text.length; index += 1) {
            if (source.text[index] === '\n' && index + 1 < source.text.length) offsets.push(index + 1);
        }
        if (end > offsets.length) return { reason: TOUR_REVISION_IMPACT_REASON.INVALID_LINE_RANGE };
        try {
            return {
                ref: pinSourceRef(
                    { revision, files: { [path]: source.text } },
                    path,
                    offsets[start - 1],
                    offsets[end] ?? source.text.length
                )
            };
        } catch {
            return { reason: TOUR_REVISION_IMPACT_REASON.INVALID_LINE_RANGE };
        }
    }

    public snapshot(revision: string, paths: readonly string[]): SourceSnapshot {
        const files: Record<string, string> = Object.create(null) as Record<string, string>;
        for (const path of new Set(paths)) {
            const source = this.get(revision, path);
            if (source) files[path] = source.text;
        }
        return { revision, files };
    }

}
