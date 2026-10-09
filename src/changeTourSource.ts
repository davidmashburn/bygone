import { validateTourFraming, validateOverviewPurpose, type ChangeTourFraming } from './tourFraming';
import { validateTourImageSource, type TourImageSource } from './tourImage';
import type { ChangeTourNarrative } from './changeTourManifest';

export const CHANGE_TOUR_SOURCE_VERSION = 5 as const;

export interface ChangeTourSourceAnchor {
    file: string;
    revision: 'base' | 'head';
    contains: string;
    occurrence?: number;
}

export interface ChangeTourSourceConnection {
    id: string;
    from: string;
    to: string;
    label: string;
}

export interface ChangeTourStepRequirement {
    id: string;
    text: string;
    status?: 'fulfilled' | 'gap';
    source?: string;
    confidence?: 'high' | 'medium' | 'low';
}

export interface ChangeTourSourceStep {
    id: string;
    title: string;
    body: string;
    focus: string;
    image?: TourImageSource;
    connection?: string;
    depth?: 'mentioned' | 'explained' | 'contextualized';
    requirement?: ChangeTourStepRequirement;
}

export interface ChangeTourCoverageExclusion {
    path: string;
    hunks?: string[];
    reason: string;
}

export interface ChangeTourSourceSceneOverview {
    kind: 'directory-diff';
    purpose?: string;
    path?: string;
    comparison?: ChangeTourSourceSceneOverviewComparison;
}

export interface ChangeTourSourceSceneOverviewComparison {
    from: string;
    to: string;
}

export interface ChangeTourSourceWalkthroughScene extends ChangeTourNarrative {
    id: string;
    kind?: 'walkthrough';
    title: string;
    overview?: ChangeTourSourceSceneOverview;
    steps: ChangeTourSourceStep[];
}

export interface ChangeTourSourceStackEntry {
    id: string;
    ref: string;
    label?: string;
}

export interface ChangeTourSourceStackStep {
    id: string;
    title: string;
    body: string;
    file: string;
    pair: [string, string];
    side?: 'left' | 'right';
    lines?: [number, number];
}

export interface ChangeTourSourceStackedScene extends ChangeTourNarrative {
    id: string;
    kind: 'stacked-diff';
    title: string;
    overview?: ChangeTourSourceSceneOverview;
    stack: ChangeTourSourceStackEntry[];
    files?: string[];
    steps: ChangeTourSourceStackStep[];
}

export interface ChangeTourSourceDeconstructedChange {
    file: string;
    hunks: string[];
}

export interface ChangeTourSourceDeconstructedStage {
    id: string;
    title: string;
    narration: string;
    changes: ChangeTourSourceDeconstructedChange[];
}

export interface ChangeTourSourceDeconstructedExclusion {
    file: string;
    hunks?: string[];
    reason: string;
}

export interface ChangeTourSourceDeconstructedScene extends ChangeTourNarrative {
    id: string;
    kind: 'deconstructed-diff';
    title: string;
    overview?: ChangeTourSourceSceneOverview;
    base?: string;
    target?: string;
    /** Required for v2+ root deconstruction; mode-specific Deconstructed may omit it. */
    stack?: ChangeTourSourceStackEntry[];
    /** Required for v2+ root deconstruction when endpoint walkthrough evidence is authored. */
    steps?: ChangeTourSourceStep[];
    stages: ChangeTourSourceDeconstructedStage[];
    exclusions?: ChangeTourSourceDeconstructedExclusion[];
}

export type ChangeTourSourceScene = ChangeTourSourceWalkthroughScene
    | ChangeTourSourceStackedScene
    | ChangeTourSourceDeconstructedScene;

export interface ChangeTourSourceChapter {
    id: string;
    title: string;
    scenes: ChangeTourSourceScene[];
}

/**
 * An independently authored mode keeps the same evidence namespace as the
 * source document.  Range, anchors, and connections remain shared on the
 * source; only the chapter and scene narrative varies by mode.
 */
export interface ChangeTourSourceTour extends ChangeTourFraming {
    chapters: ChangeTourSourceChapter[];
}

export interface ChangeTourSourceTours {
    historical?: ChangeTourSourceTour;
    deconstructed?: ChangeTourSourceTour;
}

export interface ChangeTourSource extends ChangeTourFraming {
    version: 1 | 2 | 4 | typeof CHANGE_TOUR_SOURCE_VERSION;
    title?: string;
    windowTitle?: string;
    sourceUrl?: string;
    range?: {
        base: string;
        head: string;
    };
    anchors: Record<string, ChangeTourSourceAnchor>;
    connections: ChangeTourSourceConnection[];
    chapters: ChangeTourSourceChapter[];
    tours?: ChangeTourSourceTours;
    coverage?: { exclusions: ChangeTourCoverageExclusion[] };
}

export function parseChangeTourSource(value: unknown): ChangeTourSource {
    if (isRecord(value) && Number.isInteger(value.version) && Number(value.version) > CHANGE_TOUR_SOURCE_VERSION) {
        throw new Error(
            `This tour uses source format version ${value.version}, but this version of Bygone supports up to version ${CHANGE_TOUR_SOURCE_VERSION}. Upgrade Bygone to open it.`
        );
    }
    if (isRecord(value) && value.version === 3) {
        throw new Error('Tour source format version 3 is retired. Remove the review block, set source version to 4, and recompile the tour.');
    }
    if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 4 && value.version !== CHANGE_TOUR_SOURCE_VERSION)) {
        throw new Error('Unsupported or missing change-tour source version.');
    }
    requireOnlyKeys(value, [
        'version', 'title', 'windowTitle', 'sourceUrl', 'range', 'anchors', 'connections', 'chapters', 'tours', 'coverage', 'opening', 'conclusion'
    ], 'source');
    validateTourFraming(value, value.version, 'source');
    optionalString(value.title, 'title');
    optionalString(value.windowTitle, 'windowTitle');
    optionalString(value.sourceUrl, 'sourceUrl');
    if (value.range !== undefined) {
        if (!isRecord(value.range)) throw new Error('range must be an object.');
        requireOnlyKeys(value.range, ['base', 'head'], 'range');
        requireString(value.range.base, 'range.base');
        requireString(value.range.head, 'range.head');
    }
    if (value.coverage !== undefined) {
        if (!isRecord(value.coverage) || !Array.isArray(value.coverage.exclusions)) {
            throw new Error('coverage must contain an exclusions array.');
        }
        requireOnlyKeys(value.coverage, ['exclusions'], 'coverage');
        for (const [index, exclusion] of value.coverage.exclusions.entries()) {
            const exclusionPath = `coverage.exclusions[${index}]`;
            if (!isRecord(exclusion)) throw new Error(`${exclusionPath} must be an object.`);
            requireOnlyKeys(exclusion, ['path', 'hunks', 'reason'], exclusionPath);
            requireString(exclusion.path, `${exclusionPath}.path`);
            requireString(exclusion.reason, `${exclusionPath}.reason`);
            if (exclusion.hunks !== undefined) requireStringArray(exclusion.hunks, `${exclusionPath}.hunks`);
        }
    }
    if (!isRecord(value.anchors)) {
        throw new Error('anchors must be an object.');
    }
    for (const [id, anchor] of Object.entries(value.anchors)) {
        if (!isRecord(anchor)) {
            throw new Error(`anchors.${id} must be an object.`);
        }
        requireOnlyKeys(anchor, ['file', 'revision', 'contains', 'occurrence'], `anchors.${id}`);
        requireString(anchor.file, `anchors.${id}.file`);
        if (anchor.revision !== 'base' && anchor.revision !== 'head') {
            throw new Error(`anchors.${id}.revision must be base or head.`);
        }
        requireString(anchor.contains, `anchors.${id}.contains`);
        if (anchor.occurrence !== undefined && (!Number.isInteger(anchor.occurrence) || Number(anchor.occurrence) < 1)) {
            throw new Error(`anchors.${id}.occurrence must be a positive integer.`);
        }
    }
    const rawConnections = Array.isArray(value.connections)
        ? value.connections
        : isRecord(value.connections)
            ? Object.entries(value.connections).map(([id, connection]) => isRecord(connection) ? { id, ...connection } : connection)
            : null;
    if (!rawConnections || !Array.isArray(value.chapters) || value.chapters.length === 0) {
        throw new Error('connections must be an array or object, and chapters must be a non-empty array.');
    }
    const connectionIds = new Set<string>();
    for (const [index, connection] of rawConnections.entries()) {
        if (!isRecord(connection)) {
            throw new Error(`connections[${index}] must be an object.`);
        }
        requireOnlyKeys(connection, ['id', 'from', 'to', 'label'], `connections[${index}]`);
        requireString(connection.id, `connections[${index}].id`);
        requireString(connection.from, `connections[${index}].from`);
        requireString(connection.to, `connections[${index}].to`);
        requireString(connection.label, `connections[${index}].label`);
        const { id, from, to } = connection;
        if (!value.anchors[from] || !value.anchors[to]) {
            throw new Error(`Connection ${id} references an unknown anchor.`);
        }
        if (connectionIds.has(id)) {
            throw new Error(`Duplicate connection id: ${id}`);
        }
        connectionIds.add(id);
    }
    validateSourceChapters(
        value.chapters,
        'chapters',
        value.version,
        value.anchors,
        connectionIds,
        'root'
    );
    if (value.tours !== undefined) {
        if (value.version < 4) throw new Error('Independent tours require version 4.');
        if (!isRecord(value.tours)) throw new Error('tours must be an object.');
        requireOnlyKeys(value.tours, ['historical', 'deconstructed'], 'tours');
        if (value.tours.historical === undefined && value.tours.deconstructed === undefined) {
            throw new Error('tours must contain a historical or deconstructed tour.');
        }
        for (const mode of ['historical', 'deconstructed'] as const) {
            const tour = value.tours[mode];
            if (tour === undefined) continue;
            const path = `tours.${mode}`;
            if (!isRecord(tour)) throw new Error(`${path} must be an object.`);
            requireOnlyKeys(tour, ['chapters', 'opening', 'conclusion'], path);
            validateTourFraming(tour, value.version, path);
            validateSourceChapters(tour.chapters, `${path}.chapters`, value.version, value.anchors, connectionIds, mode);
        }
    }
    return { ...value, connections: rawConnections } as unknown as ChangeTourSource;
}

type SourceTourValidationMode = 'root' | 'historical' | 'deconstructed';

function validateSourceChapters(
    chaptersValue: unknown,
    chaptersPath: string,
    version: 1 | 2 | 4 | 5,
    anchors: Record<string, unknown>,
    connectionIds: ReadonlySet<string>,
    mode: SourceTourValidationMode
): void {
    if (!Array.isArray(chaptersValue) || chaptersValue.length === 0) {
        throw new Error(`${chaptersPath} must be a non-empty array.`);
    }
    const chapterIds = new Set<string>();
    const sceneIds = new Set<string>();
    for (const [chapterIndex, chapter] of chaptersValue.entries()) {
        const chapterPath = `${chaptersPath}[${chapterIndex}]`;
        if (!isRecord(chapter) || !Array.isArray(chapter.scenes) || chapter.scenes.length === 0) {
            throw new Error(`${chapterPath} must contain a non-empty scenes array.`);
        }
        requireString(chapter.id, `${chapterPath}.id`);
        requireString(chapter.title, `${chapterPath}.title`);
        requireOnlyKeys(chapter, ['id', 'title', 'scenes'], chapterPath);
        if (chapterIds.has(chapter.id)) throw new Error(`Duplicate chapter id: ${chapter.id}`);
        chapterIds.add(chapter.id);
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
            const path = `${chapterPath}.scenes[${sceneIndex}]`;
            if (!isRecord(scene)) throw new Error(`${path} must be an object.`);
            requireString(scene.id, `${path}.id`);
            requireString(scene.title, `${path}.title`);
            if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
            sceneIds.add(scene.id);
            if (scene.overview !== undefined && version < 4) {
                throw new Error(`${path}.overview requires version 4.`);
            }
            validateOverviewPurpose(scene.overview, version, `${path}.overview`);
            validateNarrative(scene, path);
            if (scene.kind === 'deconstructed-diff') {
                if (mode === 'historical') {
                    throw new Error(`${path} cannot contain a deconstructed-diff scene in the historical tour.`);
                }
                validateDeconstructedScene(scene, path);
                validateSceneOverview(scene.overview, `${path}.overview`, {
                    endpointIds: deconstructedOverviewEndpointIds(scene, path)
                });
                // Legacy v1 root deconstruction predates repository-bound real
                // revision evidence and intentionally permits a synthetic-only
                // scene.  v2+ root scenes and explicit Historical scenes retain
                // the real-evidence requirement; a mode-specific Deconstructed
                // tour is synthetic by design and may omit stack/steps.
                const requireRealEvidence = mode === 'root' && version >= 2;
                if (requireRealEvidence || scene.stack !== undefined) {
                    validateRealStack(scene.stack, `${path}.stack`, 2);
                }
                if (requireRealEvidence || scene.steps !== undefined) {
                    validateWalkthroughSteps(scene, path, anchors, connectionIds);
                }
                continue;
            }
            if (!Array.isArray(scene.steps) || scene.steps.length === 0) {
                throw new Error(`${path} must contain a non-empty steps array.`);
            }
            if (scene.kind === 'stacked-diff') {
                // A mode-specific Historical tour may intentionally contain
                // only its two real endpoint revisions.  Preserve the older
                // v1 three-panel requirement for the legacy root chapters.
                validateStackedScene(scene, path, mode === 'root' ? (version >= 2 ? 2 : 3) : 2);
                validateSceneOverview(scene.overview, `${path}.overview`, {
                    endpointIds: stackedOverviewEndpointIds(scene, path)
                });
                continue;
            }
            if (scene.kind !== undefined && scene.kind !== 'walkthrough') {
                throw new Error(`${path}.kind must be walkthrough, stacked-diff, or deconstructed-diff.`);
            }
            requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'overview', 'steps'], path);
            validateSceneOverview(scene.overview, `${path}.overview`, { allowComparison: false });
            validateWalkthroughSteps(scene, path, anchors, connectionIds);
        }
    }
    if (mode === 'deconstructed' && !chaptersValue.some((chapter) => (
        isRecord(chapter) && Array.isArray(chapter.scenes)
        && chapter.scenes.some((scene) => isRecord(scene) && scene.kind === 'deconstructed-diff')
    ))) {
        throw new Error(`${chaptersPath} must contain at least one deconstructed-diff scene.`);
    }
}

function stackedOverviewEndpointIds(scene: Record<string, unknown>, path: string): string[] {
    if (!Array.isArray(scene.stack)) {
        throw new Error(`${path}.stack must be an array.`);
    }
    return scene.stack
        .filter(isRecord)
        .map((entry) => typeof entry.id === 'string' ? entry.id : '')
        .filter((id) => id.length > 0);
}

function deconstructedOverviewEndpointIds(scene: Record<string, unknown>, path: string): string[] {
    if (!Array.isArray(scene.stages)) {
        throw new Error(`${path}.stages must be an array.`);
    }
    return [
        'explanation-baseline',
        ...scene.stages
            .filter(isRecord)
            .map((stage) => typeof stage.id === 'string' ? `explanation-stage-${stage.id}` : '')
            .filter((id) => id.length > 0)
    ];
}

function validateDeconstructedScene(scene: Record<string, unknown>, path: string): void {
    requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'overview', 'base', 'target', 'stack', 'steps', 'stages', 'exclusions'], path);
    optionalString(scene.base, `${path}.base`);
    optionalString(scene.target, `${path}.target`);
    if (!Array.isArray(scene.stages) || scene.stages.length === 0 || scene.stages.length > 12) {
        throw new Error(`${path}.stages must contain between 1 and 12 stages.`);
    }
    const stageIds = new Set<string>();
    for (const [stageIndex, stage] of scene.stages.entries()) {
        const stagePath = `${path}.stages[${stageIndex}]`;
        if (!isRecord(stage)) throw new Error(`${stagePath} must be an object.`);
        requireOnlyKeys(stage, ['id', 'title', 'narration', 'changes'], stagePath);
        requireString(stage.id, `${stagePath}.id`);
        requireString(stage.title, `${stagePath}.title`);
        requireString(stage.narration, `${stagePath}.narration`);
        if (!Array.isArray(stage.changes) || stage.changes.length === 0) {
            throw new Error(`${stagePath}.changes must be a non-empty array.`);
        }
        if (stageIds.has(stage.id)) throw new Error(`Duplicate deconstructed stage id: ${stage.id}`);
        stageIds.add(stage.id);
        stage.changes.forEach((change, changeIndex) => validateDeconstructedSelection(
            change,
            `${stagePath}.changes[${changeIndex}]`,
            false
        ));
    }
    if (scene.exclusions !== undefined) {
        if (!Array.isArray(scene.exclusions)) throw new Error(`${path}.exclusions must be an array.`);
        scene.exclusions.forEach((exclusion, exclusionIndex) => validateDeconstructedSelection(
            exclusion,
            `${path}.exclusions[${exclusionIndex}]`,
            true
        ));
    }
}

function validateWalkthroughSteps(
    scene: Record<string, unknown>,
    path: string,
    anchors: Record<string, unknown>,
    connectionIds: ReadonlySet<string>
): void {
    if (!Array.isArray(scene.steps) || scene.steps.length === 0) {
        throw new Error(`${path} must contain a non-empty steps array.`);
    }
    const stepIds = new Set<string>();
    for (const [stepIndex, step] of scene.steps.entries()) {
        const stepPath = `${path}.steps[${stepIndex}]`;
        if (!isRecord(step)) throw new Error(`${stepPath} must be an object.`);
        requireString(step.id, `${stepPath}.id`);
        requireString(step.title, `${stepPath}.title`);
        requireString(step.body, `${stepPath}.body`);
        requireString(step.focus, `${stepPath}.focus`);
        requireOnlyKeys(step, ['id', 'title', 'body', 'focus', 'connection', 'depth', 'requirement', 'image'], stepPath);
        if (step.depth !== undefined && !['mentioned', 'explained', 'contextualized'].includes(String(step.depth))) {
            throw new Error(`${stepPath}.depth must be mentioned, explained, or contextualized.`);
        }
        validateStepRequirement(step.requirement, `${stepPath}.requirement`);
        validateTourImageSource(step.image, `${stepPath}.image`);
        if (stepIds.has(step.id)) throw new Error(`Duplicate step id in scene ${scene.id}: ${step.id}`);
        stepIds.add(step.id);
        if (!anchors[step.focus]) throw new Error(`${stepPath} references unknown anchor ${step.focus}.`);
        optionalString(step.connection, `${stepPath}.connection`);
        if (typeof step.connection === 'string' && !connectionIds.has(step.connection)) {
            throw new Error(`${stepPath} references unknown connection ${step.connection}.`);
        }
    }
}

function validateDeconstructedSelection(value: unknown, path: string, requiresReason: boolean): void {
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, requiresReason ? ['file', 'hunks', 'reason'] : ['file', 'hunks'], path);
    requireString(value.file, `${path}.file`);
    if (!requiresReason || value.hunks !== undefined) {
        requireStringArray(value.hunks, `${path}.hunks`);
        if (value.hunks.length === 0) throw new Error(`${path}.hunks must not be empty.`);
    }
    if (requiresReason) requireString(value.reason, `${path}.reason`);
}

function validateRealStack(stack: unknown, path: string, minimum: number): void {
    if (!Array.isArray(stack) || stack.length < minimum || stack.length > 6) {
        throw new Error(`${path} must contain between ${minimum} and 6 explicit real revisions.`);
    }
    const ids = new Set<string>();
    for (const [index, entry] of stack.entries()) {
        if (!isRecord(entry)) throw new Error(`${path}[${index}] must be an object.`);
        requireOnlyKeys(entry, ['id', 'ref', 'label'], `${path}[${index}]`);
        requireString(entry.id, `${path}[${index}].id`);
        requireString(entry.ref, `${path}[${index}].ref`);
        optionalString(entry.label, `${path}[${index}].label`);
        if (ids.has(entry.id)) throw new Error(`Duplicate stack entry id: ${entry.id}`);
        ids.add(entry.id);
    }
}

function validateStackedScene(scene: Record<string, unknown>, path: string, minimum = 3): void {
    requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'overview', 'stack', 'files', 'steps'], path);
    if (!Array.isArray(scene.stack) || scene.stack.length < minimum || scene.stack.length > 6) {
        throw new Error(`${path}.stack must contain between ${minimum} and 6 revisions.`);
    }
    const stackIds = new Set<string>();
    for (const [index, entry] of scene.stack.entries()) {
        const entryPath = `${path}.stack[${index}]`;
        if (!isRecord(entry)) throw new Error(`${entryPath} must be an object.`);
        requireOnlyKeys(entry, ['id', 'ref', 'label'], entryPath);
        requireString(entry.id, `${entryPath}.id`);
        requireString(entry.ref, `${entryPath}.ref`);
        optionalString(entry.label, `${entryPath}.label`);
        if (stackIds.has(entry.id)) throw new Error(`Duplicate stack entry id: ${entry.id}`);
        stackIds.add(entry.id);
    }
    if (scene.files !== undefined) requireStringArray(scene.files, `${path}.files`);
    if (!Array.isArray(scene.steps) || scene.steps.length === 0) throw new Error(`${path}.steps must be a non-empty array.`);
    const stepIds = new Set<string>();
    for (const [index, step] of scene.steps.entries()) {
        const stepPath = `${path}.steps[${index}]`;
        if (!isRecord(step)) throw new Error(`${stepPath} must be an object.`);
        requireOnlyKeys(step, ['id', 'title', 'body', 'file', 'pair', 'side', 'lines'], stepPath);
        requireString(step.id, `${stepPath}.id`);
        requireString(step.title, `${stepPath}.title`);
        requireString(step.body, `${stepPath}.body`);
        requireString(step.file, `${stepPath}.file`);
        const stepId = step.id;
        if (stepIds.has(stepId)) throw new Error(`Duplicate step id in scene ${scene.id}: ${stepId}`);
        stepIds.add(stepId);
        if (!Array.isArray(step.pair) || step.pair.length !== 2 || step.pair.some((id) => typeof id !== 'string')) {
            throw new Error(`${stepPath}.pair must contain two stack entry ids.`);
        }
        const pair = step.pair as string[];
        const leftIndex = scene.stack.findIndex((entry) => isRecord(entry) && entry.id === pair[0]);
        const rightIndex = scene.stack.findIndex((entry) => isRecord(entry) && entry.id === pair[1]);
        if (leftIndex < 0 || rightIndex !== leftIndex + 1) throw new Error(`${stepPath}.pair must reference adjacent stack entries in order.`);
        if (step.side !== undefined && step.side !== 'left' && step.side !== 'right') throw new Error(`${stepPath}.side must be left or right.`);
        if (step.lines !== undefined && (!Array.isArray(step.lines) || step.lines.length !== 2
            || step.lines.some((line) => !Number.isInteger(line) || Number(line) < 1)
            || Number(step.lines[1]) < Number(step.lines[0]))) {
            throw new Error(`${stepPath}.lines must contain an ordered positive line range.`);
        }
    }
}

export function validateStepRequirement(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['id', 'text', 'status', 'source', 'confidence'], path);
    requireString(value.id, `${path}.id`);
    requireString(value.text, `${path}.text`);
    if (value.status !== undefined && !['fulfilled', 'gap'].includes(String(value.status))) {
        throw new Error(`${path}.status must be fulfilled or gap.`);
    }
    optionalString(value.source, `${path}.source`);
    if (value.confidence !== undefined && !['high', 'medium', 'low'].includes(String(value.confidence))) {
        throw new Error(`${path}.confidence must be high, medium, or low.`);
    }
}

export interface SceneOverviewValidationOptions {
    allowComparison?: boolean;
    endpointIds?: readonly string[];
}

export function validateSceneOverview(
    value: unknown,
    path: string,
    options: SceneOverviewValidationOptions = {}
): asserts value is ChangeTourSourceSceneOverview | undefined {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['kind', 'path', 'comparison', 'purpose'], path);
    if (value.kind !== 'directory-diff') {
        throw new Error(`${path}.kind must be directory-diff.`);
    }
    if (value.purpose !== undefined) requireString(value.purpose, `${path}.purpose`);
    if (value.path !== undefined) validateDirectoryOverviewPath(value.path, `${path}.path`);
    if (value.comparison === undefined) return;
    if (options.allowComparison === false) {
        throw new Error(`${path}.comparison is not supported for walkthrough scenes; use the fixed base-to-head comparison.`);
    }
    if (!isRecord(value.comparison)) throw new Error(`${path}.comparison must be an object.`);
    requireOnlyKeys(value.comparison, ['from', 'to'], `${path}.comparison`);
    requireString(value.comparison.from, `${path}.comparison.from`);
    requireString(value.comparison.to, `${path}.comparison.to`);
    if (value.comparison.from === value.comparison.to) {
        throw new Error(`${path}.comparison.from and to must identify distinct endpoints.`);
    }
    if (options.endpointIds !== undefined) {
        for (const endpoint of [value.comparison.from, value.comparison.to]) {
            if (!options.endpointIds.includes(endpoint)) {
                throw new Error(`${path}.comparison endpoint ${endpoint} is not defined by this scene.`);
            }
        }
    }
}

export function validateDirectoryOverviewPath(value: unknown, path: string): asserts value is string {
    requireString(value, path);
    if (value.includes('\\')) {
        throw new Error(`${path} must use a relative POSIX directory path without backslashes.`);
    }
    if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
        throw new Error(`${path} must be relative to the repository root.`);
    }
    if (value.split('/').some((segment) => segment === '..')) {
        throw new Error(`${path} must not contain parent-directory traversal.`);
    }
}

function validateNarrative(value: Record<string, unknown>, path: string): void {
    requireString(value.summary, `${path}.summary`);
    requireStringArray(value.bullets, `${path}.bullets`);
    requireStringArray(value.tags, `${path}.tags`);
    requireString(value.takeaway, `${path}.takeaway`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${path} must be a non-empty string.`);
    }
}

function optionalString(value: unknown, path: string): void {
    if (value !== undefined) {
        requireString(value, path);
    }
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${path} must be an array of strings.`);
    }
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
    const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unexpected.length > 0) {
        throw new Error(`${path} contains unknown field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`);
    }
}
