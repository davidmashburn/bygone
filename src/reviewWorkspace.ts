import { execFileSync } from 'child_process';
import { readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { TextDecoder } from 'util';
import { parseSourceRef, SourceRef, pinSourceRef, resolveSourceRef } from 'bygone-strand/source-references';
import { Review, Snapshot, parseReview, inspect, refresh, correspondenceEvidence } from './requirements';
import { loadChangeCorrespondence } from './changeCorrespondence';

const MAX_BYTES = 16 * 1024 * 1024;
export function readEvidenceJson(file: string): unknown {
    if (statSync(file).size > MAX_BYTES) throw new Error('Evidence file exceeds 16 MiB');
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
}
export function git(root: string, args: string[], deadline?: number): Buffer {
    const remaining = deadline === undefined ? 10000 : deadline - Date.now();
    if (remaining <= 0) throw new Error('Dependency source validation time budget exhausted');
    return execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { timeout: Math.min(10000, remaining), maxBuffer: MAX_BYTES, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function commitOid(root: string, revision: string, deadline?: number): string {
    const oid = git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], deadline).toString().trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) throw new Error('Expected a Git commit');
    return oid;
}
export function repositoryRoot(directory: string): string {
    return git(directory, ['rev-parse', '--show-toplevel']).toString().trim();
}
export function readPinnedFile(root: string, revision: string, file: string, deadline?: number): { text: string; blob: string } | undefined {
    // Reuse Strand's path validation before constructing Git object expressions.
    parseSourceRef({ revision, path: file, start: 0, end: 1, digest: '0'.repeat(64) });
    if (commitOid(root, revision, deadline) !== revision) throw new Error('Evidence requires a full immutable commit ID');
    const entry = git(root, ['ls-tree', '-z', revision, '--', `:(literal)${file}`], deadline).toString();
    if (!entry) return undefined;
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[3] !== file) throw new Error(`Evidence is not a regular file: ${file}`);
    const bytes = git(root, ['cat-file', 'blob', match[2]], deadline);
    if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error(`Evidence requires text up to 1 MiB: ${file}`);
    return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), blob: match[2] };
}
export function readSnapshot(root: string, repository: string, revision: string, paths: string[]): Snapshot {
    const files: Record<string, string> = Object.create(null);
    let bytes = 0;
    for (const file of new Set(paths)) {
        const source = readPinnedFile(root, revision, file);
        if (source) { bytes += Buffer.byteLength(source.text); if (bytes > MAX_BYTES) throw new Error('Review source budget exceeds 16 MiB'); files[file] = source.text; }
    }
    return { repository, revision, files };
}
function changedPathGroups(root: string, base: string, head: string): string[][] {
    const records = git(root, ['diff', '--name-status', '--find-renames', '-z', base, head, '--']).toString().split('\0');
    const groups: string[][] = [];
    for (let i = 0; i < records.length && records[i];) {
        const status = records[i++], before = records[i++];
        groups.push(status.startsWith('R') ? [before, records[i++]] : [before]);
    }
    if (groups.reduce((count, group) => count + group.length, 0) > 2000) throw new Error('Review exceeds 2000 changed paths');
    return groups;
}
/** Git-reported rename identity only; similarity does not relocate symbol ranges. */
export function comparisonPaths(root: string, base: string, head: string | undefined, file: string): { before: string; after: string } {
    const records = git(root, ['diff', '--name-status', '--find-renames', '-z', base, ...(head ? [head] : []), '--']).toString().split('\0');
    for (let i = 0; i < records.length && records[i];) {
        const status = records[i++], before = records[i++];
        const after = status.startsWith('R') || status.startsWith('C') ? records[i++] : before;
        if (status.startsWith('R') && (file === before || file === after)) return { before, after };
    }
    return { before: file, after: file };
}
export function inspectWorkspace(root: string, review: Review) {
    // Only referenced text is required. Binary/large changed files still appear as uncovered paths.
    const paths = review.links.map(link => link.ref.path);
    const base = readSnapshot(root, review.repository, review.base, paths);
    const head = readSnapshot(root, review.repository, review.head, paths);
    const result = inspect(review, base, head);
    const covered = new Set(result.requirements.flatMap(r => r.links.filter(l => l.resolution.status === 'valid').map(l => l.ref.path)));
    return { ...result, changedPathsWithoutLinks: changedPathGroups(root, review.base, review.head).filter(group => !group.some(file => covered.has(file))).flat(),
        checkoutHead: commitOid(root, 'HEAD'), dirtyWorkingTreeExcluded: true };
}
export function loadReview(root: string, file: string): Review {
    const review = parseReview(readEvidenceJson(file));
    // Explicit local binding: Git verifies both immutable commits and every referenced byte.
    inspectWorkspace(root, review);
    return review;
}
export function refreshWorkspace(root: string, review: Review, head: string, correspondence?: string, requirements = review.requirements) {
    const revision = commitOid(root, head);
    try { git(root, ['merge-base', '--is-ancestor', review.head, revision]); }
    catch { throw new Error('Refresh requires a descendant of the captured head; import a new review for a rewritten or unrelated comparison.'); }
    const artifact = correspondence ? loadChangeCorrespondence(root, correspondence, { baseOid: review.head, headOid: revision }) : undefined;
    const evidence = artifact ? correspondenceEvidence(artifact, ['Explicitly supplied correspondence artifact']) : undefined;
    const beforePaths = [...review.links.map(l => l.ref.path), ...(evidence?.pairs.map(p => p.before.path) ?? [])];
    const afterPaths = [...review.links.map(l => l.ref.path), ...(evidence?.pairs.map(p => p.after.path) ?? [])];
    return refresh(review, readSnapshot(root, review.repository, review.head, beforePaths),
        readSnapshot(root, review.repository, revision, afterPaths), evidence, requirements);
}
export function writeReview(file: string, review: Review): void {
    // New artifacts only: refreshing must not overwrite the historical review.
    writeFileSync(resolve(file), JSON.stringify(parseReview(review), null, 2) + '\n', { flag: 'wx' });
}
export function sourceText(root: string, ref: SourceRef): string {
    const file = readPinnedFile(root, ref.revision, ref.path);
    if (!file || resolveSourceRef(ref, { revision: ref.revision, files: { [ref.path]: file.text } }).status !== 'valid') throw new Error('Pinned evidence no longer validates');
    return file.text;
}
/** Line anchors use inclusive 1-based new-file lines; Strand uses half-open UTF-16 offsets. */
export function lineReference(root: string, revision: string, file: string, start: number, end: number): SourceRef {
    const source = readPinnedFile(root, revision, file);
    if (!source || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw new Error('Invalid line anchor');
    const offsets = [0];
    for (let i = 0; i < source.text.length; i++) if (source.text[i] === '\n' && i + 1 < source.text.length) offsets.push(i + 1);
    if (end > offsets.length) throw new Error('Line anchor exceeds pinned file');
    return pinSourceRef({ revision, files: { [file]: source.text } }, file, offsets[start - 1], offsets[end] ?? source.text.length);
}
