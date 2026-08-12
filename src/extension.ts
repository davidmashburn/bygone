import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';
import { DiffViewProvider } from './diffViewProvider';
import { BygoneUriHandler } from './uriHandler';
import { launchDesktop } from './desktopLauncher';

export function activate(context: vscode.ExtensionContext) {
    const fileComparator = new FileComparator();
    const diffViewProvider = new DiffViewProvider(context.extensionUri);
    const uriHandler = new BygoneUriHandler(fileComparator);
    const standaloneDownloadUrl = vscode.Uri.parse('https://github.com/davidmashburn/bygone/releases');

    fileComparator.setDiffViewProvider(diffViewProvider);

    context.subscriptions.push(
        fileComparator,
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, diffViewProvider),
        vscode.window.registerUriHandler(uriHandler),
        registerCommand('bygone.compareFiles', () => fileComparator.selectAndCompareFiles()),
        registerCommand('bygone.compareDirectories', () => fileComparator.selectAndCompareDirectories()),
        registerCommand('bygone.compareMultipleDirectories', () => fileComparator.compareMultipleDirectoriesCommand()),
        registerCommand('bygone.compareMultipleFiles', () => fileComparator.compareMultipleFilesCommand()),
        registerCommand('bygone.compareWithSelected', (resource: vscode.Uri) => fileComparator.compareWithSelected(resource)),
        registerCommand('bygone.compareFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('bygone.compareActiveFileHistory', () => fileComparator.compareFileHistory()),
        registerCommand('bygone.reviewBranch', () => fileComparator.reviewCurrentBranch()),
        registerCommand('bygone.exploreBranchInDesktop', (resource?: vscode.Uri) => launchDesktop(['review'], resource)),
        registerCommand('bygone.presentBranchInDesktop', (resource?: vscode.Uri) => launchDesktop(['present'], resource)),
        registerCommand('bygone.openTourInDesktop', async () => {
            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Bygone tours': ['yaml', 'yml'] },
                openLabel: 'Open in Bygone Desktop'
            });
            const tour = selected?.[0];
            return tour ? launchDesktop(['present', '--tour', tour.fsPath], tour) : false;
        }),
        registerCommand('bygone.openStandaloneDownloads', () => vscode.env.openExternal(standaloneDownloadUrl))
    );
}

export function deactivate() {}

function registerCommand<TArgs extends unknown[]>(command: string, callback: (...args: TArgs) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(command, callback);
}
