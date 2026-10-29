import type { DependencyEvidenceReport } from '../src/dependencyEvidence';
import type { DependencySource } from '../src/dependencyGraph';
import type { DependencyChanges } from '../src/dependencyChanges';
import type { ChangeCorrespondence } from '../src/changeCorrespondence';
export function buildNativeDependencyView(repoRoot: string, options: {
    baseOid: string; headOid: string;
    focus?: { file: string; line?: number; start?: number; revision?: 'base' | 'head' };
    correspondence?: ChangeCorrespondence;
    signal?: AbortSignal;
}): Promise<{ report: DependencyEvidenceReport; changes: DependencyChanges; html: string }>;
export function dependencySource(report: DependencyEvidenceReport, source: unknown): DependencySource | undefined;
