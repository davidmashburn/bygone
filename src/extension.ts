import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';
import { DiffViewProvider } from './diffViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Melden extension is now active!');
    console.log('Registering webview view provider...');

    const fileComparator = new FileComparator();
    const diffViewProvider = new DiffViewProvider(context.extensionUri);

    fileComparator.setDiffViewProvider(diffViewProvider);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, diffViewProvider)
    );

    const compareFilesCommand = vscode.commands.registerCommand('melden.compareFiles', () => {
        fileComparator.selectAndCompareFiles();
    });

    const compareWithSelectedCommand = vscode.commands.registerCommand('melden.compareWithSelected', (resource: vscode.Uri) => {
        fileComparator.compareWithSelected(resource);
    });

    const threeWayMergeCommand = vscode.commands.registerCommand('melden.threeWayMerge', () => {
        fileComparator.threeWayMerge();
    });

    const compareTestFilesCommand = vscode.commands.registerCommand('melden.compareTestFiles', () => {
        fileComparator.compareTestFiles();
    });

    const compareFileHistoryCommand = vscode.commands.registerCommand('melden.compareFileHistory', (resource?: vscode.Uri) => {
        fileComparator.compareFileHistory(resource);
    });

    const compareActiveFileHistoryCommand = vscode.commands.registerCommand('melden.compareActiveFileHistory', () => {
        fileComparator.compareFileHistory();
    });

    context.subscriptions.push(
        compareFilesCommand,
        compareWithSelectedCommand,
        threeWayMergeCommand,
        compareTestFilesCommand,
        compareFileHistoryCommand,
        compareActiveFileHistoryCommand
    );
}

export function deactivate() {}
