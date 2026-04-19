import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';
import { DiffViewProvider } from './diffViewProvider';
import { BygoneUriHandler } from './uriHandler';

export function activate(context: vscode.ExtensionContext) {
    const fileComparator = new FileComparator();
    const diffViewProvider = new DiffViewProvider(context.extensionUri);
    const uriHandler = new BygoneUriHandler(fileComparator);
    const standaloneDownloadUrl = vscode.Uri.parse('https://github.com/davidmashburn/bygone/releases');

    fileComparator.setDiffViewProvider(diffViewProvider);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, diffViewProvider),
        vscode.window.registerUriHandler(uriHandler),
        registerCommand('bygone.compareFiles', () => fileComparator.selectAndCompareFiles()),
        registerCommand('bygone.compareDirectories', () => fileComparator.selectAndCompareDirectories()),
        registerCommand('bygone.compareThreeFiles', () => fileComparator.compareThreeFiles()),
        registerCommand('bygone.compareWithSelected', (resource: vscode.Uri) => fileComparator.compareWithSelected(resource)),
        registerCommand('bygone.compareTestFiles', () => fileComparator.compareTestFiles()),
        registerCommand('bygone.compareFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('bygone.compareActiveFileHistory', () => fileComparator.compareFileHistory()),
        registerCommand('bygone.openStandaloneDownloads', () => vscode.env.openExternal(standaloneDownloadUrl))
    );
}

export function deactivate() {}

function registerCommand<TArgs extends unknown[]>(command: string, callback: (...args: TArgs) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(command, callback);
}
