import { tourReadingTitle, buildTourRoute, describeStepOrientation, TourOrientationDetail } from './tourOrientation';
import type { ChangeTourManifest, ChangeTourScene } from './changeTourManifest';
import { buildTourReadingItems, getTourStepBranch } from './tourReading';
import type { TourBranchLocation, TourReadingItem } from './tourReading';
import type { TourPosition } from './tourNavigation';

export const DEFAULT_NARRATION_SEGMENT_LIMIT = 240;

export interface TourNarrationCost {
    main: { stops: number; words: number };
    optional: { stops: number; words: number };
}

/** Measure the same continuous speech projection the reader uses, including framing. */
export function getTourNarrationCost(tour: ChangeTourManifest): TourNarrationCost {
    const cost = (items: TourReadingItem[]) => ({
        stops: items.length,
        words: items.reduce((total, item) => total + buildReadingNarrationUnit(tour, item, { entry: 'continuous' }, items)
            .segments.reduce((sum, segment) => sum + segment.speechText.trim().split(/\s+/u).filter(Boolean).length, 0), 0)
    });
    const main = cost(buildTourReadingItems(tour));
    const optional = { stops: 0, words: 0 };
    tour.scenes.forEach((scene, sceneIndex) => {
        const seen = new Set<string>();
        if (!isSteppedScene(scene)) return;
        for (const step of scene.steps) {
            const branch = getTourStepBranch(step);
            if (!branch || seen.has(branch.id)) continue;
            seen.add(branch.id);
            const branchCost = cost(buildTourReadingItems(tour, { sceneIndex, branchId: branch.id }));
            optional.stops += branchCost.stops;
            optional.words += branchCost.words;
        }
    });
    return { main, optional };
}

export type NarrationField =
    | 'document-title'
    | 'passage-title'
    | 'route-summary'
    | 'route-title'
    | 'route-chapter'
    | 'step-orientation'
    | 'chapter'
    | 'scene-title'
    | 'overview-purpose'
    | 'summary'
    | 'bullet'
    | 'step-title'
    | 'step-body'
    | 'stage-title'
    | 'connection'
    | 'takeaway';

export interface NarrationSource {
    field: NarrationField;
    itemIndex?: number;
}

export interface NarrationSegment {
    id: string;
    text: string;
    speechText: string;
    source: NarrationSource;
    startOffset: number;
    endOffset: number;
}

export interface NarrationUnit {
    id: string;
    /** Reading identity is authoritative; position is retained for the legacy builder. */
    readingKey?: string;
    position?: TourPosition;
    segments: NarrationSegment[];
    /** Allows the reader to render the exact source text used for offsets. */
    orientationDetail?: TourOrientationDetail;
}

export interface BuildNarrationUnitOptions {
    entry: 'playback-start' | 'continuous';
    segmentLimit?: number;
    /** The currently rendered route, when the caller already has one. */
    activeItems?: readonly TourReadingItem[];
}

interface NarrationFieldValue {
    source: NarrationSource;
    text: string;
}

interface TextRange {
    text: string;
    startOffset: number;
    endOffset: number;
}

export function buildTourNarrationUnit(
    tour: ChangeTourManifest,
    position: TourPosition,
    options: BuildNarrationUnitOptions
): NarrationUnit | null {
    const scene = tour.scenes[position.sceneIndex];
    if (!scene) return null;
    const stepIndex = isSteppedScene(scene)
        ? Math.min(Math.max(position.stepIndex, 0), scene.steps.length - 1)
        : 0;
    const normalizedPosition = { sceneIndex: position.sceneIndex, stepIndex };
    const step = isSteppedScene(scene) ? scene.steps[stepIndex] : undefined;
    const branch = getTourStepBranch(step);
    const fields: NarrationFieldValue[] = [];
    const includeFullIntroduction = !step || stepIndex === 0;
    const includeOrientationTitle = Boolean(step && stepIndex > 0 && options.entry === 'playback-start');

    if (includeFullIntroduction) {
        const chapter = tour.chapters.find((candidate) => candidate.sceneIds.includes(scene.id));
        if (chapter) fields.push({ source: { field: 'chapter' }, text: chapter.title });
    }
    if (includeFullIntroduction || includeOrientationTitle) {
        fields.push({ source: { field: 'scene-title' }, text: scene.title });
    }
    if (includeFullIntroduction) {
        fields.push({ source: { field: 'summary' }, text: scene.summary });
        scene.bullets.forEach((text, itemIndex) => {
            fields.push({ source: { field: 'bullet', itemIndex }, text });
        });
    }
    if (step) {
        fields.push({ source: { field: 'step-title' }, text: step.title });
        fields.push({ source: { field: 'step-body' }, text: step.body });
        if ('connection' in step && step.connection?.label) {
            fields.push({ source: { field: 'connection' }, text: step.connection.label });
        }
    }
    const activeItems = step ? getActiveItems(tour, position.sceneIndex, branch, options.activeItems) : [];
    if (!step || (!branch && isLastActiveStep(activeItems, { kind: 'step', key: `step:${scene.id}:${step.id}`, sceneIndex: position.sceneIndex, stepIndex }))) {
        fields.push({ source: { field: 'takeaway' }, text: scene.takeaway });
    }

    const unitId = `${scene.id}:${step?.id || 'scene'}`;
    const segmentLimit = options.segmentLimit ?? DEFAULT_NARRATION_SEGMENT_LIMIT;
    const segments = fields.flatMap((field) => buildFieldSegments(unitId, field, segmentLimit));
    return {
        id: unitId,
        position: normalizedPosition,
        segments
    };
}

/** One narration unit per reading item, so structural passages are never repeated as steps. */
export function buildReadingNarrationUnit(
    tour: ChangeTourManifest,
    item: TourReadingItem,
    options: BuildNarrationUnitOptions,
    activeItems?: readonly TourReadingItem[]
): NarrationUnit {
    const fields: NarrationFieldValue[] = [];
    const add = (field: NarrationField, text: string | undefined, itemIndex?: number) => {
        if (text) fields.push({ source: { field, ...(itemIndex === undefined ? {} : { itemIndex }) }, text });
    };
    const addScenes = (scenes: ReturnType<typeof buildTourRoute>['scenes']) => {
        scenes.forEach(scene => {
            add('route-title', scene.title, scene.sceneIndex);
        });
    };
    if (item.kind === 'title' || item.kind === 'conclusion') {
        const passage = item.kind === 'title' ? tour.opening : tour.conclusion;
        if (item.kind === 'title') add('document-title', tour.title);
        add('passage-title', passage?.title);
        add('summary', passage?.summary);
        passage?.bullets?.forEach((text, index) => add('bullet', text, index));
        if (item.kind === 'title') {
            const route = buildTourRoute(tour);
            route.chapters.forEach(chapter => {
                add('route-chapter', chapter.title, chapter.chapterIndex);
            });
            if (!route.chapters.length) addScenes(route.scenes);
        }
    } else if (item.kind === 'chapter') {
        const chapter = buildTourRoute(tour).chapters.find(chapter => chapter.chapterId === item.chapterId)!;
        add('chapter', chapter.title);
        add('summary', chapter.summary);
    } else {
        const scene = tour.scenes[item.sceneIndex];
        if (item.kind === 'scene') {
            add('scene-title', tourReadingTitle(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex: item.sceneIndex, stepIndex: 0 }));
            add('summary', scene.summary);
            scene.bullets.forEach((text, index) => add('bullet', text, index));
            if (!isSteppedScene(scene)) add('takeaway', scene.takeaway);
            if ('overview' in scene) add('overview-purpose', scene.overview?.purpose);
        } else if (isSteppedScene(scene)) {
            const step = scene.steps[item.stepIndex];
            if (options.entry === 'playback-start') add('scene-title', tourReadingTitle(tour, { kind: 'scene', key: `scene:${scene.id}`, sceneIndex: item.sceneIndex, stepIndex: 0 }));
            if (options.entry === 'playback-start' && scene.kind === 'deconstructed-diff' && !step.body) {
                add('stage-title', scene.panels[scene.steps[item.stepIndex].pairIndex + 1].label);
            }
            add('step-title', tourReadingTitle(tour, item));
            add('step-body', step.body);
            add('step-orientation', describeStepOrientation(tour, item.sceneIndex, item.stepIndex,
                options.entry === 'playback-start' ? TourOrientationDetail.Full : TourOrientationDetail.Changes));
            if ('connection' in step) add('connection', step.connection?.label);
            const branch = getTourStepBranch(step);
            const routeItems = getActiveItems(tour, item.sceneIndex, branch, activeItems ?? options.activeItems);
            if (!branch && isLastActiveStep(routeItems, item)) add('takeaway', scene.takeaway);
        }
    }
    return {
        id: item.key,
        readingKey: item.key,
        orientationDetail: options.entry === 'playback-start' ? TourOrientationDetail.Full : TourOrientationDetail.Changes,
        segments: fields.flatMap(field => buildFieldSegments(item.key, field, options.segmentLimit ?? DEFAULT_NARRATION_SEGMENT_LIMIT))
    };
}

function getActiveItems(
    tour: ChangeTourManifest,
    sceneIndex: number,
    branch: ReturnType<typeof getTourStepBranch>,
    suppliedItems?: readonly TourReadingItem[]
): readonly TourReadingItem[] {
    if (suppliedItems) return suppliedItems;
    const location: TourBranchLocation | null = branch ? { sceneIndex, branchId: branch.id } : null;
    return buildTourReadingItems(tour, location);
}

function isLastActiveStep(items: readonly TourReadingItem[], item: TourReadingItem): boolean {
    const sceneSteps = items.filter(candidate => candidate.kind === 'step' && candidate.sceneIndex === item.sceneIndex);
    const currentIndex = sceneSteps.findIndex(candidate => candidate.key === item.key);
    return currentIndex >= 0 && currentIndex === sceneSteps.length - 1;
}

export function splitNarrationText(text: string, maxLength = DEFAULT_NARRATION_SEGMENT_LIMIT): TextRange[] {
    if (!Number.isInteger(maxLength) || maxLength < 40) {
        throw new Error('Narration segment limit must be an integer of at least 40 characters.');
    }
    const sentenceRanges = findSentenceRanges(text);
    return sentenceRanges.flatMap((range) => splitLongRange(text, range.startOffset, range.endOffset, maxLength));
}

export function normalizeNarrationSpeech(text: string): string {
    return maskNarrationLinks(text)
        .replace(/https?:\/\/\S+/giu, ' ')
        .replace(/\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)[0-9a-f]+\b/giu, ' ')
        .replace(/[`*_~]/gu, '')
        .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
        .replace(/([\p{Lu}])(\p{Lu}\p{Ll})/gu, '$1 $2')
        .replace(/\s+/gu, ' ')
        .replace(/\s+([,.;:!?])/gu, '$1')
        .trim();
}

/** Keep label offsets intact while hiding inline-link syntax and destinations from speech. */
function maskNarrationLinks(text: string): string {
    const pattern = /\[([^\]\n]+)\]\(((?:https?:\/\/|bygone:\/\/)(?:[^\s()]|\([^\s()]*\))+)\)/gu;
    return text.replace(pattern, (match: string, label: string, _url: string, offset: number) => {
        if (offset > 0 && text[offset - 1] === '!') return match;
        return ` ${label}${' '.repeat(match.length - label.length - 1)}`;
    });
}

function buildFieldSegments(unitId: string, field: NarrationFieldValue, maxLength: number): NarrationSegment[] {
    const sourceKey = field.source.itemIndex === undefined
        ? field.source.field
        : `${field.source.field}-${field.source.itemIndex}`;
    // Mask the entire field before slicing: a long URL can cross several segment boundaries.
    const speechText = maskNarrationLinks(field.text);
    return splitNarrationText(field.text, maxLength)
        .map((segment, segmentIndex) => ({
            id: `${unitId}:${sourceKey}:${segmentIndex}`,
            text: segment.text,
            speechText: normalizeNarrationSpeech(speechText.slice(segment.startOffset, segment.endOffset)),
            source: field.source,
            startOffset: segment.startOffset,
            endOffset: segment.endOffset
        }))
        .filter((segment) => segment.speechText.length > 0);
}

function findSentenceRanges(text: string): TextRange[] {
    const ranges: TextRange[] = [];
    let startOffset = 0;
    for (let index = 0; index < text.length; index += 1) {
        if (!'.!?'.includes(text[index])) continue;
        let endOffset = index + 1;
        while (endOffset < text.length && `\"'”’)]}`.includes(text[endOffset])) endOffset += 1;
        if (endOffset < text.length && !/\s/u.test(text[endOffset])) continue;
        pushTrimmedRange(text, ranges, startOffset, endOffset);
        startOffset = endOffset;
    }
    pushTrimmedRange(text, ranges, startOffset, text.length);
    return ranges;
}

function splitLongRange(
    text: string,
    startOffset: number,
    endOffset: number,
    maxLength: number
): TextRange[] {
    const ranges: TextRange[] = [];
    let cursor = startOffset;
    while (endOffset - cursor > maxLength) {
        const searchEnd = cursor + maxLength;
        const minimumBreak = cursor + Math.floor(maxLength * 0.55);
        let breakOffset = findBreakOffset(text, minimumBreak, searchEnd, /[;,:—–-]/u);
        if (breakOffset <= cursor) breakOffset = findBreakOffset(text, minimumBreak, searchEnd, /\s/u);
        if (breakOffset <= cursor) breakOffset = searchEnd;
        pushTrimmedRange(text, ranges, cursor, breakOffset);
        cursor = breakOffset;
    }
    pushTrimmedRange(text, ranges, cursor, endOffset);
    return ranges;
}

function findBreakOffset(text: string, minimum: number, maximum: number, pattern: RegExp): number {
    for (let index = maximum; index >= minimum; index -= 1) {
        if (pattern.test(text[index])) return index + 1;
    }
    return -1;
}

function pushTrimmedRange(
    text: string,
    ranges: TextRange[],
    rawStart: number,
    rawEnd: number
): void {
    let startOffset = rawStart;
    let endOffset = rawEnd;
    while (startOffset < endOffset && /\s/u.test(text[startOffset])) startOffset += 1;
    while (endOffset > startOffset && /\s/u.test(text[endOffset - 1])) endOffset -= 1;
    if (startOffset < endOffset) {
        ranges.push({
            text: text.slice(startOffset, endOffset),
            startOffset,
            endOffset
        });
    }
}

function isSteppedScene(scene: ChangeTourScene): scene is Extract<ChangeTourScene, { kind: 'walkthrough' | 'stacked-diff' | 'deconstructed-diff' }> {
    return scene.kind === 'walkthrough' || scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
}
