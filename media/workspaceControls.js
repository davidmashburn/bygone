import { buildWorkspacePrompt } from '../src/workspacePrompt.ts';

const WORKSPACE_MODES = ['history', 'compare', 'historical', 'deconstructed'];
const MODE_LABELS = {
    history: 'History',
    compare: 'Compare',
    historical: 'Historical tour',
    deconstructed: 'Deconstructed tour'
};
const MISSING_TOUR_COPY = {
    historical: 'No Historical tour is available for this comparison. View or edit a sample LLM prompt.',
    deconstructed: 'No Deconstructed tour is available for this comparison. View or edit a sample LLM prompt.'
};
const RANGE_STATUSES = new Set([
    'exact',
    'none',
    'multiple',
    'uncommitted',
    'reversed',
    'divergent',
    'unavailable'
]);

let controlInstanceId = 0;

/**
 * Mount the shared workspace mode strip and the missing-tour prompt dialog.
 * The controller owns only DOM state and per-session prompt drafts; navigation,
 * tour loading, and repository operations remain with the host.
 */
function createWorkspaceControls({ container, send } = {}) {
    if (!container || typeof container.appendChild !== 'function') {
        throw new TypeError('createWorkspaceControls requires a DOM container.');
    }

    const document = container.ownerDocument || globalThis.document;
    if (!document || typeof document.createElement !== 'function') {
        throw new TypeError('createWorkspaceControls requires a browser document.');
    }

    const emit = typeof send === 'function' ? send : () => {};
    const instanceId = ++controlInstanceId;
    const root = document.createElement('section');
    root.className = 'workspace-controls';
    root.setAttribute('data-workspace-controls', 'true');

    const strip = document.createElement('nav');
    strip.className = 'workspace-mode-strip';
    strip.setAttribute('aria-label', 'Workspace modes');
    root.appendChild(strip);

    const descriptionHost = document.createElement('div');
    descriptionHost.className = 'workspace-mode-descriptions';
    descriptionHost.setAttribute('aria-hidden', 'true');
    root.appendChild(descriptionHost);

    const modeButtons = new Map();
    const modeDescriptions = new Map();
    for (const mode of WORKSPACE_MODES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'workspace-mode-button';
        button.setAttribute('data-workspace-mode', mode);
        button.textContent = MODE_LABELS[mode];

        const description = document.createElement('span');
        description.className = 'workspace-mode-description visually-hidden';
        const descriptionId = `bygone-workspace-${instanceId}-${mode}-description`;
        description.id = descriptionId;
        descriptionHost.appendChild(description);
        button.setAttribute('aria-describedby', descriptionId);
        modeButtons.set(mode, button);
        modeDescriptions.set(mode, description);
        strip.appendChild(button);
    }

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.className = 'workspace-back-button';
    backButton.textContent = 'Back to comparison';
    backButton.title = 'Return to the comparison that opened this workspace';
    backButton.setAttribute('aria-label', 'Back to comparison');
    backButton.setAttribute('data-workspace-back', 'true');
    root.appendChild(backButton);

    const statusElement = document.createElement('div');
    statusElement.className = 'workspace-status';
    statusElement.setAttribute('role', 'status');
    statusElement.setAttribute('aria-live', 'polite');
    statusElement.setAttribute('aria-atomic', 'true');
    root.appendChild(statusElement);

    const dialogParts = createPromptDialog(document, instanceId);
    root.appendChild(dialogParts.dialog);
    container.appendChild(root);

    let currentState = normalizeState();
    let destroyed = false;
    let activeKind = null;
    let activeTrigger = null;
    let restoringFocus = false;
    let interactionStatus = '';
    const draftsBySession = new Map();

    for (const [mode, button] of modeButtons) {
        button.addEventListener('click', () => {
            if (destroyed || button.disabled) return;
            const available = isModeAvailable(mode, currentState);
            if ((mode === 'historical' || mode === 'deconstructed') && !available) {
                openPrompt(mode, button);
                return;
            }
            emit({ type: 'workspaceMode', mode });
        });
    }

    backButton.addEventListener('click', () => {
        if (!destroyed && !backButton.disabled) emit({ type: 'workspaceBack' });
    });

    dialogParts.textarea.addEventListener('input', () => {
        if (!activeKind) return;
        const draft = getDraft(activeKind);
        draft.text = dialogParts.textarea.value;
        draft.edited = true;
    });

    dialogParts.copyButton.addEventListener('click', () => {
        if (!activeKind) return;
        const draft = syncDraftText(activeKind);
        copyPrompt(draft.text);
    });

    dialogParts.resetButton.addEventListener('click', () => {
        if (!activeKind) return;
        const draft = getDraft(activeKind, { reset: true });
        dialogParts.textarea.value = draft.text;
        renderPromptDialog();
        dialogParts.textarea.focus();
    });

    dialogParts.openExistingButton.addEventListener('click', () => {
        if (!activeKind) return;
        syncDraftText(activeKind);
        const kind = activeKind;
        closePrompt();
        emit({ type: 'workspaceOpenTour', kind });
    });

    dialogParts.chooseCompareButton.addEventListener('click', () => {
        if (!activeKind) return;
        syncDraftText(activeKind);
        closePrompt();
        emit({ type: 'workspaceMode', mode: 'compare' });
    });

    dialogParts.closeButton.addEventListener('click', () => closePrompt());
    dialogParts.dialog.addEventListener('cancel', (event) => {
        // Native Escape dispatches cancel before closing. Handling it here makes
        // focus restoration consistent in browsers and test DOMs alike.
        event.preventDefault();
        closePrompt();
    });
    dialogParts.dialog.addEventListener('close', () => {
        activeKind = null;
        interactionStatus = '';
        if (!restoringFocus) restoreFocus();
    });

    update();

    return {
        update,
        destroy
    };

    function update(nextState) {
        if (destroyed) return;
        const next = normalizeState(nextState);
        if (next.sessionId !== currentState.sessionId && isDialogOpen()) {
            closePrompt();
        }
        markContextChanges(next);
        currentState = next;
        renderModes();
        renderStatus();
        if (activeKind) renderPromptDialog();
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        closePrompt();
        if (typeof root.remove === 'function') root.remove();
        else root.parentNode?.removeChild(root);
        modeButtons.clear();
        modeDescriptions.clear();
        draftsBySession.clear();
    }

    function renderModes() {
        for (const mode of WORKSPACE_MODES) {
            const button = modeButtons.get(mode);
            const description = modeDescriptions.get(mode);
            const available = isModeAvailable(mode, currentState);
            const active = available && currentState.mode === mode;
            const missingTour = (mode === 'historical' || mode === 'deconstructed') && !available;
            const unavailableHistory = mode === 'history' && currentState.history.enabled === false;
            const unavailableCompare = mode === 'compare' && currentState.compare.enabled === false;
            const label = mode === 'history'
                ? currentState.history.label
                : mode === 'compare'
                    ? currentState.compare.label
                    : currentState.modeLabels[mode] || MODE_LABELS[mode];
            const explanation = missingTour
                ? `${MISSING_TOUR_COPY[mode]} Opens a prompt dialog without changing the current mode.`
                : unavailableHistory
                    ? currentState.history.reason || 'History is unavailable for this workspace.'
                    : unavailableCompare
                        ? currentState.compare.reason || 'Compare is unavailable for this workspace.'
                    : active
                        ? `${label} is the current workspace mode.`
                        : `Switch to ${label}.`;

            button.textContent = label;
            button.title = explanation;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-description', explanation);
            description.textContent = explanation;
            button.classList.toggle('is-active', active);
            button.classList.toggle('is-missing', missingTour);
            button.classList.toggle('is-unavailable', unavailableHistory || unavailableCompare);
            button.disabled = unavailableHistory || unavailableCompare;
            if (missingTour) button.removeAttribute('aria-pressed');
            else button.setAttribute('aria-pressed', String(active));
        }

        backButton.hidden = currentState.canReturn !== true;
        backButton.disabled = currentState.canReturn !== true;
    }

    function renderStatus() {
        statusElement.textContent = currentState.status || '';
        statusElement.hidden = !currentState.status;
    }

    function openPrompt(kind, trigger) {
        if (destroyed || (kind !== 'historical' && kind !== 'deconstructed')) return;
        activeKind = kind;
        activeTrigger = trigger;
        interactionStatus = currentState.status || '';
        renderPromptDialog();

        if (typeof dialogParts.dialog.showModal === 'function') {
            try {
                dialogParts.dialog.showModal();
            } catch {
                dialogParts.dialog.setAttribute('open', '');
            }
        } else {
            dialogParts.dialog.setAttribute('open', '');
        }
        dialogParts.textarea.focus();
    }

    function closePrompt() {
        if (!isDialogOpen()) {
            activeKind = null;
            restoreFocus();
            return;
        }
        restoringFocus = true;
        try {
            if (typeof dialogParts.dialog.close === 'function') dialogParts.dialog.close();
            else dialogParts.dialog.removeAttribute('open');
            activeKind = null;
            interactionStatus = '';
        } finally {
            restoringFocus = false;
            restoreFocus();
        }
    }

    function restoreFocus() {
        const trigger = activeTrigger;
        activeTrigger = null;
        if (!trigger || typeof trigger.focus !== 'function') return;
        if (trigger.isConnected === false) return;
        try {
            trigger.focus();
        } catch {
            // A host can dispose the strip while a native dialog is closing.
        }
    }

    function isDialogOpen() {
        return dialogParts.dialog.open === true || dialogParts.dialog.hasAttribute('open');
    }

    function renderPromptDialog() {
        if (!activeKind) return;
        const draft = getDraft(activeKind);
        dialogParts.title.textContent = `${MODE_LABELS[activeKind]} prompt`;
        dialogParts.description.textContent = MISSING_TOUR_COPY[activeKind];
        dialogParts.context.textContent = `Current context: ${contextSummary(currentState.promptContext)}`;
        if (draft.contextKey !== contextKey(currentState.promptContext)) {
            dialogParts.draftNotice.hidden = false;
            dialogParts.draftNotice.textContent = `This draft is based on earlier workspace context: ${draft.contextSummary}. Review the repository, revision boundaries, and selected paths before copying.`;
        } else {
            dialogParts.draftNotice.hidden = true;
            dialogParts.draftNotice.textContent = '';
        }
        dialogParts.textarea.value = draft.text;
        dialogParts.status.textContent = interactionStatus;
        dialogParts.status.hidden = !interactionStatus;
    }

    function copyPrompt(text) {
        const clipboard = document.defaultView?.navigator?.clipboard || globalThis.navigator?.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') {
            setDialogStatus('Could not copy the prompt: clipboard access is unavailable.');
            return;
        }
        Promise.resolve()
            .then(() => clipboard.writeText(text))
            .then(() => setDialogStatus('Prompt copied to the clipboard.'))
            .catch((error) => {
                const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
                setDialogStatus(`Could not copy the prompt.${detail}`);
            });
    }

    function setDialogStatus(message) {
        interactionStatus = message;
        dialogParts.status.textContent = message;
        dialogParts.status.hidden = !message;
    }

    function syncDraftText(kind) {
        const draft = getDraft(kind);
        draft.text = dialogParts.textarea.value;
        draft.edited = true;
        return draft;
    }

    function getDraft(kind, { reset = false } = {}) {
        const sessionDrafts = draftsBySession.get(currentState.sessionId) || new Map();
        draftsBySession.set(currentState.sessionId, sessionDrafts);
        if (reset || !sessionDrafts.has(kind)) {
            sessionDrafts.set(kind, {
                text: buildWorkspacePrompt(kind, currentState.promptContext),
                contextKey: contextKey(currentState.promptContext),
                contextSummary: contextSummary(currentState.promptContext),
                edited: false
            });
        }
        return sessionDrafts.get(kind);
    }

    function markContextChanges(nextState) {
        const sessionDrafts = draftsBySession.get(nextState.sessionId);
        if (!sessionDrafts) return;
        for (const draft of sessionDrafts.values()) {
            // Keep the user's text exactly as written. renderPromptDialog will
            // disclose the context that produced it when the context differs.
            draft.contextChanged = draft.contextKey !== contextKey(nextState.promptContext);
        }
    }
}

function createPromptDialog(document, instanceId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-prompt-dialog';
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.id = `bygone-workspace-${instanceId}-prompt-title`;
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.appendChild(title);

    const description = document.createElement('p');
    description.className = 'workspace-prompt-description';
    description.id = `bygone-workspace-${instanceId}-prompt-description`;
    dialog.setAttribute('aria-describedby', description.id);
    dialog.appendChild(description);

    const context = document.createElement('p');
    context.className = 'workspace-prompt-context';
    dialog.appendChild(context);

    const draftNotice = document.createElement('p');
    draftNotice.className = 'workspace-prompt-draft-notice';
    draftNotice.setAttribute('role', 'status');
    draftNotice.hidden = true;
    dialog.appendChild(draftNotice);

    const label = document.createElement('label');
    label.className = 'workspace-prompt-label';
    const textarea = document.createElement('textarea');
    textarea.id = `bygone-workspace-${instanceId}-prompt-textarea`;
    textarea.rows = 22;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Tour authoring prompt draft');
    label.textContent = 'Prompt draft';
    label.appendChild(textarea);
    dialog.appendChild(label);

    const status = document.createElement('p');
    status.className = 'workspace-prompt-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.hidden = true;
    dialog.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'workspace-prompt-actions';
    const copyButton = makeButton(document, 'Copy prompt', 'workspace-prompt-copy');
    const resetButton = makeButton(document, 'Reset sample', 'workspace-prompt-reset');
    const openExistingButton = makeButton(document, 'Open existing tour', 'workspace-prompt-open');
    const chooseCompareButton = makeButton(document, 'Choose revisions in Compare', 'workspace-prompt-compare');
    const closeButton = makeButton(document, 'Close', 'workspace-prompt-close');
    actions.append(copyButton, resetButton, openExistingButton, chooseCompareButton, closeButton);
    dialog.appendChild(actions);

    return {
        dialog,
        title,
        description,
        context,
        draftNotice,
        textarea,
        status,
        copyButton,
        resetButton,
        openExistingButton,
        chooseCompareButton,
        closeButton
    };
}

function makeButton(document, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = label;
    button.setAttribute('data-workspace-prompt-action', action);
    return button;
}

function normalizeState(input = {}) {
    const mode = WORKSPACE_MODES.includes(input?.mode) ? input.mode : 'compare';
    const history = input?.history && typeof input.history === 'object'
        ? {
            enabled: input.history.enabled !== false,
            label: stringOr(input.history.label, 'History'),
            reason: stringOr(input.history.reason, '')
        }
        : { enabled: true, label: 'History', reason: '' };
    const compare = input?.compare && typeof input.compare === 'object'
        ? {
            enabled: input.compare.enabled !== false,
            label: stringOr(input.compare.label, 'Compare'),
            reason: stringOr(input.compare.reason, '')
        }
        : { enabled: true, label: 'Compare', reason: '' };
    const availableTours = Array.isArray(input?.availableTours)
        ? input.availableTours.filter((value) => value === 'historical' || value === 'deconstructed')
        : null;
    return {
        sessionId: sessionKey(input?.sessionId),
        mode,
        modeLabels: input?.modeLabels && typeof input.modeLabels === 'object'
            ? Object.fromEntries(WORKSPACE_MODES.filter((key) => typeof input.modeLabels[key] === 'string').map((key) => [key, input.modeLabels[key]])) : {},
        history,
        compare,
        availableTours,
        promptContext: normalizePromptContext(input?.promptContext),
        canReturn: input?.canReturn === true,
        status: stringOr(input?.status, '')
    };
}

function normalizePromptContext(context) {
    const source = context && typeof context === 'object' ? context : {};
    return {
        ...(typeof source.repository === 'string' ? { repository: source.repository } : {}),
        ...(Array.isArray(source.paths) ? { paths: source.paths.filter((value) => typeof value === 'string') } : {}),
        ...(Array.isArray(source.revisions) ? { revisions: source.revisions.filter((value) => typeof value === 'string') } : {}),
        ...(RANGE_STATUSES.has(source.rangeStatus) ? { rangeStatus: source.rangeStatus } : {}),
        ...(typeof source.reason === 'string' ? { reason: source.reason } : {})
    };
}

function isModeAvailable(mode, state) {
    if (mode === 'history') return state.history.enabled !== false;
    if (mode === 'compare') return state.compare.enabled !== false;
    if (state.availableTours) return state.availableTours.includes(mode);
    return state.mode === mode;
}

function contextKey(context) {
    return JSON.stringify({
        repository: context.repository || '',
        paths: Array.isArray(context.paths) ? context.paths : [],
        revisions: Array.isArray(context.revisions) ? context.revisions : [],
        rangeStatus: context.rangeStatus || '',
        reason: context.reason || ''
    });
}

function contextSummary(context) {
    const repository = context.repository || '(not resolved)';
    const paths = Array.isArray(context.paths) && context.paths.length > 0
        ? context.paths.join(', ')
        : context.repository && Array.isArray(context.paths)
            ? '. (repository root; full requested scope)'
            : '(scope not supplied)';
    const revisions = Array.isArray(context.revisions) && context.revisions.length > 0
        ? context.revisions.join(', ')
        : '(none reported)';
    return `repository ${repository}; paths ${paths}; revisions ${revisions}; range ${context.rangeStatus || 'unavailable'}`;
}

function sessionKey(value) {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : 'default';
}

function stringOr(value, fallback) {
    return typeof value === 'string' ? value : fallback;
}

export { createWorkspaceControls };
