import * as vscode from 'vscode';
import { lstat } from 'fs/promises';
import { DiffViewProvider, FollowingView } from './diffViewProvider';
import { buildTwoWayDiffModel } from './diffEngine';
import { checkFollowText, FollowBaseline, resolveFollowBaseline } from './followBaseline';
import type { FollowViewState } from './webviewMessages';

/** Owns the opt-in session; the panel never owns or edits source documents. */
export class FollowController implements vscode.Disposable, vscode.WebviewPanelSerializer {
    public static readonly viewType = 'bygone.followPanel';
    private view?: FollowingView;
    private mode: FollowViewState['mode'] = 'paused';
    private document?: vscode.TextDocument;
    private baseline?: FollowBaseline;
    private lastEditor?: vscode.TextEditor;
    private subscriptions: vscode.Disposable[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private request?: AbortController;
    private generation = 0;

    constructor(
        private readonly provider: DiffViewProvider,
        private readonly readBaseline: typeof resolveFollowBaseline = resolveFollowBaseline
    ) {}

    public start(): void {
        if (vscode.window.activeTextEditor) this.lastEditor = vscode.window.activeTextEditor;
        if (!this.view) this.open();
        this.resume();
    }

    private open(restored?: vscode.WebviewPanel): void {
        this.view = this.provider.createFollowingView(
            FollowController.viewType, (action) => {
                if (action === 'pin') this.pin();
                if (action === 'resume') this.resume();
                if (action === 'refresh') this.refresh();
                if (action === 'history') {
                    const uri = this.document?.uri;
                    this.pause();
                    if (uri?.scheme === 'file') void vscode.commands.executeCommand('bygone.compareActiveFileHistory', uri);
                }
                if (action === 'compare') {
                    this.pause();
                    void vscode.commands.executeCommand('bygone.compareFiles', this.document?.uri);
                }
            }, () => this.stop(), restored
        );
        this.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) this.lastEditor = editor;
                if (this.mode === 'following') this.select(editor);
            }),
            vscode.window.tabGroups.onDidChangeTabs(() => this.checkUnsupportedTab()),
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.checkUnsupportedTab()),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (this.mode !== 'paused' && event.document === this.document) this.schedule();
            }),
            vscode.workspace.onDidSaveTextDocument((document) => {
                if (this.mode !== 'paused' && document === this.document) this.schedule();
            }),
            vscode.workspace.onDidCloseTextDocument((document) => {
                if (this.lastEditor?.document === document) this.lastEditor = undefined;
                if (document === this.document) {
                    this.cancel();
                    this.document = undefined;
                    this.baseline = undefined;
                    this.unavailable('Source document closed. Resume following or open a source file.');
                }
            }),
            vscode.window.onDidChangeWindowState((state) => {
                if (state.focused && this.mode === 'following') this.refresh();
            })
        );
    }

    public async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        if (this.view) { panel.dispose(); return; }
        this.open(panel);
        this.mode = 'paused';
        this.unavailable('Following is paused after reload. Select a source file and choose Resume Following.');
    }

    public pin(): void {
        if (!this.document || !this.baseline || !this.view) return;
        this.cancel();
        this.mode = 'pinned';
        this.schedule();
    }

    public pause(): void {
        if (!this.view) return;
        this.cancel();
        this.mode = 'paused';
        this.unavailable('Following paused. Choose Resume Following to continue.');
    }

    public resume(): void {
        if (!this.view) return;
        this.mode = 'following';
        const editor = vscode.window.activeTextEditor ?? this.lastEditor;
        this.select(editor?.document.isClosed ? undefined : editor);
    }

    public refresh(): void {
        if (!this.view || this.mode === 'paused' || !this.document) return;
        if (this.mode === 'following') this.baseline = undefined;
        this.schedule();
    }

    private unsupportedTabMessage(): string | undefined {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        if (input instanceof vscode.TabInputTextDiff) return 'Open the source file outside the SCM diff to follow it.';
        if (input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputNotebookDiff) return 'Notebook documents cannot be followed.';
        if (input instanceof vscode.TabInputCustom) return 'Custom and binary editors cannot be followed. Open a local text source file.';
        return undefined;
    }

    private checkUnsupportedTab(): void {
        if (this.mode === 'following' && this.unsupportedTabMessage()) this.select(undefined);
    }

    private select(editor: vscode.TextEditor | undefined): void {
        const unsupported = this.unsupportedTabMessage();
        // Bygone, terminals and other non-text UI retain the last source.
        if (!editor && !unsupported) {
            if (!this.document) this.unavailable('Select a local source file to follow.');
            return;
        }
        this.cancel();
        this.baseline = undefined;
        this.document = editor?.document;
        if (unsupported) {
            this.document = undefined;
            this.unavailable(unsupported);
            return;
        }
        this.lastEditor = editor;
        this.schedule();
    }

    private cancel(): void {
        ++this.generation;
        clearTimeout(this.timer);
        this.request?.abort();
        this.request = undefined;
    }

    private schedule(): void {
        this.cancel();
        const generation = this.generation;
        this.timer = setTimeout(() => { void this.render(generation); }, 100);
    }

    private unavailable(status: string): void {
        this.view?.update({
            file1: 'HEAD', file2: this.document?.uri.fsPath ?? 'Source file',
            leftContent: '', rightContent: '', diffModel: buildTwoWayDiffModel('', ''), history: null,
            editableSides: { left: false, right: false },
            follow: { mode: this.mode, status, unavailable: true, canPin: false }
        });
    }

    private async render(generation: number): Promise<void> {
        const document = this.document;
        const view = this.view;
        if (!document || !view || this.mode === 'paused') return;
        const version = document.version;
        const valid = () => generation === this.generation && this.view === view && !document.isClosed && document.version === version;
        if (!valid()) return;
        try {
            if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before following files.');
            if (vscode.env.remoteName || document.uri.scheme !== 'file') throw new Error('Following supports local file documents only.');
            const content = document.getText();
            checkFollowText(content);
            if (!this.baseline) {
                this.unavailable('Reading HEAD…');
                const info = await lstat(document.uri.fsPath);
                if (!valid()) return;
                if (!info.isFile()) throw new Error('Only regular text files can be followed.');
                const request = new AbortController();
                this.request = request;
                const baseline = await this.readBaseline(document.uri.fsPath, request.signal);
                if (!valid()) return;
                this.baseline = baseline;
            }
            if (!valid()) return;
            const baseline = this.baseline;
            const label = baseline.oid ? baseline.oid.slice(0, 12) : 'unborn HEAD';
            const status = `${baseline.root} • ${baseline.relativePath} • ${label}${baseline.absent ? ' • No baseline at this path (addition)' : ''} • ${document.isDirty ? 'Unsaved buffer' : 'Saved buffer'}${baseline.content === content && !baseline.absent ? ' • No changes from HEAD' : ''}`;
            view.update({
                file1: `${baseline.absent ? 'Absent' : 'HEAD'} (${label})`, file2: baseline.relativePath,
                comparisonId: `${document.uri.toString()}\0${baseline.oid}`,
                leftContent: baseline.content, rightContent: content,
                sourceInfo: { leftPath: document.uri.path, rightPath: document.uri.path, leftLanguageId: document.languageId, rightLanguageId: document.languageId },
                diffModel: buildTwoWayDiffModel(baseline.content, content), history: null,
                editableSides: { left: false, right: false }, readOnlyLabel: 'Edit in the source editor',
                follow: { mode: this.mode, status, unavailable: false, canPin: true }
            });
        } catch (error) {
            if (valid()) this.unavailable(error instanceof Error ? error.message : String(error));
        }
    }

    private stop(): void {
        this.cancel();
        this.mode = 'paused';
        this.view = undefined;
        this.lastEditor = undefined;
        this.document = undefined;
        this.baseline = undefined;
        for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    }

    public dispose(): void {
        const view = this.view;
        this.stop();
        view?.dispose();
    }
}
