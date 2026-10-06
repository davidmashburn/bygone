import { createTourImageViewer } from './tourImage.js';
import { parseDocumentFragment, resolveDocumentFocus, serializeDocumentFragment, serializeDeepLink } from '../src/deepLink.ts';
import { createExportHistory } from './exportHistory.js';
import { buildTwoWayDiffModel } from '../src/diffEngine.ts';
import { createJavaScriptSampleFilePair } from '../src/sampleFiles.ts';
import { parseChangeTourManifest } from '../src/changeTourManifest.ts';
import {
    classifyMultiPanelFile,
    getLinearTourTarget,
    getMultiPanelChangedFileTarget,
    getTourFileTarget,
    resolveTourPosition
} from '../src/tourNavigation.ts';
import { buildTourNarrationUnit } from '../src/tourNarration.ts';
import { buildTourReadingItems, getTourReadingTarget, resolveTourReadingItem } from '../src/tourReading.ts';
import { TourNarrationController } from '../src/tourNarrationPlayback.ts';
import { searchTour } from '../src/tourSearch.ts';
import {
    buildStackedTourAnnotations,
    buildWalkthroughTourAnnotations,
    getFirstChangeSourceRange
} from '../src/tourAnnotations.ts';
import { buildTourWindowTitle } from '../src/windowTitle.ts';
import { buildTourDirectoryEvidence } from '../src/tourDirectoryEvidence.ts';
import { TourZoomSession } from '../src/tourZoomSession.ts';
import { normalizeTourComparisonSelection } from '../src/tourComparison.ts';
import { createWorkspaceControls } from '../media/workspaceControls.js';
import { renderTourProse } from '../media/tourProse.js';

(function initializeWebHost() {
    const imageViewer = createTourImageViewer();
    const exportData = window.__BYGONE_EXPORT__;
    const exportHistory = exportData ? createExportHistory(exportData) : null;
    const preferences = {
        getItem(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
        setItem(key, value) { try { window.localStorage.setItem(key, value); } catch { /* Optional preference. */ } },
        removeItem(key) { try { window.localStorage.removeItem(key); } catch { /* Optional preference. */ } }
    };
    let applyingDocumentLocation = false;
    let documentLocationReady = false;
    let documentNavigationId = 0;
    let documentNavigationQueue = Promise.resolve();
    let zoomSwitchQueue = Promise.resolve();
    const TOUR_SIDEBAR_STORAGE_KEY = 'bygone.tourSidebarWidth';
    const TOUR_SIDEBAR_MIN_WIDTH = 240;
    const TOUR_SIDEBAR_MAX_WIDTH = 600;
    const TOUR_NARRATIVE_STORAGE_KEY = 'bygone.tourNarrativeHeight';
    const TOUR_NARRATIVE_MIN_HEIGHT = 180;
    const TOUR_DIFF_MIN_HEIGHT = 180;
    const TOUR_NARRATION_VOICE_STORAGE_KEY = 'bygone.tourNarrationVoice';
    const TOUR_NARRATION_RATE_STORAGE_KEY = 'bygone.tourNarrationRate';
    const NARRATION_RATES = new Set([0.75, 1, 1.25, 1.5]);
    const deviceNarrationAvailable = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const state = {
        mode: 'empty',
        left: null,
        right: null,
        comparisonId: 0,
        tour: null,
        authoredTour: null,
        zoom: null,
        zoomSwitching: false,
        historyCommit: null,
        historyEntries: [],
        fileHistoryCache: new Map(),
        displayedPanels: [],
        historyPath: null,
        historyPanels: [],
        historyFocus: null,
        historyDiff: null,
        historyChangedFiles: new Set(),
        compare: null,
        comparisonFocus: null,
        comparisonCommits: [],
        comparisonDraftCommits: [],
        activeSceneIndex: -1,
        activeStepIndex: 0,
        sceneIntroVisible: false,
        narrativeParent: null,
        readingKey: 'title',
        directoryEvidence: null,
        activeTourFilePath: null,
        tourFocusFilePath: null,
        tourSidebarWidth: readStoredTourSidebarWidth(),
        tourSidebarHidden: false,
        tourNarrativeHeight: readStoredTourNarrativeHeight(),
        tourNavigatorTab: 'tour',
        narrationVoiceURI: preferences.getItem(TOUR_NARRATION_VOICE_STORAGE_KEY) || '',
        narrationRate: readStoredNarrationRate(),
        narrationVoices: [],
        renderedNarrationUnit: null,
        workspacePromptStatus: '',
        historyPrefix: '/history/'
    };
    let workspaceControls = null;
    let workspaceControlsHost = null;
    let readingTour = null;
    let readingItems = [];
    const readingElements = new Map();
    const collapsedOutline = new Set();
    let programmaticReadingScroll = null;
    let readingScrollFrame = null;
    const embeddedWorkspaceMode = new URLSearchParams(window.location.search).get('workspaceEmbedded') === '1';
    let pendingEmbeddedWorkspaceMode = null;
    const narrationController = new TourNarrationController(createDeviceSpeechEngine(), {
        claimAudio: claimNarrationAudio,
        onStateChange: renderNarrationPlaybackState,
        onSegmentChange: renderNarrationHighlight,
        canNavigateUnit: canNavigateNarrationUnit,
        navigateUnit: navigateNarrationUnit
    });

    window.__BYGONE_HOST__ = {
        environment: 'web',
        linkPreviews: !exportData,
        editorWorkerUrl: exportData?.workers.editor || '/media/editor.worker.js',
        diffWorkerUrl: exportData?.workers.diff || '/media/diff.worker.js',
        postMessage(message) {
            void handleRendererMessage(message);
        }
    };

    // Native workspace controls may embed this presenter as a read-only tour.
    // Keep this bridge deliberately narrow: a file-origin parent can select an
    // authored mode, but it cannot issue presenter commands or acquire a host
    // bridge through postMessage.
    window.addEventListener('message', (event) => {
        if (!embeddedWorkspaceMode || event.source !== window.parent || event.origin !== 'null') return;
        const message = event.data;
        if (!message || typeof message !== 'object' || message.type !== 'bygoneWorkspaceTourMode') return;
        if (message.mode !== 'historical' && message.mode !== 'deconstructed') return;
        pendingEmbeddedWorkspaceMode = message.mode;
        if (!state.zoom || state.zoom.mode === message.mode || !availableModes().includes(message.mode)) return;
        void switchZoomMode(message.mode).catch(reportModeError);
    });

    function initializeControls() {
        bindControls();
        if (embeddedWorkspaceMode) {
            const tabs = document.getElementById('tour-mode-tabs');
            const description = document.getElementById('tour-mode-description');
            if (tabs) tabs.hidden = true;
            if (description) description.hidden = true;
        }
        setStatus('Browser host ready.');
    }
    if (document.readyState !== 'loading') queueMicrotask(initializeControls);
    else window.addEventListener('DOMContentLoaded', initializeControls, { once: true });

    function emit(message) {
        if (message.type === 'showDiff' || message.type === 'showMultiDiff' || message.type === 'showDirectoryDiff') {
            imageViewer.clear();
            message = { ...message, renderRequestId: ++renderRequestId };
            if (state.mode === 'tour') {
                state.displayedPanels = message.type === 'showMultiDiff' ? message.panels
                    : twoWayCommitPanels();
                if (!message.history) message.history = sharedCommitHistory();
                renderWorkspaceControls();
            }
            if (zoomRestore) zoomRestoreRequestId = message.renderRequestId;
        }
        window.dispatchEvent(new window.CustomEvent('bygone:host-message', {
            detail: message
        }));
    }

    let navigationRequestId = 0;
    const navigationRequests = new Map();
    let zoomRestore = null;
    let renderRequestId = 0;
    let zoomRestoreRequestId = null;

    function cancelPendingModeRestore() {
        if (!state.zoomSwitching) {
            zoomRestore = null;
        }
    }

    function captureZoomLocation() {
        return new Promise((resolve) => {
            const requestId = ++navigationRequestId;
            const finish = (navigation) => {
                navigationRequests.delete(requestId);
                const scene = state.tour?.scenes[state.activeSceneIndex];
                const panel = navigation?.activeMultiPairIndex;
                const definitions = scene && isMultiPanelTourScene(scene) ? getMultiPanelDefinitions(scene) : [];
                const editor = navigation?.editorStates?.[navigation.activeMultiPanelId || navigation.activePaneSide];
                resolve({
                    sceneIndex: state.activeSceneIndex,
                    stepIndex: state.activeStepIndex,
                    path: state.activeTourFilePath,
                    line: editor?.selection?.startLineNumber,
                    commit: (state.zoom?.mode === 'history' ? state.historyCommit : definitions[panel + 1]?.oid) || state.authoredTour.range.headOid,
                    navigation,
                    focusId: document.activeElement?.id,
                    narrativeParent: state.narrativeParent,
                    sceneIntroVisible: state.sceneIntroVisible,
                    narrativeScroll: document.getElementById('tour-narrative-content')?.scrollTop || 0,
                    readingKey: state.readingKey,
                    navigatorTab: state.tourNavigatorTab
                });
            };
            const timer = window.setTimeout(() => finish(null), 1000);
            navigationRequests.set(requestId, (navigation) => { window.clearTimeout(timer); finish(navigation); });
            emit({ type: 'captureNavigationState', requestId });
        });
    }

    let evidenceRequest = 0;

    function legacyFinalTour(tour = state.authoredTour) {
        if (tour.tours || !tour.scenes.some((scene) => scene.kind === 'deconstructed-diff')) return null;
        const final = tour.zoom?.final;
        return final?.scenes.some((scene) => scene.kind === 'walkthrough') ? final : null;
    }

    // Keep the legacy labels available for older host markup and diagnostics;
    // the shared strip owns the visible labels and missing-tour affordance.
    const modeLabels = {
        history: 'History', compare: 'Compare', historical: 'Historical tour', deconstructed: 'Deconstructed tour'
    };
    const modeDescriptions = {
        history: 'Explore commits and choose revisions to compare.',
        compare: 'Inspect the changes between selected revisions.',
        historical: 'Actual revisions, with explanations of updates, reversals, and decisions.',
        deconstructed: 'The change broken into constructed stages for explanation.'
    };

    function modeLabel(mode) {
        return mode === 'historical' && legacyFinalTour() ? 'Final tour' : modeLabels[mode];
    }

    function modeDescription(mode) {
        return mode === 'historical' && legacyFinalTour()
            ? 'The authored walkthrough of the completed endpoint diff.'
            : modeDescriptions[mode];
    }

    function authoredTours(tour = state.authoredTour) {
        if (tour.tours) return tour.tours;
        // Compatibility for previously compiled manifests. Never turn a generated
        // revision stack with no authored narration into an additional tour.
        const deconstructed = tour.scenes.some((scene) => scene.kind === 'deconstructed-diff');
        if (!deconstructed) return { historical: { scenes: tour.scenes, chapters: tour.chapters } };
        const final = legacyFinalTour(tour);
        return {
            ...(final ? { historical: final } : {}),
            deconstructed: { scenes: tour.scenes, chapters: tour.chapters }
        };
    }

    function availableModes() {
        return [
            ...(supportsWorkspaceHistory() ? ['history'] : []),
            ...(exportData || supportsWorkspaceHistory() ? ['compare'] : []),
            ...Object.keys(authoredTours()).filter((mode) => authoredTours()[mode])
        ];
    }

    function supportsWorkspaceHistory(tour = state.authoredTour) {
        return exportData ? exportData.profile === 'full' : Number(tour?.version) >= 2;
    }

    function workspaceHistoryUnavailableReason() {
        if (exportData) return 'Git history is not included in this Minimal export.';
        return 'History is unavailable for legacy v1 tours; open a version 2 tour to browse commit history.';
    }

    function workspaceCompareUnavailableReason() {
        return 'Compare is unavailable for legacy v1 tours because this tour has no history backend.';
    }

    function ensureWorkspaceControls() {
        if (workspaceControls) return;
        const controls = document.getElementById('tour-mode-controls');
        if (!controls) return;
        const legacyTabs = document.getElementById('tour-mode-tabs');
        const legacyDescription = document.getElementById('tour-mode-description');
        const legacyStatus = document.getElementById('tour-mode-status');
        // Keep the legacy nodes for host status and old markup compatibility,
        // but let the shared control own the mode strip and missing-tour help.
        if (legacyTabs) legacyTabs.hidden = true;
        if (legacyDescription) legacyDescription.hidden = true;
        if (legacyStatus) legacyStatus.hidden = true;
        workspaceControlsHost = document.createElement('div');
        workspaceControlsHost.id = 'workspace-mode-controls';
        controls.prepend(workspaceControlsHost);
        workspaceControls = createWorkspaceControls({
            container: workspaceControlsHost,
            send: handleWorkspaceControlMessage
        });
    }

    function handleWorkspaceControlMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'workspaceMode'
            && ['history', 'compare', 'historical', 'deconstructed'].includes(message.mode)) {
            void switchZoomMode(message.mode).catch(reportModeError);
            return;
        }
        if (message.type === 'workspaceOpenTour'
            && (message.kind === 'historical' || message.kind === 'deconstructed')) {
            openExistingTourUpload();
        }
    }

    function renderWorkspaceControls() {
        if (!state.zoom) return;
        ensureWorkspaceControls();
        if (!workspaceControls) return;
        workspaceControlsHost.hidden = embeddedWorkspaceMode;
        const legacyTabs = document.getElementById('tour-mode-tabs');
        const legacyDescription = document.getElementById('tour-mode-description');
        if (legacyTabs) legacyTabs.dataset.workspaceModeLabel = modeLabel(state.zoom.mode);
        if (legacyDescription) legacyDescription.textContent = modeDescription(state.zoom.mode);
        const historyAvailable = supportsWorkspaceHistory();
        workspaceControls.update({
            sessionId: workspaceSessionId(),
            mode: state.zoom.mode,
            modeLabels: { historical: modeLabel('historical') },
            history: {
                enabled: historyAvailable,
                label: 'History',
                ...(historyAvailable ? {} : { reason: workspaceHistoryUnavailableReason() })
            },
            compare: {
                enabled: Boolean(exportData) || historyAvailable,
                label: 'Compare',
                ...(historyAvailable ? {} : { reason: workspaceCompareUnavailableReason() })
            },
            availableTours: Object.keys(authoredTours()).filter((mode) => mode === 'historical' || mode === 'deconstructed'),
            promptContext: buildWorkspacePromptContext(),
            status: state.workspacePromptStatus
        });
        if (exportData) for (const button of workspaceControlsHost.querySelectorAll('[data-workspace-mode]')) {
            if (!availableModes().includes(button.dataset.workspaceMode)) { button.disabled = true; button.title = 'This mode is not included in the export.'; }
        }
    }

    function workspaceSessionId() {
        const tour = state.authoredTour;
        return [
            tour?.repository?.root || '',
            tour?.range?.mergeBaseOid || '',
            tour?.range?.headOid || ''
        ].join('\u0000') || 'browser-workspace';
    }

    function buildWorkspacePromptContext() {
        const tour = state.authoredTour;
        const range = tour?.range;
        const panels = Array.isArray(state.displayedPanels) ? state.displayedPanels : [];
        const panelRevisions = uniqueStrings(panels.map((panel) => panel?.commit));
        const revisions = panels.length > 0
            ? panelRevisions
            : uniqueStrings([range?.mergeBaseOid, range?.headOid]);
        const panelPaths = uniqueStrings(panels.map((panel) => panel?.path));
        const paths = panelPaths.length > 0
            ? panelPaths
            : uniqueStrings(state.tour?.files?.map((file) => file?.path));
        const rangeStatus = classifyWorkspaceRange(revisions, tour);
        return {
            ...(typeof tour?.repository?.root === 'string' ? { repository: tour.repository.root } : {}),
            ...(paths.length > 0 ? { paths } : {}),
            ...(revisions.length > 0 ? { revisions } : {}),
            rangeStatus: rangeStatus.status,
            ...(rangeStatus.reason ? { reason: rangeStatus.reason } : {})
        };
    }

    function classifyWorkspaceRange(revisions, tour) {
        if (revisions.length === 0) return { status: 'none', reason: 'The browser view has no selected committed revisions.' };
        if (revisions.length > 2) {
            return { status: 'multiple', reason: 'The displayed comparison contains more than two revision panels.' };
        }
        if (revisions.length !== 2) {
            return { status: 'unavailable', reason: 'The browser view could not resolve both comparison boundaries.' };
        }
        if (revisions.some((revision) => /^(WORKTREE|INDEX)$/i.test(revision))) {
            return { status: 'uncommitted', reason: 'The browser comparison includes a live working or staged state.' };
        }
        if (!revisions.every((revision) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision))) {
            return { status: 'unavailable', reason: 'The browser comparison does not expose two full revision identifiers.' };
        }
        const manifestBase = tour?.range?.mergeBaseOid;
        const manifestHead = tour?.range?.headOid;
        if (revisions[0] === manifestBase && revisions[1] === manifestHead) {
            return { status: 'exact', reason: 'The manifest validates its merge-base/head range.' };
        }
        if (revisions[0] === manifestHead && revisions[1] === manifestBase) {
            return { status: 'reversed', reason: 'The selected revisions reverse the manifest merge-base/head range.' };
        }
        return {
            status: 'unavailable',
            reason: 'The browser manifest validates only its merge-base/head pair; this displayed pair needs deliberate Compare selection or backend Git validation.'
        };
    }

    function uniqueStrings(values) {
        return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
    }

    function setWorkspacePromptStatus(message) {
        state.workspacePromptStatus = message;
        renderWorkspaceControls();
    }

    function historyPrefixForManifest(manifestUrl) {
        try {
            const path = new URL(manifestUrl, window.location.href).pathname;
            const suffix = '/tour.json';
            if (path.endsWith(suffix)) {
                const directory = path.slice(0, -suffix.length);
                return `${directory || ''}/history/`;
            }
        } catch {
            // The manifest fetch reports the useful error for an invalid URL.
        }
        return '/history/';
    }

    function chooseWorkspaceTourFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.bygone,.yaml,.yml,application/yaml,text/yaml';
            input.hidden = true;
            document.body.appendChild(input);
            const finish = (file) => {
                input.remove();
                resolve(file || null);
            };
            input.addEventListener('change', () => finish(input.files?.[0]));
            input.addEventListener('cancel', () => finish(null));
            input.click();
        });
    }

    function uploadedTourDiffers(result) {
        const current = state.authoredTour;
        if (!current) return false;
        const currentRepository = current.repository?.root;
        const currentBase = current.range?.mergeBaseOid;
        const currentHead = current.range?.headOid;
        const nextRepository = typeof result.repository === 'string' ? result.repository : '';
        const nextBase = typeof result.range?.mergeBaseOid === 'string' ? result.range.mergeBaseOid : '';
        const nextHead = typeof result.range?.headOid === 'string' ? result.range.headOid : '';
        return Boolean(
            (currentRepository && nextRepository && currentRepository !== nextRepository)
            || (currentBase && nextBase && currentBase !== nextBase)
            || (currentHead && nextHead && currentHead !== nextHead)
        );
    }

    function uploadedTourConfirmation(result) {
        const repository = typeof result.repository === 'string' && result.repository ? result.repository : '(server-selected repository)';
        const base = typeof result.range?.mergeBaseOid === 'string' && result.range.mergeBaseOid
            ? result.range.mergeBaseOid : '(unknown base)';
        const head = typeof result.range?.headOid === 'string' && result.range.headOid
            ? result.range.headOid : '(unknown head)';
        const currentRepository = state.authoredTour?.repository?.root || '(current repository unavailable)';
        const currentBase = state.authoredTour?.range?.mergeBaseOid || '(unknown base)';
        const currentHead = state.authoredTour?.range?.headOid || '(unknown head)';
        return [
            'Open this authored tour from the server?',
            `Repository: ${repository}`,
            `Range: ${base} → ${head}`,
            `Current browser range: ${currentRepository}, ${currentBase} → ${currentHead}`,
            'This loads the server-validated tour and does not change a local repository.'
        ].join('\n');
    }

    async function openExistingTourUpload() {
        if (exportData) { setStatus('This export contains a fixed snapshot. Open other tours in Bygone.'); return; }
        try {
            const file = await chooseWorkspaceTourFile();
            if (!file) return;
            if (file.size > 1024 * 1024) {
                throw new Error('Choose an authored .bygone or .yaml file no larger than 1 MiB.');
            }
            const fileName = typeof file.name === 'string' ? file.name.toLowerCase() : '';
            if (!/\.(?:bygone|ya?ml)$/.test(fileName)) {
                throw new Error('Choose an authored .bygone or .yaml file.');
            }
            const source = await file.text();
            const upload = (convertToV4 = false) => fetch('/tour/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, convertToV4 })
            });
            let response = await upload();
            let result = await response.json().catch(() => ({}));
            if (response.status === 409 && result.conversion) {
                if (!window.confirm(`${result.conversion.message}\n\n${result.conversion.detail}\n\nThe converted copy will be downloaded after opening.`)) {
                    setWorkspacePromptStatus('Tour conversion canceled.');
                    return;
                }
                response = await upload(true);
                result = await response.json().catch(() => ({}));
            }
            if (!response.ok) throw new Error(result.error || `Tour upload failed (${response.status}).`);
            if (!result || typeof result.manifestUrl !== 'string' || !result.manifestUrl) {
                throw new Error('Tour upload did not return a manifest URL.');
            }
            if (uploadedTourDiffers(result) && !window.confirm(uploadedTourConfirmation(result))) {
                setWorkspacePromptStatus('Kept the current tour.');
                return;
            }
            const loaded = await loadTour(result.manifestUrl);
            if (!loaded) {
                setWorkspacePromptStatus('Could not load the uploaded tour.');
                return;
            }
            if (typeof result.convertedSource === 'string') {
                const url = URL.createObjectURL(new Blob([result.convertedSource], { type: 'application/yaml' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = `${file.name.replace(/(?:\.bygone)?\.ya?ml$|\.bygone$/i, '')}.v4.bygone`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            setWorkspacePromptStatus('');
        } catch (error) {
            setWorkspacePromptStatus(`Could not open existing tour: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    function isNarrativeMode() {
        return !state.zoom || state.zoom.mode === 'historical' || state.zoom.mode === 'deconstructed';
    }

    function zoomTour(mode) {
        const tour = state.authoredTour;
        if (authoredTours()[mode]) return { ...tour, ...authoredTours()[mode] };
        return { ...tour, scenes: [], chapters: [], files: mode === 'compare' && state.compare ? state.compare.files : tour.files };
    }

    function renderZoomControl() {
        const controls = document.getElementById('tour-mode-controls');
        controls.hidden = !state.zoom || embeddedWorkspaceMode;
        if (!state.zoom) return;
        renderWorkspaceControls();
        const tabs = document.getElementById('tour-mode-tabs');
        const description = document.getElementById('tour-mode-description');
        if (tabs) tabs.hidden = true;
        if (description) description.hidden = true;
        const history = state.zoom.mode === 'history';
        const historyAvailable = supportsWorkspaceHistory();
        document.getElementById('tour-history-controls').hidden = !historyAvailable || state.zoom.mode === 'compare';
        document.getElementById('tour-compare-controls').hidden = !historyAvailable || state.zoom.mode !== 'compare';
        document.body.classList.toggle('tour-derived-mode', !isNarrativeMode());
        if (!isNarrativeMode()) {
            document.body.classList.remove('tour-discussion');
        }
        for (const id of ['tour-history-parent', 'tour-history-base']) document.getElementById(id).hidden = !history;
        renderComparisonControls();
    }

    function renderComparisonControls() {
        const count = state.comparisonDraftCommits.length;
        const compareButton = document.getElementById('tour-history-compare');
        compareButton.textContent = `Compare selected (${count})`;
        compareButton.disabled = count < 2 || !supportsWorkspaceHistory();
        const updateButton = document.getElementById('tour-compare-apply');
        updateButton.textContent = `Update comparison (${count})`;
        updateButton.disabled = count < 2 || !supportsWorkspaceHistory();
        document.getElementById('tour-compare-scope').textContent = state.compare?.path ? `File: ${state.compare.path}` : 'All changed files';
        document.getElementById('tour-compare-all').hidden = !state.compare?.path;
        for (const id of ['tour-history-parent', 'tour-history-base']) {
            document.getElementById(id).disabled = !supportsWorkspaceHistory() || !state.historyCommit;
        }
    }

    function chronologicalComparisonCommits() {
        return [...new Set([
            ...[...state.historyEntries].reverse().map((entry) => entry.commit),
            state.authoredTour.range.mergeBaseOid,
            ...state.authoredTour.commits.map((commit) => commit.oid),
            state.authoredTour.range.headOid
        ])];
    }

    function normalizeComparisonSelection(selection) {
        return normalizeTourComparisonSelection(selection, chronologicalComparisonCommits());
    }

    async function historyRequest(endpoint, body, prefix = state.historyPrefix, tour = state.authoredTour) {
        if (exportHistory) return exportHistory(endpoint, body);
        if (!supportsWorkspaceHistory(tour)) throw new Error(workspaceHistoryUnavailableReason());
        const response = await fetch(`${prefix || '/history/'}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `History request failed (${response.status}).`);
        return result;
    }

    function reportModeError(error) {
        const message = error instanceof Error ? error.message : String(error);
        const legacyStatus = document.getElementById('tour-mode-status');
        if (legacyStatus) legacyStatus.textContent = message;
        if (workspaceControls) setWorkspacePromptStatus(message);
    }

    function displayedCommits() {
        return state.displayedPanels.map((panel) => panel.commit).filter(Boolean);
    }

    function twoWayCommitPanels() {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        let commits = state.zoom?.mode === 'compare' ? state.comparisonCommits
            : [state.authoredTour.range.mergeBaseOid, state.authoredTour.range.headOid];
        if (state.directoryEvidence && isMultiPanelTourScene(scene)) {
            const definitions = getMultiPanelDefinitions(scene);
            const comparison = scene.overview?.comparison;
            commits = scene.kind === 'deconstructed-diff' ? [] : [
                (comparison ? definitions.find((panel) => panel.id === comparison.from) : definitions[0])?.oid,
                (comparison ? definitions.find((panel) => panel.id === comparison.to) : definitions.at(-1))?.oid
            ];
        }
        return ['left', 'right'].map((id, index) => ({ id, commit: commits[index] }));
    }

    function sharedCommitHistory() {
        const commits = state.displayedPanels.map((panel) => panel.commit);
        return { ...panelHistoryState(buildComparisonHistoryState({ commits: displayedCommits() }, null), commits, null), navigatorOnly: true };
    }

    async function fileHistory(path) {
        if (!path || !state.zoom || !supportsWorkspaceHistory()) return [];
        if (!state.fileHistoryCache.has(path)) {
            const pending = historyRequest('list', { path, commit: state.authoredTour.range.headOid }).then((result) => result.entries);
            state.fileHistoryCache.set(path, pending);
            pending.catch(() => state.fileHistoryCache.delete(path));
        }
        return state.fileHistoryCache.get(path);
    }

    async function refreshCommitMarkers(path, request) {
        try {
            const changes = await fileHistory(path);
            if (request !== renderRequestId) return;
            emit({ type: 'updateCommitMarkers', changedCommits: changes.map((entry) => entry.commit), path });
        } catch (error) { if (request === renderRequestId) reportModeError(error); }
    }

    async function showZoomHistory(path, commit, reload = true) {
        const request = ++evidenceRequest;
        const entries = state.historyEntries;
        commit = commit || state.historyCommit || state.authoredTour.range.headOid;
        if (!path) throw new Error('Choose a text file to explore its revisions.');
        const entry = entries.find((item) => item.commit === commit);
        if (state.historyPath === path && state.historyCommit === commit && state.historyPanels.length) {
            await renderZoomHistoryPanels();
            return;
        }
        const diff = await historyRequest('diff', { path, commit, head: state.authoredTour.range.headOid });
        if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
        if (reload && state.historyPanels.length && state.historyCommit === commit) {
            const panels = await Promise.all(state.historyPanels.map(async (panel) => {
                const snapshot = panel.commit ? await historyRequest('diff', { path, commit: panel.commit, head: state.authoredTour.range.headOid }) : { rightContent: '', path };
                return { ...panel, content: snapshot.rightContent, path: snapshot.path };
            }));
            if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
            state.historyPanels = panels;
            state.historyPath = path;
            state.historyDiff = diff;
            await renderZoomHistoryPanels();
            updateTourLocationUrl();
            return;
        }
        const commitIndex = entries.findIndex((item) => item.commit === commit);
        const previousEntry = commitIndex >= 0 ? entries[commitIndex + 1] : null;
        const previousCommit = previousEntry?.commit || diff.parentCommit;
        const previousContent = previousCommit && previousCommit !== diff.parentCommit
            ? (await historyRequest('diff', { path, commit: previousCommit, head: state.authoredTour.range.headOid })).rightContent : diff.leftContent;
        if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
        state.historyPath = path;
        state.historyCommit = commit;
        const width = Math.max(2, state.historyPanels.length);
        state.historyDiff = diff;
        const panel = (oid, content, label) => ({ id: `history-${oid || 'empty'}`, commit: oid, content, label, path: diff.path, editable: false });
        state.historyPanels = [panel(previousCommit, previousContent, previousCommit?.slice(0, 7) || 'Empty tree'), panel(commit, diff.rightContent, entry ? `${entry.shortCommit} ${entry.summary}` : commit.slice(0, 7))];
        state.historyFocus = `history-${commit}`;
        while (state.historyPanels.length < width) {
            const older = historyNeighbor(state.historyPanels[0], 'left');
            if (!older) break;
            const snapshot = await historyRequest('diff', { path, commit: older.commit, head: state.authoredTour.range.headOid });
            if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
            state.historyPanels.unshift(panel(older.commit, snapshot.rightContent, `${older.shortCommit} ${older.summary}`));
        }
        await renderZoomHistoryPanels();
        document.getElementById('tour-mode-status').textContent = '';
        renderComparisonControls();
        updateTourLocationUrl();
    }

    function buildZoomHistoryState(entries, commit, diff) {
        const index = entries.findIndex((item) => item.commit === commit);
        const entry = entries[index];
        return {
            fileName: (state.historyPath || diff.path).split('/').pop(),
            canGoBack: index >= 0 && index < entries.length - 1,
            canGoForward: index > 0,
            positionLabel: `${index + 1} / ${entries.length}`,
            leftCommitLabel: state.historyPanels[0]?.commit?.slice(0, 7) || 'Empty tree',
            leftTimestamp: '',
            rightCommitLabel: state.historyPanels.at(-1)?.label || (entry ? `${entry.shortCommit} ${entry.summary}`.trim() : commit.slice(0, 7)),
            rightTimestamp: entry?.timestamp || '',
            workingTreeControls: false,
            rail: {
                activeTabId: 'history',
                tabs: [{ id: 'history', label: 'History' }],
                itemsByTab: {
                    history: entries.map((item, itemIndex) => ({
                        label: `${item.shortCommit} ${item.summary}`.trim(),
                        meta: item.timestamp,
                        commit: item.commit, summary: item.summary, timestamp: item.timestamp,
                        author: item.author, authorEmail: item.authorEmail, message: item.message,
                        parents: item.parents,
                        active: itemIndex === index,
                        selected: state.comparisonDraftCommits.includes(item.commit),
                        kind: 'history-entry',
                        index: itemIndex
                    }))
                }
            }
        };
    }

    function historyNeighbor(panel, side) {
        const order = chronologicalComparisonCommits();
        const index = order.indexOf(panel.commit);
        if (index < 0) return null;
        const loaded = new Set(state.historyPanels.map((item) => item.commit));
        const candidates = side === 'left' ? order.slice(0, index).reverse() : order.slice(index + 1);
        const oid = candidates.find((candidate) => !loaded.has(candidate) && state.historyEntries.some((entry) => entry.commit === candidate));
        return state.historyEntries.find((entry) => entry.commit === oid);
    }

    function panelHistoryState(history, commits, focus) {
        const items = history.rail.itemsByTab.history;
        for (const item of items) {
            item.commit = state.historyEntries[item.index]?.commit;
            const entry = state.historyEntries[item.index];
            item.inTour = state.authoredTour?.commits.some((revision) => revision.oid === item.commit);
            item.selectionEnabled = Boolean(state.zoom);
            if (entry?.parents?.length > 1) item.meta += ` · Merge: ${entry.parents.map((parent) => parent.slice(0, 7)).join(', ')}`;
            item.panelNumber = commits.indexOf(item.commit) + 1 || null;
            item.active = item.commit === focus;
        }
        commits.forEach((commit, index) => {
            if (commit === undefined) return; // Synthetic explanation stages are not Git revisions.
            if (items.some((item) => item.commit === commit)) return;
            items.push({ label: commit ? `${commit.slice(0, 7)} · Parent/base revision` : 'Empty tree', commit, selected: state.comparisonDraftCommits.includes(commit), selectionEnabled: Boolean(state.zoom), panelNumber: index + 1, active: commit === focus, kind: 'panel-revision', index: -index - 1 });
        });
        return history;
    }

    async function renderZoomHistoryPanels() {
        const currentPanels = state.historyPanels;
        const tour = state.authoredTour;
        const request = evidenceRequest;
        const result = await historyRequest('changed-files', { commits: currentPanels.map(panel => panel.commit || null) });
        if (request !== evidenceRequest || currentPanels !== state.historyPanels || tour !== state.authoredTour || state.zoom.mode !== 'history') return;
        state.historyChangedFiles = new Set(result.paths);
        const panels = state.historyPanels.map((panel) => ({ ...panel, addLeftEnabled: Boolean(historyNeighbor(panel, 'left')), addRightEnabled: Boolean(historyNeighbor(panel, 'right')), removeEnabled: state.historyPanels.length > 2 }));
        const focus = panels.find((panel) => panel.id === state.historyFocus)?.commit;
        state.activeTourFilePath = state.historyPath;
        updateTourFileSelection();
        emit({ type: 'showMultiDiff', panels, pairs: panels.slice(0, -1).map((panel, index) => ({ leftIndex: index, rightIndex: index + 1, diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content) })), activePanelId: state.historyFocus, mutationEnabled: true,
            fileNavigation: { canGoPrevious: Boolean(getCurrentTourFileTarget(-1)), canGoNext: Boolean(getCurrentTourFileTarget(1)) },
            history: panelHistoryState(buildZoomHistoryState(state.historyEntries, state.historyCommit, state.historyDiff), panels.map((panel) => panel.commit), focus) });
    }

    async function changeHistoryPanels(message) {
        const anchor = state.historyPanels.find((panel) => panel.id === (message.anchorPanelId || message.panelId));
        if (!anchor) return;
        if (message.type === 'multiRemovePanel') {
            if (state.historyPanels.length <= 2) return;
            ++evidenceRequest;
            state.historyPanels = state.historyPanels.filter((panel) => panel !== anchor);
            if (state.historyFocus === anchor.id) state.historyFocus = state.historyPanels.at(-1).id;
        } else {
            const entry = historyNeighbor(anchor, message.side);
            if (!entry) return;
            const request = ++evidenceRequest;
            const diff = await historyRequest('diff', { path: state.historyPath, commit: entry.commit, head: state.authoredTour.range.headOid });
            if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
            const panel = { id: `history-${entry.commit}`, commit: entry.commit, content: diff.rightContent, label: `${entry.shortCommit} ${entry.summary}`, path: diff.path, editable: false };
            state.historyPanels.push(panel);
            const order = chronologicalComparisonCommits();
            state.historyPanels.sort((a, b) => order.indexOf(a.commit) - order.indexOf(b.commit));
            state.historyFocus = panel.id;
        }
        await renderZoomHistoryPanels();
    }

    function navigateZoomHistory(direction) {
        const index = state.historyEntries.findIndex((entry) => entry.commit === state.historyCommit);
        const target = state.historyEntries[index + direction];
        if (target) return showZoomHistory(state.historyPath, target.commit, false);
    }

    function buildComparisonHistoryState(selection, focusCommit) {
        return {
            fileName: (selection.path || state.activeTourFilePath || 'Comparison').split('/').pop(),
            canGoBack: false,
            canGoForward: false,
            positionLabel: `${selection.commits.length} loaded panels`,
            leftCommitLabel: selection.commits[0]?.slice(0, 7) || '',
            leftTimestamp: '',
            rightCommitLabel: selection.commits.at(-1)?.slice(0, 7) || '',
            rightTimestamp: '',
            workingTreeControls: false,
            rail: {
                activeTabId: 'history',
                tabs: [{ id: 'history', label: 'History' }],
                itemsByTab: {
                    history: state.historyEntries.map((item, index) => ({
                        label: `${item.shortCommit} ${item.summary}`.trim(),
                        meta: item.timestamp,
                        commit: item.commit, summary: item.summary, timestamp: item.timestamp,
                        author: item.author, authorEmail: item.authorEmail, message: item.message,
                        parents: item.parents,
                        active: item.commit === focusCommit,
                        selected: state.comparisonDraftCommits.includes(item.commit),
                        panelNumber: selection.commits.indexOf(item.commit) + 1 || null,
                        kind: 'history-entry',
                        index
                    }))
                }
            }
        };
    }

    function showComparisonFile(file, focusCommit = null) {
        if (!file || file.kind !== 'text-diff') return false;
        const panels = file.comparisonPanels;
        focusCommit = focusCommit || state.comparisonFocus;
        state.comparisonFocus = focusCommit;
        const pairs = panels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
        }));
        state.activeTourFilePath = file.path;
        updateTourFileSelection();
        emit({
            type: 'showMultiDiff',
            panels,
            pairs,
            activePanelId: focusCommit ? `compare-${focusCommit}` : null,
            history: panelHistoryState(buildComparisonHistoryState(state.compare, focusCommit), state.compare.commits, focusCommit),
            fileNavigation: {
                canGoPrevious: Boolean(getCurrentTourFileTarget(-1)),
                canGoNext: Boolean(getCurrentTourFileTarget(1))
            },
            mutationEnabled: false
        });
        updateTourLocationUrl();
        return true;
    }

    async function showComparison(selection, selectedPath, focusCommit = null) {
        selection = normalizeComparisonSelection(selection);
        const request = ++evidenceRequest;
        const result = await historyRequest('compare-many', selection);
        if (request !== evidenceRequest || state.zoom.mode !== 'compare') return;
        const files = result.files;
        state.comparisonCommits = selection.commits;
        state.compare = { ...selection, files };
        state.tour = zoomTour('compare');
        state.activeSceneIndex = -1;
        state.tourFocusFilePath = null;
        renderTourShell();
        renderZoomControl();
        renderTourSearchResults();
        const file = files.find((item) => item.kind === 'text-diff' && item.path === selectedPath)
            || files.find((item) => item.kind === 'text-diff');
        if (file) showComparisonFile(file, focusCommit);
        else {
            state.activeTourFilePath = null;
            const panels = selection.commits.map((commit) => ({ id: `compare-${commit}`, commit, path: 'No text changes', content: '', label: commit.slice(0, 7), editable: false }));
            emit({ type: 'showMultiDiff', panels, pairs: panels.slice(0, -1).map((panel, index) => ({ leftIndex: index, rightIndex: index + 1, diffModel: buildTwoWayDiffModel('', '') })), mutationEnabled: false,
                history: panelHistoryState(buildComparisonHistoryState(selection, null), selection.commits, null) });
            state.activeTourFilePath = null;
            zoomRestore = null;
        }
        document.getElementById('tour-mode-status').textContent = files.length
            ? (file ? '' : 'Changed files cannot be displayed as text. See the file list for details.')
            : 'No changes between these revisions.';
        updateTourLocationUrl();
    }

    async function openComparison(selection) {
        if (!supportsWorkspaceHistory()) {
            setWorkspacePromptStatus(workspaceCompareUnavailableReason());
            return;
        }
        if (state.zoomSwitching) return;
        if (state.zoom.mode !== 'compare') await switchZoomMode('compare', selection);
        else await showComparison(selection, state.activeTourFilePath);
        setTourNavigatorTab('commits');
    }

    function finalComparison() {
        return { commits: [state.authoredTour.range.mergeBaseOid, state.authoredTour.range.headOid] };
    }

    function selectedHistoryPath() {
        return state.historyEntries.find((entry) => entry.commit === state.historyCommit)?.path || state.historyPath;
    }

    function switchZoomMode(mode, comparison, selectedPath) {
        const pending = zoomSwitchQueue.then(() => performZoomSwitch(mode, comparison, selectedPath));
        zoomSwitchQueue = pending.catch(() => {});
        return pending;
    }

    async function performZoomSwitch(mode, comparison, selectedPath) {
        if (!state.zoom || state.zoomSwitching || mode === state.zoom.mode || !availableModes().includes(mode)) return;
        state.zoomSwitching = true;
        ++evidenceRequest;
        const previousMode = state.zoom.mode;
        let origin;
        try {
            origin = await captureZoomLocation();
            state.zoom.depart(origin);
            narrationController.pauseForExternalOwner();
            const landing = state.zoom.enter(mode, mode === 'history' ? origin : null);
            state.tourNavigatorTab = landing.restore ? landing.location.navigatorTab || 'commits' : isNarrativeMode() ? 'tour' : 'commits';
            state.activeSceneIndex = -1;
            state.activeStepIndex = 0;
            state.narrativeParent = null;
            state.directoryEvidence = null;
            state.sceneIntroVisible = false;
            state.tourFocusFilePath = null;
            state.tour = zoomTour(mode);
            renderTourShell();
            renderTourSearchResults();
            renderZoomControl();
            document.getElementById('tour-mode-status').textContent = '';
            zoomRestore = landing.restore && !comparison ? landing.location : null;
            if (mode === 'history') {
                await showZoomHistory(state.historyPath || landing.location.path || state.tour.files.find((file) => file.kind === 'text-diff')?.path, state.historyCommit || landing.location.commit);
            } else if (mode === 'compare') {
                await showComparison(comparison || state.compare || finalComparison(), selectedPath || landing.location.path || origin.path);
            } else {
                showTourScene(Math.max(0, landing.location.sceneIndex), landing.location.stepIndex, {
                    zoomLanding: true, showIntro: landing.restore ? landing.location.sceneIntroVisible : true,
                    readingKey: landing.restore ? landing.location.readingKey : 'title'
                });
                if (landing.location.path && state.activeTourFilePath !== landing.location.path) {
                    const index = state.tour.files.findIndex((file) => file.path === landing.location.path);
                    if (index >= 0) showTourFileSelection(index);
                }
            }
            updateTourLocationUrl();
            if (documentLocationReady && !applyingDocumentLocation) {
                const url = new URL(window.location.href);
                url.hash = isNarrativeMode() ? serializeDocumentFragment(state.zoom.mode,
                    focusForReadingItem(readingItems.find(item => item.key === state.readingKey))) : '';
                window.history.replaceState(null, '', url);
            }
        } catch (error) {
            zoomRestore = null;
            state.zoom.enter(previousMode);
            state.tour = zoomTour(previousMode);
            if (origin) {
                state.activeSceneIndex = origin.sceneIndex;
                state.activeStepIndex = origin.stepIndex;
                state.activeTourFilePath = origin.path;
                state.narrativeParent = origin.narrativeParent;
                state.sceneIntroVisible = origin.sceneIntroVisible;
                state.tourNavigatorTab = origin.navigatorTab;
            }
            renderTourShell();
            renderZoomControl();
            renderTourSearchResults();
            if (origin && isNarrativeMode()) {
                zoomRestore = origin;
                showTourScene(origin.sceneIndex, origin.stepIndex, { zoomLanding: true, showIntro: origin.sceneIntroVisible, readingKey: origin.readingKey });
                if (origin.path && state.activeTourFilePath !== origin.path) {
                    showTourFileSelection(state.tour.files.findIndex((file) => file.path === origin.path));
                }
            }
            updateTourFileSelection();
            updateTourLocationUrl();
            reportModeError(error);
        } finally {
            state.zoomSwitching = false;
        }
    }

    async function handleRendererMessage(message) {
        if (!message || typeof message !== 'object') {
            return;
        }
        if (message.type === 'navigationState') {
            navigationRequests.get(message.requestId)?.(message.navigation);
            return;
        }
        if (message.type === 'renderComplete' && state.mode === 'tour' && message.renderRequestId === renderRequestId) {
            void refreshCommitMarkers(state.activeTourFilePath, renderRequestId);
        }
        if (message.type === 'renderComplete' && zoomRestore && message.renderRequestId === zoomRestoreRequestId) {
            const location = zoomRestore;
            zoomRestore = null;
            emit({ type: 'restoreNavigationState', navigation: location.navigation });
            const narrative = document.getElementById('tour-narrative-content');
            if (narrative) {
                narrative.scrollTop = location.narrativeScroll || 0;
                programmaticReadingScroll = narrative.scrollTop;
            }
            if (location.focusId) document.getElementById(location.focusId)?.focus({ preventScroll: true });
        }

        if (message.type === 'ready') {
            const parameters = new URLSearchParams(window.location.search);
            const manifestUrl = parameters.get('manifest');
            if (manifestUrl || exportData) {
                void loadTour(manifestUrl);
            } else if (parameters.get('demo') === '1') {
                compareTestFiles();
            }
            return;
        }

        if (state.mode === 'tour' && state.directoryEvidence && isNarrativeMode()) {
            if (message.type === 'openDirectoryEntry') {
                openTourDirectoryFile(message.relativePath);
                return;
            }
            if (message.type === 'returnToDirectory') {
                showTourDirectoryOverview();
                return;
            }
        }

        if (state.mode === 'tour') {
            if (state.zoom?.mode === 'history' && ['multiAddPanel', 'multiRemovePanel'].includes(message.type)) {
                void changeHistoryPanels(message).catch(reportModeError);
                return;
            }
            if (message.type === 'multiSetActivePair' || message.type === 'multiSetActivePanel') {
                if (state.zoom?.mode === 'history') {
                    state.historyFocus = message.type === 'multiSetActivePanel' ? message.panelId
                        : state.historyPanels[message.pairIndex]?.id || state.historyFocus;
                } else if (state.zoom?.mode === 'compare') {
                    state.comparisonFocus = message.type === 'multiSetActivePanel'
                        ? message.panelId.replace(/^compare-/, '')
                        : state.comparisonCommits[message.pairIndex];
                }
                return;
            }
            if (message.type === 'historyBack' || message.type === 'historyForward') {
                if (state.zoom?.mode !== 'history') return;
                const navigation = navigateZoomHistory(message.type === 'historyBack' ? 1 : -1);
                if (navigation) void navigation.catch(reportModeError);
                return;
            }
            if (message.type === 'toggleHistorySelection' && Number.isInteger(message.index)) {
                const commits = state.displayedPanels.map((panel) => panel.commit);
                const entry = message.index < 0 ? { commit: commits[-message.index - 1] } : state.historyEntries[message.index];
                if (!entry?.commit) return;
                const nextCommits = state.comparisonDraftCommits.includes(entry.commit)
                    ? state.comparisonDraftCommits.filter((commit) => commit !== entry.commit)
                    : [...state.comparisonDraftCommits, entry.commit];
                state.comparisonDraftCommits = nextCommits.length >= 2
                    ? normalizeComparisonSelection({ commits: nextCommits }).commits
                    : nextCommits;
                renderComparisonControls();
                return;
            }
            if (message.type === 'compareHistoryEntry' && Number.isInteger(message.index)) {
                const entry = state.historyEntries[message.index];
                if (entry?.parentCommit) void openComparison({ commits: [entry.parentCommit, entry.commit], path: state.activeTourFilePath }).catch(reportModeError);
                return;
            }
            if (message.type === 'selectHistoryEntry' && Number.isInteger(message.index)) {
                const entry = state.historyEntries[message.index];
                if (entry && state.zoom?.mode === 'history') {
                    const panel = state.historyPanels.find((item) => item.commit === entry.commit);
                    if (panel) { state.historyFocus = panel.id; emit({ type: 'focusHistoryPanel', panelId: panel.id }); }
                    else void showZoomHistory(state.historyPath, entry.commit, false).catch(reportModeError);
                }
                if (entry && state.zoom?.mode !== 'history') {
                    const panel = state.displayedPanels.find((item) => item.commit === entry.commit);
                    if (panel) emit({ type: 'focusHistoryPanel', panelId: panel.id });
                    else {
                        state.historyCommit = entry.commit;
                        state.historyPath = state.activeTourFilePath || state.historyPath;
                        void switchZoomMode('history').catch(reportModeError);
                    }
                }
                return;
            }
        }

        if (message.type === 'navigateFile' && state.mode === 'tour') {
            showTourFile(message.direction === 'previous' ? -1 : 1);
            return;
        }

        if (message.type === 'navigateTourStep' && state.mode === 'tour') {
            const sceneIndex = message.sceneIndex;
            const stepIndex = message.stepIndex;
            if (Number.isInteger(sceneIndex) && Number.isInteger(stepIndex)) {
                showTourScene(sceneIndex, stepIndex, {
                    userNavigation: true,
                    showIntro: false
                });
            }
            return;
        }

        if (message.type === 'recomputeDiff' && state.mode === 'diff' && state.left && state.right) {
            state.left.content = message.leftContent;
            state.right.content = message.rightContent;

            emit({
                type: 'showDiff',
                file1: state.left.name,
                file2: state.right.name,
                comparisonId: `web-${state.comparisonId}`,
                leftContent: state.left.content,
                rightContent: state.right.content,
                diffModel: buildTwoWayDiffModel(state.left.content, state.right.content),
                history: null
            });
        }
    }

    function bindControls() {
        const action = (id, handler) => document.getElementById(id)?.addEventListener('click', () => {
            Promise.resolve().then(handler).catch(reportModeError);
        });
        action('tour-history-compare', () => openComparison({ commits: state.comparisonDraftCommits }));
        action('tour-compare-apply', () => openComparison({ commits: state.comparisonDraftCommits, path: state.compare?.path }));
        action('tour-history-parent', () => {
            const parent = state.historyEntries.find((entry) => entry.commit === state.historyCommit)?.parentCommit;
            if (!parent) { reportModeError('This is the first commit; History already shows its comparison with the empty tree.'); return; }
            return openComparison({ commits: [parent, state.historyCommit], path: selectedHistoryPath() });
        });
        action('tour-history-base', () => openComparison({ commits: [state.authoredTour.range.mergeBaseOid, state.historyCommit], path: selectedHistoryPath() }));
        action('tour-history-final', () => openComparison(finalComparison()));
        action('tour-compare-final', () => openComparison(finalComparison()));
        action('tour-compare-all', () => openComparison({ commits: state.compare.commits }));
        const updateDraft = (commits) => {
            state.comparisonDraftCommits = commits.filter(Boolean);
            renderComparisonControls();
            emit({ type: 'updateHistorySelection', commits: state.comparisonDraftCommits });
        };
        for (const mode of ['history', 'compare']) {
            action(`tour-${mode}-clear`, () => updateDraft([]));
            action(`tour-${mode}-reset`, () => updateDraft(displayedCommits()));
        }
        // Only user input counts. Renderer reveals, synchronized scrolling and restores do not.
        for (const type of ['wheel', 'pointerdown', 'keydown']) document.addEventListener(type, (event) => {
            if (!event.isTrusted || event.target?.closest?.('#tour-mode-controls')) return;
            if (event.target?.closest?.('.monaco-editor, .diff-toolbar, #tour-narrative')) cancelPendingModeRestore();
        }, { capture: true, passive: true });
        const compareTestButton = document.getElementById('web-compare-test');
        const openDiffButton = document.getElementById('web-open-diff');
        const openDiff3Button = document.getElementById('web-open-diff3');
        const diffInput = document.getElementById('web-diff-input');
        const diff3Input = document.getElementById('web-diff3-input');
        const tourNarration = document.getElementById('tour-narration');
        const tourReturnFocus = document.getElementById('tour-return-focus');
        const tourSearchInput = document.getElementById('tour-search-input');
        const tourSearchScope = document.getElementById('tour-search-scope');
        const tourListen = document.getElementById('tour-listen');
        const tourStop = document.getElementById('tour-stop');
        const tourNarrationSkipBack = document.getElementById('tour-narration-skip-back');
        const tourNarrationSkipAhead = document.getElementById('tour-narration-skip-ahead');
        const tourVoice = document.getElementById('tour-narration-voice');
        const tourRate = document.getElementById('tour-narration-rate');

        initializeTourSidebar();
        initializeTourNarrativeResizer();
        initializeTourNarrativeLayout();
        initializeNarrationVoices();
        document.getElementById('tour-navigator-tabs')?.addEventListener('click', (event) => {
            const button = event.target instanceof Element ? event.target.closest('[data-tour-navigator]') : null;
            if (button?.dataset.tourNavigator) setTourNavigatorTab(button.dataset.tourNavigator);
        });

        compareTestButton?.addEventListener('click', () => {
            compareTestFiles();
        });

        openDiffButton?.addEventListener('click', () => {
            diffInput.value = '';
            diffInput.click();
        });

        openDiff3Button?.addEventListener('click', () => {
            diff3Input.value = '';
            diff3Input.click();
        });

        diffInput?.addEventListener('change', async () => {
            const files = Array.from(diffInput.files || []);
            if (files.length !== 2) {
                setStatus('Select exactly 2 files for a diff.');
                return;
            }

            await openDiffFiles(files);
        });

        diff3Input?.addEventListener('change', async () => {
            const files = Array.from(diff3Input.files || []);
            if (files.length < 1) {
                setStatus('Select one or more files.');
                return;
            }

            await openMultiFileDiff(files);
        });

        document.getElementById('tour-title')?.addEventListener('click', () => setNarrativeView('tour'));
        document.getElementById('tour-narrative-content')?.addEventListener('scroll', followReadingScroll, { passive: true });
        tourNarration?.addEventListener('click', () => toggleNarrationSettings());
        tourReturnFocus?.addEventListener('click', returnToTourFocus);
        document.getElementById('tour-directory-root')?.addEventListener('click', () => {
            setNarrativeView('scene');
            document.getElementById('tour-directory-root').focus({ preventScroll: true });
        });
        tourSearchInput?.addEventListener('input', renderTourSearchResults);
        tourSearchScope?.addEventListener('change', renderTourSearchResults);
        tourListen?.addEventListener('click', toggleNarrationFromHost);
        tourStop?.addEventListener('click', () => narrationController.stop());
        tourNarrationSkipBack?.addEventListener('click', () => narrationController.skipSegment(-1));
        tourNarrationSkipAhead?.addEventListener('click', () => narrationController.skipSegment(1));
        tourVoice?.addEventListener('change', () => {
            state.narrationVoiceURI = tourVoice.value;
            preferences.setItem(TOUR_NARRATION_VOICE_STORAGE_KEY, state.narrationVoiceURI);
        });
        if (tourRate) {
            tourRate.value = String(state.narrationRate);
            tourRate.addEventListener('change', () => {
                const nextRate = Number(tourRate.value);
                state.narrationRate = NARRATION_RATES.has(nextRate) ? nextRate : 1;
                tourRate.value = String(state.narrationRate);
                preferences.setItem(TOUR_NARRATION_RATE_STORAGE_KEY, String(state.narrationRate));
            });
        }
        document.getElementById('tour-search-results')?.addEventListener('click', (event) => {
            const result = event.target instanceof Element
                ? event.target.closest('[data-tour-search-result]')
                : null;
            if (result) openTourSearchResult(Number(result.getAttribute('data-tour-search-result')));
        });
        window.addEventListener('keydown', (event) => {
            if (state.mode === 'tour' && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLocaleLowerCase() === 'f') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (state.tourSidebarHidden) setTourSidebarHidden(false);
                setTourNavigatorTab('tour');
                document.querySelector('.tour-search-disclosure')?.setAttribute('open', '');
                tourSearchInput?.focus();
                tourSearchInput?.select();
                return;
            }
            if (state.mode !== 'tour' || event.metaKey || event.ctrlKey || event.altKey || isInteractiveKeyTarget(event.target)) {
                return;
            }
            if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                if (state.zoom?.mode === 'history') void navigateZoomHistory(1)?.catch(reportModeError);
                else showTourLinear(-1);
            } else if (event.key === 'PageDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                if (state.zoom?.mode === 'history') void navigateZoomHistory(-1)?.catch(reportModeError);
                else showTourLinear(1);
            } else if (state.zoom?.mode === 'history' && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                showTourFile(event.key === 'ArrowUp' ? -1 : 1);
            }
        }, true);
        window.addEventListener('bygone:tour-command', (event) => {
            if (event.detail === 'toggleNarration') toggleNarrationFromHost();
            if (event.detail === 'pauseNarration') narrationController.pauseForExternalOwner();
        });
        window.addEventListener('beforeunload', () => narrationController.dispose(), { once: true });
        renderNarrationPlaybackState(narrationController.state);
    }

    function initializeNarrationVoices() {
        const voiceSelect = document.getElementById('tour-narration-voice');
        const listen = document.getElementById('tour-listen');
        if (!deviceNarrationAvailable) {
            if (listen) {
                listen.disabled = true;
                listen.title = 'Device narration is not supported by this browser.';
            }
            if (voiceSelect) voiceSelect.disabled = true;
            setNarrationStatus('Device narration unavailable');
            return;
        }
        const refresh = () => {
            state.narrationVoices = window.speechSynthesis.getVoices()
                .filter(voice => !exportData || voice.localService)
                .slice()
                .sort((left, right) => Number(right.default) - Number(left.default)
                    || left.lang.localeCompare(right.lang)
                    || left.name.localeCompare(right.name));
            if (state.narrationVoiceURI
                && state.narrationVoices.length > 0
                && !state.narrationVoices.some((voice) => voice.voiceURI === state.narrationVoiceURI)) {
                state.narrationVoiceURI = '';
                preferences.removeItem(TOUR_NARRATION_VOICE_STORAGE_KEY);
            }
            if (voiceSelect) {
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'System default voice';
                voiceSelect.replaceChildren(defaultOption, ...state.narrationVoices.map((voice) => {
                    const option = document.createElement('option');
                    option.value = voice.voiceURI;
                    option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' — default' : ''}`;
                    return option;
                }));
                voiceSelect.value = state.narrationVoiceURI;
                voiceSelect.disabled = state.narrationVoices.length === 0;
            }
        };
        refresh();
        window.speechSynthesis.addEventListener('voiceschanged', refresh);
    }

    function readStoredNarrationRate() {
        const stored = Number(preferences.getItem(TOUR_NARRATION_RATE_STORAGE_KEY));
        return NARRATION_RATES.has(stored) ? stored : 1;
    }

    function createDeviceSpeechEngine() {
        let activeUtterance = null;
        return {
            speak(segment, callbacks) {
                if (!deviceNarrationAvailable) {
                    callbacks.onError('Device narration is not supported by this browser.');
                    return;
                }
                const utterance = new window.SpeechSynthesisUtterance(segment.speechText);
                const selectedVoice = state.narrationVoices.find((voice) => voice.voiceURI === state.narrationVoiceURI) || (exportData ? state.narrationVoices[0] : null);
                if (exportData && !selectedVoice) { callbacks.onError('No local narration voice is available.'); return; }
                if (selectedVoice) utterance.voice = selectedVoice;
                utterance.rate = state.narrationRate;
                utterance.onend = () => {
                    if (activeUtterance === utterance) activeUtterance = null;
                    callbacks.onEnd();
                };
                utterance.onerror = (event) => {
                    if (activeUtterance === utterance) activeUtterance = null;
                    callbacks.onError(formatNarrationError(event.error));
                };
                activeUtterance = utterance;
                window.speechSynthesis.speak(utterance);
            },
            pause() {
                if (deviceNarrationAvailable) window.speechSynthesis.pause();
            },
            resume() {
                if (deviceNarrationAvailable) window.speechSynthesis.resume();
            },
            cancel() {
                activeUtterance = null;
                if (deviceNarrationAvailable) window.speechSynthesis.cancel();
            }
        };
    }

    function formatNarrationError(error) {
        if (error === 'not-allowed') return 'Device narration needs permission to play audio.';
        if (error === 'language-unavailable' || error === 'voice-unavailable') return 'The selected device voice is unavailable.';
        return `Device narration failed${error ? `: ${error}` : '.'}`;
    }

    function startNarrationAtCurrentPosition() {
        if (!deviceNarrationAvailable || state.mode !== 'tour') return;
        const unit = buildActiveNarrationUnit('playback-start');
        if (!unit) return;
        const firstSegment = unit.segments[0];
        setSceneIntroVisible(Boolean(firstSegment && ['chapter', 'scene-title', 'summary', 'bullet', 'takeaway'].includes(firstSegment.source.field)));
        state.renderedNarrationUnit = unit;
        renderCurrentNarrativeForNarrationUnit(unit);
        narrationController.start(unit, true);
    }

    function toggleNarrationFromHost() {
        if (narrationController.state.kind === 'playing' || narrationController.state.kind === 'paused') {
            narrationController.togglePause();
        } else {
            startNarrationAtCurrentPosition();
        }
    }

    function buildActiveNarrationUnit(entry) {
        if (!state.tour || state.activeSceneIndex < 0) return null;
        return buildTourNarrationUnit(state.tour, {
            sceneIndex: state.activeSceneIndex,
            stepIndex: state.activeStepIndex
        }, { entry });
    }

    function canNavigateNarrationUnit(unit, direction) {
        const tour = state.tour;
        return Boolean(tour && getLinearTourTarget(tour.scenes, unit.position, direction));
    }

    function navigateNarrationUnit(unit, direction) {
        const tour = state.tour;
        if (!tour) return null;
        const target = getLinearTourTarget(tour.scenes, unit.position, direction);
        if (!target) return null;
        return showTourScene(target.sceneIndex, target.stepIndex, {
            narrationNavigation: 'controller',
            narrationEntry: 'continuous',
            showIntro: false
        });
    }

    function claimNarrationAudio() {
        if (exportData) return;
        void fetch('/narration/claim', { method: 'POST', cache: 'no-store' }).catch(() => {});
    }

    function renderNarrationPlaybackState(playbackState) {
        const listen = document.getElementById('tour-listen');
        const stop = document.getElementById('tour-stop');
        const skipBack = document.getElementById('tour-narration-skip-back');
        const skipAhead = document.getElementById('tour-narration-skip-ahead');
        if (listen) {
            listen.disabled = !deviceNarrationAvailable || state.mode !== 'tour';
            const isPlaying = playbackState.kind === 'playing';
            listen.querySelector('.tour-play-pause-icon')?.setAttribute(
                'd',
                isPlaying ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'm8 5 11 7-11 7Z'
            );
            const listenLabel = isPlaying
                ? 'Pause narration'
                : playbackState.kind === 'paused' ? 'Resume narration' : 'Listen from the current tour item';
            listen.title = listenLabel;
            listen.setAttribute('aria-label', listenLabel);
            document.getElementById('tour-listen-label').textContent = isPlaying
                ? 'Pause' : playbackState.kind === 'paused' ? 'Resume' : 'Listen';
        }
        if (stop) stop.disabled = playbackState.kind !== 'playing' && playbackState.kind !== 'paused';
        if (skipBack) skipBack.disabled = !narrationController.canSkipSegment(-1);
        if (skipAhead) skipAhead.disabled = !narrationController.canSkipSegment(1);
        if (playbackState.kind === 'playing' || playbackState.kind === 'paused') {
            const ordinal = playbackState.segmentIndex + 1;
            const total = playbackState.unit.segments.length;
            setNarrationStatus(`${playbackState.kind === 'paused' ? 'Paused' : 'Speaking'} · segment ${ordinal} of ${total}`);
        } else if (playbackState.kind === 'completed') {
            setNarrationStatus('Narration complete');
        } else if (playbackState.kind === 'error') {
            setNarrationStatus(playbackState.message);
        } else if (deviceNarrationAvailable) {
            setNarrationStatus('Device voice ready');
        }
    }

    function setNarrationStatus(message) {
        const status = document.getElementById('tour-narration-status');
        if (status) status.textContent = message;
    }

    function renderNarrationHighlight(segment, paused) {
        document.querySelectorAll('.tour-narration-segment.is-speaking').forEach((element) => {
            element.classList.remove('is-speaking', 'is-paused');
        });
        if (!segment) return;
        const elements = [...document.querySelectorAll('[data-narration-segment-id]')]
            .filter((candidate) => candidate.dataset.narrationSegmentId === segment.id);
        const element = elements[0];
        if (!element) return;
        elements.forEach((piece) => {
            piece.classList.add('is-speaking');
            piece.classList.toggle('is-paused', paused);
        });
        // Exploring the document pauses narration; a paused segment must not
        // pull the reader back to the introduction or move the code pane.
        if (paused) return;
        const passage = element.closest('[data-reading-kind]');
        if (passage?.dataset.readingKind === 'scene') {
            const sceneField = ['chapter', 'scene-title', 'summary', 'bullet', 'takeaway'].includes(segment.source.field);
            setSceneIntroVisible(sceneField);
        } else if (passage?.dataset.readingKind === 'step') {
            setSceneIntroVisible(false);
        }
        const narrative = document.getElementById('tour-narrative-content');
        if (!narrative) return;
        const elementBounds = element.getBoundingClientRect();
        const narrativeBounds = narrative.getBoundingClientRect();
        if (elementBounds.top < narrativeBounds.top + updateStickySceneHeaders() || elementBounds.bottom > narrativeBounds.bottom) {
            element.scrollIntoView({ block: 'nearest' });
            programmaticReadingScroll = narrative.scrollTop;
        }
    }

    let currentTourSearchMatches = [];

    function renderTourSearchResults() {
        const input = document.getElementById('tour-search-input');
        const scope = document.getElementById('tour-search-scope');
        const status = document.getElementById('tour-search-status');
        const results = document.getElementById('tour-search-results');
        if (!state.tour || !input || !scope || !status || !results) return;
        currentTourSearchMatches = searchTour(state.tour, input.value, scope.value);
        if (!input.value.trim()) {
            status.textContent = 'Cmd/Ctrl+Shift+F';
            results.replaceChildren();
            return;
        }
        status.textContent = `${currentTourSearchMatches.length} result${currentTourSearchMatches.length === 1 ? '' : 's'}`;
        results.replaceChildren(...currentTourSearchMatches.map((match, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tour-search-result';
            button.setAttribute('role', 'option');
            button.dataset.tourSearchResult = String(index);
            button.title = `Open ${match.kind === 'code' ? `${match.label}:${match.lineNumber}` : match.label}`;
            const location = document.createElement('span');
            location.className = 'tour-search-location';
            location.textContent = match.kind === 'code' ? `${match.label}:${match.lineNumber}` : match.label;
            const preview = document.createElement('span');
            preview.className = 'tour-search-preview';
            preview.textContent = match.preview.trim();
            button.append(location, preview);
            return button;
        }));
    }

    function openTourSearchResult(index) {
        const match = currentTourSearchMatches[index];
        if (!match) return;
        if (match.kind === 'narrative') {
            cancelPendingModeRestore();
            showTourScene(match.sceneIndex, match.stepIndex ?? 0, { showIntro: match.stepIndex === undefined });
            return;
        }
        if (!showTourFileAtIndex(match.fileIndex)) return;
        setSceneIntroVisible(false);
        window.requestAnimationFrame(() => emit({
            type: 'revealSearchResult',
            sideIndex: match.sideIndex,
            lineNumber: match.lineNumber,
            startColumn: match.startColumn,
            endColumn: match.endColumn
        }));
    }

    function initializeTourSidebar() {
        const shell = document.getElementById('tour-shell');
        const resizer = document.getElementById('tour-sidebar-resizer');
        const hideButton = document.getElementById('tour-sidebar-hide');
        const showButton = document.getElementById('tour-sidebar-show');
        if (!shell || !resizer || !hideButton || !showButton) {
            return;
        }

        applyTourSidebarWidth();
        hideButton.addEventListener('click', () => setTourSidebarHidden(true));
        showButton.addEventListener('click', () => setTourSidebarHidden(false));

        resizer.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            document.body.classList.add('is-resizing-tour-sidebar');
            resizer.setPointerCapture?.(event.pointerId);

            const move = (moveEvent) => setTourSidebarWidth(moveEvent.clientX);
            const finish = () => {
                document.body.classList.remove('is-resizing-tour-sidebar');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                preferences.setItem(TOUR_SIDEBAR_STORAGE_KEY, String(state.tourSidebarWidth));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
        });

        resizer.addEventListener('keydown', (event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                return;
            }
            event.preventDefault();
            let nextWidth = state.tourSidebarWidth;
            if (event.key === 'Home') {
                nextWidth = TOUR_SIDEBAR_MIN_WIDTH;
            } else if (event.key === 'End') {
                nextWidth = maximumTourSidebarWidth();
            } else {
                nextWidth += event.key === 'ArrowLeft' ? -16 : 16;
            }
            setTourSidebarWidth(nextWidth);
            preferences.setItem(TOUR_SIDEBAR_STORAGE_KEY, String(state.tourSidebarWidth));
        });
    }

    function readStoredTourSidebarWidth() {
        const stored = Number.parseInt(preferences.getItem(TOUR_SIDEBAR_STORAGE_KEY) || '', 10);
        return Number.isFinite(stored)
            ? Math.min(TOUR_SIDEBAR_MAX_WIDTH, Math.max(TOUR_SIDEBAR_MIN_WIDTH, stored))
            : 300;
    }

    function maximumTourSidebarWidth() {
        return Math.max(TOUR_SIDEBAR_MIN_WIDTH, Math.min(TOUR_SIDEBAR_MAX_WIDTH, Math.floor(window.innerWidth * 0.6)));
    }

    function setTourSidebarWidth(width) {
        state.tourSidebarWidth = Math.min(maximumTourSidebarWidth(), Math.max(TOUR_SIDEBAR_MIN_WIDTH, Math.round(width)));
        applyTourSidebarWidth();
        window.dispatchEvent(new Event('resize'));
    }

    function applyTourSidebarWidth() {
        document.documentElement.style.setProperty('--tour-rail-width', `${state.tourSidebarWidth}px`);
        const resizer = document.getElementById('tour-sidebar-resizer');
        resizer?.setAttribute('aria-valuemax', String(maximumTourSidebarWidth()));
        resizer?.setAttribute('aria-valuenow', String(state.tourSidebarWidth));
    }

    function setTourSidebarHidden(hidden) {
        state.tourSidebarHidden = hidden;
        document.body.classList.toggle('tour-sidebar-hidden', hidden);
        const showButton = document.getElementById('tour-sidebar-show');
        if (showButton) {
            showButton.hidden = !hidden;
        }
        window.dispatchEvent(new Event('resize'));
    }

    function initializeTourNarrativeResizer() {
        const resizer = document.getElementById('tour-narrative-resizer');
        if (!resizer) return;

        applyTourNarrativeHeight();
        resizer.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            document.body.classList.add('is-resizing-tour-narrative');
            resizer.setPointerCapture?.(event.pointerId);
            window.dispatchEvent(new CustomEvent('bygone:workspace-resize-start'));

            const narrativeTop = document.getElementById('tour-narrative').getBoundingClientRect().top;
            const move = (moveEvent) => setTourNarrativeHeight(moveEvent.clientY - narrativeTop);
            const finish = () => {
                document.body.classList.remove('is-resizing-tour-narrative');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                window.dispatchEvent(new CustomEvent('bygone:workspace-resize-end'));
                preferences.setItem(TOUR_NARRATIVE_STORAGE_KEY, String(state.tourNarrativeHeight));
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', finish);
            window.addEventListener('pointercancel', finish);
        });

        resizer.addEventListener('keydown', (event) => {
            if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const nextHeight = event.key === 'Home'
                ? TOUR_NARRATIVE_MIN_HEIGHT
                : event.key === 'End'
                    ? maximumTourNarrativeHeight()
                    : state.tourNarrativeHeight + (event.key === 'ArrowUp' ? -16 : 16);
            setTourNarrativeHeight(nextHeight);
            preferences.setItem(TOUR_NARRATIVE_STORAGE_KEY, String(state.tourNarrativeHeight));
        });

        window.addEventListener('resize', applyTourNarrativeHeight);
    }

    function readStoredTourNarrativeHeight() {
        const stored = Number.parseInt(preferences.getItem(TOUR_NARRATIVE_STORAGE_KEY) || '', 10);
        return Number.isFinite(stored) ? stored : Math.min(window.innerHeight * 0.38, 360);
    }

    function maximumTourNarrativeHeight() {
        return Math.max(TOUR_NARRATIVE_MIN_HEIGHT, window.innerHeight - TOUR_DIFF_MIN_HEIGHT);
    }

    function setTourNarrativeHeight(height) {
        state.tourNarrativeHeight = height;
        applyTourNarrativeHeight();
    }

    function applyTourNarrativeHeight() {
        state.tourNarrativeHeight = Math.min(
            maximumTourNarrativeHeight(),
            Math.max(TOUR_NARRATIVE_MIN_HEIGHT, Math.round(state.tourNarrativeHeight))
        );
        document.getElementById('tour-narrative').style.height = `${state.tourNarrativeHeight}px`;
        const resizer = document.getElementById('tour-narrative-resizer');
        resizer?.setAttribute('aria-valuemax', String(maximumTourNarrativeHeight()));
        resizer?.setAttribute('aria-valuenow', String(state.tourNarrativeHeight));
    }

    function initializeTourNarrativeLayout() {
        const narrative = document.getElementById('tour-narrative');
        if (!narrative) return;
        const updateHeight = () => {
            const height = narrative.hidden ? 0 : Math.ceil(narrative.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--tour-narrative-height', `${height}px`);
            const content = document.getElementById('tour-narrative-content');
            content?.style.setProperty('--tour-reading-viewport', `${content.clientHeight}px`);
            updateStickySceneHeaders();
            window.dispatchEvent(new Event('resize'));
        };
        new ResizeObserver(updateHeight).observe(narrative);
        updateHeight();
    }

    async function loadTour(manifestUrl) {
        setStatus('Loading change tour…');
        const nextHistoryPrefix = historyPrefixForManifest(manifestUrl);
        const previousState = {
            ...state,
            historyEntries: [...state.historyEntries],
            fileHistoryCache: new Map(state.fileHistoryCache),
            displayedPanels: [...state.displayedPanels],
            historyPanels: [...state.historyPanels],
            comparisonCommits: [...state.comparisonCommits],
            comparisonDraftCommits: [...state.comparisonDraftCommits]
        };
        const previousBodyClassName = document.body.className;
        const previousTourShellHidden = document.getElementById('tour-shell')?.hidden;
        const previousNarrativeHidden = document.getElementById('tour-narrative')?.hidden;
        const previousModeControlsHidden = document.getElementById('tour-mode-controls')?.hidden;
        const previousRenderRequestId = renderRequestId;
        const previousZoomRestore = zoomRestore;
        const previousZoomRestoreRequestId = zoomRestoreRequestId;
        const previousEvidenceRequest = evidenceRequest;
        try {
            narrationController.stop();
            let payload = exportData?.manifest;
            if (!exportData) {
                const response = await fetch(manifestUrl, { cache: 'no-store' });
                if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
                payload = await response.json();
            }
            const parsedTour = parseChangeTourManifest(payload, { exported: Boolean(exportData) });
            const requestedDocumentLocation = parseDocumentFragment(window.location.hash);
            if (requestedDocumentLocation) resolveDocumentFocus(parsedTour, requestedDocumentLocation.mode, requestedDocumentLocation.focus);
            const tours = authoredTours(parsedTour);
            const initialMode = tours.deconstructed ? 'deconstructed' : 'historical';
            const parsedHistoryEntries = supportsWorkspaceHistory(parsedTour)
                ? (await historyRequest(
                    'list',
                    { commit: parsedTour.range.headOid },
                    nextHistoryPrefix,
                    parsedTour
                )).entries
                : [];
            state.tour = parsedTour;
            state.authoredTour = parsedTour;
            state.historyPrefix = nextHistoryPrefix;
            state.zoom = new TourZoomSession(initialMode);
            state.historyEntries = parsedHistoryEntries;
            if (state.zoom) state.tour = zoomTour(initialMode);
            state.mode = 'tour';
            document.body.classList.add('tour-mode');
            renderTourShell();
            renderZoomControl();
            renderTourSearchResults();
            const parameters = new URLSearchParams(window.location.search);
            const requestedPosition = resolveTourPosition(
                state.tour.scenes,
                parameters.get('scene'),
                parameters.get('step')
            );
            showTourScene(requestedPosition.sceneIndex, requestedPosition.stepIndex, {
                showIntro: parameters.get('view') === 'overview' || !parameters.get('step'),
                readingKey: !parameters.get('scene') && !parameters.get('step') ? 'title' : undefined
            });
            if (['tour', 'chapter'].includes(parameters.get('view'))) setNarrativeView(parameters.get('view'));
            if (state.zoom) {
                const aliases = {
                    explanation: 'deconstructed',
                    revisions: 'historical',
                    final: legacyFinalTour() ? 'historical' : 'compare'
                };
                const requestedMode = aliases[parameters.get('mode')] || parameters.get('mode');
                if (requestedMode === 'history' && availableModes().includes('history')) {
                    state.historyPath = parameters.get('file');
                    state.tourNavigatorTab = 'commits';
                    state.zoom.enter('history');
                    state.tour = zoomTour('history');
                    renderTourShell();
                    renderZoomControl();
                    await showZoomHistory(state.historyPath || state.tour.files.find((file) => file.kind === 'text-diff')?.path, parameters.get('commit'));
                } else if (requestedMode === 'compare' && availableModes().includes('compare')) {
                    const encodedCommits = parameters.get('commits')?.split(',').filter(Boolean);
                    await switchZoomMode('compare', {
                        commits: encodedCommits?.length
                            ? encodedCommits
                            : [
                                parameters.get('from') || state.authoredTour.range.mergeBaseOid,
                                parameters.get('to') || state.authoredTour.range.headOid
                            ],
                        ...(parameters.get('scope') ? { path: parameters.get('scope') } : {})
                    }, parameters.get('file'));
                } else if (requestedMode && requestedMode !== state.zoom.mode && availableModes().includes(requestedMode)) {
                    await switchZoomMode(requestedMode);
                    const position = resolveTourPosition(state.tour.scenes, parameters.get('scene'), parameters.get('step'));
                    showTourScene(position.sceneIndex, position.stepIndex, {
                        showIntro: parameters.get('view') === 'overview' || !parameters.get('step'),
                        readingKey: !parameters.get('scene') && !parameters.get('step') ? 'title' : undefined
                    });
                    if (['tour', 'chapter'].includes(parameters.get('view'))) setNarrativeView(parameters.get('view'));
                }
                const requestedEmbeddedMode = pendingEmbeddedWorkspaceMode;
                pendingEmbeddedWorkspaceMode = null;
                if (embeddedWorkspaceMode && requestedEmbeddedMode
                    && requestedEmbeddedMode !== state.zoom.mode
                    && availableModes().includes(requestedEmbeddedMode)) {
                    await switchZoomMode(requestedEmbeddedMode);
                }
            }
            if (state.directoryEvidence && parameters.get('file')) openTourDirectoryFile(parameters.get('file'));
            renderNarrationPlaybackState(narrationController.state);
            state.workspacePromptStatus = '';
            renderWorkspaceControls();
            setStatus('');
            if (requestedDocumentLocation) await openDocumentLocation(requestedDocumentLocation);
            else if (isNarrativeMode()) window.history.replaceState(null, '', serializeDocumentFragment(state.zoom.mode,
                focusForReadingItem(readingItems.find(item => item.key === state.readingKey))));
            document.getElementById('export-loading')?.remove();
            window.__BYGONE_EXPORT_READY__ = Boolean(exportData);
            documentLocationReady = true;
            return true;
        } catch (error) {
            const loading = document.getElementById('export-loading');
            if (loading) loading.textContent = `Could not open export: ${error.message}`;
            Object.assign(state, previousState);
            renderRequestId = previousRenderRequestId;
            zoomRestore = previousZoomRestore;
            zoomRestoreRequestId = previousZoomRestoreRequestId;
            evidenceRequest = previousEvidenceRequest;
            document.body.className = previousBodyClassName;
            const tourShell = document.getElementById('tour-shell');
            if (tourShell && previousTourShellHidden !== undefined) tourShell.hidden = previousTourShellHidden;
            const narrative = document.getElementById('tour-narrative');
            if (narrative && previousNarrativeHidden !== undefined) narrative.hidden = previousNarrativeHidden;
            const modeControls = document.getElementById('tour-mode-controls');
            if (modeControls && previousModeControlsHidden !== undefined) modeControls.hidden = previousModeControlsHidden;
            if (state.mode === 'tour' && state.tour) {
                renderTourShell();
                renderZoomControl();
                renderTourSearchResults();
                renderWorkspaceControls();
            }
            setStatus(`Could not load change tour: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    function renderTourShell() {
        renderDirectoryOverviewBreadcrumb();
        const tour = state.tour;
        if (!tour) {
            return;
        }
        const shell = document.getElementById('tour-shell');
        const title = document.getElementById('tour-title');
        const source = document.getElementById('tour-source');
        const range = document.getElementById('tour-range');
        const stats = document.getElementById('tour-stats');
        const authoringCoverage = document.getElementById('tour-authoring-coverage');
        const scenes = document.getElementById('tour-scenes');
        const sceneCount = document.getElementById('tour-scene-count');
        const files = document.getElementById('tour-files');
        const fileCount = document.getElementById('tour-file-count');
        if (!shell || !title || !source || !range || !stats || !authoringCoverage || !scenes || !sceneCount || !files || !fileCount) {
            throw new Error('Presenter UI is incomplete.');
        }
        shell.hidden = false;
        title.textContent = tour.title;
        document.title = buildTourWindowTitle(tour);
        if (tour.sourceUrl) {
            source.href = tour.sourceUrl;
            source.hidden = false;
        } else {
            source.removeAttribute('href');
            source.hidden = true;
        }
        const baseLabel = formatTourRef(tour.range.baseRef);
        const headLabel = formatTourRef(tour.range.headRef);
        const resolvedHead = tour.range.headOid.slice(0, 7);
        range.textContent = `${baseLabel} → ${headLabel}${headLabel === resolvedHead ? '' : ` · ${resolvedHead}`}`;
        stats.textContent = `${formatCount(tour.summary.changedFiles, 'file')} · +${tour.summary.additions} −${tour.summary.deletions} · ${formatCount(tour.summary.commitCount, 'commit')}`;
        renderAuthoringCoverage(authoringCoverage, tour.authoringCoverage);
        sceneCount.textContent = isNarrativeMode() && tour.scenes.length ? String(tour.scenes.length) : '';
        fileCount.textContent = String(tour.files.length);
        scenes.replaceChildren();
        if (isNarrativeMode()) buildReadingDocument();
        const sceneById = new Map(tour.scenes.map((scene) => [scene.id, scene]));
        for (const chapter of tour.chapters) {
            const chapterGroup = createOutlineGroup(`chapter:${chapter.id}`, chapter.title, 'tour-chapter-link', () => {
                const item = readingItems.find((entry) => entry.kind === 'chapter' && entry.chapterId === chapter.id)
                    || readingItems.find((entry) => entry.kind === 'scene' && chapter.sceneIds.includes(tour.scenes[entry.sceneIndex]?.id));
                if (item) activateReadingItem(item);
            });
            const chapterContent = tour.chapters.length > 1 ? chapterGroup.children : scenes;
            if (tour.chapters.length > 1) scenes.append(chapterGroup.group);
            for (const sceneId of chapter.sceneIds) {
                const scene = sceneById.get(sceneId);
                if (!scene) {
                    continue;
                }
                const index = tour.scenes.indexOf(scene);
                const group = createOutlineGroup(`scene:${scene.id}`, scene.title, 'tour-scene', () => showTourScene(index, 0, {
                    userNavigation: true, showIntro: true
                }));
                const button = group.link;
                button.replaceChildren();
                button.dataset.sceneId = scene.id;
                if (scene.kind === 'text-diff') button.dataset.filePath = scene.path;
                group.link.title = `Open scene: ${scene.kind === 'text-diff' ? scene.path : scene.title}`;
                const number = document.createElement('span');
                number.className = 'tour-scene-number';
                number.textContent = String(index + 1).padStart(2, '0');
                const copy = document.createElement('span');
                copy.className = 'tour-scene-copy';
                for (const [className, text] of [
                    ['tour-scene-title', scene.title],
                    ['tour-scene-path', scene.kind === 'text-diff'
                        ? scene.path
                        : scene.kind === 'deconstructed-diff'
                            ? `${formatCount(scene.panels.length - 1, 'comparison stage')} · ${formatCount(scene.steps.length, 'tour slide')}`
                            : isSteppedTourScene(scene)
                                ? formatCount(scene.steps.length, scene.steps.every(step => step.image) ? 'image' : 'step')
                                : 'Discussion'],
                    ['tour-scene-note', scene.takeaway]
                ]) {
                    const line = document.createElement('span');
                    line.className = className;
                    line.textContent = text;
                    copy.append(line);
                }
                button.append(number, copy);
                chapterContent.append(group.group);
                if (isSteppedTourScene(scene)) {
                    const steps = group.children;
                    steps.classList.add('tour-outline-steps');
                    steps.dataset.sceneId = scene.id;
                    scene.steps.forEach((step, stepIndex) => {
                        const stepButton = document.createElement('button');
                        stepButton.type = 'button';
                        stepButton.className = 'tour-outline-step';
                        stepButton.dataset.sceneId = scene.id;
                        stepButton.dataset.stepIndex = String(stepIndex);
                        const stage = scene.kind === 'deconstructed-diff'
                            ? `Stage ${(step.stageIndex ?? step.pairIndex) + 1}: ` : '';
                        stepButton.textContent = `${stepIndex + 1}. ${stage}${step.title}`;
                        stepButton.title = `Open step ${stepIndex + 1}: ${step.title}`;
                        stepButton.addEventListener('click', () => showTourScene(index, stepIndex, {
                            userNavigation: true,
                            showIntro: false
                        }));
                        steps.append(stepButton);
                    });
                } else group.toggle.hidden = true;
            }
        }
        files.replaceChildren(...tour.files.map((file, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `tour-file${file.kind === 'omitted' ? ' is-omitted' : ''}`;
            button.dataset.filePath = file.path;
            button.disabled = file.kind === 'omitted';
            button.title = file.kind === 'omitted'
                ? `${file.path}: ${file.reason}`
                : `Open file: ${file.path}`;
            if (file.kind === 'text-diff') {
                button.addEventListener('click', () => showTourFileSelection(index));
            }
            const marker = document.createElement('span');
            marker.className = 'tour-file-marker';
            marker.textContent = file.kind === 'omitted' ? '×' : changeKindMarker(file.changeKind);
            const copy = document.createElement('span');
            copy.className = 'tour-file-copy';
            const pathLine = document.createElement('span');
            pathLine.className = 'tour-file-path';
            pathLine.textContent = file.path;
            const meta = document.createElement('span');
            meta.className = 'tour-file-meta';
            meta.textContent = file.kind === 'omitted'
                ? `Not rendered · ${file.reason}`
                : `${formatChangeKind(file.changeKind)} · +${file.additions} −${file.deletions}`;
            copy.append(pathLine, meta);
            button.append(marker, copy);
            return button;
        }));
        setTourNavigatorTab(state.tourNavigatorTab);
    }

    function renderAuthoringCoverage(container, coverage) {
        container.replaceChildren();
        container.hidden = !coverage;
        if (!coverage) return;
        const rows = [{
            metric: 'walkthrough',
            label: 'Anchored diff hunks',
            covered: coverage.walkthrough.coveredUnits,
            total: coverage.walkthrough.includedUnits,
            percent: coverage.walkthrough.coveragePercent,
            description: 'Distinct change hunks referenced by authored base/head focus anchors. Revision-stack steps are not counted.'
        }, ...coverage.explanationAssignments.map((assignment) => ({
            metric: 'assignment',
            label: coverage.explanationAssignments.length > 1
                ? `Deconstructed assignment · ${assignment.sceneId}`
                : 'Deconstructed assignment',
            covered: assignment.completeUnits,
            total: assignment.totalUnits,
            percent: assignment.assignmentPercent,
            description: `${assignment.assignedUnits} assigned, ${assignment.excludedUnits} explicitly excluded.`
        }))];
        for (const row of rows) {
            const item = document.createElement('div');
            item.className = 'tour-coverage-item';
            item.dataset.metric = row.metric;
            item.dataset.tooltip = row.description;
            item.tabIndex = 0;
            item.setAttribute('aria-description', row.description);
            const heading = document.createElement('div');
            heading.className = 'tour-coverage-heading';
            const label = document.createElement('span');
            label.textContent = row.label;
            const value = document.createElement('strong');
            value.textContent = `${row.covered}/${row.total} · ${row.percent}%`;
            heading.append(label, value);
            const meter = document.createElement('div');
            meter.className = 'tour-coverage-meter';
            meter.setAttribute('role', 'progressbar');
            meter.setAttribute('aria-label', row.label);
            meter.setAttribute('aria-valuemin', '0');
            meter.setAttribute('aria-valuemax', '100');
            meter.setAttribute('aria-valuenow', String(row.percent));
            const fill = document.createElement('span');
            fill.style.width = `${row.percent}%`;
            meter.append(fill);
            item.append(heading, meter);
            container.append(item);
        }
    }

    function showTourScene(index, stepIndex = 0, options = {}) {
        const tour = state.tour;
        if (!tour || index < 0 || index >= tour.scenes.length) {
            return null;
        }
        imageViewer.clear();
        if (options.userNavigation) cancelPendingModeRestore();
        if (state.zoom?.mode === 'history' && !state.zoomSwitching) {
            const scene = tour.scenes[index];
            const path = scene.path || scene.steps?.[stepIndex]?.file || state.activeTourFilePath;
            void showZoomHistory(path, state.historyCommit).catch((error) => { document.getElementById('tour-mode-status').textContent = error.message; });
            return null;
        }
        state.directoryEvidence = null;
        renderDirectoryOverviewBreadcrumb();
        buildReadingDocument();
        const readingItem = readingItems.find((item) => item.key === options.readingKey)
            || resolveTourReadingItem(readingItems, index, stepIndex, options.showIntro ? 'overview' : null);
        if (readingItem) {
            index = readingItem.sceneIndex;
            stepIndex = readingItem.stepIndex;
        }
        const scene = tour.scenes[index];
        state.readingKey = readingItem?.key || 'title';
        state.sceneIntroVisible = readingItem?.kind !== 'step';
        state.narrativeParent = readingItem?.kind === 'title' ? 'tour' : readingItem?.kind === 'chapter' ? 'chapter' : null;
        state.activeSceneIndex = index;
        state.activeStepIndex = isSteppedTourScene(scene)
            ? Math.min(Math.max(stepIndex, 0), Math.max(scene.steps.length - 1, 0))
            : 0;
        state.tourFocusFilePath = scene.kind === 'text-diff'
            ? scene.path
            : scene.kind === 'walkthrough'
                ? scene.steps[state.activeStepIndex]?.diff.path ?? null
                : isMultiPanelTourScene(scene)
                    ? scene.steps[state.activeStepIndex]?.file ?? null
                : null;
        const location = getSceneLocation(tour, index);
        updateReadingSelection();
        const narrationUnit = buildActiveNarrationUnit(options.narrationEntry || 'playback-start');
        state.renderedNarrationUnit = narrationUnit;
        renderTourNarrative(scene, location, narrationUnit);
        if (!options.fromReadingScroll) scrollToReadingItem(state.readingKey);
        if (narrationUnit && !options.zoomLanding && (!state.zoom || isNarrativeMode())) {
            if (options.narrationNavigation === 'linear') {
                narrationController.followLinearNavigation(narrationUnit);
            } else if (options.narrationNavigation !== 'controller') {
                narrationController.followDirectNavigation(narrationUnit);
            }
        }
        updateTourLocationUrl();
        if (state.sceneIntroVisible && showTourDirectoryOverview()) return narrationUnit;
        if (scene.kind === 'discussion') {
            ++renderRequestId;
            state.displayedPanels = [];
            state.activeTourFilePath = null;
            emit({ type: 'updateCommitHistory', history: sharedCommitHistory() });
            document.body.classList.add('tour-discussion');
            updateTourFileSelection();
            return narrationUnit;
        }
        document.body.classList.remove('tour-discussion');
        if (scene.kind === 'walkthrough') {
            renderWalkthroughStep(scene);
            return narrationUnit;
        }
        if (isMultiPanelTourScene(scene)) {
            renderMultiPanelStep(scene);
            return narrationUnit;
        }
        emitDiffScene(scene, buildTourAnnotationsForFile(scene.path));
        return narrationUnit;
    }

    function setDirectoryOverviewStatus(message) {
        const banner = document.getElementById('status-banner');
        banner.textContent = message;
        banner.hidden = !message;
    }

    function showTourDirectoryOverview() {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!isNarrativeMode() || !scene) return false;
        if (!state.narrativeParent && scene.kind === 'text-diff') return false;
        // The title describes the full tour; scene overviews retain their exact
        // authored comparison (including synthetic intermediate snapshots).
        const evidenceScene = state.narrativeParent === 'tour'
            ? { ...scene, kind: 'discussion', overview: undefined } : scene;
        const evidence = buildTourDirectoryEvidence(state.tour, evidenceScene);
        state.directoryEvidence = evidence;
        state.activeTourFilePath = null;
        updateTourFileSelection();
        document.body.classList.remove('tour-discussion');
        emit({
            type: 'showDirectoryDiff',
            leftLabel: evidence.labels[0], rightLabel: evidence.labels[1],
            labels: evidence.labels, entries: evidence.entries, canMutate: false
        });
        setDirectoryOverviewStatus(evidence.entries.length ? '' : 'No changed files in this directory for the selected comparison.');
        updateTourLocationUrl();
        return true;
    }

    function openTourDirectoryFile(path) {
        const evidence = state.directoryEvidence;
        if (!evidence) return false;
        const file = evidence.files.find((candidate) => candidate.path === path);
        if (!file) {
            const omitted = evidence.omitted.find((candidate) => candidate.path === path);
            setDirectoryOverviewStatus(omitted ? `${path}: ${omitted.reason}` : 'This file has no change in the overview comparison.');
            return false;
        }
        cancelPendingModeRestore();
        setDirectoryOverviewStatus('');
        emitDiffScene(file, [], `directory-${state.tour.scenes[state.activeSceneIndex].id}-${path}`);
        updateTourLocationUrl();
        return true;
    }

    function buildTourAnnotationsForFile(filePath) {
        const tour = state.tour;
        if (!tour || !filePath) {
            return [];
        }

        return buildWalkthroughTourAnnotations(
            tour,
            filePath,
            state.activeSceneIndex,
            state.activeStepIndex
        );
    }

    function buildStackedTourAnnotationsForFile(filePath, pairs) {
        const tour = state.tour;
        if (!tour || !filePath) {
            return [];
        }

        return buildStackedTourAnnotations(
            tour,
            filePath,
            state.activeSceneIndex,
            state.activeStepIndex,
            (pairIndex, side) => getFirstChangeSourceRange(pairs?.[pairIndex]?.diffModel, side)
        );
    }

    function getTourFileComparisonId(filePath) {
        return `file::${filePath}`;
    }

    function emitDiffScene(scene, annotations = [], comparisonId = getTourFileComparisonId(scene.path), history = null) {
        const tour = state.tour;
        if (!tour) return;
        imageViewer.clear();
        state.activeTourFilePath = state.zoom?.mode === 'history'
            ? state.historyPath || scene.path
            : scene.path;
        updateTourFileSelection();
        const diffModel = buildTwoWayDiffModel(scene.leftContent, scene.rightContent);
        const leftLabel = formatTourPaneLabel(scene, scene.leftLabel, state.zoom?.mode === 'compare' ? 'from' : 'base');
        const rightLabel = formatTourPaneLabel(scene, scene.rightLabel, state.zoom?.mode === 'compare' ? 'to' : 'head');
        const activeAnnotation = annotations.find((annotation) => annotation.active);
        const fileExists = scene.changeKind === 'added'
            ? { left: false, right: true }
            : scene.changeKind === 'deleted'
                ? { left: true, right: false }
                : { left: true, right: true };
        emit({
            type: 'showDiff',
            file1: `1. ${leftLabel}`,
            file2: `2. ${rightLabel}`,
            comparisonId: `tour-${comparisonId}`,
            leftContent: scene.leftContent,
            rightContent: scene.rightContent,
            canReturnToDirectory: Boolean(state.directoryEvidence),
            sourceInfo: { leftPath: scene.previousPath || scene.path, rightPath: scene.path },
            fileExists,
            diffModel,
            history,
            fileNavigation: {
                canGoPrevious: Boolean(getCurrentTourFileTarget(-1)),
                canGoNext: Boolean(getCurrentTourFileTarget(1))
            },
            editableSides: { left: false, right: false },
            comparisonSummary: scene.takeaway ? `${scene.path} · ${scene.takeaway}` : scene.path,
            initialChangeIndex: activeAnnotation
                ? findChangeIndexAtSourceLine(
                    diffModel,
                    activeAnnotation.side,
                    activeAnnotation.startLine
                )
                : scene.focusChangeIndex,
            tourAnnotations: annotations
        });
    }

    function formatTourPaneLabel(scene, label, role) {
        if (state.zoom?.mode === 'history') return label;
        const suffix = label.startsWith(scene.path) ? label.slice(scene.path.length).trim() : label.trim();
        return suffix ? `${role} ${suffix}` : role;
    }

    function renderWalkthroughStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
        if (step.image) {
            ++renderRequestId;
            state.displayedPanels = [];
            state.activeTourFilePath = step.diff.path;
            imageViewer.show(step.image, step.title);
            updateTourFileSelection();
            return;
        }
        emitDiffScene(
            step.diff,
            buildTourAnnotationsForFile(step.diff.path),
            getTourFileComparisonId(step.diff.path)
        );
    }

    function renderMultiPanelStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
        emitMultiPanelFile(scene, step.file, step);
    }

    function emitMultiPanelFile(scene, filePath, step) {
        const file = getMultiPanelFile(scene, filePath);
        if (!step || !file) return;
        state.activeTourFilePath = file.path;
        updateTourFileSelection();
        const panels = file.panels.map((panel, index) => ({
            id: `${scene.id}-${file.path}-${panel.id}`,
            commit: scene.kind === 'stacked-diff' ? getMultiPanelDefinitions(scene)[index].oid : undefined,
            label: panel.label,
            path: panel.path || file.path,
            content: panel.content,
            savedContent: panel.content,
            dirty: false,
            editable: false,
            stackId: getMultiPanelDefinitions(scene)[index].id
        }));
        const pairs = panels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
        }));
        const tourAnnotations = buildStackedTourAnnotationsForFile(file.path, pairs);
        const activeAnnotation = tourAnnotations.find((annotation) => annotation.active);
        const focusPairIndex = activeAnnotation?.pairIndex ?? step.pairIndex;
        const focusSide = activeAnnotation?.side ?? step.side;
        const focusLine = activeAnnotation?.startLine ?? step.startLine;
        const focusModel = pairs[focusPairIndex]?.diffModel;
        const initialChangeIndex = focusModel && focusLine
            ? findChangeIndexAtSourceLine(focusModel, focusSide, focusLine)
            : 0;
        emit({
            type: 'showMultiDiff',
            panels,
            pairs,
            activePanelId: panels[focusPairIndex + (focusSide === 'right' ? 1 : 0)]?.id,
            activePairIndex: focusPairIndex,
            initialChangeIndex,
            revealFirstChangeInEachPanel: scene.kind === 'deconstructed-diff',
            history: null,
            fileNavigation: {
                canGoPrevious: Boolean(getCurrentTourFileTarget(-1)),
                canGoNext: Boolean(getCurrentTourFileTarget(1))
            },
            mutationEnabled: false,
            comparisonSummary: scene.kind === 'deconstructed-diff'
                ? `${scene.stageLabel} · ${file.path} · ${formatTourRef(scene.realRange.baseRef)} → ${formatTourRef(scene.realRange.targetRef)}`
                : `${file.path} · ${scene.takeaway}`,
            tourAnnotations
        });
    }

    function showTourLinear(direction) {
        if (!isNarrativeMode()) return false;
        const target = getTourReadingTarget(readingItems, state.readingKey, direction);
        if (!target) return false;
        activateReadingItem(target);
        return true;
    }

    function getCurrentTourFileTarget(direction) {
        const tour = state.tour;
        if (!tour || (direction !== -1 && direction !== 1)) {
            return null;
        }
        const scene = tour.scenes[state.activeSceneIndex];
        if (state.zoom?.mode === 'history') {
            const index = tour.files.findIndex(file => file.path === state.activeTourFilePath);
            for (let fileIndex = index + direction; fileIndex >= 0 && fileIndex < tour.files.length; fileIndex += direction) {
                const file = tour.files[fileIndex];
                if (file.kind === 'text-diff' && state.historyChangedFiles.has(file.path)) return { fileIndex, path: file.path };
            }
            return null;
        }
        if (state.directoryEvidence) {
            const files = state.directoryEvidence.files;
            const index = files.findIndex((file) => file.path === state.activeTourFilePath);
            const target = files[index + direction];
            const fileIndex = target ? tour.files.findIndex((file) => file.path === target.path) : -1;
            return fileIndex >= 0 ? { fileIndex, path: target.path } : null;
        }
        if (isMultiPanelTourScene(scene)) {
            const pairIndex = scene.steps[state.activeStepIndex]?.pairIndex;
            if (!Number.isInteger(pairIndex)) return null;
            const comparisonFiles = tour.files.flatMap((file) => {
                if (file.kind !== 'text-diff') return [];
                const comparisonFile = getMultiPanelFile(scene, file.path);
                return comparisonFile ? [comparisonFile] : [];
            });
            const target = getMultiPanelChangedFileTarget(
                comparisonFiles,
                pairIndex,
                state.activeTourFilePath,
                direction
            );
            if (!target) return null;
            const fileIndex = tour.files.findIndex((file) => file.kind === 'text-diff' && file.path === target.path);
            return fileIndex >= 0 ? { fileIndex, path: target.path } : null;
        }
        return getTourFileTarget(tour.files, state.activeTourFilePath, direction);
    }

    function showTourFile(direction) {
        const target = getCurrentTourFileTarget(direction);
        return target ? showTourFileSelection(target.fileIndex) : false;
    }

    function showTourFileAtIndex(index, interruptNarration = true) {
        const file = state.tour?.files[index];
        if (!file || file.kind !== 'text-diff') {
            return false;
        }
        if (interruptNarration) narrationController.interruptForExploration();
        emitDiffScene(
            file,
            buildTourAnnotationsForFile(file.path),
            getTourFileComparisonId(file.path)
        );
        return true;
    }

    function showTourFileSelection(index) {
        const selected = state.tour?.files[index];
        if (!selected || selected.kind !== 'text-diff') return false;
        cancelPendingModeRestore();
        if (state.zoom?.mode === 'history') {
            void showZoomHistory(selected.path, state.historyCommit).catch((error) => { document.getElementById('tour-mode-status').textContent = error.message; });
            return true;
        }
        if (state.zoom?.mode === 'compare') {
            return showComparisonFile(selected);
        }
        if (state.directoryEvidence && isNarrativeMode()) return openTourDirectoryFile(selected.path);
        if (!state.zoomSwitching) narrationController.interruptForExploration();
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (isMultiPanelTourScene(scene)) {
            const step = scene.steps[state.activeStepIndex];
            if (step && getMultiPanelFile(scene, selected.path)) {
                emitMultiPanelFile(scene, selected.path, step);
                return true;
            }
            return false;
        }
        return showTourFileAtIndex(index, false);
    }

    function getMultiPanelFile(scene, filePath) {
        const file = scene?.files?.find((candidate) => candidate.path === filePath);
        if (file || scene?.kind !== 'deconstructed-diff') return file;
        const tourFile = state.tour?.files.find((candidate) => candidate.kind === 'text-diff' && candidate.path === filePath);
        if (!tourFile || tourFile.kind !== 'text-diff') return null;
        const exists = tourFile.changeKind !== 'deleted';
        return {
            path: tourFile.path,
            panels: getMultiPanelDefinitions(scene).map((panel) => ({
                id: panel.id,
                label: `${panel.label} / ${tourFile.path}${exists ? '' : ' (absent)'}`,
                path: exists ? tourFile.path : undefined,
                content: exists ? tourFile.rightContent : '',
                exists
            }))
        };
    }

    function returnToTourFocus() {
        if (state.directoryEvidence) return showTourDirectoryOverview();
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!scene || !state.tourFocusFilePath) {
            return false;
        }
        if (scene.kind === 'walkthrough') {
            renderWalkthroughStep(scene);
        } else if (isMultiPanelTourScene(scene)) {
            renderMultiPanelStep(scene);
        } else if (scene.kind === 'text-diff') {
            emitDiffScene(scene, buildTourAnnotationsForFile(scene.path));
        } else {
            return false;
        }
        return true;
    }

    function setTourNavigatorTab(tab) {
        if (!['tour', 'files', 'commits'].includes(tab)) return;
        const tourAvailable = isNarrativeMode() && Boolean(state.tour?.scenes.length);
        if (tab === 'tour' && !tourAvailable) tab = 'commits';
        state.tourNavigatorTab = tab;
        document.querySelectorAll('[data-tour-navigator]').forEach((button) => {
            const active = button.dataset.tourNavigator === tab;
            button.disabled = button.dataset.tourNavigator === 'tour' && !tourAvailable;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll('[data-tour-navigator-panel]').forEach((panel) => {
            panel.hidden = panel.dataset.tourNavigatorPanel !== tab;
        });
        window.dispatchEvent(new CustomEvent('bygone:present-navigator-change', { detail: { tab } }));
        window.dispatchEvent(new Event('resize'));
    }

    function renderDirectoryOverviewBreadcrumb() {
        const visible = Boolean(state.directoryEvidence && isNarrativeMode());
        const filePath = visible ? state.activeTourFilePath : null;
        document.body.classList.toggle('tour-directory-overview', visible);
        document.body.classList.toggle('tour-directory-file-open', Boolean(filePath));
        document.getElementById('tour-directory-breadcrumb').hidden = !visible;
        const root = document.getElementById('tour-directory-root');
        if (filePath) root.removeAttribute('aria-current');
        else root.setAttribute('aria-current', 'location');
        document.getElementById('tour-directory-separator').hidden = !filePath;
        const file = document.getElementById('tour-directory-file');
        file.textContent = filePath || '';
        file.hidden = !filePath;
        const context = document.getElementById('tour-directory-narration-context');
        context.hidden = !filePath;
        context.textContent = `Narration describes the ${state.narrativeParent || 'overview'}`;
    }

    function updateTourFileSelection() {
        renderDirectoryOverviewBreadcrumb();
        const scene = state.tour?.scenes[state.activeSceneIndex];
        const step = isMultiPanelTourScene(scene) ? scene.steps[state.activeStepIndex] : null;
        document.querySelectorAll('.tour-file').forEach((button) => {
            const filePath = button.dataset.filePath;
            button.classList.toggle('is-active', filePath === state.activeTourFilePath);
            button.classList.toggle('is-tour-focus', !state.directoryEvidence && filePath === state.tourFocusFilePath);
            button.disabled = Boolean(state.directoryEvidence && !state.directoryEvidence.files.some((file) => file.path === filePath));
            button.classList.remove('is-comparison-changed', 'is-comparison-empty');
            delete button.dataset.comparisonState;
            const tourFile = state.tour?.files.find((file) => file.path === filePath);
            const marker = button.querySelector('.tour-file-marker');
            const meta = button.querySelector('.tour-file-meta');
            if (state.directoryEvidence && button.disabled && tourFile?.kind === 'text-diff') {
                const label = 'Not in this overview comparison';
                button.setAttribute('title', `${filePath} · ${label}`);
                button.setAttribute('aria-label', `${filePath}, ${label}`);
                if (meta) meta.textContent = label;
                if (marker) marker.textContent = '○';
                return;
            }
            if (state.directoryEvidence && tourFile?.kind === 'text-diff') {
                const evidenceFile = state.directoryEvidence.files.find((file) => file.path === filePath);
                const label = `${formatChangeKind(evidenceFile.changeKind)} in overview`;
                button.setAttribute('title', `${filePath} · ${label}`);
                button.setAttribute('aria-label', `${filePath}, ${label}`);
                if (meta) meta.textContent = label;
                if (marker) marker.textContent = changeKindMarker(evidenceFile.changeKind);
                return;
            }
            if (step && tourFile?.kind === 'text-diff') {
                const comparisonFile = getMultiPanelFile(scene, filePath);
                if (comparisonFile) {
                    const comparisonState = classifyMultiPanelFile(comparisonFile, step.pairIndex);
                    const presentation = getComparisonFileStatePresentation(comparisonState);
                    button.dataset.comparisonState = comparisonState;
                    button.classList.add(presentation.changed ? 'is-comparison-changed' : 'is-comparison-empty');
                    button.setAttribute('title', `${tourFile.path} · ${presentation.label}`);
                    button.setAttribute('aria-label', `${tourFile.path}, ${presentation.label}`);
                    if (marker) marker.textContent = presentation.marker;
                    if (meta) meta.textContent = presentation.label;
                    return;
                }
            }
            if (tourFile) {
                const title = tourFile.kind === 'omitted'
                    ? `${tourFile.path}: ${tourFile.reason}`
                    : `Open file: ${tourFile.path}`;
                button.setAttribute('title', title);
                button.setAttribute('aria-label', title);
                if (marker) marker.textContent = tourFile.kind === 'omitted' ? '×' : changeKindMarker(tourFile.changeKind);
                if (meta) meta.textContent = tourFile.kind === 'omitted'
                    ? `Not rendered · ${tourFile.reason}`
                    : `${formatChangeKind(tourFile.changeKind)} · +${tourFile.additions} −${tourFile.deletions}`;
            }
        });
        document.querySelector(`.tour-file.is-active`)?.scrollIntoView({ block: 'nearest' });
        const returnButton = document.getElementById('tour-return-focus');
        if (returnButton) {
            const inTourMode = isNarrativeMode();
            const imageStep = scene?.kind === 'walkthrough' && scene.steps[state.activeStepIndex]?.image;
            returnButton.hidden = !inTourMode || Boolean(state.directoryEvidence)
                || !state.tourFocusFilePath || (imageStep ? imageViewer.isVisible() : state.activeTourFilePath === state.tourFocusFilePath);
        }
    }

    function getComparisonFileStatePresentation(comparisonState) {
        return ({
            'modified-here': { label: 'Modified here', marker: '•', changed: true },
            'created-here': { label: 'Created here', marker: '+', changed: true },
            'deleted-here': { label: 'Deleted here', marker: '−', changed: true },
            'unchanged-here': { label: 'Unchanged here', marker: '○', changed: false },
            'not-created-yet': { label: 'Not created yet', marker: '…', changed: false },
            'already-deleted': { label: 'Already deleted', marker: '×', changed: false }
        })[comparisonState];
    }

    function isSteppedTourScene(scene) {
        return scene.kind === 'walkthrough'
            || scene.kind === 'stacked-diff'
            || scene.kind === 'deconstructed-diff';
    }

    function isMultiPanelTourScene(scene) {
        return scene?.kind === 'stacked-diff' || scene?.kind === 'deconstructed-diff';
    }

    function getMultiPanelDefinitions(scene) {
        return scene.kind === 'deconstructed-diff' ? scene.panels : scene.stack;
    }

    function changeKindMarker(changeKind) {
        return ({ added: '+', deleted: '−', renamed: '→', modified: '•' })[changeKind] || '•';
    }

    function formatChangeKind(changeKind) {
        return `${changeKind.charAt(0).toUpperCase()}${changeKind.slice(1)}`;
    }

    function getSceneLocation(tour, sceneIndex) {
        const scene = tour.scenes[sceneIndex];
        const chapterIndex = tour.chapters.findIndex((chapter) => chapter.sceneIds.includes(scene.id));
        const chapter = chapterIndex >= 0 ? tour.chapters[chapterIndex] : null;
        const sceneInChapter = chapter ? chapter.sceneIds.indexOf(scene.id) + 1 : sceneIndex + 1;
        const scenesInChapter = chapter ? chapter.sceneIds.length : tour.scenes.length;
        return {
            chapter,
            chapterIndex,
            chapterNumber: chapterIndex >= 0 ? chapterIndex + 1 : sceneIndex + 1,
            sceneInChapter,
            scenesInChapter,
            sceneNumber: sceneIndex + 1,
            sceneCount: tour.scenes.length
        };
    }

    function formatTourBreadcrumb(location, scene, stepIndex) {
        return isSteppedTourScene(scene)
            ? `Scene ${location.sceneNumber} of ${location.sceneCount} · Step ${stepIndex + 1} of ${scene.steps.length}`
            : `Scene ${location.sceneNumber} of ${location.sceneCount}`;
    }

    function findChangeIndexAtSourceLine(diffModel, side, sourceLine) {
        const lines = side === 'left' ? diffModel.leftLines : diffModel.rightLines;
        const renderedIndex = lines.findIndex((line) => line.lineNumber === sourceLine);
        if (renderedIndex < 0) return 0;
        const startKey = side === 'left' ? 'leftStart' : 'rightStart';
        const endKey = side === 'left' ? 'leftEnd' : 'rightEnd';
        const exact = diffModel.blocks.findIndex((block) => renderedIndex >= block[startKey] && renderedIndex < block[endKey]);
        if (exact >= 0) return exact;
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        diffModel.blocks.forEach((block, index) => {
            const candidate = Math.min(Math.abs(renderedIndex - block[startKey]), Math.abs(renderedIndex - block[endKey]));
            if (candidate < distance) { nearest = index; distance = candidate; }
        });
        return nearest;
    }

    function formatTourRef(ref) {
        return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref;
    }

    function formatCount(value, singular) {
        return `${value} ${value === 1 ? singular : `${singular}s`}`;
    }

    function isInteractiveKeyTarget(target) {
        return target instanceof Element && Boolean(target.closest(
            'a, button, input, select, summary, textarea, [contenteditable="true"], [role="textbox"], .monaco-editor'
        ));
    }

    function renderCurrentNarrativeForNarrationUnit(unit) {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!state.tour || !scene) return;
        renderTourNarrative(scene, getSceneLocation(state.tour, state.activeSceneIndex), unit);
    }

    function setSceneIntroVisible(visible) {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!scene) return;
        state.narrativeParent = null;
        state.sceneIntroVisible = visible;
        const item = resolveTourReadingItem(readingItems, state.activeSceneIndex, state.activeStepIndex, visible ? 'overview' : null);
        if (item) state.readingKey = item.key;
        updateReadingSelection();
        renderNarrativeViewControls();
        if (state.sceneIntroVisible && !state.directoryEvidence) {
            showTourDirectoryOverview();
        } else if (!state.sceneIntroVisible && state.directoryEvidence) {
            state.directoryEvidence = null;
            if (scene.kind === 'walkthrough') renderWalkthroughStep(scene);
            else if (isMultiPanelTourScene(scene)) renderMultiPanelStep(scene);
        }
        updateTourLocationUrl();
    }

    function setNarrativeView(view) {
        const item = resolveTourReadingItem(readingItems, state.activeSceneIndex, state.activeStepIndex,
            view === 'scene' ? 'overview' : view === 'step' ? null : view);
        if (item) activateReadingItem(item);
    }

    function readingButton(label, title, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.addEventListener('click', action);
        return button;
    }

    function createOutlineGroup(key, title, className, navigate) {
        const group = document.createElement('div');
        group.className = 'tour-outline-group';
        group.dataset.readingGroup = key;
        const heading = document.createElement('div');
        heading.className = 'tour-outline-heading';
        const children = document.createElement('div');
        children.className = 'tour-outline-children';
        children.id = `outline-${encodeURIComponent(key)}`;
        const collapseKey = `${state.zoom?.mode || 'tour'}:${key}`;
        const toggle = readingButton('▾', `Expand or collapse ${title}`, () => {
            if (collapsedOutline.has(collapseKey)) collapsedOutline.delete(collapseKey);
            else collapsedOutline.add(collapseKey);
            update();
        });
        toggle.className = 'tour-outline-toggle';
        toggle.setAttribute('aria-controls', children.id);
        const update = () => {
            children.hidden = collapsedOutline.has(collapseKey);
            toggle.setAttribute('aria-expanded', String(!children.hidden));
            toggle.textContent = children.hidden ? '▸' : '▾';
        };
        update();
        const link = readingButton(title, `Read ${title}`, navigate);
        link.className = className;
        link.dataset.readingLink = key;
        heading.append(toggle, link);
        group.append(heading, children);
        return { group, children, link, toggle };
    }

    function toggleNarrationSettings() {
        const settings = document.getElementById('tour-audio-settings');
        if (!settings) return;
        settings.hidden = !settings.hidden;
        renderNarrativeViewControls();
    }

    function renderNarrativeViewControls() {
        renderDirectoryOverviewBreadcrumb();
        const narration = document.getElementById('tour-narration');
        const settings = document.getElementById('tour-audio-settings');
        if (narration) {
            const expanded = Boolean(settings && !settings.hidden);
            narration.setAttribute('aria-expanded', String(expanded));
            narration.textContent = expanded ? '›' : '‹ Narration';
            narration.title = expanded ? 'Hide narration controls' : 'Show narration controls';
            narration.setAttribute('aria-label', narration.title);
        }
    }


    function focusForReadingItem(item) {
        if (!item || item.kind === 'title') return { part: 'title' };
        if (item.kind === 'chapter') return { part: 'chapter', chapter: item.chapterId };
        const scene = state.tour.scenes[item.sceneIndex];
        return item.kind === 'scene' ? { part: 'scene', scene: scene.id }
            : { part: 'step', scene: scene.id, step: scene.steps[item.stepIndex].id };
    }

    function makeCopyLocationButton(focus) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tour-copy-location';
        button.setAttribute('aria-label', 'Copy link to this section');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="tour-link-chain" d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2"/><path class="tour-link-check" d="m5 12 4 4L19 6"/></svg>';
        button.title = exportData ? 'Copy location within this export; share the HTML file separately'
            : state.authoredTour?.localSource ? 'Copy local link to the saved current document; evidence may change'
            : 'Copy browser location (requires this presentation server)';
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            const mode = isNarrativeMode() ? state.zoom.mode : Object.keys(authoredTours())[0];
            const source = state.authoredTour.localSource;
            const value = source && !exportData ? serializeDeepLink({ kind: 'tour', ...source, mode, focus })
                : new URL(serializeDocumentFragment(mode, focus), window.location.href).href;
            try {
                await navigator.clipboard.writeText(value);
                button.classList.add('is-copied');
                button.setAttribute('aria-label', 'Link copied');
                setTimeout(() => {
                    button.classList.remove('is-copied');
                    button.setAttribute('aria-label', 'Copy link to this section');
                }, 1800);
            }
            catch {
                const dialog = document.createElement('dialog');
                const label = document.createElement('p'); label.textContent = 'Copy this link:';
                const field = document.createElement('textarea'); field.value = value; field.readOnly = true; field.setAttribute('aria-label', 'Link to this tour location');
                const close = document.createElement('button'); close.textContent = 'Close'; close.addEventListener('click', () => dialog.close());
                dialog.append(label, field, close); document.body.append(dialog);
                dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal(); field.select();
            }
        });
        return button;
    }

    function openDocumentLocation(location) {
        const request = ++documentNavigationId;
        const pending = documentNavigationQueue.then(() => applyDocumentLocation(location, request));
        documentNavigationQueue = pending.catch(() => {});
        return pending;
    }

    async function applyDocumentLocation(location, request) {
        if (!location || !state.authoredTour) return;
        const target = resolveDocumentFocus(state.authoredTour, location.mode, location.focus);
        if (request !== documentNavigationId) return;
        applyingDocumentLocation = true;
        try {
            if (state.zoom.mode !== location.mode) await switchZoomMode(location.mode);
            if (request !== documentNavigationId) return;
            if (state.zoom.mode !== location.mode) throw new Error('The requested tour mode could not be opened.');
            zoomRestore = null;
            showTourScene(target.sceneIndex, target.stepIndex, { readingKey: target.key, showIntro: location.focus.part !== 'step' });
            await new Promise(resolve => window.requestAnimationFrame(resolve));
            if (request !== documentNavigationId) return;
            const element = readingElements.get(target.key);
            if (!element) throw new Error('The requested document section could not be rendered.');
            element.tabIndex = -1;
            element.focus({ preventScroll: true });
            scrollToReadingItem(target.key);
            element.classList.add('tour-link-target');
            window.setTimeout(() => element.classList.remove('tour-link-target'), 1800);
        } finally { applyingDocumentLocation = false; }
    }
    window.addEventListener('hashchange', () => {
        try { void openDocumentLocation(parseDocumentFragment(window.location.hash)).catch(reportModeError); }
        catch (error) { reportModeError(error); }
    });

    function updateTourLocationUrl() {
        if (exportData) return;
        const scene = state.tour?.scenes[state.activeSceneIndex];
        const parameters = new URLSearchParams(window.location.search);
        for (const key of ['from', 'to', 'commits', 'scope', 'commit', 'file']) parameters.delete(key);
        if (state.zoom) parameters.set('mode', state.zoom.mode);
        if (state.zoom && !isNarrativeMode()) {
            for (const key of ['scene', 'step', 'view']) parameters.delete(key);
            if (state.zoom.mode === 'compare' && state.compare) {
                parameters.set('commits', state.compare.commits.join(','));
                if (state.compare.path) parameters.set('scope', state.compare.path);
            }
            if (state.zoom.mode === 'history' && state.historyCommit) parameters.set('commit', state.historyCommit);
            if (state.activeTourFilePath) parameters.set('file', state.zoom.mode === 'history' ? state.historyPath : state.activeTourFilePath);
            window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}${window.location.hash}`);
            return;
        }
        if (!scene) return;
        parameters.set('scene', scene.id);
        const step = isSteppedTourScene(scene) ? scene.steps[state.activeStepIndex] : null;
        if (step) parameters.set('step', step.id);
        else parameters.delete('step');
        if (state.directoryEvidence && state.activeTourFilePath) parameters.set('file', state.activeTourFilePath);
        else parameters.delete('file');
        if (state.narrativeParent) parameters.set('view', state.narrativeParent);
        else if (step && state.sceneIntroVisible) parameters.set('view', 'overview');
        else parameters.delete('view');
        window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}${window.location.hash}`);
    }

    function getActiveStepCodeTarget(scene = state.tour?.scenes[state.activeSceneIndex], stepIndex = state.activeStepIndex) {
        if (!scene || !isSteppedTourScene(scene)) return null;
        const step = scene.steps[stepIndex];
        if (!step) return null;
        if (scene.kind === 'walkthrough') {
            if (step.image) return null;
            const focus = step.focus;
            if (!focus?.path || !Number.isInteger(focus.startLine)) return null;
            return {
                filePath: focus.path,
                sideIndex: focus.revision === 'base' ? 0 : 1,
                lineNumber: focus.startLine,
                label: `${focus.path}:${focus.startLine}`
            };
        }

        let startLine = step.startLine;
        if (!Number.isInteger(startLine)) {
            const file = getMultiPanelFile(scene, step.file);
            const left = file?.panels?.[step.pairIndex];
            const right = file?.panels?.[step.pairIndex + 1];
            if (left && right) {
                const diffModel = buildTwoWayDiffModel(left.content, right.content);
                const range = getFirstChangeSourceRange(diffModel, step.side);
                startLine = range?.startLine;
            }
        }
        if (!step.file || !Number.isInteger(startLine)) return null;
        return {
            filePath: step.file,
            sideIndex: step.pairIndex + (step.side === 'right' ? 1 : 0),
            lineNumber: startLine,
            label: `${step.file}:${startLine}`
        };
    }

    function showActiveStepInCode() {
        const target = getActiveStepCodeTarget();
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (state.sceneIntroVisible || !target || !scene) return false;
        narrationController.interruptForExploration();
        if (state.activeTourFilePath !== target.filePath) {
            const fileIndex = state.tour.files.findIndex((file) => (
                file.kind === 'text-diff' && file.path === target.filePath
            ));
            if (fileIndex < 0) return false;
            const rendered = isMultiPanelTourScene(scene)
                ? showTourFileSelection(fileIndex)
                : showTourFileAtIndex(fileIndex, false);
            if (!rendered) return false;
        }
        window.requestAnimationFrame(() => emit({
            type: 'revealSearchResult',
            sideIndex: target.sideIndex,
            lineNumber: target.lineNumber,
            startColumn: 1,
            endColumn: 1
        }));
        return true;
    }

    function renderTourNarrative(scene, location, narrationUnit) {
        buildReadingDocument();
        document.getElementById('tour-narrative').hidden = false;
        document.getElementById('tour-breadcrumb').textContent = state.narrativeParent === 'tour'
            ? state.tour.title
            : state.narrativeParent === 'chapter' ? location.chapter?.title || 'Chapter'
                : state.sceneIntroVisible ? `Scene ${location.sceneNumber} of ${location.sceneCount} · Overview`
                    : formatTourBreadcrumb(location, scene, state.activeStepIndex);
        // Only refresh sentence spans, never replace the document or disclosures.
        const sceneElement = readingElements.get(`scene:${scene.id}`);
        const step = isSteppedTourScene(scene) ? scene.steps[state.activeStepIndex] : null;
        const stepElement = step && readingElements.get(`step:${scene.id}:${step.id}`);
        for (const element of [sceneElement, stepElement].filter(Boolean)) {
            element.querySelectorAll('[data-reading-field]').forEach((field) => {
                if (field.closest('[data-reading-key]') !== element) return;
                renderNarrationField(field, field.dataset.readingText, {
                    field: field.dataset.readingField,
                    ...(field.dataset.itemIndex !== undefined ? { itemIndex: Number(field.dataset.itemIndex) } : {})
                }, narrationUnit);
            });
        }
        renderNarrativeViewControls();
    }

    function buildReadingDocument() {
        if (readingTour === state.tour) return;
        readingTour = state.tour;
        readingItems = buildTourReadingItems(state.tour, true);
        readingElements.clear();
        const content = document.getElementById('tour-narrative-content');
        const roots = [];
        let sceneGroup;
        const field = (parent, tag, className, text, source, itemIndex) => {
            const element = document.createElement(tag);
            element.className = className;
            // Narration replaces a reading field's contents as it highlights
            // words. Keep heading actions outside that replaceable text.
            const readingField = source && /^h[1-6]$/.test(tag) ? document.createElement('span') : element;
            if (readingField !== element) element.append(readingField);
            readingField.replaceChildren(...renderTourProse(document, text || ''));
            if (source) {
                readingField.dataset.readingField = source;
                readingField.dataset.readingText = text || '';
                if (itemIndex !== undefined) readingField.dataset.itemIndex = String(itemIndex);
            }
            parent.append(element);
            return element;
        };
        const overview = (parent, scene, narrated) => {
            field(parent, 'p', 'tour-narrative-summary', scene.summary, narrated ? 'summary' : null);
            if (scene.bullets.length) {
                const list = document.createElement('ul');
                list.className = 'tour-narrative-bullets';
                scene.bullets.forEach((text, index) => field(list, 'li', '', text, narrated ? 'bullet' : null, index));
                parent.append(list);
            }
            if (scene.takeaway) field(parent, 'p', 'tour-narrative-takeaway', scene.takeaway, narrated ? 'takeaway' : null);
        };
        for (const item of readingItems) {
            const element = document.createElement('section');
            element.className = 'tour-reading-item';
            element.dataset.readingKey = item.key;
            element.dataset.readingKind = item.kind;
            element.dataset.sceneIndex = String(item.sceneIndex);
            element.dataset.stepIndex = String(item.stepIndex);
            const scene = state.tour.scenes[item.sceneIndex];
            if (item.kind === 'title') {
                field(element, 'h1', 'tour-document-title', state.tour.title);
                field(element, 'p', 'tour-document-meta', `${formatTourRef(state.tour.range.mergeBaseOid)} → ${formatTourRef(state.tour.range.headOid)}`);
            } else if (item.kind === 'chapter') {
                field(element, 'h2', 'tour-document-chapter', state.tour.chapters.find((chapter) => chapter.id === item.chapterId)?.title);
            } else if (item.kind === 'scene') {
                element.classList.add('tour-scene-group');
                const header = field(element, 'div', 'tour-scene-header', '');
                const heading = field(header, 'h2', 'tour-scene-heading', scene.title, 'scene-title');
                const titleToggle = document.createElement('button');
                titleToggle.className = 'tour-scene-title-toggle';
                titleToggle.type = 'button';
                titleToggle.title = 'Expand or collapse scene overview';
                titleToggle.disabled = true;
                titleToggle.append(...heading.childNodes);
                heading.append(titleToggle);
                const context = document.createElement('details');
                context.className = 'tour-scene-context';
                const toggle = field(context, 'summary', '', '');
                toggle.setAttribute('aria-label', `Scene overview: ${scene.title}`);
                toggle.dataset.tooltip = 'Expand or collapse scene overview';
                const body = field(context, 'div', 'tour-scene-context-body', '');
                body.id = `scene-overview-${item.sceneIndex}`;
                titleToggle.setAttribute('aria-controls', body.id);
                titleToggle.setAttribute('aria-expanded', 'false');
                titleToggle.addEventListener('click', event => {
                    if (!event.target.closest('a')) context.open = !context.open;
                });
                context.addEventListener('toggle', () => titleToggle.setAttribute('aria-expanded', String(context.open)));
                overview(body, scene, false);
                header.addEventListener('keydown', event => {
                    if (event.key === 'Escape' && context.open) {
                        event.preventDefault(); event.stopPropagation();
                        context.open = false; toggle.focus({ preventScroll: true });
                    }
                });
                header.append(context);
                const intro = field(element, 'div', 'tour-scene-overview', '');
                overview(intro, scene, true);
                const tags = field(intro, 'div', 'tour-narrative-tags', '');
                scene.tags.forEach((tag) => field(tags, 'span', '', tag));
            } else {
                const step = scene.steps[item.stepIndex];
                const stage = scene.kind === 'deconstructed-diff' ? `Stage ${(step.stageIndex ?? step.pairIndex) + 1} · ` : '';
                if (stage) field(element, 'div', 'tour-narrative-chapter', stage);
                field(element, 'h3', 'tour-step-title', step.title, 'step-title');
                field(element, 'p', 'tour-step-body', step.body, 'step-body');
                const requirement = field(element, 'div', 'tour-step-requirement', '');
                renderStepRequirement(requirement, step.requirement);
                if (step.connection) {
                    field(element, 'p', 'tour-connection', `${step.connection.from.path} → ${step.connection.to.path}`);
                    field(element, 'p', 'tour-connection', step.connection.label, 'connection');
                }
                const target = getActiveStepCodeTarget(scene, item.stepIndex);
                if (target) {
                    const code = field(element, 'div', 'tour-step-code', '');
                    field(code, 'span', 'tour-step-code-location', target.label);
                    const button = readingButton('Show in code', `Show ${target.label}`, () => {
                        activateReadingItem(item);
                        showActiveStepInCode();
                    });
                    button.className = 'tour-show-in-code';
                    code.append(button);
                }
            }
            element.querySelector('h1, h2, h3').append(makeCopyLocationButton(focusForReadingItem(item)));
            readingElements.set(item.key, element);
            if (item.kind === 'step') sceneGroup.append(element);
            else {
                roots.push(element);
                sceneGroup = item.kind === 'scene' ? element : null;
            }
        }
        content.replaceChildren(...roots);
        programmaticReadingScroll = content.scrollTop;
    }

    function updateReadingSelection() {
        for (const [key, element] of readingElements) element.classList.toggle('is-active', key === state.readingKey);
        document.querySelectorAll('[data-reading-link], .tour-outline-step, #tour-title').forEach((button) => {
            const scene = state.tour?.scenes[state.activeSceneIndex];
            const step = scene && isSteppedTourScene(scene) ? scene.steps[Number(button.dataset.stepIndex)] : null;
            const key = button.id === 'tour-title' ? 'title' : button.dataset.readingLink
                || (step && button.dataset.sceneId === scene.id ? `step:${scene.id}:${step.id}` : null);
            const active = key === state.readingKey;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'location');
            else button.removeAttribute('aria-current');
        });
        document.querySelectorAll('.tour-outline-group').forEach((group) => {
            group.classList.toggle('has-active', Boolean(group.querySelector('[aria-current="location"]')));
        });
        const outline = document.getElementById('tour-scenes');
        let link = outline?.querySelector('[aria-current="location"]');
        // Follow the passage without reopening groups the reader collapsed.
        while (link && !link.getClientRects().length) {
            const hiddenChildren = link.closest('.tour-outline-children[hidden]');
            link = hiddenChildren?.parentElement.querySelector(':scope > .tour-outline-heading [data-reading-link]');
        }
        if (link && outline.clientHeight) {
            const bounds = outline.getBoundingClientRect();
            const target = link.getBoundingClientRect();
            if (target.top < bounds.top) outline.scrollTop += target.top - bounds.top;
            else if (target.bottom > bounds.bottom) outline.scrollTop += target.bottom - bounds.bottom;
        }
    }

    function scrollToReadingItem(key) {
        const content = document.getElementById('tour-narrative-content');
        const element = readingElements.get(key);
        if (!content || !element) return;
        const header = element.dataset.readingKind === 'step'
            ? element.closest('.tour-scene-group')?.querySelector('.tour-scene-header') : null;
        content.scrollTop += element.getBoundingClientRect().top - content.getBoundingClientRect().top
            - (header?.getBoundingClientRect().height || 0);
        programmaticReadingScroll = content.scrollTop;
        updateStickySceneHeaders();
    }

    function updateStickySceneHeaders() {
        const content = document.getElementById('tour-narrative-content');
        const top = content.getBoundingClientRect().top;
        let height = 0;
        content.querySelectorAll('.tour-scene-header').forEach(header => {
            const bounds = header.parentElement.getBoundingClientRect();
            const stuck = bounds.top < top - 1 && bounds.bottom > top;
            header.classList.toggle('is-stuck', stuck);
            header.querySelector('.tour-scene-title-toggle').disabled = !stuck;
            if (!stuck) header.querySelector('details').open = false;
            else height = Math.max(height, header.getBoundingClientRect().bottom - top);
        });
        content.style.scrollPaddingTop = `${height}px`;
        return height;
    }

    function activateReadingItem(item, fromScroll = false) {
        if (!fromScroll && !applyingDocumentLocation && isNarrativeMode()) {
            window.history.pushState(null, '', serializeDocumentFragment(state.zoom.mode, focusForReadingItem(item)));
        }
        return showTourScene(item.sceneIndex, item.stepIndex, {
            readingKey: item.key, showIntro: item.kind !== 'step',
            userNavigation: true, fromReadingScroll: fromScroll
        });
    }

    function followReadingScroll() {
        if (readingScrollFrame !== null) return;
        readingScrollFrame = window.requestAnimationFrame(() => {
            readingScrollFrame = null;
            if (!isNarrativeMode() || state.zoomSwitching) return;
            const content = document.getElementById('tour-narrative-content');
            const headerHeight = updateStickySceneHeaders();
            if (programmaticReadingScroll !== null && Math.abs(content.scrollTop - programmaticReadingScroll) < 2) return;
            programmaticReadingScroll = null;
            const top = content.getBoundingClientRect().top + headerHeight + 24;
            let active = readingItems[0];
            for (const item of readingItems) {
                if (readingElements.get(item.key).getBoundingClientRect().top > top) break;
                active = item;
            }
            if (active && active.key !== state.readingKey) activateReadingItem(active, true);
        });
    }

    function formatRequirementMeta(requirement) {
        const parts = [];
        if (requirement.source) parts.push(requirement.source);
        if (requirement.confidence) parts.push(`${requirement.confidence} confidence`);
        return parts.join(' · ');
    }

    function renderStepRequirement(element, requirement) {
        if (!requirement) {
            element.hidden = true;
            element.replaceChildren();
            element.removeAttribute('title');
            return;
        }
        const chip = document.createElement('span');
        chip.className = 'tour-requirement-chip';
        chip.dataset.status = requirement.status || 'unspecified';
        chip.textContent = requirement.status
            ? `${requirement.id} · ${requirement.status}`
            : requirement.id;
        const text = document.createElement('span');
        text.className = 'tour-requirement-text';
        text.textContent = requirement.text;
        const children = [chip, text];
        const meta = formatRequirementMeta(requirement);
        if (meta) {
            const metaElement = document.createElement('span');
            metaElement.className = 'tour-requirement-meta';
            metaElement.textContent = meta;
            children.push(metaElement);
        }
        element.replaceChildren(...children);
        element.title = [`${requirement.id}: ${requirement.text}`, meta].filter(Boolean).join(' — ');
        element.hidden = false;
    }

    function renderNarrationField(element, text, source, narrationUnit, affixes = {}) {
        const matchingSegments = narrationUnit?.segments.filter((segment) => (
            segment.source.field === source.field
            && segment.source.itemIndex === source.itemIndex
        )) || [];
        const children = [];
        if (affixes.prefix) children.push(document.createTextNode(affixes.prefix));
        children.push(...renderTourProse(document, text, matchingSegments));
        if (affixes.suffix) children.push(document.createTextNode(affixes.suffix));
        element.replaceChildren(...children);
    }

    function compareTestFiles() {
        narrationController.stop();
        const sample = createJavaScriptSampleFilePair();
        state.mode = 'diff';
        state.comparisonId += 1;
        state.left = {
            name: sample.leftFileName,
            content: sample.leftContent
        };
        state.right = {
            name: sample.rightFileName,
            content: sample.rightContent
        };

        setStatus('Loaded sample diff.');
        emit({
            type: 'showDiff',
            file1: state.left.name,
            file2: state.right.name,
            comparisonId: `web-${state.comparisonId}`,
            leftContent: state.left.content,
            rightContent: state.right.content,
            diffModel: buildTwoWayDiffModel(state.left.content, state.right.content),
            history: null
        });
    }

    async function openDiffFiles(files) {
        narrationController.stop();
        const [leftFile, rightFile] = files;
        const [leftContent, rightContent] = await Promise.all([
            leftFile.text(),
            rightFile.text()
        ]);

        state.mode = 'diff';
        state.comparisonId += 1;
        state.left = {
            name: leftFile.name,
            content: leftContent
        };
        state.right = {
            name: rightFile.name,
            content: rightContent
        };

        setStatus(`Loaded ${leftFile.name} and ${rightFile.name}.`);
        emit({
            type: 'showDiff',
            file1: leftFile.name,
            file2: rightFile.name,
            comparisonId: `web-${state.comparisonId}`,
            leftContent,
            rightContent,
            diffModel: buildTwoWayDiffModel(leftContent, rightContent),
            history: null
        });
    }

    async function openMultiFileDiff(files) {
        narrationController.stop();
        const panels = await Promise.all(files.map(async (file, index) => {
            const content = await file.text();
            return {
                id: `web-panel-${index}`,
                label: file.name,
                content,
                savedContent: content,
                dirty: false,
                editable: true
            };
        }));

        state.mode = 'multi-diff';
        setStatus(`Loaded ${panels.length}-panel diff for ${panels.map((panel) => panel.label).join(', ')}.`);
        emit({
            type: 'showMultiDiff',
            panels,
            pairs: panels.slice(0, -1).map((panel, index) => ({
                leftIndex: index,
                rightIndex: index + 1,
                diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
            }))
        });
    }

    function setStatus(message) {
        const status = document.getElementById('web-status');
        if (status) {
            status.textContent = message;
        }
    }
})();
