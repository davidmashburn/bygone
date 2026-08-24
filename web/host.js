import { buildTwoWayDiffModel } from '../src/diffEngine.ts';
import { createJavaScriptSampleFilePair } from '../src/sampleFiles.ts';
import { parseChangeTourManifest } from '../src/changeTourManifest.ts';
import {
    getLinearTourTarget,
    getMultiPanelTourFileTarget,
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
        activeSceneIndex: -1,
        activeStepIndex: 0,
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
        window.dispatchEvent(new window.CustomEvent('bygone:host-message', {
            detail: message
        }));
    }

    async function handleRendererMessage(message) {
        if (!message || typeof message !== 'object') {
            return;
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

        if (message.type === 'navigateFile' && state.mode === 'tour') {
            showTourFile(message.direction === 'previous' ? -1 : 1);
            return;
        }

        if (message.type === 'navigateTourStep' && state.mode === 'tour') {
            const sceneIndex = message.sceneIndex;
            const stepIndex = message.stepIndex;
            if (Number.isInteger(sceneIndex) && Number.isInteger(stepIndex)) {
                showTourScene(sceneIndex, stepIndex);
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
        const compareTestButton = document.getElementById('web-compare-test');
        const openDiffButton = document.getElementById('web-open-diff');
        const openDiff3Button = document.getElementById('web-open-diff3');
        const diffInput = document.getElementById('web-diff-input');
        const diff3Input = document.getElementById('web-diff3-input');
        const tourPrevious = document.getElementById('tour-previous');
        const tourNext = document.getElementById('tour-next');
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
        initializeNarrationVoices();

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
        tourReturnFocus?.addEventListener('click', returnToTourFocus);
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
            if (state.mode !== 'tour' || event.metaKey || event.ctrlKey || event.altKey || isInteractiveKeyTarget(event.target)) {
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
            narrationEntry: 'continuous'
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
        const narrative = document.getElementById('tour-narrative');
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
            showTourScene(match.sceneIndex, match.stepIndex ?? 0);
            return;
        }
        if (!showTourFileAtIndex(match.fileIndex)) return;
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
            : 360;
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
            state.mode = 'tour';
            document.body.classList.add('tour-mode');
            renderTourShell();
            renderTourSearchResults();
            const parameters = new URLSearchParams(window.location.search);
            const requestedPosition = resolveTourPosition(
                state.tour.scenes,
                parameters.get('scene'),
                parameters.get('step')
            );
            showTourScene(requestedPosition.sceneIndex, requestedPosition.stepIndex);
            renderNarrationPlaybackState(narrationController.state);
            setStatus('');
        } catch (error) {
            setStatus(`Could not load change tour: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    function renderTourShell() {
        const tour = state.tour;
        if (!tour) {
            return;
        }
        const shell = document.getElementById('tour-shell');
        const title = document.getElementById('tour-title');
        const source = document.getElementById('tour-source');
        const range = document.getElementById('tour-range');
        const stats = document.getElementById('tour-stats');
        const scenes = document.getElementById('tour-scenes');
        const sceneCount = document.getElementById('tour-scene-count');
        const files = document.getElementById('tour-files');
        const fileCount = document.getElementById('tour-file-count');
        const commits = document.getElementById('tour-commits');
        const commitsSummary = document.getElementById('tour-commits-summary');
        if (!shell || !title || !source || !range || !stats || !scenes || !sceneCount || !files || !fileCount || !commits || !commitsSummary) {
            throw new Error('Presenter UI is incomplete.');
        }
        shell.hidden = false;
        title.textContent = tour.title;
        document.title = buildTourWindowTitle(tour);
        if (tour.sourceUrl) {
            source.href = tour.sourceUrl;
            source.hidden = false;
        } else {
            source.hidden = true;
        }
        const baseLabel = formatTourRef(tour.range.baseRef);
        const headLabel = formatTourRef(tour.range.headRef);
        const resolvedHead = tour.range.headOid.slice(0, 7);
        range.textContent = `${baseLabel} → ${headLabel}${headLabel === resolvedHead ? '' : ` · ${resolvedHead}`}`;
        stats.textContent = `${formatCount(tour.summary.changedFiles, 'file')} · +${tour.summary.additions} −${tour.summary.deletions} · ${formatCount(tour.summary.commitCount, 'commit')}`;
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
                button.addEventListener('click', () => showTourScene(index));
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
                            ? formatCount(scene.steps.length, 'explanation stage')
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

    function showTourScene(index, stepIndex = 0, options = {}) {
        const tour = state.tour;
        if (!tour || index < 0 || index >= tour.scenes.length) {
            return null;
        }
        const scene = tour.scenes[index];
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
            button.classList.toggle('is-active', button.dataset.sceneId === scene.id);
        });
        document.querySelector(`.tour-scene[data-scene-id="${scene.id}"]`)?.scrollIntoView({ block: 'nearest' });
        const narrationUnit = buildActiveNarrationUnit(options.narrationEntry || 'playback-start');
        state.renderedNarrationUnit = narrationUnit;
        renderTourNarrative(scene, location, narrationUnit);
        if (narrationUnit) {
            if (options.narrationNavigation === 'linear') {
                narrationController.followLinearNavigation(narrationUnit);
            } else if (options.narrationNavigation !== 'controller') {
                narrationController.followDirectNavigation(narrationUnit);
            }
        }
        const parameters = new URLSearchParams(window.location.search);
        parameters.set('scene', scene.id);
        if (isSteppedTourScene(scene)) {
            parameters.set('step', scene.steps[state.activeStepIndex].id);
        } else {
            parameters.delete('step');
        }
        window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`);
        if (scene.kind === 'discussion') {
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
        const leftLabel = formatTourPaneLabel(scene, scene.leftLabel, 'base');
        const rightLabel = formatTourPaneLabel(scene, scene.rightLabel, 'head');
        const activeAnnotation = annotations.find((annotation) => annotation.active);
        emit({
            type: 'showDiff',
            file1: leftLabel,
            file2: rightLabel,
            comparisonId: `tour-${comparisonId}`,
            leftContent: scene.leftContent,
            rightContent: scene.rightContent,
            sourceInfo: { leftPath: scene.path, rightPath: scene.path },
            diffModel,
            history: null,
            fileNavigation: {
                canGoPrevious: Boolean(getCurrentTourFileTarget(-1)),
                canGoNext: Boolean(getCurrentTourFileTarget(1))
            },
            editableSides: { left: false, right: false },
            comparisonSummary: `${scene.path} · ${scene.takeaway}`,
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
        const file = scene.files.find((candidate) => candidate.path === filePath);
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
        const tourAnnotations = scene.kind === 'stacked-diff'
            ? buildStackedTourAnnotationsForFile(file.path, pairs)
            : [];
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
        const target = getCurrentLinearTourTarget(direction);
        if (!target) {
            return false;
        }
        showTourScene(target.sceneIndex, target.stepIndex, {
            narrationNavigation: 'linear',
            narrationEntry: 'playback-start'
        });
        return true;
    }

    function getCurrentTourFileTarget(direction) {
        const tour = state.tour;
        if (!tour || (direction !== -1 && direction !== 1)) {
            return null;
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
        narrationController.interruptForExploration();
        if (selected?.kind === 'text-diff' && state.tour) {
            const target = getMultiPanelTourFileTarget(
                state.tour.scenes,
                {
                    sceneIndex: state.activeSceneIndex,
                    stepIndex: state.activeStepIndex
                },
                selected.path
            );
            if (target) {
                const scene = state.tour.scenes[target.sceneIndex];
                const step = isMultiPanelTourScene(scene) ? scene.steps[target.stepIndex] : null;
                if (step) {
                    emitMultiPanelFile(scene, selected.path, step);
                    return true;
                }
            }
        }
        return showTourFileAtIndex(index, false);
    }

    function returnToTourFocus() {
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

    function updateTourFileSelection() {
        document.querySelectorAll('.tour-file').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.filePath === state.activeTourFilePath);
            button.classList.toggle('is-tour-focus', button.dataset.filePath === state.tourFocusFilePath);
        });
        document.querySelector(`.tour-file.is-active`)?.scrollIntoView({ block: 'nearest' });
        const returnButton = document.getElementById('tour-return-focus');
        if (returnButton) {
            returnButton.hidden = !state.tourFocusFilePath || state.activeTourFilePath === state.tourFocusFilePath;
        }
    }

    function isSteppedTourScene(scene) {
        return scene.kind === 'walkthrough'
            || scene.kind === 'stacked-diff'
            || scene.kind === 'deconstructed-diff';
    }

    function isMultiPanelTourScene(scene) {
        return scene.kind === 'stacked-diff' || scene.kind === 'deconstructed-diff';
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
            scenesInChapter
        };
    }

    function formatTourBreadcrumb(location, scene, stepIndex) {
        const parts = [`Ch ${location.chapterNumber}`, `Scene ${location.sceneInChapter}/${location.scenesInChapter}`];
        if (isSteppedTourScene(scene)) {
            parts.push(`Step ${stepIndex + 1}/${scene.steps.length}`);
        }
        return parts.join(' · ');
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
        const connection = document.getElementById('tour-connection');
        const previous = document.getElementById('tour-previous');
        const next = document.getElementById('tour-next');
        if (!narrative || !breadcrumb || !chapter || !title || !summary || !bullets || !tags || !takeaway || !stepPanel || !stepTitle || !stepBody || !connection || !previous || !next) {
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
        stepPanel.hidden = !step;
        if (step) {
            renderNarrationField(stepTitle, step.title, { field: 'step-title' }, narrationUnit, {
                prefix: scene.kind === 'deconstructed-diff' ? `Stage ${state.activeStepIndex + 1}: ` : ''
            });
            renderNarrationField(stepBody, step.body, { field: 'step-body' }, narrationUnit);
            if ('connection' in step && step.connection) {
                connection.hidden = false;
                renderNarrationField(connection, step.connection.label, { field: 'connection' }, narrationUnit, {
                    prefix: `${step.connection.from.path} → ${step.connection.to.path} · `
                });
            } else {
                connection.hidden = true;
                connection.textContent = '';
            }
        } else {
            stepTitle.textContent = '';
            stepBody.textContent = '';
            connection.hidden = true;
            connection.textContent = '';
        }
        previous.disabled = !getCurrentLinearTourTarget(-1);
        next.disabled = !getCurrentLinearTourTarget(1);
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
