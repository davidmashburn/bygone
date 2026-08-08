/* global module */

const FIND_ACTION_IDS = {
    open: 'actions.find',
    next: 'editor.action.nextMatchFindAction',
    previous: 'editor.action.previousMatchFindAction'
};

function isUsableEditor(editor) {
    if (!editor || typeof editor.getModel !== 'function') {
        return false;
    }
    try {
        return Boolean(editor.getModel());
    } catch {
        return false;
    }
}

function resolveFindTarget(state) {
    if (state?.mode === 'two-way') {
        const preferred = state.activePaneSide === 'left' ? state.leftEditor : state.rightEditor;
        if (isUsableEditor(preferred)) {
            return preferred;
        }
        const fallback = state.activePaneSide === 'left' ? state.rightEditor : state.leftEditor;
        return isUsableEditor(fallback) ? fallback : null;
    }

    if (state?.mode === 'multi-way') {
        const panelIndex = (state.multiPanels || []).findIndex((panel) => panel.id === state.activeMultiPanelId);
        const editor = panelIndex >= 0 ? state.multiEditors?.[panelIndex] : null;
        return isUsableEditor(editor) ? editor : null;
    }

    return null;
}

function dispatchFindCommand(editor, command) {
    const actionId = FIND_ACTION_IDS[command];
    if (!actionId || !isUsableEditor(editor)) {
        return false;
    }
    const action = editor.getAction?.(actionId);
    if (!action || typeof action.run !== 'function') {
        return false;
    }
    editor.focus?.();
    void action.run();
    return true;
}

function runFindCommand(state, command) {
    return dispatchFindCommand(resolveFindTarget(state), command);
}

module.exports = {
    FIND_ACTION_IDS,
    dispatchFindCommand,
    isUsableEditor,
    resolveFindTarget,
    runFindCommand
};
