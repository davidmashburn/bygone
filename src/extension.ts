import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';
import { DiffViewProvider } from './diffViewProvider';
import { MeldenUriHandler } from './uriHandler';

export function activate(context: vscode.ExtensionContext) {
    const fileComparator = new FileComparator();
    const diffViewProvider = new DiffViewProvider(context.extensionUri);
    const uriHandler = new MeldenUriHandler(fileComparator);
    const standaloneDownloadUrl = vscode.Uri.parse('https://github.com/davidmashburn/melden/releases');

    fileComparator.setDiffViewProvider(diffViewProvider);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, diffViewProvider),
        vscode.window.registerUriHandler(uriHandler),
        registerCommand('melden.compareFiles', () => fileComparator.selectAndCompareFiles()),
        registerCommand('melden.compareWithSelected', (resource: vscode.Uri) => fileComparator.compareWithSelected(resource)),
        registerCommand('melden.threeWayMerge', () => fileComparator.threeWayMerge()),
        registerCommand('melden.compareTestFiles', () => fileComparator.compareTestFiles()),
        registerCommand('melden.compareFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('melden.compareActiveFileHistory', () => fileComparator.compareFileHistory()),
        registerCommand('melden.openStandaloneDownloads', () => vscode.env.openExternal(standaloneDownloadUrl))
    );
}

export function deactivate() {}

function registerCommand<TArgs extends unknown[]>(command: string, callback: (...args: TArgs) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(command, callback);
}
