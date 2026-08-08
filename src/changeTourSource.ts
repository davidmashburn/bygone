import type { ChangeTourNarrative } from './changeTourManifest';

export const CHANGE_TOUR_SOURCE_VERSION = 1 as const;

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

export interface ChangeTourSourceStep {
    id: string;
    title: string;
    body: string;
    focus: string;
    connection?: string;
    depth?: 'mentioned' | 'explained' | 'contextualized';
}

export interface ChangeTourCoverageExclusion {
    path: string;
    hunks?: string[];
    reason: string;
}

export interface ChangeTourSourceWalkthroughScene extends ChangeTourNarrative {
    id: string;
    kind?: 'walkthrough';
    title: string;
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
    base?: string;
    target?: string;
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

export interface ChangeTourSource {
    version: typeof CHANGE_TOUR_SOURCE_VERSION;
    title?: string;
    sourceUrl?: string;
    range?: {
        base: string;
        head: string;
    };
    anchors: Record<string, ChangeTourSourceAnchor>;
    connections: ChangeTourSourceConnection[];
    chapters: ChangeTourSourceChapter[];
    coverage?: { exclusions: ChangeTourCoverageExclusion[] };
}

export function parseChangeTourSource(value: unknown): ChangeTourSource {
    if (!isRecord(value) || value.version !== CHANGE_TOUR_SOURCE_VERSION) {
        throw new Error('Unsupported or missing change-tour source version.');
    }
    requireOnlyKeys(value, ['version', 'title', 'sourceUrl', 'range', 'anchors', 'connections', 'chapters', 'coverage'], 'source');
    optionalString(value.title, 'title');
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
    const chapterIds = new Set<string>();
    const sceneIds = new Set<string>();
    for (const [chapterIndex, chapter] of value.chapters.entries()) {
        if (!isRecord(chapter) || !Array.isArray(chapter.scenes) || chapter.scenes.length === 0) {
            throw new Error(`chapters[${chapterIndex}] must contain a non-empty scenes array.`);
        }
        requireString(chapter.id, `chapters[${chapterIndex}].id`);
        requireString(chapter.title, `chapters[${chapterIndex}].title`);
        requireOnlyKeys(chapter, ['id', 'title', 'scenes'], `chapters[${chapterIndex}]`);
        if (chapterIds.has(chapter.id)) throw new Error(`Duplicate chapter id: ${chapter.id}`);
        chapterIds.add(chapter.id);
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
            const path = `chapters[${chapterIndex}].scenes[${sceneIndex}]`;
            if (!isRecord(scene)) throw new Error(`${path} must be an object.`);
            requireString(scene.id, `${path}.id`);
            requireString(scene.title, `${path}.title`);
            if (sceneIds.has(scene.id)) throw new Error(`Duplicate scene id: ${scene.id}`);
            sceneIds.add(scene.id);
            validateNarrative(scene, path);
            if (scene.kind === 'deconstructed-diff') {
                validateDeconstructedScene(scene, path);
                continue;
            }
            if (!Array.isArray(scene.steps) || scene.steps.length === 0) {
                throw new Error(`${path} must contain a non-empty steps array.`);
            }
            if (scene.kind === 'stacked-diff') {
                validateStackedScene(scene, path);
                continue;
            }
            if (scene.kind !== undefined && scene.kind !== 'walkthrough') {
                throw new Error(`${path}.kind must be walkthrough, stacked-diff, or deconstructed-diff.`);
            }
            requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'steps'], path);
            const stepIds = new Set<string>();
            for (const [stepIndex, step] of scene.steps.entries()) {
                const stepPath = `${path}.steps[${stepIndex}]`;
                if (!isRecord(step)) {
                    throw new Error(`${stepPath} must be an object.`);
                }
                requireString(step.id, `${stepPath}.id`);
                requireString(step.title, `${stepPath}.title`);
                requireString(step.body, `${stepPath}.body`);
                requireString(step.focus, `${stepPath}.focus`);
                requireOnlyKeys(step, ['id', 'title', 'body', 'focus', 'connection', 'depth'], stepPath);
                if (step.depth !== undefined && !['mentioned', 'explained', 'contextualized'].includes(String(step.depth))) {
                    throw new Error(`${stepPath}.depth must be mentioned, explained, or contextualized.`);
                }
                if (stepIds.has(step.id)) throw new Error(`Duplicate step id in scene ${scene.id}: ${step.id}`);
                stepIds.add(step.id);
                const focus = step.focus;
                if (!value.anchors[focus]) {
                    throw new Error(`${stepPath} references unknown anchor ${focus}.`);
                }
                optionalString(step.connection, `${stepPath}.connection`);
                const connection = step.connection;
                if (typeof connection === 'string' && !connectionIds.has(connection)) {
                    throw new Error(`${stepPath} references unknown connection ${connection}.`);
                }
            }
        }
    }
    return { ...value, connections: rawConnections } as unknown as ChangeTourSource;
}

function validateDeconstructedScene(scene: Record<string, unknown>, path: string): void {
    requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'base', 'target', 'stages', 'exclusions'], path);
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

function validateStackedScene(scene: Record<string, unknown>, path: string): void {
    requireOnlyKeys(scene, ['id', 'kind', 'title', 'summary', 'bullets', 'tags', 'takeaway', 'stack', 'files', 'steps'], path);
    if (!Array.isArray(scene.stack) || scene.stack.length < 3 || scene.stack.length > 6) {
        throw new Error(`${path}.stack must contain between 3 and 6 revisions.`);
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
