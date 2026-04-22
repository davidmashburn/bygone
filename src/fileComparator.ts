import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffViewProvider } from './diffViewProvider';
import { buildTwoWayDiffModel } from './diffEngine';
import { buildMultiDirectoryComparison, DirectoryEntry } from './directoryDiff';
import { openDiffPreview } from './fallbackViews';
import { FileHistoryEntry, GitHistoryService } from './gitHistory';
import { createJavaScriptSampleFilePair } from './sampleFiles';
import { HistoryViewState } from './webviewMessages';

export class FileComparator {
    private selectedFile: vscode.Uri | undefined;
    private diffViewProvider: DiffViewProvider | undefined;
    private fileHistoryEntries: FileHistoryEntry[] = [];
    private fileHistoryIndex = 0;
    private activeHistoryFile: vscode.Uri | undefined;
    private currentDirectoryRoots: vscode.Uri[] = [];
    private currentDirectoryEntries: DirectoryEntry[] = [];
    private currentDirectoryRelativePath: string | undefined;
    private readonly gitHistoryService = new GitHistoryService();

    public setDiffViewProvider(provider: DiffViewProvider) {
        this.diffViewProvider = provider;
        this.diffViewProvider.setHistoryNavigationHandler((direction) => {
            void this.navigateFileHistory(direction);
        });
        this.diffViewProvider.setDirectoryEntryOpenHandler((relativePath) => {
            void this.openDirectoryEntry(relativePath);
        });
        this.diffViewProvider.setDirectoryEntryNavigationHandler((direction) => {
            void this.navigateDirectoryEntry(direction);
        });
        this.diffViewProvider.setReturnToDirectoryHandler(() => {
            void this.returnToDirectoryView();
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

    public async compareThreeFiles(): Promise<void> {
        try {
            const files = await this.selectFiles('Select three files to compare', 3);
            if (!files) {
                return;
            }

            await this.compareMultipleFiles(files);
        } catch (error) {
            this.showErrorMessage('Error comparing three files', error);
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
            const leftDir = await this.selectDirectory('Select left directory to compare');
            if (!leftDir) {
                return;
            }

            const rightDir = await this.selectDirectory('Select right directory to compare');
            if (!rightDir) {
                return;
            }

            await this.compareDirectories([leftDir, rightDir]);
        } catch (error) {
            this.showErrorMessage('Error comparing directories', error);
        }
    }

    public async selectAndCompareThreeDirectories(): Promise<void> {
        try {
            const dirs = await this.selectDirectories('Select three directories to compare', 3);
            if (!dirs) {
                return;
            }

            await this.compareDirectories(dirs);
        } catch (error) {
            this.showErrorMessage('Error comparing three directories', error);
        }
    }

    public async compareExplicitPaths(leftPath: string, rightPath: string): Promise<void> {
        try {
            const leftKind = this.getPathKind(leftPath);
            const rightKind = this.getPathKind(rightPath);

            if (leftKind === 'file' && rightKind === 'file') {
                await this.compareFiles(vscode.Uri.file(leftPath), vscode.Uri.file(rightPath));
                return;
            }

            if (leftKind === 'directory' && rightKind === 'directory') {
                await this.compareDirectories([vscode.Uri.file(leftPath), vscode.Uri.file(rightPath)]);
                return;
            }

            throw new Error('Both paths must be files or both must be directories.');
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

    private async selectFiles(prompt: string, count: number): Promise<vscode.Uri[] | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: 'Compare',
            title: prompt
        };

        const files = await vscode.window.showOpenDialog(options);
        return files && files.length === count ? files : undefined;
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

    private async selectDirectories(prompt: string, count: number): Promise<vscode.Uri[] | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Compare',
            title: prompt
        };

        const dirs = await vscode.window.showOpenDialog(options);
        return dirs && dirs.length === count ? dirs : undefined;
    }

    private async compareDirectories(dirs: vscode.Uri[]): Promise<void> {
        const entries = buildMultiDirectoryComparison(dirs.map((dir) => dir.fsPath));
        this.currentDirectoryRoots = dirs;
        this.currentDirectoryEntries = entries;
        this.currentDirectoryRelativePath = undefined;
        this.clearFileHistoryState();

        if (this.diffViewProvider) {
            this.diffViewProvider.showDirectoryDiff(dirs, entries);
        }
    }

    private async compareFiles(file1: vscode.Uri, file2: vscode.Uri, canReturnToDirectory = false): Promise<void> {
        const content1 = this.readFileContent(file1);
        const content2 = this.readFileContent(file2);
        const diffModel = buildTwoWayDiffModel(content1, content2);
        this.clearFileHistoryState();
        if (!canReturnToDirectory) {
            this.currentDirectoryRelativePath = undefined;
        }

        if (this.diffViewProvider) {
            this.diffViewProvider.showDiff(file1, file2, content1, content2, diffModel, canReturnToDirectory);
        } else {
            void openDiffPreview(file1, file2, diffModel);
        }
    }

    private async compareMultipleFiles(files: vscode.Uri[]): Promise<void> {
        this.clearFileHistoryState();

        if (this.diffViewProvider) {
            await this.diffViewProvider.showMultiDiff(files.map((uri) => ({
                uri,
                content: this.readFileContent(uri)
            })));
        }
    }

    private async openDirectoryEntry(relativePath: string): Promise<void> {
        if (this.currentDirectoryRoots.length < 2 || relativePath.endsWith('/')) {
            return;
        }

        const files = this.currentDirectoryRoots
            .map((root) => vscode.Uri.file(path.join(root.fsPath, relativePath)))
            .filter((uri) => this.getPathKind(uri.fsPath) === 'file');

        if (files.length < 2) {
            vscode.window.showInformationMessage('That entry only exists on one side.');
            return;
        }

        this.currentDirectoryRelativePath = relativePath;
        if (files.length === 2) {
            await this.compareFiles(files[0], files[1], true);
            return;
        }

        await this.compareMultipleFiles(files);
    }

    private async navigateDirectoryEntry(direction: 'previous' | 'next'): Promise<void> {
        if (this.currentDirectoryRoots.length < 2 || this.currentDirectoryEntries.length === 0) {
            return;
        }

        const changedFilePaths = this.currentDirectoryEntries
            .filter((entry) => !entry.isDirectory && entry.status !== 'same' && entry.sides.filter(Boolean).length >= 2)
            .map((entry) => entry.relativePath);
        if (changedFilePaths.length === 0) {
            return;
        }

        const currentIndex = this.currentDirectoryRelativePath
            ? changedFilePaths.indexOf(this.currentDirectoryRelativePath)
            : -1;
        const step = direction === 'next' ? 1 : -1;
        const startIndex = currentIndex >= 0
            ? currentIndex
            : (direction === 'next' ? -1 : 0);
        const nextIndex = (startIndex + step + changedFilePaths.length) % changedFilePaths.length;
        const nextRelativePath = changedFilePaths[nextIndex];
        if (!nextRelativePath) {
            return;
        }

        await this.openDirectoryEntry(nextRelativePath);
    }

    private async returnToDirectoryView(): Promise<void> {
        if (this.currentDirectoryRoots.length < 2 || !this.diffViewProvider) {
            return;
        }

        const entries = buildMultiDirectoryComparison(this.currentDirectoryRoots.map((dir) => dir.fsPath));
        this.currentDirectoryEntries = entries;
        this.currentDirectoryRelativePath = undefined;
        await this.diffViewProvider.showDirectoryDiff(this.currentDirectoryRoots, entries);
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

    private getPathKind(fsPath: string): 'file' | 'directory' | 'missing' {
        try {
            const stats = fs.statSync(fsPath);
            if (stats.isFile()) {
                return 'file';
            }

            if (stats.isDirectory()) {
                return 'directory';
            }
        } catch {
            return 'missing';
        }

        return 'missing';
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
