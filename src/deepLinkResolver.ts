import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { TextDecoder } from 'util';
import { parseDeepLink, type DeepLink } from './deepLink';

/** Validate local bindings and evidence before changing any window. */
export function resolveLocalDeepLink(value: string): { link: DeepLink; repoRoot: string; documentPath?: string } {
    const link = parseDeepLink(value);
    const repoRoot = fs.realpathSync(fileURLToPath(link.repo));
    const git = (args: string[]): string => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== repoRoot) throw new Error('The link must identify the exact repository worktree root.');
    if (link.kind === 'tour') {
        const absolute = /^file:/i.test(link.tour);
        const documentPath = fs.realpathSync(absolute ? fileURLToPath(link.tour) : path.join(repoRoot, link.tour));
        const relative = path.relative(repoRoot, documentPath);
        if (!absolute && (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative))) throw new Error('The linked tour resolves outside its repository.');
        if (!fs.statSync(documentPath).isFile()) throw new Error('The linked tour is not a file.');
        return { link, repoRoot, documentPath };
    }
    for (const oid of link.revisions) {
        if (git(['rev-parse', '--verify', '--end-of-options', `${oid}^{commit}`]).trim() !== oid) throw new Error(`Required revision is unavailable: ${oid}.`);
    }
    if (link.file) {
        const exists = (oid: string): boolean => { try { return git(['cat-file', '-t', `${oid}:${link.file}`]).trim() === 'blob'; } catch { return false; } };
        if (link.revision ? !exists(link.revision) : !link.revisions.some(exists)) throw new Error('The requested file is unavailable at the requested revision.');
        if (link.line !== undefined && link.revision) {
            const bytes = execFileSync('git', ['show', `${link.revision}:${link.file}`], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
            let content: string;
            try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
            catch { throw new Error('Non-UTF-8 files cannot have text-line targets.'); }
            if (content.includes('\0')) throw new Error('Binary files cannot have text-line targets.');
            if (link.line > content.split(/\r?\n/).length) throw new Error('The requested line is outside the file.');
        }
    }
    return { link, repoRoot };
}
