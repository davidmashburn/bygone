import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

export interface FileHistoryEntry {
    commit: string;
    parentCommit: string;
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

interface HistoryCommitRecord {
    commit: string;
    shortCommit: string;
    timestamp: string;
    summary: string;
}

export class GitHistoryService {
    public buildFileHistory(file: vscode.Uri): FileHistoryEntry[] {
        const repoRoot = this.runGitCommand(['rev-parse', '--show-toplevel'], path.dirname(file.fsPath));
        const relativePath = path.relative(repoRoot, file.fsPath).replace(/\\/g, '/');
        const commits = this.parseHistoryCommitRecords(this.runGitCommand(
            ['log', '--follow', '--format=%H%x09%h%x09%cI%x09%s', '--', relativePath],
            repoRoot
        ));

        return commits
            .map((commit) => this.buildFileHistoryEntry(file, repoRoot, relativePath, commit))
            .filter((entry): entry is FileHistoryEntry => entry !== undefined);
    }

    private buildFileHistoryEntry(
        file: vscode.Uri,
        repoRoot: string,
        relativePath: string,
        commit: HistoryCommitRecord
    ): FileHistoryEntry | undefined {
        const parentCommit = this.readPrimaryParent(repoRoot, commit.commit);
        if (!parentCommit) {
            return undefined;
        }

        const fileName = path.basename(file.fsPath);
        const leftContent = this.readGitFile(repoRoot, parentCommit, relativePath);
        const rightContent = this.readGitFile(repoRoot, commit.commit, relativePath);

        return {
            commit: commit.commit,
            parentCommit,
            shortCommit: commit.shortCommit,
            summary: commit.summary,
            timestamp: commit.timestamp,
            parentSummary: this.readCommitSummary(repoRoot, parentCommit),
            parentTimestamp: this.readCommitTimestamp(repoRoot, parentCommit),
            leftLabel: `${fileName} @ ${parentCommit.slice(0, 7)}`,
            rightLabel: `${fileName} @ ${commit.shortCommit}`,
            leftContent,
            rightContent
        };
    }

    private readPrimaryParent(repoRoot: string, commit: string): string | undefined {
        const parents = this.runGitCommand(['rev-list', '--parents', '-n', '1', commit], repoRoot)
            .trim()
            .split(' ')
            .slice(1);

        return parents[0];
    }

    private runGitCommand(args: string[], cwd: string): string {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8'
        }).trimEnd();
    }

    private readGitFile(repoRoot: string, commit: string, relativePath: string): string {
        try {
            return execFileSync('git', ['show', `${commit}:${relativePath}`], {
                cwd: repoRoot,
                encoding: 'utf8'
            });
        } catch {
            return '';
        }
    }

    private readCommitSummary(repoRoot: string, commit: string): string {
        return this.runGitCommand(['show', '-s', '--format=%s', commit], repoRoot);
    }

    private readCommitTimestamp(repoRoot: string, commit: string): string {
        return this.runGitCommand(['show', '-s', '--format=%cI', commit], repoRoot);
    }

    private parseHistoryCommitRecords(logOutput: string): HistoryCommitRecord[] {
        return logOutput
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => {
                const [commit, shortCommit, timestamp, ...summaryParts] = line.split('\t');
                return {
                    commit,
                    shortCommit,
                    timestamp,
                    summary: summaryParts.join('\t')
                };
            });
    }
}
