import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { Review, fingerprint } from './requirements';
import { SourceRef } from 'bygone-strand/source-references';
import { FollowController } from './followController';
import { DiffViewProvider } from './diffViewProvider';
import { buildTwoWayDiffModel } from './diffEngine';
import { comparisonPaths, inspectWorkspace, loadReview, readPinnedFile, readEvidenceJson, refreshWorkspace, repositoryRoot, sourceText, writeReview } from './reviewWorkspace';
import { DependencyInspection, inspectDependencies } from './reviewDependencies';

const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** One pinned review, with explicit transitions to a separate live editor. */
export class EvidenceController implements vscode.Disposable {
    private panel?: vscode.WebviewPanel;
    private review?: Review;
    private root = '';
    private file = '';
    private dependencies?: DependencyInspection;
    private refs: SourceRef[] = [];
    private snapshots = new Map<string, string>();
    private provider = vscode.workspace.registerTextDocumentContentProvider('bygone-evidence', {
        provideTextDocumentContent: uri => this.snapshots.get(uri.toString()) ?? ''
    });
    private busy = false;
    private renderToken = '';
    private handoffGeneration = 0;
    private origin?: { review: Review; root: string; file: string; dependencies?: DependencyInspection };
    constructor(private readonly follower: FollowController, private readonly diff: DiffViewProvider) {}
    dispose(): void { this.panel?.dispose(); this.provider.dispose(); }
    async open(file?: vscode.Uri, repository?: vscode.Uri): Promise<void> {
        if (!vscode.workspace.isTrusted || vscode.env.remoteName) throw new Error('Evidence review requires a trusted local workspace.');
        file ??= (await vscode.window.showOpenDialog({ filters: { 'Review evidence': ['json'] }, canSelectMany: false }))?.[0];
        if (!file || file.scheme !== 'file') return;
        repository ??= vscode.workspace.getWorkspaceFolder(file)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        repository ??= (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: 'Bind evidence to repository' }))?.[0];
        if (!repository || repository.scheme !== 'file') return;
        const root = repositoryRoot(repository.fsPath), review = loadReview(root, file.fsPath);
        this.handoffGeneration++;
        this.root = root; this.file = file.fsPath; this.review = review; this.dependencies = undefined;
        this.ensurePanel();
        this.render(); this.panel!.reveal(vscode.ViewColumn.One);
    }
    private ensurePanel(): void {
        if (!this.panel) {
            const panel = vscode.window.createWebviewPanel('bygone.evidenceReview', 'Evidence Review', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
            this.panel = panel;
            panel.onDidDispose(() => { if (this.panel === panel) { this.handoffGeneration++; this.panel = undefined; this.refs = []; this.snapshots.clear(); } });
            panel.webview.onDidReceiveMessage((message: unknown) => {
                if (this.busy || !message || typeof message !== 'object' || (message as { token?: string }).token !== this.renderToken) return;
                this.busy = true;
                void this.action(message).catch(error => vscode.window.showErrorMessage(`Evidence review: ${error instanceof Error ? error.message : String(error)}`)).finally(() => { this.busy = false; });
            });
        }
    }
    returnToReview(): void {
        this.handoffGeneration++;
        if (this.review && !this.panel) { this.ensurePanel(); this.render(); }
        if (this.origin && this.review !== this.origin.review) {
            this.review = this.origin.review; this.root = this.origin.root;
            this.file = this.origin.file; this.dependencies = this.origin.dependencies;
            this.render();
        }
        this.panel?.reveal(vscode.ViewColumn.One);
    }
    private uri(ref: SourceRef, text: string): vscode.Uri {
        const uri = vscode.Uri.from({ scheme: 'bygone-evidence', path: '/' + ref.path, query: ref.revision });
        this.snapshots.set(uri.toString(), text); return uri;
    }
    private async action(message: unknown): Promise<void> {
        if (!message || typeof message !== 'object' || !this.review) return;
        const { action, index } = message as { action?: string; index?: number };
        const review = this.review, root = this.root;
        if (action === 'dependencies') {
            const file = (await vscode.window.showOpenDialog({ filters: { 'Dependency report': ['json'] }, canSelectMany: false }))?.[0];
            if (this.review !== review) return;
            if (file) this.dependencies = inspectDependencies(root, review, readEvidenceJson(file.fsPath));
            this.render(); return;
        }
        if (action === 'refresh') {
            const head = await vscode.window.showInputBox({ prompt: 'New committed revision (dirty buffers are excluded)', value: 'HEAD' });
            if (!head) return;
            const useMapping = await vscode.window.showQuickPick(['Refresh unchanged files only', 'Use a validated symbol correspondence artifact'], { placeHolder: 'Changed evidence remains unresolved without an exact mapping' });
            if (!useMapping) return;
            let correspondence: string | undefined;
            if (useMapping.startsWith('Use')) {
                correspondence = (await vscode.window.showOpenDialog({ filters: { 'Correspondence': ['json'] }, canSelectMany: false }))?.[0]?.fsPath;
                if (!correspondence) return;
            }
            const result = refreshWorkspace(root, review, head, correspondence);
            const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(this.file.replace(/\.json$/, '') + '.refreshed.json'), filters: { 'Review evidence': ['json'] } });
            if (!destination) return;
            if (this.review !== review) throw new Error('Review selection changed; retry the action.');
            writeReview(destination.fsPath, result.review);
            await this.open(destination, vscode.Uri.file(root)); return;
        }
        if (action === 'inspect') {
            if (!Number.isSafeInteger(index) || !review.requirements[index!]) return;
            const requirement = review.requirements[index!];
            const report = inspectWorkspace(root, review).requirements[index!];
            if (report.links.some(l => l.resolution.status !== 'valid')) throw new Error('Resolve broken evidence before recording inspection.');
            const note = await vscode.window.showInputBox({ prompt: `Inspection note for ${requirement.id} (this records inspection, not fulfillment)` });
            if (!note?.trim()) return;
            const updated = { ...review, decisions: [...review.decisions.filter(d => d.requirement !== requirement.id), { requirement: requirement.id, fingerprint: fingerprint(review, requirement.id), note }] };
            const destination = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(this.file.replace(/\.json$/, '') + '.inspected.json'), filters: { 'Review evidence': ['json'] } });
            if (!destination) return;
            if (this.review !== review) throw new Error('Review selection changed; retry the action.');
            writeReview(destination.fsPath, updated); this.review = updated; this.file = destination.fsPath; this.render(); return;
        }
        if (!Number.isSafeInteger(index)) return;
        const ref = this.refs[index!]; if (!ref) return;
        const text = sourceText(root, ref);
        if (action === 'edit' || action === 'edit-file') {
            const working = comparisonPaths(root, ref.revision, undefined, ref.path).after;
            const origin = { review, root, file: this.file, dependencies: this.dependencies };
            const generation = ++this.handoffGeneration;
            const isCurrent = () => generation === this.handoffGeneration && this.review === review;
            try {
                const opened = await this.follower.openReviewEvidence(root, ref, text, action === 'edit-file', working, isCurrent);
                if (opened && isCurrent()) this.origin = origin;
            }
            catch (error) {
                if (!isCurrent()) return;
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                const document = await vscode.workspace.openTextDocument(this.uri(ref, text));
                if (!isCurrent()) return;
                await vscode.window.showTextDocument(document, { selection: new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end)), preview: false });
                void vscode.window.showInformationMessage('Working counterpart is absent. Showing read-only pinned evidence; no editable range was inferred.');
            }
            return;
        }
        if (action === 'source') {
            const document = await vscode.workspace.openTextDocument(this.uri(ref, text));
            await vscode.window.showTextDocument(document, { selection: new vscode.Range(document.positionAt(ref.start), document.positionAt(ref.end)), preview: false }); return;
        }
        if (action === 'diff') {
            this.follower.pause();
            const paths = comparisonPaths(root, review.base, review.head, ref.path);
            const left = readPinnedFile(root, review.base, paths.before)?.text ?? '';
            const right = readPinnedFile(root, review.head, paths.after)?.text ?? '';
            await this.diff.showDiff(this.uri({ ...ref, path: paths.before, revision: review.base }, left), this.uri({ ...ref, path: paths.after, revision: review.head }, right), left, right, buildTwoWayDiffModel(left, right),
                { editableSides: { left: false, right: false }, labels: [`${paths.before} @ ${review.base.slice(0, 12)}`, `${paths.after} @ ${review.head.slice(0, 12)}`] });
        }
    }
    private render(): void {
        if (!this.panel || !this.review) return;
        const review = this.review, report = inspectWorkspace(this.root, review);
        this.refs = [];
        const button = (action: string, index: number, label: string) => `<button data-action="${action}" data-index="${index}">${label}</button>`;
        const navigation = (ref: SourceRef) => {
            const index = this.refs.push(ref) - 1;
            return button('source', index, 'Pinned source') + button('diff', index, 'Pinned file diff') + button('edit', index, 'Edit working counterpart') + button('edit-file', index, 'Edit working file');
        };
        const requirements = report.requirements.map((r, index) => `<section><h2>${escape(r.id)}: ${escape(r.text)}</h2>
            <p>Verification: ${escape(r.verification)} · Inspection: ${escape(r.reviewer)}. Valid links do not establish fulfillment.</p>
            ${r.note ? `<p>Inspection note: ${escape(r.note)}</p>` : ''}
            ${r.sources.map(s => `<details><summary>${escape(s.title)}</summary><blockquote>${escape(s.quote)}</blockquote><pre>${escape(s.text)}</pre></details>`).join('')}
            ${r.questions.map(q => `<p>Question (${q.status}): ${escape(q.text)} ${'resolution' in q ? escape(q.resolution) : ''}</p>${q.alternatives.map(a => `<article><p>Alternative: ${escape(a.text)}</p>${a.sources.map(s => `<details><summary>${escape(s.title)}</summary><blockquote>${escape(s.quote)}</blockquote><pre>${escape(s.text)}</pre></details>`).join('')}</article>`).join('')}`).join('')}
            ${r.links.map(l => `<article><h3>${escape(l.role)}: ${escape(l.ref.path)}</h3><p>${escape(l.rationale)}</p><p>${escape(l.resolution.status)} · ${escape(l.ref.revision.slice(0, 12))} · UTF-16 ${l.ref.start}–${l.ref.end}</p>${l.resolution.status === 'valid' ? navigation(l.ref) : `<p>${escape(l.resolution.reason)}</p>`}</article>`).join('') || '<p>No evidence linked.</p>'}
            ${r.runs.map(run => `<p>Recorded execution: ${escape(run.command)} · ${escape(run.outcome)} · ${escape(run.applicability)} · ${escape(run.association.scope)}</p>`).join('')}
            ${button('inspect', index, 'Record inspection in new artifact')}</section>`).join('');
        const nonce = randomBytes(16).toString('hex');
        this.renderToken = nonce;
        this.panel.webview.html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font:14px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:24px;max-width:1000px}section,article{border:1px solid var(--vscode-panel-border);padding:16px;margin:16px 0}button{padding:7px;margin:4px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}h1,h2,h3{font-weight:500}p{line-height:1.5}</style></head><body>
            <h1>Evidence Review</h1><p>${escape(review.repository)} · ${escape(this.root)}</p><p>Pinned ${review.base.slice(0, 12)} → ${review.head.slice(0, 12)}. Working buffers excluded. ${report.checkoutHead !== review.head ? 'Checkout HEAD has advanced or differs.' : ''}</p>
            <p>Editing opens a separate live view. Use “Bygone: Return to Evidence Review” to return here.</p>${button('refresh', 0, 'Refresh to committed revision')}${button('dependencies', 0, 'Load dependency evidence')}
            ${requirements}<section><h2>Changed files without valid evidence links</h2><pre>${escape(report.changedPathsWithoutLinks.join('\n') || 'None')}</pre><p>File-level coverage only; linked files may still contain unexplained changes.</p></section>
            <section><h2>Analysis receipts</h2>${report.analyses.map(a => `<p>${escape(a.producer)} · ${escape(a.status)} · ${escape(a.relevance)}</p><pre>${escape([...a.scope, ...a.limitations].join('\n'))}</pre>`).join('') || '<p>No analysis recorded.</p>'}</section>
            <section><h2>Dependency inspection</h2>${this.dependencies ? `<pre>${escape(this.dependencies.limitations.join('\n'))}</pre>${this.dependencies.links.map(l => `<article><p>${escape(l.title)} · phase ${escape(l.phase)} · loading ${escape(l.loading)} · ${escape(l.resolution)}</p>${navigation(l.ref)}</article>`).join('')}` : '<p>No dependency report loaded. Generate one for these exact base/head revisions. Dependency evidence does not determine requirement fulfillment.</p>'}</section>
            <script nonce="${nonce}">const api=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button)api.postMessage({token:'${nonce}',action:button.dataset.action,index:Number(button.dataset.index)});});</script></body></html>`;
    }
}
