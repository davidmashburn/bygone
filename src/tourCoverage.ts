import { buildChangeInventory, ChangeInventoryFile, ChangeUnit } from './changeInventory';
import { buildChangeTourManifest } from './changeTour';
import { ChangeTourSource, ChangeTourSourceDeconstructedScene, parseChangeTourSource } from './changeTourSource';
import {
    ChangeTourAuthoringCoverage,
    ChangeTourManifest,
    ChangeTourScene
} from './changeTourManifest';
import { resolveBranchReviewRange } from './gitComparison';
import {
    StrictTourCoverageMode,
    StrictTourCoverageStatus,
    validateStrictTourCoverageMap
} from './tourCompleteCoverage';
import type { StrictTourCoverage, StrictTourCoverageHunk, StrictTourCoverageMap } from './tourCompleteCoverage';
import { TourCoverage } from './tourOptions';

export {
    StrictTourCoverageMode,
    StrictTourCoverageStatus,
    validateStrictTourCoverageMap
};
export type { StrictTourCoverage, StrictTourCoverageHunk, StrictTourCoverageMap } from './tourCompleteCoverage';

export const TOUR_COVERAGE_REPORT_VERSION = 2 as const;
export type TourCoverageDepth = 'mentioned' | 'explained' | 'contextualized';

export interface TourCoverageFileResult {
    path: string;
    originalUnits: number;
    includedUnits: number;
    coveredUnits: number;
    coveragePercent: number;
    uncoveredHunks: string[];
}

interface TourCoverageReportBase {
    range: { baseRef: string; headRef: string; baseOid: string; headOid: string };
    totals: {
        originalUnits: number;
        excludedUnits: number;
        includedUnits: number;
        coveredUnits: number;
        uncoveredUnits: number;
        coveragePercent: number;
        coveredChangedLines: number;
        includedChangedLines: number;
    };
    depth: Record<TourCoverageDepth, number>;
    files: TourCoverageFileResult[];
    exclusions: Array<{ path: string; hunks: string[]; reason: string }>;
    unsupported: Array<{ path: string; material: string }>;
    contextualOnlyEvidence: Array<{ sceneId: string; stepId: string; path: string }>;
    complete?: StrictTourCoverageMap;
}

export interface TourCoverageReportV1 extends TourCoverageReportBase {
    version: 1;
}

export interface TourCoverageReportV2 extends TourCoverageReportBase {
    version: typeof TOUR_COVERAGE_REPORT_VERSION;
    walkthroughScope: 'final';
    explanationAssignments: Array<{
        sceneId: string;
        assignedUnits: number;
        excludedUnits: number;
        completeUnits: number;
        totalUnits: number;
        assignmentPercent: number;
    }>;
}

export type TourCoverageReport = TourCoverageReportV1 | TourCoverageReportV2;

export function buildTourAuthoringCoverage(report: TourCoverageReport): ChangeTourAuthoringCoverage {
    return {
        ...(report.complete === undefined ? {} : { complete: report.complete }),
        walkthrough: {
            scope: report.version === 2 ? 'final' : 'tour',
            coveredUnits: report.totals.coveredUnits,
            includedUnits: report.totals.includedUnits,
            coveragePercent: report.totals.coveragePercent
        },
        explanationAssignments: report.version === 2 ? report.explanationAssignments : []
    };
}

interface CoveredUnit {
    unit: ChangeUnit;
    depths: TourCoverageDepth[];
}

const DEPTH_ORDER: Record<TourCoverageDepth, number> = {
    mentioned: 0,
    explained: 1,
    contextualized: 2
};

export function buildTourCoverageReport(startPath: string, sourceValue: unknown): TourCoverageReport {
    const source = parseChangeTourSource(sourceValue);
    const inventory = buildChangeInventory(startPath, {
        headRef: source.range?.head,
        baseRef: source.range?.base
    });
    const manifest = buildChangeTourManifest(startPath, {
        headRef: source.range?.head,
        baseRef: source.range?.base,
        source
    });
    const textualUnits = inventory.files.flatMap((file) => file.units);
    const excludedIds = resolveExclusions(source, inventory.files);
    const includedUnits = textualUnits.filter((unit) => !excludedIds.has(unit.id));
    const coverage = new Map<string, CoveredUnit>();
    const contextualOnlyEvidence: TourCoverageReport['contextualOnlyEvidence'] = [];
    const percentageDecimalPlaces = manifest.version >= 2 ? 2 : 0;

    // An independently authored Historical tour is the preferred walkthrough
    // evidence.  Deconstructed-only tours may intentionally omit endpoint
    // steps, so retain the legacy Final/root fallback when Historical has no
    // walkthrough scenes to count.
    const authoredHistoricalScenes = manifest.tours?.historical?.scenes;
    const historicalHasWalkthrough = authoredHistoricalScenes?.some((scene) => scene.kind === 'walkthrough') === true;
    const walkthroughScenes = manifest.version >= 2
        ? requireFinalScenes(historicalHasWalkthrough ? authoredHistoricalScenes : manifest.zoom?.final.scenes)
        : historicalHasWalkthrough ? authoredHistoricalScenes : manifest.scenes;
    for (const scene of walkthroughScenes) {
        if (scene.kind !== 'walkthrough') continue;
        for (const step of scene.steps) {
            const endpoints = step.symbol ? ([[step.symbol.before, 'base'], [step.symbol.after, 'head']] as const).flatMap(([entry, revision]) => {
                if (!entry) return [];
                return [{ path: entry.path, revision, startLine: entry.startLine, endLine: entry.endLine }];
            }) : [step.focus];
            const matches = includedUnits.filter((unit) => endpoints.some(endpoint => evidenceIntersectsUnit(endpoint, unit)));
            if (matches.length === 0) {
                contextualOnlyEvidence.push({ sceneId: scene.id, stepId: step.id, path: step.focus.path });
                continue;
            }
            const depth = step.depth || 'mentioned';
            for (const unit of matches) {
                const entry = coverage.get(unit.id) || { unit, depths: [] };
                entry.depths.push(depth);
                coverage.set(unit.id, entry);
            }
        }
    }

    const depth: Record<TourCoverageDepth, number> = { mentioned: 0, explained: 0, contextualized: 0 };
    for (const covered of coverage.values()) {
        const highest = covered.depths.reduce((left, right) => DEPTH_ORDER[right] > DEPTH_ORDER[left] ? right : left);
        depth[highest] += 1;
    }
    const files = inventory.files
        .filter((file) => file.material === 'text')
        .map((file) => buildFileResult(file, excludedIds, coverage, percentageDecimalPlaces));
    const includedChangedLines = includedUnits.reduce((total, unit) => total + unit.additions + unit.deletions, 0);
    const coveredChangedLines = [...coverage.values()]
        .reduce((total, entry) => total + entry.unit.additions + entry.unit.deletions, 0);
    const complete = buildCompleteTourCoverage(startPath, source, inventory, manifest, excludedIds);
    const report: TourCoverageReportBase = {
        range: {
            baseRef: inventory.range.baseRef,
            headRef: inventory.range.headRef,
            baseOid: inventory.range.baseOid,
            headOid: inventory.range.headOid
        },
        totals: {
            originalUnits: textualUnits.length,
            excludedUnits: excludedIds.size,
            includedUnits: includedUnits.length,
            coveredUnits: coverage.size,
            uncoveredUnits: includedUnits.length - coverage.size,
            coveragePercent: percentage(coverage.size, includedUnits.length, percentageDecimalPlaces),
            coveredChangedLines,
            includedChangedLines
        },
        depth,
        files,
        exclusions: (source.coverage?.exclusions || []).map((exclusion) => ({
            path: exclusion.path,
            hunks: exclusion.hunks || inventory.files.find((file) => file.path === exclusion.path)?.units.map((unit) => unit.id) || [],
            reason: exclusion.reason
        })),
        unsupported: inventory.files
            .filter((file) => file.material !== 'text')
            .map((file) => ({ path: file.path, material: file.material })),
        contextualOnlyEvidence,
        ...(complete === undefined ? {} : { complete })
    };
    if (manifest.version === 1) return { version: 1, ...report };
    return {
        version: TOUR_COVERAGE_REPORT_VERSION,
        ...report,
        walkthroughScope: 'final',
        explanationAssignments: buildExplanationAssignments(source, inventory.files)
    };
}

function requireFinalScenes(scenes: ChangeTourScene[] | undefined): ChangeTourScene[] {
    if (!scenes) throw new Error('A v2 tour requires Final-mode scenes for coverage reporting.');
    return scenes;
}

/**
 * Build the opt-in strict COMPLETE report.  This is intentionally separate
 * from the historical intersection-based report above: callers can adopt the
 * result without changing the meaning of the existing coverage fields.
 */
export function buildCompleteTourCoverage(
    startPath: string,
    source: ChangeTourSource,
    inventory: ReturnType<typeof buildChangeInventory>,
    manifest: ChangeTourManifest,
    excludedIds: ReadonlySet<string> = resolveExclusions(source, inventory.files)
): StrictTourCoverageMap | undefined {
    const hasIndependentModes = source.tours?.historical !== undefined || source.tours?.deconstructed !== undefined;
    const modes: StrictTourCoverageMode[] = hasIndependentModes
        ? [StrictTourCoverageMode.Historical, StrictTourCoverageMode.Deconstructed]
            .filter((mode) => mode === StrictTourCoverageMode.Historical
                ? source.tours?.historical !== undefined
                : source.tours?.deconstructed !== undefined)
        : [StrictTourCoverageMode.Tour];
    const completeModes = modes.filter((mode) => effectiveOptions(source, mode)?.coverage === TourCoverage.Complete);
    if (completeModes.length === 0) return undefined;

    const result: StrictTourCoverageMap = {};
    for (const mode of completeModes) {
        result[mode] = buildStrictTourCoverage(startPath, source, inventory, manifest, mode, excludedIds);
    }
    return result;
}

function effectiveOptions(source: ChangeTourSource, mode: StrictTourCoverageMode): ChangeTourSource['options'] {
    if (mode === StrictTourCoverageMode.Tour) return source.options;
    return source.tours?.[mode]?.options ?? source.options;
}

interface StrictScopeSelection {
    requestedPaths: string[];
    resolvedPaths: string[];
    files: ChangeInventoryFile[];
    limitations: string[];
}

interface StrictEvidenceInterval {
    path: string;
    revision: 'base' | 'head';
    startLine: number;
    endLine: number;
}

function buildStrictTourCoverage(
    startPath: string,
    source: ChangeTourSource,
    inventory: ReturnType<typeof buildChangeInventory>,
    manifest: ChangeTourManifest,
    mode: StrictTourCoverageMode,
    excludedIds: ReadonlySet<string>
): StrictTourCoverage {
    const options = effectiveOptions(source, mode);
    const scope = selectStrictScope(inventory.files, options?.paths);
    const limitations = [...scope.limitations];
    const selectedFiles = scope.files;
    const selectedTextualUnits = selectedFiles
        .filter((file) => file.material === 'text')
        .flatMap((file) => file.units);
    const selectedExcludedUnits = selectedTextualUnits.filter((unit) => excludedIds.has(unit.id));
    const includedUnits = selectedTextualUnits.filter((unit) => !excludedIds.has(unit.id));

    const strictExclusions = buildStrictExclusions(source, inventory.files, limitations);
    const accounted = buildStrictAccountedFiles(source, inventory.files, selectedFiles);
    limitations.push(...accounted.limitations);

    const requiredAccountedPaths = selectedFiles
        .filter((file) => file.material !== 'text' || file.units.length === 0)
        .filter((file) => !accounted.matchedFiles.has(file))
        .map((file) => file.path)
        .sort();

    const evidenceScenes = buildStrictEvidenceScenes(startPath, source, manifest, mode, limitations);
    const evidence = collectStrictEvidence(evidenceScenes, limitations);
    const coveredHunkIds = new Set<string>();
    const uncoveredHunks: StrictTourCoverageHunk[] = [];
    for (const unit of includedUnits) {
        const missingSides = missingHunkSides(unit, evidence.intervalsByRevision);
        if (missingSides.length === 0) {
            coveredHunkIds.add(unit.id);
        } else {
            uncoveredHunks.push({
                id: unit.id,
                path: unit.path,
                ...(unit.previousPath === undefined ? {} : { previousPath: unit.previousPath }),
                missingSides
            });
        }
    }

    const range = buildStrictRange(startPath, source, inventory, limitations);
    const exclusionsBlockComplete = strictExclusions.length > 0;
    const hasBlockingIssue = limitations.length > 0
        || requiredAccountedPaths.length > 0
        || uncoveredHunks.length > 0
        || exclusionsBlockComplete;
    const status = selectedTextualUnits.length === 0
        ? hasBlockingIssue ? StrictTourCoverageStatus.Incomplete : StrictTourCoverageStatus.NoTextualChanges
        : hasBlockingIssue ? StrictTourCoverageStatus.Incomplete : StrictTourCoverageStatus.Complete;

    return {
        mode,
        scope: {
            requestedPaths: scope.requestedPaths,
            resolvedPaths: scope.resolvedPaths,
            counted: 'main-path',
            optionalDetail: 'not-counted'
        },
        range,
        inventory: {
            changedEntries: inventory.files.length,
            selectedEntries: selectedFiles.length,
            textualEntries: selectedFiles.filter((file) => file.material === 'text').length,
            totalHunks: selectedTextualUnits.length,
            excludedHunks: selectedExcludedUnits.length
        },
        totalHunks: selectedTextualUnits.length,
        includedHunks: includedUnits.length,
        coveredHunks: coveredHunkIds.size,
        uncoveredHunks,
        accountedFiles: accounted.records,
        outstandingPaths: requiredAccountedPaths,
        exclusions: strictExclusions,
        limitations: [...new Set(limitations)],
        status
    };
}

function buildStrictRange(
    startPath: string,
    source: ChangeTourSource,
    inventory: ReturnType<typeof buildChangeInventory>,
    limitations: string[]
): StrictTourCoverage['range'] {
    const result: StrictTourCoverage['range'] = {
        baseRef: inventory.range.baseRef,
        headRef: inventory.range.headRef,
        baseOid: inventory.range.baseOid,
        headOid: inventory.range.headOid,
        pinned: true
    };
    try {
        const resolved = resolveBranchReviewRange(startPath, source.range?.head, source.range?.base);
        if (resolved.headOid !== inventory.range.headOid) {
            limitations.push(
                `The strict report head ${resolved.headOid} does not match the inventory head ${inventory.range.headOid}.`
            );
        }
        if (source.range?.base !== undefined) {
            result.requestedBaseOid = resolved.baseOid;
            result.mergeBaseMatchesRequestedBase = resolved.baseOid === inventory.range.baseOid;
            if (resolved.baseOid !== inventory.range.baseOid) {
                limitations.push(
                    `The explicit base ${source.range.base} resolves to ${resolved.baseOid}, but the inventory is pinned to merge-base ${inventory.range.baseOid}.`
                );
            }
        }
    } catch (error) {
        limitations.push(`Could not verify the pinned source range: ${errorMessage(error)}`);
    }
    return result;
}

function selectStrictScope(files: ChangeInventoryFile[], paths: string[] | undefined): StrictScopeSelection {
    const limitations: string[] = [];
    const rawPaths = paths === undefined ? [] : paths;
    if (!Array.isArray(rawPaths)) {
        return {
            requestedPaths: [],
            resolvedPaths: [],
            files: [],
            limitations: ['Complete coverage paths must be an array of repository-relative paths.']
        };
    }
    const normalizedPaths: string[] = [];
    for (const rawPath of rawPaths) {
        const normalized = normalizeRepoRelativePath(rawPath);
        if (!normalized) {
            limitations.push(`Complete coverage path is not a safe repository-relative path: ${String(rawPath)}.`);
            continue;
        }
        normalizedPaths.push(normalized);
        if (!files.some((file) => fileNames(file).some((name) => pathWithinScope(name, normalized)))) {
            limitations.push(`Complete coverage path does not match a changed file: ${normalized}.`);
        }
    }
    const uniquePaths = [...new Set(normalizedPaths)];
    const selected = uniquePaths.length === 0 && rawPaths.length === 0
        ? files
        : files.filter((file) => uniquePaths.some((path) => fileNames(file).some((name) => pathWithinScope(name, path))));
    return {
        requestedPaths: [...rawPaths],
        resolvedPaths: [...new Set(selected.flatMap(fileNames))].sort(),
        files: selected,
        limitations
    };
}

function buildStrictEvidenceScenes(
    startPath: string,
    source: ChangeTourSource,
    manifest: ChangeTourManifest,
    mode: StrictTourCoverageMode,
    limitations: string[]
): readonly ChangeTourScene[] {
    if (mode === StrictTourCoverageMode.Tour) {
        return manifest.zoom?.final.scenes || manifest.scenes;
    }
    const authoredMode = source.tours?.[mode];
    const modeScenes = manifest.tours?.[mode]?.scenes;
    if (!authoredMode || !modeScenes) {
        limitations.push(`The manifest has no independently authored ${mode} tour evidence.`);
        return [];
    }
    const hasEndpointSteps = authoredMode.chapters.some((chapter) => chapter.scenes.some((scene) => (
        scene.kind === 'deconstructed-diff' && Array.isArray(scene.steps) && scene.steps.length > 0
    )));
    if (!hasEndpointSteps) return modeScenes;
    try {
        const isolated = buildIsolatedModeManifest(startPath, source, mode, manifest.range);
        return isolated.zoom?.final.scenes || isolated.scenes;
    } catch (error) {
        limitations.push(`Could not compile ${mode} endpoint evidence independently: ${errorMessage(error)}`);
        return modeScenes;
    }
}

function buildIsolatedModeManifest(
    startPath: string,
    source: ChangeTourSource,
    mode: StrictTourCoverageMode.Historical | StrictTourCoverageMode.Deconstructed,
    manifestRange: ChangeTourManifest['range']
): ChangeTourManifest {
    const authoredMode = source.tours?.[mode];
    if (!authoredMode) throw new Error(`No authored ${mode} tour is available.`);
    const baseRef = source.range?.base ?? manifestRange.mergeBaseOid;
    const headRef = source.range?.head ?? manifestRange.headOid;
    const fallbackStack = [
        { id: 'complete-base', ref: baseRef },
        { id: 'complete-head', ref: headRef }
    ];
    const chapters = authoredMode.chapters.map((chapter) => ({
        ...chapter,
        scenes: chapter.scenes.map((scene) => (
            scene.kind === 'deconstructed-diff' && scene.stack === undefined
                ? { ...scene, stack: fallbackStack }
                : scene
        ))
    }));
    const isolatedSource: ChangeTourSource = {
        ...source,
        chapters,
        tours: undefined,
        ...(source.range ? {} : { range: { base: manifestRange.mergeBaseOid, head: manifestRange.headOid } })
    };
    return buildChangeTourManifest(startPath, {
        headRef,
        baseRef,
        source: isolatedSource
    });
}

interface CollectedStrictEvidence {
    intervalsByRevision: {
        base: StrictEvidenceInterval[];
        head: StrictEvidenceInterval[];
    };
}

function collectStrictEvidence(
    scenes: readonly ChangeTourScene[],
    limitations: string[]
): CollectedStrictEvidence {
    const intervalsByRevision: CollectedStrictEvidence['intervalsByRevision'] = { base: [], head: [] };
    for (const scene of scenes) {
        if (scene.kind !== 'walkthrough') continue;
        for (const step of scene.steps) {
            if (step.branch) continue;
            if (typeof step.body !== 'string' || step.body.trim().length === 0) continue;
            addStrictEvidenceInterval(intervalsByRevision, step.focus, limitations);
            if (step.symbol?.before) {
                addStrictEvidenceInterval(intervalsByRevision, {
                    path: step.symbol.before.path,
                    revision: 'base',
                    startLine: step.symbol.before.startLine,
                    endLine: step.symbol.before.endLine
                }, limitations);
            }
            if (step.symbol?.after) {
                addStrictEvidenceInterval(intervalsByRevision, {
                    path: step.symbol.after.path,
                    revision: 'head',
                    startLine: step.symbol.after.startLine,
                    endLine: step.symbol.after.endLine
                }, limitations);
            }
        }
    }
    return { intervalsByRevision };
}

function addStrictEvidenceInterval(
    intervalsByRevision: CollectedStrictEvidence['intervalsByRevision'],
    focus: { path: string; revision: 'base' | 'head'; startLine: number; endLine: number },
    limitations: string[]
): void {
    if (!Number.isSafeInteger(focus.startLine) || !Number.isSafeInteger(focus.endLine)
        || focus.startLine < 1 || focus.endLine < focus.startLine || typeof focus.path !== 'string' || focus.path.length === 0) {
        limitations.push('A narrated walkthrough focus did not contain a valid positive line interval.');
        return;
    }
    intervalsByRevision[focus.revision].push({ ...focus });
}

function missingHunkSides(
    unit: ChangeUnit,
    intervalsByRevision: CollectedStrictEvidence['intervalsByRevision']
): Array<'base' | 'head'> {
    const missing: Array<'base' | 'head'> = [];
    if (unit.baseCount > 0 && !intervalCovers(
        intervalsByRevision.base.filter((interval) => interval.revision === 'base' && intervalMatchesPath(interval.path, unit, 'base')),
        unit.baseStart,
        unit.baseStart + unit.baseCount - 1
    )) missing.push('base');
    if (unit.headCount > 0 && !intervalCovers(
        intervalsByRevision.head.filter((interval) => interval.revision === 'head' && intervalMatchesPath(interval.path, unit, 'head')),
        unit.headStart,
        unit.headStart + unit.headCount - 1
    )) missing.push('head');
    return missing;
}

function intervalMatchesPath(path: string, unit: ChangeUnit, revision: 'base' | 'head'): boolean {
    const expected = revision === 'base' ? (unit.previousPath || unit.path) : unit.path;
    return path === expected;
}

function intervalCovers(intervals: StrictEvidenceInterval[], start: number, end: number): boolean {
    let coveredThrough = start - 1;
    for (const interval of [...intervals].sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine)) {
        if (interval.endLine < coveredThrough + 1) continue;
        if (interval.startLine > coveredThrough + 1) return false;
        coveredThrough = Math.max(coveredThrough, interval.endLine);
        if (coveredThrough >= end) return true;
    }
    return coveredThrough >= end;
}

interface StrictAccountedFiles {
    records: Array<{ path: string; reason: string }>;
    matchedFiles: Set<ChangeInventoryFile>;
    limitations: string[];
}

function buildStrictAccountedFiles(
    source: ChangeTourSource,
    files: ChangeInventoryFile[],
    selectedFiles: ChangeInventoryFile[]
): StrictAccountedFiles {
    const records: Array<{ path: string; reason: string }> = [];
    const matchedFiles = new Set<ChangeInventoryFile>();
    const limitations: string[] = [];
    const seenFiles = new Set<ChangeInventoryFile>();
    for (const accounted of source.coverage?.accountedFiles || []) {
        const normalizedPath = normalizeRepoRelativePath(accounted.path);
        if (!normalizedPath || typeof accounted.reason !== 'string' || accounted.reason.trim().length === 0) {
            limitations.push(`Complete coverage accounted file is missing a safe path or non-empty reason: ${String(accounted.path)}.`);
            continue;
        }
        const file = files.find((candidate) => fileNames(candidate).includes(normalizedPath));
        if (!file) throw new Error(`Complete coverage accounted file does not match a changed file: ${normalizedPath}`);
        if (seenFiles.has(file)) {
            limitations.push(`Complete coverage contains multiple accounted records for ${normalizedPath}.`);
            continue;
        }
        seenFiles.add(file);
        matchedFiles.add(file);
        if (selectedFiles.includes(file)) records.push({ path: normalizedPath, reason: accounted.reason.trim() });
    }
    return { records, matchedFiles, limitations };
}

function buildStrictExclusions(
    source: ChangeTourSource,
    files: ChangeInventoryFile[],
    limitations: string[]
): Array<{ path: string; hunks: string[]; reason: string }> {
    return (source.coverage?.exclusions || []).map((exclusion) => {
        if (exclusion.reason.trim().length === 0) {
            limitations.push(`Coverage exclusion for ${exclusion.path} has an empty reason.`);
        }
        const exclusionPath = exclusion.path.trim();
        const reason = exclusion.reason.trim();
        const file = files.find((candidate) => fileNames(candidate).includes(exclusionPath));
        if (!file) {
            limitations.push(`Coverage exclusion does not match a changed file: ${exclusionPath}.`);
        }
        const hunks = exclusion.hunks?.length ? exclusion.hunks : file?.units.map((unit) => unit.id) || [];
        return {
            path: exclusionPath,
            hunks: [...new Set(hunks)],
            reason: reason || 'Missing exclusion reason.'
        };
    });
}

function fileNames(file: Pick<ChangeInventoryFile, 'path' | 'previousPath'>): string[] {
    return [...new Set([file.path, file.previousPath].filter((path): path is string => typeof path === 'string'))];
}

function pathWithinScope(filePath: string, scopePath: string): boolean {
    return filePath === scopePath || filePath.startsWith(`${scopePath}/`);
}

function normalizeRepoRelativePath(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const path = value;
    if (!path || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return undefined;
    const parts = path.split('/');
    if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return undefined;
    return parts.join('/');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function buildExplanationAssignments(
    source: ChangeTourSource,
    files: ChangeInventoryFile[]
): TourCoverageReportV2['explanationAssignments'] {
    const materializableFiles = files.filter((file) => (
        file.material === 'text'
        && file.changeKind !== 'renamed'
        && file.baseContent !== undefined
        && file.headContent !== undefined
    ));
    const totalUnits = materializableFiles.reduce((total, file) => total + file.units.length, 0);
    const deconstructedChapters = source.tours?.deconstructed?.chapters || source.chapters;
    return deconstructedChapters
        .flatMap((chapter) => chapter.scenes)
        .filter((scene): scene is ChangeTourSourceDeconstructedScene => scene.kind === 'deconstructed-diff')
        .map((scene) => {
            const assignedUnits = scene.stages.reduce((stageTotal, stage) => (
                stageTotal + stage.changes.reduce((changeTotal, change) => changeTotal + change.hunks.length, 0)
            ), 0);
            const excludedUnits = totalUnits - assignedUnits;
            const completeUnits = assignedUnits + excludedUnits;
            return {
                sceneId: scene.id,
                assignedUnits,
                excludedUnits,
                completeUnits,
                totalUnits,
                assignmentPercent: percentage(completeUnits, totalUnits)
            };
        });
}

function resolveExclusions(source: ChangeTourSource, files: ChangeInventoryFile[]): Set<string> {
    const excluded = new Set<string>();
    for (const exclusion of source.coverage?.exclusions || []) {
        const file = files.find((candidate) => candidate.path === exclusion.path || candidate.previousPath === exclusion.path);
        if (!file) throw new Error(`Coverage exclusion does not match a changed file: ${exclusion.path}`);
        const selected = exclusion.hunks?.length
            ? file.units.filter((unit) => exclusion.hunks?.includes(unit.id))
            : file.units;
        if (exclusion.hunks?.length && selected.length !== exclusion.hunks.length) {
            throw new Error(`Coverage exclusion contains an unknown hunk for ${exclusion.path}.`);
        }
        selected.forEach((unit) => excluded.add(unit.id));
    }
    return excluded;
}

function evidenceIntersectsUnit(
    focus: { path: string; revision: 'base' | 'head'; startLine: number; endLine: number },
    unit: ChangeUnit
): boolean {
    if (focus.path !== unit.path && focus.path !== unit.previousPath) return false;
    const start = focus.revision === 'base' ? unit.baseStart : unit.headStart;
    const count = focus.revision === 'base' ? unit.baseCount : unit.headCount;
    if (count === 0) return false;
    const end = start + count - 1;
    return focus.startLine <= end && focus.endLine >= start;
}

function buildFileResult(
    file: ChangeInventoryFile,
    excludedIds: Set<string>,
    coverage: Map<string, CoveredUnit>,
    percentageDecimalPlaces: number
): TourCoverageFileResult {
    const included = file.units.filter((unit) => !excludedIds.has(unit.id));
    const covered = included.filter((unit) => coverage.has(unit.id));
    return {
        path: file.path,
        originalUnits: file.units.length,
        includedUnits: included.length,
        coveredUnits: covered.length,
        coveragePercent: percentage(covered.length, included.length, percentageDecimalPlaces),
        uncoveredHunks: included.filter((unit) => !coverage.has(unit.id)).map((unit) => unit.id)
    };
}

function percentage(numerator: number, denominator: number, decimalPlaces = 0): number {
    if (denominator === 0) return 100;
    const precision = 10 ** decimalPlaces;
    return Math.round((numerator / denominator) * 100 * precision) / precision;
}
