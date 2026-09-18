import type { BranchCommit, GitChangeKind } from './gitComparison';
import { validateStepRequirement, type ChangeTourStepRequirement } from './changeTourSource';

export const CHANGE_TOUR_MANIFEST_VERSION = 2 as const;

export type ChangeTourMode = 'explanation' | 'revisions' | 'final' | 'history';

export interface ChangeTourZoom {
    authoredDepth: Exclude<ChangeTourMode, 'history'>;
    modes: ChangeTourMode[];
    /** Real authored stacks, including two-panel stacks collapsed into Final diff. */
    revisions: ChangeTourStackedScene[];
    /** The authored or derived non-stacked tour over the real endpoint diff. */
    final: {
        chapters: ChangeTourChapter[];
        scenes: ChangeTourScene[];
    };
}

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
    requirement?: ChangeTourStepRequirement;
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
    stageId?: string;
    stageIndex?: number;
    focusIndex?: number;
    focusCount?: number;
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

export interface ChangeTourAuthoringCoverage {
    walkthrough: {
        scope: 'tour' | 'final';
        coveredUnits: number;
        includedUnits: number;
        coveragePercent: number;
    };
    explanationAssignments: Array<{
        sceneId: string;
        assignedUnits: number;
        excludedUnits: number;
        completeUnits: number;
        totalUnits: number;
        assignmentPercent: number;
    }>;
}

export interface ChangeTourManifest {
    version: 1 | typeof CHANGE_TOUR_MANIFEST_VERSION;
    repository?: { root: string };
    zoom?: ChangeTourZoom;
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
    /** Optional authoring diagnostics supplied by the local presentation host. */
    authoringCoverage?: ChangeTourAuthoringCoverage;
}

export function parseChangeTourManifest(value: unknown): ChangeTourManifest {
    if (!isRecord(value) || (value.version !== 1 && value.version !== CHANGE_TOUR_MANIFEST_VERSION)) {
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

    if (value.authoringCoverage !== undefined) {
        validateAuthoringCoverage(value.authoringCoverage, value.version);
    }

    if (value.version === 2) validateZoom(value);

    return { ...value, files } as unknown as ChangeTourManifest;
}

function validateAuthoringCoverage(value: unknown, version: 1 | 2): asserts value is ChangeTourAuthoringCoverage {
    if (!isRecord(value) || !isRecord(value.walkthrough) || !Array.isArray(value.explanationAssignments)) {
        throw new Error('authoringCoverage must contain walkthrough and explanationAssignments.');
    }
    const expectedScope = version === 2 ? 'final' : 'tour';
    if (value.walkthrough.scope !== expectedScope) {
        throw new Error(`authoringCoverage.walkthrough.scope must be ${expectedScope}.`);
    }
    requireNonNegativeInteger(value.walkthrough.coveredUnits, 'authoringCoverage.walkthrough.coveredUnits');
    requireNonNegativeInteger(value.walkthrough.includedUnits, 'authoringCoverage.walkthrough.includedUnits');
    requirePercentage(value.walkthrough.coveragePercent, 'authoringCoverage.walkthrough.coveragePercent');
    if (value.walkthrough.coveredUnits > value.walkthrough.includedUnits) {
        throw new Error('authoringCoverage.walkthrough.coveredUnits must not exceed includedUnits.');
    }
    for (const [index, assignment] of value.explanationAssignments.entries()) {
        const path = `authoringCoverage.explanationAssignments[${index}]`;
        if (!isRecord(assignment)) throw new Error(`${path} must be an object.`);
        requireString(assignment.sceneId, `${path}.sceneId`);
        requireNonNegativeInteger(assignment.assignedUnits, `${path}.assignedUnits`);
        requireNonNegativeInteger(assignment.excludedUnits, `${path}.excludedUnits`);
        requireNonNegativeInteger(assignment.completeUnits, `${path}.completeUnits`);
        requireNonNegativeInteger(assignment.totalUnits, `${path}.totalUnits`);
        requirePercentage(assignment.assignmentPercent, `${path}.assignmentPercent`);
        if (assignment.assignedUnits + assignment.excludedUnits !== assignment.completeUnits
            || assignment.completeUnits > assignment.totalUnits) {
            throw new Error(`${path} contains inconsistent unit counts.`);
        }
    }
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

function validateZoom(value: Record<string, unknown>): void {
    if (!isRecord(value.repository) || typeof value.repository.root !== 'string' || !value.repository.root) {
        throw new Error('A v2 tour requires its originating repository.root.');
    }
    if (!isRecord(value.zoom) || !Array.isArray(value.zoom.revisions) || !isRecord(value.zoom.final)) {
        throw new Error('A v2 tour requires zoom metadata and real revision evidence.');
    }
    const scenes = value.scenes as ChangeTourScene[];
    const revisions = value.zoom.revisions;
    const ids = new Set<string>();
    for (const [index, scene] of revisions.entries()) {
        validateScene(scene, index);
        if (scene.kind !== 'stacked-diff') throw new Error('zoom.revisions must contain real stacked-diff scenes.');
        if (ids.has(scene.id)) throw new Error(`Duplicate zoom revision scene: ${scene.id}`);
        ids.add(scene.id);
        const range = value.range as ChangeTourManifest['range'];
        if (scene.stack[0].oid !== range.mergeBaseOid || scene.stack[scene.stack.length - 1].oid !== range.headOid) {
            throw new Error(`Revision scene ${scene.id} endpoints must match the final diff range.`);
        }
    }
    for (const scene of scenes) {
        if (scene.kind !== 'deconstructed-diff' && scene.kind !== 'stacked-diff') continue;
        const real = revisions.find((candidate) => candidate.id === scene.id) as ChangeTourStackedScene | undefined;
        if (!real) throw new Error(`Scene ${scene.id} is missing its real revision evidence.`);
        if (scene.kind === 'deconstructed-diff' && (real.stack[0].oid !== scene.realRange.baseOid
            || real.stack[real.stack.length - 1].oid !== scene.realRange.targetOid)) {
            throw new Error(`Deconstructed scene ${scene.id} real stack endpoints must match its explanation range.`);
        }
    }
    const explanation = scenes.some((scene) => scene.kind === 'deconstructed-diff');
    const distinct = revisions.some((scene) => scene.stack.length > 2);
    const depth = explanation ? 'explanation' : distinct ? 'revisions' : 'final';
    const modes = [...(explanation ? ['explanation'] : []), ...(distinct ? ['revisions'] : []), 'final', 'history'];
    if (value.zoom.authoredDepth !== depth || JSON.stringify(value.zoom.modes) !== JSON.stringify(modes)) {
        throw new Error('zoom depth and modes must match the maximum authored depth.');
    }
    if (!Array.isArray(value.files)) throw new Error('A v2 tour requires final endpoint file evidence.');
    if (!Array.isArray(value.zoom.final.scenes) || !Array.isArray(value.zoom.final.chapters)) {
        throw new Error('A v2 tour requires a non-stacked final tour.');
    }
    const finalSceneIds = new Set<string>();
    for (const [index, scene] of value.zoom.final.scenes.entries()) {
        validateScene(scene, index);
        if (scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff') {
            throw new Error('zoom.final must contain only non-stacked scenes.');
        }
        if (finalSceneIds.has(scene.id)) throw new Error(`Duplicate final tour scene: ${scene.id}`);
        finalSceneIds.add(scene.id);
    }
    for (const [index, chapter] of value.zoom.final.chapters.entries()) {
        if (!isRecord(chapter) || !Array.isArray(chapter.sceneIds)) {
            throw new Error(`zoom.final.chapters[${index}] must contain sceneIds.`);
        }
        requireString(chapter.id, `zoom.final.chapters[${index}].id`);
        requireString(chapter.title, `zoom.final.chapters[${index}].title`);
        for (const sceneId of chapter.sceneIds) {
            requireString(sceneId, `zoom.final.chapters[${index}].sceneIds`);
            if (!finalSceneIds.has(sceneId)) throw new Error(`Final tour chapter references unknown scene: ${sceneId}`);
        }
    }
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
            validateStepRequirement(step.requirement, `${path}.requirement`);
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
    if (!Array.isArray(value.stack) || value.stack.length < 2 || value.stack.length > 6) {
        throw new Error(`scenes[${index}].stack must contain between 2 and 6 revisions.`);
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
    if (Array.isArray(value.steps)) {
        let previousPairIndex = -1;
        value.steps.forEach((step, stepIndex) => {
            if (!isRecord(step)) return;
            const pairIndex = Number(step.pairIndex);
            if (pairIndex < previousPairIndex) {
                throw new Error(`scenes[${index}].steps must remain grouped in explanation stage order.`);
            }
            previousPairIndex = pairIndex;
            if (step.stageId !== undefined) requireString(step.stageId, `scenes[${index}].steps[${stepIndex}].stageId`);
            if (step.stageIndex !== undefined) requireNonNegativeInteger(step.stageIndex, `scenes[${index}].steps[${stepIndex}].stageIndex`);
            if (step.focusIndex !== undefined) requireNonNegativeInteger(step.focusIndex, `scenes[${index}].steps[${stepIndex}].focusIndex`);
            if (step.focusCount !== undefined) requirePositiveInteger(step.focusCount, `scenes[${index}].steps[${stepIndex}].focusCount`);
            if (step.stageIndex !== undefined && Number(step.stageIndex) !== pairIndex) {
                throw new Error(`scenes[${index}].steps[${stepIndex}].stageIndex must match pairIndex.`);
            }
            if (step.focusIndex !== undefined && step.focusCount !== undefined
                && Number(step.focusIndex) >= Number(step.focusCount)) {
                throw new Error(`scenes[${index}].steps[${stepIndex}].focusIndex must be less than focusCount.`);
            }
        });
        for (let stageIndex = 0; stageIndex < panels.length - 1; stageIndex += 1) {
            const panel = panels[stageIndex + 1];
            const stageSteps = value.steps.filter((step) => isRecord(step) && Number(step.pairIndex) === stageIndex);
            if (!isRecord(panel) || stageSteps.length === 0) {
                throw new Error(`scenes[${index}].steps must cover every explanation stage.`);
            }
            const firstStep = stageSteps[0];
            const fallbackStageId = isRecord(firstStep) ? firstStep.id : undefined;
            if (stageSteps.some((step) => {
                if (!isRecord(step)) return true;
                return (step.stageId ?? fallbackStageId) !== panel.stageId;
            })) {
                throw new Error(`scenes[${index}].panels must align with explanation stage ids.`);
            }
        }
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

function requirePercentage(value: unknown, path: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`${path} must be a number from 0 to 100.`);
    }
}

function requirePositiveInteger(value: unknown, path: string): asserts value is number {
    if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${path} must be a positive integer.`);
}
