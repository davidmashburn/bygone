import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffViewProvider } from './diffViewProvider';
import { buildTwoWayDiffModel } from './diffEngine';
import { buildMultiDirectoryComparison, DirectoryEntry } from './directoryDiff';
import { openDiffPreview } from './fallbackViews';
import { FileHistoryEntry, GitHistoryService } from './gitHistory';
import { createJavaScriptSampleFilePair } from './sampleFiles';
import { HistoryRailItem, HistoryRailState, HistoryViewState } from './webviewMessages';

export class FileComparator {
    private selectedFile: vscode.Uri | undefined;
    private diffViewProvider: DiffViewProvider | undefined;
    private fileHistoryEntries: FileHistoryEntry[] = [];
    private fileHistoryIndex = 0;
    private activeHistoryFile: vscode.Uri | undefined;
    private historyIncludeStaged = false;
    private historySkipUnchanged = false;
    private currentDirectoryRoots: vscode.Uri[] = [];
    private currentDirectoryEntries: DirectoryEntry[] = [];
    private currentDirectoryRelativePath: string | undefined;
    private readonly gitHistoryService = new GitHistoryService();

    public setDiffViewProvider(provider: DiffViewProvider) {
        this.diffViewProvider = provider;
        this.diffViewProvider.setHistoryNavigationHandler((direction) => {
            void this.navigateFileHistory(direction);
        });
        this.diffViewProvider.setHistoryStagedToggleHandler((includeStaged) => {
            void this.toggleHistoryStaged(includeStaged);
        });
        this.diffViewProvider.setHistorySkipUnchangedToggleHandler((skipUnchanged) => {
            void this.toggleHistorySkipUnchanged(skipUnchanged);
        });
        this.diffViewProvider.setHistorySelectionHandler((index) => {
            void this.selectFileHistoryEntry(index);
        });
        this.diffViewProvider.setDirectoryEntryOpenHandler((relativePath) => {
            void this.openDirectoryEntry(relativePath);
        });
        this.diffViewProvider.setFileNavigationHandler((direction) => {
            void this.navigateCurrentFile(direction);
        });
        this.diffViewProvider.setDirectoryReturnHandler(() => {
            void this.returnToCurrentDirectory();
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

    public async compareMultipleFilesCommand(): Promise<void> {
        try {
            const files = await this.selectFiles('Select files to compare', 1);
            if (!files) {
                return;
            }

            if (files.length === 1) {
                await this.loadFileHistory(files[0], this.historyIncludeStaged);
                return;
            }

            if (files.length === 2) {
                await this.compareFiles(files[0], files[1]);
                return;
            }

            await this.compareMultipleFiles(files);
        } catch (error) {
            this.showErrorMessage('Error comparing files', error);
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

            await this.loadFileHistory(targetFile, this.historyIncludeStaged);
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

    public async compareMultipleDirectoriesCommand(): Promise<void> {
        try {
            const dirs = await this.selectDirectories('Select directories to compare', 2);
            if (!dirs) {
                return;
            }

            await this.compareDirectories(dirs);
        } catch (error) {
            this.showErrorMessage('Error comparing directories', error);
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

    private async selectFiles(prompt: string, minCount: number): Promise<vscode.Uri[] | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            openLabel: 'Compare',
            title: prompt
        };

        const files = await vscode.window.showOpenDialog(options);
        return files && files.length >= minCount ? files : undefined;
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

    private async selectDirectories(prompt: string, minCount: number): Promise<vscode.Uri[] | undefined> {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: true,
            canSelectFolders: true,
            canSelectFiles: false,
            openLabel: 'Compare',
            title: prompt
        };

        const dirs = await vscode.window.showOpenDialog(options);
        return dirs && dirs.length >= minCount ? dirs : undefined;
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

    private async compareFiles(file1: vscode.Uri, file2: vscode.Uri): Promise<void> {
        const content1 = this.readFileContent(file1);
        const content2 = this.readFileContent(file2);
        const diffModel = buildTwoWayDiffModel(content1, content2);
        this.clearFileHistoryState();
        this.clearDirectoryContext();

        if (this.diffViewProvider) {
            this.diffViewProvider.showDiff(file1, file2, content1, content2, diffModel);
        } else {
            void openDiffPreview(file1, file2, diffModel);
        }
    }

    private async compareMultipleFiles(files: vscode.Uri[]): Promise<void> {
        this.clearFileHistoryState();
        this.clearDirectoryContext();

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
            .map((root) => vscode.Uri.file(path.join(root.fsPath, relativePath)));

        if (!files.some((uri) => this.getPathKind(uri.fsPath) === 'file')) {
            vscode.window.showInformationMessage('That entry does not exist in the selected directories.');
            return;
        }

        this.currentDirectoryRelativePath = relativePath;
        const directoryContext = this.createDirectoryDrilldownContext(relativePath);
        const directoryLabels = this.currentDirectoryRoots.map((root) => `${path.basename(root.fsPath)} / ${relativePath}`);

        if (files.length === 2) {
            const leftContent = this.getPathKind(files[0].fsPath) === 'file' ? this.readFileContent(files[0]) : '';
            const rightContent = this.getPathKind(files[1].fsPath) === 'file' ? this.readFileContent(files[1]) : '';
            await this.diffViewProvider?.showDiff(
                files[0],
                files[1],
                leftContent,
                rightContent,
                buildTwoWayDiffModel(leftContent, rightContent),
                { ...directoryContext, labels: [directoryLabels[0], directoryLabels[1]] }
            );
            return;
        }

        await this.diffViewProvider?.showMultiDiff(files.map((uri, index) => ({
            uri,
            content: this.getPathKind(uri.fsPath) === 'file' ? this.readFileContent(uri) : '',
            label: directoryLabels[index]
        })), directoryContext);
    }

    private createDirectoryDrilldownContext(relativePath: string) {
        const files = this.currentDirectoryEntries.filter((entry) => !entry.isDirectory && entry.status !== 'same');
        const currentIndex = files.findIndex((entry) => entry.relativePath === relativePath);
        return {
            canReturnToDirectory: true,
            fileNavigation: {
                canGoPrevious: currentIndex > 0,
                canGoNext: currentIndex >= 0 && currentIndex < files.length - 1
            },
            directoryNavigation: {
                activeRelativePath: relativePath,
                rail: {
                    activeTabId: 'directory-files',
                    tabs: [{ id: 'directory-files', label: 'Files' }],
                    itemsByTab: {
                        'directory-files': files.map((entry) => ({
                            label: entry.relativePath,
                            status: entry.status,
                            kind: 'directory-entry' as const,
                            relativePath: entry.relativePath,
                            active: entry.relativePath === relativePath
                        }))
                    }
                }
            }
        };
    }

    private async navigateCurrentFile(direction: 'previous' | 'next'): Promise<void> {
        if (!this.currentDirectoryRelativePath) {
            return;
        }

        const files = this.currentDirectoryEntries.filter((entry) => !entry.isDirectory && entry.status !== 'same');
        const currentIndex = files.findIndex((entry) => entry.relativePath === this.currentDirectoryRelativePath);
        const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
        const next = files[nextIndex];
        if (next) {
            await this.openDirectoryEntry(next.relativePath);
        }
    }

    private async returnToCurrentDirectory(): Promise<void> {
        if (this.currentDirectoryRoots.length >= 2) {
            await this.compareDirectories(this.currentDirectoryRoots);
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
        const leftCommitLabel = entry.parentCommit
            ? `${entry.parentCommit.slice(0, 7)} ${entry.parentSummary}`.trim()
            : entry.parentSummary;
        const rail = this.buildHistoryRail();

        return {
            canGoBack: this.fileHistoryIndex < this.fileHistoryEntries.length - 1,
            canGoForward: this.fileHistoryIndex > 0,
            positionLabel: `${this.fileHistoryIndex + 1} / ${this.fileHistoryEntries.length}`,
            leftCommitLabel,
            leftTimestamp: entry.parentTimestamp,
            rightCommitLabel: `${entry.shortCommit} ${entry.summary}`.trim(),
            rightTimestamp: entry.timestamp,
            includeStaged: this.historyIncludeStaged,
            skipUnchanged: this.historySkipUnchanged,
            rail
        };
    }

    private buildHistoryRail(): HistoryRailState | undefined {
        if (this.fileHistoryEntries.length === 0) {
            return undefined;
        }

        const items: HistoryRailItem[] = this.fileHistoryEntries.map((historyEntry, index) => ({
            label: `${historyEntry.shortCommit} ${historyEntry.summary}`.trim() || historyEntry.shortCommit,
            meta: historyEntry.timestamp,
            active: index === this.fileHistoryIndex,
            kind: 'history-entry',
            index
        }));

        return {
            activeTabId: 'history',
            tabs: [{ id: 'history', label: 'History' }],
            itemsByTab: {
                history: items
            }
        };
    }

    private async selectFileHistoryEntry(index: number): Promise<void> {
        if (index < 0 || index >= this.fileHistoryEntries.length || index === this.fileHistoryIndex) {
            return;
        }

        this.fileHistoryIndex = index;
        await this.showCurrentHistoryEntry();
    }

    private async toggleHistoryStaged(includeStaged: boolean): Promise<void> {
        if (!this.activeHistoryFile || this.historyIncludeStaged === includeStaged) {
            return;
        }

        await this.loadFileHistory(this.activeHistoryFile, includeStaged);
    }

    private async toggleHistorySkipUnchanged(skipUnchanged: boolean): Promise<void> {
        if (this.historySkipUnchanged === skipUnchanged) {
            return;
        }

        this.historySkipUnchanged = skipUnchanged;
        await this.showCurrentHistoryEntry();
    }

    private async loadFileHistory(targetFile: vscode.Uri, includeStaged: boolean): Promise<void> {
        const history = this.gitHistoryService.buildFileHistory(targetFile.fsPath, includeStaged);
        if (history.length === 0) {
            vscode.window.showWarningMessage('No git history with parents was found for that file.');
            return;
        }

        this.clearDirectoryContext();
        this.activeHistoryFile = targetFile;
        this.historyIncludeStaged = includeStaged;
        this.fileHistoryEntries = history;
        this.fileHistoryIndex = 0;

        await this.showCurrentHistoryEntry();
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

    private clearDirectoryContext(): void {
        this.currentDirectoryRoots = [];
        this.currentDirectoryEntries = [];
        this.currentDirectoryRelativePath = undefined;
    }

    private showErrorMessage(prefix: string, error: unknown): void {
        const detail = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${prefix}: ${detail}`);
    }
}
