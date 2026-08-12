import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const standaloneDownloadUrl = vscode.Uri.parse('https://github.com/davidmashburn/bygone/releases/latest');

export async function launchDesktop(args: string[], resource?: vscode.Uri): Promise<boolean> {
    const executable = vscode.workspace.getConfiguration('bygone').get<string>('desktopExecutable', '').trim();
    if (!executable) {
        const choice = await vscode.window.showInformationMessage(
            'Set bygone.desktopExecutable to hand this workflow to Bygone Desktop.',
            'Open Downloads'
        );
        if (choice === 'Open Downloads') {
            await vscode.env.openExternal(standaloneDownloadUrl);
        }
        return false;
    }

    const cwd = resolveWorkingDirectory(resource);
    try {
        const child = spawn(executable, args, {
            cwd,
            detached: true,
            stdio: 'ignore',
            shell: false
        });
        child.once('error', (error) => {
            void vscode.window.showErrorMessage(`Could not open Bygone Desktop: ${error.message}`);
        });
        child.unref();
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Could not open Bygone Desktop: ${message}`);
        return false;
    }
}

export function resolveWorkingDirectory(resource?: vscode.Uri): string | undefined {
    const target = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (target?.scheme === 'file') {
        return vscode.workspace.getWorkspaceFolder(target)?.uri.fsPath ?? path.dirname(target.fsPath);
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
