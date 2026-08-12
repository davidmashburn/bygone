import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

export type RepositorySearchQuery = Readonly<{
    root: string;
    pattern: string;
    literal?: boolean;
    caseSensitive?: boolean;
    hidden?: boolean;
    followSymlinks?: boolean;
    globs?: readonly string[];
    maxResults?: number;
    executable?: string;
}>;

export type RepositorySearchMatch = Readonly<{
    kind: 'filesystem-match';
    path: string;
    line: number;
    column: number;
    endColumn: number;
    preview: string;
    writable: false;
}>;

export type RepositorySearchCompletion =
    | { kind: 'complete'; matchCount: number; truncated: boolean }
    | { kind: 'cancelled'; matchCount: number }
    | { kind: 'failed'; matchCount: number; message: string };

export type RepositorySearchHandle = Readonly<{
    completion: Promise<RepositorySearchCompletion>;
    cancel(): void;
}>;

export type RipgrepCapability =
    | { kind: 'available'; executable: string; version: string; majorVersion: number }
    | { kind: 'missing'; executable: string; message: string }
    | { kind: 'unsupported'; executable: string; version: string; majorVersion: number; minimumMajorVersion: number };

const minimumRipgrepMajorVersion = 14;

export function detectRipgrepCapability(executable = process.env.BYGONE_RG_PATH || 'rg'): RipgrepCapability {
    const result = spawnSync(executable, ['--version'], {
        encoding: 'utf8',
        shell: false,
        timeout: 3_000,
        windowsHide: true
    });
    if (result.error) return { kind: 'missing', executable, message: result.error.message };
    const version = String(result.stdout || '').split(/\r?\n/, 1)[0].trim();
    const match = /^ripgrep\s+(\d+)(?:\.\d+){1,2}/.exec(version);
    if (!match) return { kind: 'missing', executable, message: `Could not parse ripgrep version output: ${version || '(empty)'}` };
    const majorVersion = Number.parseInt(match[1], 10);
    return majorVersion >= minimumRipgrepMajorVersion
        ? { kind: 'available', executable, version, majorVersion }
        : { kind: 'unsupported', executable, version, majorVersion, minimumMajorVersion: minimumRipgrepMajorVersion };
}

export function buildRipgrepArgs(query: RepositorySearchQuery): string[] {
    validateQuery(query);
    const args = ['--json', '--line-number', '--column', '--with-filename', '--no-heading', '--color=never'];
    args.push(query.literal === false ? '--regexp' : '--fixed-strings', query.pattern);
    args.push(query.caseSensitive ? '--case-sensitive' : '--ignore-case');
    if (query.hidden) args.push('--hidden');
    if (query.followSymlinks) args.push('--follow');
    for (const glob of query.globs || []) args.push('--glob', glob);
    args.push('--', '.');
    return args;
}

export function parseRipgrepJsonLine(line: string, root: string): RepositorySearchMatch[] {
    let envelope: unknown;
    try {
        envelope = JSON.parse(line);
    } catch {
        return [];
    }
    if (!isRecord(envelope) || envelope.type !== 'match' || !isRecord(envelope.data)) return [];
    const data = envelope.data;
    const pathField = data.path;
    const linesField = data.lines;
    if (!isTextField(pathField) || !isTextField(linesField) || !Number.isInteger(data.line_number) || !Array.isArray(data.submatches)) return [];
    const preview = linesField.text.replace(/\r?\n$/, '');
    const resultPath = path.resolve(root, pathField.text);
    const relativeResultPath = path.relative(root, resultPath);
    if (relativeResultPath.startsWith('..') || path.isAbsolute(relativeResultPath)) return [];
    return data.submatches.flatMap((submatch) => {
        if (!isRecord(submatch) || !Number.isInteger(submatch.start) || !Number.isInteger(submatch.end)) return [];
        return [{
            kind: 'filesystem-match' as const,
            path: resultPath,
            line: data.line_number as number,
            column: byteOffsetToColumn(linesField.text, submatch.start as number),
            endColumn: byteOffsetToColumn(linesField.text, submatch.end as number),
            preview,
            writable: false as const
        }];
    });
}

export function startRepositorySearch(
    query: RepositorySearchQuery,
    onMatch: (match: RepositorySearchMatch) => void
): RepositorySearchHandle {
    const args = buildRipgrepArgs(query);
    const maximum = query.maxResults ?? 10_000;
    const executable = query.executable || 'rg';
    let child: ChildProcess | undefined;
    let cancelled = false;
    let truncated = false;
    let matchCount = 0;

    const completion = new Promise<RepositorySearchCompletion>((resolve) => {
        const spawned = spawn(executable, args, {
            cwd: query.root,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        child = spawned;
        let stdoutBuffer = '';
        let stderr = '';

        spawned.stdout?.setEncoding('utf8');
        spawned.stdout?.on('data', (chunk: string) => {
            stdoutBuffer += chunk;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
                for (const match of parseRipgrepJsonLine(line, query.root)) {
                    if (matchCount >= maximum) {
                        truncated = true;
                        child?.kill('SIGTERM');
                        return;
                    }
                    matchCount += 1;
                    onMatch(match);
                }
            }
        });
        spawned.stderr?.setEncoding('utf8');
        spawned.stderr?.on('data', (chunk: string) => {
            stderr = `${stderr}${chunk}`.slice(-16_384);
        });
        spawned.once('error', (error) => resolve({ kind: 'failed', matchCount, message: error.message }));
        spawned.once('close', (code) => {
            if (cancelled) resolve({ kind: 'cancelled', matchCount });
            else if (truncated) resolve({ kind: 'complete', matchCount, truncated: true });
            else if (code === 0 || code === 1) resolve({ kind: 'complete', matchCount, truncated: false });
            else resolve({ kind: 'failed', matchCount, message: stderr.trim() || `ripgrep exited with code ${code}` });
        });
    });

    return {
        completion,
        cancel() {
            cancelled = true;
            child?.kill('SIGTERM');
        }
    };
}

function validateQuery(query: RepositorySearchQuery): void {
    if (!path.isAbsolute(query.root)) throw new Error('Repository search root must be absolute.');
    if (!query.pattern) throw new Error('Repository search pattern must not be empty.');
    if (query.maxResults !== undefined && (!Number.isInteger(query.maxResults) || query.maxResults < 1)) {
        throw new Error('Repository search maxResults must be a positive integer.');
    }
    if (query.globs?.some((glob) => typeof glob !== 'string' || !glob)) {
        throw new Error('Repository search globs must be non-empty strings.');
    }
}

function byteOffsetToColumn(value: string, byteOffset: number): number {
    return Buffer.from(value).subarray(0, byteOffset).toString('utf8').length + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTextField(value: unknown): value is { text: string } {
    return isRecord(value) && typeof value.text === 'string';
}
