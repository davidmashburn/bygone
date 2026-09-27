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

(function initializeWebHost() {
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
        historyPath: null,
        compare: null,
        compareFrom: null,
        activeSceneIndex: -1,
        activeStepIndex: 0,
        sceneIntroVisible: false,
        narrativeParent: null,
        directoryEvidence: null,
        activeTourFilePath: null,
        tourFocusFilePath: null,
        tourSidebarWidth: readStoredTourSidebarWidth(),
        tourSidebarHidden: false,
        tourNarrativeHeight: readStoredTourNarrativeHeight(),
        narrationVoiceURI: window.localStorage.getItem(TOUR_NARRATION_VOICE_STORAGE_KEY) || '',
        narrationRate: readStoredNarrationRate(),
        narrationVoices: [],
        renderedNarrationUnit: null
    };
    const narrationController = new TourNarrationController(createDeviceSpeechEngine(), {
        claimAudio: claimNarrationAudio,
        onStateChange: renderNarrationPlaybackState,
        onSegmentChange: renderNarrationHighlight,
        canNavigateUnit: canNavigateNarrationUnit,
        navigateUnit: navigateNarrationUnit
    });

    window.__BYGONE_HOST__ = {
        environment: 'web',
        editorWorkerUrl: '/media/editor.worker.js',
        diffWorkerUrl: '/media/diff.worker.js',
        postMessage(message) {
            void handleRendererMessage(message);
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        bindControls();
        setStatus('Browser host ready.');
    });

    function emit(message) {
        if (message.type === 'showDiff' || message.type === 'showMultiDiff' || message.type === 'showDirectoryDiff') {
            message = { ...message, renderRequestId: ++renderRequestId };
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

    function markZoomNavigation() {
        if (!state.zoomSwitching) {
            zoomRestore = null;
            state.zoom?.navigate();
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
                    commit: state.historyCommit || definitions[panel + 1]?.oid || state.authoredTour.range.headOid,
                    navigation,
                    focusId: document.activeElement?.id,
                    narrativeParent: state.narrativeParent,
                    sceneIntroVisible: state.sceneIntroVisible,
                    narrativeScroll: document.getElementById('tour-narrative-content')?.scrollTop || 0
                });
            };
            const timer = window.setTimeout(() => finish(null), 1000);
            navigationRequests.set(requestId, (navigation) => { window.clearTimeout(timer); finish(navigation); });
            emit({ type: 'captureNavigationState', requestId });
        });
    }

    const modeLabels = {
        history: 'History', compare: 'Compare', historical: 'Historical tour', deconstructed: 'Deconstructed tour'
    };
    const modeDescriptions = {
        history: 'Explore commits and choose revisions to compare.',
        compare: 'Inspect the changes between two revisions.',
        historical: 'Actual revisions, with explanations of updates, reversals, and decisions.',
        deconstructed: 'The change broken into constructed stages for explanation.'
    };
    let evidenceRequest = 0;

    function authoredTours(tour = state.authoredTour) {
        if (tour.tours) return tour.tours;
        // Compatibility for previously compiled manifests. Never turn a generated
        // revision stack with no authored narration into an additional tour.
        const deconstructed = tour.scenes.some((scene) => scene.kind === 'deconstructed-diff');
        return { [deconstructed ? 'deconstructed' : 'historical']: { scenes: tour.scenes, chapters: tour.chapters } };
    }

    function availableModes() {
        return ['history', 'compare', ...Object.keys(authoredTours()).filter((mode) => authoredTours()[mode])];
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
        controls.hidden = !state.zoom;
        if (!state.zoom) return;
        const select = document.getElementById('tour-mode-select');
        select.replaceChildren();
        for (const [label, modes] of [['Explore', ['history', 'compare']], ['Tours', ['historical', 'deconstructed']]]) {
            const group = document.createElement('optgroup');
            group.label = label;
            for (const mode of modes.filter((item) => availableModes().includes(item))) {
                const option = document.createElement('option');
                option.value = mode;
                option.textContent = modeLabels[mode];
                group.append(option);
            }
            if (group.children.length) select.append(group);
        }
        select.value = state.zoom.mode;
        document.getElementById('tour-mode-description').textContent = modeDescriptions[state.zoom.mode];
        const history = state.zoom.mode === 'history';
        document.getElementById('tour-history-controls').hidden = !history;
        document.getElementById('tour-compare-controls').hidden = state.zoom.mode !== 'compare';
        document.body.classList.toggle('tour-derived-mode', !isNarrativeMode());
        if (!isNarrativeMode()) {
            document.body.classList.remove('tour-discussion');
            setTourFilesOpen(true);
        }
        renderComparisonControls();
    }

    function renderComparisonControls() {
        const range = state.authoredTour.range;
        const refs = new Map([[range.mergeBaseOid, `${range.mergeBaseOid.slice(0, 7)} · Review base`], [range.headOid, `${range.headOid.slice(0, 7)} · Review head`]]);
        for (const item of state.authoredTour.commits) refs.set(item.oid, `${item.shortOid} · ${item.summary}`);
        for (const item of state.historyEntries) refs.set(item.commit, `${item.shortCommit} · ${item.summary}`);
        for (const field of ['from', 'to']) {
            const value = state.compare?.[field] || (field === 'from' ? range.mergeBaseOid : range.headOid);
            if (!refs.has(value)) refs.set(value, value.slice(0, 7));
            const select = document.getElementById(`tour-compare-${field}`);
            select.replaceChildren(...Array.from(refs, ([oid, label]) => {
                const option = document.createElement('option');
                option.value = oid;
                option.textContent = label;
                return option;
            }));
            select.value = value;
        }
        document.getElementById('tour-compare-scope').textContent = state.compare?.path ? `File: ${state.compare.path}` : 'All changed files';
        document.getElementById('tour-compare-all').hidden = !state.compare?.path;
        document.getElementById('tour-history-from-status').textContent = state.compareFrom
            ? `Compare from ${state.compareFrom.commit.slice(0, 7)}. Choose another revision, then Compare to here.` : '';
        document.getElementById('tour-history-to').disabled = !state.compareFrom || !state.historyCommit;
        for (const id of ['tour-history-from', 'tour-history-parent', 'tour-history-base']) document.getElementById(id).disabled = !state.historyCommit;
    }

    async function historyRequest(endpoint, body) {
        const response = await fetch(`/history/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `History request failed (${response.status}).`);
        return result;
    }

    function reportModeError(error) {
        document.getElementById('tour-mode-status').textContent = error instanceof Error ? error.message : String(error);
    }

    async function showZoomHistory(path, commit, reload = true) {
        const request = ++evidenceRequest;
        let entries = state.historyEntries;
        let status = '';
        if (reload) {
            const result = await historyRequest('list', { path, commit: state.authoredTour.range.headOid });
            if (request !== evidenceRequest) return;
            entries = result.entries;
            commit = entries.some((entry) => entry.commit === commit) ? commit : result.selectedCommit;
            status = result.fallback || '';
        }
        if (!commit) throw new Error('No file history is available for this path.');
        const entry = entries.find((item) => item.commit === commit);
        const diff = await historyRequest('diff', { path: entry?.path || path, commit });
        if (request !== evidenceRequest || state.zoom.mode !== 'history') return;
        state.historyEntries = entries;
        if (reload) state.historyPath = path;
        state.historyCommit = commit;
        const select = document.getElementById('tour-history-select');
        select.replaceChildren(...entries.map((item) => {
            const option = document.createElement('option');
            option.value = item.commit;
            option.textContent = `${item.shortCommit} ${item.summary}`;
            return option;
        }));
        select.value = commit;
        emitDiffScene({ ...diff, kind: 'text-diff', takeaway: '', focusChangeIndex: 0 }, [], `history-${commit}-${diff.path}`);
        document.getElementById('tour-mode-status').textContent = status;
        renderComparisonControls();
        updateTourLocationUrl();
    }

    async function showComparison(selection, selectedPath) {
        selection = { from: selection.from, to: selection.to, ...(selection.path ? { path: selection.path } : {}) };
        const request = ++evidenceRequest;
        const result = await historyRequest('compare', selection);
        if (request !== evidenceRequest || state.zoom.mode !== 'compare') return;
        state.compare = { ...selection, files: result.files };
        state.tour = zoomTour('compare');
        state.activeSceneIndex = -1;
        state.tourFocusFilePath = null;
        renderTourShell();
        renderZoomControl();
        renderTourSearchResults();
        const file = result.files.find((item) => item.kind === 'text-diff' && item.path === selectedPath)
            || result.files.find((item) => item.kind === 'text-diff');
        if (file) emitDiffScene({ ...file, takeaway: '' }, [], `compare-${selection.from}-${selection.to}-${file.path}`);
        else {
            state.activeTourFilePath = null;
            emitDiffScene({ path: 'No text changes', leftContent: '', rightContent: '', leftLabel: selection.from.slice(0, 7), rightLabel: selection.to.slice(0, 7), takeaway: '' }, [], `compare-empty-${request}`);
            state.activeTourFilePath = null;
            zoomRestore = null;
        }
        document.getElementById('tour-mode-status').textContent = result.files.length
            ? (file ? '' : 'Changed files cannot be displayed as text. See the file list for details.')
            : 'No changes between these revisions.';
        updateTourLocationUrl();
    }

    async function openComparison(selection) {
        if (state.zoomSwitching) return;
        if (state.zoom.mode !== 'compare') await switchZoomMode('compare', selection);
        else await showComparison(selection, state.activeTourFilePath);
    }

    function finalComparison() {
        return { from: state.authoredTour.range.mergeBaseOid, to: state.authoredTour.range.headOid };
    }

    function selectedHistoryPath() {
        return state.historyEntries.find((entry) => entry.commit === state.historyCommit)?.path || state.historyPath;
    }

    async function switchZoomMode(mode, comparison, selectedPath) {
        if (!state.zoom || state.zoomSwitching || mode === state.zoom.mode || !availableModes().includes(mode)) return;
        state.zoomSwitching = true;
        ++evidenceRequest;
        const previousMode = state.zoom.mode;
        let origin;
        try {
            origin = await captureZoomLocation();
            state.zoom.depart(origin);
            narrationController.pauseForExternalOwner();
            const landing = state.zoom.enter(mode);
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
                await showZoomHistory(state.historyPath || landing.location.path || state.tour.files.find((file) => file.kind === 'text-diff')?.path, landing.location.commit);
            } else if (mode === 'compare') {
                await showComparison(comparison || state.compare || finalComparison(), selectedPath || landing.location.path);
            } else {
                state.historyCommit = null;
                showTourScene(Math.max(0, landing.location.sceneIndex), landing.location.stepIndex, {
                    zoomLanding: true, showIntro: landing.restore ? landing.location.sceneIntroVisible : true
                });
                if (landing.restore && landing.location.narrativeParent) setNarrativeView(landing.location.narrativeParent);
                if (landing.location.path && state.activeTourFilePath !== landing.location.path) {
                    const index = state.tour.files.findIndex((file) => file.path === landing.location.path);
                    if (index >= 0) showTourFileSelection(index);
                }
            }
            updateTourLocationUrl();
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
            }
            renderTourShell();
            renderZoomControl();
            renderTourSearchResults();
            if (origin && isNarrativeMode()) {
                zoomRestore = origin;
                showTourScene(origin.sceneIndex, origin.stepIndex, { zoomLanding: true, showIntro: origin.sceneIntroVisible });
                if (origin.narrativeParent) setNarrativeView(origin.narrativeParent);
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
        if (message.type === 'renderComplete' && zoomRestore && message.renderRequestId === zoomRestoreRequestId) {
            const location = zoomRestore;
            zoomRestore = null;
            emit({ type: 'restoreNavigationState', navigation: location.navigation });
            const narrative = document.getElementById('tour-narrative-content');
            if (narrative) narrative.scrollTop = location.narrativeScroll || 0;
            if (location.focusId && location.focusId !== 'tour-mode-select') document.getElementById(location.focusId)?.focus({ preventScroll: true });
        }

        if (message.type === 'ready') {
            const parameters = new URLSearchParams(window.location.search);
            const manifestUrl = parameters.get('manifest');
            if (manifestUrl) {
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
        document.getElementById('tour-review-toggle')?.addEventListener('click', () => {
            setReviewNotesOpen(document.getElementById('tour-review').hidden);
        });
        document.getElementById('tour-review-close')?.addEventListener('click', () => setReviewNotesOpen(false));
        document.getElementById('tour-review')?.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setReviewNotesOpen(false);
            }
        });
        document.getElementById('tour-mode-select')?.addEventListener('change', (event) => void switchZoomMode(event.target.value));
        document.getElementById('tour-history-select')?.addEventListener('change', (event) => {
            void showZoomHistory(state.historyPath, event.target.value, false).catch(reportModeError);
        });
        const action = (id, handler) => document.getElementById(id)?.addEventListener('click', () => {
            Promise.resolve().then(handler).catch(reportModeError);
        });
        action('tour-history-from', () => {
            state.compareFrom = { commit: state.historyCommit, path: selectedHistoryPath() };
            renderComparisonControls();
        });
        action('tour-history-to', () => openComparison({ from: state.compareFrom.commit, to: state.historyCommit, path: state.compareFrom.path }));
        action('tour-history-parent', () => {
            const parent = state.historyEntries.find((entry) => entry.commit === state.historyCommit)?.parentCommit;
            if (!parent) { reportModeError('This is the first commit; History already shows its comparison with the empty tree.'); return; }
            return openComparison({ from: parent, to: state.historyCommit, path: selectedHistoryPath() });
        });
        action('tour-history-base', () => openComparison({ from: state.authoredTour.range.mergeBaseOid, to: state.historyCommit, path: selectedHistoryPath() }));
        action('tour-history-final', () => openComparison(finalComparison()));
        action('tour-compare-final', () => openComparison(finalComparison()));
        action('tour-compare-swap', () => openComparison({ from: state.compare.to, to: state.compare.from, ...(state.compare.path ? { path: state.compare.path } : {}) }));
        action('tour-compare-all', () => openComparison({ from: state.compare.from, to: state.compare.to }));
        action('tour-compare-clear', async () => {
            state.compareFrom = null;
            await switchZoomMode('history');
            state.compare = null;
        });
        for (const field of ['from', 'to']) document.getElementById(`tour-compare-${field}`)?.addEventListener('change', (event) => {
            const selection = { from: state.compare.from, to: state.compare.to, ...(state.compare.path ? { path: state.compare.path } : {}), [field]: event.target.value };
            void openComparison(selection).catch((error) => { renderComparisonControls(); reportModeError(error); });
        });
        // Only user input counts. Renderer reveals, synchronized scrolling and restores do not.
        for (const type of ['wheel', 'pointerdown', 'keydown']) document.addEventListener(type, (event) => {
            if (!event.isTrusted || event.target?.closest?.('#tour-mode-controls')) return;
            if (event.target?.closest?.('.monaco-editor, .diff-toolbar, #tour-narrative')) markZoomNavigation();
        }, { capture: true, passive: true });
        const compareTestButton = document.getElementById('web-compare-test');
        const openDiffButton = document.getElementById('web-open-diff');
        const openDiff3Button = document.getElementById('web-open-diff3');
        const diffInput = document.getElementById('web-diff-input');
        const diff3Input = document.getElementById('web-diff3-input');
        const tourPrevious = document.getElementById('tour-previous');
        const tourNext = document.getElementById('tour-next');
        const tourNarration = document.getElementById('tour-narration');
        const tourReturnFocus = document.getElementById('tour-return-focus');
        const tourShowInCode = document.getElementById('tour-show-in-code');
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
        initializeNarrationVoices();
        document.getElementById('tour-files-toggle')?.addEventListener('click', () => {
            const files = document.getElementById('tour-files');
            setTourFilesOpen(files.hidden);
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

        tourPrevious?.addEventListener('click', () => showTourLinear(-1));
        tourNext?.addEventListener('click', () => showTourLinear(1));
        tourNarration?.addEventListener('click', () => toggleNarrationSettings());
        tourReturnFocus?.addEventListener('click', returnToTourFocus);
        document.getElementById('tour-directory-root')?.addEventListener('click', () => {
            setNarrativeView('scene');
            document.getElementById('tour-directory-root').focus({ preventScroll: true });
        });
        tourShowInCode?.addEventListener('click', showActiveStepInCode);
        tourSearchInput?.addEventListener('input', renderTourSearchResults);
        tourSearchScope?.addEventListener('change', renderTourSearchResults);
        tourListen?.addEventListener('click', toggleNarrationFromHost);
        tourStop?.addEventListener('click', () => narrationController.stop());
        tourNarrationSkipBack?.addEventListener('click', () => narrationController.skipSegment(-1));
        tourNarrationSkipAhead?.addEventListener('click', () => narrationController.skipSegment(1));
        tourVoice?.addEventListener('change', () => {
            state.narrationVoiceURI = tourVoice.value;
            window.localStorage.setItem(TOUR_NARRATION_VOICE_STORAGE_KEY, state.narrationVoiceURI);
        });
        if (tourRate) {
            tourRate.value = String(state.narrationRate);
            tourRate.addEventListener('change', () => {
                const nextRate = Number(tourRate.value);
                state.narrationRate = NARRATION_RATES.has(nextRate) ? nextRate : 1;
                tourRate.value = String(state.narrationRate);
                window.localStorage.setItem(TOUR_NARRATION_RATE_STORAGE_KEY, String(state.narrationRate));
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
                tourSearchInput?.focus();
                tourSearchInput?.select();
                return;
            }
            if (state.mode !== 'tour' || event.metaKey || event.ctrlKey || event.altKey || isInteractiveKeyTarget(event.target) || event.target.closest?.('#tour-review')) {
                return;
            }
            if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                showTourLinear(-1);
            } else if (event.key === 'PageDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                showTourLinear(1);
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
                .slice()
                .sort((left, right) => Number(right.default) - Number(left.default)
                    || left.lang.localeCompare(right.lang)
                    || left.name.localeCompare(right.name));
            if (state.narrationVoiceURI
                && state.narrationVoices.length > 0
                && !state.narrationVoices.some((voice) => voice.voiceURI === state.narrationVoiceURI)) {
                state.narrationVoiceURI = '';
                window.localStorage.removeItem(TOUR_NARRATION_VOICE_STORAGE_KEY);
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
        const stored = Number(window.localStorage.getItem(TOUR_NARRATION_RATE_STORAGE_KEY));
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
                const selectedVoice = state.narrationVoices.find((voice) => voice.voiceURI === state.narrationVoiceURI);
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
        const element = [...document.querySelectorAll('[data-narration-segment-id]')]
            .find((candidate) => candidate.dataset.narrationSegmentId === segment.id);
        if (!element) return;
        element.classList.add('is-speaking');
        element.classList.toggle('is-paused', paused);
        const context = element.closest('#tour-context');
        if (context) {
            const sceneField = ['chapter', 'scene-title', 'summary', 'bullet', 'takeaway'].includes(segment.source.field);
            setSceneIntroVisible(sceneField);
        } else if (element.closest('#tour-step')) {
            setSceneIntroVisible(false);
        }
        const narrative = document.getElementById('tour-narrative-content');
        if (!narrative) return;
        const elementBounds = element.getBoundingClientRect();
        const narrativeBounds = narrative.getBoundingClientRect();
        if (elementBounds.top < narrativeBounds.top || elementBounds.bottom > narrativeBounds.bottom) {
            element.scrollIntoView({ block: 'nearest' });
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
            markZoomNavigation();
            showTourScene(match.sceneIndex, match.stepIndex ?? 0, { showIntro: false });
            if (match.stepIndex === undefined) {
                setSceneIntroVisible(true);
                document.getElementById('tour-context')?.scrollIntoView({ block: 'start' });
            }
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
                window.localStorage.setItem(TOUR_SIDEBAR_STORAGE_KEY, String(state.tourSidebarWidth));
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
            window.localStorage.setItem(TOUR_SIDEBAR_STORAGE_KEY, String(state.tourSidebarWidth));
        });
    }

    function readStoredTourSidebarWidth() {
        const stored = Number.parseInt(window.localStorage.getItem(TOUR_SIDEBAR_STORAGE_KEY) || '', 10);
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
            event.preventDefault();
            document.body.classList.add('is-resizing-tour-narrative');
            resizer.setPointerCapture?.(event.pointerId);
            window.dispatchEvent(new CustomEvent('bygone:workspace-resize-start'));

            const narrativeTop = document.getElementById('tour-narrative')?.getBoundingClientRect().top || 0;
            const move = (moveEvent) => setTourNarrativeHeight(moveEvent.clientY - narrativeTop);
            const finish = () => {
                document.body.classList.remove('is-resizing-tour-narrative');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', finish);
                window.dispatchEvent(new CustomEvent('bygone:workspace-resize-end'));
                storeTourNarrativeHeight();
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
            storeTourNarrativeHeight();
        });

        window.addEventListener('resize', () => {
            state.tourNarrativeHeight = Math.min(maximumTourNarrativeHeight(), state.tourNarrativeHeight);
            applyTourNarrativeHeight();
        });
    }

    function readStoredTourNarrativeHeight() {
        const stored = Number.parseInt(window.localStorage.getItem(TOUR_NARRATIVE_STORAGE_KEY) || '', 10);
        if (Number.isFinite(stored)) return Math.max(TOUR_NARRATIVE_MIN_HEIGHT, stored);
        const cssDefault = Number.parseInt(
            window.getComputedStyle(document.documentElement).getPropertyValue('--tour-narrative-height'),
            10
        );
        return Number.isFinite(cssDefault) ? cssDefault : 296;
    }

    function maximumTourNarrativeHeight() {
        const narrativeTop = document.getElementById('tour-narrative')?.getBoundingClientRect().top || 0;
        return Math.max(TOUR_NARRATIVE_MIN_HEIGHT, window.innerHeight - narrativeTop - TOUR_DIFF_MIN_HEIGHT);
    }

    function setTourNarrativeHeight(height) {
        state.tourNarrativeHeight = Math.min(
            maximumTourNarrativeHeight(),
            Math.max(TOUR_NARRATIVE_MIN_HEIGHT, Math.round(height))
        );
        applyTourNarrativeHeight();
        window.dispatchEvent(new Event('resize'));
    }

    function applyTourNarrativeHeight() {
        document.documentElement.style.setProperty('--tour-narrative-height', `${state.tourNarrativeHeight}px`);
        const resizer = document.getElementById('tour-narrative-resizer');
        resizer?.setAttribute('aria-valuemax', String(maximumTourNarrativeHeight()));
        resizer?.setAttribute('aria-valuenow', String(state.tourNarrativeHeight));
    }

    function storeTourNarrativeHeight() {
        window.localStorage.setItem(TOUR_NARRATIVE_STORAGE_KEY, String(state.tourNarrativeHeight));
    }

    async function loadTour(manifestUrl) {
        setStatus('Loading change tour…');
        try {
            narrationController.stop();
            const response = await fetch(manifestUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Manifest request failed (${response.status}).`);
            }
            state.tour = parseChangeTourManifest(await response.json());
            state.authoredTour = state.tour;
            const tours = authoredTours();
            const initialMode = tours.deconstructed ? 'deconstructed' : 'historical';
            state.zoom = state.tour.version >= 2 ? new TourZoomSession(initialMode) : null;
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
                showIntro: parameters.get('view') === 'overview' || !parameters.get('step')
            });
            if (['tour', 'chapter'].includes(parameters.get('view'))) setNarrativeView(parameters.get('view'));
            if (state.zoom) {
                const aliases = { explanation: 'deconstructed', revisions: 'historical', final: 'compare' };
                const requestedMode = aliases[parameters.get('mode')] || parameters.get('mode');
                if (requestedMode === 'history') {
                    state.historyPath = parameters.get('file');
                    state.zoom.enter('history');
                    state.tour = zoomTour('history');
                    renderTourShell();
                    renderZoomControl();
                    await showZoomHistory(state.historyPath || state.tour.files.find((file) => file.kind === 'text-diff')?.path, parameters.get('commit'));
                } else if (requestedMode === 'compare') {
                    await switchZoomMode('compare', {
                        from: parameters.get('from') || state.authoredTour.range.mergeBaseOid,
                        to: parameters.get('to') || state.authoredTour.range.headOid,
                        ...(parameters.get('scope') ? { path: parameters.get('scope') } : {})
                    }, parameters.get('file'));
                } else if (requestedMode && requestedMode !== state.zoom.mode && availableModes().includes(requestedMode)) {
                    await switchZoomMode(requestedMode);
                    const position = resolveTourPosition(state.tour.scenes, parameters.get('scene'), parameters.get('step'));
                    showTourScene(position.sceneIndex, position.stepIndex, { showIntro: parameters.get('view') === 'overview' || !parameters.get('step') });
                    if (['tour', 'chapter'].includes(parameters.get('view'))) setNarrativeView(parameters.get('view'));
                }
            }
            if (state.directoryEvidence && parameters.get('file')) openTourDirectoryFile(parameters.get('file'));
            renderNarrationPlaybackState(narrationController.state);
            setStatus('');
        } catch (error) {
            setStatus(`Could not load change tour: ${error instanceof Error ? error.message : String(error)}`);
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
        const commits = document.getElementById('tour-commits');
        const commitsSummary = document.getElementById('tour-commits-summary');
        if (!shell || !title || !source || !range || !stats || !authoringCoverage || !scenes || !sceneCount || !files || !fileCount || !commits || !commitsSummary) {
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
        renderReviewNotes();
        sceneCount.textContent = String(tour.scenes.length);
        fileCount.textContent = String(tour.files.length);
        commitsSummary.textContent = formatCount(tour.summary.commitCount, 'commit');
        scenes.replaceChildren();
        const sceneById = new Map(tour.scenes.map((scene) => [scene.id, scene]));
        for (const chapter of tour.chapters) {
            const heading = document.createElement('h2');
            heading.className = 'tour-chapter-title';
            heading.textContent = chapter.title;
            scenes.append(heading);
            for (const sceneId of chapter.sceneIds) {
                const scene = sceneById.get(sceneId);
                if (!scene) {
                    continue;
                }
                const index = tour.scenes.indexOf(scene);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tour-scene';
                button.dataset.sceneId = scene.id;
                if (scene.kind === 'text-diff') button.dataset.filePath = scene.path;
                button.title = `Open scene: ${scene.kind === 'text-diff' ? scene.path : scene.title}`;
                button.addEventListener('click', () => showTourScene(index, 0, {
                    userNavigation: true,
                    showIntro: true
                }));
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
                                ? formatCount(scene.steps.length, 'code step')
                                : 'Discussion'],
                    ['tour-scene-note', scene.takeaway]
                ]) {
                    const line = document.createElement('span');
                    line.className = className;
                    line.textContent = text;
                    copy.append(line);
                }
                button.append(number, copy);
                scenes.append(button);
                if (isSteppedTourScene(scene)) {
                    const steps = document.createElement('div');
                    steps.className = 'tour-outline-steps';
                    steps.dataset.sceneId = scene.id;
                    steps.hidden = true;
                    steps.id = `tour-outline-${index}`;
                    button.setAttribute('aria-controls', steps.id);
                    button.setAttribute('aria-expanded', 'false');
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
                    scenes.append(steps);
                }
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
        commits.replaceChildren(...tour.commits.map((commit) => {
            const item = document.createElement('li');
            const oid = document.createElement('span');
            oid.className = 'tour-commit-oid';
            oid.textContent = commit.shortOid;
            item.append(oid, document.createTextNode(commit.summary));
            return item;
        }));
    }

    function setReviewNotesOpen(open) {
        document.getElementById('tour-review').hidden = !open;
        const toggle = document.getElementById('tour-review-toggle');
        toggle.setAttribute('aria-expanded', String(open));
        (open ? document.getElementById('tour-review-close') : toggle).focus();
    }

    function renderReviewNotes() {
        const tour = state.authoredTour;
        const review = tour?.review;
        const toggle = document.getElementById('tour-review-toggle');
        const content = document.getElementById('tour-review-content');
        toggle.hidden = !review;
        content.replaceChildren();
        if (!review) {
            document.getElementById('tour-review').hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            return;
        }
        toggle.textContent = `Review notes (${review.items.length})`;
        const provenance = document.createElement('p');
        provenance.className = 'tour-review-provenance';
        provenance.textContent = 'Authored interpretations. Linked evidence is checked; conclusions and external checks are not verified.';
        const range = document.createElement('p');
        range.className = 'tour-review-range';
        range.textContent = `Reviewed snapshot: ${review.baseOid.slice(0, 7)} → ${review.headOid.slice(0, 7)}. Evidence opens this range’s final diff.`;
        range.title = `${review.baseOid} → ${review.headOid}`;
        content.append(provenance, range);
        const scenes = tour.zoom?.final.scenes || tour.scenes;
        for (const [kind, label] of [
            ['concept', 'Concepts and invariants'],
            ['boundary', 'Boundaries and prerequisites'],
            ['tradeoff', 'Complexity tradeoffs'],
            ['question', 'Open questions']
        ]) {
            const items = review.items.filter((item) => item.kind === kind);
            if (!items.length) continue;
            const heading = document.createElement('h3');
            heading.textContent = label;
            content.append(heading);
            for (const item of items) {
                const card = document.createElement('article');
                card.className = 'tour-review-item';
                const title = document.createElement('h4');
                title.textContent = item.title;
                const body = document.createElement('p');
                body.textContent = item.body;
                card.append(title, body);
                for (const evidence of item.evidence) {
                    const scene = scenes.find((candidate) => candidate.id === evidence.sceneId);
                    const step = scene.steps.find((candidate) => candidate.id === evidence.stepId);
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'tour-review-evidence';
                    button.textContent = `${step.title} · ${step.focus.path}:${step.focus.startLine} (${step.focus.revision})`;
                    button.title = `Open evidence in the reviewed snapshot: ${step.title}`;
                    button.addEventListener('click', () => void showReviewEvidence(evidence));
                    card.append(button);
                }
                if (item.nextCheck) {
                    const next = document.createElement('p');
                    next.className = 'tour-review-next';
                    next.textContent = `Next check: ${item.nextCheck}`;
                    card.append(next);
                }
                content.append(card);
            }
        }
    }

    async function showReviewEvidence(evidence) {
        const status = document.getElementById('tour-review-status');
        status.textContent = '';
        if (state.zoomSwitching) {
            status.textContent = 'Wait for the current mode change, then open the evidence again.';
            return;
        }
        if (state.zoom && state.zoom.mode !== 'final') await switchZoomMode('final');
        const index = state.tour.scenes.findIndex((scene) => scene.id === evidence.sceneId);
        const scene = state.tour.scenes[index];
        const stepIndex = scene?.kind === 'walkthrough' ? scene.steps.findIndex((step) => step.id === evidence.stepId) : -1;
        if ((state.zoom && state.zoom.mode !== 'final') || stepIndex < 0) {
            status.textContent = 'Could not open the reviewed snapshot. Try switching to Final diff first.';
            return;
        }
        // A restored zoom location must not overwrite this explicit evidence jump.
        zoomRestore = null;
        showTourScene(index, stepIndex, { userNavigation: true });
        setReviewNotesOpen(false);
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
            item.title = row.description;
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
        if (options.userNavigation) markZoomNavigation();
        if (state.zoom?.mode === 'history' && !state.zoomSwitching) {
            const scene = tour.scenes[index];
            const path = scene.path || scene.steps?.[stepIndex]?.file || state.activeTourFilePath;
            void showZoomHistory(path, state.historyCommit).catch((error) => { document.getElementById('tour-mode-status').textContent = error.message; });
            return null;
        }
        const scene = tour.scenes[index];
        state.directoryEvidence = null;
        renderDirectoryOverviewBreadcrumb();
        const changedLocation = state.activeSceneIndex !== index || state.activeStepIndex !== stepIndex;
        const changedScene = state.activeSceneIndex !== index;
        if (options.showIntro !== undefined) {
            state.sceneIntroVisible = Boolean(options.showIntro && isSteppedTourScene(scene));
        } else if (changedScene) {
            state.sceneIntroVisible = isSteppedTourScene(scene);
        } else if (changedLocation) {
            state.sceneIntroVisible = false;
        }
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
        document.querySelectorAll('.tour-scene').forEach((button) => {
            const active = button.dataset.sceneId === scene.id;
            button.classList.toggle('is-active', active);
            if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', String(active));
            if (active && !isSteppedTourScene(scene)) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
        document.querySelectorAll('.tour-outline-steps').forEach((steps) => { steps.hidden = steps.dataset.sceneId !== scene.id; });
        document.querySelectorAll('.tour-outline-step').forEach((button) => {
            const active = button.dataset.sceneId === scene.id && Number(button.dataset.stepIndex) === state.activeStepIndex;
            button.classList.toggle('is-active', active);
            if (active) button.setAttribute('aria-current', 'step');
            else button.removeAttribute('aria-current');
        });
        document.querySelector('#tour-scenes [aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
        if (changedLocation || options.showIntro !== undefined) document.getElementById('tour-narrative-content').scrollTop = 0;
        const narrationUnit = buildActiveNarrationUnit(options.narrationEntry || 'playback-start');
        state.renderedNarrationUnit = narrationUnit;
        renderTourNarrative(scene, location, narrationUnit);
        if (narrationUnit && !options.zoomLanding && (!state.zoom || isNarrativeMode())) {
            if (options.narrationNavigation === 'linear') {
                narrationController.followLinearNavigation(narrationUnit);
            } else if (options.narrationNavigation !== 'controller') {
                narrationController.followDirectNavigation(narrationUnit);
            }
        }
        updateTourLocationUrl();
        if (scene.kind === 'discussion') {
            document.body.classList.add('tour-discussion');
            updateTourFileSelection();
            return narrationUnit;
        }
        document.body.classList.remove('tour-discussion');
        if (state.sceneIntroVisible && showTourDirectoryOverview()) return narrationUnit;
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
        if (!isNarrativeMode() || scene?.overview?.kind !== 'directory-diff') return false;
        const evidence = buildTourDirectoryEvidence(state.tour, scene);
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
        markZoomNavigation();
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

    function emitDiffScene(scene, annotations = [], comparisonId = getTourFileComparisonId(scene.path)) {
        const tour = state.tour;
        if (!tour) return;
        state.activeTourFilePath = scene.path;
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
            file1: leftLabel,
            file2: rightLabel,
            comparisonId: `tour-${comparisonId}`,
            leftContent: scene.leftContent,
            rightContent: scene.rightContent,
            canReturnToDirectory: Boolean(state.directoryEvidence),
            sourceInfo: { leftPath: scene.previousPath || scene.path, rightPath: scene.path },
            fileExists,
            diffModel,
            history: null,
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
        const suffix = label.startsWith(scene.path) ? label.slice(scene.path.length).trim() : label.trim();
        return suffix ? `${role} ${suffix}` : role;
    }

    function renderWalkthroughStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
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

    function getCurrentLinearTourTarget(direction) {
        const tour = state.tour;
        if (!tour || (direction !== -1 && direction !== 1)) {
            return null;
        }
        return getLinearTourTarget(tour.scenes, {
            sceneIndex: state.activeSceneIndex,
            stepIndex: state.activeStepIndex
        }, direction);
    }

    function showTourLinear(direction) {
        if (direction === 1 && state.narrativeParent) {
            showTourScene(state.activeSceneIndex, state.activeStepIndex, { userNavigation: true, showIntro: false });
            return true;
        }
        if (direction === 1 && state.sceneIntroVisible) {
            const scene = state.tour?.scenes[state.activeSceneIndex];
            if (scene && isSteppedTourScene(scene) && scene.steps[state.activeStepIndex]) {
                showTourScene(state.activeSceneIndex, state.activeStepIndex, {
                    userNavigation: true,
                    showIntro: false
                });
                return true;
            }
        }
        const target = getCurrentLinearTourTarget(direction);
        if (!target) {
            return false;
        }
        const enteringScene = target.sceneIndex !== state.activeSceneIndex;
        showTourScene(target.sceneIndex, target.stepIndex, {
            userNavigation: true,
            narrationNavigation: 'linear',
            narrationEntry: 'playback-start',
            showIntro: enteringScene && target.stepIndex === 0 && !narrationController.engaged
        });
        return true;
    }

    function getCurrentTourFileTarget(direction) {
        const tour = state.tour;
        if (!tour || (direction !== -1 && direction !== 1)) {
            return null;
        }
        const scene = tour.scenes[state.activeSceneIndex];
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
        markZoomNavigation();
        if (state.zoom?.mode === 'history') {
            void showZoomHistory(selected.path, null).catch((error) => { document.getElementById('tour-mode-status').textContent = error.message; });
            return true;
        }
        if (state.zoom?.mode === 'compare') {
            emitDiffScene({ ...selected, takeaway: '' }, [], `compare-${state.compare.from}-${state.compare.to}-${selected.path}`);
            updateTourLocationUrl();
            return true;
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

    function setTourFilesOpen(open) {
        document.getElementById('tour-files').hidden = !open;
        document.getElementById('tour-files-toggle').setAttribute('aria-expanded', String(open));
        document.querySelector('.tour-files-section').classList.toggle('is-open', open);
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
            returnButton.hidden = !inTourMode || Boolean(state.directoryEvidence)
                || !state.tourFocusFilePath || state.activeTourFilePath === state.tourFocusFilePath;
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
        const step = scene && isSteppedTourScene(scene)
            ? scene.steps[state.activeStepIndex]
            : null;
        state.narrativeParent = null;
        state.sceneIntroVisible = Boolean(visible && step);
        const context = document.getElementById('tour-context');
        if (context) context.open = !step || state.sceneIntroVisible;
        const stepPanel = document.getElementById('tour-step');
        if (stepPanel) stepPanel.hidden = !step || state.sceneIntroVisible;
        renderNarrativeViewControls();
        renderTourProgress();
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
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!scene) return;
        markZoomNavigation();
        if (view === 'tour' || view === 'chapter') {
            state.narrativeParent = view;
            renderNarrativeViewControls();
            renderTourProgress();
            updateTourLocationUrl();
        } else {
            setSceneIntroVisible(view === 'scene');
            if (view === 'scene') showTourDirectoryOverview();
        }
        document.getElementById('tour-narrative-content')?.scrollTo({ top: 0 });
        document.querySelector(`#tour-reading-path [data-level="${view}"]`)?.focus({ preventScroll: true });
    }

    function readingButton(label, title, action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.addEventListener('click', action);
        return button;
    }

    function renderReadingHierarchy(scene, hasStep) {
        const tour = state.tour;
        if (!tour || !scene) return;
        const chapter = tour.chapters.find((item) => item.sceneIds.includes(scene.id));
        const selected = state.narrativeParent || (hasStep && !state.sceneIntroVisible ? 'step' : 'scene');
        const path = document.getElementById('tour-reading-path');
        const levels = [];
        // A single-child level adds no useful navigation choice.
        if (tour.scenes.length > 1) levels.push(['tour', tour.title]);
        if (tour.chapters.length > 1 && chapter && (chapter.sceneIds.length > 1 || state.narrativeParent === 'chapter')) levels.push(['chapter', chapter.title]);
        levels.push(['scene', scene.title]);
        if (hasStep) levels.push(['step', `Step ${state.activeStepIndex + 1}`]);
        path.replaceChildren(...levels.map(([level, title]) => {
            const tooltip = level === 'step' ? `${title}: ${scene.steps[state.activeStepIndex].title}` : `${level}: ${title}`;
            const button = readingButton(title, tooltip, () => setNarrativeView(level));
            button.dataset.level = level;
            if (level === selected) button.setAttribute('aria-current', 'location');
            return button;
        }));
        const parent = document.getElementById('tour-parent-view');
        parent.hidden = !state.narrativeParent;
        document.getElementById('tour-context').hidden = Boolean(state.narrativeParent);
        document.getElementById('tour-step').hidden = Boolean(state.narrativeParent) || !hasStep || state.sceneIntroVisible;
        const resume = () => showTourScene(state.activeSceneIndex, state.activeStepIndex, { userNavigation: true, showIntro: false });
        const sceneLink = (child) => {
            const index = tour.scenes.indexOf(child);
            return readingButton(child.title, `Read scene: ${child.title}`, () => showTourScene(index,
                index === state.activeSceneIndex ? state.activeStepIndex : 0,
                { userNavigation: true, showIntro: true }));
        };
        parent.replaceChildren();
        if (state.narrativeParent) {
            const heading = document.createElement('h2');
            heading.textContent = state.narrativeParent === 'tour' ? tour.title : chapter?.title || tour.title;
            parent.append(heading, readingButton(hasStep ? `Resume step ${state.activeStepIndex + 1}: ${scene.steps[state.activeStepIndex].title}` : `Resume: ${scene.title}`, 'Resume your reading position', resume));
            const children = document.createElement('div');
            children.className = 'tour-child-items';
            if (state.narrativeParent === 'tour' && tour.chapters.length > 1) {
                for (const item of tour.chapters) {
                    const first = tour.scenes.findIndex((child) => child.id === item.sceneIds[0]);
                    if (first < 0) continue;
                    children.append(readingButton(item.title, `Read chapter: ${item.title}`, () => {
                        if (!item.sceneIds.includes(scene.id)) showTourScene(first, 0, { userNavigation: true, showIntro: true });
                        setNarrativeView(item.sceneIds.length > 1 ? 'chapter' : 'scene');
                    }));
                }
            } else {
                for (const child of tour.scenes.filter((item) => state.narrativeParent === 'tour' || chapter?.sceneIds.includes(item.id))) children.append(sceneLink(child));
            }
            parent.append(children);
        }
        const children = document.getElementById('tour-scene-children');
        children.replaceChildren();
        if (hasStep) {
            children.append(readingButton(`Resume step ${state.activeStepIndex + 1}`, 'Resume your reading position', resume));
            scene.steps.forEach((step, index) => {
                const button = readingButton(`${index + 1}. ${step.title}`, `Read step: ${step.title}`, () => showTourScene(state.activeSceneIndex, index, { userNavigation: true, showIntro: false }));
                if (index === state.activeStepIndex) button.setAttribute('aria-current', 'step');
                children.append(button);
            });
        }
    }

    function toggleNarrationSettings() {
        const settings = document.getElementById('tour-audio-settings');
        if (!settings) return;
        settings.hidden = !settings.hidden;
        renderNarrativeViewControls();
    }

    function renderNarrativeViewControls() {
        renderDirectoryOverviewBreadcrumb();
        const scene = state.tour?.scenes[state.activeSceneIndex];
        const hasStep = Boolean(scene && isSteppedTourScene(scene) && scene.steps[state.activeStepIndex]);
        const narration = document.getElementById('tour-narration');
        const settings = document.getElementById('tour-audio-settings');
        renderReadingHierarchy(scene, hasStep);
        if (narration) {
            const expanded = Boolean(settings && !settings.hidden);
            narration.setAttribute('aria-expanded', String(expanded));
            narration.textContent = expanded ? '›' : '‹ Narration';
            narration.title = expanded ? 'Hide narration controls' : 'Show narration controls';
            narration.setAttribute('aria-label', narration.title);
        }
    }

    function updateTourLocationUrl() {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        const parameters = new URLSearchParams(window.location.search);
        for (const key of ['from', 'to', 'scope', 'commit', 'file']) parameters.delete(key);
        if (state.zoom) parameters.set('mode', state.zoom.mode);
        if (state.zoom && !isNarrativeMode()) {
            for (const key of ['scene', 'step', 'view']) parameters.delete(key);
            if (state.zoom.mode === 'compare' && state.compare) {
                parameters.set('from', state.compare.from);
                parameters.set('to', state.compare.to);
                if (state.compare.path) parameters.set('scope', state.compare.path);
            }
            if (state.zoom.mode === 'history' && state.historyCommit) parameters.set('commit', state.historyCommit);
            if (state.activeTourFilePath) parameters.set('file', state.zoom.mode === 'history' ? state.historyPath : state.activeTourFilePath);
            window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`);
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
        window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`);
    }

    function renderTourProgress() {
        const previous = document.getElementById('tour-previous');
        const next = document.getElementById('tour-next');
        if (!previous || !next) return;
        const scene = state.tour?.scenes[state.activeSceneIndex];
        const step = scene && isSteppedTourScene(scene)
            ? scene.steps[state.activeStepIndex]
            : null;
        const introVisible = Boolean(state.narrativeParent || (state.sceneIntroVisible && step));
        const previousTarget = getCurrentLinearTourTarget(-1);
        const nextTarget = getCurrentLinearTourTarget(1);
        const startLabel = state.narrativeParent ? (step ? `Resume step ${state.activeStepIndex + 1}` : 'Resume scene') : state.activeStepIndex === 0 ? 'Start steps' : `Resume step ${state.activeStepIndex + 1}`;
        previous.disabled = !previousTarget;
        next.disabled = introVisible ? false : !nextTarget;
        next.textContent = introVisible ? startLabel : nextTarget ? 'Next →' : 'End of tour';
        next.title = introVisible
            ? state.activeStepIndex === 0 ? 'Start the steps for this scene' : 'Return to the current step'
            : nextTarget
                ? 'Next tour item (Right or Page Down)'
                : 'You have reached the end of the tour';
        next.setAttribute('aria-label', introVisible ? startLabel : nextTarget ? 'Next tour item' : 'End of tour');
    }

    function getActiveStepCodeTarget(scene = state.tour?.scenes[state.activeSceneIndex]) {
        if (!scene || !isSteppedTourScene(scene)) return null;
        const step = scene.steps[state.activeStepIndex];
        if (!step) return null;
        if (scene.kind === 'walkthrough') {
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

    function renderStepCodeTarget(container, location, button, scene) {
        const target = getActiveStepCodeTarget(scene);
        if (!target) {
            container.hidden = true;
            location.textContent = '';
            button.hidden = true;
            button.disabled = true;
            return;
        }
        location.textContent = target.label;
        location.title = `Focused source: ${target.label}`;
        button.hidden = false;
        button.disabled = false;
        container.hidden = false;
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
        const narrative = document.getElementById('tour-narrative');
        const breadcrumb = document.getElementById('tour-breadcrumb');
        const chapter = document.getElementById('tour-narrative-chapter');
        const title = document.getElementById('tour-narrative-title');
        const summary = document.getElementById('tour-narrative-summary');
        const bullets = document.getElementById('tour-narrative-bullets');
        const tags = document.getElementById('tour-narrative-tags');
        const takeaway = document.getElementById('tour-narrative-takeaway');
        const stepPanel = document.getElementById('tour-step');
        const stepTitle = document.getElementById('tour-step-title');
        const stepBody = document.getElementById('tour-step-body');
        const stepRequirement = document.getElementById('tour-step-requirement');
        const connection = document.getElementById('tour-connection');
        const stepCode = document.getElementById('tour-step-code');
        const stepCodeLocation = document.getElementById('tour-step-code-location');
        const showInCode = document.getElementById('tour-show-in-code');
        const previous = document.getElementById('tour-previous');
        const next = document.getElementById('tour-next');
        if (!narrative || !breadcrumb || !chapter || !title || !summary || !bullets || !tags || !takeaway || !stepPanel || !stepTitle || !stepBody || !stepRequirement || !connection || !stepCode || !stepCodeLocation || !showInCode || !previous || !next) {
            throw new Error('Tour narrative UI is incomplete.');
        }
        narrative.hidden = false;
        breadcrumb.textContent = formatTourBreadcrumb(location, scene, state.activeStepIndex);
        const chapterText = location.chapter?.title || 'Change tour';
        renderNarrationField(chapter, chapterText, { field: 'chapter' }, narrationUnit, {
            suffix: scene.kind === 'deconstructed-diff' ? ` · ${scene.stageLabel}` : ''
        });
        renderNarrationField(title, scene.title, { field: 'scene-title' }, narrationUnit);
        renderNarrationField(summary, scene.summary, { field: 'summary' }, narrationUnit);
        bullets.replaceChildren(...scene.bullets.map((text, itemIndex) => {
            const item = document.createElement('li');
            renderNarrationField(item, text, { field: 'bullet', itemIndex }, narrationUnit);
            return item;
        }));
        tags.replaceChildren(...scene.tags.map((text) => {
            const tag = document.createElement('span');
            tag.textContent = text;
            return tag;
        }));
        renderNarrationField(takeaway, scene.takeaway, { field: 'takeaway' }, narrationUnit);
        const step = isSteppedTourScene(scene)
            ? scene.steps[state.activeStepIndex]
            : null;
        const showIntro = state.sceneIntroVisible && Boolean(step);
        const context = document.getElementById('tour-context');
        const contextLabel = document.getElementById('tour-context-label');
        if (context.dataset.sceneId !== scene.id) {
            context.open = !step;
            context.dataset.sceneId = scene.id;
        }
        context.classList.toggle('is-primary', !step);
        contextLabel.hidden = true;
        contextLabel.textContent = `Scene context · ${scene.title}`;
        if (!step) context.open = true;
        setSceneIntroVisible(showIntro);
        stepPanel.hidden = !step || state.sceneIntroVisible;
        if (step) {
            renderNarrationField(stepTitle, step.title, { field: 'step-title' }, narrationUnit, {
                prefix: scene.kind === 'deconstructed-diff'
                    ? `Stage ${(step.stageIndex ?? step.pairIndex) + 1}: `
                    : ''
            });
            renderNarrationField(stepBody, step.body, { field: 'step-body' }, narrationUnit);
            renderStepRequirement(stepRequirement, 'requirement' in step ? step.requirement : null);
            if ('connection' in step && step.connection) {
                connection.hidden = false;
                renderNarrationField(connection, step.connection.label, { field: 'connection' }, narrationUnit, {
                    prefix: `${step.connection.from.path} → ${step.connection.to.path} · `
                });
            } else {
                connection.hidden = true;
                connection.textContent = '';
            }
            renderStepCodeTarget(stepCode, stepCodeLocation, showInCode, scene);
        } else {
            stepTitle.textContent = '';
            stepBody.textContent = '';
            renderStepRequirement(stepRequirement, null);
            connection.hidden = true;
            connection.textContent = '';
            renderStepCodeTarget(stepCode, stepCodeLocation, showInCode, scene);
        }
        renderTourProgress();
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
        if (matchingSegments.length === 0) {
            element.textContent = `${affixes.prefix || ''}${text}${affixes.suffix || ''}`;
            return;
        }
        const children = [];
        if (affixes.prefix) children.push(document.createTextNode(affixes.prefix));
        let offset = 0;
        for (const segment of matchingSegments) {
            if (segment.startOffset > offset) {
                children.push(document.createTextNode(text.slice(offset, segment.startOffset)));
            }
            const span = document.createElement('span');
            span.className = 'tour-narration-segment';
            span.dataset.narrationSegmentId = segment.id;
            span.textContent = text.slice(segment.startOffset, segment.endOffset);
            children.push(span);
            offset = segment.endOffset;
        }
        if (offset < text.length) children.push(document.createTextNode(text.slice(offset)));
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
