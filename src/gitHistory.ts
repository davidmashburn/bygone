import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const parsedGitMaxBufferBytes = Number.parseInt(process.env.BYGONE_GIT_MAX_BUFFER_BYTES ?? '', 10);
const GIT_MAX_BUFFER_BYTES = Number.isFinite(parsedGitMaxBufferBytes) && parsedGitMaxBufferBytes > 0
    ? parsedGitMaxBufferBytes
    : DEFAULT_GIT_MAX_BUFFER_BYTES;
const DEFAULT_HISTORY_MAX_COMMITS = 250;

export interface FileHistoryEntry {
    commit: string;
    parentCommit: string | undefined;
    shortCommit: string;
    summary: string;
    timestamp: string;
    parentSummary: string;
    parentTimestamp: string;
    leftLabel: string;
    rightLabel: string;
    leftContent: string;
    rightContent: string;
}

export interface FileHistoryEntryDescriptor {
    commit: string;
    parentCommit: string | undefined;
    shortCommit: string;
    summary: string;
    timestamp: string;
    parentSummary: string;
    parentTimestamp: string;
    leftLabel: string;
    rightLabel: string;
    filePath: string;
    repoRoot: string;
    relativePath: string;
    leftContent?: string;
    rightContent?: string;
    rightDirty?: boolean;
}

interface HistoryCommitRecord {
    commit: string;
    shortCommit: string;
    timestamp: string;
    summary: string;
    parentCommit?: string;
}

interface CommitMetadata {
    summary: string;
    timestamp: string;
}

export class GitHistoryService {
    public buildFileHistory(filePath: string, includeStaged = false): FileHistoryEntry[] {
        return this.buildFileHistoryDescriptors(filePath, includeStaged).map((entry) => this.materializeFileHistoryEntry(entry));
    }

    public buildFileHistoryDescriptors(filePath: string, includeStaged = false): FileHistoryEntryDescriptor[] {
        const canonicalFilePath = fs.realpathSync(filePath);
        const repoRoot = fs.realpathSync(this.runGitCommand(['rev-parse', '--show-toplevel'], path.dirname(canonicalFilePath)));
        const relativePath = path.relative(repoRoot, canonicalFilePath).replace(/\\/g, '/');
        const maxCommits = readPositiveIntegerEnv('BYGONE_HISTORY_MAX_COMMITS', DEFAULT_HISTORY_MAX_COMMITS);
        const commits = this.readHistoryCommitRecords(repoRoot, relativePath, maxCommits);
        const parentMetadataByCommit = this.readCommitMetadataMap(
            repoRoot,
            [...new Set(commits.map((commit) => commit.parentCommit).filter((commit): commit is string => Boolean(commit)))]
        );
        const commitEntries = commits
            .map((commit) => this.buildFileHistoryDescriptor(
                canonicalFilePath,
                repoRoot,
                relativePath,
                commit,
                parentMetadataByCommit
            ))
            .filter((entry): entry is FileHistoryEntryDescriptor => entry !== undefined);
        const topEntries = this.buildTopHistoryDescriptors(canonicalFilePath, repoRoot, relativePath, includeStaged);

        return [...topEntries, ...commitEntries];
    }

    public materializeFileHistoryEntry(entry: FileHistoryEntryDescriptor): FileHistoryEntry {
        if (entry.commit === 'WORKTREE') {
            const leftContent = entry.parentCommit === 'INDEX'
                ? this.readGitFile(entry.repoRoot, '', entry.relativePath)
                : this.readGitFile(entry.repoRoot, entry.parentCommit, entry.relativePath);
            return this.toFileHistoryEntry(
                entry,
                leftContent,
                this.readWorkingTreeFile(entry.filePath)
            );
        }

        if (entry.commit === 'INDEX') {
            return this.toFileHistoryEntry(
                entry,
                this.readGitFile(entry.repoRoot, entry.parentCommit, entry.relativePath),
                this.readGitFile(entry.repoRoot, '', entry.relativePath)
            );
        }

        return this.toFileHistoryEntry(
            entry,
            this.readGitFile(entry.repoRoot, entry.parentCommit, entry.relativePath),
            this.readGitFile(entry.repoRoot, entry.commit, entry.relativePath)
        );
    }

    private buildTopHistoryDescriptors(
        filePath: string,
        repoRoot: string,
        relativePath: string,
        includeStaged: boolean
    ): FileHistoryEntryDescriptor[] {
        const headCommit = this.readHeadCommit(repoRoot);

        const headContent = this.readGitFile(repoRoot, headCommit, relativePath);
        const indexContent = this.readGitFile(repoRoot, '', relativePath);
        const workingTreeContent = this.readWorkingTreeFile(filePath);
        const headMetadata = headCommit ? this.readCommitMetadata(repoRoot, headCommit) : { summary: '', timestamp: '' };

        const fileName = path.basename(filePath);
        const entries: FileHistoryEntryDescriptor[] = [];

        if (includeStaged) {
            if (workingTreeContent !== indexContent) {
                entries.push({
                    commit: 'WORKTREE',
                    parentCommit: 'INDEX',
                    shortCommit: 'Working Tree',
                    summary: '',
                    timestamp: '',
                    parentSummary: '',
                    parentTimestamp: '',
                    leftLabel: `${fileName} @ Staged`,
                    rightLabel: `${fileName} @ Working Tree`,
                    filePath,
                    repoRoot,
                    relativePath
                });
            }
            if (indexContent !== headContent) {
                entries.push({
                    commit: 'INDEX',
                    parentCommit: headCommit,
                    shortCommit: 'Staged Area',
                    summary: '',
                    timestamp: '',
                    parentSummary: headMetadata.summary,
                    parentTimestamp: headMetadata.timestamp,
                    leftLabel: `${fileName} @ HEAD`,
                    rightLabel: `${fileName} @ Staged`,
                    filePath,
                    repoRoot,
                    relativePath
                });
            }
        } else {
            if (workingTreeContent !== headContent) {
                entries.push({
                    commit: 'WORKTREE',
                    parentCommit: headCommit,
                    shortCommit: 'Working Tree',
                    summary: '',
                    timestamp: '',
                    parentSummary: headMetadata.summary,
                    parentTimestamp: headMetadata.timestamp,
                    leftLabel: `${fileName} @ HEAD`,
                    rightLabel: `${fileName} @ Working Tree`,
                    filePath,
                    repoRoot,
                    relativePath
                });
            }
        }

        return entries;
    }

    private buildFileHistoryDescriptor(
        filePath: string,
        repoRoot: string,
        relativePath: string,
        commit: HistoryCommitRecord,
        parentMetadataByCommit: Map<string, CommitMetadata>
    ): FileHistoryEntryDescriptor | undefined {
        const parentCommit = commit.parentCommit;
        if (!parentCommit) {
            return undefined;
        }

        const fileName = path.basename(filePath);
        const parentMetadata = parentMetadataByCommit.get(parentCommit) ?? this.readCommitMetadata(repoRoot, parentCommit);

        return {
            commit: commit.commit,
            parentCommit,
            shortCommit: commit.shortCommit,
            summary: commit.summary,
            timestamp: commit.timestamp,
            parentSummary: parentMetadata.summary,
            parentTimestamp: parentMetadata.timestamp,
            leftLabel: `${fileName} @ ${parentCommit.slice(0, 7)}`,
            rightLabel: `${fileName} @ ${commit.shortCommit}`,
            filePath,
            repoRoot,
            relativePath
        };
    }

    private toFileHistoryEntry(entry: FileHistoryEntryDescriptor, leftContent: string, rightContent: string): FileHistoryEntry {
        return {
            commit: entry.commit,
            parentCommit: entry.parentCommit,
            shortCommit: entry.shortCommit,
            summary: entry.summary,
            timestamp: entry.timestamp,
            parentSummary: entry.parentSummary,
            parentTimestamp: entry.parentTimestamp,
            leftLabel: entry.leftLabel,
            rightLabel: entry.rightLabel,
            leftContent,
            rightContent
        };
    }

    private runGitCommand(args: string[], cwd: string): string {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            maxBuffer: GIT_MAX_BUFFER_BYTES
        }).trimEnd();
    }

    private readHistoryCommitRecords(repoRoot: string, relativePath: string, maxCommits: number): HistoryCommitRecord[] {
        try {
            return this.parseHistoryCommitRecords(execFileSync('git', [
                'log',
                '--max-count',
                String(maxCommits),
                '--follow',
                '--format=%H%x09%h%x09%cI%x09%s%x09%P',
                '--',
                relativePath
            ], {
                cwd: repoRoot,
                encoding: 'utf8',
                maxBuffer: GIT_MAX_BUFFER_BYTES,
                stdio: ['ignore', 'pipe', 'ignore']
            }).trimEnd());
        } catch {
            return [];
        }
    }

    private readHeadCommit(repoRoot: string): string | undefined {
        try {
            return execFileSync('git', ['rev-parse', 'HEAD'], {
                cwd: repoRoot,
                encoding: 'utf8',
                maxBuffer: GIT_MAX_BUFFER_BYTES,
                stdio: ['ignore', 'pipe', 'ignore']
            }).trimEnd();
        } catch {
            return undefined;
        }
    }

    private readGitFile(repoRoot: string, commit: string | undefined, relativePath: string): string {
        try {
            return execFileSync('git', ['show', `${commit}:${relativePath}`], {
                cwd: repoRoot,
                encoding: 'utf8',
                maxBuffer: GIT_MAX_BUFFER_BYTES,
                stdio: ['ignore', 'pipe', 'ignore']
            });
        } catch {
            return '';
        }
    }

    private readWorkingTreeFile(filePath: string): string {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch {
            return '';
        }
    }

    private readCommitMetadata(repoRoot: string, commit: string): CommitMetadata {
        const output = this.runGitCommand(['show', '-s', '--format=%cI%x09%s', commit], repoRoot);
        const [timestamp = '', ...summaryParts] = output.split('\t');
        return {
            timestamp,
            summary: summaryParts.join('\t')
        };
    }

    private readCommitMetadataMap(repoRoot: string, commits: string[]): Map<string, CommitMetadata> {
        if (commits.length === 0) {
            return new Map();
        }

        const output = this.runGitCommand(['show', '-s', '--format=%H%x09%cI%x09%s', ...commits], repoRoot);
        return output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .reduce((map, line) => {
                const [commit, timestamp = '', ...summaryParts] = line.split('\t');
                if (commit) {
                    map.set(commit, {
                        timestamp,
                        summary: summaryParts.join('\t')
                    });
                }
                return map;
            }, new Map<string, CommitMetadata>());
    }

    private parseHistoryCommitRecords(logOutput: string): HistoryCommitRecord[] {
        return logOutput
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => {
                const parts = line.split('\t');
                const commit = parts[0];
                const shortCommit = parts[1];
                const timestamp = parts[2];
                const hasParentField = parts.length >= 5;
                const parentField = hasParentField ? (parts[parts.length - 1] || '') : '';
                const summaryParts = hasParentField ? parts.slice(3, -1) : parts.slice(3);
                const firstParentCommit = parentField.split(' ').find((candidate) => candidate.length > 0);
                return {
                    commit,
                    shortCommit,
                    timestamp,
                    summary: summaryParts.join('\t'),
                    parentCommit: firstParentCommit
                };
            });
    }
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
