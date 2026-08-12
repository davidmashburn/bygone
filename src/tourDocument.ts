import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export type AuthoredTourPathSelection =
    | { kind: 'none'; paths: readonly string[] }
    | { kind: 'single'; path: string }
    | { kind: 'multiple'; paths: readonly string[] }
    | { kind: 'mixed'; tourPaths: readonly string[]; otherPaths: readonly string[] };

export interface AuthoredTourDocument {
    documentPath: string;
    repoRoot: string;
}

export function isAuthoredTourPath(candidate: string, platform: NodeJS.Platform = process.platform): boolean {
    const comparable = platform === 'win32' || platform === 'darwin'
        ? candidate.toLocaleLowerCase('en-US')
        : candidate;
    return comparable.endsWith('.bygone') || comparable.endsWith('.bygone.yaml');
}

export function classifyAuthoredTourPaths(
    candidates: readonly string[],
    platform: NodeJS.Platform = process.platform
): AuthoredTourPathSelection {
    const tourPaths = candidates.filter((candidate) => isAuthoredTourPath(candidate, platform));
    if (tourPaths.length === 0) return { kind: 'none', paths: candidates };
    if (tourPaths.length === 1 && candidates.length === 1) return { kind: 'single', path: tourPaths[0] };
    if (tourPaths.length === candidates.length) return { kind: 'multiple', paths: tourPaths };
    return {
        kind: 'mixed',
        tourPaths,
        otherPaths: candidates.filter((candidate) => !isAuthoredTourPath(candidate, platform))
    };
}

export function discoverAuthoredTourDocument(sourcePath: string): AuthoredTourDocument {
    const requestedPath = path.resolve(sourcePath);
    let documentPath: string;
    try {
        documentPath = fs.realpathSync(requestedPath);
        if (!fs.statSync(documentPath).isFile()) {
            throw new Error('path is not a regular file');
        }
    } catch (error) {
        throw errorWithCause(`Could not open Bygone source ${requestedPath}: ${errorMessage(error)}`, error);
    }

    let repoRoot: string;
    try {
        const discoveredRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: path.dirname(documentPath),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
        repoRoot = fs.realpathSync(discoveredRoot);
    } catch (error) {
        throw errorWithCause(
            `Bygone source ${documentPath} needs its Git repository. Place it inside the corresponding worktree or open it with an explicit repository working directory.`,
            error
        );
    }

    return { documentPath, repoRoot };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function errorWithCause(message: string, cause: unknown): Error {
    const error = new Error(message) as Error & { cause?: unknown };
    error.cause = cause;
    return error;
}
