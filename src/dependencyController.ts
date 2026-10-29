import * as vscode from 'vscode';
import * as path from 'path';
import { createHash } from 'crypto';
import { DependencyEvidenceReport } from './dependencyEvidence';
import { DependencySource } from './dependencyGraph';
import { resolveBranchReviewRange } from './gitComparison';
import { loadChangeCorrespondence, ChangeCorrespondence } from './changeCorrespondence';
import { readPinnedFile } from './reviewWorkspace';
// Shared with the desktop host; all Git/parser work runs in its bounded child process.
import { buildNativeDependencyView, dependencySource } from '../cli/dependency-native';

export interface DependencyContext { repoRoot: string; baseOid: string; headOid: string; file?: string }
export class DependencyController implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private generation = 0;
    private report?: DependencyEvidenceReport;
    private root = '';
    private context?: DependencyContext;
    private analysis?: AbortController;

    private snapshots = new Map<string, string>();
    private readonly provider = vscode.workspace.registerTextDocumentContentProvider('bygone-dependency', {
        provideTextDocumentContent: uri => this.snapshots.get(uri.toString()) ?? ''
    });
    dispose(): void { this.generation++; this.analysis?.abort(); this.panel?.dispose(); this.provider.dispose(); this.snapshots.clear(); }
    async open(context?: DependencyContext, correspondence?: ChangeCorrespondence): Promise<void> {
        if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Dependencies require a trusted local workspace.');
        const editor = vscode.window.activeTextEditor;
        const localFile = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
        if (!context && editor?.document.uri.scheme === 'bygone-dependency' && this.report) {
            context = { repoRoot: this.root, baseOid: this.report.range.baseOid, headOid: this.report.range.headOid, file: editor.document.uri.path.slice(1) };
        }
        if (!context) {
            const start = localFile ? path.dirname(localFile) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!start) throw new Error('Open a repository before inspecting dependencies.');
            const range = resolveBranchReviewRange(start);
            context = { repoRoot: range.repoRoot, baseOid: range.mergeBaseOid, headOid: range.headOid };
        }
        const file = context.file ?? (localFile ? path.relative(context.repoRoot, localFile).split(path.sep).join('/') : undefined);
        const pinnedEditor = editor?.document.uri.scheme === 'bygone-dependency';
        const focus = file && !file.startsWith('../') ? { file,
            revision: pinnedEditor && editor.document.uri.query === context.baseOid ? 'base' as const : 'head' as const,
            start: pinnedEditor ? editor.document.offsetAt(editor.selection.active) : undefined } : undefined;
        if (!this.panel) {
            const panel = vscode.window.createWebviewPanel('bygone.dependencies', 'Dependencies', vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
            this.panel = panel;
            panel.onDidDispose(() => { if (this.panel === panel) { this.generation++; this.analysis?.abort(); this.panel = undefined; this.report = undefined; } });
            panel.webview.onDidReceiveMessage((message: unknown) => {
                if (!message || typeof message !== 'object' || !this.report) return;
                if ((message as { type?: string }).type === 'dependencyLoadCorrespondence') {
                    void this.loadCorrespondence().catch(error => vscode.window.showErrorMessage(String(error))); return;
                }
                if ((message as { type?: string }).type !== 'dependencySource') return;
                const source: DependencySource | undefined = dependencySource(this.report, (message as { source?: unknown }).source);
                if (source) void this.openSource(source).catch(error => vscode.window.showErrorMessage(String(error)));
            });
        }
        const generation = ++this.generation, panel = this.panel;
        this.analysis?.abort();
        const analysis = new AbortController(); this.analysis = analysis;
        this.report = undefined;
        panel.reveal(vscode.ViewColumn.Beside);
        panel.webview.html = '<!doctype html><html><body><p role="status">Analyzing pinned dependency snapshots…</p></body></html>';
        try {
            const result = await buildNativeDependencyView(context.repoRoot, { baseOid: context.baseOid, headOid: context.headOid, focus, correspondence, signal: analysis.signal });
            if (generation !== this.generation) return;
            this.root = context.repoRoot; this.report = result.report; this.context = context;
            panel.webview.html = result.html;
        } catch (error) {
            if (generation === this.generation) {
                panel.webview.html = '<!doctype html><html><body><p>Dependency analysis failed. See the notification for details.</p></body></html>';
                throw error;
            }
        }
    }
    private async loadCorrespondence(): Promise<void> {
        const context = this.context, generation = this.generation;
        if (!context) return;
        const file = (await vscode.window.showOpenDialog({ filters: { 'Symbol correspondence': ['json'] }, canSelectMany: false }))?.[0];
        if (!file || file.scheme !== 'file' || generation !== this.generation) return;
        const correspondence = loadChangeCorrespondence(context.repoRoot, file.fsPath, context);
        await this.open(context, correspondence);
    }
    private async openSource(source: DependencySource): Promise<void> {
        const pinned = readPinnedFile(this.root, source.oid, source.file);
        if (!pinned || pinned.blob !== source.blobOid
            || createHash('sha256').update(pinned.text.slice(source.start, source.end)).digest('hex') !== source.digest) {
            throw new Error('Pinned dependency source is unavailable or changed.');
        }
        const text = pinned.text;
        const uri = vscode.Uri.from({ scheme: 'bygone-dependency', path: '/' + source.file, query: source.oid });
        this.snapshots.set(uri.toString(), text);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: true,
            selection: new vscode.Range(document.positionAt(source.start), document.positionAt(source.end)) });
    }
}
