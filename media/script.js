import { dedupeDecorations } from './decorationUtils';
import { buildBlockChanges, findChangeIndexAtLine, resolveFileNavigationAction } from './navigationUtils';
import { dispatchFindCommand, runFindCommand } from './findController';
import { applyWordWrap, readWordWrapPreference, writeWordWrapPreference } from './wrapController';
import { computeFocusedStripLayout } from './focusedStripController';
import { findVisibleMatches } from './visibleSearchController';
import { applyTwoWayRenderTransition } from './renderTransition';
import { normalizeLanguageId } from '../src/languageSupport';

const host = createHostBridge();
const {
    VIEW_IDS,
    getElement,
    setTextContent,
    clearHistoryToolbar,
    escapeAttr,
    renderPlainLines,
    renderResultLines,
    toggleView,
    setStatus,
    resetScrollPositions,
    resetDirectoryView,
    renderDirectoryView,
    expandAllDirectories,
    collapseAllDirectories,
    collapseUnchangedDirectories
} = window.BygoneDom;

const MODE_TWO_WAY = 'two-way';
const MODE_MULTI_WAY = 'multi-way';
const MULTI_PANE_MIN_WIDTH = 360;
const MULTI_GUTTER_WIDTH = 96;
const NAVIGATION_SIDEBAR_STORAGE_KEY = 'bygone.navigationSidebarWidth';
const NAVIGATION_SIDEBAR_MIN_WIDTH = 220;
const NAVIGATION_SIDEBAR_MAX_WIDTH = 520;

let currentMode = MODE_TWO_WAY;
let diffBlocks = [];
let monacoInstance;
let leftEditor;
let rightEditor;
let leftDecorationIds = [];
let rightDecorationIds = [];
let activeDiffIndex = -1;
let currentDiffModel = null;
let currentTourAnnotations = [];
let suppressEditorEvents = false;
let recomputeTimer;
let multiRecomputeTimer;
const multiRecomputePendingPanelIds = new Set();
let diffWorker = null;
let diffRequestIdCounter = 0;
const diffPendingRequests = new Map();
let twoWayDiffEpoch = 0;
let multiDiffEpoch = 0;
let pendingDiffJobs = 0;
let pendingTwoWayPayload;
let pendingMultiPayload;
let currentDiffRows = [];
let scrollMaps = null;
let historyMode = false;
let hostEditableSides = { left: true, right: true };
let userReadOnly = false;
let directoryEntries = [];
let multiEditors = [];
let multiDecorationIds = [];
let multiDiffPairs = [];
let multiPanels = [];
let activeMultiPanelId = null;
let activeMultiPairIndex = null;
let multiPanelChangeIndices = new Map();
let multiPanelMutationEnabled = false;
let focusedStripLayout = null;
let focusedStripWheelDelta = 0;
let historyRailState = null;
let activeHistoryRailTabId = null;
let historyRailKind = null;
let directoryRailVisible = true;
let navigationRailCollapsed = false;
let navigationRailWidth = readStoredSidebarWidth(
    NAVIGATION_SIDEBAR_STORAGE_KEY,
    282,
    NAVIGATION_SIDEBAR_MIN_WIDTH,
    NAVIGATION_SIDEBAR_MAX_WIDTH
);
let hasDirectoryNavigation = false;
let hostFileNavigation = null;
let currentFileNavigation = { canGoPrevious: false, canGoNext: false };
let activePaneSide = 'right';
let activeDirectoryEntryPath = null;
let currentTwoWayComparisonKey = null;
let suppressDirectoryScrollSync = false;
let refreshSessionState = { enabled: false, status: 'disabled', message: null };
let pendingNavigationRestore = null;
let wordWrapEnabled = readWordWrapPreference(window.localStorage);
let lastPostedWordWrapState = null;
let workspaceResizeScrollSnapshot = null;
let changeSetSearchRequestId = 0;
let changeSetSearchTimer = null;
let gitHistorySearchRequestId = 0;
let gitHistorySearchTimer = null;
let repositorySearchRequestId = 0;
let repositorySearchRoot = '';
let repositorySearchMatches = [];
let repositoryReplacementFiles = [];
let modelIdentityCounter = 0;
const editorModelIdentities = new WeakMap();
const connectorController = window.BygoneConnectors.createConnectorController({
    getElement,
    getMode: () => currentMode,
    getEditors: () => ({ leftEditor, rightEditor }),
    getDiffBlocks: () => diffBlocks,
    getActiveDiffIndex: () => activeDiffIndex,
    getDirectoryEntries: () => directoryEntries,
    getMultiDiffState: () => ({
        editors: multiEditors,
        pairs: multiDiffPairs,
        activePairIndex: activeMultiPairIndex,
        activeDiffIndex
    }),
    getMonaco: () => monacoInstance
});

function notifyRenderComplete() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            applyPendingNavigationRestore();
            host.postMessage({
                type: 'renderComplete',
                mode: currentMode
            });
        });
    });
}

host.onMessage((message) => {
    if (!message || typeof message !== 'object') {
        return;
    }

    if (message.refreshState) {
        updateRefreshSessionState(message.refreshState);
    }

    if (message.type === 'refreshState') {
        return;
    }

    if (message.type === 'captureNavigationState' && Number.isInteger(message.requestId)) {
        host.postMessage({
            type: 'navigationState',
            requestId: message.requestId,
            navigation: captureNavigationState()
        });
        return;
    }

    if (message.type === 'restoreNavigationState') {
        pendingNavigationRestore = {
            navigation: message.navigation || null,
            panelIdMap: message.panelIdMap || {}
        };
        applyPendingNavigationRestore();
        return;
    }

    if (message.type === 'find' && ['open', 'next', 'previous', 'replace', 'replaceAll'].includes(message.command)) {
        runActiveEditorFindCommand(message.command);
        return;
    }

    if (message.type === 'editorAction' && typeof message.actionId === 'string') {
        void runActiveEditorAction(message.actionId);
        return;
    }

    if (message.type === 'navigateChange' && (message.direction === -1 || message.direction === 1)) {
        navigateDiff(message.direction);
        return;
    }

    if (message.type === 'visibleSearch') {
        openVisiblePaneSearch();
        return;
    }

    if (message.type === 'openRepositorySearch' && typeof message.root === 'string') {
        openRepositorySearch(message.root);
        return;
    }

    if (message.type === 'repositorySearchBatch' && message.requestId === repositorySearchRequestId) {
        repositorySearchMatches.push(...(message.matches || []));
        renderRepositorySearchResults();
        return;
    }

    if (message.type === 'repositorySearchComplete' && message.requestId === repositorySearchRequestId) {
        completeRepositorySearch(message.completion);
        return;
    }

    if (message.type === 'repositoryReplacementPreview' && message.requestId === repositorySearchRequestId) {
        receiveRepositoryReplacementPreview(message);
        return;
    }

    if (message.type === 'repositoryReplacementApplied') {
        receiveRepositoryReplacementApplied(message);
        return;
    }

    if (message.type === 'repositoryReplacementUndone') {
        receiveRepositoryReplacementUndone(message);
        return;
    }

    if (message.type === 'changeSetSearchResults' && message.requestId === changeSetSearchRequestId) {
        receiveChangeSetSearchResults(message);
        return;
    }

    if (message.type === 'gitHistorySearchResults' && message.requestId === gitHistorySearchRequestId) {
        receiveGitHistorySearchResults(message);
        return;
    }

    if (message.type === 'revealSearchResult' && Number.isInteger(message.lineNumber)) {
        revealHostSearchResult(message);
        return;
    }

    if (message.type === 'toggleWordWrap') {
        toggleWordWrap();
        return;
    }

    if (message.type === 'showDiff') {
        if (!monacoInstance) {
            pendingTwoWayPayload = message;
            return;
        }

        showTwoWayDiff(
            message.file1,
            message.file2,
            message.leftContent,
            message.rightContent,
            message.diffModel,
            message.history || null,
            message.fileNavigation || null,
            Boolean(message.canReturnToDirectory),
            message.editableSides,
            message.comparisonId,
            message.directoryNavigation || null,
            message.comparisonSummary || null,
            message.initialChangeIndex,
            message.tourAnnotations || [],
            message.sourceInfo || null
        );
        return;
    }

    if (message.type === 'showBinaryDiff') {
        showBinaryDiff(message);
        return;
    }

    if (message.type === 'showDirectoryDiff') {
        showDirectoryDiff(
            message.leftLabel,
            message.rightLabel,
            message.entries,
            message.labels,
            message.history || null,
            message.canMutate !== false,
            message.review || null
        );
        return;
    }

    if (message.type === 'showMultiDiff') {
        if (!monacoInstance) {
            pendingMultiPayload = message;
            return;
        }

        showMultiDiff(
            message.panels,
            message.pairs,
            message.activePanelId ?? null,
            message.activePairIndex ?? null,
            message.history ?? null,
            message.fileNavigation ?? null,
            Boolean(message.canReturnToDirectory),
            message.directoryNavigation || null,
            message.mutationEnabled !== false,
            message.initialChangeIndex,
            Boolean(message.revealFirstChangeInEachPanel),
            message.tourAnnotations || []
        );
        return;
    }

    if (message.type === 'showThreeWayMerge') {
        showThreeWayMerge(message);
    }
});

window.addEventListener('load', async () => {
    connectorController.initializeCanvas();
    initializeHistoryRail();
    initializeHistoryToolbar();
    initializeDirectoryTreeToolbar();
    initializeChangeToolbar();
    initializeVisiblePaneSearch();
    initializeRepositorySearch();
    initializeDirectoryReturnToolbar();
    initializeEditModeToolbar();
    initializeDirectoryViewEvents();
    initializeMultiDiffInteractions();
    initializeStandaloneDropTarget();
    initializeDiffWorker();
    await initializeMonaco();
    postWordWrapState();
    host.postMessage({ type: 'ready' });

    if (pendingTwoWayPayload) {
        showTwoWayDiff(
            pendingTwoWayPayload.file1,
            pendingTwoWayPayload.file2,
            pendingTwoWayPayload.leftContent,
            pendingTwoWayPayload.rightContent,
            pendingTwoWayPayload.diffModel,
            pendingTwoWayPayload.history || null,
            pendingTwoWayPayload.fileNavigation || null,
            Boolean(pendingTwoWayPayload.canReturnToDirectory),
            pendingTwoWayPayload.editableSides,
            pendingTwoWayPayload.comparisonId,
            pendingTwoWayPayload.directoryNavigation || null,
            pendingTwoWayPayload.comparisonSummary || null,
            pendingTwoWayPayload.initialChangeIndex,
            pendingTwoWayPayload.tourAnnotations || [],
            pendingTwoWayPayload.sourceInfo || null
        );
        pendingTwoWayPayload = undefined;
    }

    if (pendingMultiPayload) {
        showMultiDiff(
            pendingMultiPayload.panels,
            pendingMultiPayload.pairs,
            pendingMultiPayload.activePanelId ?? null,
            pendingMultiPayload.activePairIndex ?? null,
            pendingMultiPayload.history ?? null,
            pendingMultiPayload.fileNavigation ?? null,
            Boolean(pendingMultiPayload.canReturnToDirectory),
            pendingMultiPayload.directoryNavigation || null,
            pendingMultiPayload.mutationEnabled !== false,
            pendingMultiPayload.initialChangeIndex,
            Boolean(pendingMultiPayload.revealFirstChangeInEachPanel),
            pendingMultiPayload.tourAnnotations || []
        );
        pendingMultiPayload = undefined;
    }
});

window.addEventListener('resize', () => {
    applyFocusedStripLayout(false);
    layoutEditors(workspaceResizeScrollSnapshot?.editors || null);
    restoreWorkspaceResizeScrollSnapshot();
    if (workspaceResizeScrollSnapshot) requestAnimationFrame(restoreWorkspaceResizeScrollSnapshot);
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
});

window.addEventListener('bygone:workspace-resize-start', () => {
    workspaceResizeScrollSnapshot = captureWorkspaceResizeScrollSnapshot();
});

window.addEventListener('bygone:workspace-resize-end', () => {
    restoreWorkspaceResizeScrollSnapshot();
    requestAnimationFrame(() => {
        restoreWorkspaceResizeScrollSnapshot();
        workspaceResizeScrollSnapshot = null;
    });
});

async function initializeMonaco() {
    self.MonacoEnvironment = {
        getWorker: () => new Worker(host.editorWorkerUrl)
    };

    monacoInstance = window.monaco;
    registerJsonLanguage(monacoInstance);
    applyMonacoTheme();

    new MutationObserver(() => applyMonacoTheme()).observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style']
    });
}

function registerJsonLanguage(monaco) {
    if (monaco.languages.getLanguages().some((language) => language.id === 'json')) return;
    monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON'] });
    monaco.languages.setLanguageConfiguration('json', {
        brackets: [['{', '}'], ['[', ']']],
        autoClosingPairs: [
            { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }
        ],
        surroundingPairs: [
            { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }
        ]
    });
    monaco.languages.setMonarchTokensProvider('json', {
        tokenizer: {
            root: [
                [/\s+/, 'white'],
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [/"(?:\\.|[^"\\])*"(?=\s*:)/, 'key'],
                [/"(?:\\.|[^"\\])*"/, 'string'],
                [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
                [/\b(?:true|false|null)\b/, 'keyword'],
                [/[{},:]|\[|\]/, 'delimiter']
            ],
            comment: [
                [/[^*/]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[*/]/, 'comment']
            ]
        }
    });
}

function applyMonacoTheme() {
    if (!monacoInstance) {
        return;
    }

    const styles = getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    const foreground = styles.getPropertyValue('--vscode-foreground').trim() || '#d4d4d4';
    const lineNumber = styles.getPropertyValue('--vscode-editorLineNumber-foreground').trim() || '#858585';
    const selection = styles.getPropertyValue('--vscode-editor-selectionBackground').trim() || '#264f78';
    const bodyClasses = document.body.classList;
    const isDark = bodyClasses.contains('vscode-dark')
        || bodyClasses.contains('vscode-high-contrast')
        || (!bodyClasses.contains('vscode-light')
            && !bodyClasses.contains('vscode-high-contrast-light')
            && isDarkColor(background));

    monacoInstance.editor.defineTheme('bygone', {
        base: isDark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': background,
            'editor.foreground': foreground,
            'editorGutter.background': background,
            'editorLineNumber.foreground': lineNumber,
            'editor.selectionBackground': selection
        }
    });
    monacoInstance.editor.setTheme('bygone');
}

function isDarkColor(color) {
    const hex = color.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    const rgb = color.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i);
    let channels;

    if (hex) {
        const value = hex[1].length === 3
            ? [...hex[1]].map((character) => character + character).join('')
            : hex[1];
        channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
    } else if (rgb) {
        channels = rgb.slice(1, 4).map(Number);
    } else {
        return true;
    }

    const luminance = channels.reduce(
        (total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index],
        0
    );
    return luminance < 140;
}

function showTwoWayDiff(file1, file2, leftContent, rightContent, diffModel, history, fileNavigation, canReturnToDirectory = false, nextEditableSides = null, comparisonId = null, directoryNavigation = null, comparisonSummary = null, initialChangeIndex = undefined, tourAnnotations = [], sourceInfo = null) {
    const diffEpoch = ++twoWayDiffEpoch;
    const comparisonKey = comparisonId || `${file1}\u0000${file2}`;
    const comparisonChanged = currentMode !== MODE_TWO_WAY || currentTwoWayComparisonKey !== comparisonKey;
    currentMode = MODE_TWO_WAY;
    currentTwoWayComparisonKey = comparisonKey;
    currentTourAnnotations = tourAnnotations;
    historyMode = Boolean(history);
    activeDirectoryEntryPath = null;
    hostEditableSides = normalizeEditableSides(nextEditableSides, historyMode);
    if (hostEditableSides.left && !hostEditableSides.right) {
        activePaneSide = 'left';
    } else if (hostEditableSides.right) {
        activePaneSide = 'right';
    }
    const suppliedDiffModel = diffModel || { rows: [], leftLines: [], rightLines: [], blocks: [], hasChanges: false };
    setCurrentDiffModel(suppliedDiffModel);
    const nextActiveDiffIndex = comparisonChanged ? (initialChangeIndex ?? 0) : activeDiffIndex;
    const nextResolvedDiffIndex = diffBlocks.length > 0 ? clamp(nextActiveDiffIndex, 0, diffBlocks.length - 1) : -1;
    directoryEntries = [];
    disposeMultiEditors();

    toggleView(VIEW_IDS.twoWay);
    setStatus('', false);
    setTextContent('file-info', comparisonSummary || `Comparing ${file1} and ${file2}`);
    setTextContent('file1-header', file1);
    setTextContent('file2-header', file2);
    updateHistoryToolbar(history);
    updateNavigationRail(history?.rail || directoryNavigation?.rail || null, history ? 'history' : (directoryNavigation ? 'directory' : null));
    updateFileNavigationState(fileNavigation || null, canReturnToDirectory);
    updateDirectoryReturnToolbar(canReturnToDirectory);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();

    ensureTwoWayEditors();
    updateActivePaneHeader();
    applyTwoWayRenderTransition({
        updateModels: () => updateEditorValues(leftContent, rightContent, comparisonKey, sourceInfo || {
            leftPath: file1,
            rightPath: file2
        }),
        updateActiveIndex: () => {
            activeDiffIndex = nextResolvedDiffIndex;
        },
        applyDecorations: () => applyDiffDecorations(suppliedDiffModel, currentTourAnnotations)
    });
    updateTwoWayEditorOptions();
    updateChangeToolbarState();
    resetTwoWayScrollPositions();
    layoutEditors();
    revealActiveDiff(false);
    const activeTourAnnotation = tourAnnotations.find((annotation) => annotation.active);
    if (activeTourAnnotation) {
        const editor = activeTourAnnotation.side === 'left' ? leftEditor : rightEditor;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            editor.revealLineInCenter(
                activeTourAnnotation.startLine,
                monacoInstance.editor.ScrollType.Immediate
            );
        }));
    }
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();

    if (!diffModel) {
        computeTwoWayDiffAsync(leftContent, rightContent, comparisonKey, nextActiveDiffIndex, diffEpoch);
    } else {
        notifyRenderComplete();
    }
}

function computeTwoWayDiffAsync(leftContent, rightContent, comparisonKey, nextActiveDiffIndex, epoch) {
    beginDiffJob();
    requestDiffAsync(leftContent, rightContent)
        .then((model) => {
            if (epoch !== twoWayDiffEpoch || currentMode !== MODE_TWO_WAY || currentTwoWayComparisonKey !== comparisonKey) {
                return;
            }
            setCurrentDiffModel(model);
            setActiveDiffIndex(diffBlocks.length > 0 ? clamp(nextActiveDiffIndex, 0, diffBlocks.length - 1) : -1, false);
            applyDiffDecorations(model, currentTourAnnotations);
            updateChangeToolbarState();
            connectorController.scheduleDrawConnections();
            revealActiveDiff(false);
            notifyRenderComplete();
        })
        .catch((error) => {
            if (epoch === twoWayDiffEpoch && currentMode === MODE_TWO_WAY && currentTwoWayComparisonKey === comparisonKey) {
                setStatus(`Unable to compute diff: ${error.message}`, true);
                notifyRenderComplete();
            }
        })
        .finally(endDiffJob);
}

function showBinaryDiff(message) {
    const comparison = message.comparison;
    currentMode = 'binary';
    currentTwoWayComparisonKey = null;
    historyMode = false;
    activeDirectoryEntryPath = message.directoryNavigation?.activeRelativePath || null;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = [];
    hostEditableSides = { left: false, right: false };

    disposeTwoWayEditors();
    disposeMultiEditors();
    toggleView(VIEW_IDS.twoWay);
    setStatus('', false);
    const subject = comparison.kind === 'image' ? 'Images' : 'Binary files';
    setTextContent(
        'file-info',
        message.comparisonSummary || `${subject} are ${comparison.identical ? 'byte-for-byte identical' : 'different byte-for-byte'}`
    );
    setTextContent('file1-header', comparison.left.label);
    setTextContent('file2-header', comparison.right.label);
    updateHistoryToolbar(null);
    updateNavigationRail(message.directoryNavigation?.rail || null, message.directoryNavigation ? 'directory' : null);
    updateFileNavigationState(message.fileNavigation || null, Boolean(message.canReturnToDirectory));
    updateDirectoryReturnToolbar(Boolean(message.canReturnToDirectory));
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    renderBinarySide(getElement('file1-content'), comparison.left, comparison.identical);
    renderBinarySide(getElement('file2-content'), comparison.right, comparison.identical);
    resetTwoWayScrollPositions();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function renderBinarySide(container, side, identical) {
    container.classList.remove('editor-host');
    container.classList.add('binary-preview-host');
    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'binary-preview-card';
    const state = document.createElement('div');
    state.className = `binary-preview-state ${identical ? 'is-identical' : 'is-different'}`;
    state.textContent = identical ? 'Byte-identical' : 'Bytes differ';
    card.appendChild(state);

    const stage = document.createElement('div');
    stage.className = 'binary-preview-stage';
    if (!side.exists) {
        const missing = document.createElement('div');
        missing.className = 'binary-preview-placeholder';
        missing.textContent = 'Missing on this side';
        stage.appendChild(missing);
    } else if (side.dataUrl) {
        const image = document.createElement('img');
        image.className = 'binary-preview-image';
        image.src = side.dataUrl;
        image.alt = side.label;
        stage.appendChild(image);
    } else {
        const icon = document.createElement('div');
        icon.className = 'binary-preview-icon';
        icon.textContent = side.kind === 'image' ? '▣' : '◈';
        const reason = document.createElement('div');
        reason.className = 'binary-preview-placeholder';
        reason.textContent = side.previewUnavailableReason || 'No textual preview';
        stage.append(icon, reason);
    }
    card.appendChild(stage);

    const metadata = document.createElement('div');
    metadata.className = 'binary-preview-metadata';
    metadata.textContent = side.exists
        ? `${side.mimeType || 'binary data'} · ${formatByteLength(side.byteLength)}`
        : 'File does not exist';
    card.appendChild(metadata);
    container.appendChild(card);
}

function formatByteLength(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showDirectoryDiff(leftLabel, rightLabel, entries, labels, history, canMutate = true, review = null) {
    currentMode = 'directory';
    historyMode = false;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = entries || [];
    activeDirectoryEntryPath = getDefaultDirectoryEntryPath(directoryEntries);
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(history);
    updateNavigationRail(history?.rail || null, history ? 'history' : null);
    updateFileNavigationState(null, false);
    updateDirectoryReturnToolbar(false);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    const directoryLabels = Array.isArray(labels) && labels.length >= 2 ? labels : [leftLabel, rightLabel];

    toggleView(VIEW_IDS.directory);
    setStatus('', false);
    setTextContent('file-info', review
        ? `Exploring ${review.headRef} against ${review.baseRef} · ${review.viewedCount}/${review.changedFileCount} files viewed · ${review.commitCount} commits${review.mergeCommitCount ? ` (${review.mergeCommitCount} merge)` : ''}${review.dirty ? ' · working tree dirty (not included)' : ''}`
        : `Comparing directories ${directoryLabels.join(' and ')}`);

    resetDirectoryView();
    renderDirectoryView(getElement('dir-rows'), directoryEntries, directoryLabels, canMutate);
    collapseUnchangedDirectories(getElement('dir-rows'), directoryEntries);
    attachDirectoryScrollSync();
    resetDirectoryScrollPositions();
    updateDirectoryEntrySelection();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function showMultiDiff(panels, pairs, nextActivePanelId = null, nextActivePairIndex = null, history = null, fileNavigation = null, canReturnToDirectory = false, directoryNavigation = null, mutationEnabled = true, initialChangeIndex = undefined, revealFirstChangeInEachPanel = false, tourAnnotations = []) {
    if (!Array.isArray(panels) || panels.length < 1) {
        return;
    }

    currentMode = MODE_MULTI_WAY;
    currentTourAnnotations = tourAnnotations;
    historyMode = false;
    currentDiffModel = null;
    activeDiffIndex = -1;
    diffBlocks = [];
    currentDiffRows = [];
    scrollMaps = null;
    directoryEntries = [];
    clearTimeout(multiRecomputeTimer);
    multiRecomputeTimer = null;
    multiRecomputePendingPanelIds.clear();
    disposeTwoWayEditors();
    disposeMultiEditors(false);
    multiPanels = panels;
    multiDiffPairs = pairs || [];
    activeMultiPanelId = resolveActiveMultiPanelId(panels, nextActivePanelId);
    activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, nextActivePairIndex, activeMultiPanelId, panels);
    multiPanelChangeIndices = new Map();
    multiPanelMutationEnabled = mutationEnabled;
    updateHistoryToolbar(history);
    updateNavigationRail(history?.rail || directoryNavigation?.rail || null, history ? 'history' : (directoryNavigation ? 'directory' : null));
    updateFileNavigationState(fileNavigation, canReturnToDirectory);
    updateDirectoryReturnToolbar(canReturnToDirectory);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.multiWay);
    setStatus('', false);
    const isBlankMultiPanel = panels.length === 1 && !panels[0]?.path && !panels[0]?.content;
    setTextContent(
        'file-info',
        isBlankMultiPanel ? 'Blank editable diff' : `Comparing ${panels.length} file${panels.length === 1 ? '' : 's'}`
    );

    renderMultiDiffShell(panels);
    applyFocusedStripLayout(false);
    suppressEditorEvents = true;
    multiEditors = panels.map((panel, index) => {
        const editor = createEditor(getElement(`multi-pane-${index}-content`), MODE_MULTI_WAY, panel.id, {
            identity: `multi:${panel.id}`,
            content: panel.content,
            languageId: normalizeLanguageId(panel.languageId, panel.path || panel.label)
        });
        editor.updateOptions({ readOnly: panel.editable === false });
        return editor;
    });
    suppressEditorEvents = false;
    multiDecorationIds = multiEditors.map(() => []);
    updateMultiActivePairModel(false);
    resetMultiScrollPositions();
    layoutEditors();
    requestAnimationFrame(() => {
        layoutEditors();
        if (revealFirstChangeInEachPanel) {
            revealFirstMultiPanelChanges();
        }
        if (Number.isInteger(initialChangeIndex)) {
            setActiveMultiPanelChangeIndex(initialChangeIndex, true);
        }
        revealActiveMultiPanel();
        const activeTourAnnotation = tourAnnotations.find((annotation) => annotation.active);
        if (activeTourAnnotation && Number.isInteger(activeTourAnnotation.panelIndex)) {
            const editor = multiEditors[activeTourAnnotation.panelIndex];
            if (editor) {
                editor.revealLineInCenter(
                    activeTourAnnotation.startLine,
                    monacoInstance.editor.ScrollType.Immediate
                );
            }
        }
        connectorController.resizeCanvas();
        connectorController.scheduleDrawConnections();
    });
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
    computeMissingPairDiffsAsync();
}

function computeMissingPairDiffsAsync() {
    const missing = multiDiffPairs
        .map((pair, index) => ({ pair, index }))
        .filter(({ pair }) => !pair?.diffModel);
    if (missing.length === 0) {
        return;
    }
    const epoch = ++multiDiffEpoch;
    beginDiffJob();
    Promise.all(missing.map(({ pair, index }) =>
        requestDiffAsync(multiPanels[pair.leftIndex]?.content ?? '', multiPanels[pair.rightIndex]?.content ?? '')
            .then((model) => ({ index, model }))
            .catch(() => ({ index, model: null }))
    )).then((results) => {
        endDiffJob();
        if (epoch !== multiDiffEpoch || currentMode !== MODE_MULTI_WAY) {
            return;
        }
        for (const { index, model } of results) {
            if (multiDiffPairs[index] && model) {
                multiDiffPairs[index] = { ...multiDiffPairs[index], diffModel: model };
            }
        }
        activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, activeMultiPairIndex, activeMultiPanelId, multiPanels);
        updateMultiActivePairModel(false, activeMultiPairIndex);
        updateActiveMultiShellState();
        updateChangeToolbarState();
        applyMultiDiffDecorations(multiDiffPairs);
        connectorController.scheduleDrawConnections();
    });
}

function showThreeWayMerge(message) {
    currentMode = 'three-way';
    currentDiffModel = null;
    activeDiffIndex = -1;
    setCurrentDiffModel({ blocks: [], rows: [] });
    historyMode = false;
    directoryEntries = [];
    disposeTwoWayEditors();
    disposeMultiEditors();
    updateHistoryToolbar(null);
    updateNavigationRail(null, null);
    updateFileNavigationState(null, false);
    updateDirectoryReturnToolbar(false);
    updateEditModeToolbar();
    updateDirectoryTreeToolbar();
    updateChangeToolbarState();

    toggleView(VIEW_IDS.threeWay);
    setTextContent('file-info', `Three-way merge for ${message.base.name}, ${message.left.name}, and ${message.right.name}`);
    setTextContent('base-header', message.base.name);
    setTextContent('left-header', message.left.name);
    setTextContent('right-header', message.right.name);
    setTextContent('result-header', message.result.name);
    setStatus(
        message.meta.isExperimental
            ? `Experimental merge view. ${message.meta.conflictCount} conflict(s) need review.`
            : '',
        message.meta.isExperimental
    );

    renderPlainLines(getElement('base-content'), message.base.lines);
    renderPlainLines(getElement('left-content'), message.left.lines);
    renderPlainLines(getElement('right-content'), message.right.lines);
    renderResultLines(getElement('result-content'), message.result.lines);

    resetScrollPositions();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
    notifyRenderComplete();
}

function ensureTwoWayEditors() {
    if (leftEditor && rightEditor) {
        return;
    }

    leftEditor = createEditor(getElement('file1-content'), MODE_TWO_WAY, 'left');
    rightEditor = createEditor(getElement('file2-content'), MODE_TWO_WAY, 'right');
    updateActivePaneHeader();
}

function createEditor(container, editorMode, side = null, initialModel = null) {
    container.innerHTML = '<div class="editor-root"></div>';
    container.classList.remove('binary-preview-host');
    container.classList.add('editor-host');

    const model = createOwnedModel(
        initialModel?.content ?? '',
        initialModel?.languageId ?? 'plaintext'
    );
    const editor = monacoInstance.editor.create(container.firstElementChild, {
        model,
        theme: 'bygone',
        automaticLayout: true,
        minimap: { enabled: false },
        glyphMargin: true,
        folding: true,
        foldingHighlight: true,
        showFoldingControls: 'mouseover',
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 8,
        scrollBeyondLastLine: false,
        wordWrap: wordWrapEnabled ? 'on' : 'off',
        autoIndent: 'full',
        autoClosingBrackets: 'languageDefined',
        autoClosingQuotes: 'languageDefined',
        autoSurround: 'languageDefined',
        matchBrackets: 'always',
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, bracketPairsHorizontal: 'active', indentation: true },
        multiCursorModifier: 'alt',
        multiCursorPaste: 'spread',
        dragAndDrop: true,
        contextmenu: true,
        copyWithSyntaxHighlighting: true,
        links: true,
        mouseWheelZoom: true,
        renderWhitespace: 'selection',
        renderFinalNewline: 'on',
        wordBasedSuggestions: 'currentDocument',
        quickSuggestions: false,
        overviewRulerLanes: 0,
        scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });
    editorModelIdentities.set(editor, initialModel?.identity ?? `blank:${modelIdentityCounter}`);

    editor.onDidChangeModelContent(() => {
        if (suppressEditorEvents) {
            return;
        }

        if (editorMode === MODE_TWO_WAY) {
            if (!isSideEditable(side)) {
                return;
            }

            scheduleRecompute();
            connectorController.scheduleDrawConnections();
            return;
        }

        if (editorMode === MODE_MULTI_WAY && side) {
            host.postMessage({
                type: 'multiUpdatePanelContent',
                panelId: side,
                content: editor.getValue().replace(/\r\n/g, '\n')
            });
            connectorController.scheduleDrawConnections();
            scheduleMultiRecompute(side);
        }
    });

    editor.onDidScrollChange(() => {
        if (suppressEditorEvents) {
            connectorController.scheduleDrawConnections();
            return;
        }

        if (editorMode === MODE_MULTI_WAY) {
            synchronizeMultiScroll(editor);
        } else {
            synchronizeEditorScroll(editor);
        }
        connectorController.scheduleDrawConnections();
    });

    editor.onDidContentSizeChange(() => {
        connectorController.scheduleDrawConnections();
    });

    editor.onDidChangeHiddenAreas(() => {
        connectorController.scheduleDrawConnections();
    });

    editor.onDidFocusEditorText(() => {
        if (!side) {
            return;
        }

        if (editorMode === MODE_TWO_WAY) {
            setActivePane(side, false);
        } else if (editorMode === MODE_MULTI_WAY) {
            setActiveMultiPanel(side, true);
        }
    });

    const tryNavigateTourAnchor = (event) => {
        if (!side || !currentTourAnnotations.length) {
            return false;
        }

        if (editorMode !== MODE_TWO_WAY && editorMode !== MODE_MULTI_WAY) {
            return false;
        }

        const lineNumber = event.target?.position?.lineNumber;
        if (!Number.isInteger(lineNumber)) {
            return false;
        }

        const targetType = event.target?.type;
        if (targetType !== 2 && targetType !== 3 && targetType !== 4) {
            return false;
        }

        let annotation;
        if (editorMode === MODE_TWO_WAY) {
            annotation = currentTourAnnotations.find((candidate) => (
                candidate.panelIndex === undefined
                && candidate.side === side
                && lineNumber >= candidate.startLine
                && lineNumber <= candidate.endLine
                && candidate.jumpTarget
            ));
        } else {
            const panelIndex = multiPanels.findIndex((panel) => panel.id === side);
            annotation = currentTourAnnotations.find((candidate) => (
                candidate.panelIndex === panelIndex
                && lineNumber >= candidate.startLine
                && lineNumber <= candidate.endLine
                && candidate.jumpTarget
            ));
        }
        if (!annotation) {
            return false;
        }

        event.event.preventDefault();
        event.event.stopPropagation();
        host.postMessage({
            type: 'navigateTourStep',
            sceneIndex: annotation.jumpTarget.sceneIndex,
            stepIndex: annotation.jumpTarget.stepIndex
        });
        return true;
    };

    const selectChangeAtLine = (lineNumber) => {
        if (!Number.isInteger(lineNumber) || !side) {
            return;
        }

        if (editorMode === MODE_TWO_WAY) {
            setActivePane(side, false);
            const changeIndex = findChangeIndexAtLine(buildBlockChanges(diffBlocks, side), lineNumber);
            if (changeIndex >= 0 && changeIndex !== activeDiffIndex) {
                setActiveDiffIndex(changeIndex, false);
            }
            return;
        }

        if (editorMode === MODE_MULTI_WAY) {
            setActiveMultiPanel(side, true);
            const panelChanges = getMultiPanelChanges(side);
            const changeIndex = findChangeIndexAtLine(panelChanges, lineNumber, activeMultiPairIndex);
            if (changeIndex >= 0) {
                setActiveMultiPanelChangeIndex(changeIndex, false, true);
            }
        }
    };

    editor.onMouseDown((event) => {
        if (tryNavigateTourAnchor(event)) {
            return;
        }

        selectChangeAtLine(event.target?.position?.lineNumber);
    });

    editor.onDidChangeCursorPosition((event) => {
        if (event.source === 'mouse') {
            selectChangeAtLine(event.position.lineNumber);
        }
    });

    registerEditorKeybindings(editor, editorMode);

    return editor;
}

function disposeTwoWayEditors() {
    if (leftEditor) {
        disposeEditorAndModel(leftEditor);
        leftEditor = undefined;
        leftDecorationIds = [];
    }

    if (rightEditor) {
        disposeEditorAndModel(rightEditor);
        rightEditor = undefined;
        rightDecorationIds = [];
    }

    getElement('file1-content').classList.remove('editor-host');
    getElement('file2-content').classList.remove('editor-host');
    updateActivePaneHeader();
}

function disposeMultiEditors(resetState = true) {
    multiEditors.forEach(disposeEditorAndModel);
    multiEditors = [];
    multiDecorationIds = [];
    multiDiffPairs = [];
    multiPanelChangeIndices = new Map();
    if (resetState) {
        multiPanels = [];
        activeMultiPanelId = null;
        activeMultiPairIndex = null;
        multiPanelMutationEnabled = true;
        focusedStripLayout = null;
        focusedStripWheelDelta = 0;
    }
    const container = getElement(VIEW_IDS.multiWay);
    if (container) {
        container.innerHTML = '';
        container.style.width = '';
        container.style.minWidth = '';
    }
}

function renderMultiDiffShell(panels) {
    const columns = [];
    const children = [];

    panels.forEach((panel, index) => {
        columns.push(`${MULTI_PANE_MIN_WIDTH}px`);
        children.push(
            `<div class="multi-pane" data-index="${index}" data-panel-id="${escapeAttr(panel.id)}">`
            + `<div class="multi-pane-header" data-panel-id="${escapeAttr(panel.id)}">`
            + `<div class="multi-pane-header-top">`
            + `<button class="multi-pane-title-wrap multi-pane-select" type="button" title="Select panel: ${escapeAttr(panel.label)}" data-multi-select-panel="${escapeAttr(panel.id)}" data-panel-id="${escapeAttr(panel.id)}" aria-pressed="false">`
            + `<span class="multi-pane-title">${escapeHtml(panel.label)}</span>`
            + `<span class="multi-pane-dirty${panel.dirty ? ' is-visible' : ''}" aria-hidden="true" title="Unsaved changes">•</span>`
            + `</button>`
            + `<span class="multi-pane-provenance ${panel.editable ? 'is-writable' : 'is-readonly'}">${panel.editable ? 'Writable file' : 'Read-only snapshot'}</span>`
            + `<span class="multi-pane-actions">`
            + `<button class="multi-pane-action" type="button" data-multi-add-side="left" data-panel-id="${escapeAttr(panel.id)}" title="Add panel to the left" aria-label="Add panel to the left"${panel.addLeftEnabled ? '' : ' disabled'}>+</button>`
            + `<button class="multi-pane-action multi-pane-action-danger" type="button" data-multi-remove-panel="${escapeAttr(panel.id)}" title="Remove panel" aria-label="Remove panel"${panel.removeEnabled ? '' : ' disabled'}>×</button>`
            + `<button class="multi-pane-action" type="button" data-multi-add-side="right" data-panel-id="${escapeAttr(panel.id)}" title="Add panel to the right" aria-label="Add panel to the right"${panel.addRightEnabled ? '' : ' disabled'}>+</button>`
            + `</span>`
            + `</div>`
            + `<div class="multi-pane-header-controls">`
            + `<button class="multi-pane-copy" type="button" data-multi-panel-copy="right-to-left" data-panel-id="${escapeAttr(panel.id)}" title="Copy current change into the left neighbor (Cmd/Ctrl+Alt+Left)" aria-label="Copy current change into the left neighbor">`
            + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H9"></path><path d="M13 8l-4 4 4 4"></path><path d="M5 5v14"></path></svg>`
            + `</button>`
            + `<span class="multi-pane-position" data-multi-panel-position="${escapeAttr(panel.id)}">0 / 0</span>`
            + `<button class="multi-pane-copy" type="button" data-multi-panel-copy="left-to-right" data-panel-id="${escapeAttr(panel.id)}" title="Copy current change into the right neighbor (Cmd/Ctrl+Alt+Right)" aria-label="Copy current change into the right neighbor">`
            + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h10"></path><path d="M11 8l4 4-4 4"></path><path d="M19 5v14"></path></svg>`
            + `</button>`
            + `</div>`
            + `</div>`
            + `<div id="multi-pane-${index}-content" class="multi-pane-content"></div>`
            + '</div>'
        );

        if (index < panels.length - 1) {
            columns.push(`${MULTI_GUTTER_WIDTH}px`);
            children.push(
                `<button class="multi-gutter" type="button" title="Activate comparison: ${escapeAttr(panel.label)} ↔ ${escapeAttr(panels[index + 1].label)}" data-pair-index="${index}" aria-label="Compare ${escapeAttr(panel.label)} with ${escapeAttr(panels[index + 1].label)}" aria-pressed="false"></button>`
            );
        }
    });

    const container = getElement(VIEW_IDS.multiWay);
    container.innerHTML = [
        '<div class="multi-strip-controls" role="group" aria-label="Multi-panel navigation">',
        '<button class="multi-strip-button" type="button" data-multi-strip-direction="previous" aria-label="Previous panel or comparison" title="Previous panel or comparison">‹</button>',
        '<span class="multi-strip-position" aria-live="polite" data-multi-strip-position></span>',
        '<button class="multi-strip-button" type="button" data-multi-strip-direction="next" aria-label="Next panel or comparison" title="Next panel or comparison">›</button>',
        '</div>',
        `<div class="multi-view-track" style="grid-template-columns:${columns.join(' ')};">${children.join('')}</div>`
    ].join('');
}

function recomputeMultiDiffState(changedPanelIds = null) {
    if (currentMode !== MODE_MULTI_WAY || multiEditors.length !== multiPanels.length) {
        return;
    }

    const nextPanels = multiPanels.map((panel, index) => ({
        ...panel,
        content: multiEditors[index]?.getValue().replace(/\r\n/g, '\n') ?? panel.content
    }));

    multiPanels = nextPanels;

    const changedIndices = changedPanelIds
        ? new Set(
            [...changedPanelIds]
                .map((id) => nextPanels.findIndex((p) => p.id === id))
                .filter((i) => i >= 0)
        )
        : null;

    const epoch = ++multiDiffEpoch;
    let pairsToBuild;

    if (changedIndices && changedIndices.size > 0) {
        multiDiffPairs = multiDiffPairs.map((pair) => {
            if (changedIndices.has(pair.leftIndex) || changedIndices.has(pair.rightIndex)) {
                return { ...pair, diffModel: null };
            }
            return pair;
        });
        pairsToBuild = multiDiffPairs
            .map((pair, index) => ({ pair, index }))
            .filter(({ pair }) => pair.diffModel === null);
    } else {
        multiDiffPairs = nextPanels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: null
        }));
        pairsToBuild = multiDiffPairs.map((pair, index) => ({ pair, index }));
    }

    activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, activeMultiPairIndex, activeMultiPanelId, multiPanels);
    updateMultiActivePairModel(false, activeMultiPairIndex);
    updateActiveMultiShellState();
    connectorController.scheduleDrawConnections();

    if (pairsToBuild.length === 0) {
        return;
    }

    beginDiffJob();
    Promise.all(pairsToBuild.map(({ pair, index }) =>
        requestDiffAsync(nextPanels[pair.leftIndex].content, nextPanels[pair.rightIndex].content)
            .then((model) => ({ index, model }))
            .catch(() => ({ index, model: null }))
    )).then((results) => {
        endDiffJob();
        if (epoch !== multiDiffEpoch || currentMode !== MODE_MULTI_WAY) {
            return;
        }
        for (const { index, model } of results) {
            if (multiDiffPairs[index] && model) {
                multiDiffPairs[index] = { ...multiDiffPairs[index], diffModel: model };
            }
        }
        updateMultiActivePairModel(false, activeMultiPairIndex);
        updateActiveMultiShellState();
        connectorController.scheduleDrawConnections();
    });
}

function resolveActiveMultiPanelId(panels, nextActivePanelId) {
    if (nextActivePanelId && panels.some((panel) => panel.id === nextActivePanelId)) {
        return nextActivePanelId;
    }

    return panels[0]?.id ?? null;
}

function resolveActiveMultiPairIndex(pairs, nextActivePairIndex, nextActivePanelId, panels) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
        return null;
    }

    if (Number.isInteger(nextActivePairIndex) && nextActivePairIndex >= 0 && nextActivePairIndex < pairs.length) {
        return nextActivePairIndex;
    }

    const panelIndex = panels.findIndex((panel) => panel.id === nextActivePanelId);
    if (panelIndex < 0) {
        return 0;
    }

    return Math.max(0, Math.min(panelIndex, pairs.length - 1));
}

function updateActiveMultiShellState() {
    const container = getElement(VIEW_IDS.multiWay);
    container.querySelectorAll('.multi-pane').forEach((pane) => {
        pane.classList.toggle('is-active-pane', pane.getAttribute('data-panel-id') === activeMultiPanelId);
    });
    container.querySelectorAll('[data-multi-select-panel]').forEach((button) => {
        button.setAttribute(
            'aria-pressed',
            button.getAttribute('data-multi-select-panel') === activeMultiPanelId ? 'true' : 'false'
        );
    });
    container.querySelectorAll('.multi-gutter').forEach((gutter) => {
        const pairIndex = Number.parseInt(gutter.getAttribute('data-pair-index') || '', 10);
        const isActivePair = Number.isInteger(pairIndex) && pairIndex === activeMultiPairIndex;
        gutter.classList.toggle('is-active-pair', isActivePair);
        gutter.setAttribute('aria-pressed', isActivePair ? 'true' : 'false');
    });
    container.querySelectorAll('[data-multi-remove-panel]').forEach((button) => {
        const panelId = button.getAttribute('data-multi-remove-panel') || '';
        const panel = multiPanels.find((p) => p.id === panelId);
        button.disabled = panel ? !panel.removeEnabled : multiPanels.length <= 1;
    });
    container.querySelectorAll('[data-multi-add-side]').forEach((button) => {
        const panelId = button.getAttribute('data-panel-id') || '';
        const side = button.getAttribute('data-multi-add-side') || '';
        const panel = multiPanels.find((p) => p.id === panelId);
        if (panel) {
            button.disabled = side === 'left' ? !panel.addLeftEnabled : !panel.addRightEnabled;
        }
    });
    container.querySelectorAll('[data-multi-panel-position]').forEach((element) => {
        const panelId = element.getAttribute('data-multi-panel-position') || '';
        const panelChanges = getMultiPanelChanges(panelId);
        const panelChangeIndex = getMultiPanelChangeIndex(panelId, panelChanges);
        element.textContent = panelChanges.length > 0 ? `${panelChangeIndex + 1} / ${panelChanges.length}` : '0 / 0';
    });
    container.querySelectorAll('[data-multi-panel-copy]').forEach((button) => {
        const panelId = button.getAttribute('data-panel-id') || '';
        const direction = button.getAttribute('data-multi-panel-copy') || '';
        button.disabled = !canCopyFromPanel(panelId, direction);
    });
}

function revealActiveMultiPanel() {
    applyFocusedStripLayout();
}

function applyFocusedStripLayout(animate = true) {
    if (currentMode !== MODE_MULTI_WAY || multiPanels.length === 0) return;
    const container = getElement(VIEW_IDS.multiWay);
    const track = container.querySelector('.multi-view-track');
    if (!track) return;
    const activePanelIndex = Math.max(0, multiPanels.findIndex((panel) => panel.id === activeMultiPanelId));
    focusedStripLayout = computeFocusedStripLayout({
        panelCount: multiPanels.length,
        activePanelIndex,
        activePairIndex: activeMultiPairIndex,
        viewportWidth: Math.max(1, container.clientWidth - 24),
        minimumPaneWidth: MULTI_PANE_MIN_WIDTH,
        gutterWidth: MULTI_GUTTER_WIDTH
    });
    const columns = [];
    multiPanels.forEach((_panel, index) => {
        columns.push(`${focusedStripLayout.paneWidth}px`);
        if (index < multiPanels.length - 1) columns.push(`${focusedStripLayout.gutterWidth}px`);
    });
    track.classList.toggle('is-positioning', !animate);
    track.style.gridTemplateColumns = columns.join(' ');
    track.style.width = `${focusedStripLayout.trackWidth}px`;
    track.style.transform = `translate3d(${-focusedStripLayout.offset}px, 0, 0)`;
    container.classList.toggle('multi-strip-panel-mode', focusedStripLayout.mode === 'panel');
    container.classList.toggle('multi-strip-pair-mode', focusedStripLayout.mode === 'pair');
    updateFocusedStripControls();
    updateVisiblePaneSearch();
    if (!animate) requestAnimationFrame(() => track.classList.remove('is-positioning'));
}

function updateFocusedStripControls() {
    const container = getElement(VIEW_IDS.multiWay);
    const position = container.querySelector('[data-multi-strip-position]');
    const previous = container.querySelector('[data-multi-strip-direction="previous"]');
    const next = container.querySelector('[data-multi-strip-direction="next"]');
    if (!focusedStripLayout || !position || !previous || !next) return;
    const pairMode = focusedStripLayout.mode === 'pair';
    const current = pairMode ? focusedStripLayout.pairIndex : focusedStripLayout.panelIndex;
    const total = pairMode ? Math.max(1, multiPanels.length - 1) : multiPanels.length;
    position.textContent = pairMode
        ? `Comparison ${current + 1}–${current + 2} of ${multiPanels.length}`
        : `Panel ${current + 1} of ${multiPanels.length}`;
    previous.disabled = current <= 0;
    next.disabled = current >= total - 1;
}

function moveFocusedStrip(direction) {
    if (!focusedStripLayout || (direction !== -1 && direction !== 1)) return false;
    if (focusedStripLayout.mode === 'pair') {
        const nextPair = focusedStripLayout.pairIndex + direction;
        if (nextPair < 0 || nextPair >= multiDiffPairs.length) return false;
        setActiveMultiPair(nextPair, true);
        return true;
    }
    const nextPanel = focusedStripLayout.panelIndex + direction;
    const panel = multiPanels[nextPanel];
    if (!panel) return false;
    setActiveMultiPanel(panel.id, true);
    return true;
}

function revealFirstMultiPanelChanges() {
    multiEditors.forEach((editor, panelIndex) => {
        const pair = multiDiffPairs[panelIndex === 0 ? 0 : panelIndex - 1];
        const block = pair?.diffModel?.blocks?.[0];
        if (!block) return;
        const start = panelIndex === 0 ? block.leftStart : block.rightStart;
        const lineCount = editor.getModel()?.getLineCount() ?? 0;
        if (lineCount === 0) return;
        const lineNumber = clamp(start + 1, 1, lineCount);
        editor.setSelection({
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1
        });
        editor.revealLineInCenterIfOutsideViewport(
            lineNumber,
            monacoInstance.editor.ScrollType.Immediate
        );
    });
}

function updateEditorValues(leftContent, rightContent, comparisonKey, sourceInfo) {
    suppressEditorEvents = true;
    try {
        setOwnedEditorModel(leftEditor, `${comparisonKey}:left`, leftContent, normalizeLanguageId(sourceInfo?.leftLanguageId, sourceInfo?.leftPath));
        setOwnedEditorModel(rightEditor, `${comparisonKey}:right`, rightContent, normalizeLanguageId(sourceInfo?.rightLanguageId, sourceInfo?.rightPath));
    } finally {
        suppressEditorEvents = false;
    }
}

function createOwnedModel(content, languageId) {
    modelIdentityCounter += 1;
    return monacoInstance.editor.createModel(
        content,
        languageId,
        monacoInstance.Uri.parse(`bygone://model/${modelIdentityCounter}`)
    );
}

function clearEditorDecorations(editor) {
    if (editor === leftEditor && leftDecorationIds.length > 0) {
        leftDecorationIds = leftEditor.deltaDecorations(leftDecorationIds, []);
        return;
    }

    if (editor === rightEditor && rightDecorationIds.length > 0) {
        rightDecorationIds = rightEditor.deltaDecorations(rightDecorationIds, []);
    }
}

function setOwnedEditorModel(editor, identity, content, languageId) {
    const currentModel = editor.getModel();
    if (editorModelIdentities.get(editor) !== identity) {
        const nextModel = createOwnedModel(content, languageId);
        editor.setModel(nextModel);
        currentModel?.dispose();
        editorModelIdentities.set(editor, identity);
        if (editor === leftEditor) {
            leftDecorationIds = [];
        } else if (editor === rightEditor) {
            rightDecorationIds = [];
        }
        return;
    }
    if (currentModel && currentModel.getLanguageId() !== languageId) {
        monacoInstance.editor.setModelLanguage(currentModel, languageId);
    }
    if (currentModel && currentModel.getValue() !== content) {
        clearEditorDecorations(editor);
        currentModel.setValue(content);
        if (editor === leftEditor) {
            leftDecorationIds = [];
        } else if (editor === rightEditor) {
            rightDecorationIds = [];
        }
    }
}

function disposeEditorAndModel(editor) {
    const model = editor.getModel();
    editor.dispose();
    model?.dispose();
}

function updateTwoWayEditorOptions() {
    leftEditor.updateOptions({ readOnly: !isSideEditable('left') });
    rightEditor.updateOptions({ readOnly: !isSideEditable('right') });
}

function normalizeEditableSides(nextEditableSides, isHistoryMode) {
    if (nextEditableSides && typeof nextEditableSides === 'object') {
        return {
            left: Boolean(nextEditableSides.left),
            right: Boolean(nextEditableSides.right)
        };
    }

    return {
        left: !isHistoryMode,
        right: !isHistoryMode
    };
}

function isSideEditable(side) {
    if (side === 'left') {
        return hostEditableSides.left && !userReadOnly;
    }

    if (side === 'right') {
        return hostEditableSides.right && !userReadOnly;
    }

    return false;
}

function hasHostEditableSide() {
    return hostEditableSides.left || hostEditableSides.right;
}

function setCurrentDiffModel(diffModel) {
    currentDiffModel = diffModel;
    diffBlocks = diffModel?.blocks || [];
    currentDiffRows = diffModel?.rows || [];
    scrollMaps = currentDiffRows.length === 0
        ? null
        : {
            left: buildScrollMaps(currentDiffRows, 'left'),
            right: buildScrollMaps(currentDiffRows, 'right')
        };
}

function applyDiffDecorations(diffModel, tourAnnotations = []) {
    const leftDecorations = [];
    const rightDecorations = [];

    for (const block of diffModel.blocks || []) {
        if (block.kind === 'replace') {
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
        } else if (block.kind === 'delete') {
            addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
            addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
            addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, rightEditor.getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
        } else if (block.kind === 'insert') {
            addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
            addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
            addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, leftEditor.getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
        }
    }

    addInlineDecorations(leftDecorations, diffModel.leftLines || [], 'removed', 'bygone-inline-blue');
    addInlineDecorations(rightDecorations, diffModel.rightLines || [], 'added', 'bygone-inline-blue');

    for (const tourAnnotation of tourAnnotations) {
        if (tourAnnotation.panelIndex !== undefined) {
            continue;
        }

        const target = tourAnnotation.side === 'left' ? leftDecorations : rightDecorations;
        const editor = tourAnnotation.side === 'left' ? leftEditor : rightEditor;
        pushTourAnnotationDecoration(target, editor, tourAnnotation);
    }

    leftDecorationIds = leftEditor.deltaDecorations(leftDecorationIds, dedupeDecorations(leftDecorations));
    rightDecorationIds = rightEditor.deltaDecorations(rightDecorationIds, dedupeDecorations(rightDecorations));
}

function applyMultiDiffDecorations(pairs) {
    const decorations = multiEditors.map(() => []);

    (pairs || []).forEach((pair) => {
        const leftDecorations = decorations[pair.leftIndex];
        const rightDecorations = decorations[pair.rightIndex];
        const diffModel = pair.diffModel;

        if (!leftDecorations || !rightDecorations || !diffModel) {
            return;
        }

        for (const block of diffModel.blocks || []) {
            if (block.kind === 'replace') {
                addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
                addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
                addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-paired-line');
                addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-paired-line');
            } else if (block.kind === 'delete') {
                addLineDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
                addBlockEdgeDecorations(leftDecorations, block.leftStart, block.leftEnd, 'bygone-one-sided-line');
                addCollapsedBoundaryDecoration(rightDecorations, block.rightStart, multiEditors[pair.rightIndex].getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
            } else if (block.kind === 'insert') {
                addLineDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
                addBlockEdgeDecorations(rightDecorations, block.rightStart, block.rightEnd, 'bygone-one-sided-line');
                addCollapsedBoundaryDecoration(leftDecorations, block.leftStart, multiEditors[pair.leftIndex].getModel()?.getLineCount() ?? 0, 'bygone-one-sided-boundary');
            }
        }

        addInlineDecorations(leftDecorations, diffModel.leftLines || [], 'removed', 'bygone-inline-blue');
        addInlineDecorations(rightDecorations, diffModel.rightLines || [], 'added', 'bygone-inline-blue');

    });

    for (const tourAnnotation of currentTourAnnotations) {
        if (!Number.isInteger(tourAnnotation.panelIndex)) {
            continue;
        }

        const panelDecorations = decorations[tourAnnotation.panelIndex];
        const editor = multiEditors[tourAnnotation.panelIndex];
        if (!panelDecorations || !editor) {
            continue;
        }

        pushTourAnnotationDecoration(panelDecorations, editor, tourAnnotation);
    }

    multiDecorationIds = multiEditors.map((editor, index) => (
        editor.deltaDecorations(multiDecorationIds[index] || [], dedupeDecorations(decorations[index]))
    ));
}

function pushTourAnnotationDecoration(target, editor, tourAnnotation) {
    const endLine = tourAnnotation.endLine ?? tourAnnotation.startLine;
    const endColumn = editor.getModel()?.getLineMaxColumn(endLine) ?? 1;
    target.push({
        range: new monacoInstance.Range(
            tourAnnotation.startLine,
            1,
            endLine,
            endColumn
        ),
        options: {
            isWholeLine: true,
            className: tourAnnotation.active ? 'bygone-tour-anchor' : 'bygone-tour-anchor-inactive',
            glyphMarginClassName: 'bygone-tour-anchor-gutter',
            hoverMessage: {
                value: tourAnnotation.jumpTarget
                    ? `${tourAnnotation.label}\n\nClick the marker to jump to this tour step.`
                    : tourAnnotation.label
            }
        }
    });
}

function addLineDecorations(target, start, end, className) {
    if (start >= end) {
        return;
    }
    target.push({
        range: new monacoInstance.Range(start + 1, 1, end, Number.MAX_SAFE_INTEGER),
        options: {
            isWholeLine: true,
            wholeLineClassName: `${className}-whole`,
            className,
            linesDecorationsClassName: `${className}-gutter`,
            marginClassName: `${className}-gutter`
        }
    });
}

function addBlockEdgeDecorations(target, start, end, className) {
    if (start >= end) {
        return;
    }

    const firstLine = start + 1;
    const lastLine = end;

    target.push({
        range: new monacoInstance.Range(firstLine, 1, firstLine, 1),
        options: {
            isWholeLine: true,
            className: `${className}-start`
        }
    });

    target.push({
        range: new monacoInstance.Range(lastLine, 1, lastLine, 1),
        options: {
            isWholeLine: true,
            className: `${className}-end`
        }
    });
}

function addCollapsedBoundaryDecoration(target, anchorIndex, targetLineCount, className) {
    if (targetLineCount <= 0) {
        return;
    }

    if (anchorIndex <= 0) {
        target.push({
            range: new monacoInstance.Range(1, 1, 1, 1),
            options: {
                isWholeLine: true,
                className: `${className}-top`
            }
        });
        return;
    }

    if (anchorIndex >= targetLineCount) {
        target.push({
            range: new monacoInstance.Range(targetLineCount, 1, targetLineCount, 1),
            options: {
                isWholeLine: true,
                className: `${className}-bottom`
            }
        });
        return;
    }

    target.push({
        range: new monacoInstance.Range(anchorIndex + 1, 1, anchorIndex + 1, 1),
        options: {
            isWholeLine: true,
            className: `${className}-top`
        }
    });
}

function addInlineDecorations(target, lines, expectedKind, className) {
    for (const line of lines) {
        if (!line.segments) {
            continue;
        }

        let column = 1;
        for (const segment of line.segments) {
            const segmentLength = segment.text.length;
            const startColumn = column;
            const endColumn = column + Math.max(segmentLength, 1);

            if (segment.emphasis && segment.kind === expectedKind && segmentLength > 0) {
                target.push({
                    range: new monacoInstance.Range(line.lineNumber, startColumn, line.lineNumber, endColumn),
                    options: {
                        inlineClassName: className
                    }
                });
            }

            column += segmentLength;
        }
    }
}

function synchronizeEditorScroll(sourceEditor) {
    if (!leftEditor || !rightEditor) {
        return;
    }

    const targetEditor = sourceEditor === leftEditor ? rightEditor : leftEditor;
    const horizontalRatio = getScrollRatio(sourceEditor.getScrollLeft(), sourceEditor.getScrollWidth() - sourceEditor.getLayoutInfo().contentWidth);
    const targetScrollTop = mapScrollTopBetweenEditors(sourceEditor, targetEditor);

    suppressEditorEvents = true;
    targetEditor.setScrollTop(targetScrollTop);
    targetEditor.setScrollLeft(horizontalRatio * Math.max(0, targetEditor.getScrollWidth() - targetEditor.getLayoutInfo().contentWidth));
    suppressEditorEvents = false;
}

function synchronizeMultiScroll(sourceEditor) {
    if (multiEditors.length < 2) {
        return;
    }

    const horizontalRatio = getScrollRatio(sourceEditor.getScrollLeft(), sourceEditor.getScrollWidth() - sourceEditor.getLayoutInfo().contentWidth);
    const verticalRatio = getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height);

    suppressEditorEvents = true;
    for (const editor of multiEditors) {
        if (editor === sourceEditor) {
            continue;
        }

        editor.setScrollTop(verticalRatio * Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height));
        editor.setScrollLeft(horizontalRatio * Math.max(0, editor.getScrollWidth() - editor.getLayoutInfo().contentWidth));
    }
    suppressEditorEvents = false;
}

function initializeHistoryToolbar() {
    getElement('history-back').addEventListener('click', () => {
        host.postMessage({ type: 'historyBack' });
    });
    getElement('history-forward').addEventListener('click', () => {
        host.postMessage({ type: 'historyForward' });
    });
    getElement('history-toggle-staged').addEventListener('click', (event) => {
        const button = event.currentTarget;
        const nextIncludeStaged = button.getAttribute('aria-pressed') !== 'true';
        host.postMessage({
            type: 'historyToggleStaged',
            includeStaged: nextIncludeStaged
        });
    });
    getElement('history-toggle-skip-unchanged').addEventListener('click', (event) => {
        const button = event.currentTarget;
        const nextSkipUnchanged = button.getAttribute('aria-pressed') !== 'true';
        host.postMessage({
            type: 'historyToggleSkipUnchanged',
            skipUnchanged: nextSkipUnchanged
        });
    });
}

function initializeDirectoryTreeToolbar() {
    getElement('directory-expand-all').addEventListener('click', () => {
        expandAllDirectories(getElement('dir-rows'));
    });
    getElement('directory-collapse-all').addEventListener('click', () => {
        collapseAllDirectories(getElement('dir-rows'), directoryEntries);
    });
    getElement('directory-collapse-unchanged').addEventListener('click', () => {
        collapseUnchangedDirectories(getElement('dir-rows'), directoryEntries);
    });
}

function initializeHistoryRail() {
    const rail = getElement('history-rail');
    const showButton = getElement('show-navigation-sidebar');

    applyNavigationSidebarWidth();
    showButton.addEventListener('click', () => {
        navigationRailCollapsed = false;
        directoryRailVisible = true;
        renderHistoryRail();
        updateDirectorySidebarToggle();
        resizeDiffWorkspace();
    });

    rail.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-rail-tab], [data-rail-item], [data-rail-collapse]') : null;
        if (!target) {
            return;
        }

        if (target.hasAttribute('data-rail-collapse')) {
            navigationRailCollapsed = true;
            renderHistoryRail();
            resizeDiffWorkspace();
            return;
        }

        if (target.hasAttribute('data-rail-item')) {
            const tabId = target.getAttribute('data-rail-tab');
            const itemIndex = Number.parseInt(target.getAttribute('data-rail-index') || '', 10);
            const item = getHistoryRailItems(tabId).find((candidate) => candidate.index === itemIndex || candidate.relativePath === target.getAttribute('data-rail-path'));
            if (!item) {
                return;
            }

            if (item.kind === 'history-entry' && Number.isInteger(item.index)) {
                host.postMessage({ type: 'selectHistoryEntry', index: item.index });
                return;
            }

            if (item.kind === 'directory-entry' && typeof item.relativePath === 'string') {
                host.postMessage({ type: 'openDirectoryEntry', relativePath: item.relativePath });
            }
            return;
        }

        if (target.hasAttribute('data-rail-tab')) {
            const tabId = target.getAttribute('data-rail-tab');
            if (tabId && historyRailState?.tabs?.some((tab) => tab.id === tabId)) {
                activeHistoryRailTabId = tabId;
                renderHistoryRail();
            }
        }
    });

    rail.addEventListener('pointerdown', (event) => {
        const resizer = event.target instanceof Element ? event.target.closest('[data-rail-resizer]') : null;
        if (!resizer) {
            return;
        }
        event.preventDefault();
        document.body.classList.add('is-resizing-sidebar');
        resizer.setPointerCapture?.(event.pointerId);

        const move = (moveEvent) => setNavigationSidebarWidth(moveEvent.clientX);
        const finish = () => {
            document.body.classList.remove('is-resizing-sidebar');
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', finish);
            window.removeEventListener('pointercancel', finish);
            storeSidebarWidth(NAVIGATION_SIDEBAR_STORAGE_KEY, navigationRailWidth);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
    });

    rail.addEventListener('keydown', (event) => {
        const resizer = event.target instanceof Element ? event.target.closest('[data-rail-resizer]') : null;
        if (!resizer || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const nextWidth = event.key === 'Home'
            ? NAVIGATION_SIDEBAR_MIN_WIDTH
            : event.key === 'End'
                ? maximumNavigationSidebarWidth()
                : navigationRailWidth + (event.key === 'ArrowLeft' ? -16 : 16);
        setNavigationSidebarWidth(nextWidth);
        storeSidebarWidth(NAVIGATION_SIDEBAR_STORAGE_KEY, navigationRailWidth);
    });
}

function initializeDirectoryReturnToolbar() {
    getElement('back-to-directory').addEventListener('click', () => returnToDirectory());
    getElement('toggle-directory-sidebar').addEventListener('click', () => {
        if (!hasDirectoryNavigation) {
            return;
        }
        if (navigationRailCollapsed) {
            navigationRailCollapsed = false;
            directoryRailVisible = true;
        } else {
            directoryRailVisible = !directoryRailVisible;
        }
        renderHistoryRail();
        updateDirectorySidebarToggle();
        resizeDiffWorkspace();
    });
}

function initializeMultiDiffInteractions() {
    const container = getElement(VIEW_IDS.multiWay);

    container.addEventListener('wheel', (event) => {
        if (currentMode !== MODE_MULTI_WAY) {
            return;
        }

        const overEditor = event.target instanceof Element
            && Boolean(event.target.closest('.multi-pane-content'));
        if (overEditor && !event.shiftKey) {
            return;
        }

        const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
        if (delta === 0) return;
        focusedStripWheelDelta += delta;
        if (Math.abs(focusedStripWheelDelta) >= 80) {
            moveFocusedStrip(focusedStripWheelDelta > 0 ? 1 : -1);
            focusedStripWheelDelta = 0;
        }
        event.preventDefault();
    }, { passive: false, capture: true });

    container.addEventListener('click', (event) => {
        const stripDirection = event.target instanceof Element
            ? event.target.closest('[data-multi-strip-direction]')?.getAttribute('data-multi-strip-direction')
            : null;
        if (stripDirection) {
            moveFocusedStrip(stripDirection === 'previous' ? -1 : 1);
            return;
        }
        const target = event.target instanceof Element ? event.target.closest('[data-panel-id], [data-pair-index], [data-multi-add-side], [data-multi-remove-panel], [data-multi-panel-copy]') : null;
        if (!target) {
            return;
        }

        const panelCopyDirection = target.getAttribute('data-multi-panel-copy');
        const panelCopyId = target.getAttribute('data-panel-id');
        if (panelCopyDirection && panelCopyId) {
            event.stopPropagation();
            copyMultiPanelChange(panelCopyId, panelCopyDirection);
            return;
        }

        const addSide = target.getAttribute('data-multi-add-side');
        const addPanelId = target.getAttribute('data-panel-id');
        if (addSide && addPanelId) {
            event.stopPropagation();
            if (multiPanelMutationEnabled) {
                host.postMessage({
                    type: 'multiAddPanel',
                    anchorPanelId: addPanelId,
                    side: addSide
                });
            }
            return;
        }

        const removePanelId = target.getAttribute('data-multi-remove-panel');
        if (removePanelId) {
            event.stopPropagation();
            if (multiPanelMutationEnabled) {
                host.postMessage({
                    type: 'multiRemovePanel',
                    panelId: removePanelId
                });
            }
            return;
        }

        const pairIndex = Number.parseInt(target.getAttribute('data-pair-index') || '', 10);
        if (Number.isInteger(pairIndex)) {
            setActiveMultiPair(pairIndex, true);
            return;
        }

        const panelId = target.getAttribute('data-panel-id');
        const selectsPanel = target.hasAttribute('data-multi-select-panel')
            || Boolean(event.target instanceof Element && event.target.closest('.multi-pane-content'));
        if (panelId && selectsPanel) {
            setActiveMultiPanel(panelId, true);
        }
    });

    window.addEventListener('keydown', (event) => {
        if (currentMode !== MODE_MULTI_WAY || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
        if (event.target instanceof Element && event.target.closest('.monaco-editor')) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        if (moveFocusedStrip(event.key === 'ArrowLeft' ? -1 : 1)) event.preventDefault();
    });
}

function initializeEditModeToolbar() {
    getElement('file1-header')?.addEventListener('click', () => setActivePane('left', true));
    getElement('file2-header')?.addEventListener('click', () => setActivePane('right', true));
    getElement('toggle-readonly').addEventListener('click', () => {
        if (!hasHostEditableSide()) {
            return;
        }

        userReadOnly = !userReadOnly;
        updateTwoWayEditorOptions();
        updateEditModeToolbar();
        updateChangeToolbarState();
    });
}

function setActivePane(side, focusEditor) {
    if (side !== 'left' && side !== 'right') {
        return;
    }

    activePaneSide = side;
    updateActivePaneHeader();

    if (!focusEditor || currentMode !== MODE_TWO_WAY) {
        return;
    }

    const editor = side === 'left' ? leftEditor : rightEditor;
    editor?.focus();
}

function updateActivePaneHeader() {
    const leftHeader = getElement('file1-header');
    const rightHeader = getElement('file2-header');
    if (!leftHeader || !rightHeader) {
        return;
    }

    const isTwoWay = currentMode === MODE_TWO_WAY;
    leftHeader.classList.toggle('is-active-pane', isTwoWay && activePaneSide === 'left');
    rightHeader.classList.toggle('is-active-pane', isTwoWay && activePaneSide === 'right');
    leftHeader.setAttribute('aria-pressed', isTwoWay && activePaneSide === 'left' ? 'true' : 'false');
    rightHeader.setAttribute('aria-pressed', isTwoWay && activePaneSide === 'right' ? 'true' : 'false');
}

function setActiveMultiPanel(panelId, notifyHost) {
    if (currentMode !== MODE_MULTI_WAY) {
        return;
    }

    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
        return;
    }

    activeMultiPanelId = panelId;
    if (multiDiffPairs.length > 0) {
        const currentPair = getActiveMultiPair();
        const pairStillFits = currentPair
            && (currentPair.leftIndex === panelIndex || currentPair.rightIndex === panelIndex);
        if (!pairStillFits) {
            const preferredPairIndex = panelIndex === 0 ? 0 : Math.min(panelIndex - 1, multiDiffPairs.length - 1);
            activeMultiPairIndex = resolveActiveMultiPairIndex(multiDiffPairs, preferredPairIndex, activeMultiPanelId, multiPanels);
        }
    } else {
        activeMultiPairIndex = null;
    }
    updateMultiActivePairModel(false);
    updateActiveMultiShellState();
    applyFocusedStripLayout();

    if (notifyHost) {
        host.postMessage({
            type: 'multiSetActivePanel',
            panelId
        });
    }
}

function setActiveMultiPair(pairIndex, notifyHost) {
    if (currentMode !== MODE_MULTI_WAY || pairIndex < 0 || pairIndex >= multiDiffPairs.length) {
        return;
    }

    const pair = multiDiffPairs[pairIndex];
    if (!pair) {
        return;
    }

    const activePanelIndex = multiPanels.findIndex((panel) => panel.id === activeMultiPanelId);
    if (activePanelIndex < 0 || (pair.leftIndex !== activePanelIndex && pair.rightIndex !== activePanelIndex)) {
        activeMultiPanelId = multiPanels[pair.rightIndex]?.id ?? activeMultiPanelId;
    }
    activeMultiPairIndex = pairIndex;
    updateMultiActivePairModel(false, pairIndex);
    updateActiveMultiShellState();
    applyFocusedStripLayout();

    if (notifyHost) {
        host.postMessage({
            type: 'multiSetActivePair',
            pairIndex
        });
    }
}

function getActiveMultiPanelIndex() {
    return multiPanels.findIndex((panel) => panel.id === activeMultiPanelId);
}

function getAdjacentMultiPairs(panelIndex = getActiveMultiPanelIndex()) {
    if (panelIndex < 0) {
        return [];
    }

    return multiDiffPairs.flatMap((pair, pairIndex) => {
        if (pair.leftIndex === panelIndex) {
            return [{ pair, pairIndex, side: 'left' }];
        }

        if (pair.rightIndex === panelIndex) {
            return [{ pair, pairIndex, side: 'right' }];
        }

        return [];
    });
}

function getMultiPanelChanges(panelId = activeMultiPanelId) {
    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    const adjacentPairs = getAdjacentMultiPairs(panelIndex);
    const mergedChanges = new Map();

    adjacentPairs.forEach(({ pair, pairIndex, side }) => {
        (pair.diffModel?.blocks || []).forEach((block, blockIndex) => {
            const start = side === 'left' ? block.leftStart : block.rightStart;
            const end = side === 'left' ? block.leftEnd : block.rightEnd;
            const normalizedStart = Math.max(0, start);
            const normalizedEnd = Math.max(normalizedStart, end);
            const key = `${normalizedStart}:${normalizedEnd}`;
            const existing = mergedChanges.get(key);
            const nextChange = {
                key,
                start: normalizedStart,
                end: normalizedEnd,
                pairIndex,
                blockIndex
            };

            if (!existing) {
                mergedChanges.set(key, nextChange);
                return;
            }

            if (pairIndex === activeMultiPairIndex && existing.pairIndex !== activeMultiPairIndex) {
                mergedChanges.set(key, nextChange);
            }
        });
    });

    return Array.from(mergedChanges.values()).sort((left, right) => {
        if (left.start !== right.start) {
            return left.start - right.start;
        }

        if (left.end !== right.end) {
            return left.end - right.end;
        }

        return left.pairIndex - right.pairIndex;
    });
}

function getMultiPanelChangeIndex(panelId = activeMultiPanelId, panelChanges = getMultiPanelChanges(panelId)) {
    if (panelChanges.length === 0) {
        return -1;
    }

    const currentIndex = multiPanelChangeIndices.get(panelId);
    if (!Number.isInteger(currentIndex)) {
        return 0;
    }

    return clamp(currentIndex, 0, panelChanges.length - 1);
}

function setMultiPanelChangeIndex(panelId, index) {
    if (!panelId) {
        return;
    }

    multiPanelChangeIndices.set(panelId, index);
}

function getActiveMultiPanelChange() {
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);
    const panelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
    if (panelChangeIndex < 0) {
        return null;
    }

    return panelChanges[panelChangeIndex];
}

function updateMultiActivePairModel(shouldReveal, preferredPairIndex = null) {
    const previousChange = getActiveMultiPanelChange();
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);

    if (panelChanges.length === 0) {
        const activePair = getActiveMultiPair();
        if (!activePair) {
            setMultiPanelChangeIndex(activeMultiPanelId, -1);
            activeMultiPairIndex = null;
            setCurrentDiffModel({ blocks: [], rows: [] });
            setActiveDiffIndex(-1, false);
            updateActiveMultiShellState();
            return;
        }

        setMultiPanelChangeIndex(activeMultiPanelId, -1);
        setCurrentDiffModel(activePair.diffModel);
        setActiveDiffIndex(-1, false);
        applyMultiDiffDecorations(multiDiffPairs);
        updateActiveMultiShellState();
        connectorController.scheduleDrawConnections();
        return;
    }

    if (Number.isInteger(preferredPairIndex)
        && !panelChanges.some((change) => change.pairIndex === preferredPairIndex)) {
        const preferredPair = multiDiffPairs[preferredPairIndex];
        if (preferredPair) {
            activeMultiPairIndex = preferredPairIndex;
            setMultiPanelChangeIndex(activeMultiPanelId, -1);
            setCurrentDiffModel(preferredPair.diffModel);
            setActiveDiffIndex(-1, false);
            applyMultiDiffDecorations(multiDiffPairs);
            updateActiveMultiShellState();
            connectorController.scheduleDrawConnections();
            return;
        }
    }

    let nextChangeIndex = -1;
    if (Number.isInteger(preferredPairIndex)) {
        nextChangeIndex = panelChanges.findIndex((change) => change.pairIndex === preferredPairIndex);
    }

    if (nextChangeIndex < 0 && previousChange) {
        nextChangeIndex = panelChanges.findIndex((change) => change.key === previousChange.key);
    }

    const currentPanelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
    if (nextChangeIndex < 0 && Number.isInteger(currentPanelChangeIndex) && currentPanelChangeIndex >= 0) {
        nextChangeIndex = clamp(currentPanelChangeIndex, 0, panelChanges.length - 1);
    }

    if (nextChangeIndex < 0) {
        nextChangeIndex = 0;
    }

    const activeChange = panelChanges[nextChangeIndex];
    const activePair = activeChange ? multiDiffPairs[activeChange.pairIndex] : null;
    if (!activePair) {
        setMultiPanelChangeIndex(activeMultiPanelId, -1);
        setCurrentDiffModel({ blocks: [], rows: [] });
        setActiveDiffIndex(-1, false);
        updateActiveMultiShellState();
        return;
    }

    setMultiPanelChangeIndex(activeMultiPanelId, nextChangeIndex);
    activeMultiPairIndex = activeChange.pairIndex;
    setCurrentDiffModel(activePair.diffModel);
    setActiveDiffIndex(activeChange.blockIndex, false);

    applyMultiDiffDecorations(multiDiffPairs);
    updateActiveMultiShellState();

    if (shouldReveal) {
        revealActiveDiff(true);
    } else {
        connectorController.scheduleDrawConnections();
    }
}

function getActiveMultiPair() {
    if (!Number.isInteger(activeMultiPairIndex) || activeMultiPairIndex < 0 || activeMultiPairIndex >= multiDiffPairs.length) {
        return null;
    }

    return multiDiffPairs[activeMultiPairIndex];
}

let visibleSearchMatches = [];

function initializeRepositorySearch() {
    const palette = document.createElement('section');
    palette.id = 'repository-search';
    palette.className = 'repository-search hidden';
    palette.setAttribute('aria-label', 'Search in files');
    palette.innerHTML = [
        '<form class="repository-search-form">',
        '<div class="repository-search-header">',
        '<input class="repository-search-input" type="search" aria-label="Search query" placeholder="Search in files">',
        '<button class="repository-search-run" type="submit" title="Run search (Enter)">Search</button>',
        '<button class="repository-search-cancel" type="button" title="Cancel running search" hidden>Cancel</button>',
        '<button class="repository-search-close" type="button" aria-label="Close Search in Files" title="Close Search in Files (Esc)">×</button>',
        '</div>',
        '<div class="repository-search-root"></div>',
        '<div class="repository-search-options">',
        '<label><input type="checkbox" name="caseSensitive"> Match case</label>',
        '<label><input type="checkbox" name="wholeWord"> Whole word</label>',
        '<label><input type="checkbox" name="regex"> Regular expression</label>',
        '<label><input type="checkbox" name="hidden"> Hidden files</label>',
        '<label><input type="checkbox" name="respectIgnores" checked> Respect ignore files</label>',
        '</div>',
        '<div class="repository-search-filters">',
        '<input name="include" aria-label="Files to include" placeholder="Include: *.ts, src/**">',
        '<input name="exclude" aria-label="Files to exclude" placeholder="Exclude: dist/**">',
        '<select name="limit" aria-label="Maximum results" title="Maximum results">',
        '<option value="100">100 results</option>',
        '<option value="500">500 results</option>',
        '<option value="1000" selected>1,000 results</option>',
        '<option value="5000">5,000 results</option>',
        '</select>',
        '</div>',
        '<div class="repository-replace-controls">',
        '<input name="replacement" aria-label="Replacement text" placeholder="Replace with" disabled>',
        '<button class="repository-replace-preview" type="button" title="Preview replacement in eligible results" disabled>Preview Replace</button>',
        '<button class="repository-replace-apply" type="button" title="Apply the selected replacements" hidden>Apply Selected</button>',
        '<button class="repository-replace-undo" type="button" title="Undo the most recent replacement" hidden>Undo Replace</button>',
        '</div>',
        '</form>',
        '<div class="repository-search-summary" aria-live="polite">Choose a query, then run the search.</div>',
        '<div class="repository-replace-preview" hidden></div>',
        '<div class="repository-search-results" role="listbox"></div>'
    ].join('');
    document.body.appendChild(palette);
    palette.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        runRepositorySearch();
    });
    palette.querySelector('.repository-search-close').addEventListener('click', closeRepositorySearch);
    palette.querySelector('form').addEventListener('input', (event) => {
        if (event.target?.name !== 'replacement') resetRepositoryReplacementPreview();
    });
    palette.querySelector('.repository-replace-preview').addEventListener('click', previewRepositoryReplacement);
    palette.querySelector('.repository-replace-apply').addEventListener('click', applyRepositoryReplacement);
    palette.querySelector('.repository-replace-undo').addEventListener('click', () => host.postMessage({ type: 'undoRepositoryReplacement' }));
    palette.querySelector('.repository-search-cancel').addEventListener('click', () => {
        host.postMessage({ type: 'cancelRepositorySearch' });
        palette.querySelector('.repository-search-summary').textContent = `Cancelling search · ${repositorySearchMatches.length} results…`;
    });
    palette.querySelector('.repository-search-results').addEventListener('click', (event) => {
        const result = event.target instanceof Element
            ? event.target.closest('[data-repository-search-result]')
            : null;
        if (!result) return;
        const match = repositorySearchMatches[Number(result.getAttribute('data-repository-search-result'))];
        if (match) host.postMessage({ type: 'openRepositorySearchResult', ...match });
    });
    palette.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeRepositorySearch();
        }
    });
}

function openRepositorySearch(root) {
    repositorySearchRoot = root;
    repositorySearchMatches = [];
    repositoryReplacementFiles = [];
    closeVisiblePaneSearch();
    const palette = getElement('repository-search');
    palette.classList.remove('hidden');
    palette.querySelector('.repository-search-root').textContent = root;
    palette.querySelector('.repository-search-summary').textContent = 'Choose a query, then run the search.';
    palette.querySelector('.repository-search-cancel').hidden = true;
    resetRepositoryReplacementPreview();
    palette.querySelector('.repository-search-results').replaceChildren();
    const input = palette.querySelector('.repository-search-input');
    input.focus();
    input.select();
}

function closeRepositorySearch() {
    const palette = getElement('repository-search');
    palette?.classList.add('hidden');
    if (palette) palette.querySelector('.repository-search-cancel').hidden = true;
    repositorySearchRequestId += 1;
    repositorySearchMatches = [];
    repositoryReplacementFiles = [];
    host.postMessage({ type: 'cancelRepositorySearch' });
}

function runRepositorySearch() {
    const palette = getElement('repository-search');
    const form = palette.querySelector('form');
    const query = form.querySelector('.repository-search-input').value;
    if (!query) {
        palette.querySelector('.repository-search-summary').textContent = 'Enter a query before searching.';
        return;
    }
    repositorySearchRequestId += 1;
    repositorySearchMatches = [];
    palette.querySelector('.repository-search-results').replaceChildren();
    palette.querySelector('.repository-search-summary').textContent = `Searching ${repositorySearchRoot}…`;
    palette.querySelector('.repository-search-cancel').hidden = false;
    resetRepositoryReplacementPreview();
    host.postMessage({
        type: 'runRepositorySearch', requestId: repositorySearchRequestId, query,
        regex: form.elements.regex.checked,
        caseSensitive: form.elements.caseSensitive.checked,
        wholeWord: form.elements.wholeWord.checked,
        hidden: form.elements.hidden.checked,
        respectIgnores: form.elements.respectIgnores.checked,
        include: form.elements.include.value,
        exclude: form.elements.exclude.value,
        limit: form.elements.limit.value
    });
}

function renderRepositorySearchResults() {
    const palette = getElement('repository-search');
    if (!palette || palette.classList.contains('hidden')) return;
    palette.querySelector('.repository-search-summary').textContent = `${repositorySearchMatches.length} result${repositorySearchMatches.length === 1 ? '' : 's'}…`;
    palette.querySelector('.repository-search-results').innerHTML = repositorySearchMatches.map((match, index) => (
        `<button class="repository-search-result" type="button" role="option" data-repository-search-result="${index}" title="Open ${escapeAttr(match.relativePath)}:${match.line}">`
        + `<span class="repository-search-location">${escapeHtml(match.relativePath)}:${match.line}</span>`
        + `<span class="repository-search-preview">${escapeHtml(match.preview.trim())}</span>`
        + '</button>'
    )).join('');
}

function completeRepositorySearch(completion) {
    const palette = getElement('repository-search');
    if (!palette || palette.classList.contains('hidden') || !completion) return;
    const summary = palette.querySelector('.repository-search-summary');
    palette.querySelector('.repository-search-cancel').hidden = true;
    if (completion.kind === 'failed') summary.textContent = `Search failed: ${completion.message}`;
    else if (completion.kind === 'cancelled') summary.textContent = `Search cancelled · ${repositorySearchMatches.length} results`;
    else {
        summary.textContent = `${repositorySearchMatches.length} result${repositorySearchMatches.length === 1 ? '' : 's'}${completion.truncated ? ' · limit reached' : ''}`;
        const form = palette.querySelector('form');
        const replacement = form.elements.replacement;
        const preview = palette.querySelector('.repository-replace-preview');
        const eligible = !completion.truncated && form.elements.caseSensitive.checked && !form.elements.regex.checked && repositorySearchMatches.length > 0;
        replacement.disabled = !eligible;
        preview.disabled = !eligible;
        preview.title = eligible ? 'Build a revalidated literal replacement preview' : 'Requires a complete case-sensitive literal search';
    }
}

function resetRepositoryReplacementPreview() {
    const palette = getElement('repository-search');
    if (!palette) return;
    repositoryReplacementFiles = [];
    const container = palette.querySelector('div.repository-replace-preview');
    container.hidden = true;
    container.replaceChildren();
    palette.querySelector('.repository-replace-apply').hidden = true;
    palette.querySelector('input[name="replacement"]').disabled = true;
    palette.querySelector('button.repository-replace-preview').disabled = true;
}

function previewRepositoryReplacement() {
    const palette = getElement('repository-search');
    host.postMessage({
        type: 'previewRepositoryReplacement',
        requestId: repositorySearchRequestId,
        replacement: palette.querySelector('input[name="replacement"]').value
    });
    palette.querySelector('.repository-search-summary').textContent = 'Building replacement preview…';
}

function receiveRepositoryReplacementPreview(message) {
    const palette = getElement('repository-search');
    const summary = palette.querySelector('.repository-search-summary');
    if (message.error) {
        summary.textContent = `Could not preview replacement: ${message.error}`;
        return;
    }
    repositoryReplacementFiles = message.files || [];
    const container = palette.querySelector('div.repository-replace-preview');
    container.hidden = false;
    container.innerHTML = repositoryReplacementFiles.map((file, index) => (
        `<label><input type="checkbox" data-repository-replace-file="${index}" checked> `
        + `<span>${escapeHtml(file.relativePath)}</span><span>${file.occurrenceCount} occurrence${file.occurrenceCount === 1 ? '' : 's'}</span></label>`
    )).join('');
    palette.querySelector('.repository-replace-apply').hidden = repositoryReplacementFiles.length === 0;
    summary.textContent = `Preview: ${message.occurrenceCount} occurrence${message.occurrenceCount === 1 ? '' : 's'} in ${repositoryReplacementFiles.length} file${repositoryReplacementFiles.length === 1 ? '' : 's'}`;
}

function applyRepositoryReplacement() {
    const palette = getElement('repository-search');
    const paths = [...palette.querySelectorAll('[data-repository-replace-file]:checked')]
        .map((input) => repositoryReplacementFiles[Number(input.getAttribute('data-repository-replace-file'))]?.path)
        .filter(Boolean);
    if (paths.length > 0) host.postMessage({ type: 'applyRepositoryReplacement', paths });
}

function receiveRepositoryReplacementApplied(message) {
    const palette = getElement('repository-search');
    palette.querySelector('.repository-search-summary').textContent = `Replaced ${message.occurrenceCount} occurrence${message.occurrenceCount === 1 ? '' : 's'} in ${message.fileCount} file${message.fileCount === 1 ? '' : 's'}`;
    palette.querySelector('.repository-replace-undo').hidden = false;
    resetRepositoryReplacementPreview();
    palette.querySelector('.repository-replace-undo').hidden = false;
}

function receiveRepositoryReplacementUndone(message) {
    const palette = getElement('repository-search');
    palette.querySelector('.repository-search-summary').textContent = `Undid replacement in ${message.fileCount} file${message.fileCount === 1 ? '' : 's'}`;
    palette.querySelector('.repository-replace-undo').hidden = true;
}

function initializeVisiblePaneSearch() {
    const palette = document.createElement('section');
    palette.id = 'visible-pane-search';
    palette.className = 'visible-pane-search hidden';
    palette.setAttribute('aria-label', 'Search visible panes');
    palette.innerHTML = [
        '<div class="visible-search-header">',
        '<input class="visible-search-input" type="search" aria-label="Search visible panes" placeholder="Search visible panes">',
        '<select class="visible-search-scope" aria-label="Search scope" title="Search scope">',
        '<option value="visible">Visible panes</option>',
        '<option value="comparison">All comparison panels</option>',
        '<option value="changeSet">Current change set</option>',
        '<option value="gitHistory">Git history</option>',
        '</select>',
        '<select class="visible-search-history-mode" aria-label="Git history query meaning" title="Git history query meaning" hidden>',
        '<option value="content">Content occurrence</option>',
        '<option value="change">Introduction or removal</option>',
        '</select>',
        '<button class="visible-search-option" type="button" data-visible-search-option="case" aria-pressed="false" title="Match case">Aa</button>',
        '<button class="visible-search-option" type="button" data-visible-search-option="regex" aria-pressed="false" title="Use regular expression">.*</button>',
        '<button class="visible-search-close" type="button" aria-label="Close visible-pane search" title="Close visible-pane search (Esc)">×</button>',
        '</div>',
        '<div class="visible-search-summary" aria-live="polite"></div>',
        '<div class="visible-search-results" role="listbox"></div>'
    ].join('');
    document.body.appendChild(palette);

    const input = palette.querySelector('.visible-search-input');
    input.addEventListener('input', updateVisiblePaneSearch);
    palette.querySelector('.visible-search-scope').addEventListener('change', updateVisiblePaneSearch);
    palette.querySelector('.visible-search-history-mode').addEventListener('change', updateVisiblePaneSearch);
    palette.addEventListener('click', (event) => {
        const option = event.target instanceof Element
            ? event.target.closest('[data-visible-search-option]')
            : null;
        if (option) {
            option.setAttribute('aria-pressed', option.getAttribute('aria-pressed') !== 'true' ? 'true' : 'false');
            updateVisiblePaneSearch();
            return;
        }
        if (event.target instanceof Element && event.target.closest('.visible-search-close')) {
            closeVisiblePaneSearch();
            return;
        }
        const result = event.target instanceof Element
            ? event.target.closest('[data-visible-search-result]')
            : null;
        if (result) revealVisibleSearchMatch(Number(result.getAttribute('data-visible-search-result')));
    });
    palette.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeVisiblePaneSearch();
        }
    });
}

function openVisiblePaneSearch() {
    if (currentMode !== MODE_TWO_WAY && currentMode !== MODE_MULTI_WAY && currentMode !== 'directory') return;
    const palette = getElement('visible-pane-search');
    palette.classList.remove('hidden');
    const input = palette.querySelector('.visible-search-input');
    input.focus();
    input.select();
    updateVisiblePaneSearch();
}

function closeVisiblePaneSearch() {
    getElement('visible-pane-search')?.classList.add('hidden');
    clearTimeout(changeSetSearchTimer);
    clearTimeout(gitHistorySearchTimer);
    visibleSearchMatches = [];
}

function getVisibleSearchTargets() {
    if (currentMode === MODE_TWO_WAY) {
        return [
            { id: 'left', label: getElement('file1-header').textContent || 'Left', editor: leftEditor },
            { id: 'right', label: getElement('file2-header').textContent || 'Right', editor: rightEditor }
        ];
    }
    if (currentMode !== MODE_MULTI_WAY || !focusedStripLayout) return [];
    const indices = focusedStripLayout.mode === 'pair'
        ? [focusedStripLayout.pairIndex, focusedStripLayout.pairIndex + 1]
        : [focusedStripLayout.panelIndex];
    return indices.map((index) => ({
        id: multiPanels[index]?.id,
        label: multiPanels[index]?.label || `Panel ${index + 1}`,
        editor: multiEditors[index]
    })).filter((target) => target.id && target.editor);
}

function getComparisonSearchTargets() {
    if (currentMode === MODE_TWO_WAY) return getVisibleSearchTargets();
    if (currentMode !== MODE_MULTI_WAY) return [];
    return multiPanels.map((panel, index) => ({
        id: panel.id,
        label: panel.label || `Panel ${index + 1}`,
        editor: multiEditors[index]
    })).filter((target) => target.id && target.editor);
}

function updateVisiblePaneSearch() {
    const palette = getElement('visible-pane-search');
    if (!palette || palette.classList.contains('hidden')) return;
    const query = palette.querySelector('.visible-search-input').value;
    const scope = palette.querySelector('.visible-search-scope').value;
    const historyModeControl = palette.querySelector('.visible-search-history-mode');
    historyModeControl.hidden = scope !== 'gitHistory';
    const caseSensitive = palette.querySelector('[data-visible-search-option="case"]').getAttribute('aria-pressed') === 'true';
    const regex = palette.querySelector('[data-visible-search-option="regex"]').getAttribute('aria-pressed') === 'true';
    const summary = palette.querySelector('.visible-search-summary');
    const results = palette.querySelector('.visible-search-results');
    if (scope === 'gitHistory') {
        clearTimeout(gitHistorySearchTimer);
        visibleSearchMatches = [];
        results.innerHTML = '';
        if (!query) {
            summary.textContent = 'Type to search this file’s Git history';
            return;
        }
        summary.textContent = 'Searching Git history…';
        gitHistorySearchTimer = window.setTimeout(() => {
            gitHistorySearchRequestId += 1;
            host.postMessage({
                type: 'searchGitHistory',
                requestId: gitHistorySearchRequestId,
                query,
                historyMode: historyModeControl.value,
                caseSensitive,
                regex
            });
        }, 150);
        return;
    }
    if (scope === 'changeSet') {
        clearTimeout(changeSetSearchTimer);
        visibleSearchMatches = [];
        results.innerHTML = '';
        if (!query) {
            summary.textContent = 'Type to search the current change set';
            return;
        }
        summary.textContent = 'Searching current change set…';
        changeSetSearchTimer = window.setTimeout(() => {
            changeSetSearchRequestId += 1;
            host.postMessage({
                type: 'searchChangeSet',
                requestId: changeSetSearchRequestId,
                query,
                caseSensitive,
                regex
            });
        }, 150);
        return;
    }
    try {
        const targets = scope === 'comparison' ? getComparisonSearchTargets() : getVisibleSearchTargets();
        visibleSearchMatches = findVisibleMatches(targets, query, { caseSensitive, regex });
        const scopeLabel = scope === 'comparison' ? 'all comparison panels' : 'visible panes';
        summary.textContent = query ? `${visibleSearchMatches.length} result${visibleSearchMatches.length === 1 ? '' : 's'} in ${scopeLabel}` : `Type to search ${scopeLabel}`;
        results.innerHTML = visibleSearchMatches.map((match, index) => (
            `<button class="visible-search-result" type="button" role="option" data-visible-search-result="${index}" title="Open ${escapeAttr(match.label)}:${match.lineNumber}">`
            + `<span class="visible-search-location">${escapeHtml(match.label)}:${match.lineNumber}</span>`
            + `<span class="visible-search-preview">${escapeHtml(match.preview.trim())}</span>`
            + '</button>'
        )).join('');
    } catch (error) {
        visibleSearchMatches = [];
        summary.textContent = regex ? `Invalid regular expression: ${error.message}` : error.message;
        results.innerHTML = '';
    }
}

function receiveChangeSetSearchResults(message) {
    const palette = getElement('visible-pane-search');
    if (!palette || palette.classList.contains('hidden')
        || palette.querySelector('.visible-search-scope').value !== 'changeSet') return;
    const summary = palette.querySelector('.visible-search-summary');
    const results = palette.querySelector('.visible-search-results');
    if (message.error) {
        summary.textContent = message.error;
        results.innerHTML = '';
        return;
    }
    if (message.unavailable) {
        summary.textContent = 'Current change-set search is available in desktop directory and branch sessions.';
        results.innerHTML = '';
        return;
    }
    visibleSearchMatches = (message.matches || []).map((match) => ({ ...match, hostResultKind: 'changeSet' }));
    summary.textContent = `${visibleSearchMatches.length} result${visibleSearchMatches.length === 1 ? '' : 's'} in current change set`;
    results.innerHTML = visibleSearchMatches.map((match, index) => (
        `<button class="visible-search-result" type="button" role="option" data-visible-search-result="${index}" title="Open ${escapeAttr(match.label)}:${match.lineNumber}">`
        + `<span class="visible-search-location">${escapeHtml(match.label)}:${match.lineNumber}</span>`
        + `<span class="visible-search-preview">${escapeHtml(match.preview.trim())}</span>`
        + '</button>'
    )).join('');
}

function receiveGitHistorySearchResults(message) {
    const palette = getElement('visible-pane-search');
    if (!palette || palette.classList.contains('hidden')
        || palette.querySelector('.visible-search-scope').value !== 'gitHistory') return;
    const summary = palette.querySelector('.visible-search-summary');
    const results = palette.querySelector('.visible-search-results');
    if (message.error) {
        summary.textContent = message.error;
        results.innerHTML = '';
        return;
    }
    if (message.unavailable) {
        summary.textContent = 'Git-history search is available while viewing file history in desktop.';
        results.innerHTML = '';
        return;
    }
    visibleSearchMatches = (message.matches || []).map((match) => ({ ...match, hostResultKind: 'gitHistory' }));
    summary.textContent = `${visibleSearchMatches.length} result${visibleSearchMatches.length === 1 ? '' : 's'} in Git history`;
    results.innerHTML = visibleSearchMatches.map((match, index) => (
        `<button class="visible-search-result" type="button" role="option" data-visible-search-result="${index}" title="Open ${escapeAttr(match.label)}:${match.lineNumber}">`
        + `<span class="visible-search-location">${escapeHtml(match.label)}</span>`
        + `<span class="visible-search-preview">${escapeHtml(match.preview.trim())}</span>`
        + '</button>'
    )).join('');
}

function revealVisibleSearchMatch(index) {
    const match = visibleSearchMatches[index];
    if (!match) return;
    if (match.hostResultKind === 'changeSet') {
        host.postMessage({ type: 'openChangeSetSearchResult', ...match });
        return;
    }
    if (match.hostResultKind === 'gitHistory') {
        host.postMessage({ type: 'openGitHistorySearchResult', ...match });
        return;
    }
    if (currentMode === MODE_TWO_WAY) {
        setActivePane(match.targetId, false);
    } else if (currentMode === MODE_MULTI_WAY) {
        setActiveMultiPanel(match.targetId, true);
    }
    match.editor.setSelection(match.range);
    match.editor.revealRangeInCenter(match.range, monacoInstance.editor.ScrollType.Smooth);
    match.editor.focus();
}

function revealHostSearchResult(message) {
    const editor = currentMode === MODE_TWO_WAY
        ? (message.sideIndex === 0 ? leftEditor : rightEditor)
        : multiEditors[message.sideIndex];
    if (!editor) return;
    const range = {
        startLineNumber: message.lineNumber,
        endLineNumber: message.lineNumber,
        startColumn: Number.isInteger(message.startColumn) ? message.startColumn : 1,
        endColumn: Number.isInteger(message.endColumn) ? message.endColumn : 1
    };
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monacoInstance.editor.ScrollType.Smooth);
    editor.focus();
}

function initializeChangeToolbar() {
    getElement('previous-file').addEventListener('click', () => navigateFile('previous'));
    getElement('next-file').addEventListener('click', () => navigateFile('next'));
    getElement('previous-change').addEventListener('click', () => navigateDiff(-1));
    getElement('next-change').addEventListener('click', () => navigateDiff(1));
    getElement('copy-left-to-right').addEventListener('click', () => copyCurrentChange('left-to-right'));
    getElement('copy-right-to-left').addEventListener('click', () => copyCurrentChange('right-to-left'));
    getElement('refresh-session').addEventListener('click', requestSessionRefresh);
    getElement('toggle-word-wrap').addEventListener('click', toggleWordWrap);

    window.addEventListener('keydown', (event) => {
        const findWidgetOwnsEvent = event.target instanceof Element
            && Boolean(event.target.closest('.find-widget'));
        if (!findWidgetOwnsEvent
            && (event.metaKey || event.ctrlKey)
            && !event.altKey
            && event.shiftKey
            && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
            openVisiblePaneSearch();
        } else if (!findWidgetOwnsEvent
            && (event.metaKey || event.ctrlKey)
            && !event.altKey
            && !event.shiftKey
            && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
            runActiveEditorFindCommand('open');
        }
    }, true);

    window.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) {
            return;
        }

        const findWidgetOwnsEvent = event.target instanceof Element
            && Boolean(event.target.closest('.find-widget'));
        if (!findWidgetOwnsEvent && event.key === 'F3') {
            event.preventDefault();
            runActiveEditorFindCommand(event.shiftKey ? 'previous' : 'next');
            return;
        }

        if (!event.metaKey && !event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            toggleWordWrap();
            return;
        }

        if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r') {
            event.preventDefault();
            if (refreshSessionState.enabled && refreshSessionState.status !== 'refreshing') {
                requestSessionRefresh();
            }
            return;
        }

        if (currentMode !== MODE_TWO_WAY && currentMode !== MODE_MULTI_WAY) {
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowUp') {
            event.preventDefault();
            navigateDiff(-1);
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowDown') {
            event.preventDefault();
            navigateDiff(1);
            return;
        }

        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's' && currentMode === MODE_MULTI_WAY) {
            event.preventDefault();
            host.postMessage({
                type: 'multiSavePanel',
                panelId: activeMultiPanelId
            });
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key === '[' && !getElement('directory-return-toolbar').hidden) {
            event.preventDefault();
            returnToDirectory();
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowRight') {
            event.preventDefault();
            copyCurrentChange('left-to-right');
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === 'ArrowLeft') {
            event.preventDefault();
            copyCurrentChange('right-to-left');
        }
    });
}

function getTextEditors() {
    if (currentMode === MODE_TWO_WAY) {
        return [leftEditor, rightEditor].filter(Boolean);
    }
    if (currentMode === MODE_MULTI_WAY) {
        return multiEditors.filter(Boolean);
    }
    return [];
}

function hasWordWrapTarget() {
    if (currentMode === MODE_TWO_WAY) {
        return Boolean(leftEditor || rightEditor);
    }
    return currentMode === MODE_MULTI_WAY
        && multiPanels.some((panel) => panel.path || panel.content);
}

function updateWordWrapControl() {
    const button = getElement('toggle-word-wrap');
    if (!button) {
        return;
    }
    const available = hasWordWrapTarget();
    button.hidden = !available;
    button.disabled = !available;
    button.classList.toggle('is-active', wordWrapEnabled);
    button.setAttribute('aria-pressed', wordWrapEnabled ? 'true' : 'false');
    button.title = `${wordWrapEnabled ? 'Disable' : 'Enable'} line wrapping (Alt+Z)`;
    button.setAttribute('aria-label', wordWrapEnabled ? 'Disable line wrapping' : 'Enable line wrapping');
}

function postWordWrapState() {
    const available = hasWordWrapTarget();
    const stateKey = `${wordWrapEnabled}:${available}`;
    if (stateKey === lastPostedWordWrapState) {
        return;
    }
    lastPostedWordWrapState = stateKey;
    host.postMessage({ type: 'wordWrapState', enabled: wordWrapEnabled, available });
}

function setWordWrapEnabled(enabled) {
    wordWrapEnabled = Boolean(enabled);
    writeWordWrapPreference(window.localStorage, wordWrapEnabled);
    applyWordWrap(getTextEditors(), wordWrapEnabled);
    updateWordWrapControl();
    postWordWrapState();
    requestAnimationFrame(() => {
        layoutEditors();
        if (activeDiffIndex >= 0) {
            revealActiveDiff(false);
        }
        connectorController.resizeCanvas();
        connectorController.scheduleDrawConnections();
    });
}

function toggleWordWrap() {
    if (!hasWordWrapTarget()) {
        return false;
    }
    setWordWrapEnabled(!wordWrapEnabled);
    return true;
}

function requestSessionRefresh() {
    if (!refreshSessionState.enabled || refreshSessionState.status === 'refreshing') {
        return;
    }
    host.postMessage({ type: 'refreshSession' });
}

function updateRefreshSessionState(nextState) {
    refreshSessionState = {
        enabled: Boolean(nextState?.enabled),
        status: typeof nextState?.status === 'string' ? nextState.status : 'disabled',
        message: typeof nextState?.message === 'string' ? nextState.message : null
    };
    const button = getElement('refresh-session');
    if (!button) {
        return;
    }
    const refreshing = refreshSessionState.status === 'refreshing';
    const failed = refreshSessionState.status === 'failed';
    const stale = refreshSessionState.status === 'stale';
    button.disabled = !refreshSessionState.enabled || refreshing;
    button.classList.toggle('is-refreshing', refreshing);
    button.classList.toggle('is-failed', failed);
    button.classList.toggle('is-stale', stale);
    button.setAttribute('aria-busy', refreshing ? 'true' : 'false');
    const label = refreshing
        ? 'Refreshing Session'
        : (failed
            ? `Refresh failed${refreshSessionState.message ? `: ${refreshSessionState.message}` : ''}`
            : (stale ? 'Changes available' : 'Refresh Session'));
    button.title = `${label} (Cmd/Ctrl+R)`;
    button.setAttribute('aria-label', label);
    updateChangeToolbarState();
}

function captureEditorNavigation(editor) {
    if (!editor) {
        return null;
    }
    const selection = editor.getSelection();
    return {
        selection: selection ? {
            startLineNumber: selection.startLineNumber,
            startColumn: selection.startColumn,
            endLineNumber: selection.endLineNumber,
            endColumn: selection.endColumn
        } : null,
        scrollTop: editor.getScrollTop(),
        scrollLeft: editor.getScrollLeft()
    };
}

function captureActiveChangeAnchor() {
    const block = diffBlocks[activeDiffIndex];
    if (!block) {
        return null;
    }
    return {
        leftStart: block.leftStart,
        leftEnd: block.leftEnd,
        rightStart: block.rightStart,
        rightEnd: block.rightEnd
    };
}

function captureNavigationState() {
    const editorStates = {};
    if (currentMode === MODE_TWO_WAY) {
        editorStates.left = captureEditorNavigation(leftEditor);
        editorStates.right = captureEditorNavigation(rightEditor);
    } else if (currentMode === MODE_MULTI_WAY) {
        multiPanels.forEach((panel, index) => {
            editorStates[panel.id] = captureEditorNavigation(multiEditors[index]);
        });
    }
    return {
        mode: currentMode,
        activePaneSide,
        activeMultiPanelId,
        activeMultiPairIndex,
        activeDiffIndex,
        activeChange: captureActiveChangeAnchor(),
        activeDirectoryEntryPath,
        editorStates
    };
}

function restoreEditorNavigation(editor, state) {
    if (!editor || !state) {
        return;
    }
    if (state.selection) {
        editor.setSelection(state.selection);
    }
    editor.setScrollPosition({
        scrollTop: Number.isFinite(state.scrollTop) ? state.scrollTop : 0,
        scrollLeft: Number.isFinite(state.scrollLeft) ? state.scrollLeft : 0
    });
}

function findRestoredChangeIndex(anchor, fallbackIndex) {
    if (!anchor || diffBlocks.length === 0) {
        return clamp(fallbackIndex ?? 0, 0, Math.max(0, diffBlocks.length - 1));
    }
    const exactIndex = diffBlocks.findIndex((block) => (
        block.leftStart === anchor.leftStart
        && block.leftEnd === anchor.leftEnd
        && block.rightStart === anchor.rightStart
        && block.rightEnd === anchor.rightEnd
    ));
    if (exactIndex >= 0) {
        return exactIndex;
    }
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    diffBlocks.forEach((block, index) => {
        const distance = Math.abs(block.leftStart - anchor.leftStart)
            + Math.abs(block.rightStart - anchor.rightStart);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex;
}

function applyPendingNavigationRestore() {
    if (!pendingNavigationRestore?.navigation) {
        return;
    }
    const { navigation, panelIdMap } = pendingNavigationRestore;
    pendingNavigationRestore = null;
    suppressEditorEvents = true;
    try {
        if (currentMode === MODE_TWO_WAY) {
            if (navigation.activePaneSide === 'left' || navigation.activePaneSide === 'right') {
                setActivePane(navigation.activePaneSide, false);
            }
            restoreEditorNavigation(leftEditor, navigation.editorStates?.left);
            restoreEditorNavigation(rightEditor, navigation.editorStates?.right);
        } else if (currentMode === MODE_MULTI_WAY) {
            const restoredActivePanelId = panelIdMap[navigation.activeMultiPanelId] || navigation.activeMultiPanelId;
            if (multiPanels.some((panel) => panel.id === restoredActivePanelId)) {
                setActiveMultiPanel(restoredActivePanelId, false);
            }
            multiPanels.forEach((panel, index) => {
                const previousPanelId = Object.keys(panelIdMap).find((candidate) => panelIdMap[candidate] === panel.id) || panel.id;
                restoreEditorNavigation(multiEditors[index], navigation.editorStates?.[previousPanelId]);
            });
        } else if (currentMode === 'directory' && navigation.activeDirectoryEntryPath) {
            activeDirectoryEntryPath = navigation.activeDirectoryEntryPath;
            updateDirectoryEntrySelection();
        }

        if ((currentMode === MODE_TWO_WAY || currentMode === MODE_MULTI_WAY) && diffBlocks.length > 0) {
            setActiveDiffIndex(findRestoredChangeIndex(navigation.activeChange, navigation.activeDiffIndex), false);
        }
    } finally {
        suppressEditorEvents = false;
        connectorController.scheduleDrawConnections();
    }
}

function navigateFile(direction) {
    if (currentMode === 'directory') {
        navigateDirectoryEntry(direction);
        return;
    }

    const action = resolveFileNavigationAction({
        direction,
        mode: currentMode,
        fileNavigation: hostFileNavigation,
        panelIds: multiPanels.map((panel) => panel.id),
        activePanelId: activeMultiPanelId
    });

    if (action.kind === 'host-file') {
        host.postMessage({ type: 'navigateFile', direction });
        return;
    }

    if (action.kind === 'panel') {
        setActiveMultiPanel(action.panelId, true);
        setActiveMultiPair(action.pairIndex, true);
        return;
    }

}

function returnToDirectory() {
    host.postMessage({ type: 'returnToDirectory' });
}

function updateDirectoryReturnToolbar(canReturnToDirectory) {
    getElement('directory-return-toolbar').hidden = !canReturnToDirectory;
    getElement('toggle-directory-sidebar').hidden = !hasDirectoryNavigation;
    updateDirectorySidebarToggle();
}

function updateDirectorySidebarToggle() {
    const button = getElement('toggle-directory-sidebar');
    const isVisible = hasDirectoryNavigation && directoryRailVisible && !navigationRailCollapsed;
    button.setAttribute('aria-pressed', isVisible ? 'true' : 'false');
    button.setAttribute('aria-label', isVisible ? 'Hide directory files' : 'Show directory files');
    button.title = isVisible ? 'Hide directory files' : 'Show directory files';
}

function updateEditModeToolbar() {
    const toolbar = getElement('edit-mode-toolbar');
    const button = getElement('toggle-readonly');
    const hasEditableSide = currentMode === MODE_TWO_WAY && hasHostEditableSide();

    toolbar.hidden = currentMode !== MODE_TWO_WAY;
    button.disabled = !hasEditableSide;
    button.classList.toggle('is-readonly', userReadOnly);
    button.textContent = !hasEditableSide ? 'Read-only snapshot' : (userReadOnly ? 'Read-only' : 'Editing On');
    button.title = !hasEditableSide
        ? 'This comparison contains historical, committed, or synthetic snapshots'
        : userReadOnly
        ? 'Allow editing for writable panes'
        : 'Freeze writable panes';
}

function registerEditorKeybindings(editor, editorMode) {
    if (editorMode !== MODE_TWO_WAY && editorMode !== MODE_MULTI_WAY) {
        return;
    }

    editor.addCommand(monacoInstance.KeyCode.F7, () => navigateDiff(1));
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F7, () => navigateDiff(-1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.UpArrow, () => navigateDiff(-1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.DownArrow, () => navigateDiff(1));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.RightArrow, () => copyCurrentChange('left-to-right'));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.LeftArrow, () => copyCurrentChange('right-to-left'));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyF, () => dispatchFindCommand(editor, 'open'));
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyH, () => dispatchFindCommand(editor, 'replace'));
    editor.addCommand(monacoInstance.KeyCode.F3, () => dispatchFindCommand(editor, 'next'));
    editor.addCommand(monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F3, () => dispatchFindCommand(editor, 'previous'));
    editor.addCommand(monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyZ, toggleWordWrap);

    if (editorMode === MODE_MULTI_WAY) {
        editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
            host.postMessage({
                type: 'multiSavePanel',
                panelId: activeMultiPanelId
            });
        });
    }
}

function getFindControllerState() {
    return {
        mode: currentMode,
        activePaneSide,
        activeMultiPanelId,
        leftEditor,
        rightEditor,
        multiPanels,
        multiEditors
    };
}

function runActiveEditorFindCommand(command) {
    return runFindCommand(getFindControllerState(), command);
}

const ALLOWED_EDITOR_ACTIONS = new Set([
    'editor.action.insertCursorAbove', 'editor.action.insertCursorBelow',
    'editor.action.addSelectionToNextFindMatch', 'editor.action.addSelectionToPreviousFindMatch',
    'editor.action.selectHighlights', 'editor.action.moveLinesUpAction',
    'editor.action.moveLinesDownAction', 'editor.action.copyLinesUpAction',
    'editor.action.copyLinesDownAction', 'editor.action.deleteLines',
    'editor.action.insertLineBefore', 'editor.action.insertLineAfter',
    'editor.action.joinLines', 'editor.action.transpose',
    'editor.action.indentLines', 'editor.action.outdentLines',
    'editor.action.reindentlines', 'editor.action.commentLine',
    'editor.action.blockComment', 'editor.action.smartSelect.expand',
    'editor.action.smartSelect.shrink'
]);

async function runActiveEditorAction(actionId) {
    if (!ALLOWED_EDITOR_ACTIONS.has(actionId)) return false;
    const editor = currentMode === MODE_MULTI_WAY
        ? getActivePanelEditor()
        : activePaneSide === 'left' ? leftEditor : rightEditor;
    const action = editor?.getAction(actionId);
    if (!action || !action.isSupported()) return false;
    editor.focus();
    await action.run();
    return true;
}

function navigateDiff(direction) {
    if (currentMode === MODE_MULTI_WAY) {
        const panelChanges = getMultiPanelChanges(activeMultiPanelId);
        if (panelChanges.length === 0) {
            return;
        }

        const currentPanelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
        const nextIndex = currentPanelChangeIndex < 0
            ? 0
            : (currentPanelChangeIndex + direction + panelChanges.length) % panelChanges.length;

        setActiveMultiPanelChangeIndex(nextIndex, true);
        return;
    }

    if (currentMode !== MODE_TWO_WAY || diffBlocks.length === 0) {
        return;
    }

    const nextIndex = activeDiffIndex < 0
        ? 0
        : (activeDiffIndex + direction + diffBlocks.length) % diffBlocks.length;

    setActiveDiffIndex(nextIndex, true);
}

function setActiveMultiPanelChangeIndex(index, shouldReveal, notifyHost = false) {
    const panelChanges = getMultiPanelChanges(activeMultiPanelId);
    if (currentMode !== MODE_MULTI_WAY || index < 0 || index >= panelChanges.length) {
        return;
    }

    const nextChange = panelChanges[index];
    const nextPair = multiDiffPairs[nextChange.pairIndex];
    if (!nextPair) {
        return;
    }

    setMultiPanelChangeIndex(activeMultiPanelId, index);
    activeMultiPairIndex = nextChange.pairIndex;
    setCurrentDiffModel(nextPair.diffModel);
    setActiveDiffIndex(nextChange.blockIndex, false);

    updateActiveMultiShellState();
    if (shouldReveal) {
        revealActiveDiff(true);
    }

    if (notifyHost) {
        host.postMessage({ type: 'multiSetActivePair', pairIndex: activeMultiPairIndex });
    }
}

function getActivePanelEditor() {
    const panelIndex = getActiveMultiPanelIndex();
    if (panelIndex < 0) {
        return null;
    }

    return multiEditors[panelIndex] || null;
}

function getMultiPairForDirection(direction) {
    const activePanelIndex = getActiveMultiPanelIndex();
    if (activePanelIndex < 0) {
        return null;
    }

    const targetPanelIndex = direction === 'left-to-right' ? activePanelIndex + 1 : activePanelIndex - 1;
    if (targetPanelIndex < 0 || targetPanelIndex >= multiPanels.length) {
        return null;
    }

    const pairIndex = direction === 'left-to-right' ? activePanelIndex : targetPanelIndex;
    const pair = multiDiffPairs[pairIndex];
    if (!pair) {
        return null;
    }

    return {
        pair,
        pairIndex,
        activePanelIndex,
        targetPanelIndex
    };
}

function getMultiPairProjection(pair, activePanelIndex, activeChange) {
    if (!pair || !activeChange) {
        return null;
    }

    const activeSide = pair.leftIndex === activePanelIndex ? 'left' : (pair.rightIndex === activePanelIndex ? 'right' : null);
    if (!activeSide) {
        return null;
    }

    const targetSide = activeSide === 'left' ? 'right' : 'left';
    const activeStartKey = activeSide === 'left' ? 'leftStart' : 'rightStart';
    const activeEndKey = activeSide === 'left' ? 'leftEnd' : 'rightEnd';
    const targetStartKey = targetSide === 'left' ? 'leftStart' : 'rightStart';
    const targetEndKey = targetSide === 'left' ? 'leftEnd' : 'rightEnd';
    const block = (pair.diffModel?.blocks || []).find((candidate) => (
        candidate[activeStartKey] === activeChange.start && candidate[activeEndKey] === activeChange.end
    ));

    if (block) {
        return {
            activeStart: block[activeStartKey],
            activeEnd: block[activeEndKey],
            targetStart: block[targetStartKey],
            targetEnd: block[targetEndKey]
        };
    }

    return {
        activeStart: activeChange.start,
        activeEnd: activeChange.end,
        targetStart: activeChange.start,
        targetEnd: activeChange.end
    };
}

function canCopyFromPanel(panelId, direction) {
    const panelChanges = getMultiPanelChanges(panelId);
    if (panelChanges.length === 0) {
        return false;
    }

    const panelIndex = multiPanels.findIndex((panel) => panel.id === panelId);
    if (panelIndex < 0) {
        return false;
    }

    if (direction === 'left-to-right') {
        return panelIndex < multiPanels.length - 1;
    }

    if (direction === 'right-to-left') {
        return panelIndex > 0;
    }

    return false;
}

function copyMultiPanelChange(panelId, direction) {
    if (!canCopyFromPanel(panelId, direction)) {
        return;
    }

    if (panelId !== activeMultiPanelId) {
        setActiveMultiPanel(panelId, true);
    }

    copyCurrentChange(direction);
}

function setActiveDiffIndex(index, shouldReveal) {
    activeDiffIndex = index;
    updateChangeToolbarState();

    if (leftEditor && rightEditor && currentDiffModel) {
        applyDiffDecorations(currentDiffModel, currentTourAnnotations);
    } else if (currentMode === MODE_MULTI_WAY) {
        applyMultiDiffDecorations(multiDiffPairs);
    }

    if (shouldReveal) {
        revealActiveDiff(true);
    }
}

function updateChangeToolbarState() {
    const toolbar = getElement('change-toolbar');
    updateWordWrapControl();
    postWordWrapState();
    const toolbarCenter = toolbar.querySelector('.change-toolbar-center');
    const toolbarHint = toolbar.parentElement?.querySelector('.change-hint');
    const isCompareMode = currentMode === MODE_TWO_WAY || currentMode === 'binary' || currentMode === 'directory' || currentMode === MODE_MULTI_WAY || currentMode === 'three-way';
    const hasTwoWayMode = currentMode === MODE_TWO_WAY;
    const hasBinaryMode = currentMode === 'binary';
    const directoryTargets = getNavigableDirectoryEntries();
    const hasDirectoryTargets = currentMode === 'directory' && directoryTargets.length > 0;
    toolbar.hidden = !isCompareMode;

    if (!isCompareMode) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        setTextContent('change-position', '');
        return;
    }

    if (hasDirectoryTargets) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        const currentIndex = getActiveDirectoryEntryIndex(directoryTargets);
        setTextContent('change-position', `${currentIndex + 1} / ${directoryTargets.length}`);
        getElement('copy-left-to-right').hidden = false;
        getElement('copy-right-to-left').hidden = false;
        getElement('previous-file').hidden = false;
        getElement('next-file').hidden = false;
        getElement('previous-change').disabled = true;
        getElement('next-change').disabled = true;
        getElement('previous-file').disabled = currentIndex <= 0;
        getElement('next-file').disabled = currentIndex >= directoryTargets.length - 1;
        getElement('copy-left-to-right').disabled = true;
        getElement('copy-right-to-left').disabled = true;
        updateDirectoryEntrySelection();
        return;
    }

    if (hasTwoWayMode) {
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = false;
        }
        const safeIndex = diffBlocks.length > 0 ? clamp(activeDiffIndex, 0, diffBlocks.length - 1) : -1;
        setTextContent('change-position', diffBlocks.length > 0 ? `${safeIndex + 1} / ${diffBlocks.length}` : '0 / 0');
        getElement('copy-left-to-right').hidden = false;
        getElement('copy-right-to-left').hidden = false;
        getElement('previous-file').hidden = false;
        getElement('next-file').hidden = false;
        getElement('previous-change').disabled = diffBlocks.length === 0;
        getElement('next-change').disabled = diffBlocks.length === 0;
        getElement('previous-file').disabled = !currentFileNavigation.canGoPrevious;
        getElement('next-file').disabled = !currentFileNavigation.canGoNext;
        getElement('copy-left-to-right').disabled = !isSideEditable('right');
        getElement('copy-right-to-left').disabled = !isSideEditable('left');
        return;
    }

    if (hasBinaryMode) {
        toolbar.hidden = !hasDirectoryNavigation && !refreshSessionState.enabled;
        toolbarCenter.hidden = true;
        if (toolbarHint) {
            toolbarHint.hidden = true;
        }
        setTextContent('change-position', '');
        getElement('copy-left-to-right').hidden = true;
        getElement('copy-right-to-left').hidden = true;
        getElement('previous-change').disabled = true;
        getElement('next-change').disabled = true;
        getElement('previous-file').hidden = !hasDirectoryNavigation;
        getElement('next-file').hidden = !hasDirectoryNavigation;
        getElement('previous-file').disabled = !currentFileNavigation.canGoPrevious;
        getElement('next-file').disabled = !currentFileNavigation.canGoNext;
        return;
    }

    if (currentMode === MODE_MULTI_WAY) {
        const panelChanges = getMultiPanelChanges(activeMultiPanelId);
        const panelChangeIndex = getMultiPanelChangeIndex(activeMultiPanelId, panelChanges);
        toolbarCenter.hidden = false;
        if (toolbarHint) {
            toolbarHint.hidden = true;
        }
        setTextContent('change-position', panelChanges.length > 0 ? `${panelChangeIndex + 1} / ${panelChanges.length}` : '0 / 0');
        getElement('copy-left-to-right').hidden = true;
        getElement('copy-right-to-left').hidden = true;
        getElement('previous-change').disabled = panelChanges.length === 0;
        getElement('next-change').disabled = panelChanges.length === 0;
        getElement('previous-file').hidden = !hasDirectoryNavigation;
        getElement('next-file').hidden = !hasDirectoryNavigation;
        getElement('previous-file').disabled = !currentFileNavigation.canGoPrevious;
        getElement('next-file').disabled = !currentFileNavigation.canGoNext;
        getElement('copy-left-to-right').disabled = true;
        getElement('copy-right-to-left').disabled = true;
        updateActiveMultiShellState();
        return;
    }

    toolbarCenter.hidden = false;
    if (toolbarHint) {
        toolbarHint.hidden = false;
    }
    setTextContent('change-position', '—');
    getElement('copy-left-to-right').hidden = false;
    getElement('copy-right-to-left').hidden = false;
    getElement('previous-change').disabled = true;
    getElement('next-change').disabled = true;
    getElement('previous-file').disabled = true;
    getElement('next-file').disabled = true;
    getElement('copy-left-to-right').disabled = true;
    getElement('copy-right-to-left').disabled = true;
}

function getNavigableDirectoryEntries() {
    return directoryEntries.filter((entry) => !entry.isDirectory && entry.status !== 'same');
}

function getDefaultDirectoryEntryPath(entries) {
    return entries.find((entry) => !entry.isDirectory && entry.status !== 'same')?.relativePath ?? null;
}

function getActiveDirectoryEntryIndex(entries = getNavigableDirectoryEntries()) {
    const currentIndex = entries.findIndex((entry) => entry.relativePath === activeDirectoryEntryPath);
    if (currentIndex >= 0) {
        return currentIndex;
    }

    if (entries.length === 0) {
        return -1;
    }

    activeDirectoryEntryPath = entries[0].relativePath;
    return 0;
}

function navigateDirectoryEntry(direction) {
    const entries = getNavigableDirectoryEntries();
    if (entries.length === 0) {
        return;
    }

    const currentIndex = getActiveDirectoryEntryIndex(entries);
    const nextIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= entries.length) {
        return;
    }

    activeDirectoryEntryPath = entries[nextIndex].relativePath;
    updateChangeToolbarState();
}

function updateDirectoryEntrySelection() {
    const container = getElement('dir-rows');
    container.querySelectorAll('.dir-entry').forEach((row) => {
        row.classList.toggle('is-active-directory-entry', row.dataset.path === activeDirectoryEntryPath);
    });

    if (!activeDirectoryEntryPath) {
        return;
    }

    const activeRow = container.querySelector(`.dir-entry[data-path="${CSS.escape(activeDirectoryEntryPath)}"][data-side-index="0"]`)
        || container.querySelector(`.dir-entry[data-path="${CSS.escape(activeDirectoryEntryPath)}"][data-side-index="1"]`);
    activeRow?.scrollIntoView({ block: 'nearest' });
}

function updateFileNavigationState(fileNavigation, canReturnToDirectory) {
    hostFileNavigation = fileNavigation && typeof fileNavigation === 'object'
        ? fileNavigation
        : null;
    currentFileNavigation = fileNavigation || {
        canGoPrevious: false,
        canGoNext: false
    };

    if (!canReturnToDirectory && !fileNavigation) {
        currentFileNavigation = {
            canGoPrevious: false,
            canGoNext: false
        };
    }
}

function revealActiveDiff(smooth) {
    if (currentMode === MODE_MULTI_WAY) {
        const activePair = getActiveMultiPair();
        if (!activePair || activeDiffIndex < 0) {
            return;
        }

        const block = diffBlocks[activeDiffIndex];
        if (!block) {
            return;
        }

        const leftMultiEditor = multiEditors[activePair.leftIndex];
        const rightMultiEditor = multiEditors[activePair.rightIndex];
        if (!leftMultiEditor || !rightMultiEditor) {
            return;
        }

        revealBlockSide(leftMultiEditor, block.leftStart, block.leftEnd, smooth);
        revealBlockSide(rightMultiEditor, block.rightStart, block.rightEnd, smooth);
        connectorController.scheduleDrawConnections();
        return;
    }

    if (!leftEditor || !rightEditor || activeDiffIndex < 0) {
        return;
    }

    const block = diffBlocks[activeDiffIndex];
    if (!block) {
        return;
    }

    revealBlockSide(leftEditor, block.leftStart, block.leftEnd, smooth);
    revealBlockSide(rightEditor, block.rightStart, block.rightEnd, smooth);
    connectorController.scheduleDrawConnections();
}

function revealBlockSide(editor, start, end, smooth) {
    const model = editor.getModel();
    const lineCount = model?.getLineCount() ?? 0;
    if (lineCount === 0) {
        return;
    }

    const lineNumber = start === end
        ? clamp(start + 1, 1, lineCount)
        : clamp(start + 1, 1, lineCount);
    const reveal = () => editor.revealLineInCenterIfOutsideViewport(
        lineNumber,
        smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? monacoInstance.editor.ScrollType.Smooth
            : monacoInstance.editor.ScrollType.Immediate
    );
    const unfold = editor.getAction('editor.unfold');
    if (!unfold?.isSupported()) {
        reveal();
        return;
    }
    void Promise.resolve(unfold.run({
        selectionLines: [lineNumber - 1],
        levels: Number.MAX_SAFE_INTEGER,
        direction: 'up'
    })).finally(() => {
        reveal();
        connectorController.scheduleDrawConnections();
    });
}

function copyCurrentChange(direction) {
    if (currentMode === MODE_MULTI_WAY) {
        const activeChange = getActiveMultiPanelChange();
        const pairContext = getMultiPairForDirection(direction);
        const activeEditor = getActivePanelEditor();
        if (!activeChange || !pairContext || !activeEditor) {
            return;
        }

        const targetEditor = multiEditors[pairContext.targetPanelIndex];
        const projection = getMultiPairProjection(pairContext.pair, pairContext.activePanelIndex, activeChange);
        if (!targetEditor || !projection) {
            return;
        }

        const sourceLines = getEditorLines(activeEditor).slice(projection.activeStart, projection.activeEnd);
        replaceEditorLines(targetEditor, projection.targetStart, projection.targetEnd, sourceLines);
        clearTimeout(multiRecomputeTimer);
        multiRecomputeTimer = null;
        multiRecomputePendingPanelIds.clear();
        recomputeMultiDiffState();
        return;
    }

    const targetSide = direction === 'left-to-right' ? 'right' : 'left';
    if (currentMode !== MODE_TWO_WAY || !isSideEditable(targetSide) || activeDiffIndex < 0) {
        return;
    }

    const block = diffBlocks[activeDiffIndex];
    if (!block || !leftEditor || !rightEditor) {
        return;
    }

    const sourceEditor = direction === 'left-to-right' ? leftEditor : rightEditor;
    const targetEditor = direction === 'left-to-right' ? rightEditor : leftEditor;
    const sourceStart = direction === 'left-to-right' ? block.leftStart : block.rightStart;
    const sourceEnd = direction === 'left-to-right' ? block.leftEnd : block.rightEnd;
    const targetStart = direction === 'left-to-right' ? block.rightStart : block.leftStart;
    const targetEnd = direction === 'left-to-right' ? block.rightEnd : block.leftEnd;
    const sourceLines = getEditorLines(sourceEditor).slice(sourceStart, sourceEnd);

    replaceEditorLines(targetEditor, targetStart, targetEnd, sourceLines);
    scheduleRecompute();
    connectorController.scheduleDrawConnections();
}

function getEditorLines(editor) {
    const value = editor.getValue().replace(/\r\n/g, '\n');
    if (value.length === 0) {
        return [];
    }

    const lines = value.split('\n');
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

function replaceEditorLines(editor, start, end, replacementLines) {
    const model = editor.getModel();
    if (!model) {
        return;
    }

    const lineCount = model.getLineCount();
    const isEmptyModel = lineCount === 1 && model.getValue().length === 0;
    const effectiveLineCount = isEmptyModel ? 0 : lineCount;
    const safeStart = clamp(start, 0, effectiveLineCount);
    const safeEnd = clamp(end, safeStart, effectiveLineCount);
    const replacementText = replacementLines.join('\n');
    let range;
    let text;

    if (safeStart === safeEnd) {
        if (replacementLines.length === 0) {
            return;
        }

        if (isEmptyModel) {
            range = new monacoInstance.Range(1, 1, 1, 1);
            text = replacementText;
        } else if (safeStart >= lineCount) {
            const lastColumn = model.getLineMaxColumn(lineCount);
            range = new monacoInstance.Range(lineCount, lastColumn, lineCount, lastColumn);
            text = `\n${replacementText}`;
        } else {
            range = new monacoInstance.Range(safeStart + 1, 1, safeStart + 1, 1);
            text = `${replacementText}\n`;
        }
    } else if (safeEnd < lineCount) {
        range = new monacoInstance.Range(safeStart + 1, 1, safeEnd + 1, 1);
        text = replacementLines.length > 0 ? `${replacementText}\n` : '';
    } else {
        range = new monacoInstance.Range(safeStart + 1, 1, lineCount, model.getLineMaxColumn(lineCount));
        text = replacementText;
    }

    editor.executeEdits('bygone-copy-change', [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
}

function initializeDirectoryViewEvents() {
    const container = getElement('dir-rows');
    const clearRelatedRows = () => {
        container.querySelectorAll('.dir-entry.is-related-review-path').forEach((row) => {
            row.classList.remove('is-related-review-path');
        });
    };
    const emphasizeRelatedRows = (row) => {
        clearRelatedRows();
        if (!(row instanceof Element)) {
            return;
        }
        const path = row.getAttribute('data-path');
        const relatedPath = row.getAttribute('data-related-path');
        if (!path || !relatedPath) {
            return;
        }
        container.querySelectorAll('.dir-entry[data-path]').forEach((candidate) => {
            const candidatePath = candidate.getAttribute('data-path');
            if (candidatePath === path || candidatePath === relatedPath) {
                candidate.classList.add('is-related-review-path');
            }
        });
    };
    container.addEventListener('pointerover', (event) => {
        emphasizeRelatedRows(event.target instanceof Element ? event.target.closest('.dir-entry') : null);
    });
    container.addEventListener('pointerleave', clearRelatedRows);
    container.addEventListener('focusin', (event) => {
        emphasizeRelatedRows(event.target instanceof Element ? event.target.closest('.dir-entry') : null);
    });
    container.addEventListener('focusout', (event) => {
        if (!container.contains(event.relatedTarget)) {
            clearRelatedRows();
        }
    });
    container.addEventListener('bygone:directory-layout-change', () => {
        syncDirectoryColumnsFromActive();
        updateDirectoryEntrySelection();
        connectorController.scheduleDrawConnections();
    });
    container.addEventListener('bygone:directory-open-entry', (event) => {
        const relativePath = event.detail?.relativePath;
        if (typeof relativePath !== 'string') {
            return;
        }

        activeDirectoryEntryPath = relativePath;
        updateChangeToolbarState();
        host.postMessage({
            type: 'openDirectoryEntry',
            relativePath
        });
    });

    container.addEventListener('click', (event) => {
        const row = event.target instanceof Element ? event.target.closest('.dir-entry[data-is-dir="false"]') : null;
        const relativePath = row?.getAttribute('data-path');
        if (!relativePath || relativePath === activeDirectoryEntryPath) {
            return;
        }

        activeDirectoryEntryPath = relativePath;
        updateChangeToolbarState();
    });

    const dirView = getElement(VIEW_IDS.directory);
    if (dirView) {
        dirView.addEventListener('click', (event) => {
            const target = event.target instanceof Element
                ? event.target.closest('[data-dir-add-side], [data-dir-remove-side]')
                : null;
            if (!target || target.disabled) {
                return;
            }

            const addSide = target.getAttribute('data-dir-add-side');
            if (addSide === 'left' || addSide === 'right') {
                event.stopPropagation();
                const sideIndexAttr = target.getAttribute('data-side-index');
                const sideIndex = Number.parseInt(sideIndexAttr || '', 10);
                host.postMessage({
                    type: 'dirAddColumn',
                    side: addSide,
                    sideIndex: Number.isInteger(sideIndex) ? sideIndex : null
                });
                return;
            }

            const removeAttr = target.getAttribute('data-dir-remove-side');
            if (removeAttr !== null) {
                event.stopPropagation();
                const sideIndex = Number.parseInt(removeAttr, 10);
                if (Number.isInteger(sideIndex)) {
                    host.postMessage({
                        type: 'dirRemoveColumn',
                        sideIndex
                    });
                }
            }
        });
    }
}

function attachDirectoryScrollSync() {
    const container = getElement('dir-rows');
    container.querySelectorAll('.dir-column').forEach((column) => {
        column.addEventListener('scroll', () => handleDirectoryColumnScroll(column));
    });
}

function handleDirectoryColumnScroll(sourceColumn) {
    if (suppressDirectoryScrollSync) {
        connectorController.scheduleDrawConnections();
        return;
    }

    synchronizeDirectoryScroll(sourceColumn);
    connectorController.scheduleDrawConnections();
}

function getDirectoryColumns() {
    return Array.from(getElement('dir-rows').querySelectorAll('.dir-column'));
}

function resetDirectoryScrollPositions() {
    suppressDirectoryScrollSync = true;
    getDirectoryColumns().forEach((column) => {
        column.scrollTop = 0;
        column.scrollLeft = 0;
    });
    suppressDirectoryScrollSync = false;
}

function syncDirectoryColumnsFromActive() {
    const columns = getDirectoryColumns();
    if (columns.length < 2) {
        return;
    }

    const sourceColumn = columns.find((column) => column.scrollTop > 0) || columns[0];
    synchronizeDirectoryScroll(sourceColumn);
}

function synchronizeDirectoryScroll(sourceColumn) {
    const columns = getDirectoryColumns();
    if (columns.length < 2) {
        return;
    }

    const sourceSideIndex = Number.parseInt(sourceColumn.getAttribute('data-side-index') || '', 10);
    if (!Number.isInteger(sourceSideIndex)) {
        return;
    }

    const sourceMap = buildDirectoryScrollMap(sourceColumn, sourceSideIndex);
    if (sourceMap.points.length === 0) {
        return;
    }
    const globalPosition = directoryScrollTopToGlobalPosition(sourceColumn.scrollTop, sourceMap);

    suppressDirectoryScrollSync = true;
    for (const targetColumn of columns) {
        if (targetColumn === sourceColumn) {
            continue;
        }
        const targetSideIndex = Number.parseInt(targetColumn.getAttribute('data-side-index') || '', 10);
        if (!Number.isInteger(targetSideIndex)) {
            continue;
        }
        const targetMap = buildDirectoryScrollMap(targetColumn, targetSideIndex);
        if (targetMap.points.length === 0) {
            continue;
        }
        targetColumn.scrollTop = globalPositionToDirectoryScrollTop(globalPosition, targetMap, targetColumn);
    }
    suppressDirectoryScrollSync = false;
}

function buildDirectoryScrollMap(column, sideIndex) {
    const rows = Array.from(column.querySelectorAll('.dir-entry'))
        .filter((row) => row.offsetParent !== null)
        .map((row) => {
            const relativePath = row.getAttribute('data-path');
            const globalIndex = directoryEntries.findIndex((entry) => entry.relativePath === relativePath && directoryEntryExistsOnSide(entry, sideIndex));
            return {
                globalIndex,
                top: row.offsetTop,
                height: row.offsetHeight
            };
        })
        .filter((point) => point.globalIndex >= 0);

    const points = rows.map((row) => ({
        position: row.globalIndex,
        top: row.top
    }));

    const lastRow = rows[rows.length - 1];
    if (lastRow) {
        points.push({
            position: lastRow.globalIndex + 1,
            top: lastRow.top + lastRow.height
        });
    }

    return { points };
}

function directoryEntryExistsOnSide(entry, sideIndex) {
    if (Array.isArray(entry.sides)) {
        return Boolean(entry.sides[sideIndex]);
    }

    return sideIndex === 0
        ? entry.status !== 'right-only'
        : entry.status !== 'left-only';
}

function directoryScrollTopToGlobalPosition(scrollTop, map) {
    const points = map.points;
    if (points.length === 0) {
        return 0;
    }

    if (points.length === 1 || scrollTop <= points[0].top) {
        return points[0].position;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        if (scrollTop <= next.top) {
            const span = Math.max(1, next.top - current.top);
            const fraction = (scrollTop - current.top) / span;
            return current.position + ((next.position - current.position) * fraction);
        }
    }

    return points[points.length - 1].position;
}

function globalPositionToDirectoryScrollTop(globalPosition, map, column) {
    const points = map.points;
    if (points.length === 0) {
        return 0;
    }

    if (points.length === 1 || globalPosition <= points[0].position) {
        return 0;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        if (globalPosition <= next.position) {
            const span = Math.max(0.0001, next.position - current.position);
            const fraction = (globalPosition - current.position) / span;
            return clamp(current.top + ((next.top - current.top) * fraction), 0, Math.max(0, column.scrollHeight - column.clientHeight));
        }
    }

    return Math.max(0, column.scrollHeight - column.clientHeight);
}

function initializeStandaloneDropTarget() {
    if (host.environment !== 'standalone') {
        return;
    }

    window.addEventListener('dragover', (event) => {
        event.preventDefault();
        document.body.classList.add('drag-active');
    });

    window.addEventListener('dragleave', (event) => {
        if (event.relatedTarget === null) {
            document.body.classList.remove('drag-active');
        }
    });

    window.addEventListener('drop', (event) => {
        event.preventDefault();
        document.body.classList.remove('drag-active');

        const paths = Array.from(event.dataTransfer?.files || [])
            .map((file) => host.getPathForFile?.(file))
            .filter((filePath) => typeof filePath === 'string' && filePath.length > 0);

        if (paths.length === 0) {
            return;
        }

        host.postMessage({
            type: 'openDroppedFiles',
            paths
        });
    });
}

function updateHistoryToolbar(history) {
    const toolbar = getElement('history-toolbar');
    const backButton = getElement('history-back');
    const forwardButton = getElement('history-forward');
    const stagedButton = getElement('history-toggle-staged');
    const skipUnchangedButton = getElement('history-toggle-skip-unchanged');

    if (!history) {
        toolbar.hidden = true;
        clearHistoryToolbar();
        stagedButton.setAttribute('aria-pressed', 'false');
        stagedButton.classList.remove('is-active');
        skipUnchangedButton.setAttribute('aria-pressed', 'false');
        skipUnchangedButton.classList.remove('is-active');
        return;
    }

    toolbar.hidden = false;
    backButton.disabled = !history.canGoBack;
    forwardButton.disabled = !history.canGoForward;
    stagedButton.setAttribute('aria-pressed', history.includeStaged ? 'true' : 'false');
    stagedButton.classList.toggle('is-active', Boolean(history.includeStaged));
    skipUnchangedButton.setAttribute('aria-pressed', history.skipUnchanged ? 'true' : 'false');
    skipUnchangedButton.classList.toggle('is-active', Boolean(history.skipUnchanged));
    setTextContent('history-position', history.positionLabel);
    setTextContent('history-left-commit', history.leftCommitLabel);
    setTextContent('history-left-time', history.leftTimestamp);
    setTextContent('history-right-commit', history.rightCommitLabel);
    setTextContent('history-right-time', history.rightTimestamp);
}

function updateDirectoryTreeToolbar() {
    getElement('directory-tree-toolbar').hidden = currentMode !== 'directory';
}

function updateNavigationRail(historyRail, kind) {
    historyRailState = historyRail;
    historyRailKind = historyRail ? kind : null;
    hasDirectoryNavigation = historyRailKind === 'directory';

    if (hasDirectoryNavigation && historyRailState) {
        const activeItem = Object.values(historyRailState.itemsByTab || {})
            .flat()
            .find((item) => item.active && item.relativePath);
        if (activeItem) {
            activeDirectoryEntryPath = activeItem.relativePath;
        }
    }

    if (!historyRail) {
        activeHistoryRailTabId = null;
        renderHistoryRail();
        return;
    }

    if (!activeHistoryRailTabId || !historyRail.tabs.some((tab) => tab.id === activeHistoryRailTabId)) {
        activeHistoryRailTabId = historyRail.activeTabId || historyRail.tabs[0]?.id || null;
    }

    renderHistoryRail();
    updateDirectorySidebarToggle();
}

function renderHistoryRail() {
    const rail = getElement('history-rail');
    const container = getElement('container');
    const showButton = getElement('show-navigation-sidebar');
    const railAvailable = Boolean(historyRailState);
    const railRequested = railAvailable
        && !navigationRailCollapsed
        && !(historyRailKind === 'directory' && !directoryRailVisible);

    if (!railRequested) {
        rail.hidden = true;
        rail.classList.add('hidden');
        rail.innerHTML = '';
        container.classList.remove('history-rail-visible');
        showButton.hidden = !railAvailable;
        return;
    }

    const tabs = historyRailState.tabs || [];
    const activeTabId = activeHistoryRailTabId || historyRailState.activeTabId || tabs[0]?.id || null;
    const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
    const items = activeTab ? (historyRailState.itemsByTab[activeTab.id] || []) : [];

    rail.hidden = false;
    rail.classList.remove('hidden');
    showButton.hidden = true;
    container.classList.add('history-rail-visible');
    rail.innerHTML = [
        '<div class="history-rail-controls">',
        `<span>${historyRailKind === 'directory' ? 'Files' : 'History'}</span>`,
        '<button class="history-rail-collapse" type="button" title="Hide navigation sidebar" aria-label="Hide navigation sidebar" data-rail-collapse>‹</button>',
        '</div>',
        '<div class="history-rail-tabs">',
        ...tabs.map((tab) => {
            const isActive = tab.id === (activeTab?.id || null);
            return `<button class="history-rail-tab${isActive ? ' active' : ''}" type="button" title="Show ${escapeAttr(tab.label)}" data-rail-tab="${escapeAttr(tab.id)}">${escapeHtml(tab.label)}</button>`;
        }),
        '</div>',
        '<div class="history-rail-list">',
        ...(items.length > 0
            ? items.map((item, index) => renderHistoryRailItem(item, activeTab?.id || '', index))
            : ['<div class="history-rail-empty">No entries</div>']),
        '</div>',
        `<div class="history-rail-resizer" role="separator" aria-label="Resize navigation sidebar" title="Resize navigation sidebar (Left/Right; Home/End)" aria-orientation="vertical" aria-valuemin="${NAVIGATION_SIDEBAR_MIN_WIDTH}" aria-valuemax="${maximumNavigationSidebarWidth()}" aria-valuenow="${navigationRailWidth}" tabindex="0" data-rail-resizer></div>`
    ].join('');
}

function maximumNavigationSidebarWidth() {
    return Math.max(NAVIGATION_SIDEBAR_MIN_WIDTH, Math.min(NAVIGATION_SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.6)));
}

function setNavigationSidebarWidth(width) {
    navigationRailWidth = clamp(Math.round(width), NAVIGATION_SIDEBAR_MIN_WIDTH, maximumNavigationSidebarWidth());
    applyNavigationSidebarWidth();
    getElement('history-rail').querySelector('[data-rail-resizer]')?.setAttribute('aria-valuenow', String(navigationRailWidth));
    resizeDiffWorkspace();
}

function applyNavigationSidebarWidth() {
    getElement('container').style.setProperty('--history-rail-width', `${navigationRailWidth}px`);
}

function resizeDiffWorkspace() {
    applyFocusedStripLayout(false);
    layoutEditors();
    connectorController.resizeCanvas();
    connectorController.scheduleDrawConnections();
}

function readStoredSidebarWidth(key, fallback, minimum, maximum) {
    const stored = Number.parseInt(window.localStorage.getItem(key) || '', 10);
    return Number.isFinite(stored) ? clamp(stored, minimum, maximum) : fallback;
}

function storeSidebarWidth(key, width) {
    window.localStorage.setItem(key, String(width));
}

function renderHistoryRailItem(item, tabId, index) {
    const statusClass = item.status ? ` status-${item.status}` : '';
    const marker = item.status ? historyRailStatusGlyph(item.status) : '•';
    const meta = item.meta ? `<span class="history-rail-meta">${escapeHtml(item.meta)}</span>` : '';
    const activeClass = item.active ? ' active' : '';
    const kindAttr = item.kind ? ` data-rail-kind="${escapeAttr(item.kind)}"` : '';
    const indexAttr = Number.isInteger(item.index) ? ` data-rail-index="${String(item.index)}"` : ` data-rail-index="${String(index)}"`;
    const pathAttr = typeof item.relativePath === 'string' ? ` data-rail-path="${escapeAttr(item.relativePath)}"` : '';

    const action = item.kind === 'directory-entry' ? 'Open file' : 'Open history entry';
    return `<button class="history-rail-item${activeClass}${statusClass}" type="button" title="${action}: ${escapeAttr(item.label)}" data-rail-item="true" data-rail-tab="${escapeAttr(tabId)}"${kindAttr}${indexAttr}${pathAttr}>`
        + `<span class="history-rail-marker">${escapeHtml(marker)}</span>`
        + `<span class="history-rail-text">`
        + `<span class="history-rail-label">${escapeHtml(item.label)}</span>`
        + meta
        + `</span>`
        + `</button>`;
}

function getHistoryRailItems(tabId) {
    return historyRailState?.itemsByTab?.[tabId] || [];
}

function historyRailStatusGlyph(status) {
    if (status === 'modified' || status === 'partial') {
        return '±';
    }

    if (status === 'left-only') {
        return '-';
    }

    if (status === 'right-only') {
        return '+';
    }

    return '•';
}

function scrollTopToModelLinePosition(editor, scrollTop) {
    const model = editor.getModel();
    if (!model) {
        return 0;
    }

    const lineCount = model.getLineCount();
    const lineHeight = editor.getOption(monacoInstance.editor.EditorOption.lineHeight);

    // Binary search: find the highest model line whose visual top <= scrollTop.
    // getTopForLineNumber is view-aware and accounts for folded regions.
    let lo = 1;
    let hi = lineCount;

    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (editor.getTopForLineNumber(mid) <= scrollTop) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    const lineTop = editor.getTopForLineNumber(lo);
    const fraction = Math.max(0, scrollTop - lineTop) / lineHeight;
    return lo - 1 + fraction; // 0-based fractional position
}

function modelLinePositionToScrollTop(editor, linePosition) {
    const model = editor.getModel();
    if (!model) {
        return 0;
    }

    const lineCount = model.getLineCount();
    const lineHeight = editor.getOption(monacoInstance.editor.EditorOption.lineHeight);
    const lineIndex = Math.floor(linePosition);
    const fraction = linePosition - lineIndex;
    const lineNumber = clamp(lineIndex + 1, 1, lineCount);

    return editor.getTopForLineNumber(lineNumber) + fraction * lineHeight;
}

function mapScrollTopBetweenEditors(sourceEditor, targetEditor) {
    const sourceSide = sourceEditor === leftEditor ? 'left' : 'right';
    const targetSide = sourceSide === 'left' ? 'right' : 'left';
    const sourceLineCount = sourceEditor.getModel()?.getLineCount() ?? 0;
    const targetLineCount = targetEditor.getModel()?.getLineCount() ?? 0;

    if (sourceLineCount === 0 || targetLineCount === 0 || currentDiffRows.length === 0 || !scrollMaps) {
        return getScrollRatio(sourceEditor.getScrollTop(), sourceEditor.getScrollHeight() - sourceEditor.getLayoutInfo().height)
            * Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);
    }

    const sourceMaps = scrollMaps[sourceSide];
    const targetMaps = scrollMaps[targetSide];
    const sourceLinePosition = clamp(
        scrollTopToModelLinePosition(sourceEditor, sourceEditor.getScrollTop()),
        0,
        sourceLineCount
    );
    const alignedRowPosition = linePositionToRowPosition(sourceLinePosition, sourceMaps, currentDiffRows.length);
    const targetLinePosition = rowPositionToLinePosition(alignedRowPosition, targetMaps, currentDiffRows.length);
    const maxTargetScrollTop = Math.max(0, targetEditor.getScrollHeight() - targetEditor.getLayoutInfo().height);

    return clamp(modelLinePositionToScrollTop(targetEditor, targetLinePosition), 0, maxTargetScrollTop);
}

function buildScrollMaps(rows, side) {
    const lineToRow = [];
    const boundaryCounts = new Array(rows.length + 1).fill(0);
    let seenLines = 0;

    rows.forEach((row, index) => {
        const cell = row[side];
        boundaryCounts[index] = seenLines;

        if (cell.kind !== 'placeholder' && cell.lineNumber !== null) {
            lineToRow[cell.lineNumber - 1] = index;
            seenLines++;
        }
    });

    boundaryCounts[rows.length] = seenLines;

    return {
        lineToRow,
        boundaryCounts
    };
}

function linePositionToRowPosition(linePosition, maps, rowCount) {
    const lineIndex = Math.floor(linePosition);
    const fraction = linePosition - lineIndex;

    if (lineIndex >= maps.lineToRow.length) {
        return rowCount;
    }

    const rowIndex = maps.lineToRow[lineIndex];
    if (rowIndex === undefined) {
        return rowCount;
    }

    return clamp(rowIndex + fraction, 0, rowCount);
}

function rowPositionToLinePosition(rowPosition, maps, rowCount) {
    if (rowPosition >= rowCount) {
        return maps.boundaryCounts[rowCount];
    }

    const rowIndex = Math.floor(rowPosition);
    const fraction = rowPosition - rowIndex;
    const currentCount = maps.boundaryCounts[rowIndex];
    const nextCount = maps.boundaryCounts[rowIndex + 1];

    if (nextCount === currentCount) {
        return currentCount;
    }

    return currentCount + fraction;
}

function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = window.setTimeout(() => {
        if (!leftEditor || !rightEditor) {
            return;
        }

        host.postMessage({
            type: 'recomputeDiff',
            leftContent: leftEditor.getValue(),
            rightContent: rightEditor.getValue()
        });
    }, 120);
}

function initializeDiffWorker() {
    if (diffWorker) {
        return;
    }
    try {
        diffWorker = new Worker('diff.worker.js');
    } catch {
        diffWorker = null;
        return;
    }
    diffWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        const pending = diffPendingRequests.get(data.id);
        if (!pending) {
            return;
        }
        diffPendingRequests.delete(data.id);
        if (data.error) {
            pending.reject(new Error(data.error));
        } else {
            pending.resolve(data.model);
        }
    });
    diffWorker.addEventListener('error', () => {
        // Keep expensive model construction off the UI thread if the worker fails.
        for (const pending of diffPendingRequests.values()) {
            pending.reject(new Error('diff worker error'));
        }
        diffPendingRequests.clear();
        diffWorker = null;
    });
}

function requestDiffAsync(leftContent, rightContent) {
    if (!diffWorker) {
        return Promise.reject(new Error('diff worker unavailable'));
    }
    const id = ++diffRequestIdCounter;
    return new Promise((resolve, reject) => {
        diffPendingRequests.set(id, { resolve, reject });
        diffWorker.postMessage({ id, leftContent, rightContent });
    });
}

function beginDiffJob() {
    pendingDiffJobs += 1;
    updateDiffJobStatus();
}

function endDiffJob() {
    pendingDiffJobs = Math.max(0, pendingDiffJobs - 1);
    updateDiffJobStatus();
}

function updateDiffJobStatus() {
    const banner = getElement('status-banner');
    if (!banner) {
        return;
    }
    if (pendingDiffJobs > 0) {
        banner.textContent = 'Computing diff…';
        banner.hidden = false;
    } else if (banner.textContent === 'Computing diff…') {
        banner.textContent = '';
        banner.hidden = true;
    }
}

function scheduleMultiRecompute(changedPanelId) {
    if (changedPanelId) {
        multiRecomputePendingPanelIds.add(changedPanelId);
    }
    clearTimeout(multiRecomputeTimer);
    multiRecomputeTimer = window.setTimeout(() => {
        const panelIds = new Set(multiRecomputePendingPanelIds);
        multiRecomputePendingPanelIds.clear();
        recomputeMultiDiffState(panelIds.size > 0 ? panelIds : null);
    }, 120);
}

function layoutEditors(scrollSnapshot = null) {
    const previousSuppression = suppressEditorEvents;
    if (scrollSnapshot) suppressEditorEvents = true;
    try {
        leftEditor?.layout();
        rightEditor?.layout();
        multiEditors.forEach((editor) => editor.layout());
        restoreEditorScrollSnapshot(scrollSnapshot);
    } finally {
        suppressEditorEvents = previousSuppression;
    }
}

function captureWorkspaceResizeScrollSnapshot() {
    const editors = [leftEditor, rightEditor, ...multiEditors]
        .filter(Boolean)
        .map((editor) => ({
            editor,
            scrollTop: editor.getScrollTop(),
            scrollLeft: editor.getScrollLeft()
        }));
    const elements = Array.from(document.querySelectorAll('.dir-column, .binary-preview-host'))
        .map((element) => ({
            element,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft
        }));
    return { editors, elements };
}

function restoreWorkspaceResizeScrollSnapshot() {
    if (!workspaceResizeScrollSnapshot) return;
    const previousSuppression = suppressEditorEvents;
    suppressEditorEvents = true;
    try {
        restoreEditorScrollSnapshot(workspaceResizeScrollSnapshot.editors);
        workspaceResizeScrollSnapshot.elements.forEach(({ element, scrollTop, scrollLeft }) => {
            if (element.isConnected) {
                element.scrollTop = scrollTop;
                element.scrollLeft = scrollLeft;
            }
        });
    } finally {
        suppressEditorEvents = previousSuppression;
    }
}

function restoreEditorScrollSnapshot(snapshot) {
    snapshot?.forEach(({ editor, scrollTop, scrollLeft }) => {
        editor.setScrollTop(scrollTop, monacoInstance.editor.ScrollType.Immediate);
        editor.setScrollLeft(scrollLeft, monacoInstance.editor.ScrollType.Immediate);
    });
}

function getScrollRatio(value, extent) {
    if (extent <= 0) {
        return 0;
    }

    return value / extent;
}

function resetTwoWayScrollPositions() {
    leftEditor?.setScrollTop(0);
    leftEditor?.setScrollLeft(0);
    rightEditor?.setScrollTop(0);
    rightEditor?.setScrollLeft(0);
}

function resetMultiScrollPositions() {
    multiEditors.forEach((editor) => {
        editor.setScrollTop(0);
        editor.setScrollLeft(0);
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function createHostBridge() {
    if (window.__BYGONE_HOST__) {
        return {
            ...window.__BYGONE_HOST__,
            onMessage(handler) {
                window.addEventListener('bygone:host-message', (event) => handler(event.detail));
                window.addEventListener('message', (event) => {
                    if (!event?.data || typeof event.data !== 'object' || !('__bygoneHostMessage' in event.data)) {
                        return;
                    }

                    handler(event.data.__bygoneHostMessage);
                });
            }
        };
    }

    const vscodeApi = acquireVsCodeApi();
    return {
        environment: 'vscode',
        editorWorkerUrl: window.__BYGONE_EDITOR_WORKER_URL__,
        postMessage(message) {
            vscodeApi.postMessage(message);
        },
        onMessage(handler) {
            window.addEventListener('message', (event) => handler(event.data));
        }
    };
}
