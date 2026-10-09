const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createWorkspaceHost } = require('../standalone/workspaceHost.js');
const { getMenuCapabilities } = require('../standalone/menuUtils.js');

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function source(overrides = {}) {
    return {
        kind: 'git-refs',
        repoRoot: '/repo',
        refs: ['HEAD'],
        ...overrides
    };
}

function nativeSession(sessionSource = source()) {
    return {
        source: sessionSource,
        mode: 'multi-diff',
        multi: {
            files: [{ id: 'native-one', path: '/repo/one.txt', content: 'one', dirty: false }],
            activePanelId: 'native-one'
        },
        left: {},
        right: {}
    };
}

function makeGit({ failHistory = false } = {}) {
    const calls = { resolve: [], history: [], range: [] };
    const context = {
        kind: 'ready', repoRoot: '/repo', commonDir: '/repo/.git', worktreeRoot: '/repo',
        paths: [{ path: 'one.txt', type: 'file' }, { path: 'two.txt', type: 'file' }],
        revisions: [A, B], activeRevision: B, notice: ''
    };
    const entries = [
        { commit: B, shortCommit: 'bbbbbbb', summary: 'second', timestamp: '2', parentCommit: A },
        { commit: A, shortCommit: 'aaaaaaa', summary: 'first', timestamp: '1', parentCommit: null }
    ];
    const history = {
        entries,
        files: ['one.txt', 'two.txt'],
        read(file, revision) {
            return { exists: true, content: `${file}:${revision}`, reason: undefined };
        },
        changedCommits() { return [B, A]; },
        changedFiles() { return this.files; },
        directoryEntries(revisions) { return this.changedFiles(revisions).map(relativePath => ({ relativePath })); }
    };
    return {
        calls,
        resolve(input, options) { calls.resolve.push({ input, options }); return context; },
        range(repoRoot, revisions) {
            calls.range.push({ repoRoot, revisions });
            return { status: 'exact', from: revisions[0], to: revisions[1] };
        },
        history(_context, options) {
            calls.history.push(options);
            if (failHistory) throw new Error('history backend failed');
            return history;
        }
    };
}

function makeHost(initial, { confirm = true, unsaved = false, capture = { active: 'one' }, tour } = {}) {
    let session = initial;
    const sent = [];
    const assigned = [];
    const restored = [];
    const confirms = [];
    let confirmValue = confirm;
    let unsavedValue = unsaved;
    const host = {
        getSession: () => session,
        setSession(next) { assigned.push(next); session = next; },
        send(message) { sent.push(message); },
        async capture() { return capture; },
        async confirm(action) { confirms.push(action); return typeof confirmValue === 'function' ? confirmValue(action) : confirmValue; },
        hasUnsaved: () => unsavedValue,
        async render() {},
        restore(navigation) { restored.push(navigation); },
        async openTour() { return typeof tour === 'function' ? tour() : tour; }
    };
    return {
        host,
        sent,
        assigned,
        restored,
        confirms,
        get session() { return session; },
        set confirm(value) { confirmValue = value; },
        set unsaved(value) { unsavedValue = value; }
    };
}

function showMessage() {
    return { type: 'showMultiDiff', panels: [] };
}

test('directory history opens changed files and supports drill-down, return, and revision changes', async () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    git.resolve().paths = [{ path: '', type: 'directory' }];
    const workspace = createWorkspaceHost(fixture.host, git);
    await workspace.openHistory(source({ kind: 'directory-history' }));
    assert.deepEqual(fixture.session.workspaceView, { mode: 'history', path: null, revisions: [A, B] });
    await workspace.render();
    assert.equal(fixture.sent.at(-1).type, 'showDirectoryDiff');
    assert.equal(fixture.sent.at(-1).canMutate, false);
    await workspace.handle({ type: 'openDirectoryEntry', relativePath: 'two.txt' });
    assert.equal(fixture.session.workspaceView.path, 'two.txt');
    await workspace.render();
    assert.equal(fixture.sent.at(-1).canReturnToDirectory, true);
    assert.equal(getMenuCapabilities(fixture.session).canReturnToDirectory, true);
    fixture.confirm = false;
    await workspace.handle({ type: 'returnToDirectory' });
    assert.equal(fixture.session.workspaceView.path, 'two.txt', 'Cancel preserves the file view');
    fixture.confirm = true;
    await workspace.handle({ type: 'returnToDirectory' });
    assert.deepEqual(fixture.session.workspaceView, { mode: 'history', path: null, revisions: [A, B] });
    await workspace.handle({ type: 'historyBack' });
    assert.equal(fixture.session.workspaceView.path, null);
    await workspace.handle({ type: 'selectHistoryEntry', index: 0 });
    assert.equal(fixture.session.workspaceView.path, null);
    await workspace.handle({ type: 'workspaceMode', mode: 'compare' });
    assert.equal(fixture.session.workspaceView.path, null);
    await workspace.handle({ type: 'workspaceMode', mode: 'history' });
    assert.equal(fixture.session.workspaceView.path, null);
    await workspace.handle({ type: 'refreshSession' });
    assert.equal(fixture.session.workspaceView.path, null);
    assert.equal(workspace.uiState().status, '');
});

test('directory launch skips empty working state, but file history still opens a file', async () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    const data = git.history();
    git.resolve().paths = [{ path: '', type: 'directory' }];
    git.resolve().activeRevision = 'WORKTREE';
    data.entries.unshift({ commit: 'WORKTREE', parentCommit: B });
    data.changedFiles = revisions => revisions.includes('WORKTREE') ? [] : ['two.txt'];
    const workspace = createWorkspaceHost(fixture.host, git);
    await workspace.openHistory(source({ kind: 'directory-history' }));
    assert.deepEqual(fixture.session.workspaceView.revisions, [A, B]);
    await workspace.openHistory(source({ kind: 'file-history' }));
    assert.equal(fixture.session.workspaceView.path, 'one.txt');
    assert.deepEqual(fixture.session.workspaceView.revisions, [B, 'WORKTREE']);
});

test('skill file selection is scoped to the workspace, preserves mode, and survives cancellation', async () => {
    const fixture = makeHost(nativeSession());
    fixture.host.defaultTourSkill = () => ({ path: '/app/resources/skills/SKILL.md' });
    let chosen = { path: '/user/my-instructions.md', text: 'Custom instructions' };
    fixture.host.chooseTourSkill = async () => chosen;
    fixture.host.saveTourSkill = async (skill) => ({ ...skill, path: '/user/fork.md' });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    assert.equal(workspace.uiState().tourSkill.path, '/app/resources/skills/SKILL.md');
    await workspace.handle({ type: 'workspaceSkillChoose' });
    assert.deepEqual(workspace.uiState().tourSkill, chosen);
    assert.equal(workspace.uiState().mode, 'compare');
    chosen = null;
    await workspace.handle({ type: 'workspaceSkillChoose' });
    assert.equal(workspace.uiState().tourSkill.path, '/user/my-instructions.md');
    await workspace.handle({ type: 'workspaceSkillSave' });
    assert.deepEqual(workspace.uiState().tourSkill, { path: '/user/fork.md', text: 'Custom instructions' });
    assert.equal(fixture.confirms.length, 0, 'Instruction selection does not replace the editor session');
    fixture.host.setSession(nativeSession(source({ refs: ['other'] })));
    assert.equal(workspace.uiState().tourSkill.path, '/app/resources/skills/SKILL.md');
});

test('a pending instruction selection does not leak into a replacement workspace', async () => {
    const fixture = makeHost(nativeSession());
    let resolve;
    fixture.host.chooseTourSkill = () => new Promise((done) => { resolve = done; });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    const selection = workspace.handle({ type: 'workspaceSkillChoose' });
    fixture.host.setSession(nativeSession(source({ refs: ['another'] })));
    resolve({ path: '/old-workspace/instructions.md', text: 'Old context' });
    await selection;
    assert.equal(workspace.uiState().tourSkill, undefined);
});

async function enterHistory(workspace, fixture) {
    await workspace.handle({ type: 'workspaceMode', mode: 'history' });
    assert.equal(fixture.session.workspaceView.mode, 'history');
}

test('file arrows skip unchanged files in both directions and retain loaded revisions', async () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    const history = git.history();
    history.files = ['one.txt', 'same.txt', 'two.txt', 'unchanged.txt'];
    history.changedFiles = revisions => {
        assert.deepEqual(revisions, ['EMPTY', A]);
        return ['one.txt', 'two.txt'];
    };
    const workspace = createWorkspaceHost(fixture.host, git);
    await enterHistory(workspace, fixture);
    await workspace.render();
    assert.deepEqual(fixture.sent.at(-1).fileNavigation, { canGoPrevious: false, canGoNext: true });
    await workspace.handle({ type: 'navigateFile', direction: 'next' });
    assert.equal(fixture.session.workspaceView.path, 'two.txt');
    assert.deepEqual(fixture.session.workspaceView.revisions, ['EMPTY', A]);
    await workspace.render();
    assert.deepEqual(fixture.sent.at(-1).fileNavigation, { canGoPrevious: true, canGoNext: false });
    await workspace.handle({ type: 'navigateFile', direction: 'next' });
    assert.equal(fixture.session.workspaceView.path, 'two.txt');
    await workspace.handle({ type: 'navigateFile', direction: 'previous' });
    assert.equal(fixture.session.workspaceView.path, 'one.txt');
    await workspace.handle({ type: 'openDirectoryEntry', relativePath: 'same.txt' });
    assert.equal(fixture.session.workspaceView.path, 'same.txt', 'Unchanged files remain directly selectable');
    await workspace.handle({ type: 'navigateFile', direction: 'next' });
    assert.equal(fixture.session.workspaceView.path, 'two.txt');
    history.changedFiles = () => [];
    await workspace.render();
    assert.deepEqual(fixture.sent.at(-1).fileNavigation, { canGoPrevious: false, canGoNext: false });
});

test('initial show augmentation creates workspace state without throwing', () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    const workspace = createWorkspaceHost(fixture.host, git);

    const message = workspace.augment(showMessage());

    assert.equal(message.workspace.history.enabled, true);
    assert.equal(message.history.fileName, 'one.txt');
    assert.equal(message.workspace.mode, 'compare');
    assert.ok(git.calls.resolve.length > 0);
    assert.deepEqual(message.history.rail.tabs.map(tab => tab.label), ['Commits', 'Files']);
});

test('Compare Files tab opens a scoped file while retaining the comparison revisions', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'workspaceOpenFile', relativePath: 'two.txt' });
    assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: 'two.txt', revisions: [A, B] });
    const retained = fixture.session;
    await workspace.handle({ type: 'workspaceOpenFile', relativePath: '../outside' });
    assert.equal(fixture.session, retained);
});

test('history to compare and back preserves the original native session identity', async () => {
    const original = nativeSession();
    const fixture = makeHost(original);
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());

    await enterHistory(workspace, fixture);
    const historySession = fixture.session;
    assert.notEqual(historySession, original);

    await workspace.handle({ type: 'workspaceMode', mode: 'compare' });
    assert.equal(fixture.session, original);
    assert.equal(fixture.session.source, original.source);

    await workspace.handle({ type: 'workspaceBack' });
    assert.equal(fixture.session, original);
    assert.equal(fixture.session.source, original.source);
    assert.ok(historySession.workspaceView);
});

test('selection and Clear update the draft without leaving History mode', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await enterHistory(workspace, fixture);

    await workspace.handle({ type: 'toggleHistorySelection', index: 0 });
    assert.equal(workspace.uiState().mode, 'history');
    assert.equal(workspace.uiState().selectionCount, 1);
    const historySession = fixture.session;

    await workspace.handle({ type: 'workspaceClear' });
    assert.equal(fixture.session, historySession);
    assert.equal(workspace.uiState().mode, 'history');
    assert.equal(workspace.uiState().selectionCount, 0);
});

test('canceled dirty mode transition is atomic', async () => {
    const original = nativeSession();
    const fixture = makeHost(original, { confirm: false, unsaved: true });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());

    await workspace.handle({ type: 'workspaceMode', mode: 'history' });

    assert.equal(fixture.session, original);
    assert.equal(fixture.assigned.length, 0);
    assert.equal(workspace.uiState().mode, 'compare');
});

test('explicit commit actions preserve the comparison draft', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    const draft = workspace.uiState().selectionCount;
    await workspace.handle({ type: 'selectHistoryEntry', index: 0 });
    assert.equal(workspace.uiState().mode, 'history');
    assert.ok(fixture.session.workspaceView.revisions.includes(B));
    assert.equal(workspace.uiState().selectionCount, draft);
    await workspace.handle({ type: 'compareHistoryEntry', index: 0 });
    assert.equal(workspace.uiState().mode, 'compare');
    assert.deepEqual(fixture.session.workspaceView.revisions, [A, B]);
    assert.equal(workspace.uiState().selectionCount, draft);
});

test('canceling a commit jump preserves the current session and draft', async () => {
    const original = nativeSession();
    const fixture = makeHost(original, { confirm: false, unsaved: true });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    await workspace.handle({ type: 'selectHistoryEntry', index: 0 });
    assert.equal(fixture.session, original);
    assert.equal(workspace.uiState().selectionCount, 1);
    assert.equal(workspace.uiState().mode, 'compare');
});

test('canceling tour entry disposes the returned tour and leaves native state unchanged', async () => {
    const original = nativeSession();
    let disposed = 0;
    const fixture = makeHost(original, {
        confirm: false,
        tour: { url: 'http://tour.test', kinds: ['historical'], promptContext: {} , dispose() { disposed += 1; } }
    });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());

    await workspace.handle({ type: 'workspaceOpenTour', kind: 'historical' });

    assert.equal(disposed, 1);
    assert.equal(fixture.session, original);
    assert.equal(fixture.sent.some((message) => message.type === 'workspaceTour'), false);
    assert.equal(workspace.isTourActive(), false);
});

test('discarding edits before tour entry installs the clean retained session', async () => {
    const original = nativeSession();
    original.multi.files[0] = {
        id: 'native-one', path: '/repo/one.txt', content: 'edited', savedContent: 'original', dirty: true
    };
    let disposed = 0;
    const fixture = makeHost(original, {
        unsaved: true,
        tour: { url: 'http://tour.test', kinds: ['historical'], promptContext: {}, dispose() { disposed += 1; } }
    });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());

    await workspace.handle({ type: 'workspaceOpenTour', kind: 'historical' });

    assert.equal(workspace.isTourActive(), true);
    assert.notEqual(fixture.session, original);
    assert.equal(fixture.session.multi.files[0].dirty, false);
    assert.equal(fixture.session.multi.files[0].content, 'original');
    assert.equal(disposed, 0, 'Mode transitions retain the attached tour');
    workspace.reset();
    assert.equal(disposed, 1);
    assert.equal(fixture.session.source, original.source);

    await workspace.handle({ type: 'workspaceBack' });
    assert.equal(workspace.isTourActive(), false);
    assert.equal(fixture.session.multi.files[0].dirty, false);
    assert.equal(fixture.session.multi.files[0].content, 'original');
});

test('a new native session with the same source resets workspace cursors', async () => {
    const sessionSource = source();
    const first = nativeSession(sessionSource);
    const fixture = makeHost(first);
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await enterHistory(workspace, fixture);
    const oldId = workspace.uiState().sessionId;

    const reopened = nativeSession(sessionSource);
    fixture.host.setSession(reopened);
    const message = workspace.augment(showMessage());

    assert.notEqual(message.workspace.sessionId, oldId);
    assert.equal(message.workspace.mode, 'compare');
    assert.equal(message.workspace.canReturn, false);
});

test('backend failure disables History and revision controls without throwing on update', () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit({ failHistory: true }));

    const message = workspace.augment(showMessage());
    assert.equal(message.workspace.history.enabled, false);
    assert.equal(message.workspace.canSelectRevisions, false);
    assert.equal(message.history, undefined);
    assert.doesNotThrow(() => workspace.update());
});

test('History retains its file, panel count, focus, and navigation across mode changes', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    await enterHistory(workspace, fixture);
    await workspace.handle({ type: 'openDirectoryEntry', relativePath: 'two.txt' });
    await workspace.handle({ type: 'multiRemovePanel', panelId: fixture.session.multi.files[0].id });
    const history = fixture.session;
    const focus = history.multi.activePanelId;
    await workspace.handle({ type: 'workspaceMode', mode: 'compare' });
    await workspace.handle({ type: 'workspaceMode', mode: 'history' });
    assert.equal(fixture.session, history);
    assert.equal(fixture.session.workspaceView.path, 'two.txt');
    assert.equal(fixture.session.multi.files.length, 1);
    assert.equal(fixture.session.multi.activePanelId, focus);
    assert.deepEqual(fixture.restored.at(-1), { active: 'one' });
});

test('discarding new edits after a round trip also replaces the original return cursor', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    await enterHistory(workspace, fixture);
    await workspace.handle({ type: 'workspaceBack' });
    fixture.session.multi.files[0].savedContent = 'disk';
    fixture.session.multi.files[0].content = 'discard me';
    fixture.session.multi.files[0].dirty = true;
    fixture.unsaved = true;
    await workspace.handle({ type: 'workspaceMode', mode: 'history' });
    fixture.unsaved = false;
    await workspace.handle({ type: 'workspaceBack' });
    assert.equal(fixture.session.multi.files[0].content, 'disk');
    assert.equal(fixture.session.multi.files[0].dirty, false);
});

test('failed editor capture leaves the comparison intact and disposes a pending tour', async () => {
    const original = nativeSession();
    let disposed = 0;
    const fixture = makeHost(original, { tour: { kinds: ['historical'], dispose() { disposed++; } } });
    fixture.host.capture = async () => { throw new Error('Capture timed out'); };
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    await workspace.handle({ type: 'workspaceOpenTour', kind: 'historical' });
    assert.equal(fixture.session, original);
    assert.equal(workspace.isTourActive(), false);
    assert.equal(disposed, 1);
    assert.match(workspace.uiState().status, /Capture timed out/);
});

test('changing staged visibility rerenders clean panes after discarding edits', async () => {
    const fixture = makeHost(nativeSession());
    let renders = 0;
    fixture.host.render = async () => { renders++; };
    const git = makeGit();
    const workspace = createWorkspaceHost(fixture.host, git);
    await enterHistory(workspace, fixture);
    const before = renders;
    fixture.session.multi.files[0].content = 'discard me';
    fixture.session.multi.files[0].dirty = true;
    fixture.unsaved = true;
    await workspace.handle({ type: 'historyToggleStaged', includeStaged: true });
    assert.equal(renders, before + 1);
    assert.ok(fixture.session.multi.files.every((panel) => !panel.dirty && panel.content !== 'discard me'));
    assert.deepEqual(git.calls.history.at(-1), { includeStaged: true });
    assert.deepEqual(fixture.restored.at(-1), { active: 'one' });
});


test('missing tours are selected views and restore the retained comparison', async () => {
    const original = nativeSession();
    const fixture = makeHost(original);
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    await workspace.handle({ type: 'workspaceMode', mode: 'historical' });
    assert.equal(workspace.uiState().mode, 'historical');
    assert.equal(workspace.uiState().selectionCount, 1);
    assert.equal(fixture.sent.at(-1).type, 'workspaceEmptyTour');
    assert.equal(workspace.augment(showMessage()).type, 'workspaceState');
    await workspace.handle({ type: 'workspaceOpenTour', kind: 'historical' });
    assert.equal(workspace.uiState().mode, 'historical', 'Canceling the picker keeps the empty view');
    await workspace.handle({ type: 'workspaceMode', mode: 'deconstructed' });
    assert.equal(workspace.uiState().mode, 'deconstructed');
    await workspace.handle({ type: 'workspaceMode', mode: 'compare' });
    assert.equal(workspace.uiState().mode, 'compare');
    assert.equal(fixture.session, original);
    assert.deepEqual(fixture.restored.at(-1), { active: 'one' });
    assert.equal(workspace.uiState().selectionCount, 1);
});

test('canceling missing-tour entry preserves edits and the selected native view', async () => {
    const original = nativeSession();
    original.multi.files[0].dirty = true;
    const fixture = makeHost(original, { confirm: false, unsaved: true });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'workspaceMode', mode: 'historical' });
    assert.equal(workspace.uiState().mode, 'compare');
    assert.equal(fixture.session, original);
    assert.equal(original.multi.files[0].dirty, true);
    assert.equal(fixture.sent.some(message => message.type === 'workspaceEmptyTour'), false);
});

test('failed tour loading preserves the empty view and reports the error', async () => {
    const fixture = makeHost(nativeSession(), { tour: () => { throw new Error('Invalid tour'); } });
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    workspace.augment(showMessage());
    await workspace.handle({ type: 'workspaceMode', mode: 'historical' });
    await workspace.handle({ type: 'workspaceOpenTour', kind: 'historical' });
    assert.equal(workspace.uiState().mode, 'historical');
    assert.equal(workspace.uiState().status, 'Invalid tour');
});
