/* global AbortController, module, require */
const { createHash } = require('node:crypto');
const path = require('path');
const { revisionFileLabel } = require('./fileLabel.js');
const { applyComparisonOrder } = require('../out/panelOrder.js');
const { revisionFileAction, revisionDirectoryView, revisionPanelsView, revisionRailItems } = require('../out/revisionView.js');

const FULL_COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function dependencyRangeFor(context, revisions, rangeResolver) {
    if (context?.kind !== 'ready') {
        return { reason: context?.reason || 'Dependency graphs require a Git workspace.' };
    }
    if (!Array.isArray(revisions) || revisions.length !== 2) {
        return { reason: 'Dependency graphs require exactly two pinned revisions.' };
    }
    if (!revisions.every(revision => typeof revision === 'string' && FULL_COMMIT_OID.test(revision))) {
        return { reason: 'Dependency graphs require two full committed revision OIDs; WORKTREE and INDEX are not supported.' };
    }
    const [baseOid, headOid] = revisions;
    if (baseOid === headOid) {
        return { reason: 'Dependency graphs require two different pinned revisions.' };
    }
    if (typeof rangeResolver !== 'function') {
        return { reason: 'Dependency graph analysis is unavailable in this desktop build.' };
    }
    const range = rangeResolver(context.repoRoot, revisions);
    if (range?.status !== 'exact') {
        return { reason: range?.reason || 'The selected revisions do not form an exact committed range.' };
    }
    if ((range.baseOid && range.baseOid !== baseOid) || (range.headOid && range.headOid !== headOid)) {
        return { reason: 'The selected revisions did not remain pinned to the requested exact range.' };
    }
    return { baseOid, headOid, revisions: [baseOid, headOid], key: JSON.stringify([baseOid, headOid]), range };
}

function isSafeDependencyFile(file) {
    if (typeof file !== 'string' || !file || file.startsWith('/') || file.includes('\\') || file.includes('\0')) return false;
    const parts = file.split('/');
    return parts.every(part => part && part !== '.' && part !== '..');
}

function offsetAtLineColumn(text, line, column) {
    if (typeof text !== 'string' || !Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return undefined;
    let offset = 0;
    let currentLine = 1;
    while (currentLine < line) {
        const match = /\r\n|\r|\n/g;
        match.lastIndex = offset;
        const found = match.exec(text);
        if (!found) return undefined;
        offset = found.index + found[0].length;
        currentLine++;
    }
    const nextBreak = text.slice(offset).search(/\r\n|\r|\n/);
    const lineEnd = nextBreak < 0 ? text.length : offset + nextBreak;
    return Math.min(offset + column - 1, lineEnd);
}

function sourceLocation(text, offset) {
    if (typeof text !== 'string' || !Number.isInteger(offset) || offset < 0 || offset > text.length) return undefined;
    const prefix = text.slice(0, offset);
    const lines = prefix.split(/\r\n|\r|\n/);
    return { line: lines.length, column: lines.at(-1).length + 1 };
}

// Owns mode cursors, not editor capabilities. The native host continues to own
// editable sessions, saving, window lifetime, and confirmation dialogs.
function createWorkspaceHost(host, git) {
    let state = null;
    let serial = 0;
    let actions = Promise.resolve();

    function abortDependencyAnalysis(current) {
        if (!current) return;
        const controller = current?.dependencyAnalysis;
        current.dependencyAnalysis = null;
        if (controller && !controller.signal.aborted) controller.abort();
    }

    function abortSpecificDependencyAnalysis(current, controller) {
        if (current?.dependencyAnalysis === controller) abortDependencyAnalysis(current);
    }

    function callDependencyDisposer(dispose) {
        if (typeof dispose !== 'function') return;
        try { Promise.resolve(dispose()).catch(() => {}); } catch { /* Cleanup must not mask the workspace transition. */ }
    }

    function disposeDependencyResult(result) {
        callDependencyDisposer(result?.dispose);
    }

    function disposeDependencyView(current) {
        if (!current) return;
        const dispose = current.dependencyViewDispose;
        current.dependencyViewDispose = null;
        callDependencyDisposer(dispose);
    }

    function invalidateDependencyGraph(current, { preserveReport = false } = {}) {
        abortDependencyAnalysis(current);
        disposeDependencyView(current);
        const previous = current.dependencyGraph || { requestId: 0 };
        current.dependencyGraph = {
            status: 'idle', requestId: previous.requestId + 1, rangeKey: null,
            report: preserveReport ? previous.report : null,
            correspondence: preserveReport ? previous.correspondence : null,
            error: '', focus: preserveReport ? previous.focus : null
        };
    }

    function ensure() {
        const current = host.getSession();
        if (state && (current.workspaceId === state.id || current === state.owner || current === state.original || [...state.saved.values()].includes(current))) return state;
        const key = JSON.stringify(current.source);
        if (!state || state.sourceKey !== key || current !== state.owner) {
            disposeDependencyView(state);
            abortDependencyAnalysis(state);
            state?.tour?.dispose?.();
            const context = git.resolve(current.source, { pinnedRevisions: current.source?.resolvedRevisions });
            state = {
                id: `workspace-${++serial}`, sourceKey: key, source: current.source,
                context, mode: 'compare', draft: [], saved: new Map(), navigation: new Map(),
                original: null, owner: current, backend: null, backendError: '', status: '', tours: [], originalNavigation: null,
                includeStaged: Boolean(current.source?.includeStaged), skipUnchanged: Boolean(current.source?.skipUnchanged),
                dependencyAnalysis: null,
                dependencyViewDispose: null,
                dependencyGraph: { status: 'idle', requestId: 0, rangeKey: null, report: null, correspondence: null, error: '', focus: null }
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
        if (panel?.path && current.source.kind === 'files') return path.relative(context.repoRoot, panel.path).split(path.sep).join('/');
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
            if (current.dependencyGraph?.rangeKey && current.dependencyGraph.rangeKey !== rangeKey) {
                invalidateDependencyGraph(current);
            }
        }
        const range = current.range;
        const dependencyRange = dependencyRangeFor(context, revisions, git.range);
        const dependencyVisible = typeof git.buildNativeDependencyView === 'function';
        const dependencyEnabled = current.mode === 'compare' && !current.tourMode && dependencyVisible && !dependencyRange.reason;
        return {
            sessionId: current.id, mode: current.tourMode || current.mode, availableTours: current.tours,
            modeLabels: current.tour?.modeLabels,
            nativeSkillFiles: typeof host.chooseTourSkill === 'function',
            tourSkill: current.tourSkill || host.defaultTourSkill?.(),
            canReturn: Boolean(current.original && (current.tourMode || host.getSession() !== current.original)),
            history: { enabled: context.kind === 'ready' && !current.backendError, label: 'History', reason: current.backendError || (context.kind === 'ready' ? context.notice || '' : context.reason) },
            revisionContext: revisions.map(revision => revision === 'EMPTY' ? 'Empty tree'
                : revision === 'WORKTREE' ? 'Working tree' : revision === 'INDEX' ? 'Staged' : revision.slice(0, 7)).join(' → '),
            promptContext: current.tourMode && current.tour ? current.tour.promptContext : {
                repository: context.kind === 'ready' ? context.repoRoot : undefined,
                paths: context.kind === 'ready' ? context.paths.map((item) => item.path || '.') : [],
                revisions, rangeStatus: range.status, reason: range.reason
            },
            status: current.status,
            selectionCount: current.draft.length,
            selectionMatchesDisplayed: current.draft.length === revisions.length && revisions.every(revision => current.draft.includes(revision)),
            selectionApplied: current.mode === 'compare' && Boolean(host.getSession().workspaceView || current.source.resolvedRevisions)
                && current.draft.length === revisions.length && revisions.every(revision => current.draft.includes(revision)),
            selectionPath: activePath(),
            canFinalDiff: context.kind === 'ready' && context.revisions.length >= 2 && context.revisions[0] !== context.revisions.at(-1),
            canShowAllFiles: current.mode === 'compare' && Boolean(activePath()) && context.kind === 'ready' && context.paths.some(item => item.type === 'directory'),
            canSelectRevisions: context.kind === 'ready' && !current.backendError,
            dependencyGraph: {
                visible: dependencyVisible,
                enabled: dependencyEnabled,
                reason: dependencyEnabled ? '' : (current.tourMode ? 'Dependency graphs are available in Compare mode.'
                    : dependencyRange.reason || 'Dependency graph analysis is unavailable in this desktop build.'),
                status: current.dependencyGraph?.status || 'idle',
                error: current.dependencyGraph?.error || '',
                canLoadCorrespondence: dependencyEnabled && typeof host.chooseDependencyCorrespondence === 'function',
                ...(dependencyRange.baseOid ? { baseOid: dependencyRange.baseOid, headOid: dependencyRange.headOid } : {})
            }
        };
    }

    function rail() {
        const current = ensure();
        const history = backend();
        const selectedPath = activePath();
        const changes = new Set(selectedPath ? history.changedCommits(selectedPath) : []);
        const revisions = selectedRevisions();
        const session = host.getSession();
        const changedFiles = new Set(history.changedFiles(revisions));
        const activePanel = session.multi?.files.find((panel) => panel.id === session.multi.activePanelId);
        const active = activePanel?.revision || revisions[activePanel?.columnIndex]
            || (session.workspaceView?.path === null ? revisions.at(-1) : null);
        const hasRevisionPanels = Boolean(session.workspaceView || current.source.resolvedRevisions);
        return {
            fileName: selectedPath || 'Repository', navigatorOnly: current.mode !== 'history', workingTreeControls: current.mode === 'history',
            includeStaged: current.includeStaged, skipUnchanged: current.skipUnchanged,
            canGoBack: current.mode === 'history', canGoForward: current.mode === 'history',
            positionLabel: current.mode === 'history' ? 'History' : 'Comparison',
            rail: {
                activeTabId: 'history', tabs: [{ id: 'history', label: 'Commits' }, { id: 'workspace-files', label: 'Files', filterChangedFiles: true }],
                itemsByTab: {
                    history: revisionRailItems(history.entries, {
                        displayed: hasRevisionPanels ? (session.workspaceView?.panelOrder
                            || applyComparisonOrder(revisions.map((revision, index) => ({ revision, id: String(index) })),
                                session.source?.panelOrder, item => item.id).map(item => item.revision)) : [], selected: current.draft, active, changed: changes,
                        selectionEnabled: true,
                        missingRevisionSelectionEnabled: true,
                        missingRevisionLabel: commit => `${commit === 'EMPTY' ? 'Empty tree' : commit.slice(0, 7)} Displayed base revision`
                    }),
                    'workspace-files': history.files.map((file) => ({ kind: 'directory-entry', workspaceFile: true, relativePath: file, label: file, active: file === selectedPath, changed: changedFiles.has(file) }))
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

    function currentDependencyRange(current = ensure()) {
        const revisions = selectedRevisions();
        try {
            return dependencyRangeFor(current.context, revisions, git.range);
        } catch (error) {
            return { reason: error.message };
        }
    }

    function isCurrentDependencyRequest(target, requestId, rangeKey) {
        if (state !== target || target.dependencyGraph?.requestId !== requestId
            || target.dependencyGraph?.rangeKey !== rangeKey || target.mode !== 'compare' || target.tourMode) return false;
        const current = host.getSession();
        if (current.workspaceId && current.workspaceId !== target.id) return false;
        return JSON.stringify(selectedRevisions()) === rangeKey;
    }

    async function dependencyFocus(current, range) {
        const file = activePath();
        if (!file) return undefined;
        let navigation;
        try { navigation = await host.capture(); } catch { /* A graph can still open without editor focus. */ }
        const session = host.getSession();
        const panelIndex = session.multi?.files?.findIndex(panel => panel.id === session.multi.activePanelId) ?? -1;
        const panel = panelIndex >= 0 ? session.multi.files[panelIndex] : undefined;
        const selectedRevision = panel?.revision || range.revisions[panelIndex] || range.headOid;
        const revision = selectedRevision === range.baseOid ? 'base' : selectedRevision === range.headOid ? 'head' : undefined;
        const selection = navigation?.editorStates?.[session.multi?.activePanelId]?.selection;
        const focus = { file, ...(revision ? { revision } : {}) };
        if (Number.isInteger(selection?.startLineNumber) && selection.startLineNumber > 0) {
            focus.line = selection.startLineNumber;
        }
        if (revision && Number.isInteger(selection?.startColumn) && selection.startColumn > 0) {
            const offset = offsetAtLineColumn(panel?.content, selection.startLineNumber, selection.startColumn);
            if (offset !== undefined) focus.start = offset;
        }
        return focus;
    }

    async function buildDependencyGraph(correspondence = state.dependencyGraph?.correspondence) {
        const target = state;
        const range = currentDependencyRange(target);
        if (range.reason) throw new Error(range.reason);
        abortDependencyAnalysis(target);
        disposeDependencyView(target);
        const previous = target.dependencyGraph;
        const requestId = (previous?.requestId || 0) + 1;
        const analysis = new AbortController();
        target.dependencyAnalysis = analysis;
        target.dependencyGraph = {
            ...previous, status: 'loading', requestId, rangeKey: range.key,
            report: null, error: '', focus: null, correspondence: correspondence || null
        };
        target.status = '';
        update();
        const focus = await dependencyFocus(target, range);
        if (!isCurrentDependencyRequest(target, requestId, range.key)) {
            abortSpecificDependencyAnalysis(target, analysis);
            return true;
        }
        target.dependencyGraph.focus = focus;
        let result;
        try {
            const options = { baseOid: range.baseOid, headOid: range.headOid, focus };
            if (correspondence) options.correspondence = correspondence;
            options.signal = analysis.signal;
            result = await git.buildNativeDependencyView(target.context.repoRoot, options);
            if (!isCurrentDependencyRequest(target, requestId, range.key)) {
                disposeDependencyResult(result);
                result = null;
                return true;
            }
            if (!result || typeof result.html !== 'string' || !result.report) throw new Error('Dependency analysis returned no embedded view.');
            if (result.url !== undefined && (typeof result.url !== 'string' || !result.url || typeof result.dispose !== 'function')) {
                throw new Error('Dependency graph server returned an invalid view.');
            }
            if (result.dispose !== undefined && typeof result.dispose !== 'function') {
                throw new Error('Dependency graph server returned invalid cleanup state.');
            }
            if (result.report.range?.baseOid !== range.baseOid || result.report.range?.headOid !== range.headOid) {
                throw new Error('Dependency analysis returned a different revision range.');
            }
            target.dependencyViewDispose = typeof result.dispose === 'function' ? result.dispose : null;
            target.dependencyGraph = {
                ...target.dependencyGraph, status: 'ready', report: result.report,
                error: '', focus, correspondence: correspondence || null
            };
            host.send({ type: 'workspaceDependencyGraph', sessionId: target.id, graph: {
                status: 'ready', html: result.html, ...(result.url ? { url: result.url } : {}), focus,
                canLoadCorrespondence: typeof host.chooseDependencyCorrespondence === 'function'
            } });
            result = null;
            update();
        } catch (error) {
            if (result) {
                disposeDependencyResult(result);
                if (target.dependencyViewDispose === result.dispose) target.dependencyViewDispose = null;
            }
            if (analysis.signal.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
                || !isCurrentDependencyRequest(target, requestId, range.key)) return true;
            target.dependencyGraph = { ...target.dependencyGraph, status: 'error', report: null, error: error.message };
            target.status = `Dependency graph: ${error.message}`;
            update();
        } finally {
            if (target.dependencyAnalysis === analysis) target.dependencyAnalysis = null;
        }
        return true;
    }

    async function loadDependencyCorrespondence() {
        const target = state;
        const range = currentDependencyRange(target);
        if (range.reason) throw new Error(range.reason);
        if (typeof host.chooseDependencyCorrespondence !== 'function') {
            throw new Error('Loading symbol correspondence is unavailable in this desktop build.');
        }
        abortDependencyAnalysis(target);
        const previous = target.dependencyGraph;
        const requestId = (previous?.requestId || 0) + 1;
        target.dependencyGraph = { ...previous, status: 'loading', requestId, rangeKey: range.key, error: '' };
        target.status = '';
        update();
        const correspondence = await host.chooseDependencyCorrespondence(target.context.repoRoot, range.baseOid, range.headOid);
        if (!isCurrentDependencyRequest(target, requestId, range.key)) return true;
        if (!correspondence) {
            target.dependencyGraph = { ...previous, requestId, rangeKey: range.key };
            update();
            return true;
        }
        return buildDependencyGraph(correspondence);
    }

    function validateDependencyAnchor(report, untrustedSource, range) {
        if (!report || typeof git.dependencySource !== 'function') throw new Error('Dependency source navigation is unavailable.');
        const source = git.dependencySource(report, untrustedSource);
        const validSpan = source && ((source.start < source.end) || (source.start === 0 && source.end === 0));
        if (!source || !FULL_COMMIT_OID.test(source.oid) || !FULL_COMMIT_OID.test(source.blobOid)
            || !isSafeDependencyFile(source.file) || (source.oid !== range.baseOid && source.oid !== range.headOid)
            || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)
            || source.start < 0 || source.end < 0 || !validSpan
            || typeof source.digest !== 'string' || !/^[0-9a-f]{64}$/.test(source.digest)) {
            throw new Error('The selected dependency source is not a validated pinned anchor.');
        }
        return source;
    }

    function pinnedDependencySnapshot(current, source, revisions) {
        if (typeof git.readPinnedFile !== 'function') throw new Error('Pinned dependency source validation is unavailable.');
        const anchor = git.readPinnedFile(current.context.repoRoot, source.oid, source.file);
        const emptyModule = source.start === 0 && source.end === 0;
        if (!anchor || typeof anchor.text !== 'string' || anchor.blob !== source.blobOid
            || (emptyModule ? anchor.text.length !== 0 : source.end > anchor.text.length)
            || createHash('sha256').update(anchor.text.slice(source.start, source.end), 'utf8').digest('hex') !== source.digest) {
            throw new Error('Pinned dependency source is unavailable or changed.');
        }
        const values = new Map([[source.oid, { exists: true, content: anchor.text, reason: undefined }]]);
        for (const revision of revisions) {
            if (revision === source.oid) continue;
            const pinned = git.readPinnedFile(current.context.repoRoot, revision, source.file);
            values.set(revision, pinned
                ? { exists: true, content: pinned.text, reason: undefined }
                : { exists: false, content: '', reason: undefined });
        }
        return { file: source.file, values, text: anchor.text };
    }

    function includeDependencyFileInHistory(current, file) {
        const data = backend();
        if (data.files.includes(file)) return data;
        const paths = [...current.context.paths];
        if (!paths.some(item => item.path === file)) paths.push({ path: file, type: 'file' });
        const expanded = git.history({ ...current.context, paths }, { includeStaged: current.includeStaged });
        if (!expanded || !Array.isArray(expanded.files) || !expanded.files.includes(file)) {
            throw new Error('The selected dependency source is unavailable in the comparison history.');
        }
        current.backend = expanded;
        return expanded;
    }

    async function openDependencySource(untrustedSource) {
        const target = state;
        const range = currentDependencyRange(target);
        if (range.reason) throw new Error(range.reason);
        const source = validateDependencyAnchor(target.dependencyGraph?.report, untrustedSource, range);
        const pinned = pinnedDependencySnapshot(target, source, range.revisions);
        const start = sourceLocation(pinned.text, source.start);
        const end = sourceLocation(pinned.text, source.end);
        if (!start || !end) throw new Error('The selected dependency source has no usable location.');
        if (!await leave()) return true;
        if (state !== target) return true;
        includeDependencyFileInHistory(target, source.file);
        await install(makeSession('compare', range.revisions, source.file, pinned), 'compare');
        invalidateDependencyGraph(target);
        target.status = '';
        update();
        const sideIndex = range.revisions.indexOf(source.oid);
        host.send({ type: 'revealSearchResult', sideIndex, lineNumber: start.line,
            startColumn: start.column, endColumn: end.line === start.line ? Math.max(start.column + 1, end.column) : start.column + 1 });
        return true;
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

    function makeSession(mode, revisions, file, pinnedSnapshot = null) {
        const current = ensure();
        const history = backend();
        const panelOrder = [...revisions];
        if (file === null && current.context.paths.some(item => item.type === 'directory')) {
            return { mode: 'directory', source: current.source, workspaceId: current.id,
                workspaceView: { mode, path: null, revisions: [...revisions], ...(mode === 'compare' ? { panelOrder } : {}) },
                left: { label: path.basename(current.context.repoRoot) }, right: { label: 'Changed files' },
                history: null, directory: null, dirHistory: null, multi: null };
        }
        if (pinnedSnapshot && (pinnedSnapshot.file !== file || !(pinnedSnapshot.values instanceof Map))) {
            throw new Error('Pinned dependency source session is invalid.');
        }
        const selectedPath = pinnedSnapshot ? file : history.files.includes(file) ? file : history.files[0];
        if (!selectedPath) throw new Error('No tracked files exist in this history scope.');
        const files = panelOrder.map((revision) => {
            const value = pinnedSnapshot
                ? pinnedSnapshot.values.get(revision)
                : history.read(selectedPath, revision);
            if (!value || typeof value.content !== 'string' || typeof value.exists !== 'boolean') {
                throw new Error('Pinned dependency source session is missing a revision snapshot.');
            }
            const editable = revision === 'WORKTREE' && !current.source.readOnly && value.exists && !value.reason;
            return {
                id: `${current.id}-${mode}-${selectedPath}-${revision}`, revision,
                label: `${revisionFileLabel(selectedPath, revision === 'EMPTY' ? 'Empty tree' : revision.slice(0, 12))}${value.exists ? '' : ' (absent)'}${value.reason ? ` — ${value.reason}` : ''}`,
                path: path.join(current.context.repoRoot, selectedPath), content: value.content,
                savedContent: value.content, dirty: false, editable,
                mutabilityLabel: value.reason || (editable ? undefined : 'Read-only snapshot')
            };
        });
        return {
            mode: 'multi-diff', source: current.source, workspaceId: current.id,
            canReturnToDirectory: current.context.paths.some(item => item.type === 'directory'),
            workspaceView: { mode, path: selectedPath, revisions: [...revisions], ...(mode === 'compare' ? { panelOrder } : {}) },
            left: {}, right: {}, history: null, directory: null, dirHistory: null,
            multi: { sourceKind: 'workspace', files, activePanelId: files[files.length - 1].id, activePairIndex: Math.max(0, files.length - 2), historySource: null }
        };
    }

    async function install(next, mode, navigation) {
        if (state.tourMode) host.send({ type: 'workspaceHideTour' });
        state.tourMode = null;
        state.mode = mode;
        if (mode !== 'compare') invalidateDependencyGraph(state);
        if (mode === 'compare' && next.workspaceView) next.source = { ...next.source, comparisonView: { ...next.workspaceView } };
        if (mode !== 'compare' && next.source.comparisonView) {
            next.source = { ...next.source };
            delete next.source.comparisonView;
        }
        host.setSession(next);
        await host.render();
        if (navigation) host.restore(navigation);
    }

    async function switchMode(mode) {
        ensure();
        if (mode === (state.tourMode || state.mode)) return;
        if (['historical', 'deconstructed'].includes(mode)) {
            if (!state.tourMode && !await leave()) return;
            const retained = state.saved.get(state.mode);
            if (retained) host.setSession(retained);
            state.tourMode = mode;
            invalidateDependencyGraph(state);
            host.send(state.tour?.kinds.includes(mode)
                ? { type: 'workspaceTour', url: state.tour.url, mode, workspace: uiState() }
                : { type: 'workspaceEmptyTour', workspace: uiState() });
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
            const activePanel = host.getSession().multi?.files[activeIndex];
            const active = activePanel?.revision || context.revisions[activePanel?.columnIndex ?? activeIndex] || context.activeRevision;
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
            mutationEnabled: state.mode === 'history',
            reorderEnabled: false
        }));
        return true;
    }

    async function handle(message) {
        const workspaceAction = message.type.startsWith('workspace');
        const current = host.getSession();
        const derived = Boolean(current.workspaceView);
        const sharedAction = ['toggleHistorySelection', 'selectHistoryEntry', 'compareHistoryEntry', 'dependencySource', 'dependencyLoadCorrespondence'].includes(message.type);
        const derivedAction = derived && ['multiMovePanel', 'refreshSession', 'selectHistoryEntry', 'historyBack', 'historyForward', 'openDirectoryEntry', 'returnToDirectory', 'navigateFile', 'multiAddPanel', 'multiRemovePanel', 'historyToggleStaged', 'historyToggleSkipUnchanged'].includes(message.type);
        if (!workspaceAction && !sharedAction && !derivedAction) return false;
        const target = ensure();
        if (message.type === 'workspaceDependencyClose') {
            // This is a user-initiated cancellation, so invalidate before any
            // queued workspace work can observe the old graph request.
            invalidateDependencyGraph(target);
            if (typeof target.status === 'string' && target.status.startsWith('Dependency graph:')) target.status = '';
            update();
            return true;
        }
        // The action queue serializes host mutations, but a newer workspace
        // action must still cancel analysis before it waits behind one. This
        // covers range, file, mode, and session-context changes as well as a
        // replacement graph request.
        const preservesDependencyGraph = ['dependencySource', 'workspaceClear', 'workspaceReset',
            'workspaceSkillChoose', 'workspaceSkillSave'].includes(message.type);
        if (preservesDependencyGraph) {
            abortDependencyAnalysis(target);
            if (target.dependencyGraph?.status === 'loading' && message.type === 'dependencySource') {
                invalidateDependencyGraph(target);
            }
        } else {
            invalidateDependencyGraph(target);
        }
        const action = actions.then(() => ensure() === target ? runAction(message) : true);
        // Dependency analysis is cancellable background work. Keep it ordered
        // after mutations already queued, but do not append it to the mutation
        // queue: a later navigation must be able to abort the worker and run
        // immediately instead of waiting for its child-process teardown.
        const dependencyAction = message.type === 'workspaceDependencyGraph'
            || message.type === 'dependencyLoadCorrespondence';
        if (!dependencyAction) actions = action.catch(() => {});
        return action;
    }

    async function runAction(message) {
        const current = host.getSession();
        const derivedAction = Boolean(current.workspaceView) && ['refreshSession', 'selectHistoryEntry', 'historyBack', 'historyForward', 'openDirectoryEntry', 'returnToDirectory', 'navigateFile', 'multiAddPanel', 'multiRemovePanel', 'historyToggleStaged', 'historyToggleSkipUnchanged'].includes(message.type);
        try {
            if (message.type === 'multiMovePanel') return true;
            if (message.type === 'workspaceDependencyGraph') await buildDependencyGraph();
            else if (message.type === 'dependencyLoadCorrespondence') await loadDependencyCorrespondence();
            else if (message.type === 'dependencySource') await openDependencySource(message.source);
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
            else if (message.type === 'workspaceReset') { state.draft = [...selectedRevisions()]; update(); }
            else if (message.type === 'workspaceFinalDiff' || message.type === 'workspaceAllFiles') {
                const revisions = message.type === 'workspaceFinalDiff'
                    ? [state.context.revisions[0], state.context.revisions.at(-1)] : selectedRevisions();
                if (revisions.length >= 2 && revisions.every(Boolean)) {
                    const next = makeSession('compare', revisions, null);
                    if (await leave()) await install(makeSession('compare', next.workspaceView.revisions, null), 'compare');
                }
            }
            else if (message.type === 'workspaceApply') {
                if (state.draft.length >= 2) {
                    const next = makeSession('compare', state.draft, activePath());
                    if (await leave()) await install(makeSession('compare', next.workspaceView.revisions, next.workspaceView.path), 'compare');
                }
            } else if (message.type === 'toggleHistorySelection') {
                const entries = backend().entries;
                const revision = rail().rail.itemsByTab.history.find(item => item.index === message.index)?.commit;
                if (revision) {
                    state.draft = state.draft.includes(revision) ? state.draft.filter((item) => item !== revision) : [...state.draft, revision];
                    // Commit-list order is newest first; panes read oldest to newest.
                    const order = revision => {
                        const index = entries.findIndex(item => item.commit === revision);
                        return index < 0 ? entries.length : index;
                    };
                    state.draft.sort((a, b) => order(b) - order(a));
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
        } catch (error) {
            if (['workspaceDependencyGraph', 'dependencyLoadCorrespondence', 'dependencySource'].includes(message.type)) {
                state.dependencyGraph = { ...state.dependencyGraph, status: 'error', error: error.message };
            }
            state.status = error.message;
            update();
        }
        return true;
    }

    async function openHistory(source) {
        const context = git.resolve(source);
        if (context.kind !== 'ready') throw new Error(context.reason);
        const data = git.history(context, { includeStaged: Boolean(source.includeStaged) });
        if (!data.files.length || !data.entries.length) throw new Error('No tracked history exists in this scope.');
        if (!await host.confirm('open History')) return;
        disposeDependencyView(state);
        abortDependencyAnalysis(state);
        state?.tour?.dispose?.();
        state = { id: `workspace-${++serial}`, sourceKey: JSON.stringify(source), source, context,
            mode: 'history', draft: [], saved: new Map(), navigation: new Map(), original: null,
            originalNavigation: null, backend: data, backendError: '', status: '', tours: [],
            includeStaged: Boolean(source.includeStaged), skipUnchanged: Boolean(source.skipUnchanged),
            dependencyAnalysis: null,
            dependencyViewDispose: null,
            dependencyGraph: { status: 'idle', requestId: 0, rangeKey: null, report: null, correspondence: null, error: '', focus: null } };
        // Install an owner before makeSession calls ensure().
        host.setSession({ ...host.getSession(), source, workspaceId: state.id });
        const entry = (source.kind === 'directory-history'
            ? data.entries.find(item => data.changedFiles([item.parentCommit || 'EMPTY', item.commit]).length)
            : data.entries.find(item => item.commit === context.activeRevision)) || data.entries[0];
        await install(makeSession('history', [entry.parentCommit || 'EMPTY', entry.commit], source.kind === 'directory-history' ? null : data.files[0]), 'history');
    }

    async function restoreComparison(source) {
        disposeDependencyView(state);
        abortDependencyAnalysis(state);
        state?.tour?.dispose?.();
        state = null;
        host.setSession({ source, mode: 'multi-diff', left: {}, right: {}, multi: null });
        ensure();
        const view = source.comparisonView;
        await install(makeSession('compare', view.revisions, view.path), 'compare');
    }

    function dispose() {
        disposeDependencyView(state);
        abortDependencyAnalysis(state);
        state?.tour?.dispose?.();
        state = null;
    }

    return { augment, render, handle, openHistory, restoreComparison, uiState, update, isTourActive: () => Boolean(state?.tourMode),
        dispose, reset: dispose,
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
