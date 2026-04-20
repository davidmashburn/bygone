import * as vscode from 'vscode';
import * as path from 'path';
import { buildTwoWayDiffModel, ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';
import { openDiffPreview } from './fallbackViews';
import {
    DirectoryEntry,
    HistoryViewState,
    isHistoryNavigationMessage,
    isOpenDirectoryEntryMessage,
    isReadyMessage,
    isRecomputeDiffMessage,
    ShowDiffMessage,
    ShowDirectoryDiffMessage,
    ShowMultiDiffMessage,
    ShowThreeWayMergeMessage,
    WebviewOutboundMessage
} from './webviewMessages';

export class DiffViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'bygone.diffView';
    private static readonly containerCommand = 'workbench.view.extension.bygonediff';
    private view?: vscode.WebviewView;
    private isReady = false;
    private pendingMessage?: WebviewOutboundMessage;
    private currentMessage?: WebviewOutboundMessage;
    private currentTwoWayDiff?: {
        file1: string;
        file2: string;
    };
    private historyNavigationHandler?: (direction: 'back' | 'forward') => void;
    private directoryEntryOpenHandler?: (relativePath: string) => void;

    constructor(private readonly extensionUri: vscode.Uri) {}

    public setHistoryNavigationHandler(handler: (direction: 'back' | 'forward') => void): void {
        this.historyNavigationHandler = handler;
    }

    public setDirectoryEntryOpenHandler(handler: (relativePath: string) => void): void {
        this.directoryEntryOpenHandler = handler;
    }

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
            if (isReadyMessage(message)) {
                this.isReady = true;

                if (this.pendingMessage) {
                    void webviewView.webview.postMessage(this.pendingMessage);
                    this.pendingMessage = undefined;
                } else if (this.currentMessage) {
                    void webviewView.webview.postMessage(this.currentMessage);
                }
            }

            if (isRecomputeDiffMessage(message)) {
                this.handleRecomputeDiff(message.leftContent, message.rightContent);
            }

            if (isHistoryNavigationMessage(message) && this.historyNavigationHandler) {
                this.historyNavigationHandler(message.type === 'historyBack' ? 'back' : 'forward');
            }

            if (isOpenDirectoryEntryMessage(message) && this.directoryEntryOpenHandler) {
                this.directoryEntryOpenHandler(message.relativePath);
            }
        });
        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    }

    public async showDiff(file1: vscode.Uri, file2: vscode.Uri, leftContent: string, rightContent: string, diffModel: TwoWayDiffModel) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showWarningMessage('Bygone view is unavailable. Opening the diff in a text tab instead.');
            void openDiffPreview(file1, file2, diffModel);
            return;
        }

        this.currentTwoWayDiff = {
            file1: path.basename(file1.path),
            file2: path.basename(file2.path)
        };

        this.postOrQueueDiffMessage({
            file1: this.currentTwoWayDiff.file1,
            file2: this.currentTwoWayDiff.file2,
            leftContent,
            rightContent,
            diffModel,
            history: null
        });
    }

    public async showHistoryDiff(
        file: vscode.Uri,
        leftLabel: string,
        rightLabel: string,
        leftContent: string,
        rightContent: string,
        diffModel: TwoWayDiffModel,
        history: HistoryViewState
    ) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showErrorMessage('Bygone view is unavailable');
            return;
        }

        this.currentTwoWayDiff = {
            file1: leftLabel,
            file2: rightLabel
        };

        this.postOrQueueDiffMessage({
            file1: leftLabel,
            file2: rightLabel,
            leftContent,
            rightContent,
            diffModel,
            history: {
                ...history,
                fileName: path.basename(file.path)
            }
        });
    }

    public async showDirectoryDiff(dirs: vscode.Uri[], entries: DirectoryEntry[]) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showWarningMessage('Bygone view is unavailable.');
            return;
        }

        this.currentTwoWayDiff = undefined;

        this.postOrQueueMessage({
            type: 'showDirectoryDiff',
            leftLabel: path.basename(dirs[0].path),
            rightLabel: path.basename(dirs[1].path),
            labels: dirs.map((dir) => path.basename(dir.path)),
            entries
        } satisfies ShowDirectoryDiffMessage);
    }

    public async showMultiDiff(files: Array<{ uri: vscode.Uri; content: string }>) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showWarningMessage('Bygone view is unavailable.');
            return;
        }

        this.currentTwoWayDiff = undefined;

        this.postOrQueueMessage(this.createMultiDiffMessage(files));
    }

    public async showThreeWayMerge(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri, mergeModel: ThreeWayMergeModel) {
        const view = await this.revealView();
        if (!view) {
            vscode.window.showErrorMessage('Bygone view is unavailable');
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
        } satisfies ShowThreeWayMergeMessage);
    }

    private async revealView(): Promise<vscode.WebviewView | undefined> {
        if (this.view) {
            return this.view;
        }

        await vscode.commands.executeCommand(DiffViewProvider.containerCommand);

        return this.view;
    }

    private postOrQueueMessage(message: WebviewOutboundMessage): void {
        this.currentMessage = message;

        if (!this.view) {
            return;
        }

        if (!this.isReady) {
            this.pendingMessage = message;
            return;
        }

        void this.view.webview.postMessage(message);
    }

    private postOrQueueDiffMessage(message: Omit<ShowDiffMessage, 'type'>): void {
        this.postOrQueueMessage({
            type: 'showDiff',
            ...message
        } satisfies ShowDiffMessage);
    }

    private createMultiDiffMessage(files: Array<{ uri: vscode.Uri; content: string }>): ShowMultiDiffMessage {
        return {
            type: 'showMultiDiff',
            panels: files.map((file) => ({
                label: path.basename(file.uri.path),
                content: file.content
            })),
            pairs: files.slice(0, -1).map((file, index) => ({
                leftIndex: index,
                rightIndex: index + 1,
                diffModel: buildTwoWayDiffModel(file.content, files[index + 1].content)
            }))
        };
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'));
        const editorWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'editor.worker.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource} blob:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Bygone Diff View</title>
</head>
<body>
    <div id="container">
        <div id="header">
            <h1>Bygone</h1>
            <div id="file-info">Choose a compare command to render a diff.</div>
            <div id="status-banner" class="status-banner" hidden></div>
            <div id="directory-return-toolbar" class="directory-return-toolbar" hidden>
                <button id="back-to-directory" class="directory-return-button" type="button" title="Back to directory view (Cmd/Ctrl+[)">← Back to Directory</button>
            </div>
            <div id="edit-mode-toolbar" class="edit-mode-toolbar" hidden>
                <button id="toggle-readonly" class="edit-mode-button" type="button" title="Toggle read-only mode">Editing On</button>
            </div>
            <div id="change-toolbar" class="change-toolbar" hidden>
                <div class="change-copy">
                    <button id="copy-left-to-right" class="change-button change-button-primary" type="button" title="Copy current change from left to right (Cmd/Ctrl+Alt+Right)">Copy current →</button>
                </div>
                <div class="change-nav">
                    <button id="previous-change" class="change-button" type="button" title="Previous difference (Shift+F7)">↑ Prev</button>
                    <div id="change-position" class="change-position"></div>
                    <button id="next-change" class="change-button change-button-primary" type="button" title="Next difference (F7)">↓ Next</button>
                    <div class="change-hint">F7 / Shift+F7 to jump. Cmd/Ctrl+Alt+←/→ to copy the selected change.</div>
                </div>
                <div class="change-copy change-copy-right">
                    <button id="copy-right-to-left" class="change-button change-button-primary" type="button" title="Copy current change from right to left (Cmd/Ctrl+Alt+Left)">← Copy current</button>
                </div>
            </div>
            <div id="history-toolbar" class="history-toolbar" hidden>
                <div class="history-side history-side-left">
                    <div id="history-left-commit" class="history-commit"></div>
                    <div id="history-left-time" class="history-time"></div>
                </div>
                <div class="history-nav">
                    <button id="history-back" class="history-button" type="button" title="Older commit">← Older</button>
                    <div id="history-position" class="history-position"></div>
                    <button id="history-forward" class="history-button" type="button" title="Newer commit">Newer →</button>
                </div>
                <div class="history-side history-side-right">
                    <div id="history-right-commit" class="history-commit"></div>
                    <div id="history-right-time" class="history-time"></div>
                </div>
            </div>
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
            <div id="directory-diff" class="dir-view hidden">
                <div class="dir-headers">
                    <div class="dir-col-header" id="dir-left-header">Left</div>
                    <div class="dir-header-gutter" aria-hidden="true"></div>
                    <div class="dir-col-header" id="dir-right-header">Right</div>
                </div>
                <div id="dir-rows" class="dir-rows-container"></div>
            </div>
            <div id="multi-way-diff" class="multi-view hidden"></div>
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
    <script nonce="${nonce}">
        const vscodeApi = acquireVsCodeApi();
        window.__BYGONE_HOST__ = {
            environment: 'vscode',
            editorWorkerUrl: ${JSON.stringify(editorWorkerUri.toString())},
            postMessage(message) {
                vscodeApi.postMessage(message);
            }
        };
        window.addEventListener('message', (event) => {
            window.dispatchEvent(new CustomEvent('bygone:host-message', {
                detail: event.data
            }));
        });
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private handleRecomputeDiff(leftContent: string, rightContent: string): void {
        if (!this.currentTwoWayDiff) {
            return;
        }

        this.postOrQueueDiffMessage({
            file1: this.currentTwoWayDiff.file1,
            file2: this.currentTwoWayDiff.file2,
            leftContent,
            rightContent,
            diffModel: buildTwoWayDiffModel(leftContent, rightContent),
            history: null
        });
    }
}

function getNonce(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';

    for (let index = 0; index < 32; index++) {
        nonce += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return nonce;
}
