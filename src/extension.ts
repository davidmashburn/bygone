import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';
import { DiffViewProvider } from './diffViewProvider';

export function activate(context: vscode.ExtensionContext) {
    const fileComparator = new FileComparator();
    const diffViewProvider = new DiffViewProvider(context.extensionUri);

    fileComparator.setDiffViewProvider(diffViewProvider);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, diffViewProvider),
        registerCommand('melden.compareFiles', () => fileComparator.selectAndCompareFiles()),
        registerCommand('melden.compareWithSelected', (resource: vscode.Uri) => fileComparator.compareWithSelected(resource)),
        registerCommand('melden.threeWayMerge', () => fileComparator.threeWayMerge()),
        registerCommand('melden.compareTestFiles', () => fileComparator.compareTestFiles()),
        registerCommand('melden.compareFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('melden.compareActiveFileHistory', () => fileComparator.compareFileHistory())
    );
}

export function deactivate() {}

function registerCommand<TArgs extends unknown[]>(command: string, callback: (...args: TArgs) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(command, callback);
}
