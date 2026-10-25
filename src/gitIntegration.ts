import * as vscode from 'vscode';

// The stable subset of vscode.git API v1 used on both supported VS Code versions.
export interface GitChange { uri: vscode.Uri; originalUri: vscode.Uri; renameUri?: vscode.Uri }
export interface GitRepository {
    rootUri: vscode.Uri;
    state: { indexChanges: GitChange[]; workingTreeChanges: GitChange[]; untrackedChanges?: GitChange[]; mergeChanges: GitChange[]; onDidChange: vscode.Event<void> };
}
interface GitAPI {
    repositories: GitRepository[];
    getRepository(uri: vscode.Uri): GitRepository | null;
    onDidOpenRepository: vscode.Event<GitRepository>;
    onDidCloseRepository: vscode.Event<GitRepository>;
    onDidChangeState: vscode.Event<unknown>;
}
interface GitExtension { enabled: boolean; getAPI(version: 1): GitAPI; onDidChangeEnablement: vscode.Event<boolean> }
export type ComparisonPolicy = 'head-working' | 'index-working' | 'head-index';
export interface GitTarget { policy: ComparisonPolicy; leftPath: string; rightPath: string }
export function changeContains(change: GitChange, uri: vscode.Uri): boolean {
    return [change.uri, change.originalUri, change.renameUri].some(value => value?.fsPath === uri.fsPath);
}
export function decodeGitUri(uri: vscode.Uri): { path: string; ref: string } | undefined {
    if (uri.scheme !== 'git') return undefined;
    try {
        const value = JSON.parse(uri.query);
        if (typeof value.path === 'string' && typeof value.ref === 'string' && !value.submoduleOf) return value;
    } catch { /* Unrecognized provider input is never interpreted as a working file. */ }
    return undefined;
}
export function diffTarget(input: vscode.TabInputTextDiff): GitTarget | undefined {
    const left = decodeGitUri(input.original), right = decodeGitUri(input.modified);
    if (left?.ref === 'HEAD' && right?.ref === '') return { policy: 'head-index', leftPath: left.path, rightPath: right.path };
    if (left && ['', '~', 'HEAD'].includes(left.ref) && input.modified.scheme === 'file') {
        return { policy: left.ref === 'HEAD' ? 'head-working' : 'index-working', leftPath: left.path, rightPath: input.modified.fsPath };
    }
    return undefined;
}

export class GitIntegration implements vscode.Disposable {
    private api?: GitAPI;
    private subscriptions: vscode.Disposable[] = [];
    private repositories = new Map<GitRepository, vscode.Disposable>();
    private disposed = false;
    constructor(private readonly changed: (repository?: GitRepository) => void) {}
    private initialization?: Promise<void>;
    initialize(): Promise<void> { return this.initialization ??= this.connect(); }
    private async connect(): Promise<void> {
        const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
        if (!extension) return;
        try {
            const exports = await extension.activate();
            if (this.disposed) return;
            const connect = () => {
                this.clear();
                if (!exports.enabled || this.disposed) { this.changed(); return; }
                this.api = exports.getAPI(1);
                const bind = (repo: GitRepository) => {
                    if (!this.repositories.has(repo)) this.repositories.set(repo, repo.state.onDidChange(() => this.changed(repo)));
                    this.changed(repo);
                };
                this.api.repositories.forEach(bind);
                this.subscriptions.push(this.api.onDidOpenRepository(bind), this.api.onDidCloseRepository(repo => {
                    this.repositories.get(repo)?.dispose(); this.repositories.delete(repo); this.changed(repo);
                }), this.api.onDidChangeState(() => { this.api?.repositories.forEach(bind); this.changed(); }));
            };
            connect();
            // Kept separately: reconnect clears only API subscriptions.
            this.enablement = exports.onDidChangeEnablement(connect);
        } catch { this.changed(); }
    }
    private enablement?: vscode.Disposable;
    repository(uri: vscode.Uri): GitRepository | undefined { return this.api?.getRepository(uri) ?? undefined; }
    private clear(): void {
        this.api = undefined;
        this.subscriptions.splice(0).forEach(s => s.dispose());
        this.repositories.forEach(s => s.dispose()); this.repositories.clear();
    }
    dispose(): void { this.disposed = true; this.clear(); this.enablement?.dispose(); }
}
