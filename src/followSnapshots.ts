import { execFile } from 'child_process';
import { realpath } from 'fs/promises';
import * as path from 'path';
import { TextDecoder } from 'util';
import { checkFollowText, FOLLOW_MAX_BYTES, FollowBaseline } from './followBaseline';

/** The index entry is read once, then its immutable blob. Conflict stages are rejected. */
export async function resolveIndexSnapshot(filePath: string, signal?: AbortSignal): Promise<FollowBaseline> {
    const git = (cwd: string, args: string[]) => new Promise<Buffer>((resolve, reject) => {
        execFile('git', ['--literal-pathspecs', ...args], {
            cwd, encoding: 'buffer', timeout: 5000, maxBuffer: FOLLOW_MAX_BYTES + 4096, signal,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    // A deleted file may have a deleted parent directory as well.
    let directory = path.dirname(filePath);
    let suffix = path.basename(filePath);
    for (;;) {
        try { directory = await realpath(directory); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent = path.dirname(directory); if (parent === directory) throw error; suffix = path.join(path.basename(directory), suffix); directory = parent; }
    }
    const root = (await git(directory, ['rev-parse', '--show-toplevel'])).toString().trimEnd();
    const relativePath = path.relative(root, path.join(directory, suffix)).split(path.sep).join('/');
    if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) throw new Error('File is outside its Git worktree.');
    const entries = (await git(root, ['ls-files', '--stage', '-z', '--', relativePath])).toString().split('\0').filter(Boolean);
    if (!entries.length) return { root, relativePath, oid: null, content: '', absent: true };
    const match = /^(\d+) ([a-f0-9]+) (\d)\t/.exec(entries[0]);
    if (entries.length !== 1 || !match || match[3] !== '0') throw new Error('Merge conflicts are not supported. Resolve them in VS Code first.');
    if (!/^100[67][45][45]$/.test(match[1])) throw new Error('Only regular text files can be compared.');
    const size = Number((await git(root, ['cat-file', '-s', match[2]])).toString());
    if (!Number.isFinite(size) || size > FOLLOW_MAX_BYTES) throw new Error('The index version exceeds the 128 KiB following limit.');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(await git(root, ['cat-file', 'blob', match[2]])); }
    catch { throw new Error('The index version is not UTF-8 text.'); }
    checkFollowText(content);
    return { root, relativePath, oid: match[2], content, absent: false };
}
