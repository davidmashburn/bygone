const assert = require('node:assert/strict');
const { test } = require('node:test');
const { revisionFileTarget, revisionFileNavigation, revisionFileAction, revisionDirectoryView, revisionPanelsView, revisionPanelPairs, revisionRailItems } = require('../out/revisionView');

test('revision navigation skips unchanged files in both directions without inventing a current file', () => {
    const files = { paths: ['a', 'unchanged', 'b', 'c'], currentPath: 'b', changedPaths: new Set(['a', 'b']) };
    assert.equal(revisionFileTarget(files, -1), 'a');
    assert.equal(revisionFileTarget(files, 1), null);
    assert.deepEqual(revisionFileNavigation(files), { canGoPrevious: true, canGoNext: false });
    for (const currentPath of [null, 'outside-scope']) {
        assert.deepEqual(revisionFileNavigation({ ...files, currentPath }), { canGoPrevious: false, canGoNext: false });
    }
    assert.equal(revisionFileTarget(files, 0), null);
    assert.equal(revisionFileTarget({ ...files, changedPaths: undefined }, 1), 'c', 'Compare may include unchanged selected evidence');
});

test('overview/file actions validate paths and return capability, keeping the revision selection with the host', () => {
    const files = { paths: ['a', 'b'], currentPath: 'a' };
    assert.deepEqual(revisionFileAction({ type: 'openDirectoryEntry', relativePath: 'b' }, files, true), { path: 'b' });
    assert.deepEqual(revisionFileAction({ type: 'returnToDirectory' }, files, true), { path: null });
    assert.deepEqual(revisionFileAction({ type: 'navigateFile', direction: 'next' }, files, true), { path: 'b' });
    assert.equal(revisionFileAction({ type: 'returnToDirectory' }, files, false), null);
    for (const relativePath of ['../outside', 'missing', null, 5]) {
        assert.equal(revisionFileAction({ type: 'openDirectoryEntry', relativePath }, files, true), null);
    }
    assert.equal(revisionFileAction({ type: 'navigateFile', direction: 'sideways' }, files, true), null);
    assert.equal(revisionFileAction({ type: 'navigateFile', direction: 'previous' }, files, true), null);
    assert.equal(files.currentPath, 'a', 'Resolving an action must not bypass the host save/cancellation guard');
});

test('shared panel views retain host capabilities and compare every adjacent pair', () => {
    const panels = [
        { id: 'old', content: 'before', editable: false },
        { id: 'middle', content: 'middle', editable: false },
        { id: 'live', content: 'after', editable: true, dirty: true }
    ];
    const options = { panels, files: { paths: ['file'], currentPath: 'file' },
        activePanelId: 'middle', activePairIndex: 1, canReturnToDirectory: true, mutationEnabled: true };
    const desktop = revisionPanelsView(options);
    const browser = revisionPanelsView({ ...options, mutationEnabled: false }, (left, right) => [left.content, right.content]);
    assert.deepEqual(desktop.pairs, [{ leftIndex: 0, rightIndex: 1 }, { leftIndex: 1, rightIndex: 2 }]);
    assert.deepEqual(browser.pairs.map(pair => pair.diffModel), [['before', 'middle'], ['middle', 'after']]);
    assert.equal(desktop.panels, panels);
    assert.equal(desktop.panels[2].dirty, true);
    assert.equal(browser.mutationEnabled, false);
    assert.equal(browser.activePanelId, 'middle');
    assert.equal(browser.canReturnToDirectory, true);
    assert.deepEqual(revisionPanelPairs([panels[0]]), []);
    assert.deepEqual(revisionDirectoryView(['old', 'middle', 'new'], []), {
        type: 'showDirectoryDiff', labels: ['old', 'middle', 'new'], leftLabel: 'old', rightLabel: 'new', entries: [], canMutate: false
    });
});

test('commit rails keep focus, draft selection, file changes and panel membership independent', () => {
    const entries = ['c', 'b'].map(commit => ({ commit, shortCommit: commit, summary: `Commit ${commit}`,
        parentCommit: 'a', author: 'Author', message: 'Full message' }));
    const options = { displayed: ['a', 'b'], selected: ['c'], active: 'b', changed: new Set(['c']),
        tourCommits: new Set(['b']), selectionEnabled: true, missingRevisionLabel: commit => commit || 'Empty tree' };
    const rows = revisionRailItems(entries, options);
    assert.deepEqual(rows.map(row => [row.commit, row.active, row.selected, row.panelNumber]), [
        ['c', false, true, undefined], ['b', true, false, 2], ['a', false, false, 1]
    ]);
    assert.equal(rows[0].changesFile, true);
    assert.equal(rows[0].inTour, false);
    assert.equal(rows[1].inTour, true);
    assert.deepEqual(rows[1].parents, ['a']);
    assert.equal(rows[1].message, 'Full message');
    assert.equal(rows[2].kind, 'panel-revision');
    assert.equal(rows[2].selectionEnabled, false);
    const synthetic = revisionRailItems(entries, { ...options, displayed: [undefined, undefined] });
    assert.equal(synthetic.length, entries.length);
    assert.ok(synthetic.every(row => !row.panelNumber));
    const empty = revisionRailItems(entries, { ...options, displayed: [null, 'b'], missingRevisionSelectionEnabled: true });
    assert.equal(empty.at(-1).label, 'Empty tree');
    assert.equal(empty.at(-1).selectionEnabled, true);
    assert.deepEqual(entries.map(entry => entry.commit), ['c', 'b'], 'Building the rail does not mutate evidence order');
});
