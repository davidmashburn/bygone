import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffViewProvider } from './diffViewProvider';
import { buildTwoWayDiffModel, mergeText } from './diffEngine';
import { buildDirectoryDiffInput } from './directoryDiff';
import { openDiffPreview, openMergePreview } from './fallbackViews';
import { FileHistoryEntry, GitHistoryService } from './gitHistory';
import { createJavaScriptSampleFilePair } from './sampleFiles';
import { HistoryViewState } from './webviewMessages';

export class FileComparator {
    private selectedFile: vscode.Uri | undefined;
    private diffViewProvider: DiffViewProvider | undefined;
    private fileHistoryEntries: FileHistoryEntry[] = [];
    private fileHistoryIndex = 0;
    private activeHistoryFile: vscode.Uri | undefined;
    private readonly gitHistoryService = new GitHistoryService();

    public setDiffViewProvider(provider: DiffViewProvider) {
        this.diffViewProvider = provider;
        this.diffViewProvider.setHistoryNavigationHandler((direction) => {
            void this.navigateFileHistory(direction);
        });
    }

    public async selectAndCompareFiles(): Promise<void> {
        try {
            const file1 = await this.selectFile('Select first file to compare');
            if (!file1) {
                return;
            }

            const file2 = await this.selectFile('Select second file to compare');
            if (!file2) {
                return;
            }

            await this.compareFiles(file1, file2);
        } catch (error) {
            this.showErrorMessage('Error comparing files', error);
        }
    }

    public async compareWithSelected(resource: vscode.Uri): Promise<void> {
        try {
            if (!this.selectedFile) {
                this.selectedFile = resource;
                vscode.window.showInformationMessage(`Selected ${resource.path.split('/').pop()}. Select another file to compare.`);
                return;
            }

            await this.compareFiles(this.selectedFile, resource);
            this.selectedFile = undefined;
        } catch (error) {
            this.showErrorMessage('Error comparing files', error);
        }
    }

    public async threeWayMerge(): Promise<void> {
        try {
            vscode.window.showWarningMessage('Three-way merge is experimental. Review the result before applying it.');

            const baseFile = await this.selectFile('Select base file');
            if (!baseFile) {
                return;
            }

            const leftFile = await this.selectFile('Select left file (theirs)');
            if (!leftFile) {
                return;
            }

            const rightFile = await this.selectFile('Select right file (yours)');
            if (!rightFile) {
                return;
            }

            await this.performThreeWayMerge(baseFile, leftFile, rightFile);
        } catch (error) {
            this.showErrorMessage('Error in three-way merge', error);
        }
    }

    public async compareTestFiles(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const sampleFiles = createJavaScriptSampleFilePair();
            const testFile1Path = path.join(workspaceFolder.uri.fsPath, sampleFiles.leftFileName);
            const testFile2Path = path.join(workspaceFolder.uri.fsPath, sampleFiles.rightFileName);

            fs.writeFileSync(testFile1Path, sampleFiles.leftContent);
            fs.writeFileSync(testFile2Path, sampleFiles.rightContent);

            vscode.window.showInformationMessage('Test files created. Comparing...');

            await this.compareFiles(
                vscode.Uri.file(testFile1Path),
                vscode.Uri.file(testFile2Path)
            );
        } catch (error) {
            this.showErrorMessage('Error creating test files', error);
        }
    }

    public async compareFileHistory(resource?: vscode.Uri): Promise<void> {
        try {
            const targetFile = this.resolveHistoryTarget(resource);
            if (!targetFile) {
                vscode.window.showErrorMessage('Select a file in the workspace to view its git history.');
                return;
            }

            const history = this.gitHistoryService.buildFileHistory(targetFile.fsPath);
            if (history.length === 0) {
                vscode.window.showWarningMessage('No git history with parents was found for that file.');
                return;
            }

            this.activeHistoryFile = targetFile;
            this.fileHistoryEntries = history;
            this.fileHistoryIndex = 0;

            await this.showCurrentHistoryEntry();
        } catch (error) {
            this.showErrorMessage('Error loading file history', error);
        }
    }

    public async selectAndCompareDirectories(): Promise<void> {
        try {
            const dir1 = await this.selectDirectory('Select left directory to compare');
            if (!dir1) {
                return;
            }

            const dir2 = await this.selectDirectory('Select right directory to compare');
            if (!dir2) {
                return;
            }

            await this.compareDirectories(dir1, dir2);
        } catch (error) {
            this.showErrorMessage('Error comparing directories', error);
        }
    }

    public async compareExplicitPaths(leftPath: string, rightPath: string): Promise<void> {
        try {
            await this.compareFiles(vscode.Uri.file(leftPath), vscode.Uri.file(rightPath));
        } catch (error) {
            this.showErrorMessage('Error comparing explicit paths', error);
        }
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

    private async selectDirectory(prompt: string): Promise<vscode.Uri | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Compare',
            title: prompt
        };

        const result = await vscode.window.showOpenDialog(options);
        return result?.[0];
    }

    private async compareDirectories(dir1: vscode.Uri, dir2: vscode.Uri): Promise<void> {
        const { leftText, rightText, directoryMap } = buildDirectoryDiffInput(dir1.fsPath, dir2.fsPath);
        const diffModel = buildTwoWayDiffModel(leftText, rightText);
        this.clearFileHistoryState();

        if (this.diffViewProvider) {
            this.diffViewProvider.showDirectoryDiff(dir1, dir2, leftText, rightText, diffModel, directoryMap);
        }
    }

    private async compareFiles(file1: vscode.Uri, file2: vscode.Uri): Promise<void> {
        const content1 = this.readFileContent(file1);
        const content2 = this.readFileContent(file2);
        const diffModel = buildTwoWayDiffModel(content1, content2);
        this.clearFileHistoryState();

        if (this.diffViewProvider) {
            this.diffViewProvider.showDiff(file1, file2, content1, content2, diffModel);
        } else {
            void openDiffPreview(file1, file2, diffModel);
        }
    }

    private async performThreeWayMerge(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri): Promise<void> {
        const baseContent = this.readFileContent(base);
        const leftContent = this.readFileContent(left);
        const rightContent = this.readFileContent(right);
        const mergeModel = mergeText(baseContent, leftContent, rightContent);

        if (this.diffViewProvider) {
            this.diffViewProvider.showThreeWayMerge(base, left, right, mergeModel);
        } else {
            void openMergePreview(base, left, right, mergeModel.resultLines.join('\n'));
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
        const historyEntryMeta = this.createHistoryEntryMeta(entry);

        await this.diffViewProvider.showHistoryDiff(
            this.activeHistoryFile,
            entry.leftLabel,
            entry.rightLabel,
            entry.leftContent,
            entry.rightContent,
            diffModel,
            historyEntryMeta
        );
    }

    private createHistoryEntryMeta(entry: FileHistoryEntry): HistoryViewState {
        return {
            canGoBack: this.fileHistoryIndex < this.fileHistoryEntries.length - 1,
            canGoForward: this.fileHistoryIndex > 0,
            positionLabel: `${this.fileHistoryIndex + 1} / ${this.fileHistoryEntries.length}`,
            leftCommitLabel: `${entry.parentCommit.slice(0, 7)} ${entry.parentSummary}`.trim(),
            leftTimestamp: entry.parentTimestamp,
            rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
            rightTimestamp: entry.timestamp
        };
    }

    private resolveHistoryTarget(resource?: vscode.Uri): vscode.Uri | undefined {
        const targetFile = resource ?? vscode.window.activeTextEditor?.document.uri;
        return targetFile?.scheme === 'file' ? targetFile : undefined;
    }

    private readFileContent(file: vscode.Uri): string {
        return fs.readFileSync(file.fsPath, 'utf8');
    }

    private clearFileHistoryState(): void {
        this.fileHistoryEntries = [];
        this.fileHistoryIndex = 0;
        this.activeHistoryFile = undefined;
    }

    private showErrorMessage(prefix: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${prefix}: ${detail}`);
    }
}
