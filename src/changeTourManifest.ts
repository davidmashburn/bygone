import type { BranchCommit, GitChangeKind } from './gitComparison';

export const CHANGE_TOUR_MANIFEST_VERSION = 1 as const;

export interface ChangeTourNarrative {
    summary: string;
    bullets: string[];
    tags: string[];
    takeaway: string;
}

export interface ChangeTourDiffScene extends ChangeTourNarrative {
    id: string;
    kind: 'text-diff';
    title: string;
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    leftLabel: string;
    rightLabel: string;
    leftContent: string;
    rightContent: string;
    additions: number;
    deletions: number;
    focusChangeIndex?: number;
}

export interface ChangeTourOmittedFile {
    id: string;
    kind: 'omitted';
    title: string;
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    additions: number;
    deletions: number;
    reason: string;
}

export type ChangeTourFile = ChangeTourDiffScene | ChangeTourOmittedFile;

export interface ChangeTourDiscussionScene extends ChangeTourNarrative {
    id: string;
    kind: 'discussion';
    title: string;
}

export interface ChangeTourResolvedAnchor {
    id: string;
    path: string;
    revision: 'base' | 'head';
    startLine: number;
    endLine: number;
    excerpt: string;
}

export interface ChangeTourResolvedConnection {
    id: string;
    label: string;
    from: ChangeTourResolvedAnchor;
    to: ChangeTourResolvedAnchor;
}

export interface ChangeTourWalkthroughStep {
    id: string;
    title: string;
    body: string;
    focus: ChangeTourResolvedAnchor;
    connection?: ChangeTourResolvedConnection;
    diff: ChangeTourDiffScene;
    depth?: 'mentioned' | 'explained' | 'contextualized';
}

export interface ChangeTourWalkthroughScene extends ChangeTourNarrative {
    id: string;
    kind: 'walkthrough';
    title: string;
    steps: ChangeTourWalkthroughStep[];
}

export interface ChangeTourStackPanel {
    id: string;
    ref: string;
    oid: string;
    label: string;
}

export interface ChangeTourStackFilePanel {
    id: string;
    label: string;
    path?: string;
    content: string;
    exists: boolean;
}

export interface ChangeTourStackFile {
    path: string;
    panels: ChangeTourStackFilePanel[];
}

export interface ChangeTourStackStep {
    id: string;
    title: string;
    body: string;
    file: string;
    pairIndex: number;
    side: 'left' | 'right';
    startLine?: number;
    endLine?: number;
}

export interface ChangeTourStackedScene extends ChangeTourNarrative {
    id: string;
    kind: 'stacked-diff';
    title: string;
    stack: ChangeTourStackPanel[];
    files: ChangeTourStackFile[];
    steps: ChangeTourStackStep[];
}

export interface ChangeTourVirtualPanel {
    id: string;
    label: string;
    role: 'baseline' | 'stage';
    stageId?: string;
}

export interface ChangeTourDeconstructedStep extends ChangeTourStackStep {
    introducedHunks: string[];
}

export interface ChangeTourDeconstructedScene extends ChangeTourNarrative {
    id: string;
    kind: 'deconstructed-diff';
    title: string;
    stageLabel: 'Explanation stages';
    realRange: {
        baseRef: string;
        targetRef: string;
        baseOid: string;
        targetOid: string;
    };
    panels: ChangeTourVirtualPanel[];
    files: ChangeTourStackFile[];
    steps: ChangeTourDeconstructedStep[];
}

export type ChangeTourScene = ChangeTourDiffScene
    | ChangeTourDiscussionScene
    | ChangeTourWalkthroughScene
    | ChangeTourStackedScene
    | ChangeTourDeconstructedScene;

export interface ChangeTourStory {
    title?: string;
    sourceUrl?: string;
    scenes: ChangeTourStoryScene[];
}

export type ChangeTourStoryScene =
    | (ChangeTourNarrative & {
        kind: 'discussion';
        chapterId: string;
        chapterTitle: string;
        title: string;
    })
    | (ChangeTourNarrative & {
        kind: 'file';
        chapterId: string;
        chapterTitle: string;
        path: string;
        title?: string;
        focusChangeIndex?: number;
    });

export interface ChangeTourChapter {
    id: string;
    title: string;
    sceneIds: string[];
}

export interface ChangeTourManifest {
    version: typeof CHANGE_TOUR_MANIFEST_VERSION;
    title: string;
    windowTitle?: string;
    sourceUrl?: string;
    generatedAt: string;
    range: {
        baseRef: string;
        headRef: string;
        mergeBaseOid: string;
        headOid: string;
    };
    summary: {
        changedFiles: number;
        includedScenes: number;
        additions: number;
        deletions: number;
        commitCount: number;
        omittedFiles: string[];
    };
    commits: BranchCommit[];
    files: ChangeTourFile[];
    chapters: ChangeTourChapter[];
    scenes: ChangeTourScene[];
}

export function parseChangeTourManifest(value: unknown): ChangeTourManifest {
    if (!isRecord(value) || value.version !== CHANGE_TOUR_MANIFEST_VERSION) {
        throw new Error(`Unsupported or missing change-tour manifest version.`);
    }
    requireString(value.title, 'title');
    requireString(value.generatedAt, 'generatedAt');
    if (value.windowTitle !== undefined) {
        requireString(value.windowTitle, 'windowTitle');
    }
    if (value.sourceUrl !== undefined) {
        requireString(value.sourceUrl, 'sourceUrl');
    }
    if (!isRecord(value.range)) {
        throw new Error('Change-tour manifest range must be an object.');
    }
    for (const key of ['baseRef', 'headRef', 'mergeBaseOid', 'headOid']) {
        requireString(value.range[key], `range.${key}`);
    }
    if (!isRecord(value.summary)) {
        throw new Error('Change-tour manifest summary must be an object.');
    }
    for (const key of ['changedFiles', 'includedScenes', 'additions', 'deletions', 'commitCount']) {
        requireNonNegativeInteger(value.summary[key], `summary.${key}`);
    }
    requireStringArray(value.summary.omittedFiles, 'summary.omittedFiles');
    if (!Array.isArray(value.commits) || !Array.isArray(value.chapters) || !Array.isArray(value.scenes)) {
        throw new Error('Change-tour manifest commits, chapters, and scenes must be arrays.');
    }
    if (value.files !== undefined && !Array.isArray(value.files)) {
        throw new Error('Change-tour manifest files must be an array.');
    }

    const sceneIds = new Set<string>();
    for (const [index, candidate] of value.scenes.entries()) {
        validateScene(candidate, index);
        if (sceneIds.has(candidate.id)) {
            throw new Error(`Duplicate change-tour scene id: ${candidate.id}`);
        }
        sceneIds.add(candidate.id);
    }
    for (const [index, candidate] of value.chapters.entries()) {
        if (!isRecord(candidate)) {
            throw new Error(`chapters[${index}] must be an object.`);
        }
        requireString(candidate.id, `chapters[${index}].id`);
        requireString(candidate.title, `chapters[${index}].title`);
        requireStringArray(candidate.sceneIds, `chapters[${index}].sceneIds`);
        for (const sceneId of candidate.sceneIds) {
            if (!sceneIds.has(sceneId)) {
                throw new Error(`Chapter references unknown scene id: ${sceneId}`);
            }
        }
    }
    if (value.summary.includedScenes !== value.scenes.length) {
        throw new Error('summary.includedScenes must match the number of scenes.');
    }

    const files = value.files === undefined
        ? collectLegacyTourFiles(value.scenes as unknown as ChangeTourScene[])
        : value.files.map((candidate, index) => {
            validateTourFile(candidate, index);
            return candidate;
        });
    if (value.files !== undefined && value.summary.changedFiles !== files.length) {
        throw new Error('summary.changedFiles must match the number of files.');
    }

    return { ...value, files } as unknown as ChangeTourManifest;
}

export function parseChangeTourStory(value: unknown): ChangeTourStory {
    if (!isRecord(value) || !Array.isArray(value.scenes)) {
        throw new Error('Change-tour story must contain a scenes array.');
    }
    if (value.title !== undefined) {
        requireString(value.title, 'title');
    }
    if (value.sourceUrl !== undefined) {
        requireString(value.sourceUrl, 'sourceUrl');
    }
    for (const [index, scene] of value.scenes.entries()) {
        if (!isRecord(scene) || (scene.kind !== 'discussion' && scene.kind !== 'file')) {
            throw new Error(`story.scenes[${index}] must be a discussion or file scene.`);
        }
        requireString(scene.chapterId, `story.scenes[${index}].chapterId`);
        requireString(scene.chapterTitle, `story.scenes[${index}].chapterTitle`);
        validateNarrative(scene, `story.scenes[${index}]`);
        if (scene.kind === 'discussion') {
            requireString(scene.title, `story.scenes[${index}].title`);
        } else {
            requireString(scene.path, `story.scenes[${index}].path`);
            if (scene.title !== undefined) {
                requireString(scene.title, `story.scenes[${index}].title`);
            }
            if (scene.focusChangeIndex !== undefined) {
                requireNonNegativeInteger(scene.focusChangeIndex, `story.scenes[${index}].focusChangeIndex`);
            }
        }
    }
    return value as unknown as ChangeTourStory;
}

function validateScene(value: unknown, index: number): asserts value is ChangeTourScene {
    if (!isRecord(value) || !['text-diff', 'discussion', 'walkthrough', 'stacked-diff', 'deconstructed-diff'].includes(String(value.kind))) {
        throw new Error(`scenes[${index}] must be a text-diff, discussion, walkthrough, stacked-diff, or deconstructed-diff scene.`);
    }
    for (const key of ['id', 'title']) {
        requireString(value[key], `scenes[${index}].${key}`);
    }
    validateNarrative(value, `scenes[${index}]`);
    if (value.kind === 'discussion') {
        return;
    }
    if (value.kind === 'walkthrough') {
        if (!Array.isArray(value.steps) || value.steps.length === 0) {
            throw new Error(`scenes[${index}].steps must be a non-empty array.`);
        }
        for (const [stepIndex, step] of value.steps.entries()) {
            const path = `scenes[${index}].steps[${stepIndex}]`;
            if (!isRecord(step) || !isRecord(step.focus) || !isRecord(step.diff)) {
                throw new Error(`${path} must contain focus and diff objects.`);
            }
            for (const key of ['id', 'title', 'body']) requireString(step[key], `${path}.${key}`);
            if (step.depth !== undefined && !['mentioned', 'explained', 'contextualized'].includes(String(step.depth))) {
                throw new Error(`${path}.depth must be mentioned, explained, or contextualized.`);
            }
            validateResolvedAnchor(step.focus, `${path}.focus`);
            validateScene(step.diff, index);
            if (step.diff.kind !== 'text-diff') throw new Error(`${path}.diff must be a text-diff scene.`);
            if (step.connection !== undefined) {
                if (!isRecord(step.connection)) throw new Error(`${path}.connection must be an object.`);
                requireString(step.connection.id, `${path}.connection.id`);
                requireString(step.connection.label, `${path}.connection.label`);
                validateResolvedAnchor(step.connection.from, `${path}.connection.from`);
                validateResolvedAnchor(step.connection.to, `${path}.connection.to`);
            }
        }
        return;
    }
    if (value.kind === 'stacked-diff') {
        validateStackedScene(value, index);
        return;
    }
    if (value.kind === 'deconstructed-diff') {
        validateDeconstructedScene(value, index);
        return;
    }
    for (const key of ['path', 'leftLabel', 'rightLabel', 'leftContent', 'rightContent']) {
        requireString(value[key], `scenes[${index}].${key}`);
    }
    if (value.previousPath !== undefined) {
        requireString(value.previousPath, `scenes[${index}].previousPath`);
    }
    requireString(value.changeKind, `scenes[${index}].changeKind`);
    requireNonNegativeInteger(value.additions, `scenes[${index}].additions`);
    requireNonNegativeInteger(value.deletions, `scenes[${index}].deletions`);
    if (value.focusChangeIndex !== undefined) {
        requireNonNegativeInteger(value.focusChangeIndex, `scenes[${index}].focusChangeIndex`);
    }
}

function validateStackedScene(value: Record<string, unknown>, index: number): void {
    if (!Array.isArray(value.stack) || value.stack.length < 3 || value.stack.length > 6) {
        throw new Error(`scenes[${index}].stack must contain between 3 and 6 revisions.`);
    }
    for (const [panelIndex, panel] of value.stack.entries()) {
        if (!isRecord(panel)) throw new Error(`scenes[${index}].stack[${panelIndex}] must be an object.`);
        for (const key of ['id', 'ref', 'oid', 'label']) requireString(panel[key], `scenes[${index}].stack[${panelIndex}].${key}`);
    }
    validateMultiPanelFiles(value.files, value.stack.length, index);
    validateMultiPanelSteps(value.steps, value.stack.length, index, false);
}

function validateDeconstructedScene(value: Record<string, unknown>, index: number): void {
    if (value.stageLabel !== 'Explanation stages') {
        throw new Error(`scenes[${index}].stageLabel must be Explanation stages.`);
    }
    if (!isRecord(value.realRange)) throw new Error(`scenes[${index}].realRange must be an object.`);
    for (const key of ['baseRef', 'targetRef', 'baseOid', 'targetOid']) {
        requireString(value.realRange[key], `scenes[${index}].realRange.${key}`);
    }
    if (!Array.isArray(value.panels) || value.panels.length < 2 || value.panels.length > 13) {
        throw new Error(`scenes[${index}].panels must contain a baseline and between 1 and 12 stages.`);
    }
    const panels = value.panels;
    for (const [panelIndex, panel] of panels.entries()) {
        if (!isRecord(panel)) throw new Error(`scenes[${index}].panels[${panelIndex}] must be an object.`);
        for (const key of ['id', 'label', 'role']) requireString(panel[key], `scenes[${index}].panels[${panelIndex}].${key}`);
        const expectedRole = panelIndex === 0 ? 'baseline' : 'stage';
        if (panel.role !== expectedRole) throw new Error(`scenes[${index}].panels[${panelIndex}].role must be ${expectedRole}.`);
        if (panelIndex > 0) requireString(panel.stageId, `scenes[${index}].panels[${panelIndex}].stageId`);
    }
    validateMultiPanelFiles(value.files, panels.length, index);
    validateMultiPanelSteps(value.steps, panels.length, index, true);
    if (Array.isArray(value.steps) && value.steps.length !== panels.length - 1) {
        throw new Error(`scenes[${index}].steps must match the number of explanation stages.`);
    }
    if (Array.isArray(value.steps)) {
        value.steps.forEach((step, stepIndex) => {
            const panel = panels[stepIndex + 1];
            if (!isRecord(step) || !isRecord(panel) || panel.stageId !== step.id) {
                throw new Error(`scenes[${index}].panels must align with explanation stage ids.`);
            }
        });
    }
}

function validateMultiPanelFiles(value: unknown, panelCount: number, index: number): void {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`scenes[${index}].files must be non-empty.`);
    for (const [fileIndex, file] of value.entries()) {
        if (!isRecord(file)) throw new Error(`scenes[${index}].files[${fileIndex}] must be an object.`);
        requireString(file.path, `scenes[${index}].files[${fileIndex}].path`);
        if (!Array.isArray(file.panels) || file.panels.length !== panelCount) {
            throw new Error(`scenes[${index}].files[${fileIndex}].panels must match panel count.`);
        }
        for (const [panelIndex, panel] of file.panels.entries()) {
            if (!isRecord(panel)) throw new Error(`scenes[${index}].files[${fileIndex}].panels[${panelIndex}] must be an object.`);
            for (const key of ['id', 'label', 'content']) requireString(panel[key], `scenes[${index}].files[${fileIndex}].panels[${panelIndex}].${key}`);
            if (panel.path !== undefined) requireString(panel.path, `scenes[${index}].files[${fileIndex}].panels[${panelIndex}].path`);
            if (typeof panel.exists !== 'boolean') throw new Error(`scenes[${index}].files[${fileIndex}].panels[${panelIndex}].exists must be boolean.`);
        }
    }
}

function validateMultiPanelSteps(value: unknown, panelCount: number, index: number, deconstructed: boolean): void {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`scenes[${index}].steps must be non-empty.`);
    for (const [stepIndex, step] of value.entries()) {
        if (!isRecord(step)) throw new Error(`scenes[${index}].steps[${stepIndex}] must be an object.`);
        for (const key of ['id', 'title', 'body', 'file', 'side']) requireString(step[key], `scenes[${index}].steps[${stepIndex}].${key}`);
        requireNonNegativeInteger(step.pairIndex, `scenes[${index}].steps[${stepIndex}].pairIndex`);
        if (Number(step.pairIndex) >= panelCount - 1) throw new Error(`scenes[${index}].steps[${stepIndex}].pairIndex is outside the panels.`);
        if (deconstructed) {
            requireStringArray(step.introducedHunks, `scenes[${index}].steps[${stepIndex}].introducedHunks`);
            if (step.introducedHunks.length === 0) throw new Error(`scenes[${index}].steps[${stepIndex}].introducedHunks must be non-empty.`);
            if (Number(step.pairIndex) !== stepIndex) throw new Error(`scenes[${index}].steps[${stepIndex}].pairIndex must match its explanation stage.`);
        }
        if (step.side !== 'left' && step.side !== 'right') throw new Error(`scenes[${index}].steps[${stepIndex}].side must be left or right.`);
        if (step.startLine !== undefined) requirePositiveInteger(step.startLine, `scenes[${index}].steps[${stepIndex}].startLine`);
        if (step.endLine !== undefined) requirePositiveInteger(step.endLine, `scenes[${index}].steps[${stepIndex}].endLine`);
    }
}

function validateTourFile(value: unknown, index: number): asserts value is ChangeTourFile {
    if (!isRecord(value)) throw new Error(`files[${index}] must be an object.`);
    if (value.kind === 'text-diff') {
        validateScene(value, index);
        return;
    }
    if (value.kind !== 'omitted') {
        throw new Error(`files[${index}].kind must be text-diff or omitted.`);
    }
    for (const key of ['id', 'title', 'path', 'changeKind', 'reason']) {
        requireString(value[key], `files[${index}].${key}`);
    }
    if (value.previousPath !== undefined) requireString(value.previousPath, `files[${index}].previousPath`);
    requireNonNegativeInteger(value.additions, `files[${index}].additions`);
    requireNonNegativeInteger(value.deletions, `files[${index}].deletions`);
}

function collectLegacyTourFiles(scenes: readonly ChangeTourScene[]): ChangeTourFile[] {
    const files = new Map<string, ChangeTourDiffScene>();
    for (const scene of scenes) {
        if (scene.kind === 'text-diff') {
            if (!files.has(scene.path)) files.set(scene.path, scene);
            continue;
        }
        if (scene.kind === 'walkthrough') {
            for (const step of scene.steps) {
                if (!files.has(step.diff.path)) files.set(step.diff.path, step.diff);
            }
        }
    }
    return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function validateResolvedAnchor(value: unknown, path: string): void {
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    for (const key of ['id', 'path', 'revision', 'excerpt']) requireString(value[key], `${path}.${key}`);
    if (value.revision !== 'base' && value.revision !== 'head') throw new Error(`${path}.revision must be base or head.`);
    requirePositiveInteger(value.startLine, `${path}.startLine`);
    requirePositiveInteger(value.endLine, `${path}.endLine`);
    if (Number(value.endLine) < Number(value.startLine)) throw new Error(`${path}.endLine must not precede startLine.`);
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
    if (typeof value !== 'string') {
        throw new Error(`${path} must be a string.`);
    }
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${path} must be an array of strings.`);
    }
}

function requireNonNegativeInteger(value: unknown, path: string): asserts value is number {
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new Error(`${path} must be a non-negative integer.`);
    }
}

function requirePositiveInteger(value: unknown, path: string): asserts value is number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${path} must be a positive integer.`);
}
