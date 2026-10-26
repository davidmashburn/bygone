import { execFile } from 'child_process';
import { realpath } from 'fs/promises';
import * as path from 'path';
import { TextDecoder } from 'util';

export const FOLLOW_MAX_BYTES = 128 * 1024;
export const FOLLOW_MAX_LINES = 5000;

export interface FollowBaseline {
    root: string;
    relativePath: string;
    oid: string | null;
    content: string;
    absent: boolean;
}

export function checkFollowText(content: string): void {
    const lineCount = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    if (Buffer.byteLength(content, 'utf8') > FOLLOW_MAX_BYTES || lineCount > FOLLOW_MAX_LINES) {
        throw new Error('Following supports text up to 128 KiB and 5,000 lines. Use a manual comparison for this file.');
    }
    if (content.includes('\0')) throw new Error('Binary files cannot be followed.');
}

/** Read only the selected file at one immutable commit, never the index or history. */
export async function resolveFollowBaseline(filePath: string, signal?: AbortSignal): Promise<FollowBaseline> {
    const git = (cwd: string, args: string[]) => new Promise<Buffer>((resolve, reject) => {
        execFile('git', ['--literal-pathspecs', ...args], {
            cwd, encoding: 'buffer', timeout: 5000, maxBuffer: FOLLOW_MAX_BYTES + 4096, signal,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    // Buffer output avoids silently replacing invalid UTF-8 in a baseline.
    const text = async (cwd: string, args: string[]) => (await git(cwd, args)).toString('utf8').replace(/\n$/, '');
    const { directory, physicalPath } = await resolveFollowLocation(filePath);
    const root = await text(directory, ['rev-parse', '--show-toplevel']);
    const relativePath = path.relative(root, physicalPath).split(path.sep).join('/');
    if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) throw new Error('File is outside its Git worktree.');
    let oid: string | null;
    try {
        oid = await text(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
    } catch (error) {
        // Only a genuinely absent symbolic HEAD is an unborn repository.
        const ref = await text(root, ['symbolic-ref', '-q', 'HEAD']);
        try {
            await git(root, ['show-ref', '--verify', '--quiet', ref]);
        } catch (refError) {
            if ((refError as { code?: unknown }).code !== 1) throw error;
            return { root, relativePath, oid: null, content: '', absent: true };
        }
        throw error;
    }
    const entry = await git(root, ['ls-tree', '-z', oid, '--', relativePath]);
    if (!entry.length) return { root, relativePath, oid, content: '', absent: true };
    const match = /^(\d+) (\w+) ([a-f0-9]+)\t/.exec(entry.toString('utf8'));
    if (!match || match[2] !== 'blob' || match[1] === '120000') throw new Error('Only regular text files can be followed.');
    const size = Number(await text(root, ['cat-file', '-s', match[3]]));
    if (!Number.isFinite(size) || size > FOLLOW_MAX_BYTES) throw new Error('The HEAD version exceeds the 128 KiB following limit.');
    const bytes = await git(root, ['cat-file', 'blob', match[3]]);
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('The HEAD version is not UTF-8 text.'); }
    checkFollowText(content);
    return { root, relativePath, oid, content, absent: false };
}

/** Resolve parent aliases while preserving missing paths and the selected leaf. */
export async function resolveFollowLocation(filePath: string): Promise<{ directory: string; physicalPath: string }> {
    // Git reports a physical worktree path. Resolve directory aliases (including
    // macOS /var -> /private/var) before checking containment, retaining the leaf
    // name so a file symlink cannot silently become a different tracked file.
    let directory = path.dirname(filePath);
    let suffix = path.basename(filePath);
    for (;;) {
        try { directory = await realpath(directory); break; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const parent = path.dirname(directory);
            if (parent === directory) throw error;
            suffix = path.join(path.basename(directory), suffix); directory = parent;
        }
    }
    return { directory, physicalPath: path.join(directory, suffix) };
}
