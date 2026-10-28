import * as vscode from 'vscode';
import { lstat, realpath } from 'fs/promises';
import { SourceRef, resolveSourceRef } from 'bygone-strand/source-references';
import * as path from 'path';
import { DiffViewProvider, FollowingView } from './diffViewProvider';
import { buildTwoWayDiffModel } from './diffEngine';
import { checkFollowText, FollowBaseline, resolveFollowBaseline, resolveFollowLocation } from './followBaseline';
import { resolveIndexSnapshot } from './followSnapshots';
import { GitIntegration, GitTarget, changeContains, decodeGitUri, diffTarget } from './gitIntegration';
import { isFollowEdit, FollowEditRequest, minimalEdit, OffsetRange, trackRange } from './followEdits';
import { analyzeLiveSymbols, LiveSymbol, LiveSymbolResult, snapshotDigest } from './liveSymbols';
import type { FollowViewState, ShowDiffMessage } from './webviewMessages';

interface Focus { right?: OffsetRange; left?: OffsetRange; name: string; id: number }
interface Projection { token: string; identity: string; document: vscode.TextDocument; version: number; range: OffsetRange; content: string }

/** A contextual comparison owns snapshots; VS Code alone owns mutable documents. */
export class FollowController implements vscode.Disposable, vscode.WebviewPanelSerializer {
    public static readonly viewType = 'bygone.followPanel';
    private view?: FollowingView;
    private reviewBaseline = false;
    private mode: FollowViewState['mode'] = 'paused';
    private document?: vscode.TextDocument;
    private baseline?: FollowBaseline;
    private rightSnapshot?: FollowBaseline;
    private target?: GitTarget;
    private indexRenameSource?: string;
    private lastEditor?: vscode.TextEditor;
    private subscriptions: vscode.Disposable[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private request?: AbortController;
    private generation = 0;
    private context = 0;
    private capturedLeft?: string;
    private capturedRight?: string;
    private pendingSymbol?: vscode.TextEditor;
    private blockedInput?: string;
    private expectedEdit?: string;
    private serial = 0;
    private focus?: Focus;
    private symbols?: { key: string; value: LiveSymbolResult };
    private projection?: Projection;
    private projections = new Map<string, Projection>();
    private draft?: { token: string; content: string };
    private storageRevision = 0;
    private ack?: { id: number; accepted: boolean };
    private editing = false;
    private actionQueue: Promise<void> = Promise.resolve();
    private notice = '';
    private gitAdvanced = false;
    private followSymbol = vscode.workspace.getConfiguration('bygone').get<boolean>('followSymbol', false);
    private git?: GitIntegration;
    private selectionGeneration = 0;
    private selectionRequest?: AbortController;
    private readonly recoveryUris = new Set<string>();
    private readonly snapshots = new Map<string, string>();
    private readonly snapshotProvider = vscode.workspace.registerTextDocumentContentProvider('bygone-snapshot', {
        provideTextDocumentContent: uri => this.snapshots.get(uri.toString()) ?? ''
    });

    constructor(private readonly provider: DiffViewProvider,
        private readonly readBaseline: typeof resolveFollowBaseline = resolveFollowBaseline,
        private readonly storage?: vscode.Memento) {
        const saved = storage?.get<{ content: string; language: string }>('bygone.followDraft');
        if (saved && typeof saved.content === 'string') {
            void vscode.workspace.openTextDocument({ content: saved.content, language: saved.language }).then(async doc => {
                this.recoveryUris.add(doc.uri.toString());
                await vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false });
                if (this.storageRevision === 0) await this.persistDraft();
                void vscode.window.showWarningMessage('Bygone recovered an unapplied draft from the previous session.');
            });
        }
    }

    private persistDraft(value?: { content: string; language: string }): Thenable<void> | undefined {
        this.storageRevision++;
        return this.storage?.update('bygone.followDraft', value);
    }
    public start(): void {
        if (vscode.window.activeTextEditor) this.lastEditor = vscode.window.activeTextEditor;
        if (!this.view) this.open(); else this.view.reveal(true);
        this.resume();
    }
    private open(restored?: vscode.WebviewPanel): void {
        this.view = this.provider.createFollowingView(FollowController.viewType,
            (action, token) => {
                this.actionQueue = this.actionQueue.then(() => this.action(action, token)).catch(error => {
                    void vscode.window.showWarningMessage(`Bygone could not complete ${action}: ${error instanceof Error ? error.message : String(error)}`);
                });
            }, () => this.stop(), restored,
            message => { void this.receive(message); });
        this.git = new GitIntegration(repo => {
            if (!this.target || (repo && ![this.target.leftPath, this.target.rightPath].some(p => {
                const relative = path.relative(repo.rootUri.fsPath, p);
                return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
            }))) return;
            if (this.mode === 'pinned') { this.gitAdvanced = true; this.schedule(); }
            else this.refresh();
        });
        void this.git.initialize();
        this.subscriptions.push(this.git,
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor?.document.uri.scheme === 'file') this.lastEditor = editor;
                if (this.mode === 'following') this.select(editor);
            }),
            vscode.window.tabGroups.onDidChangeTabs(() => this.tabChanged()),
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.tabChanged()),
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (this.followSymbol && this.mode === 'following' && !this.editing && event.kind !== undefined) void this.compareSymbol(event.textEditor);
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (event.document !== this.document || this.mode === 'paused') return;
                if (this.focus?.right && this.target?.policy !== 'head-index') {
                    const moved = trackRange(this.focus.right, event.contentChanges, this.expectedEdit === event.document.getText());
                    if (moved) this.focus.right = moved;
                    else { this.focus = undefined; this.notice = 'Selected declaration changed at its boundary or was replaced. Showing file context.'; }
                }
                this.schedule();
            }),
            vscode.workspace.onDidSaveTextDocument(doc => { if (doc === this.document) this.schedule(); }),
            vscode.workspace.onDidCloseTextDocument(doc => {
                this.recoveryUris.delete(doc.uri.toString());
                if (this.lastEditor?.document === doc) this.lastEditor = undefined;
                if (doc === this.document) { this.document = undefined; this.projection = undefined; this.schedule(); }
            }),
            vscode.window.onDidChangeWindowState(state => { if (state.focused && this.mode === 'following') this.refresh(); }),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('bygone.followSymbol')) this.followSymbol = vscode.workspace.getConfiguration('bygone').get<boolean>('followSymbol', false);
            })
        );
    }
    public async deserializeWebviewPanel(panel: vscode.WebviewPanel): Promise<void> {
        if (this.view) { panel.dispose(); return; }
        this.open(panel); this.mode = 'paused';
        this.unavailable('Following is paused after reload. Select a source file and choose Resume Following.');
    }
    public async openScm(policy: 'head-index' | 'index-working', resource: unknown): Promise<void> {
        const value = Array.isArray(resource) ? resource[0] : resource;
        const uri = value instanceof vscode.Uri ? value : (value as { resourceUri?: vscode.Uri } | undefined)?.resourceUri;
        if (!(uri instanceof vscode.Uri) || uri.scheme !== 'file') { void vscode.window.showInformationMessage('Select a Git source-control file.'); return; }
        if (!this.view) this.open(); else this.view.reveal(true);
        await this.git?.initialize();
        const repository = this.git?.repository(uri);
        if (!repository) { this.blockInput('VS Code Git integration is unavailable for this file.'); return; }
        if (repository.state.mergeChanges.some(c => changeContains(c, uri))) { this.blockInput('Merge conflicts are not supported. Resolve them in VS Code first.'); return; }
        const changes = policy === 'head-index' ? repository.state.indexChanges : [...repository.state.workingTreeChanges, ...(repository.state.untrackedChanges ?? [])];
        const change = changes.find(c => changeContains(c, uri));
        const right = change?.renameUri ?? change?.uri ?? uri;
        this.mode = 'following';
        // A staged rename already lives at the destination in the index. Git may
        // still report its original path on an accompanying working change.
        const stagedRename = repository.state.indexChanges.some(c => c.renameUri?.fsPath === right.fsPath);
        const leftPath = policy === 'index-working' && stagedRename ? right.fsPath : change?.originalUri?.fsPath ?? right.fsPath;
        this.setTarget({ policy, leftPath, rightPath: right.fsPath });
    }
    /** Explicit handoff from pinned evidence; mutable content remains owned by TextDocument. */
    public async openReviewEvidence(root: string, ref: SourceRef, source: string, wholeFile = false, workingPath = ref.path, isCurrent = () => true): Promise<boolean> {
        if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Review editing requires a trusted local workspace.');
        if (resolveSourceRef(ref, { revision: ref.revision, files: { [ref.path]: source } }).status !== 'valid') throw new Error('Review evidence snapshot or range is invalid.');
        const file = path.join(root, workingPath);
        const relative = path.relative(await realpath(root), await realpath(file));
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !(await lstat(file)).isFile()) {
            throw new Error('Working counterpart must be a regular file inside the selected repository.');
        }
        if (!isCurrent()) return false;
        if (!this.view) this.open();
        const token = ++this.selectionGeneration;
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        if (!isCurrent()) return false;
        const version = document.version, current = document.getText();
        checkFollowText(source); checkFollowText(current);
        let range: OffsetRange | undefined;
        if (!wholeFile) {
            if (current === source) range = { start: ref.start, end: ref.end };
            else {
                try {
                    const mapping = await analyzeLiveSymbols(path.join(root, ref.path), file, source, current);
                    range = mapping.pairs.find(p => p.source.start === ref.start && p.source.end === ref.end)?.destination;
                } catch { /* Unsupported syntax or analysis failure keeps full-file context. */ }
            }
        }
        if (!isCurrent()) return false;
        if (token !== this.selectionGeneration || document.version !== version) throw new Error('Working content or selection changed during mapping; retry the handoff.');
        this.setTarget({ policy: 'head-working', leftPath: path.join(root, ref.path), rightPath: file });
        this.reviewBaseline = true;
        this.mode = 'pinned';
        this.baseline = { root, relativePath: ref.path, oid: ref.revision, content: source, absent: false };
        this.document = document;
        this.capturedLeft = source; this.capturedRight = current;
        if (range) this.focus = { left: { start: ref.start, end: ref.end }, right: { start: range.start, end: range.end }, name: 'Review evidence', id: ++this.serial };
        this.notice = !wholeFile && !range ? 'No exact symbol mapping; showing full-file working context. Return to Evidence Review preserves the pinned review.' : 'Editing live working content. Return to Evidence Review preserves the pinned review.';
        this.view?.reveal(true); this.schedule();
        return true;
    }
    private setTarget(target: GitTarget): void {
        this.cancel(); this.context++; this.selectionGeneration++; this.selectionRequest?.abort();
        this.reviewBaseline = false;
        this.target = target; this.document = undefined; this.baseline = undefined; this.rightSnapshot = undefined;
        this.indexRenameSource = target.policy === 'index-working'
            ? this.git?.repository(vscode.Uri.file(target.rightPath))?.state.indexChanges.find(c => c.renameUri?.fsPath === target.rightPath)?.originalUri.fsPath
            : undefined;
        this.focus = undefined; this.symbols = undefined; this.projection = undefined; this.notice = ''; this.gitAdvanced = false;
        this.capturedLeft = undefined; this.capturedRight = undefined; this.blockedInput = undefined;
        this.schedule();
    }
    public pin(): void {
        if (!this.target || !this.baseline || !this.view) return;
        this.selectionGeneration++; this.selectionRequest?.abort();
        this.mode = 'pinned'; this.schedule();
    }
    public pause(): void { if (this.view) { this.cancel(); this.selectionGeneration++; this.selectionRequest?.abort(); this.mode = 'paused'; this.unavailable('Following paused. Choose Resume Following to continue.'); } }
    public resume(): void {
        if (!this.view) return;
        this.mode = 'following'; this.reviewBaseline = false; this.gitAdvanced = false;
        this.baseline = undefined; this.rightSnapshot = undefined;
        this.select(vscode.window.activeTextEditor ?? this.lastEditor);
        this.refresh();
    }
    public refresh(): void {
        if (!this.view || this.mode === 'paused') return;
        if (this.mode === 'following') {
            if (this.target?.policy === 'head-index') {
                const uri = vscode.Uri.file(this.target.rightPath), repository = this.git?.repository(uri);
                if (repository) {
                    const change = repository.state.indexChanges.find(c => changeContains(c, uri));
                    this.target = { ...this.target, leftPath: change?.originalUri?.fsPath ?? this.target.rightPath,
                        rightPath: (change?.renameUri ?? change?.uri)?.fsPath ?? this.target.rightPath };
                }
            }
            if (this.target?.policy === 'index-working') {
                const uri = vscode.Uri.file(this.target.rightPath), repository = this.git?.repository(uri);
                if (repository) {
                    // Prefer a current destination over a historical source when
                    // several reported renames mention the same path.
                    const find = (changes: typeof repository.state.indexChanges) => changes.find(c => (c.renameUri ?? c.uri).fsPath === uri.fsPath)
                        ?? changes.find(c => changeContains(c, uri));
                    // Git reports a chain A→B→C as A→C. Retain that HEAD-side
                    // source while the index rename exists, without using it as
                    // the index endpoint (which lives at the destination).
                    const staged = find(repository.state.indexChanges)
                        ?? repository.state.indexChanges.find(c => c.renameUri && c.originalUri.fsPath === this.indexRenameSource);
                    const working = find([...repository.state.workingTreeChanges, ...(repository.state.untrackedChanges ?? [])]);
                    const rightPath = (working?.renameUri ?? staged?.renameUri ?? working?.uri)?.fsPath ?? this.target.rightPath;
                    const inIndex = repository.state.indexChanges.some(c => c.renameUri?.fsPath === rightPath);
                    const leftPath = inIndex ? rightPath : working?.originalUri?.fsPath ?? rightPath;
                    if (rightPath !== this.target.rightPath || leftPath !== this.target.leftPath) {
                        this.setTarget({ policy: 'index-working', leftPath, rightPath }); return;
                    }
                    this.indexRenameSource = staged?.renameUri ? staged.originalUri.fsPath : undefined;
                }
            }
            this.baseline = undefined; this.rightSnapshot = undefined; this.symbols = undefined;
        }
        this.schedule();
    }
    private tabChanged(): void {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const input = tab?.input;
        if (this.mode === 'following' && tab && (input instanceof vscode.TabInputTextDiff
            || input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputNotebookDiff
            || input instanceof vscode.TabInputCustom || input === undefined)) this.select(vscode.window.activeTextEditor);
    }
    private select(editor: vscode.TextEditor | undefined): void {
        if (editor && this.recoveryUris.has(editor.document.uri.toString())) return;
        this.blockedInput = undefined;
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        const input = tab?.input;
        if (input instanceof vscode.TabInputTextDiff) {
            if (!vscode.workspace.getConfiguration('bygone').get<boolean>('followScmDiffs', false)) {
                this.blockInput('SCM diff following is off. Enable Bygone: Follow SCM Diffs or use Open in Bygone in Source Control.'); return;
            }
            const target = diffTarget(input);
            if (!target) { this.blockInput('Unsupported SCM diff endpoints. Use Open in Bygone from Source Control.'); return; }
            if (JSON.stringify(target) !== JSON.stringify(this.target)) this.setTarget(target);
            return;
        }
        // Built-in image previews in newer VS Code versions have an active tab
        // but no typed input. They must clear the previous text comparison too.
        if (input instanceof vscode.TabInputNotebook || input instanceof vscode.TabInputNotebookDiff || input instanceof vscode.TabInputCustom
            || (tab && input === undefined)) {
            this.blockInput('Notebook, custom and binary editors cannot be followed. Open a local text source file.'); return;
        }
        if (!editor || editor.document.uri.scheme === 'bygone-snapshot') {
            if (!this.target) this.unavailable('Select a local source file to follow.'); return;
        }
        if (editor.document.uri.scheme !== 'file') { this.blockInput('Following supports local file documents only.'); return; }
        this.lastEditor = editor;
        if (this.target?.rightPath === editor.document.uri.fsPath) { this.schedule(); return; }
        this.setTarget({ policy: 'head-working', leftPath: editor.document.uri.fsPath, rightPath: editor.document.uri.fsPath });
    }
    private cancel(): void { ++this.generation; clearTimeout(this.timer); this.request?.abort(); this.request = undefined; }
    private blockInput(status: string): void { this.cancel(); this.blockedInput = status; this.unavailable(status); }
    private schedule(): void {
        this.cancel(); const generation = this.generation;
        this.timer = setTimeout(() => { void this.render(generation); }, 100);
    }
    private update(message: Omit<ShowDiffMessage, 'type'>): void {
        this.view?.update({ ...message, followAck: this.ack }); this.ack = undefined;
    }
    private unavailable(status: string): void {
        this.projection = undefined;
        this.update({ file1: 'Baseline', file2: this.target?.rightPath ?? 'Source file', leftContent: '', rightContent: '',
            diffModel: buildTwoWayDiffModel('', ''), history: null, editableSides: { left: false, right: false },
            follow: { mode: this.mode, status, unavailable: true, canPin: false } });
    }
    private async render(generation: number): Promise<void> {
        const target = this.target, view = this.view;
        if (!target || !view || this.mode === 'paused') return;
        if (this.blockedInput) { this.unavailable(this.blockedInput); return; }
        const valid = () => generation === this.generation && view === this.view;
        const request = new AbortController(); this.request = request;
        try {
            if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before following files.');
            if (vscode.env.remoteName) throw new Error('Following supports local file documents only.');
            const uri = vscode.Uri.file(target.rightPath);
            const capturedStagedPin = this.mode === 'pinned' && target.policy === 'head-index' && this.baseline && this.rightSnapshot;
            const repository = this.git?.repository(uri);
            if (target.policy !== 'head-working' && !repository && !capturedStagedPin) throw new Error('VS Code Git integration is unavailable for this file.');
            if (!capturedStagedPin && repository?.state.mergeChanges.some(c => changeContains(c, uri))) throw new Error('Merge conflicts are not supported. Resolve them in VS Code first.');
            let document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString() && !d.isClosed);
            let exists = false;
            if (target.policy !== 'head-index') {
                try { exists = (await lstat(target.rightPath)).isFile(); if (!exists) throw new Error('Only regular text files can be followed.'); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                if (!document && exists) document = await vscode.workspace.openTextDocument(uri);
            }
            if (!valid()) return;
            this.document = document;
            const version = document?.version;
            const content = target.policy === 'head-index' || (!exists && !document?.isDirty) ? '' : document?.getText() ?? '';
            checkFollowText(content);
            if (!this.baseline || (target.policy === 'head-index' && !this.rightSnapshot)) {
                // Capture only the selected endpoints. Working bytes cannot block a staged view,
                // and an unrelated index blob cannot block HEAD-to-working comparisons.
                const firstIndex = target.policy === 'head-working' ? undefined :
                    await resolveIndexSnapshot(target.policy === 'index-working' ? target.leftPath : target.rightPath, request.signal);
                const baseline = target.policy === 'index-working' ? firstIndex! : await this.readBaseline(target.leftPath, request.signal);
                const secondIndex = target.policy === 'head-working' ? undefined :
                    await resolveIndexSnapshot(target.policy === 'index-working' ? target.leftPath : target.rightPath, request.signal);
                if (!valid()) return;
                if (firstIndex && secondIndex && (firstIndex.oid !== secondIndex.oid || firstIndex.content !== secondIndex.content)) { this.schedule(); return; }
                if (target.policy !== 'index-working') {
                    const headCheck = await this.readBaseline(target.leftPath, request.signal);
                    if (!valid()) return;
                    if (headCheck.oid !== baseline.oid) { this.schedule(); return; }
                }
                this.baseline = baseline; this.rightSnapshot = secondIndex;
            }
            if (!valid() || (target.policy !== 'head-index' && document?.version !== version)) { if (valid()) this.schedule(); return; }
            const baseline = this.baseline;
            // Snapshot paths use Git's physical root; document URIs may retain
            // directory aliases (notably macOS /var). Keep those URIs for edits.
            const rightRelativePath = target.leftPath === target.rightPath ? baseline.relativePath
                : target.policy === 'head-index' ? this.rightSnapshot!.relativePath
                    : path.relative(baseline.root, (await resolveFollowLocation(target.rightPath)).physicalPath);
            if (!valid() || (target.policy !== 'head-index' && document?.version !== version)) { if (valid()) this.schedule(); return; }
            const right = target.policy === 'head-index' ? this.rightSnapshot!.content : content;
            if (this.focus && this.capturedLeft !== undefined && this.capturedLeft !== baseline.content) this.focus.left = undefined;
            if (this.focus?.right && target.policy === 'head-index' && this.capturedRight !== undefined && this.capturedRight !== right) {
                const previous = this.focus.right;
                try {
                    const mapping = await analyzeLiveSymbols(target.rightPath, target.rightPath, this.capturedRight, right, request.signal);
                    if (!valid()) return;
                    const moved = mapping.pairs.find(p => p.source.start === previous.start && p.source.end === previous.end)?.destination;
                    if (moved) this.focus.right = { start: moved.start, end: moved.end };
                    else { this.focus = undefined; this.notice = 'Symbol has no verified mapping after Git changes. Showing file context.'; }
                } catch { if (!valid()) return; this.focus = undefined; this.notice = 'Symbol mapping unavailable after Git changes. Showing file context.'; }
            }
            this.capturedLeft = baseline.content; this.capturedRight = right;
            const rightAbsent = target.policy === 'head-index' ? this.rightSnapshot!.absent : !exists && !document?.isDirty;
            const editable = target.policy !== 'head-index' && !!document && exists;
            const leftLabel = target.policy === 'index-working' ? 'Index' : `${this.reviewBaseline ? 'Review snapshot' : 'HEAD'} (${baseline.oid?.slice(0, 12) ?? 'unborn HEAD'})`;
            let leftContent = baseline.content, rightContent = right;
            const focus = this.focus;
            if (focus) {
                leftContent = focus.left ? leftContent.slice(focus.left.start, focus.left.end) : '';
                rightContent = focus.right ? right.slice(focus.right.start, focus.right.end) : '';
            }
            const range = focus?.right ?? { start: 0, end: right.length };
            const identity = `${this.context}:${focus?.id ?? 'file'}`;
            if (editable && (!focus || focus.right)) {
                const token = String(++this.serial);
                this.projection = { token, identity, document: document!, version: version!, range: { ...range }, content: rightContent };
                this.projections.set(token, this.projection);
                // Retain recent projections for recovery and unchanged refreshes;
                // accepting an edit still requires matching the current projection.
                if (this.projections.size > 64) {
                    const oldest = [...this.projections.keys()].find(key => key !== this.draft?.token);
                    if (oldest) this.projections.delete(oldest);
                }
            } else this.projection = undefined;
            const dirty = target.policy === 'head-index' ? 'Index snapshot • Read-only' : `${document?.isDirty ? 'Unsaved buffer' : 'Saved buffer'}${!exists ? ' • Absent working file' : ''}`;
            const policyLabel = target.policy === 'head-index' ? 'HEAD → Index' : target.policy === 'index-working' ? 'Index → Working buffer' : this.reviewBaseline ? 'Review snapshot → Working buffer' : 'HEAD → Working buffer';
            const status = [baseline.root, `${baseline.relativePath}${target.leftPath !== target.rightPath ? ' → '+rightRelativePath : ''}`,
                policyLabel, dirty, baseline.absent ? 'No baseline at this path (addition)' : '',
                baseline.content === right && !baseline.absent ? `No changes from ${target.policy === 'index-working' ? 'index' : this.reviewBaseline ? 'review snapshot' : 'HEAD'}` : '',
                focus ? `Symbol: ${focus.name}${!focus.left || !focus.right ? ' • No verified counterpart' : ''}` : 'File context',
                this.followSymbol ? 'Follow Symbol on' : '', capturedStagedPin && !repository ? 'Git integration unavailable • Showing pinned snapshots' : '',
                this.gitAdvanced ? 'Git state advanced • Resume to update pinned snapshots' : '', this.notice].filter(Boolean).join(' • ');
            this.update({ file1: `${baseline.absent ? 'Absent • ' : ''}${leftLabel}`, file2: `${rightAbsent ? 'Absent • ' : ''}${rightRelativePath}`,
                comparisonId: identity, leftContent, rightContent,
                sourceInfo: { leftPath: target.leftPath, rightPath: target.rightPath, rightLanguageId: document?.languageId },
                diffModel: buildTwoWayDiffModel(leftContent, rightContent), history: null,
                editableSides: { left: false, right: !!this.projection }, readOnlyLabel: 'Snapshot is read-only',
                editBinding: this.projection ? { token: this.projection.token, projection: identity } : undefined,
                follow: { mode: this.mode, status, unavailable: false, canPin: true, canReturnToReview: this.reviewBaseline } });
            // Full-file rendering is independent of optional analysis. Focus ranges survive invalid syntax.
            if (this.pendingSymbol) { const editor = this.pendingSymbol; this.pendingSymbol = undefined; void this.compareSymbol(editor); }
            if (focus && this.mode !== 'pinned') void this.refreshSymbolMatch(generation, baseline.content, right, focus, request.signal);
        } catch (error) { if (valid()) this.unavailable(error instanceof Error ? error.message : String(error)); }
    }
    private async analysis(left: string, right: string, signal?: AbortSignal): Promise<LiveSymbolResult> {
        const target = this.target!;
        const key = `${target.leftPath}\0${target.rightPath}\0${snapshotDigest(left)}\0${snapshotDigest(right)}`;
        if (this.symbols?.key === key) return this.symbols.value;
        const value = await analyzeLiveSymbols(target.leftPath, target.rightPath, left, right, signal);
        this.symbols = { key, value }; return value;
    }
    private async refreshSymbolMatch(generation: number, left: string, right: string, focus: Focus, signal: AbortSignal): Promise<void> {
        try {
            const result = await this.analysis(left, right, signal);
            if (generation !== this.generation || this.focus !== focus || !focus.right) return;
            const symbol = result.right.find(s => s.start === focus.right!.start && s.end === focus.right!.end);
            if (!symbol) return; // Keep the guarded editing range during incomplete syntax.
            const paired = result.pairs.find(p => p.destination.start === symbol.start && p.destination.end === symbol.end)?.source;
            if (JSON.stringify(focus.left) !== JSON.stringify(paired && { start: paired.start, end: paired.end })) {
                focus.left = paired && { start: paired.start, end: paired.end }; focus.name = symbol.qualifiedName ?? symbol.name; this.schedule();
            }
        } catch { /* The valid editable projection remains usable when optional analysis cannot complete. */ }
    }
    public async compareSymbol(editor = vscode.window.activeTextEditor ?? this.lastEditor): Promise<void> {
        if (!editor || this.mode === 'pinned') return;
        if (!this.view || this.mode === 'paused') this.start();
        const target = this.target, baseline = this.baseline;
        if (!target || !baseline) { this.pendingSymbol = editor; return; }
        const sourcePath = decodeGitUri(editor.document.uri)?.path ?? editor.document.uri.fsPath;
        if (sourcePath !== target.rightPath && sourcePath !== target.leftPath) return;
        this.selectionRequest?.abort();
        const selectionRequest = new AbortController(); this.selectionRequest = selectionRequest;
        const generation = ++this.selectionGeneration, context = this.context, version = editor.document.version;
        const source = editor.document.getText(), offset = editor.document.offsetAt(editor.selection.active);
        const right = target.policy === 'head-index' ? this.rightSnapshot!.content : this.document?.getText() ?? '';
        const rightVersion = this.document?.version;
        const valid = () => generation === this.selectionGeneration && context === this.context && editor.document.version === version && this.document?.version === rightVersion
            && this.capturedLeft === baseline.content && (target.policy !== 'head-index' || this.capturedRight === right);
        try {
            const symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>('vscode.executeDocumentSymbolProvider', editor.document.uri);
            if (!valid()) return;
            const ranges: vscode.Range[] = [];
            const collect = (values: Array<vscode.DocumentSymbol | vscode.SymbolInformation>) => values.forEach(s => {
                const range = 'range' in s ? s.range : s.location.range;
                if (range.contains(editor.selection.active)) ranges.push(range);
                if ('children' in s) collect(s.children);
            });
            collect(symbols ?? []);
            if (!ranges.length) throw new Error('No enclosing symbol from the language provider. Showing file context.');
            const select = (entries: LiveSymbol[]) => entries.filter(s => s.start <= offset && offset < s.end
                && ranges.some(r => r.contains(editor.document.positionAt(s.start)) || (s.start <= editor.document.offsetAt(r.start) && s.end >= editor.document.offsetAt(r.end))))
                .sort((a, b) => (a.end-a.start)-(b.end-b.start))[0];
            const result = await this.analysis(baseline.content, right, selectionRequest.signal);
            if (!valid()) return;
            let chosen: LiveSymbol | undefined, left: LiveSymbol | undefined;
            if (source === right) chosen = select(result.right);
            else if (source === baseline.content) {
                left = select(result.left);
                chosen = result.pairs.find(p => p.source.start === left?.start && p.source.end === left?.end)?.destination;
            } else {
                const mapping = await analyzeLiveSymbols(sourcePath, target.rightPath, source, right, selectionRequest.signal);
                if (!valid()) return;
                const current = select(mapping.left);
                chosen = mapping.pairs.find(p => p.source.start === current?.start && p.source.end === current?.end)?.destination;
                if (!chosen) throw new Error('The dirty/source symbol has no verified mapping to this snapshot. Showing file context.');
            }
            if (!chosen && !left) throw new Error('Symbol is unsupported or ambiguous in this snapshot. Showing file context.');
            left ??= result.pairs.find(p => p.destination.start === chosen?.start && p.destination.end === chosen?.end)?.source;
            this.focus = { left: left && { start: left.start, end: left.end }, right: chosen && { start: chosen.start, end: chosen.end }, name: chosen?.qualifiedName ?? chosen?.name ?? left!.name, id: ++this.serial };
            this.notice = ''; this.schedule();
        } catch (error) {
            if (valid()) { this.focus = undefined; this.notice = error instanceof Error ? error.message : String(error); this.schedule(); }
        }
    }
    private async receive(message: unknown): Promise<void> {
        if (isFollowEdit(message)) { await this.applyEdit(message); return; }
        if (!message || typeof message !== 'object') return;
        const value = message as { type?: string; token?: string; content?: string };
        if (typeof value.token !== 'string' || typeof value.content !== 'string') return;
        if (value.type === 'followDraft' && this.projections.has(value.token)) {
            this.draft = { token: value.token, content: value.content };
            await this.persistDraft({ content: value.content, language: this.projections.get(value.token)!.document.languageId });
        }
        if (value.type === 'followRecover') {
            const draft = this.draft?.token === value.token && this.draft.content === value.content ? this.draft : undefined;
            await this.recover(value.token, value.content);
            if (draft && this.draft === draft) { this.draft = undefined; await this.persistDraft(); }
        }
    }
    private async applyEdit(edit: FollowEditRequest): Promise<void> {
        const projection = this.projections.get(edit.token), current = this.projection, draft = this.draft;
        let accepted = false;
        // An unchanged refresh may issue a new token during composition. Its earlier
        // projection is still valid only if every mutable endpoint guard agrees.
        if (vscode.workspace.isTrusted && !vscode.env.remoteName && !this.editing && projection && current
            && projection.identity === current.identity && projection.document === current.document
            && projection.range.start === current.range.start && projection.range.end === current.range.end
            && projection.content === current.content && !projection.document.isClosed
            && projection.version === projection.document.version && this.mode !== 'paused'
            && projection.document.getText().slice(projection.range.start, projection.range.end) === projection.content) {
            this.editing = true;
            try {
                checkFollowText(edit.content);
                const change = minimalEdit(projection.content, edit.content);
                if (change) {
                    const document = projection.document;
                    const update = new vscode.WorkspaceEdit();
                    const start = projection.range.start + change.rangeOffset;
                    update.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(start + change.rangeLength)), change.text);
                    // No await between version check and applyEdit; VS Code sends versioned text edits.
                    this.expectedEdit = document.getText().slice(0, start) + change.text + document.getText().slice(start + change.rangeLength);
                    checkFollowText(this.expectedEdit);
                    accepted = await vscode.workspace.applyEdit(update);
                } else accepted = true;
            } catch { accepted = false; }
            finally { this.editing = false; this.expectedEdit = undefined; }
        }
        this.ack = { id: edit.id, accepted };
        if (!accepted) this.notice = 'Source changed before this edit could be applied. Attempted text is preserved in a recovery document.';
        if (accepted && draft && this.draft === draft && draft.token === edit.token && draft.content === edit.content) { this.draft = undefined; void this.persistDraft(); }
        if (this.mode === 'paused' || !this.target) this.unavailable(this.notice || 'Following paused.'); else this.schedule();
    }
    private async recover(token: string, content: string): Promise<void> {
        const projection = this.projections.get(token), current = this.projection;
        // An old range (or a matching prefix) cannot prove a rejected draft was
        // applied. Only the complete, current projection can deduplicate it.
        if (projection && current && projection.identity === current.identity && projection.document === current.document
            && !current.document.isClosed && current.document.version === current.version && current.content === content
            && current.document.getText().slice(current.range.start, current.range.end) === content) return;
        const document = await vscode.workspace.openTextDocument({ language: projection?.document.languageId, content });
        this.recoveryUris.add(document.uri.toString());
        await vscode.window.showTextDocument(document, { preserveFocus: true, preview: false });
        void vscode.window.showWarningMessage('Bygone preserved unapplied edits in an untitled recovery document. The source was not overwritten.');
    }
    private async action(action: string, token?: string): Promise<void> {
        if (action === 'save' || action === 'undo' || action === 'redo') {
            const origin = token ? this.projections.get(token) : undefined;
            const valid = () => origin && this.projection && origin.identity === this.projection.identity
                && origin.document === this.projection.document && !origin.document.isClosed && this.mode !== 'paused';
            const stale = () => { void vscode.window.showWarningMessage(`Bygone did not ${action}: the comparison changed. Select the intended document and try again.`); };
            if (!valid()) { stale(); return; }
            const doc = origin!.document;
            if (action === 'save') await doc.save();
            else {
                await vscode.window.showTextDocument(doc, { viewColumn: this.lastEditor?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: false });
                if (!valid() || vscode.window.activeTextEditor?.document !== doc) { stale(); return; }
                await vscode.commands.executeCommand(action); this.view?.reveal();
            }
            return;
        }
        if (action === 'returnReview' && this.reviewBaseline) await vscode.commands.executeCommand('bygone.returnToEvidenceReview');
        if (action === 'pin') this.pin();
        if (action === 'resume') this.resume();
        if (action === 'refresh') this.refresh();
        if (action === 'symbol') await this.compareSymbol();
        if (action === 'file') { this.focus = undefined; this.notice = ''; this.schedule(); }
        if (action === 'followSymbol') { this.followSymbol = !this.followSymbol; this.schedule(); }
        if (action === 'working' && this.target) await this.openScm('index-working', vscode.Uri.file(this.target.rightPath));
        if (action === 'reveal') await this.revealSource();
        if (action === 'history' || action === 'compare') {
            const uri = this.target && vscode.Uri.file(this.target.rightPath); this.pause();
            await vscode.commands.executeCommand(action === 'history' ? 'bygone.compareActiveFileHistory' : 'bygone.compareFiles', uri);
        }
    }
    private async revealSource(): Promise<void> {
        if (!this.target || !this.baseline) return;
        if (this.target.policy !== 'head-index' && this.document && (!this.focus || this.focus.right)) {
            const range = this.focus?.right;
            await vscode.window.showTextDocument(this.document, { selection: range ? new vscode.Range(this.document.positionAt(range.start), this.document.positionAt(range.end)) : undefined });
        } else {
            const left = !!this.focus?.left && !this.focus.right;
            const content = left ? this.baseline.content : this.rightSnapshot?.content ?? '';
            const range = left ? this.focus?.left : this.focus?.right;
            const label = left && this.target.policy !== 'index-working' ? 'HEAD' : 'Index';
            const uri = vscode.Uri.from({ scheme: 'bygone-snapshot', path: '/'+label+'/'+path.basename(left ? this.target.leftPath : this.target.rightPath), query: snapshotDigest(content) });
            this.snapshots.set(uri.toString(), content);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { selection: range ? new vscode.Range(doc.positionAt(range.start), doc.positionAt(range.end)) : undefined });
        }
    }
    private stop(): void {
        this.cancel(); this.selectionGeneration++; this.selectionRequest?.abort();
        if (this.draft) {
            const revision = this.storageRevision;
            void this.recover(this.draft.token, this.draft.content).then(() => { if (revision === this.storageRevision) return this.persistDraft(); });
        }
        this.draft = undefined; this.mode = 'paused'; this.view = undefined; this.lastEditor = undefined;
        this.document = undefined; this.baseline = undefined; this.rightSnapshot = undefined; this.target = undefined; this.focus = undefined; this.projection = undefined;
        this.subscriptions.splice(0).forEach(s => s.dispose()); this.git = undefined;
    }
    public dispose(): void { const view = this.view; this.stop(); view?.dispose(); this.snapshotProvider.dispose(); }
}
