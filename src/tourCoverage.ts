import { buildChangeInventory, ChangeInventoryFile, ChangeUnit } from './changeInventory';
import { buildChangeTourManifest } from './changeTour';
import { ChangeTourSource, parseChangeTourSource } from './changeTourSource';

export const TOUR_COVERAGE_REPORT_VERSION = 1 as const;
export type TourCoverageDepth = 'mentioned' | 'explained' | 'contextualized';

export interface TourCoverageFileResult {
    path: string;
    originalUnits: number;
    includedUnits: number;
    coveredUnits: number;
    coveragePercent: number;
    uncoveredHunks: string[];
}

export interface TourCoverageReport {
    version: typeof TOUR_COVERAGE_REPORT_VERSION;
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

    for (const scene of manifest.scenes) {
        if (scene.kind !== 'walkthrough') continue;
        for (const step of scene.steps) {
            const matches = includedUnits.filter((unit) => evidenceIntersectsUnit(step.focus, unit));
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
        .map((file) => buildFileResult(file, excludedIds, coverage));
    const includedChangedLines = includedUnits.reduce((total, unit) => total + unit.additions + unit.deletions, 0);
    const coveredChangedLines = [...coverage.values()]
        .reduce((total, entry) => total + entry.unit.additions + entry.unit.deletions, 0);
    return {
        version: TOUR_COVERAGE_REPORT_VERSION,
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
            coveragePercent: percentage(coverage.size, includedUnits.length),
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
        contextualOnlyEvidence
    };
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
    coverage: Map<string, CoveredUnit>
): TourCoverageFileResult {
    const included = file.units.filter((unit) => !excludedIds.has(unit.id));
    const covered = included.filter((unit) => coverage.has(unit.id));
    return {
        path: file.path,
        originalUnits: file.units.length,
        includedUnits: included.length,
        coveredUnits: covered.length,
        coveragePercent: percentage(covered.length, included.length),
        uncoveredHunks: included.filter((unit) => !coverage.has(unit.id)).map((unit) => unit.id)
    };
}

function percentage(numerator: number, denominator: number): number {
    return denominator === 0 ? 100 : Math.round((numerator / denominator) * 100);
}
