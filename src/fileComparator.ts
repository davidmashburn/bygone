import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { DiffViewProvider } from './diffViewProvider';
import { buildTwoWayDiffModel, mergeText } from './diffEngine';

interface FileHistoryEntry {
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

export class FileComparator {
    private selectedFile: vscode.Uri | undefined;
    private diffViewProvider: DiffViewProvider | undefined;
    private fileHistoryEntries: FileHistoryEntry[] = [];
    private fileHistoryIndex = 0;
    private activeHistoryFile: vscode.Uri | undefined;

    public setDiffViewProvider(provider: DiffViewProvider) {
        this.diffViewProvider = provider;
        this.diffViewProvider.setHistoryNavigationHandler((direction) => {
            void this.navigateFileHistory(direction);
        });
    }

    public async selectAndCompareFiles(): Promise<void> {
        try {
            const file1 = await this.selectFile('Select first file to compare');
            if (!file1) return;

            const file2 = await this.selectFile('Select second file to compare');
            if (!file2) return;

            await this.compareFiles(file1, file2);
        } catch (error) {
            vscode.window.showErrorMessage(`Error comparing files: ${error}`);
        }
    }

    public async compareWithSelected(resource: vscode.Uri): Promise<void> {
        try {
            if (!this.selectedFile) {
                this.selectedFile = resource;
                vscode.window.showInformationMessage(`Selected ${path.basename(resource.path)}. Select another file to compare.`);
                return;
            }

            await this.compareFiles(this.selectedFile, resource);
            this.selectedFile = undefined;
        } catch (error) {
            vscode.window.showErrorMessage(`Error comparing files: ${error}`);
        }
    }

    public async threeWayMerge(): Promise<void> {
        try {
            vscode.window.showWarningMessage('Three-way merge is experimental. Review the result before applying it.');

            const baseFile = await this.selectFile('Select base file');
            if (!baseFile) return;

            const leftFile = await this.selectFile('Select left file (theirs)');
            if (!leftFile) return;

            const rightFile = await this.selectFile('Select right file (yours)');
            if (!rightFile) return;

            await this.performThreeWayMerge(baseFile, leftFile, rightFile);
        } catch (error) {
            vscode.window.showErrorMessage(`Error in three-way merge: ${error}`);
        }
    }

    public async compareTestFiles(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const testFile1Path = path.join(workspaceFolder.uri.fsPath, 'test-file-1.js');
            const testFile2Path = path.join(workspaceFolder.uri.fsPath, 'test-file-2.js');

            fs.writeFileSync(testFile1Path, this.generateTestFile1Content());
            fs.writeFileSync(testFile2Path, this.generateTestFile2Content());

            vscode.window.showInformationMessage('Test files created. Comparing...');

            await this.compareFiles(
                vscode.Uri.file(testFile1Path),
                vscode.Uri.file(testFile2Path)
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Error creating test files: ${error}`);
        }
    }

    public async compareFileHistory(resource?: vscode.Uri): Promise<void> {
        try {
            const targetFile = resource ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetFile || targetFile.scheme !== 'file') {
                vscode.window.showErrorMessage('Select a file in the workspace to view its git history.');
                return;
            }

            const history = this.buildFileHistory(targetFile);
            if (history.length === 0) {
                vscode.window.showWarningMessage('No git history with parents was found for that file.');
                return;
            }

            this.activeHistoryFile = targetFile;
            this.fileHistoryEntries = history;
            this.fileHistoryIndex = 0;

            await this.showCurrentHistoryEntry();
        } catch (error) {
            vscode.window.showErrorMessage(`Error loading file history: ${error}`);
        }
    }

    private generateTestFile1Content(): string {
        return `// Test File 1 - Example JavaScript Code
const fs = require('fs');
const path = require('path');

/**
 * A simple utility class for file operations
 */
class FileProcessor {
    constructor(directory = './') {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
    }

    // Method to read files from directory
    readFiles() {
        try {
            const files = fs.readdirSync(this.directory);
            this.files = files.filter(file => file.endsWith('.js'));
            console.log(\`Found \${this.files.length} JavaScript files\`);
        } catch (error) {
            console.error('Error reading directory:', error);
        }
    }

    // Process each file
    processFiles() {
        this.files.forEach(file => {
            try {
                const filePath = path.join(this.directory, file);
                fs.readFileSync(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Processed: \${file}\`);
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
            }
        });
    }

    // Get processing results
    getResults() {
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory
        };
    }
}

// Usage example
const processor = new FileProcessor('./src');
processor.readFiles();
processor.processFiles();
const results = processor.getResults();
console.log('Results:', results);

module.exports = FileProcessor;
`;
    }

    private generateTestFile2Content(): string {
        return `// Test File 2 - Modified JavaScript Code
const fs = require('fs');
const path = require('path');
const util = require('util');

/**
 * An enhanced utility class for file operations
 * Added more features and error handling
 */
class FileProcessor {
    constructor(directory = './', options = {}) {
        this.directory = directory;
        this.files = [];
        this.processedCount = 0;
        this.options = { recursive: false, ...options };
        this.startTime = Date.now();
    }

    // Enhanced method to read files from directory
    readFiles() {
        try {
            const items = fs.readdirSync(this.directory);
            this.files = items.filter(item => {
                const itemPath = path.join(this.directory, item);
                const stat = fs.statSync(itemPath);
                return stat.isFile() && item.endsWith('.js');
            });
            console.log(\`Found \${this.files.length} JavaScript files in \${this.directory}\`);
        } catch (error) {
            throw new Error(\`Failed to read directory \${this.directory}: \${error.message}\`);
        }
    }

    // Enhanced file processing with async support
    async processFiles() {
        const promises = this.files.map(async (file) => {
            try {
                const filePath = path.join(this.directory, file);
                const content = await util.promisify(fs.readFile)(filePath, 'utf8');
                this.processedCount++;
                console.log(\`Successfully processed: \${file}\`);
                return { file, content };
            } catch (error) {
                console.error(\`Error processing \${file}:\`, error);
                return { file, error: error.message };
            }
        });

        const results = await Promise.all(promises);
        return results.filter(result => !result.error);
    }

    // Get enhanced processing results
    getResults() {
        const duration = Date.now() - this.startTime;
        return {
            totalFiles: this.files.length,
            processed: this.processedCount,
            directory: this.directory,
            duration: \`\${duration}ms\`,
            options: this.options
        };
    }

    // New method to clean up files
    cleanUp() {
        console.log('Cleaning up resources...');
        this.files = [];
        this.processedCount = 0;
    }
}

// Enhanced usage example
async function main() {
    const processor = new FileProcessor('./src', { recursive: true });
    processor.readFiles();
    await processor.processFiles();
    const results = processor.getResults();
    console.log('Processing complete:', results);
    processor.cleanUp();
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = FileProcessor;
`;
    }

    private async selectFile(prompt: string): Promise<vscode.Uri | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Compare',
            title: prompt
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        return fileUri?.[0];
    }

    private async compareFiles(file1: vscode.Uri, file2: vscode.Uri): Promise<void> {
        const content1 = fs.readFileSync(file1.fsPath, 'utf8');
        const content2 = fs.readFileSync(file2.fsPath, 'utf8');
        const diffModel = buildTwoWayDiffModel(content1, content2);
        this.fileHistoryEntries = [];
        this.activeHistoryFile = undefined;

        if (this.diffViewProvider) {
            this.diffViewProvider.showDiff(file1, file2, content1, content2, diffModel);
        } else {
            this.showDiffInNewTab(file1, file2, diffModel);
        }
    }

    private async performThreeWayMerge(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri): Promise<void> {
        const baseContent = fs.readFileSync(base.fsPath, 'utf8');
        const leftContent = fs.readFileSync(left.fsPath, 'utf8');
        const rightContent = fs.readFileSync(right.fsPath, 'utf8');
        const mergeModel = mergeText(baseContent, leftContent, rightContent);

        if (this.diffViewProvider) {
            this.diffViewProvider.showThreeWayMerge(base, left, right, mergeModel);
        } else {
            this.showMergeResult(base, left, right, mergeModel.resultLines.join('\n'));
        }
    }

    private async navigateFileHistory(direction: 'back' | 'forward'): Promise<void> {
        if (this.fileHistoryEntries.length === 0) {
            return;
        }

        if (direction === 'back' && this.fileHistoryIndex < this.fileHistoryEntries.length - 1) {
            this.fileHistoryIndex++;
        } else if (direction === 'forward' && this.fileHistoryIndex > 0) {
            this.fileHistoryIndex--;
        } else {
            return;
        }

        await this.showCurrentHistoryEntry();
    }

    private async showCurrentHistoryEntry(): Promise<void> {
        if (!this.diffViewProvider || !this.activeHistoryFile || this.fileHistoryEntries.length === 0) {
            return;
        }

        const entry = this.fileHistoryEntries[this.fileHistoryIndex];
        const diffModel = buildTwoWayDiffModel(entry.leftContent, entry.rightContent);

        await this.diffViewProvider.showHistoryDiff(
            this.activeHistoryFile,
            entry.leftLabel,
            entry.rightLabel,
            entry.leftContent,
            entry.rightContent,
            diffModel,
            {
                canGoBack: this.fileHistoryIndex < this.fileHistoryEntries.length - 1,
                canGoForward: this.fileHistoryIndex > 0,
                positionLabel: `${this.fileHistoryIndex + 1} / ${this.fileHistoryEntries.length}`,
                leftCommitLabel: `${entry.parentCommit.slice(0, 7)} ${entry.parentSummary}`.trim(),
                leftTimestamp: entry.parentTimestamp,
                rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
                rightTimestamp: entry.timestamp
            }
        );
    }

    private buildFileHistory(file: vscode.Uri): FileHistoryEntry[] {
        const repoRoot = this.runGitCommand(['rev-parse', '--show-toplevel'], path.dirname(file.fsPath));
        const relativePath = path.relative(repoRoot, file.fsPath).replace(/\\/g, '/');
        const logOutput = this.runGitCommand(
            ['log', '--follow', '--format=%H%x09%h%x09%cI%x09%s', '--', relativePath],
            repoRoot
        );

        const commits = logOutput
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

        const historyEntries: FileHistoryEntry[] = [];

        for (const commit of commits) {
            const parents = this.runGitCommand(['rev-list', '--parents', '-n', '1', commit.commit], repoRoot)
                .trim()
                .split(' ')
                .slice(1);

            if (parents.length === 0) {
                continue;
            }

            const parentCommit = parents[0];
            const leftContent = this.readGitFile(repoRoot, parentCommit, relativePath);
            const rightContent = this.readGitFile(repoRoot, commit.commit, relativePath);

            historyEntries.push({
                commit: commit.commit,
                parentCommit,
                shortCommit: commit.shortCommit,
                summary: commit.summary,
                timestamp: commit.timestamp,
                parentSummary: this.readCommitSummary(repoRoot, parentCommit),
                parentTimestamp: this.readCommitTimestamp(repoRoot, parentCommit),
                leftLabel: `${path.basename(file.fsPath)} @ ${parentCommit.slice(0, 7)}`,
                rightLabel: `${path.basename(file.fsPath)} @ ${commit.shortCommit}`,
                leftContent,
                rightContent
            });
        }

        return historyEntries;
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

    private showDiffInNewTab(
        file1: vscode.Uri,
        file2: vscode.Uri,
        diffModel: ReturnType<typeof buildTwoWayDiffModel>
    ): void {
        const renderCell = (content: string) => content.length === 0 ? '(empty)' : content;
        const document = `
# Diff: ${path.basename(file1.path)} ↔ ${path.basename(file2.path)}

Structured rows: ${diffModel.rows.length}

\`\`\`text
${diffModel.rows.map((row) => `${renderCell(row.left.content)}    |    ${renderCell(row.right.content)}`).join('\n')}
\`\`\`
        `;

        vscode.workspace.openTextDocument({
            content: document,
            language: 'markdown'
        }).then((doc) => {
            vscode.window.showTextDocument(doc);
        });
    }

    private showMergeResult(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri, result: string): void {
        const document = `
# Three-Way Merge Result

Base: ${path.basename(base.path)}
Left: ${path.basename(left.path)}
Right: ${path.basename(right.path)}

\`\`\`diff
${result}
\`\`\`
        `;

        vscode.workspace.openTextDocument({
            content: document,
            language: 'markdown'
        }).then((doc) => {
            vscode.window.showTextDocument(doc);
        });
    }
}
