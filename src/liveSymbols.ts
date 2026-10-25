import { Worker } from 'worker_threads';
import * as path from 'path';
import { createHash } from 'crypto';
import { OffsetRange } from './followEdits';
import { checkFollowText } from './followBaseline';
export const snapshotDigest = (text: string): string => createHash('sha256').update(text).digest('hex');
export interface LiveSymbol extends OffsetRange { path: string; name: string; qualifiedName?: string; digest?: string; sha256?: string }
export interface LiveSymbolResult {
    leftDigest: string; rightDigest: string;
    left: LiveSymbol[]; right: LiveSymbol[];
    status: string; reason?: string;
    pairs: Array<{ source: LiveSymbol; destination: LiveSymbol }>;
    diagnostics: unknown[];
}
export function validSymbol(symbol: LiveSymbol, content: string): boolean {
    return Number.isInteger(symbol.start) && Number.isInteger(symbol.end) && symbol.start >= 0
        && symbol.end > symbol.start && symbol.end <= content.length
        && (symbol.digest ?? symbol.sha256) === snapshotDigest(content.slice(symbol.start, symbol.end));
}
/** Separate from commit artifacts: every range is verified against these exact strings. */
export function analyzeLiveSymbols(leftPath: string, rightPath: string, left: string, right: string, signal?: AbortSignal): Promise<LiveSymbolResult> {
    if (![leftPath, rightPath].every(p => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(p))) return Promise.reject(new Error('Symbol focus currently supports JavaScript and TypeScript. Showing file context.'));
    try { checkFollowText(left); checkFollowText(right); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Symbol analysis canceled.')); return; }
        const worker = new Worker(path.join(__dirname, 'liveSymbolsWorker.js'));
        const finish = (error?: Error, result?: LiveSymbolResult) => {
            clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate();
            if (error) reject(error); else resolve(result!);
        };
        const abort = () => finish(new Error('Symbol analysis canceled.'));
        const timer = setTimeout(() => finish(new Error('Symbol analysis exceeded its time budget. Showing file context.')), 2500);
        signal?.addEventListener('abort', abort, { once: true });
        worker.once('error', error => finish(error));
        worker.once('message', (result: LiveSymbolResult) => {
            if (result.leftDigest !== snapshotDigest(left) || result.rightDigest !== snapshotDigest(right)
                || !result.left.every(s => s.path === leftPath && validSymbol(s, left))
                || !result.right.every(s => s.path === rightPath && validSymbol(s, right))
                || !result.pairs.every(p => p.source.path === leftPath && p.destination.path === rightPath && validSymbol(p.source, left) && validSymbol(p.destination, right))) {
                finish(new Error('Symbol snapshot validation failed. Showing file context.')); return;
            }
            finish(undefined, result);
        });
        worker.postMessage({ leftPath, rightPath, left, right });
    });
}
