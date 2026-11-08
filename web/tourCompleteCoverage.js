import { TourCoverage } from '../src/tourOptions.ts';
import { StrictTourCoverageMode, StrictTourCoverageStatus } from '../src/tourCompleteCoverage.ts';

/** Root reports cover the compiler's root-derived presentations of the same tour. */
export function completeCoverageForMode(reports, mode) {
    if (!Object.values(StrictTourCoverageMode).includes(mode)) return undefined;
    return reports?.[mode] || reports?.[StrictTourCoverageMode.Tour];
}

/** Append pinned accounting to the existing secondary Tour details surface. */
export function renderCompleteCoverage(host, report, options) {
    if (!report && options?.coverage !== TourCoverage.Complete) return;
    const document = host.ownerDocument || globalThis.document;
    const text = (tag, content) => { const element = document.createElement(tag); element.textContent = content; return element; };
    const section = document.createElement('details');
    section.className = 'tour-complete-coverage';
    const complete = report?.status === StrictTourCoverageStatus.Complete;
    section.append(text('summary', complete ? '100% main-path coverage · compiler report'
        : report?.status === StrictTourCoverageStatus.NoTextualChanges ? 'Complete coverage · no textual changes'
        : report ? 'Complete coverage · gaps or limitations' : 'Complete coverage requested · not verified'));
    if (!report) {
        section.append(text('p', 'This artifact has no strict coverage result. Recompile it to verify the requested coverage.'));
        host.append(section);
        return;
    }
    section.append(text('p', `${report.coveredHunks}/${report.totalHunks} full textual hunks covered; ${report.accountedFiles.length} changed entries explicitly accounted for; ${report.outstandingPaths.length} outstanding paths.`));
    section.append(text('p', `Scope: ${report.scope.requestedPaths.join(', ') || 'whole comparison'} · ${report.range.baseOid} → ${report.range.headOid}`));
    section.append(text('p', 'Coverage was recorded at compilation. The viewer does not re-run coverage; recompile after changing narration or evidence.'));
    section.append(text('p', 'Counts narrated endpoint evidence on the main path. Optional branches, correctness, test coverage, and reader progress are separate.'));
    if (report.status === StrictTourCoverageStatus.NoTextualChanges) section.append(text('p', 'No textual changes to score; no 100% textual-coverage claim.'));
    const gaps = document.createElement('ul');
    for (const hunk of report.uncoveredHunks) gaps.append(text('li', `${hunk.path} · ${hunk.id}: missing ${hunk.missingSides.join(' and ')} evidence`));
    for (const path of report.outstandingPaths) gaps.append(text('li', `${path}: needs an explicit accounting explanation`));
    for (const limitation of report.limitations) gaps.append(text('li', limitation));
    for (const exclusion of report.exclusions) gaps.append(text('li', `${exclusion.path}: excluded (${exclusion.reason}); exclusions prevent a complete result`));
    if (gaps.children.length) section.append(gaps);
    if (report.accountedFiles.length) {
        const accounted = document.createElement('ul');
        for (const file of report.accountedFiles) accounted.append(text('li', `${file.path}: ${file.reason}`));
        section.append(text('h3', 'Explicit file accounting'), accounted);
    }
    host.append(section);
}
