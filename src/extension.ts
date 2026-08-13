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
        diffViewProvider,
        vscode.window.registerWebviewPanelSerializer(DiffViewProvider.viewType, diffViewProvider),
        vscode.window.registerUriHandler(uriHandler),
        registerCommand('bygone.compareFiles', () => fileComparator.compareActiveFileWith()),
        registerCommand('bygone.compareSelectedFiles', (resource?: vscode.Uri, resources?: vscode.Uri[]) => (
            fileComparator.compareSelectedFiles(resources?.length ? resources : resource ? [resource] : [])
        )),
        registerCommand('bygone.compareDirectoriesInDesktop', () => pickPathsAndLaunchDesktop('directories')),
        registerCommand('bygone.compareMultipleFilesInDesktop', () => pickPathsAndLaunchDesktop('files')),
        registerCommand('bygone.compareWithSelected', (resource?: vscode.Uri) => fileComparator.compareWithSelected(resource)),
        registerCommand('bygone.cancelCompareSelection', () => fileComparator.cancelCompareSelection()),
        registerCommand('bygone.compareFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('bygone.compareActiveFileHistory', (resource?: vscode.Uri) => fileComparator.compareFileHistory(resource)),
        registerCommand('bygone.exploreBranchInDesktop', (resource?: vscode.Uri) => launchDesktop({ kind: 'explore-branch' }, resource)),
        registerCommand('bygone.presentBranchInDesktop', (resource?: vscode.Uri) => launchDesktop({ kind: 'present-branch' }, resource)),
        registerCommand('bygone.openTourInDesktop', async () => {
            const selected = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Bygone presentations': ['bygone', 'yaml', 'yml'] },
                openLabel: 'Open in Bygone Desktop'
            });
            const tour = selected?.[0];
            return tour ? launchDesktop({ kind: 'open-tour', tourPath: tour.fsPath }, tour) : false;
        }),
        registerCommand('bygone.openComparisonInDesktop', () => {
            const uris = diffViewProvider.getActiveFileComparisonUris();
            if (!uris || uris.some((uri) => uri.scheme !== 'file')) {
                return vscode.window.showInformationMessage('The active Bygone tab is not a local file comparison.');
            }
            return launchDesktop({ kind: 'compare-paths', paths: uris.map((uri) => uri.fsPath) }, uris[0]);
        }),
        registerCommand('bygone.openStandaloneDownloads', () => vscode.env.openExternal(standaloneDownloadUrl))
    );
}

export function deactivate() {}

function registerCommand<TArgs extends unknown[]>(command: string, callback: (...args: TArgs) => unknown): vscode.Disposable {
    return vscode.commands.registerCommand(command, callback);
}

async function pickPathsAndLaunchDesktop(kind: 'files' | 'directories'): Promise<boolean> {
    const selected = await vscode.window.showOpenDialog({
        canSelectFiles: kind === 'files',
        canSelectFolders: kind === 'directories',
        canSelectMany: true,
        openLabel: 'Open in Bygone Desktop',
        title: kind === 'files' ? 'Select three or more files' : 'Select two or more directories'
    });
    const minimum = kind === 'files' ? 3 : 2;
    if (!selected) return false;
    if (selected.length < minimum) {
        await vscode.window.showInformationMessage(
            kind === 'files'
                ? 'Select three or more files for a desktop multi-panel comparison.'
                : 'Select two or more directories for a desktop comparison.'
        );
        return false;
    }
    if (selected.some((uri) => uri.scheme !== 'file')) {
        await vscode.window.showInformationMessage('Bygone Desktop can open only local filesystem paths.');
        return false;
    }
    return launchDesktop({ kind: 'compare-paths', paths: selected.map((uri) => uri.fsPath) }, selected[0]);
}
