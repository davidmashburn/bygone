const assert = require('node:assert/strict');
const { test } = require('node:test');
const { moveComparisonPanel, applyComparisonOrder, movedPanelPairIndex } = require('../out/panelOrder');
const { reorderComparisonSession } = require('../standalone/panelOrder');
const { normalizeWindowState } = require('../standalone/windowState');

const move = (panels, panelId, targetIndex) => ({ panelId, targetIndex, panelIds: panels.map(panel => panel.id) });
test('moves every panel to every slot, preserving identity and content', () => {
    const panels = Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, content: `edited ${i}`, dirty: true, path: `/file/${i}` }));
    for (let from = 0; from < panels.length; from++) {
        for (let to = 0; to < panels.length; to++) {
            const result = moveComparisonPanel(panels, move(panels, `${from}`, to));
            if (from === to) { assert.equal(result, null); continue; }
            assert.equal(result[to], panels[from]);
            assert.deepEqual(result.filter(panel => panel !== panels[from]), panels.filter(panel => panel !== panels[from]));
            assert.equal(movedPanelPairIndex(result.map(panel => panel.id), `${from}`), Math.min(to, panels.length - 2));
        }
    }
    assert.deepEqual(panels.map(panel => panel.id), ['0', '1', '2', '3', '4', '5']);
});
test('rejects stale, malformed, duplicate, missing and out-of-bounds moves', () => {
    const panels = [{ id: 'a' }, { id: 'b' }];
    for (const mutation of [{ panelIds: ['b', 'a'] }, { panelIds: ['a', 'a'] }, { panelIds: [] }, { panelIds: null }, { panelId: 'missing' }, { targetIndex: -1 }, { targetIndex: 2 }, { targetIndex: 0.5 }]) {
        assert.equal(moveComparisonPanel(panels, { ...move(panels, 'a', 1), ...mutation }), null);
    }
    assert.equal(moveComparisonPanel([{ id: 'a' }], { panelId: 'a', panelIds: ['a'], targetIndex: 0 }), null);
});
test('custom order requires an exact permutation and does not mutate canonical order', () => {
    const items = ['base', 'middle', 'head'];
    assert.deepEqual(applyComparisonOrder(items, ['head', 'base', 'middle'], item => item), ['head', 'base', 'middle']);
    for (const order of [undefined, ['head'], ['base', 'head', 'head'], ['base', 'middle', 'unknown']]) {
        assert.deepEqual(applyComparisonOrder(items, order, item => item), items);
    }
});
test('native file order survives persistence without losing dirty buffers or permissions', () => {
    const a = { id: 'a', path: '/a', content: 'edited', savedContent: 'old', dirty: true, editable: false };
    const b = { id: 'b', path: '/b', content: 'other', editable: true };
    const session = { mode: 'multi-diff', source: { kind: 'files', paths: ['/a', '/b'], readOnly: true }, multi: { files: [a, b] } };
    assert.deepEqual(reorderComparisonSession(session, move(session.multi.files, 'a', 1)), { type: 'reorderMultiPanels', panelIds: ['b', 'a'], activePanelId: 'a' });
    assert.equal(session.multi.files[1], a);
    assert.equal(a.dirty, true);
    assert.equal(a.editable, false);
    const restored = normalizeWindowState({ version: 1, main: { source: session.source }, tours: [] });
    assert.deepEqual(restored.main.source, { kind: 'files', paths: ['/b', '/a'], readOnly: true });
});
test('blanks reorder without acquiring paths; History cannot reorder', () => {
    const session = { mode: 'multi-diff', source: { kind: 'blank' }, multi: { files: [{ id: 'a', path: '', content: 'scratch' }, { id: 'b', path: '', content: '' }] } };
    reorderComparisonSession(session, move(session.multi.files, 'a', 1));
    assert.equal(session.multi.files[1].content, 'scratch');
    assert.deepEqual(session.source, { kind: 'blank' });
    session.multi.sourceKind = 'history';
    assert.equal(reorderComparisonSession(session, move(session.multi.files, 'a', 0)), null);
});
test('directory display order is independent of canonical roots and persists', () => {
    const session = { mode: 'multi-diff', source: { kind: 'directories', paths: ['/left', '/right'] }, returnDirectory: {}, multi: { files: [{ id: 'a', columnIndex: 0 }, { id: 'b', columnIndex: 1 }] } };
    reorderComparisonSession(session, move(session.multi.files, 'a', 1));
    const restored = normalizeWindowState({ version: 1, main: { source: session.source }, tours: [] });
    assert.deepEqual(restored.main.source.paths, ['/left', '/right']);
    assert.deepEqual(restored.main.source.panelOrder, ['1', '0']);
});

test('explicit revision comparisons can move, but commit-selector workspaces cannot', () => {
    const session = { mode: 'multi-diff', source: { kind: 'git-refs', refs: ['HEAD~1', 'HEAD'] },
        returnDirectory: {}, multi: { sourceKind: 'normal', files: [{ id: 'a', columnIndex: 0 }, { id: 'b', columnIndex: 1 }] } };
    assert.ok(reorderComparisonSession(session, move(session.multi.files, 'a', 1)));
    assert.deepEqual(session.multi.files.map(panel => panel.id), ['b', 'a']);
    assert.deepEqual(session.source.refs, ['HEAD~1', 'HEAD']);
    session.workspaceView = { mode: 'compare' };
    assert.equal(reorderComparisonSession(session, move(session.multi.files, 'a', 0)), null);
    delete session.workspaceView;
    session.multi.sourceKind = 'workspace';
    assert.equal(reorderComparisonSession(session, move(session.multi.files, 'a', 0)), null);
});
