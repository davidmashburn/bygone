import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DesktopIntent, serializeDesktopIntent } from './desktopIntent';

const standaloneDownloadUrl = vscode.Uri.parse('https://github.com/davidmashburn/bygone/releases/latest');

export async function launchDesktop(intent: DesktopIntent, resource?: vscode.Uri): Promise<boolean> {
    if (!vscode.workspace.isTrusted) {
        await vscode.window.showWarningMessage('Trust this workspace before handing repository paths to Bygone Desktop.');
        return false;
    }

    const cwd = await resolveWorkingDirectory(resource);
    if (!cwd) return false;
    const executable = vscode.workspace.getConfiguration('bygone').get<string>('desktopExecutable', '').trim();
    if (!executable) {
        const choice = await vscode.window.showInformationMessage(
            'Set bygone.desktopExecutable to hand this workflow to Bygone Desktop.',
            'Open Settings',
            'Open Downloads'
        );
        if (choice === 'Open Settings') {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'bygone.desktopExecutable');
        } else if (choice === 'Open Downloads') {
            await vscode.env.openExternal(standaloneDownloadUrl);
        }
        return false;
    }
    if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
        await vscode.window.showErrorMessage('bygone.desktopExecutable must be an existing absolute path.');
        return false;
    }

    try {
        const child = spawn(executable, serializeDesktopIntent(intent), {
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

export async function resolveWorkingDirectory(resource?: vscode.Uri): Promise<string | undefined> {
    const target = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (target?.scheme === 'file') {
        return vscode.workspace.getWorkspaceFolder(target)?.uri.fsPath ?? path.dirname(target.fsPath);
    }
    if (target && target.scheme !== 'file') {
        await vscode.window.showInformationMessage('Bygone Desktop cannot open paths from a remote or virtual workspace.');
        return undefined;
    }
    const localFolders = (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === 'file');
    if (localFolders.length === 1) return localFolders[0].uri.fsPath;
    if (localFolders.length > 1) {
        const selected = await vscode.window.showQuickPick(
            localFolders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
            { placeHolder: 'Select the workspace folder to open in Bygone Desktop' }
        );
        return selected?.folder.uri.fsPath;
    }
    await vscode.window.showInformationMessage('Bygone Desktop hand-off requires a local file or workspace folder.');
    return undefined;
}
