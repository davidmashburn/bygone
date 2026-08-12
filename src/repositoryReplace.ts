import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type RepositoryReplacementFile = Readonly<{
    path: string;
    relativePath: string;
    occurrenceCount: number;
    beforeHash: string;
    afterHash: string;
    before: Buffer;
    after: Buffer;
    mode: number;
}>;

export type RepositoryReplacementPlan = Readonly<{
    root: string;
    find: string;
    replacement: string;
    files: readonly RepositoryReplacementFile[];
    occurrenceCount: number;
}>;

export function buildRepositoryReplacementPlan(
    root: string,
    candidatePaths: readonly string[],
    find: string,
    replacement: string,
    maximumBytes = 64 * 1024 * 1024
): RepositoryReplacementPlan {
    if (!find) throw new Error('Replace in Files requires non-empty literal text.');
    const realRoot = fs.realpathSync(root);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const files: RepositoryReplacementFile[] = [];
    let totalBytes = 0;
    const uniqueCandidates = [...new Set(candidatePaths)];
    if (uniqueCandidates.length > 1_000) throw new Error('Replace in Files preview exceeds its file budget.');
    for (const candidate of uniqueCandidates) {
        if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error(`Replace in Files does not write through symlinks: ${candidate}`);
        const realPath = fs.realpathSync(candidate);
        const relativePath = containedRelativePath(realRoot, realPath);
        const stats = fs.statSync(realPath);
        if (!stats.isFile()) continue;
        const before = fs.readFileSync(realPath);
        totalBytes += before.length;
        if (totalBytes > maximumBytes) throw new Error('Replace in Files preview exceeds its byte budget.');
        const hasByteOrderMark = before.length >= 3 && before[0] === 0xef && before[1] === 0xbb && before[2] === 0xbf;
        let text: string;
        try {
            text = decoder.decode(hasByteOrderMark ? before.subarray(3) : before);
        } catch {
            throw new Error(`Replace in Files supports UTF-8 text only: ${relativePath}`);
        }
        const occurrenceCount = countLiteral(text, find);
        if (occurrenceCount === 0) continue;
        const replaced = Buffer.from(text.split(find).join(replacement), 'utf8');
        const after = hasByteOrderMark ? Buffer.concat([before.subarray(0, 3), replaced]) : replaced;
        files.push({
            path: realPath, relativePath, occurrenceCount,
            beforeHash: hash(before), afterHash: hash(after), before, after,
            mode: stats.mode
        });
    }
    return {
        root: realRoot, find, replacement, files,
        occurrenceCount: files.reduce((sum, file) => sum + file.occurrenceCount, 0)
    };
}

export function applyRepositoryReplacementPlan(plan: RepositoryReplacementPlan, includedPaths: readonly string[]): number {
    const selected = selectPlanFiles(plan, includedPaths);
    selected.forEach((file) => assertHash(file.path, file.beforeHash, 'changed since the preview'));
    const written: RepositoryReplacementFile[] = [];
    try {
        for (const file of selected) {
            writeAtomic(file.path, file.after, file.mode);
            written.push(file);
        }
    } catch (error) {
        const rollbackFailures: string[] = [];
        for (const file of written.reverse()) {
            try { writeAtomic(file.path, file.before, file.mode); } catch { rollbackFailures.push(file.relativePath); }
        }
        const suffix = rollbackFailures.length ? ` Rollback failed for: ${rollbackFailures.join(', ')}` : '';
        throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
    }
    return selected.length;
}

export function undoRepositoryReplacementPlan(plan: RepositoryReplacementPlan, includedPaths: readonly string[]): number {
    const selected = selectPlanFiles(plan, includedPaths);
    selected.forEach((file) => assertHash(file.path, file.afterHash, 'changed after replacement'));
    const restored: RepositoryReplacementFile[] = [];
    try {
        for (const file of selected) {
            writeAtomic(file.path, file.before, file.mode);
            restored.push(file);
        }
    } catch (error) {
        const rollbackFailures: string[] = [];
        for (const file of restored.reverse()) {
            try { writeAtomic(file.path, file.after, file.mode); } catch { rollbackFailures.push(file.relativePath); }
        }
        const suffix = rollbackFailures.length ? ` Undo rollback failed for: ${rollbackFailures.join(', ')}` : '';
        throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`);
    }
    return selected.length;
}

function selectPlanFiles(plan: RepositoryReplacementPlan, includedPaths: readonly string[]) {
    const included = new Set(includedPaths);
    const selected = plan.files.filter((file) => included.has(file.path));
    if (selected.length !== included.size) throw new Error('Replace in Files selection contains an unknown file.');
    return selected;
}

function containedRelativePath(root: string, filePath: string): string {
    const relative = path.relative(root, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Replace in Files path is outside the selected root: ${filePath}`);
    }
    return relative.replace(/\\/g, '/');
}

function countLiteral(value: string, needle: string): number {
    let count = 0, offset = 0;
    while ((offset = value.indexOf(needle, offset)) >= 0) {
        count += 1;
        offset += needle.length;
    }
    return count;
}

function assertHash(filePath: string, expected: string, reason: string): void {
    let actual: string;
    try { actual = hash(fs.readFileSync(filePath)); } catch { throw new Error(`${filePath} is unavailable.`); }
    if (actual !== expected) throw new Error(`${filePath} ${reason}.`);
}

function hash(value: Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function writeAtomic(filePath: string, content: Buffer, mode: number): void {
    const temporaryPath = path.join(path.dirname(filePath), `.bygone-replace-${process.pid}-${randomBytes(8).toString('hex')}`);
    try {
        fs.writeFileSync(temporaryPath, content, { flag: 'wx', mode });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try { fs.unlinkSync(temporaryPath); } catch { /* already renamed or never created */ }
    }
}
