import * as vscode from 'vscode';
import * as path from 'path';
import { ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';

export class DiffViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'melden.diffView';
    private static readonly containerCommand = 'workbench.view.extension.meldendiff';
    private view?: vscode.WebviewView;
    private isReady = false;
    private pendingMessage: unknown;

    constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.view = webviewView;
        this.isReady = false;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.onDidReceiveMessage((message) => {
            if (message?.type === 'ready') {
                this.isReady = true;

                if (this.pendingMessage) {
                    void webviewView.webview.postMessage(this.pendingMessage);
                    this.pendingMessage = undefined;
                }
            }
        });
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    }

    public async showDiff(file1: vscode.Uri, file2: vscode.Uri, diffModel: TwoWayDiffModel) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showWarningMessage('Melden view is unavailable. Opening the diff in a text tab instead.');
            this.showDiffInNewTab(file1, file2, diffModel);
            return;
        }

        this.postOrQueueMessage({
            type: 'showDiff',
            file1: path.basename(file1.path),
            file2: path.basename(file2.path),
            diffModel
        });
    }

    public async showThreeWayMerge(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri, mergeModel: ThreeWayMergeModel) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showErrorMessage('Melden view is unavailable');
            return;
        }

        this.postOrQueueMessage({
            type: 'showThreeWayMerge',
            base: {
                name: path.basename(base.path),
                lines: mergeModel.baseLines
            },
            left: {
                name: path.basename(left.path),
                lines: mergeModel.leftLines
            },
            right: {
                name: path.basename(right.path),
                lines: mergeModel.rightLines
            },
            result: {
                name: mergeModel.conflictCount > 0 ? `Result (${mergeModel.conflictCount} conflicts)` : 'Result',
                lines: mergeModel.resultLines
            },
            meta: {
                isExperimental: mergeModel.isExperimental,
                conflictCount: mergeModel.conflictCount
            }
        });
    }

    private showDiffInNewTab(file1: vscode.Uri, file2: vscode.Uri, diffModel: TwoWayDiffModel): void {
        const renderCell = (content: string) => content.length === 0 ? '(empty)' : content;
        const document = `
# Diff: ${path.basename(file1.path)} ↔ ${path.basename(file2.path)}

\`\`\`text
${diffModel.rows.map((row) => `${renderCell(row.left.content)}    |    ${renderCell(row.right.content)}`).join('\n')}
\`\`\`
        `;

        vscode.workspace.openTextDocument({
            content: document,
            language: 'markdown'
        }).then((doc) => {
            vscode.window.showTextDocument(doc);
        });
    }

    private async revealView(): Promise<vscode.WebviewView | undefined> {
        if (this.view) {
            return this.view;
        }

        await vscode.commands.executeCommand(DiffViewProvider.containerCommand);

        return this.view;
    }

    private postOrQueueMessage(message: unknown): void {
        if (!this.view) {
            return;
        }

        if (!this.isReady) {
            this.pendingMessage = message;
            return;
        }

        void this.view.webview.postMessage(message);
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'script.js'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Melden Diff View</title>
</head>
<body>
    <div id="container">
        <div id="header">
            <h1>Melden</h1>
            <div id="file-info">Choose a compare command to render a diff.</div>
            <div id="status-banner" class="status-banner" hidden></div>
        </div>
        <div id="diff-container">
            <div id="two-way-diff" class="diff-view">
                <div class="file-panel">
                    <div id="file1-header" class="file-header">File 1</div>
                    <div id="file1-content" class="file-content"></div>
                </div>
                <div class="file-panel">
                    <div id="file2-header" class="file-header">File 2</div>
                    <div id="file2-content" class="file-content"></div>
                </div>
            </div>
            <div id="three-way-diff" class="diff-view hidden">
                <div class="file-panel">
                    <div id="base-header" class="file-header">Base</div>
                    <div id="base-content" class="file-content"></div>
                </div>
                <div class="file-panel">
                    <div id="left-header" class="file-header">Left</div>
                    <div id="left-content" class="file-content"></div>
                </div>
                <div class="file-panel">
                    <div id="right-header" class="file-header">Right</div>
                    <div id="right-content" class="file-content"></div>
                </div>
                <div class="file-panel">
                    <div id="result-header" class="file-header">Result</div>
                    <div id="result-content" class="file-content"></div>
                </div>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
