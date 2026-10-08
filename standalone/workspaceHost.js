/* global module, require */
const path = require('path');
const { revisionFileAction, revisionDirectoryView, revisionPanelsView, revisionRailItems } = require('../out/revisionView.js');

// Owns mode cursors, not editor capabilities. The native host continues to own
// editable sessions, saving, window lifetime, and confirmation dialogs.
function createWorkspaceHost(host, git) {
    let state = null;
    let serial = 0;
    let busy = false;

    function ensure() {
        const current = host.getSession();
        if (state && (current.workspaceId === state.id || current === state.owner || current === state.original || [...state.saved.values()].includes(current))) return state;
        const key = JSON.stringify(current.source);
        if (!state || state.sourceKey !== key || current !== state.owner) {
            state?.tour?.dispose?.();
            const context = git.resolve(current.source, { pinnedRevisions: current.source?.resolvedRevisions });
            state = {
                id: `workspace-${++serial}`, sourceKey: key, source: current.source,
                context, mode: 'compare', draft: [], saved: new Map(), navigation: new Map(),
                original: null, owner: current, backend: null, backendError: '', status: '', tours: [], originalNavigation: null,
                includeStaged: Boolean(current.source?.includeStaged), skipUnchanged: Boolean(current.source?.skipUnchanged)
            };
        }
        return state;
    }

    function backend() {
        const current = ensure();
        if (current.context.kind !== 'ready') throw new Error(current.context.reason);
        if (current.backendError) throw new Error(current.backendError);
        if (!current.backend) {
            try { current.backend = git.history(current.context, { includeStaged: current.includeStaged }); }
            catch (error) { current.backendError = error.message; throw error; }
        }
        return current.backend;
    }

    function activePath() {
        const current = host.getSession();
        if (current.workspaceView) return current.workspaceView.path;
        const relative = current.returnDirectory?.relativePath || current.dirHistory?.viewRelativePath;
        if (relative) return relative;
        const panel = current.multi?.files.find((file) => file.id === current.multi.activePanelId);
        const absolute = panel?.path || current.right?.path;
        const context = ensure().context;
        if (context.kind !== 'ready') return null;
        const index = current.multi?.files.indexOf(panel);
        if (context.paths[index]?.type === 'file') return context.paths[index].path;
        if (absolute && !current.directory) return path.relative(context.repoRoot, absolute).split(path.sep).join('/');
        return context.paths.find((item) => item.type === 'file')?.path || null;
    }

    function selectedRevisions() {
        const current = host.getSession();
        return current.workspaceView?.revisions || (ensure().context.kind === 'ready' ? state.context.revisions : []);
    }

    function uiState() {
        const current = ensure();
        const context = current.context;
        const revisions = selectedRevisions();
        const rangeKey = JSON.stringify(revisions);
        if (current.rangeKey !== rangeKey) {
            current.rangeKey = rangeKey;
            current.range = context.kind === 'ready' ? git.range(context.repoRoot, revisions) : { status: 'unavailable', reason: context.reason };
        }
        const range = current.range;
        return {
            sessionId: current.id, mode: current.tourMode || current.mode, availableTours: current.tours,
            modeLabels: current.tour?.modeLabels,
            nativeSkillFiles: typeof host.chooseTourSkill === 'function',
            tourSkill: current.tourSkill || host.defaultTourSkill?.(),
            canReturn: Boolean(current.original && (current.tourMode || host.getSession() !== current.original)),
            history: { enabled: context.kind === 'ready' && !current.backendError, label: 'History', reason: current.backendError || (context.kind === 'ready' ? context.notice || '' : context.reason) },
            promptContext: current.tourMode ? current.tour.promptContext : {
                repository: context.kind === 'ready' ? context.repoRoot : undefined,
                paths: context.kind === 'ready' ? context.paths.map((item) => item.path || '.') : [],
                revisions, rangeStatus: range.status, reason: range.reason
            },
            status: current.status,
            selectionCount: current.draft.length,
            canSelectRevisions: context.kind === 'ready' && !current.backendError
        };
    }

    function rail() {
        const current = ensure();
        const history = backend();
        const selectedPath = activePath();
        const changes = new Set(selectedPath ? history.changedCommits(selectedPath) : []);
        const revisions = selectedRevisions();
        const session = host.getSession();
        const active = session.multi?.files.find((panel) => panel.id === session.multi.activePanelId)?.revision
            || (session.workspaceView?.path === null ? revisions.at(-1) : null);
        const hasRevisionPanels = Boolean(session.workspaceView || current.source.resolvedRevisions);
        return {
            fileName: selectedPath || 'Repository', navigatorOnly: current.mode !== 'history', workingTreeControls: current.mode === 'history',
            includeStaged: current.includeStaged, skipUnchanged: current.skipUnchanged,
            canGoBack: current.mode === 'history', canGoForward: current.mode === 'history',
            positionLabel: current.mode === 'history' ? 'History' : 'Comparison',
            rail: {
                activeTabId: 'history', tabs: [{ id: 'history', label: 'Commits' }, { id: 'workspace-files', label: 'Files' }],
                itemsByTab: {
                    history: revisionRailItems(history.entries, {
                        displayed: hasRevisionPanels ? revisions : [], selected: current.draft, active, changed: changes,
                        selectionEnabled: true,
                        missingRevisionLabel: commit => `${commit === 'EMPTY' ? 'Empty tree' : commit.slice(0, 7)} Displayed base revision`
                    }),
                    'workspace-files': history.files.map((file) => ({ kind: 'directory-entry', workspaceFile: true, relativePath: file, label: file, active: file === selectedPath }))
                }
            }
        };
    }

    function augment(message) {
        if (!message?.type?.startsWith('show') || !host.getSession().source) return message;
        const current = ensure();
        if (current.tourMode) return { type: 'workspaceState', workspace: uiState() };
        message.workspace = uiState();
        if (current.context.kind === 'ready') {
            try { message.history = rail(); }
            catch (error) {
                current.status = `History unavailable: ${error.message}`;
                message.workspace.status = current.status;
                message.workspace.history.enabled = false;
                message.workspace.history.reason = current.status;
                message.workspace.canSelectRevisions = false;
            }
        }
        return message;
    }

    function update() {
        const message = { type: 'workspaceState', workspace: uiState() };
        host.send(message);
        if (!state.tourMode && state.context.kind === 'ready' && state.backend && !state.backendError) host.send({ type: 'updateCommitHistory', history: rail() });
    }

    async function leave() {
        if (state.tourMode) return true;
        const departing = host.getSession();
        const navigation = await host.capture();
        if (host.getSession() !== departing || !await host.confirm('switch workspace modes')) return false;
        // A successful Save clears dirty. Remaining dirty means the user chose
        // Discard; do not squirrel those discarded edits away in a mode cursor.
        const saved = host.hasUnsaved() ? discardCopy(departing) : departing;
        state.saved.set(state.mode, saved);
        state.navigation.set(state.mode, navigation);
        if (state.original === departing) {
            state.original = saved;
            state.originalNavigation = navigation;
        }
        if (!state.original && state.mode === 'compare') {
            state.original = saved;
            state.originalNavigation = navigation;
        }
        return true;
    }

    function makeSession(mode, revisions, file) {
        const current = ensure();
        const history = backend();
        if (file === null && current.context.paths.some(item => item.type === 'directory')) {
            return { mode: 'directory', source: current.source, workspaceId: current.id,
                workspaceView: { mode, path: null, revisions: [...revisions] },
                left: { label: path.basename(current.context.repoRoot) }, right: { label: 'Changed files' },
                history: null, directory: null, dirHistory: null, multi: null };
        }
        const selectedPath = history.files.includes(file) ? file : history.files[0];
        if (!selectedPath) throw new Error('No tracked files exist in this history scope.');
        const files = revisions.map((revision, index) => {
            const value = history.read(selectedPath, revision);
            const editable = revision === 'WORKTREE' && !current.source.readOnly && value.exists && !value.reason;
            return {
                id: `${current.id}-${mode}-${index}`, revision,
                label: `${selectedPath} @ ${revision === 'EMPTY' ? 'Empty tree' : revision.slice(0, 12)}${value.exists ? '' : ' (absent)'}${value.reason ? ` — ${value.reason}` : ''}`,
                path: path.join(current.context.repoRoot, selectedPath), content: value.content,
                savedContent: value.content, dirty: false, editable,
                mutabilityLabel: value.reason || (editable ? undefined : 'Read-only snapshot')
            };
        });
        return {
            mode: 'multi-diff', source: current.source, workspaceId: current.id,
            canReturnToDirectory: current.context.paths.some(item => item.type === 'directory'),
            workspaceView: { mode, path: selectedPath, revisions: [...revisions] },
            left: {}, right: {}, history: null, directory: null, dirHistory: null,
            multi: { sourceKind: 'workspace', files, activePanelId: files[files.length - 1].id, activePairIndex: Math.max(0, files.length - 2), historySource: null }
        };
    }

    async function install(next, mode, navigation) {
        if (state.tourMode) host.send({ type: 'workspaceHideTour' });
        state.tourMode = null;
        state.mode = mode;
        host.setSession(next);
        await host.render();
        if (navigation) host.restore(navigation);
    }

    async function switchMode(mode) {
        ensure();
        if (['historical', 'deconstructed'].includes(mode)) {
            if (!state.tour?.kinds.includes(mode)) return;
            if (!state.tourMode && !await leave()) return;
            const retained = state.saved.get(state.mode);
            if (retained) host.setSession(retained);
            state.tourMode = mode;
            host.send({ type: 'workspaceTour', url: state.tour.url, mode, workspace: uiState() });
            return;
        }
        if (state.tourMode) {
            const saved = state.saved.get(state.mode);
            if (state.mode === mode) { await install(saved || host.getSession(), mode, state.navigation.get(mode)); return; }
        }
        if (!['history', 'compare'].includes(mode) || state.mode === mode) return;
        const file = activePath();
        // Validate/materialize the destination before offering to discard edits.
        let next = state.saved.get(mode);
        let materialize = false;
        if (!next) {
            materialize = true;
            const data = backend();
            const context = state.context;
            const activeIndex = host.getSession().multi?.files.findIndex((item) => item.id === host.getSession().multi.activePanelId);
            const active = context.revisions[activeIndex] || context.activeRevision;
            const entry = data.entries.find((item) => item.commit === active) || data.entries[0];
            const revisions = mode === 'history' ? [entry.parentCommit || 'EMPTY', entry.commit]
                : host.getSession().workspaceView?.revisions || [entry.parentCommit || 'EMPTY', entry.commit];
            next = makeSession(mode, revisions, file);
        }
        if (!await leave()) return;
        if (materialize) next = makeSession(mode, next.workspaceView.revisions, next.workspaceView.path);
        await install(next, mode, state.navigation.get(mode));
    }

    function revisionFiles(current, changedFiles) {
        const data = backend();
        return { paths: data.files, currentPath: current.workspaceView.path,
            changedPaths: new Set(changedFiles || data.changedFiles(current.workspaceView.revisions)) };
    }

    async function render() {
        const current = host.getSession();
        if (!current.workspaceView) return false;
        const { revisions } = current.workspaceView;
        if (current.workspaceView.path === null) {
            const labels = revisions.map(revision => revision === 'EMPTY' ? 'Empty tree' : revision.slice(0, 12));
            host.send(revisionDirectoryView(labels, backend().directoryEntries(revisions)));
            return true;
        }
        const changedFiles = backend().changedFiles(revisions);
        host.send(revisionPanelsView({
            panels: current.multi.files.map((panel, i) => ({
                ...panel, addLeftEnabled: state.mode === 'history' && i === 0,
                addRightEnabled: state.mode === 'history' && i === revisions.length - 1,
                removeEnabled: state.mode === 'history' && revisions.length > 1
            })),
            activePanelId: current.multi.activePanelId, activePairIndex: current.multi.activePairIndex,
            canReturnToDirectory: current.canReturnToDirectory,
            files: revisionFiles(current, changedFiles),
            mutationEnabled: state.mode === 'history'
        }));
        return true;
    }

    async function handle(message) {
        const workspaceAction = message.type.startsWith('workspace');
        const current = host.getSession();
        const derived = Boolean(current.workspaceView);
        const sharedAction = ['toggleHistorySelection', 'selectHistoryEntry', 'compareHistoryEntry'].includes(message.type);
        const derivedAction = derived && ['refreshSession', 'selectHistoryEntry', 'historyBack', 'historyForward', 'openDirectoryEntry', 'returnToDirectory', 'navigateFile', 'multiAddPanel', 'multiRemovePanel', 'historyToggleStaged', 'historyToggleSkipUnchanged'].includes(message.type);
        if (!workspaceAction && !sharedAction && !derivedAction) return false;
        ensure();
        if (busy) return true;
        busy = true;
        try {
            if (message.type === 'workspaceSkillChoose' || message.type === 'workspaceSkillSave') {
                const target = state;
                const skill = message.type === 'workspaceSkillChoose'
                    ? await host.chooseTourSkill?.()
                    : await host.saveTourSkill?.(state.tourSkill || host.defaultTourSkill?.());
                if (ensure() !== target) return true;
                if (skill) state.tourSkill = skill;
                state.status = skill ? 'Tour instructions selected. Edited prompt drafts are preserved; reset the prompt to use the new instructions.' : 'Instruction file selection canceled.';
                update();
            } else if (message.type === 'workspaceMode') await switchMode(message.mode);
            else if (message.type === 'workspaceBack') {
                if (state.original && await leave()) await install(state.original, 'compare', state.originalNavigation);
            } else if (message.type === 'workspaceClear') { state.draft = []; update(); }
            else if (message.type === 'workspaceReset') { state.draft = selectedRevisions().filter((revision) => revision !== 'EMPTY'); update(); }
            else if (message.type === 'workspaceApply') {
                if (state.draft.length >= 2) {
                    const next = makeSession('compare', state.draft, activePath());
                    if (await leave()) await install(makeSession('compare', next.workspaceView.revisions, next.workspaceView.path), 'compare');
                }
            } else if (message.type === 'toggleHistorySelection') {
                const entries = backend().entries;
                const revision = entries[message.index]?.commit;
                if (revision) {
                    state.draft = state.draft.includes(revision) ? state.draft.filter((item) => item !== revision) : [...state.draft, revision];
                    // Commit-list order is newest first; panes read oldest to newest.
                    state.draft.sort((a, b) => entries.findIndex((item) => item.commit === b) - entries.findIndex((item) => item.commit === a));
                    update();
                }
            } else if (message.type === 'workspaceOpenFile') {
                if (!backend().files.includes(message.relativePath)) return true;
                const revisions = selectedRevisions();
                if (!revisions.length) return true;
                const next = makeSession(state.mode, revisions, message.relativePath);
                if (await leave()) await install(makeSession(state.mode, next.workspaceView.revisions, next.workspaceView.path), state.mode);
            } else if (message.type === 'workspaceOpenTour') {
                const tour = await host.openTour(uiState(), state.context, message.kind);
                let accepted = false;
                try {
                    if (tour && await leave()) {
                        state.tour?.dispose?.();
                        const retained = state.saved.get(state.mode);
                        if (retained) host.setSession(retained);
                        state.tour = tour;
                        state.tours = tour.kinds;
                        state.tourMode = tour.kinds.includes(message.kind) ? message.kind : tour.kinds[0];
                        state.status = tour.notice || '';
                        accepted = true;
                        host.send({ type: 'workspaceTour', url: tour.url, mode: state.tourMode, workspace: uiState() });
                    }
                } finally { if (!accepted) tour?.dispose?.(); }
            } else if (message.type === 'compareHistoryEntry') {
                const entry = backend().entries[message.index];
                if (entry?.parentCommit) {
                    const next = makeSession('compare', [entry.parentCommit, entry.commit], activePath());
                    if (await leave()) await install(makeSession('compare', next.workspaceView.revisions, next.workspaceView.path), 'compare');
                }
            } else if (message.type === 'selectHistoryEntry' && state.mode === 'compare') {
                const revision = backend().entries[message.index]?.commit;
                const panel = current.multi?.files.find((item) => item.revision === revision);
                if (panel) { current.multi.activePanelId = panel.id; host.send({ type: 'focusHistoryPanel', panelId: panel.id }); }
                else if (revision) {
                    const next = makeSession('history', windowAround(backend().entries, message.index, Math.max(2, current.multi?.files.length || 2)), activePath());
                    if (await leave()) await install(makeSession('history', next.workspaceView.revisions, next.workspaceView.path), 'history');
                }
            } else if (derivedAction) {
                if (message.type === 'refreshSession') {
                    if (!await leave()) return true;
                    state.backend = null;
                    state.backendError = '';
                    const next = makeSession(state.mode, current.workspaceView.revisions, current.workspaceView.path);
                    await install(next, state.mode, state.navigation.get(state.mode));
                    return true;
                }
                if (message.type === 'historyToggleSkipUnchanged') { state.skipUnchanged = Boolean(message.skipUnchanged); update(); return true; }
                if (message.type === 'historyToggleStaged') {
                    if (!await leave()) return true;
                    host.setSession(state.saved.get(state.mode));
                    state.includeStaged = Boolean(message.includeStaged);
                    state.backend = null;
                    state.backendError = '';
                    const available = new Set(backend().entries.map((entry) => entry.commit));
                    const revisions = current.workspaceView.revisions.filter((revision) => revision !== 'INDEX' || available.has(revision));
                    if (!revisions.length) revisions.push(state.context.headOid);
                    state.draft = state.draft.filter((revision) => revision !== 'INDEX' || available.has(revision));
                    await install(makeSession(state.mode, revisions, current.workspaceView.path), state.mode, state.navigation.get(state.mode));
                    return true;
                }
                let revisions = [...current.workspaceView.revisions];
                let file = current.workspaceView.path;
                const data = backend();
                const focusIndex = current.multi?.files.findIndex((panel) => panel.id === current.multi.activePanelId) ?? revisions.length - 1;
                const revisionIndex = data.entries.findIndex((entry) => entry.commit === revisions[Math.max(0, focusIndex)]);
                if (message.type === 'selectHistoryEntry' && state.mode === 'history') {
                    const entry = data.entries[message.index];
                    if (!entry) return true;
                    const loaded = revisions.indexOf(entry.commit);
                    if (loaded >= 0 && current.multi) { current.multi.activePanelId = current.multi.files[loaded].id; host.send({ type: 'focusHistoryPanel', panelId: current.multi.activePanelId }); return true; }
                    revisions = !current.multi && revisions.length === 2
                        ? [entry.parentCommit || 'EMPTY', entry.commit] : windowAround(data.entries, message.index, revisions.length);
                } else if (message.type === 'historyBack' || message.type === 'historyForward') {
                    if (state.mode !== 'history') return true;
                    const delta = message.type === 'historyBack' ? 1 : -1;
                    let next = revisionIndex + delta;
                    const changes = state.skipUnchanged && file ? new Set(data.changedCommits(file)) : null;
                    while (data.entries[next] && changes && !changes.has(data.entries[next].commit)) next += delta;
                    if (!data.entries[next]) return true;
                    revisions = !current.multi && revisions.length === 2
                        ? [data.entries[next].parentCommit || 'EMPTY', data.entries[next].commit] : windowAround(data.entries, next, revisions.length);
                } else if (message.type === 'multiAddPanel') {
                    const left = message.side === 'left';
                    const edge = left ? revisions[0] : revisions[revisions.length - 1];
                    const edgeIndex = data.entries.findIndex((entry) => entry.commit === edge);
                    const next = data.entries[edgeIndex + (left ? 1 : -1)];
                    if (!next || revisions.includes(next.commit)) return true;
                    if (left) revisions.unshift(next.commit); else revisions.push(next.commit);
                } else if (message.type === 'multiRemovePanel') {
                    if (revisions.length < 2 || !current.multi) return true;
                    revisions = revisions.filter((_, i) => current.multi.files[i].id !== message.panelId);
                } else {
                    const target = revisionFileAction(message, revisionFiles(current), state.context.paths.some(item => item.type === 'directory'));
                    if (!target) return true;
                    file = target.path;
                }
                const next = makeSession(state.mode, revisions, file);
                if (await leave()) await install(makeSession(state.mode, next.workspaceView.revisions, next.workspaceView.path), state.mode);
            }
        } catch (error) { state.status = error.message; update(); }
        finally { busy = false; }
        return true;
    }

    async function openHistory(source) {
        const context = git.resolve(source);
        if (context.kind !== 'ready') throw new Error(context.reason);
        const data = git.history(context, { includeStaged: Boolean(source.includeStaged) });
        if (!data.files.length || !data.entries.length) throw new Error('No tracked history exists in this scope.');
        if (!await host.confirm('open History')) return;
        state?.tour?.dispose?.();
        state = { id: `workspace-${++serial}`, sourceKey: JSON.stringify(source), source, context,
            mode: 'history', draft: [], saved: new Map(), navigation: new Map(), original: null,
            originalNavigation: null, backend: data, backendError: '', status: '', tours: [],
            includeStaged: Boolean(source.includeStaged), skipUnchanged: Boolean(source.skipUnchanged) };
        // Install an owner before makeSession calls ensure().
        host.setSession({ ...host.getSession(), source, workspaceId: state.id });
        const entry = (source.kind === 'directory-history'
            ? data.entries.find(item => data.changedFiles([item.parentCommit || 'EMPTY', item.commit]).length)
            : data.entries.find(item => item.commit === context.activeRevision)) || data.entries[0];
        await install(makeSession('history', [entry.parentCommit || 'EMPTY', entry.commit], source.kind === 'directory-history' ? null : data.files[0]), 'history');
    }

    return { augment, render, handle, openHistory, uiState, update, isTourActive: () => Boolean(state?.tourMode), reset() { state?.tour?.dispose?.(); state = null; },
        setStatus(status) { ensure().status = status; update(); },
        setTours(tours) { ensure().tours = tours; update(); } };
}

function discardCopy(session) {
    const reset = (panel) => panel?.dirty ? { ...panel, content: panel.savedContent, dirty: false } : panel;
    return { ...session, left: reset(session.left), right: reset(session.right),
        multi: session.multi ? { ...session.multi, files: session.multi.files.map(reset) } : null };
}

function windowAround(entries, index, count) {
    const start = Math.max(0, Math.min(index, entries.length - count));
    const revisions = entries.slice(start, start + count).map((entry) => entry.commit).reverse();
    if (revisions.length < count && entries[entries.length - 1]?.parentCommit === null) revisions.unshift('EMPTY');
    return revisions;
}

module.exports = { createWorkspaceHost, discardCopy, windowAround };
