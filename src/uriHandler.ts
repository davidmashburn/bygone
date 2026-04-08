import * as vscode from 'vscode';
import { FileComparator } from './fileComparator';

export class MeldenUriHandler implements vscode.UriHandler {
    constructor(private readonly fileComparator: FileComparator) {}

    public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
        if (uri.path !== '/diff') {
            return;
        }

        const params = new URLSearchParams(uri.query);
        const leftPath = params.get('left');
        const rightPath = params.get('right');

        if (!leftPath || !rightPath) {
            vscode.window.showErrorMessage('Melden URI is missing left/right file parameters.');
            return;
        }

        void this.fileComparator.compareExplicitPaths(leftPath, rightPath);
    }
}
