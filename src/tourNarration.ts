import type { ChangeTourManifest, ChangeTourScene } from './changeTourManifest';
import type { TourPosition } from './tourNavigation';

export const DEFAULT_NARRATION_SEGMENT_LIMIT = 240;

export type NarrationField =
    | 'chapter'
    | 'scene-title'
    | 'summary'
    | 'bullet'
    | 'step-title'
    | 'step-body'
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
    position: TourPosition;
    segments: NarrationSegment[];
}

export interface BuildNarrationUnitOptions {
    entry: 'playback-start' | 'continuous';
    segmentLimit?: number;
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
    if (!step || (isSteppedScene(scene) && stepIndex === scene.steps.length - 1)) {
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

export function splitNarrationText(text: string, maxLength = DEFAULT_NARRATION_SEGMENT_LIMIT): TextRange[] {
    if (!Number.isInteger(maxLength) || maxLength < 40) {
        throw new Error('Narration segment limit must be an integer of at least 40 characters.');
    }
    const sentenceRanges = findSentenceRanges(text);
    return sentenceRanges.flatMap((range) => splitLongRange(text, range.startOffset, range.endOffset, maxLength));
}

export function normalizeNarrationSpeech(text: string): string {
    return text
        .replace(/https?:\/\/\S+/giu, ' ')
        .replace(/\b(?=[0-9a-f]{7,40}\b)(?=[0-9a-f]*\d)[0-9a-f]+\b/giu, ' ')
        .replace(/[`*_~]/gu, '')
        .replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1 $2')
        .replace(/([\p{Lu}])(\p{Lu}\p{Ll})/gu, '$1 $2')
        .replace(/\s+/gu, ' ')
        .trim();
}

function buildFieldSegments(unitId: string, field: NarrationFieldValue, maxLength: number): NarrationSegment[] {
    const sourceKey = field.source.itemIndex === undefined
        ? field.source.field
        : `${field.source.field}-${field.source.itemIndex}`;
    return splitNarrationText(field.text, maxLength)
        .map((segment, segmentIndex) => ({
            id: `${unitId}:${sourceKey}:${segmentIndex}`,
            text: segment.text,
            speechText: normalizeNarrationSpeech(segment.text),
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
