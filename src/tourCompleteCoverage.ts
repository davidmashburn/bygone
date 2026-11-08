/** Browser-safe contract for the strict main-path coverage diagnostic. */
export enum StrictTourCoverageMode {
    Tour = 'tour',
    Historical = 'historical',
    Deconstructed = 'deconstructed'
}

export enum StrictTourCoverageStatus {
    Complete = 'complete',
    Incomplete = 'incomplete',
    NoTextualChanges = 'no-textual-changes'
}

export interface StrictTourCoverageHunk {
    id: string;
    path: string;
    previousPath?: string;
    missingSides: Array<'base' | 'head'>;
}

export interface StrictTourCoverage {
    mode: StrictTourCoverageMode;
    scope: {
        /** Empty requestedPaths means that the complete comparison was selected. */
        requestedPaths: string[];
        resolvedPaths: string[];
        counted: 'main-path';
        optionalDetail: 'not-counted';
    };
    range: {
        baseRef: string;
        headRef: string;
        baseOid: string;
        headOid: string;
        pinned: true;
        requestedBaseOid?: string;
        mergeBaseMatchesRequestedBase?: boolean;
    };
    inventory: {
        changedEntries: number;
        selectedEntries: number;
        textualEntries: number;
        totalHunks: number;
        excludedHunks: number;
    };
    totalHunks: number;
    includedHunks: number;
    coveredHunks: number;
    uncoveredHunks: StrictTourCoverageHunk[];
    accountedFiles: Array<{ path: string; reason: string }>;
    outstandingPaths: string[];
    exclusions: Array<{ path: string; hunks: string[]; reason: string }>;
    limitations: string[];
    status: StrictTourCoverageStatus;
}

export type StrictTourCoverageMap = Partial<Record<StrictTourCoverageMode, StrictTourCoverage>>;

export function validateStrictTourCoverageMap(value: unknown): asserts value is StrictTourCoverageMap | undefined {
    if (value === undefined) return;
    if (!record(value) || !Object.keys(value).length) throw new Error('Strict coverage must contain a mode report.');
    for (const [mode, report] of Object.entries(value)) {
        const fail = () => { throw new Error(`Invalid strict coverage report for ${mode}.`); };
        if (!Object.values(StrictTourCoverageMode).includes(mode as StrictTourCoverageMode) || !record(report) || report.mode !== mode) fail();
        const r = report as Record<string, unknown>;
        if (!record(r.scope) || !strings(r.scope.requestedPaths) || !strings(r.scope.resolvedPaths)
            || r.scope.counted !== 'main-path' || r.scope.optionalDetail !== 'not-counted') fail();
        if (!record(r.range) || !oid(r.range.baseOid) || !oid(r.range.headOid) || r.range.pinned !== true
            || !nonempty(r.range.baseRef) || !nonempty(r.range.headRef)
            || (r.range.requestedBaseOid !== undefined && !oid(r.range.requestedBaseOid))
            || (r.range.mergeBaseMatchesRequestedBase !== undefined && typeof r.range.mergeBaseMatchesRequestedBase !== 'boolean')) fail();
        if (!record(r.inventory) || !['changedEntries', 'selectedEntries', 'textualEntries', 'totalHunks', 'excludedHunks'].every(key => count((r.inventory as Record<string, unknown>)[key]))) fail();
        if (!count(r.totalHunks) || !count(r.includedHunks) || !count(r.coveredHunks)
            || Number(r.coveredHunks) > Number(r.includedHunks) || Number(r.includedHunks) > Number(r.totalHunks)) fail();
        if (!Array.isArray(r.uncoveredHunks) || r.uncoveredHunks.length !== Number(r.includedHunks) - Number(r.coveredHunks)) fail();
        const hunks = r.uncoveredHunks as unknown[];
        const ids = new Set<string>();
        for (const hunk of hunks) {
            if (!record(hunk) || !nonempty(hunk.id) || !nonempty(hunk.path)
                || !Array.isArray(hunk.missingSides) || !hunk.missingSides.length
                || hunk.missingSides.some(side => side !== 'base' && side !== 'head')
                || new Set(hunk.missingSides).size !== hunk.missingSides.length
                || (hunk.previousPath !== undefined && !nonempty(hunk.previousPath))) fail();
            const id = (hunk as Record<string, unknown>).id as string;
            if (ids.has(id)) fail();
            ids.add(id);
        }
        if (!Array.isArray(r.accountedFiles) || !strings(r.outstandingPaths) || !strings(r.limitations) || !Array.isArray(r.exclusions)) fail();
        const paths = new Set<string>();
        for (const file of r.accountedFiles as unknown[]) {
            if (!record(file) || !nonempty(file.path) || !nonempty(file.reason)) fail();
            const path = (file as Record<string, unknown>).path as string;
            if (paths.has(path)) fail();
            paths.add(path);
        }
        for (const exclusion of r.exclusions as unknown[]) {
            if (!record(exclusion) || !nonempty(exclusion.path) || !nonempty(exclusion.reason) || !strings(exclusion.hunks)) fail();
        }
        const inventory = r.inventory as StrictTourCoverage['inventory'];
        if (inventory.totalHunks !== r.totalHunks || inventory.selectedEntries > inventory.changedEntries
            || inventory.textualEntries > inventory.selectedEntries || inventory.excludedHunks > Number(r.totalHunks)
            || Number(r.includedHunks) !== Number(r.totalHunks) - inventory.excludedHunks) fail();
        if (!Object.values(StrictTourCoverageStatus).includes(r.status as StrictTourCoverageStatus)) fail();
        if (r.status === StrictTourCoverageStatus.NoTextualChanges && (r.totalHunks !== 0
            || (r.outstandingPaths as string[]).length || (r.exclusions as unknown[]).length || (r.limitations as string[]).length)) fail();
        if (r.status === StrictTourCoverageStatus.Complete && (r.totalHunks === 0 || r.coveredHunks !== r.totalHunks
            || (r.outstandingPaths as string[]).length || (r.exclusions as unknown[]).length || (r.limitations as string[]).length
            || inventory.excludedHunks || (r.range as StrictTourCoverage['range']).mergeBaseMatchesRequestedBase === false)) fail();
    }
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(nonempty); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function oid(value: unknown): value is string { return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value); }
