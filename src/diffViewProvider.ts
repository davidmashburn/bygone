import { minimalEdit } from './followEdits';
import { moveComparisonPanel, movedPanelPairIndex, PanelMove } from './panelOrder';
import * as vscode from 'vscode';
import * as path from 'path';
import { BinaryComparison } from './binaryComparison';
import { normalizeLanguageId } from './languageSupport';
import { buildTwoWayDiffModel, ThreeWayMergeModel, TwoWayDiffModel } from './diffEngine';
import { buildHistoryTitleFromViewState, buildMultiPanelTitle } from './windowTitle';
import {
    BranchReviewViewState,
    DirectoryEntry,
    HistoryViewState,
    isHistoryNavigationMessage,
    isHistoryToggleSkipUnchangedMessage,
    isHistoryToggleStagedMessage,
    isMultiSavePanelMessage,
    isMultiSetActivePanelMessage,
    isMultiSetActivePairMessage,
    isMultiUpdatePanelContentMessage,
    isOpenDirectoryEntryMessage,
    isNavigateFileMessage,
    isReadyMessage,
    isRecomputeDiffMessage,
    isReturnToDirectoryMessage,
    isSelectHistoryEntryMessage,
    ShowDiffMessage,
    ShowBinaryDiffMessage,
    ShowDirectoryDiffMessage,
    ShowMultiDiffMessage,
    ShowThreeWayMergeMessage,
    WebviewOutboundMessage
} from './webviewMessages';

type DirectoryDiffContext = Pick<ShowDiffMessage, 'canReturnToDirectory' | 'fileNavigation' | 'directoryNavigation' | 'editableSides' | 'comparisonSummary'> & {
    labels?: [string, string];
};

export interface DirectoryDiffOptions {
    labels?: string[];
    review?: BranchReviewViewState | null;
}

export interface FollowingView {
    update(message: Omit<ShowDiffMessage, 'type'>): void;
    reveal(preserveFocus?: boolean): void;
    dispose(): void;
}

interface TwoWayDiffState {
    file1: string;
    file2: string;
    leftUri?: vscode.Uri;
    rightUri?: vscode.Uri;
    editableSides: { left: boolean; right: boolean };
    comparisonId: string;
    directoryContext?: DirectoryDiffContext;
}

interface PanelState {
    key: string;
    panel: vscode.WebviewPanel;
    isReady: boolean;
    pendingMessage?: WebviewOutboundMessage;
    currentMessage?: WebviewOutboundMessage;
    currentTwoWayDiff?: TwoWayDiffState;
}

interface SerializedFileComparison {
    version: 1;
    kind: 'files';
    leftUri: string;
    rightUri: string;
}

interface SerializedHistoryComparison {
    version: 1;
    kind: 'history';
    fileUri: string;
}

type SerializedPanel = SerializedFileComparison | SerializedHistoryComparison;

export class DiffViewProvider implements vscode.Disposable {
    public static readonly viewType = 'bygone.diffPanel';
    private readonly panels = new Map<string, PanelState>();
    private activeState?: PanelState;
    private panel?: vscode.WebviewPanel;
    private isReady = false;
    private pendingMessage?: WebviewOutboundMessage;
    private currentMessage?: WebviewOutboundMessage;
    private currentTwoWayDiff?: TwoWayDiffState;
    private readonly disposables: vscode.Disposable[] = [];
    private documentUpdateQueue = Promise.resolve();
    private historyNavigationHandler?: (direction: 'back' | 'forward') => void;
    private historyStagedToggleHandler?: (includeStaged: boolean) => void;
    private historySkipUnchangedToggleHandler?: (skipUnchanged: boolean) => void;
    private historySelectionHandler?: (index: number) => void;
    private historyRestoreHandler?: (file: vscode.Uri) => Promise<void>;
    private directoryEntryOpenHandler?: (relativePath: string) => void;
    private fileNavigationHandler?: (direction: 'previous' | 'next') => void;
    private directoryReturnHandler?: () => void;

    constructor(private readonly extensionUri: vscode.Uri) {
        this.disposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
            for (const state of this.panels.values()) {
                const twoWayDiff = state === this.activeState ? this.currentTwoWayDiff : state.currentTwoWayDiff;
                if (isTwoWayStateDocument(twoWayDiff, event.document.uri)) {
                    this.queueDocumentRefresh(state);
                }
            }
        }));
    }

    public setHistoryNavigationHandler(handler: (direction: 'back' | 'forward') => void): void {
        this.historyNavigationHandler = handler;
    }

    public setHistoryStagedToggleHandler(handler: (includeStaged: boolean) => void): void {
        this.historyStagedToggleHandler = handler;
    }

    public setHistorySkipUnchangedToggleHandler(handler: (skipUnchanged: boolean) => void): void {
        this.historySkipUnchangedToggleHandler = handler;
    }

    public setHistorySelectionHandler(handler: (index: number) => void): void {
        this.historySelectionHandler = handler;
    }

    public setHistoryRestoreHandler(handler: (file: vscode.Uri) => Promise<void>): void {
        this.historyRestoreHandler = handler;
    }

    public setDirectoryEntryOpenHandler(handler: (relativePath: string) => void): void {
        this.directoryEntryOpenHandler = handler;
    }

    public setFileNavigationHandler(handler: (direction: 'previous' | 'next') => void): void {
        this.fileNavigationHandler = handler;
    }

    public setDirectoryReturnHandler(handler: () => void): void {
        this.directoryReturnHandler = handler;
    }

    public getActiveFileComparisonUris(): readonly vscode.Uri[] | undefined {
        const state = this.currentTwoWayDiff;
        return state?.leftUri && state.rightUri ? [state.leftUri, state.rightUri] : undefined;
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        for (const state of this.panels.values()) {
            state.panel.dispose();
        }
        this.panels.clear();
        this.panel = undefined;
    }

    public async deserializeWebviewPanel(panel: vscode.WebviewPanel, rawState: unknown): Promise<void> {
        const serialized = parseSerializedPanel(rawState);
        if (!serialized) {
            panel.dispose();
            return;
        }
        if (serialized.kind === 'history') {
            this.createPanel(panel.title, 'history', panel, serialized);
            await this.historyRestoreHandler?.(vscode.Uri.parse(serialized.fileUri));
            return;
        }
        const leftUri = vscode.Uri.parse(serialized.leftUri);
        const rightUri = vscode.Uri.parse(serialized.rightUri);
        this.createPanel(panel.title, fileComparisonKey(leftUri, rightUri), panel, serialized);
        const [leftDocument, rightDocument] = await Promise.all([
            vscode.workspace.openTextDocument(leftUri),
            vscode.workspace.openTextDocument(rightUri)
        ]);
        await this.showDiff(leftUri, rightUri, leftDocument.getText(), rightDocument.getText(), buildTwoWayDiffModel(leftDocument.getText(), rightDocument.getText()));
    }

    private createPanel(
        title: string,
        key: string,
        restoredPanel?: vscode.WebviewPanel,
        serialized?: SerializedPanel
    ): PanelState {
        const panel = restoredPanel ?? vscode.window.createWebviewPanel(
            DiffViewProvider.viewType,
            title,
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.extensionUri]
            }
        );
        const state: PanelState = { key, panel, isReady: false };
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        this.panels.set(key, state);
        this.activateState(state);
        panel.webview.onDidReceiveMessage((message) => {
            if (this.panels.get(key) !== state) return;
            this.activateState(state);
            if (isReadyMessage(message)) {
                this.isReady = true;

                if (this.pendingMessage) {
                    void panel.webview.postMessage(this.pendingMessage);
                    this.pendingMessage = undefined;
                } else if (this.currentMessage) {
                    void panel.webview.postMessage(this.currentMessage);
                }
            }

            if (isRecomputeDiffMessage(message)) {
                this.queueDocumentUpdate(state, message.leftContent, message.rightContent, message.leftBase, message.rightBase);
            }

            if (message?.type === 'recoverManualDraft' && typeof message.content === 'string') {
                void vscode.workspace.openTextDocument({ content: message.content }).then(doc => vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false }));
                void vscode.window.showWarningMessage('Bygone preserved unapplied edits in an untitled document because the source changed.');
            }

            if (isHistoryNavigationMessage(message) && this.historyNavigationHandler) {
                this.historyNavigationHandler(message.type === 'historyBack' ? 'back' : 'forward');
            }

            if (isHistoryToggleStagedMessage(message) && this.historyStagedToggleHandler) {
                this.historyStagedToggleHandler(message.includeStaged);
            }

            if (isHistoryToggleSkipUnchangedMessage(message) && this.historySkipUnchangedToggleHandler) {
                this.historySkipUnchangedToggleHandler(message.skipUnchanged);
            }

            if (isSelectHistoryEntryMessage(message) && this.historySelectionHandler) {
                this.historySelectionHandler(message.index);
            }

            if (isOpenDirectoryEntryMessage(message) && this.directoryEntryOpenHandler) {
                this.directoryEntryOpenHandler(message.relativePath);
            }

            if (isNavigateFileMessage(message) && this.fileNavigationHandler) {
                this.fileNavigationHandler(message.direction);
            }

            if (isReturnToDirectoryMessage(message) && this.directoryReturnHandler) {
                this.directoryReturnHandler();
            }

            if (message.type === 'multiMovePanel') {
                this.handleMultiMovePanel(message as PanelMove);
                return;
            }
            if (isMultiSetActivePanelMessage(message)) {
                this.handleMultiSetActivePanel(message.panelId);
            }

            if (isMultiSetActivePairMessage(message)) {
                this.handleMultiSetActivePair(message.pairIndex);
            }

            if (isMultiUpdatePanelContentMessage(message)) {
                this.handleMultiUpdatePanelContent(message.panelId, message.content);
            }

            if (isMultiSavePanelMessage(message)) {
                void this.handleMultiSavePanel(message.panelId);
            }
        });
        panel.onDidDispose(() => {
            this.panels.delete(key);
            if (this.activeState === state) {
                this.panel = undefined;
                this.activeState = undefined;
                this.isReady = false;
                this.pendingMessage = undefined;
            }
        });
        panel.onDidChangeViewState(() => {
            if (panel.active) {
                this.activateState(state);
            }
        });
        panel.webview.html = this.getHtmlForWebview(panel.webview, serialized, key === 'follow');
        return state;
    }

    public createFollowingView(
        viewType: string,
        onAction: (action: string) => void,
        onClose: () => void,
        restored?: vscode.WebviewPanel,
        onMessage?: (message: unknown) => void
    ): FollowingView {
        const source = vscode.window.activeTextEditor;
        const panel = restored ?? vscode.window.createWebviewPanel(
            viewType, 'Bygone: Following',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.extensionUri] }
        );
        const state = this.createPanel(panel.title, 'follow', panel);
        // Older VS Code preserves the active group but can drop the source's
        // keyboard focus when creating a webview. Restore it only during the
        // explicit initial command, never on asynchronous follow updates.
        if (!restored && source) {
            void vscode.window.showTextDocument(source.document, { viewColumn: source.viewColumn, preserveFocus: false })
                .then(undefined, () => undefined); // The source may close before VS Code handles the request.
        }
        const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
            if (typeof message !== 'object' || message === null) return;
            const action = (message as { type?: unknown; action?: unknown });
            onMessage?.(message);
            if (action.type === 'followAction' && typeof action.action === 'string'
                && ['pin', 'resume', 'refresh', 'history', 'compare', 'symbol', 'file', 'reveal', 'save', 'undo', 'redo', 'working', 'followSymbol'].includes(action.action)) onAction(action.action);
        });
        panel.onDidDispose(() => { listener.dispose(); onClose(); });
        return {
            update: (message) => {
                if (this.panels.get(state.key) !== state) return;
                this.activateState(state);
                this.currentTwoWayDiff = undefined; // Immutable baseline; controller owns buffer refreshes.
                panel.title = `Bygone: ${message.follow?.mode === 'pinned' ? 'Pinned' : message.follow?.mode === 'paused' ? 'Paused' : 'Following'}`;
                this.postOrQueueDiffMessage(message);
            },
            reveal: (preserveFocus = false) => panel.reveal(panel.viewColumn, preserveFocus),
            dispose: () => panel.dispose()
        };
    }

    public async showDiff(
        file1: vscode.Uri,
        file2: vscode.Uri,
        leftContent: string,
        rightContent: string,
        diffModel: TwoWayDiffModel,
        directoryContext?: DirectoryDiffContext
    ) {
        const key = fileComparisonKey(file1, file2);
        this.revealPanel(
            `${path.basename(file1.path)} ↔ ${path.basename(file2.path)}`,
            key,
            { version: 1, kind: 'files', leftUri: file1.toString(), rightUri: file2.toString() }
        );

        const editableSides = directoryContext?.editableSides ?? {
            left: this.canEditDocument(file1),
            right: this.canEditDocument(file2)
        };
        this.currentTwoWayDiff = {
            file1: directoryContext?.labels?.[0] ?? path.basename(file1.path),
            file2: directoryContext?.labels?.[1] ?? path.basename(file2.path),
            leftUri: file1,
            rightUri: file2,
            editableSides,
            comparisonId: `${file1.toString()}\u0000${file2.toString()}`,
            directoryContext
        };

        const comparison = this.currentTwoWayDiff;
        const state = this.activeState!;
        const [leftLanguageId, rightLanguageId] = await Promise.all([
            this.resolveLanguageId(file1), this.resolveLanguageId(file2)
        ]);
        if (!this.isCurrentComparison(state, comparison)) return;
        this.activateState(state);
        this.postOrQueueDiffMessage({
            file1: comparison.file1,
            file2: comparison.file2,
            comparisonId: comparison.comparisonId,
            leftContent,
            rightContent,
            sourceInfo: {
                leftPath: file1.path,
                rightPath: file2.path,
                leftLanguageId,
                rightLanguageId
            },
            diffModel,
            history: null,
            ...toDirectoryMessageContext(directoryContext),
            editableSides
        });
    }

    public async showBinaryDiff(
        comparison: BinaryComparison,
        directoryContext?: DirectoryDiffContext
    ) {
        this.revealPanel(`${comparison.left.label} ↔ ${comparison.right.label}`, `binary:${comparison.left.path}\u0000${comparison.right.path}`);

        this.currentTwoWayDiff = undefined;
        this.postOrQueueMessage({
            type: 'showBinaryDiff',
            comparison,
            comparisonSummary: directoryContext?.comparisonSummary,
            ...toDirectoryMessageContext(directoryContext)
        } satisfies ShowBinaryDiffMessage);
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
        this.revealPanel(
            buildHistoryTitleFromViewState(path.basename(file.path), history),
            'history',
            { version: 1, kind: 'history', fileUri: file.toString() }
        );

        this.currentTwoWayDiff = {
            file1: leftLabel,
            file2: rightLabel,
            editableSides: { left: false, right: false },
            comparisonId: `${file.toString()}\u0000${leftLabel}\u0000${rightLabel}`
        };

        const comparison = this.currentTwoWayDiff;
        const state = this.activeState!;
        const languageId = await this.resolveLanguageId(file);
        if (!this.isCurrentComparison(state, comparison)) return;
        this.activateState(state);
        this.postOrQueueDiffMessage({
            file1: leftLabel,
            file2: rightLabel,
            comparisonId: comparison.comparisonId,
            leftContent,
            rightContent,
            sourceInfo: {
                leftPath: file.path,
                rightPath: file.path,
                leftLanguageId: languageId,
                rightLanguageId: languageId
            },
            diffModel,
            history: {
                ...history,
                fileName: path.basename(file.path)
            },
            editableSides: { left: false, right: false }
        });
    }

    public async showDirectoryDiff(dirs: vscode.Uri[], entries: DirectoryEntry[], options: DirectoryDiffOptions = {}) {
        this.revealPanel(`${options.labels?.[0] ?? path.basename(dirs[0].path)} ↔ ${options.labels?.[1] ?? path.basename(dirs[1].path)}`, `directories:${dirs.map((dir) => dir.toString()).join('\u0000')}`);

        this.currentTwoWayDiff = undefined;

        this.postOrQueueMessage({
            type: 'showDirectoryDiff',
            leftLabel: options.labels?.[0] ?? path.basename(dirs[0].path),
            rightLabel: options.labels?.[1] ?? path.basename(dirs[1].path),
            labels: options.labels ?? dirs.map((dir) => path.basename(dir.path)),
            entries,
            canMutate: false,
            review: options.review
        } satisfies ShowDirectoryDiffMessage);
    }

    public async showMultiDiff(
        files: Array<{ uri: vscode.Uri; content: string; label?: string }>,
        directoryContext?: Pick<ShowMultiDiffMessage, 'canReturnToDirectory' | 'fileNavigation' | 'directoryNavigation' | 'revealFirstChangeInEachPanel'>
    ) {
        const message = this.createMultiDiffMessage(await Promise.all(files.map(async (file) => ({
            ...file,
            languageId: await this.resolveLanguageId(file.uri)
        }))));
        this.revealPanel(
            buildMultiPanelTitle({
                panels: message.panels,
                activePanelId: message.activePanelId,
                activePairIndex: message.activePairIndex,
                panelIds: message.panels.map((panel) => panel.id)
            }),
            `multi:${files.map((file) => file.uri.toString()).join('\u0000')}`
        );

        this.currentTwoWayDiff = undefined;

        this.postOrQueueMessage({
            ...message,
            ...directoryContext,
            mutationEnabled: false,
            reorderEnabled: true
        });
    }

    public async showThreeWayMerge(base: vscode.Uri, left: vscode.Uri, right: vscode.Uri, mergeModel: ThreeWayMergeModel) {
        this.revealPanel(`${path.basename(left.path)} ↔ ${path.basename(right.path)}`, `merge:${base.toString()}\u0000${left.toString()}\u0000${right.toString()}`);

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

    private revealPanel(title: string, key: string, serialized?: SerializedPanel): vscode.WebviewPanel {
        const existing = this.panels.get(key);
        if (!existing) {
            return this.createPanel(title, key, undefined, serialized).panel;
        }
        this.activateState(existing);
        existing.panel.title = title;
        existing.panel.reveal(existing.panel.viewColumn, false);
        return existing.panel;
    }

    private activateState(state: PanelState): void {
        if (this.activeState) {
            this.activeState.isReady = this.isReady;
            this.activeState.pendingMessage = this.pendingMessage;
            this.activeState.currentMessage = this.currentMessage;
            this.activeState.currentTwoWayDiff = this.currentTwoWayDiff;
        }
        this.activeState = state;
        this.panel = state.panel;
        this.isReady = state.isReady;
        this.pendingMessage = state.pendingMessage;
        this.currentMessage = state.currentMessage;
        this.currentTwoWayDiff = state.currentTwoWayDiff;
    }

    private postOrQueueMessage(message: WebviewOutboundMessage): void {
        this.currentMessage = message;

        if (!this.panel) {
            return;
        }

        if (!this.isReady) {
            this.pendingMessage = message;
            return;
        }

        void this.panel.webview.postMessage(message);
    }

    private postOrQueueDiffMessage(message: Omit<ShowDiffMessage, 'type'>): void {
        this.postOrQueueMessage({
            type: 'showDiff',
            ...message
        } satisfies ShowDiffMessage);
    }

    private createMultiDiffMessage(files: Array<{ uri: vscode.Uri; content: string; label?: string; languageId?: string }>): ShowMultiDiffMessage {
        return {
            type: 'showMultiDiff',
            panels: files.map((file) => ({
                id: file.uri.toString(),
                label: file.label ?? path.basename(file.uri.path),
                path: file.uri.path,
                languageId: file.languageId ?? normalizeLanguageId(undefined, file.uri.path),
                content: file.content,
                editable: file.uri.scheme === 'file',
                dirty: false
            })),
            pairs: files.slice(0, -1).map((file, index) => ({
                leftIndex: index,
                rightIndex: index + 1,
                diffModel: buildTwoWayDiffModel(file.content, files[index + 1].content)
            })),
            activePanelId: files[0]?.uri.toString() ?? null,
            activePairIndex: files.length > 1 ? 0 : null
        };
    }

    private async resolveLanguageId(uri: vscode.Uri): Promise<string> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            return normalizeLanguageId(document.languageId, uri.path);
        } catch {
            return normalizeLanguageId(undefined, uri.path);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview, serialized?: SerializedPanel, following = false) {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'webview.js'));
        const editorWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'editor.worker.js'));
        const diffWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'diff.worker.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http: https:; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource} blob:;">
    <link href="${styleUri}" rel="stylesheet">
    <title>Bygone Diff View</title>
</head>
<body>
    <div id="container">
        <div id="header">
            ${following ? `<section class="follow-toolbar" aria-label="Following controls">
                <div><strong id="follow-mode">Paused</strong>
                    <button id="follow-pin" type="button" title="Keep this file and baseline commit">Pin</button>
                    <button id="follow-resume" type="button" title="Follow the active source editor">Resume Following</button>
                    <button id="follow-refresh" type="button" title="Refresh this comparison">Refresh</button>
                    <button id="follow-history" type="button" title="Pause following and open file history">View File History</button>
                    <button id="follow-compare" type="button" title="Pause following and compare the source with another file">Manual Compare…</button>
                </div>
                <div id="follow-status" role="status" aria-live="polite">Select a source file to follow.</div>
                <div>
                    <button id="follow-symbol" type="button" title="Compare the enclosing source symbol">Compare Symbol</button>
                    <button id="follow-followSymbol" type="button" title="Toggle following Outline and cursor selections">Toggle Follow Symbol</button>
                    <button id="follow-file" type="button" title="Show the complete selected comparison">Show File Context</button>
                    <button id="follow-reveal" type="button" title="Open the exact source endpoint">Reveal Source</button>
                    <button id="follow-working" type="button" title="Compare index with the working document">Working Changes</button>
                    <button id="follow-save" type="button" title="Save the underlying VS Code document">Save</button>
                    <button id="follow-undo" type="button" title="Undo in the underlying document">Undo</button>
                    <button id="follow-redo" type="button" title="Redo in the underlying document">Redo</button>
                </div>
            </section>` : ''}
            <div id="file-info" class="header-align-diff">Choose a compare command to render a diff.</div>
            <div id="status-banner" class="status-banner header-align-diff" role="status" aria-live="polite" aria-atomic="true" hidden></div>
            <div id="directory-return-toolbar" class="directory-return-toolbar header-align-diff" hidden>
                <button id="back-to-directory" class="directory-return-button" type="button" title="Show directory comparison (Cmd/Ctrl+[)" aria-label="Show directory comparison">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 3v14h4M4 7h4"></path>
                        <rect x="8" y="4" width="12" height="6" rx="1"></rect>
                        <rect x="8" y="14" width="12" height="6" rx="1"></rect>
                    </svg>
                    <span>Directory</span>
                </button>
            </div>
            <div id="change-toolbar" class="change-toolbar header-align-diff" hidden>
                <div class="change-toolbar-main">
                    <div class="change-toolbar-nav">
                        <button id="previous-file" class="change-button icon-button" type="button" title="Open previous file" aria-label="Previous file">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M17 11l-5-5-5 5"></path>
                                <path d="M17 18l-5-5-5 5"></path>
                            </svg>
                        </button>
                        <button id="next-file" class="change-button icon-button" type="button" title="Open next file" aria-label="Next file">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M7 13l5 5 5-5"></path>
                                <path d="M7 6l5 5 5-5"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="change-toolbar-center">
                    <button id="previous-change" class="change-button icon-button" type="button" title="Previous difference (Shift+F7 or Cmd/Ctrl+Shift+Up)" aria-label="Previous difference">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 19V5"></path>
                            <path d="M6 11l6-6 6 6"></path>
                        </svg>
                    </button>
                    <div id="change-position" class="change-position" role="status" aria-live="polite" aria-atomic="true"></div>
                    <button id="next-change" class="change-button change-button-primary icon-button" type="button" title="Next difference (F7 or Cmd/Ctrl+Shift+Down)" aria-label="Next difference">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 5v14"></path>
                            <path d="M6 13l6 6 6-6"></path>
                        </svg>
                    </button>
                    </div>
                    <div class="change-toolbar-actions">
                    <div id="edit-mode-toolbar" class="edit-mode-toolbar" hidden>
                        <button id="toggle-readonly" class="edit-mode-button" type="button" title="Toggle read-only mode">Editing On</button>
                    </div>
                    <button id="toggle-pair-focus" class="change-button" type="button" title="Show only changes from the selected pair" aria-label="Focus selected pair" aria-pressed="false" hidden>Focus selected pair: Off</button>
                    <button id="toggle-word-wrap" class="change-button icon-button" type="button" title="Enable line wrapping (Alt+Z)" aria-label="Enable line wrapping" aria-pressed="false" hidden>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 6h13a3 3 0 0 1 0 6H9"></path>
                            <path d="M12 9l-3 3 3 3"></path>
                            <path d="M4 18h8"></path>
                        </svg>
                    </button>
                    <button id="refresh-session" class="change-button refresh-session-button icon-button" type="button" title="Refresh Session (Cmd/Ctrl+R)" aria-label="Refresh Session" disabled>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M20 11a8 8 0 1 0-2.3 5.7"></path>
                            <path d="M20 5v6h-6"></path>
                        </svg>
                    </button>
                    </div>
                </div>
                <div class="change-hint">F7 / Shift+F7 · Cmd/Ctrl+Shift+Up/Down to jump.</div>
            </div>
            <div id="history-toolbar" class="history-toolbar header-align-diff" hidden>
                <div class="history-side history-side-left">
                    <div id="history-left-commit" class="history-commit"></div>
                    <div id="history-left-time" class="history-time"></div>
                </div>
                <div class="history-nav">
                    <button id="history-back" class="history-button icon-button" type="button" title="Open older commit" aria-label="Older commit">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M15 18l-6-6 6-6"></path>
                            <path d="M10 18l-6-6 6-6" opacity="0.7"></path>
                        </svg>
                    </button>
                    <div id="history-position" class="history-position" role="status" aria-live="polite" aria-atomic="true"></div>
                    <button id="history-forward" class="history-button icon-button" type="button" title="Open newer commit" aria-label="Newer commit">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9 18l6-6-6-6"></path>
                            <path d="M14 18l6-6-6-6" opacity="0.7"></path>
                        </svg>
                    </button>
                    <button id="history-toggle-staged" class="history-button history-toggle-button" type="button" title="Include staged changes in history" aria-label="Include staged changes in history" aria-pressed="false">
                        Staged
                    </button>
                    <button id="history-toggle-skip-unchanged" class="history-button history-toggle-button" type="button" title="Skip revisions where the current file did not change" aria-label="Skip revisions where the current file did not change" aria-pressed="false">
                        Changed
                    </button>
                </div>
                <div class="history-side history-side-right">
                    <div id="history-right-commit" class="history-commit"></div>
                    <div id="history-right-time" class="history-time"></div>
                </div>
            </div>
            <div id="directory-tree-toolbar" class="directory-tree-toolbar header-align-diff" hidden>
                <button id="directory-expand-all" class="directory-tree-button icon-button" type="button" title="Expand all folders" aria-label="Expand all folders">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16"></path>
                        <path d="M4 12h16"></path>
                        <path d="M4 17h16"></path>
                        <path d="M12 4v16"></path>
                    </svg>
                </button>
                <button id="directory-collapse-all" class="directory-tree-button icon-button" type="button" title="Collapse all folders" aria-label="Collapse all folders">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16"></path>
                        <path d="M4 12h16"></path>
                        <path d="M4 17h16"></path>
                    </svg>
                </button>
                <button id="directory-collapse-unchanged" class="directory-tree-button icon-button" type="button" title="Collapse unchanged folders" aria-label="Collapse unchanged folders">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7h16"></path>
                        <path d="M4 12h10"></path>
                        <path d="M4 17h16"></path>
                        <path d="M17 9l3 3-3 3"></path>
                    </svg>
                </button>
            </div>
        </div>
        <div id="diff-workspace">
            <aside id="history-rail" class="history-rail hidden" hidden></aside>
            <button id="show-navigation-sidebar" class="navigation-sidebar-show" type="button" title="Show navigation sidebar" aria-label="Show navigation sidebar" hidden>›</button>
            <div id="diff-container">
                <div id="two-way-diff" class="diff-view">
                    <div class="file-panel">
                        <button id="file1-header" class="file-header" type="button" title="Select left pane" aria-pressed="false">File 1</button>
                        <div id="file1-content" class="file-content"></div>
                    </div>
                    <div class="file-panel">
                        <button id="file2-header" class="file-header" type="button" title="Select right pane" aria-pressed="false">File 2</button>
                        <div id="file2-content" class="file-content"></div>
                    </div>
                </div>
                <div id="directory-diff" class="dir-view hidden">
                    <div id="directory-view-tabs" class="directory-view-tabs" hidden>
                        <button id="directory-overview-tab" type="button" title="Show change overview" aria-pressed="true">Overview</button>
                        <button id="directory-files-tab" type="button" title="Show all changed files" aria-pressed="false">Files</button>
                    </div>
                    <section id="directory-overview" class="directory-overview" aria-label="Change overview" hidden></section>
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
    </div>
    <script nonce="${nonce}">
        const vscodeApi = acquireVsCodeApi();
        ${serialized ? `vscodeApi.setState(${JSON.stringify(serialized)});` : following ? 'vscodeApi.setState({ version: 1, kind: "follow" });' : ''}
        ${following ? `
        for (const action of ['pin', 'resume', 'refresh', 'history', 'compare', 'symbol', 'file', 'reveal', 'save', 'undo', 'redo', 'working', 'followSymbol']) {
            document.getElementById('follow-' + action).addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('bygone:follow-action', { detail: action }));
            });
        }
        window.addEventListener('message', (event) => {
            const state = event.data.follow;
            if (!state) return;
            document.getElementById('follow-mode').textContent = state.mode === 'following' ? 'Following' : state.mode === 'pinned' ? 'Pinned' : 'Paused';
            document.getElementById('follow-status').textContent = state.status;
            document.getElementById('follow-pin').disabled = !state.canPin || state.mode !== 'following';
            document.getElementById('follow-resume').disabled = state.mode === 'following';
            document.getElementById('follow-refresh').disabled = state.mode === 'paused';
            document.getElementById('diff-workspace').style.display = state.unavailable ? 'none' : '';
        });` : ''}
        window.__BYGONE_HOST__ = {
            environment: 'vscode',
            editorWorkerUrl: ${JSON.stringify(editorWorkerUri.toString())},
            diffWorkerUrl: ${JSON.stringify(diffWorkerUri.toString())},
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

    private queueDocumentUpdate(state: PanelState, leftContent: string, rightContent: string, leftBase?: string, rightBase?: string): void {
        const comparison = this.activeState === state ? this.currentTwoWayDiff : state.currentTwoWayDiff;
        this.documentUpdateQueue = this.documentUpdateQueue
            .then(() => {
                if (!this.isCurrentComparison(state, comparison)) return;
                this.activateState(state);
                return this.handleRecomputeDiff(leftContent, rightContent, leftBase, rightBase);
            })
            .catch((error) => this.showDocumentEditError(error));
    }

    private queueDocumentRefresh(state: PanelState): void {
        const comparison = this.activeState === state ? this.currentTwoWayDiff : state.currentTwoWayDiff;
        this.documentUpdateQueue = this.documentUpdateQueue
            .then(() => {
                if (!this.isCurrentComparison(state, comparison)) return;
                this.activateState(state);
                return this.refreshCurrentDocumentDiff();
            })
            .catch((error) => this.showDocumentEditError(error));
    }

    private async handleRecomputeDiff(leftContent: string, rightContent: string, leftBase?: string, rightBase?: string): Promise<void> {
        if (!this.currentTwoWayDiff) {
            return;
        }

        const state = this.activeState;
        const comparison = this.currentTwoWayDiff;
        const edit = new vscode.WorkspaceEdit();
        let hasEdits = false;
        const versions: Array<{ document: vscode.TextDocument; version: number }> = [];
        for (const [side, content] of [['left', leftContent], ['right', rightContent]] as const) {
            const uri = side === 'left' ? comparison.leftUri : comparison.rightUri;
            if (!uri || !comparison.editableSides[side]) {
                continue;
            }
            const document = await vscode.workspace.openTextDocument(uri);
            const base = side === 'left' ? leftBase : rightBase;
            if (content === base) continue;
            if (base === undefined || document.getText() !== base) {
                if (document.getText() !== content) {
                    const recovery = await vscode.workspace.openTextDocument({ language: document.languageId, content });
                    await vscode.window.showTextDocument(recovery, { preserveFocus: true, preview: false });
                    throw new Error('Source changed. Unapplied edits were preserved in an untitled document.');
                }
                continue;
            }
            const change = minimalEdit(base, content);
            if (change) {
                edit.replace(uri, new vscode.Range(document.positionAt(change.rangeOffset), document.positionAt(change.rangeOffset + change.rangeLength)), change.text);
                versions.push({ document, version: document.version });
                hasEdits = true;
            }
        }

        if (!state || !this.isCurrentComparison(state, comparison)) return;
        if (versions.some(({ document, version }) => document.version !== version)) {
            for (const content of [leftContent, rightContent]) {
                const recovery = await vscode.workspace.openTextDocument({ content });
                await vscode.window.showTextDocument(recovery, { preserveFocus: true, preview: false });
            }
            throw new Error('Source changed while preparing edits. Drafts were preserved in untitled documents.');
        }
        if (hasEdits) {
            if (!await vscode.workspace.applyEdit(edit)) {
                for (const [side, content, base] of [['left', leftContent, leftBase], ['right', rightContent, rightBase]] as const) {
                    if (comparison.editableSides[side] && content !== base) {
                        const recovery = await vscode.workspace.openTextDocument({ content });
                        await vscode.window.showTextDocument(recovery, { preserveFocus: true, preview: false });
                    }
                }
                throw new Error('VS Code rejected stale edits. Drafts were preserved in untitled documents.');
            }
        }

        if (!this.isCurrentComparison(state, comparison)) return;
        this.activateState(state);
        await this.refreshCurrentDocumentDiff(leftContent, rightContent);
    }

    private isCurrentComparison(state: PanelState, comparison: TwoWayDiffState | undefined): boolean {
        return this.panels.get(state.key) === state
            && (this.activeState === state ? this.currentTwoWayDiff : state.currentTwoWayDiff) === comparison;
    }

    private async refreshCurrentDocumentDiff(leftFallback?: string, rightFallback?: string): Promise<void> {
        const comparison = this.currentTwoWayDiff;
        const state = this.activeState;
        if (!comparison || !state) return;
        const leftContent = await this.readCurrentSide('left', leftFallback ?? '', comparison);
        const rightContent = await this.readCurrentSide('right', rightFallback ?? '', comparison);
        if (!this.isCurrentComparison(state, comparison)) return;
        this.activateState(state);
        this.postOrQueueDiffMessage({
            file1: comparison.file1,
            file2: comparison.file2,
            comparisonId: comparison.comparisonId,
            leftContent, rightContent,
            diffModel: buildTwoWayDiffModel(leftContent, rightContent),
            history: null,
            ...toDirectoryMessageContext(comparison.directoryContext),
            editableSides: comparison.editableSides
        });
    }

    private async readCurrentSide(side: 'left' | 'right', fallback: string, comparison: TwoWayDiffState): Promise<string> {
        const uri = side === 'left' ? comparison.leftUri : comparison.rightUri;
        if (!uri) return fallback;
        const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
        return openDocument?.getText() ?? (await vscode.workspace.openTextDocument(uri)).getText();
    }

    private canEditDocument(uri: vscode.Uri): boolean {
        return vscode.workspace.isTrusted && uri.scheme === 'file';
    }

    private showDocumentEditError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Unable to update comparison document: ${message}`);
    }

    private updateMultiPanelTitle(message: ShowMultiDiffMessage): void {
        if (!this.panel) {
            return;
        }
        this.panel.title = buildMultiPanelTitle({
            panels: message.panels,
            activePanelId: message.activePanelId,
            activePairIndex: message.activePairIndex,
            panelIds: message.panels.map((panel) => panel.id)
        });
    }

    private handleMultiMovePanel(move: PanelMove): void {
        const current = this.currentMessage;
        if (current?.type !== 'showMultiDiff' || !current.reorderEnabled) return;
        const panels = moveComparisonPanel(current.panels, move);
        if (!panels) return;
        this.currentMessage = { ...current, panels, activePanelId: move.panelId,
            activePairIndex: movedPanelPairIndex(panels.map(panel => panel.id), move.panelId),
            pairs: panels.slice(0, -1).map((panel, index) => ({ leftIndex: index, rightIndex: index + 1,
                diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content) })) };
        if (this.activeState) this.activeState.currentMessage = this.currentMessage;
        void this.panel?.webview.postMessage({ type: 'reorderMultiPanels', panelIds: panels.map(panel => panel.id), activePanelId: move.panelId });
        this.updateMultiPanelTitle(this.currentMessage);
    }

    private handleMultiSetActivePanel(panelId: string): void {
        if (!this.currentMessage || this.currentMessage.type !== 'showMultiDiff') {
            return;
        }

        if (!this.currentMessage.panels.some((panel) => panel.id === panelId)) {
            return;
        }

        this.currentMessage = {
            ...this.currentMessage,
            activePanelId: panelId
        };
        if (this.activeState) {
            this.activeState.currentMessage = this.currentMessage;
        }
        this.updateMultiPanelTitle(this.currentMessage);
    }

    private handleMultiSetActivePair(pairIndex: number): void {
        if (!this.currentMessage || this.currentMessage.type !== 'showMultiDiff') {
            return;
        }

        if (pairIndex < 0 || pairIndex >= this.currentMessage.pairs.length) {
            return;
        }

        this.currentMessage = {
            ...this.currentMessage,
            activePairIndex: pairIndex
        };
        if (this.activeState) {
            this.activeState.currentMessage = this.currentMessage;
        }
        this.updateMultiPanelTitle(this.currentMessage);
    }

    private handleMultiUpdatePanelContent(panelId: string, content: string): void {
        if (!this.currentMessage || this.currentMessage.type !== 'showMultiDiff') {
            return;
        }

        const panelIndex = this.currentMessage.panels.findIndex((panel) => panel.id === panelId);
        if (panelIndex < 0) {
            return;
        }

        const panels = this.currentMessage.panels.map((panel, index) => (
            index === panelIndex ? { ...panel, content, dirty: true } : panel
        ));
        this.currentMessage = {
            ...this.currentMessage,
            panels,
            pairs: panels.slice(0, -1).map((panel, index) => ({
                leftIndex: index,
                rightIndex: index + 1,
                diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
            }))
        };
    }

    private async handleMultiSavePanel(panelId?: string): Promise<void> {
        if (!this.currentMessage || this.currentMessage.type !== 'showMultiDiff') {
            return;
        }

        const targetPanelId = panelId ?? this.currentMessage.activePanelId ?? undefined;
        if (!targetPanelId) {
            return;
        }

        const panel = this.currentMessage.panels.find((candidate) => candidate.id === targetPanelId);
        if (!panel || panel.editable === false) {
            return;
        }

        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.parse(panel.id);
        } catch {
            return;
        }

        if (uri.scheme !== 'file') {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(uri, fullDocumentRange(document), panel.content);
            if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
                throw new Error('VS Code could not save the document.');
            }
            this.currentMessage = {
                ...this.currentMessage,
                panels: this.currentMessage.panels.map((candidate) => (
                    candidate.id === targetPanelId ? { ...candidate, dirty: false } : candidate
                ))
            };
            this.postOrQueueMessage(this.currentMessage);
            void vscode.window.setStatusBarMessage(`Saved ${panel.label}`, 1500);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Unable to save ${panel.label}: ${message}`);
        }
    }
}

function toDirectoryMessageContext(context?: DirectoryDiffContext) {
    if (!context) {
        return {};
    }
    return {
        canReturnToDirectory: context.canReturnToDirectory,
        fileNavigation: context.fileNavigation,
        directoryNavigation: context.directoryNavigation,
        editableSides: context.editableSides,
        comparisonSummary: context.comparisonSummary
    };
}

function getNonce(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';

    for (let index = 0; index < 32; index++) {
        nonce += charset.charAt(Math.floor(Math.random() * charset.length));
    }

    return nonce;
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function fileComparisonKey(leftUri: vscode.Uri, rightUri: vscode.Uri): string {
    return `files:${leftUri.toString()}\u0000${rightUri.toString()}`;
}

function isTwoWayStateDocument(state: TwoWayDiffState | undefined, uri: vscode.Uri): boolean {
    return state?.leftUri?.toString() === uri.toString()
        || state?.rightUri?.toString() === uri.toString();
}

function parseSerializedPanel(value: unknown): SerializedPanel | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1) {
        return undefined;
    }
    if (candidate.kind === 'files' && typeof candidate.leftUri === 'string' && typeof candidate.rightUri === 'string') {
        return { version: 1, kind: 'files', leftUri: candidate.leftUri, rightUri: candidate.rightUri };
    }
    return candidate.kind === 'history' && typeof candidate.fileUri === 'string'
        ? { version: 1, kind: 'history', fileUri: candidate.fileUri }
        : undefined;
}
