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
    await Promise.resolve();
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
    assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: 'two.txt', revisions: [A, B], panelOrder: [A, B] });
    const retained = fixture.session;
    await workspace.handle({ type: 'workspaceOpenFile', relativePath: '../outside' });
    assert.equal(fixture.session, retained);
});

test('filename-first labels retain distinct paths and revisions through Apply', async () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    const files = ['src/one/item.py', 'src/two/item.py'];
    git.history().files = files;
    git.resolve().paths = [{ path: '', type: 'directory' }];
    const workspace = createWorkspaceHost(fixture.host, git);
    for (const file of files) {
        await workspace.handle({ type: 'workspaceOpenFile', relativePath: file });
        await workspace.handle({ type: 'workspaceReset' });
        await workspace.handle({ type: 'workspaceApply' });
        assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: file, revisions: [A, B] });
        assert.equal(workspace.uiState().selectionApplied, true);
        for (const [index, panel] of fixture.session.multi.files.entries()) {
            assert.match(panel.label, /^item\.py @ /);
            assert.ok(panel.label.endsWith(` · ${file.slice(0, file.lastIndexOf('/'))}`));
            assert.equal(panel.path, `/repo/${file}`);
            assert.equal(panel.revision, [A, B][index]);
            assert.equal(panel.content, `${file}:${panel.revision}`);
        }
    }
});

test('Files rail marks changes against displayed revisions while retaining unchanged files', async () => {
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    const compared = [];
    git.history().changedFiles = revisions => { compared.push(revisions); return ['two.txt']; };
    const workspace = createWorkspaceHost(fixture.host, git);
    const rail = workspace.augment(showMessage()).history.rail;
    assert.equal(rail.tabs.find(tab => tab.id === 'workspace-files').filterChangedFiles, true);
    assert.deepEqual(rail.itemsByTab['workspace-files'].map(item => [item.relativePath, item.changed]), [['one.txt', false], ['two.txt', true]]);
    await workspace.handle({ type: 'workspaceClear' });
    workspace.augment(showMessage());
    assert.deepEqual(compared.at(-1), [A, B], 'An unapplied draft does not change the file filter');
    await workspace.handle({ type: 'workspaceOpenFile', relativePath: 'one.txt' });
    assert.equal(fixture.session.workspaceView.path, 'one.txt', 'An unchanged file can still be opened');
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

test('Apply removes a displayed empty base and keeps exactly the three selected revisions', async () => {
    const C = 'c'.repeat(40);
    const original = nativeSession(source({ resolvedRevisions: ['EMPTY', A, B, C] }));
    const fixture = makeHost(original);
    const git = makeGit();
    git.resolve().revisions = ['EMPTY', A, B, C];
    git.history().entries.unshift({ commit: C, shortCommit: 'ccccccc', summary: 'third', parentCommit: B });
    const workspace = createWorkspaceHost(fixture.host, git);
    const rail = workspace.augment(showMessage()).history.rail.itemsByTab.history;
    const base = rail.find(item => item.commit === 'EMPTY');
    assert.equal(base.selectionEnabled, true);
    assert.equal(base.panelNumber, 1);
    await workspace.handle({ type: 'workspaceReset' });
    assert.equal(workspace.uiState().selectionCount, 4);
    assert.equal(workspace.uiState().selectionApplied, true);
    await workspace.handle({ type: 'toggleHistorySelection', index: base.index });
    assert.equal(workspace.uiState().selectionCount, 3);
    assert.equal(workspace.uiState().selectionApplied, false);
    await workspace.handle({ type: 'workspaceApply' });
    assert.deepEqual(fixture.session.workspaceView.revisions, [A, B, C]);
    assert.deepEqual(fixture.session.multi.files.map(file => file.revision), [A, B, C]);
    assert.equal(workspace.uiState().selectionApplied, true);
    const displayed = workspace.augment(showMessage()).history.rail.itemsByTab.history.filter(item => item.panelNumber);
    assert.deepEqual(displayed.map(item => [item.commit, item.panelNumber]), [[C, 3], [B, 2], [A, 1]]);
});

test('selection and Apply are processed in order during another workspace update', async () => {
    const fixture = makeHost(nativeSession());
    const workspace = createWorkspaceHost(fixture.host, makeGit());
    await workspace.handle({ type: 'workspaceMode', mode: 'history' });
    let release;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    fixture.host.capture = () => { started(); return new Promise(resolve => { release = resolve; }); };
    const refresh = workspace.handle({ type: 'refreshSession' });
    await entered;
    const first = workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    const second = workspace.handle({ type: 'toggleHistorySelection', index: 0 });
    const apply = workspace.handle({ type: 'workspaceApply' });
    fixture.host.capture = async () => ({});
    release({});
    await Promise.all([refresh, first, second, apply]);
    assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: 'one.txt', revisions: [A, B] });
    assert.equal(workspace.uiState().selectionApplied, true);
});

test('selection menu changes file scope and opens the original base-to-head diff', async () => {
    const C = 'c'.repeat(40);
    const fixture = makeHost(nativeSession());
    const git = makeGit();
    git.resolve().paths = [{ path: '', type: 'directory' }];
    git.resolve().revisions = [A, B, C];
    const workspace = createWorkspaceHost(fixture.host, git);
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    await workspace.handle({ type: 'toggleHistorySelection', index: 0 });
    await workspace.handle({ type: 'workspaceApply' });
    assert.equal(workspace.uiState().canShowAllFiles, true);
    await workspace.handle({ type: 'workspaceAllFiles' });
    assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: null, revisions: [A, B] });
    assert.equal(workspace.uiState().canShowAllFiles, false);
    await workspace.handle({ type: 'workspaceFinalDiff' });
    assert.deepEqual(fixture.session.workspaceView, { mode: 'compare', path: null, revisions: [A, C] });
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

test('commit-selector Compare rejects moves and restores canonical revision order', async () => {
    const setup = makeHost(nativeSession(source({ refs: [A, B] })));
    const workspace = createWorkspaceHost(setup.host, makeGit());
    await workspace.handle({ type: 'toggleHistorySelection', index: 0 });
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    await workspace.handle({ type: 'workspaceApply' });
    await workspace.render();
    assert.equal(setup.sent.at(-1).reorderEnabled, false);
    const original = setup.session.multi.files;
    original[0].content = 'edited buffer';
    original[0].dirty = true;
    await workspace.handle({ type: 'multiMovePanel', panelId: original[0].id, targetIndex: 1, panelIds: original.map(panel => panel.id) });
    assert.equal(setup.session.multi.files, original, 'Even a stale move request is ignored');
    assert.equal(original[0].content, 'edited buffer');
    assert.deepEqual(setup.session.workspaceView.revisions, [A, B]);
    // Discard display order saved by the earlier reorderable version.
    setup.session.source.comparisonView.panelOrder = [B, A];
    const persisted = require('../standalone/windowState').normalizeWindowState({ version: 1, main: { source: setup.session.source }, tours: [] });
    const restored = makeHost(nativeSession());
    const restoredWorkspace = createWorkspaceHost(restored.host, makeGit());
    await restoredWorkspace.restoreComparison(persisted.main.source);
    assert.deepEqual(restored.session.multi.files.map(panel => panel.revision), [A, B]);
    await restoredWorkspace.handle({ type: 'workspaceOpenFile', relativePath: 'two.txt' });
    await restoredWorkspace.handle({ type: 'refreshSession' });
    assert.deepEqual(restored.session.multi.files.map(panel => panel.revision), [A, B]);
    await restoredWorkspace.render();
    assert.equal(restored.sent.at(-1).reorderEnabled, false);
});

test('explicit revision comparison badges follow moved panels before entering the selector', async () => {
    const initial = nativeSession(source({ refs: [A, B], resolvedRevisions: [A, B] }));
    initial.multi.files = [{ id: 'a', columnIndex: 0 }, { id: 'b', columnIndex: 1 }];
    initial.multi.sourceKind = 'normal';
    initial.returnDirectory = { relativePath: 'one.txt' };
    const setup = makeHost(initial);
    const workspace = createWorkspaceHost(setup.host, makeGit());
    workspace.augment(showMessage());
    const request = { type: 'multiMovePanel', panelId: 'a', targetIndex: 1, panelIds: ['a', 'b'] };
    assert.equal(await workspace.handle(request), false, 'Explicit comparisons use the normal host move handler');
    assert.ok(require('../standalone/panelOrder').reorderComparisonSession(initial, request));
    workspace.update();
    const entries = setup.sent.at(-1).history.rail.itemsByTab.history;
    assert.equal(entries.find(item => item.commit === A).panelNumber, 2);
    assert.equal(entries.find(item => item.commit === B).panelNumber, 1);
    await workspace.handle({ type: 'toggleHistorySelection', index: 0 });
    await workspace.handle({ type: 'toggleHistorySelection', index: 1 });
    await workspace.handle({ type: 'workspaceApply' });
    await workspace.render();
    assert.equal(setup.sent.at(-1).reorderEnabled, false, 'Applying a commit selection switches to fixed revision order');
    assert.deepEqual(setup.session.multi.files.map(panel => panel.revision), [A, B]);
});
