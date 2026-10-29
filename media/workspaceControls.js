import { buildWorkspacePrompt } from '../src/workspacePrompt.ts';
import tourSkillInstructions from '../skills/pr-tour-guide/SKILL.md';
import tourSkillFeedback from '../skills/pr-tour-guide/references/expectations-and-feedback.md';

const bundledTourSkill = tourSkillInstructions.replace('(references/expectations-and-feedback.md)', '(#expectations-and-reader-feedback)')
    + '\n\n' + tourSkillFeedback;

const WORKSPACE_MODES = ['history', 'compare', 'historical', 'deconstructed'];
const MODE_LABELS = {
    history: 'History',
    compare: 'Compare',
    historical: 'Historical tour',
    deconstructed: 'Deconstructed tour'
};
const MISSING_TOUR_COPY = {
    historical: 'No Historical tour is available. Copy a prompt for your coding agent and read or customize its Markdown instructions.',
    deconstructed: 'No Deconstructed tour is available. Copy a prompt for your coding agent and read or customize its Markdown instructions.'
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
const DEPENDENCY_STATUSES = new Set(['idle', 'loading', 'ready', 'error', 'navigating']);

let controlInstanceId = 0;

/**
 * Mount shared workspace tabs, the missing-tour view, and its prompt dialog.
 * The controller owns only DOM state and per-session prompt drafts; navigation,
 * tour loading, and repository operations remain with the host.
 */
function createWorkspaceControls({ container, content, send } = {}) {
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
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Workspace views');
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
        button.id = `bygone-workspace-${instanceId}-${mode}-tab`;
        button.setAttribute('role', 'tab');
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

    const statusElement = document.createElement('div');
    statusElement.className = 'workspace-status';
    statusElement.setAttribute('role', 'status');
    statusElement.setAttribute('aria-live', 'polite');
    statusElement.setAttribute('aria-atomic', 'true');
    root.appendChild(statusElement);

    const revisionContext = document.createElement('span');
    revisionContext.className = 'workspace-revision-context';
    root.appendChild(revisionContext);

    const dependencyButton = document.createElement('button');
    dependencyButton.type = 'button';
    dependencyButton.className = 'workspace-dependency-button';
    dependencyButton.textContent = 'Dependencies';
    dependencyButton.setAttribute('aria-label', 'Open dependency graph');
    root.appendChild(dependencyButton);

    const panel = content || container;
    if (!panel.id) panel.id = `bygone-workspace-${instanceId}-view`;
    panel.setAttribute('role', 'tabpanel');
    const emptyView = document.createElement('section');
    emptyView.className = 'workspace-empty-view';
    emptyView.setAttribute('data-workspace-empty-tour', '');
    emptyView.hidden = true;
    const emptyTitle = document.createElement('h2');
    const emptyDescription = document.createElement('p');
    const emptyActions = document.createElement('div');
    emptyActions.className = 'workspace-empty-actions';
    const createButton = makeButton(document, 'Create tour…', 'create-tour');
    const openButton = makeButton(document, 'Open existing tour…', 'open-tour');
    emptyActions.append(createButton, openButton);
    emptyView.append(emptyTitle, emptyDescription, emptyActions);
    panel.appendChild(emptyView);

    const dialogParts = createPromptDialog(document, instanceId);
    root.appendChild(dialogParts.dialog);
    const dependencyParts = createDependencyDialog(document, instanceId);
    root.appendChild(dependencyParts.dialog);
    container.appendChild(root);

    let currentState = normalizeState();
    let destroyed = false;
    let activeKind = null;
    let activeTrigger = null;
    let restoringFocus = false;
    let interactionStatus = '';
    let dependencyTrigger = null;
    let dependencyDismissed = false;
    const draftsBySession = new Map();
    const skillsBySession = new Map();

    const dependencyMessageListener = event => {
        if (destroyed || event.source !== dependencyParts.frame.contentWindow) return;
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'dependencySource') {
            dependencyDismissed = false;
            setDependencyState({ status: 'navigating', error: '', url: '', html: '' });
            emit({ type: 'dependencySource', source: message.source });
        } else if (message.type === 'dependencyLoadCorrespondence') {
            dependencyDismissed = false;
            setDependencyState({ status: 'loading', error: '', url: '', html: '' });
            emit({ type: 'dependencyLoadCorrespondence' });
        }
    };
    (document.defaultView || globalThis.window)?.addEventListener?.('message', dependencyMessageListener);

    for (const [mode, button] of modeButtons) {
        button.addEventListener('click', () => {
            if (destroyed || button.disabled) return;
            if (mode === currentState.mode) return;
            emit({ type: 'workspaceMode', mode });
        });
        button.addEventListener('keydown', event => {
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            const enabled = [...modeButtons.values()].filter(tab => !tab.disabled);
            const index = enabled.indexOf(button);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
            event.preventDefault();
            enabled[next]?.focus();
            enabled[next]?.click();
        });
    }

    createButton.addEventListener('click', () => openPrompt(currentState.mode, createButton));
    openButton.addEventListener('click', () => emit({ type: 'workspaceOpenTour', kind: currentState.mode }));
    dependencyButton.addEventListener('click', () => {
        if (destroyed || dependencyButton.disabled) return;
        dependencyDismissed = false;
        dependencyTrigger = dependencyButton;
        setDependencyState({ status: 'loading', error: '', html: '', url: '' });
        renderDependencyGraph(currentState.dependencyGraph, { open: true });
        emit({ type: 'workspaceDependencyGraph' });
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

    dialogParts.saveSkillButton.addEventListener('click', () => {
        if (currentState.nativeSkillFiles) {
            emit({ type: 'workspaceSkillSave' });
            return;
        }
        const skill = getSkill();
        const url = URL.createObjectURL(new Blob([skill.text], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = skill.name || 'bygone-tour-skill.md';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setDialogStatus('Markdown downloaded. Edit your copy, then choose Use my copy. Attach it alongside the prompt when your agent cannot read local files.');
    });
    dialogParts.chooseSkillButton.addEventListener('click', () => {
        if (currentState.nativeSkillFiles) emit({ type: 'workspaceSkillChoose' });
        else dialogParts.skillFile.click();
    });
    dialogParts.skillFile.addEventListener('change', async () => {
        const file = dialogParts.skillFile.files?.[0];
        const sessionId = currentState.sessionId;
        dialogParts.skillFile.value = '';
        if (!file) return;
        try {
            if (!file.name.toLowerCase().endsWith('.md') || file.size > 1024 * 1024) throw new Error('Choose a Markdown file smaller than 1 MiB.');
            const text = await file.text();
            if (!text.trim()) throw new Error('The instructions file is empty.');
            skillsBySession.set(sessionId, { name: file.name, text });
            if (destroyed || currentState.sessionId !== sessionId) return;
            renderPromptDialog();
            setDialogStatus('Custom instructions selected. Attach this Markdown file with the prompt.');
        } catch (error) {
            if (!destroyed && currentState.sessionId === sessionId) setDialogStatus(`Could not load instructions: ${error.message}`);
        }
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

    dependencyParts.closeButton.addEventListener('click', () => requestDependencyClose());
    dependencyParts.dialog.addEventListener('cancel', event => {
        event.preventDefault();
        requestDependencyClose();
    });
    dependencyParts.dialog.addEventListener('close', () => {
        dependencyDismissed = true;
        const trigger = dependencyTrigger;
        dependencyTrigger = null;
        if (trigger && trigger.isConnected !== false) trigger.focus?.();
    });

    update();

    return {
        update,
        updateDependencyGraph,
        destroy
    };

    function update(nextState) {
        if (destroyed) return;
        const previous = currentState;
        const next = normalizeState(nextState);
        if (next.sessionId !== currentState.sessionId && isDialogOpen()) {
            closePrompt();
        }
        if (next.sessionId !== previous.sessionId && isDependencyDialogOpen()) closeDependencyDialog();
        if (nextState?.dependencyGraph && typeof nextState.dependencyGraph === 'object'
            && !Object.prototype.hasOwnProperty.call(nextState.dependencyGraph, 'html')
            && next.sessionId === previous.sessionId
            && next.dependencyGraph.status === 'ready') {
            next.dependencyGraph.html = previous.dependencyGraph.html;
            next.dependencyGraph.url = previous.dependencyGraph.url;
        }
        markContextChanges(next);
        if (activeKind && next.status !== currentState.status) interactionStatus = next.status;
        currentState = next;
        renderModes();
        renderEmptyView();
        renderStatus();
        renderDependencyEntry();
        if (next.mode !== 'compare') closeDependencyDialog();
        const dependencyChanged = previous.sessionId !== next.sessionId
            || previous.dependencyGraph.status !== next.dependencyGraph.status;
        if (dependencyChanged) renderDependencyGraph(next.dependencyGraph, { open: true });
        if (activeKind) renderPromptDialog();
    }

    function updateDependencyGraph(message) {
        if (destroyed || (message?.sessionId !== undefined && sessionKey(message.sessionId) !== currentState.sessionId)) return;
        const incoming = message?.graph && typeof message.graph === 'object' ? message.graph : message;
        if (!incoming || typeof incoming !== 'object') return;
        currentState = { ...currentState, dependencyGraph: normalizeDependencyGraph({ ...currentState.dependencyGraph, ...incoming }) };
        renderDependencyEntry();
        renderDependencyGraph(currentState.dependencyGraph, { open: true });
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        closePrompt();
        closeDependencyDialog();
        (document.defaultView || globalThis.window)?.removeEventListener?.('message', dependencyMessageListener);
        if (typeof root.remove === 'function') root.remove();
        else root.parentNode?.removeChild(root);
        modeButtons.clear();
        modeDescriptions.clear();
        emptyView.remove();
        draftsBySession.clear();
        skillsBySession.clear();
    }

    function setDependencyState(changes) {
        currentState = { ...currentState, dependencyGraph: normalizeDependencyGraph({ ...currentState.dependencyGraph, ...changes }) };
        renderDependencyEntry();
        renderDependencyGraph(currentState.dependencyGraph);
    }

    function renderDependencyEntry() {
        const graph = currentState.dependencyGraph;
        dependencyButton.hidden = !graph.visible;
        dependencyButton.disabled = !graph.enabled;
        dependencyButton.title = graph.enabled ? 'Open the native dependency graph for the pinned comparison.'
            : graph.reason || 'Dependency graph analysis is unavailable.';
        dependencyButton.setAttribute('aria-description', dependencyButton.title);
    }

    function renderDependencyGraph(graph, { open = false } = {}) {
        if (!graph || graph.status === 'idle') {
            dependencyParts.frame.hidden = true;
            if (isDependencyDialogOpen()) closeDependencyDialog();
            return;
        }
        dependencyParts.status.hidden = false;
        dependencyParts.status.textContent = graph.status === 'loading'
            ? 'Analyzing pinned dependency snapshots…'
            : graph.status === 'navigating'
                ? 'Opening the pinned source in Compare…'
                : graph.status === 'error'
                    ? `Dependency analysis failed: ${graph.error || 'Unknown error.'}`
                    : graph.url || graph.html ? 'Dependency graph loaded.' : 'Preparing dependency graph…';
        const view = graph.url || graph.html;
        dependencyParts.frame.hidden = graph.status !== 'ready' || !view;
        if (graph.status === 'ready' && graph.url) {
            dependencyParts.frame.removeAttribute?.('srcdoc');
            if (dependencyParts.frame.src !== graph.url) dependencyParts.frame.src = graph.url;
        } else if (graph.status === 'ready' && graph.html) {
            dependencyParts.frame.removeAttribute?.('src');
            if (dependencyParts.frame.srcdoc !== graph.html) dependencyParts.frame.srcdoc = graph.html;
        }
        if (open && !dependencyDismissed && !isDependencyDialogOpen()) openDependencyDialog();
    }

    function openDependencyDialog() {
        dependencyDismissed = false;
        if (typeof dependencyParts.dialog.showModal === 'function') {
            try { dependencyParts.dialog.showModal(); }
            catch { dependencyParts.dialog.setAttribute('open', ''); }
        } else dependencyParts.dialog.setAttribute('open', '');
        dependencyParts.closeButton.focus?.();
    }

    function closeDependencyDialog() {
        if (!isDependencyDialogOpen()) {
            dependencyDismissed = true;
            return;
        }
        try {
            if (typeof dependencyParts.dialog.close === 'function') dependencyParts.dialog.close();
            else dependencyParts.dialog.removeAttribute('open');
        } finally {
            dependencyDismissed = true;
        }
    }

    function requestDependencyClose() {
        closeDependencyDialog();
        if (!destroyed) emit({ type: 'workspaceDependencyClose' });
    }

    function isDependencyDialogOpen() {
        return dependencyParts.dialog.open === true || dependencyParts.dialog.hasAttribute('open');
    }

    function renderModes() {
        for (const mode of WORKSPACE_MODES) {
            const button = modeButtons.get(mode);
            const description = modeDescriptions.get(mode);
            const available = isModeAvailable(mode, currentState);
            const active = currentState.mode === mode;
            const missingTour = (mode === 'historical' || mode === 'deconstructed') && !available;
            const unavailableTour = missingTour && !currentState.canCreateTours;
            const unavailableHistory = mode === 'history' && currentState.history.enabled === false;
            const unavailableCompare = mode === 'compare' && currentState.compare.enabled === false;
            const label = mode === 'history'
                ? currentState.history.label
                : mode === 'compare'
                    ? currentState.compare.label
                    : currentState.modeLabels[mode] || MODE_LABELS[mode];
            const explanation = unavailableTour
                ? currentState.unavailableTourReason
                : missingTour
                ? `No ${label} yet. Open this view to create or open a tour.`
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
            button.classList.toggle('is-unavailable', unavailableHistory || unavailableCompare || unavailableTour);
            button.disabled = unavailableHistory || unavailableCompare || unavailableTour;
            button.setAttribute('aria-selected', String(active));
            button.setAttribute('aria-controls', panel.id);
            if (active) panel.setAttribute('aria-labelledby', button.id);
        }
    }

    function renderEmptyView() {
        const mode = currentState.mode;
        const missing = ['historical', 'deconstructed'].includes(mode) && !isModeAvailable(mode, currentState);
        emptyView.hidden = !missing;
        createButton.hidden = !currentState.canCreateTours;
        openButton.hidden = !currentState.canOpenTours;
        if (missing) {
            const label = currentState.modeLabels[mode] || MODE_LABELS[mode];
            emptyTitle.textContent = `No ${label} yet`;
            emptyDescription.textContent = 'Create a tour with your coding agent, or open one you already have.';
        }
    }

    function renderStatus() {
        statusElement.textContent = currentState.status || '';
        statusElement.hidden = !currentState.status;
        revisionContext.textContent = currentState.revisionContext;
        revisionContext.hidden = !currentState.revisionContext;
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
        const skill = getSkill();
        dialogParts.title.textContent = `${MODE_LABELS[activeKind]} prompt`;
        dialogParts.description.textContent = MISSING_TOUR_COPY[activeKind];
        dialogParts.context.textContent = `Current context: ${contextSummary(currentState.promptContext)}`;
        if (draft.skillKey !== skillKey()) {
            dialogParts.draftNotice.hidden = false;
            dialogParts.draftNotice.textContent = 'The selected instructions changed. Your edited prompt was preserved; use Reset prompt to reference the selected file, or update its reference yourself.';
        } else if (draft.contextKey !== contextKey(currentState.promptContext)) {
            dialogParts.draftNotice.hidden = false;
            dialogParts.draftNotice.textContent = `This draft is based on earlier workspace context: ${draft.contextSummary}. Review the repository, revision boundaries, and selected paths before copying.`;
        } else {
            dialogParts.draftNotice.hidden = true;
            dialogParts.draftNotice.textContent = '';
        }
        dialogParts.textarea.value = draft.text;
        dialogParts.skillText.value = skill.text;
        dialogParts.skillReference.textContent = skill.path
            ? `Instructions: ${skill.path}. Local agents can read this path; for browser chats, save and attach a copy.`
            : `Instructions: ${skill.name || 'bygone-tour-skill.md'} (attachment). Download and attach it with the prompt; browsers do not expose its full local path.`;
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
        const existing = sessionDrafts.get(kind);
        if (reset || !existing || (!existing.edited && existing.skillKey !== skillKey())) {
            sessionDrafts.set(kind, {
                text: buildWorkspacePrompt(kind, currentState.promptContext, getSkill()),
                skillKey: skillKey(),
                contextKey: contextKey(currentState.promptContext),
                contextSummary: contextSummary(currentState.promptContext),
                edited: false
            });
        }
        return sessionDrafts.get(kind);
    }

    function getSkill() {
        return currentState.tourSkill || skillsBySession.get(currentState.sessionId)
            || { name: 'bygone-tour-skill.md', text: bundledTourSkill };
    }

    function skillKey() {
        const skill = getSkill();
        return JSON.stringify([skill.path || '', skill.name || '', skill.text]);
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
    textarea.rows = 9;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Tour authoring prompt draft');
    label.textContent = 'Prompt draft';
    label.appendChild(textarea);
    dialog.appendChild(label);

    const skillReference = document.createElement('p');
    skillReference.className = 'workspace-prompt-context';
    dialog.appendChild(skillReference);
    const skillDetails = document.createElement('details');
    const skillSummary = document.createElement('summary');
    skillSummary.textContent = 'Read instructions (Markdown)';
    const skillText = document.createElement('textarea');
    skillText.readOnly = true;
    skillText.rows = 12;
    skillText.setAttribute('aria-label', 'Tour skill Markdown instructions');
    skillDetails.append(skillSummary, skillText);
    dialog.appendChild(skillDetails);
    const skillActions = document.createElement('div');
    skillActions.className = 'workspace-prompt-actions';
    const saveSkillButton = makeButton(document, 'Save an editable copy', 'workspace-skill-save');
    const chooseSkillButton = makeButton(document, 'Use my copy', 'workspace-skill-choose');
    const skillFile = document.createElement('input');
    skillFile.type = 'file';
    skillFile.accept = '.md,text/markdown';
    skillFile.hidden = true;
    skillActions.append(saveSkillButton, chooseSkillButton, skillFile);
    dialog.appendChild(skillActions);

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
    const resetButton = makeButton(document, 'Reset prompt', 'workspace-prompt-reset');
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
        skillText,
        skillReference,
        saveSkillButton,
        chooseSkillButton,
        skillFile,
        status,
        copyButton,
        resetButton,
        openExistingButton,
        chooseCompareButton,
        closeButton
    };
}

function createDependencyDialog(document, instanceId) {
    const dialog = document.createElement('dialog');
    dialog.className = 'workspace-dependency-dialog';
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.id = `bygone-workspace-${instanceId}-dependency-title`;
    title.textContent = 'Dependency graph';
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.appendChild(title);

    const status = document.createElement('p');
    status.className = 'workspace-dependency-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    dialog.appendChild(status);

    const frame = document.createElement('iframe');
    frame.className = 'workspace-dependency-frame';
    frame.title = 'Pinned dependency graph';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.hidden = true;
    dialog.appendChild(frame);

    const actions = document.createElement('div');
    actions.className = 'workspace-dependency-actions';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.title = 'Close dependency graph';
    actions.appendChild(closeButton);
    dialog.appendChild(actions);
    return { dialog, status, frame, closeButton };
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
        canCreateTours: input?.canCreateTours !== false,
        canOpenTours: input?.canOpenTours !== false,
        unavailableTourReason: stringOr(input?.unavailableTourReason, 'This tour is unavailable in this workspace.'),
        revisionContext: stringOr(input?.revisionContext, ''),
        nativeSkillFiles: input?.nativeSkillFiles === true,
        tourSkill: input?.tourSkill && typeof input.tourSkill.path === 'string'
            ? { path: input.tourSkill.path, text: typeof input.tourSkill.text === 'string' ? input.tourSkill.text : bundledTourSkill } : null,
        promptContext: normalizePromptContext(input?.promptContext),
        status: stringOr(input?.status, ''),
        dependencyGraph: normalizeDependencyGraph(input?.dependencyGraph)
    };
}

function normalizeDependencyGraph(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
        visible: source.visible === true,
        enabled: source.enabled === true,
        reason: stringOr(source.reason, ''),
        status: DEPENDENCY_STATUSES.has(source.status) ? source.status : 'idle',
        error: stringOr(source.error, ''),
        canLoadCorrespondence: source.canLoadCorrespondence === true,
        url: typeof source.url === 'string' ? source.url : '',
        html: typeof source.html === 'string' ? source.html : ''
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
