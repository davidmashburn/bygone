import { buildTwoWayDiffModel } from '../src/diffEngine.ts';
import { createJavaScriptSampleFilePair } from '../src/sampleFiles.ts';
import { parseChangeTourManifest } from '../src/changeTourManifest.ts';
import { getLinearTourTarget, getTourFileTarget, resolveTourPosition } from '../src/tourNavigation.ts';

(function initializeWebHost() {
    const state = {
        mode: 'empty',
        left: null,
        right: null,
        comparisonId: 0,
        tour: null,
        activeSceneIndex: -1,
        activeStepIndex: 0,
        activeTourFilePath: null,
        tourFocusFilePath: null
    };

    window.__BYGONE_HOST__ = {
        environment: 'web',
        editorWorkerUrl: '/media/editor.worker.js',
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
        window.addEventListener('keydown', (event) => {
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
        });
    }

    async function loadTour(manifestUrl) {
        setStatus('Loading change tour…');
        try {
            const response = await fetch(manifestUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Manifest request failed (${response.status}).`);
            }
            state.tour = parseChangeTourManifest(await response.json());
            state.mode = 'tour';
            document.body.classList.add('tour-mode');
            renderTourShell();
            const parameters = new URLSearchParams(window.location.search);
            const requestedPosition = resolveTourPosition(
                state.tour.scenes,
                parameters.get('scene'),
                parameters.get('step')
            );
            showTourScene(requestedPosition.sceneIndex, requestedPosition.stepIndex);
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
                button.title = scene.kind === 'text-diff' ? scene.path : scene.title;
                button.addEventListener('click', () => showTourScene(index));
                const number = document.createElement('span');
                number.className = 'tour-scene-number';
                number.textContent = String(index + 1).padStart(2, '0');
                const copy = document.createElement('span');
                copy.className = 'tour-scene-copy';
                for (const [className, text] of [
                    ['tour-scene-title', scene.title],
                    ['tour-scene-path', scene.kind === 'text-diff' ? scene.path : (scene.kind === 'walkthrough' || scene.kind === 'stacked-diff') ? formatCount(scene.steps.length, 'code step') : 'Discussion'],
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
            button.title = file.kind === 'omitted' ? `${file.path}: ${file.reason}` : file.path;
            if (file.kind === 'text-diff') {
                button.addEventListener('click', () => showTourFileAtIndex(index));
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

    function showTourScene(index, stepIndex = 0) {
        const tour = state.tour;
        if (!tour || index < 0 || index >= tour.scenes.length) {
            return;
        }
        const scene = tour.scenes[index];
        state.activeSceneIndex = index;
        state.activeStepIndex = scene.kind === 'walkthrough' || scene.kind === 'stacked-diff'
            ? Math.min(Math.max(stepIndex, 0), Math.max(scene.steps.length - 1, 0))
            : 0;
        state.tourFocusFilePath = scene.kind === 'text-diff'
            ? scene.path
            : scene.kind === 'walkthrough'
                ? scene.steps[state.activeStepIndex]?.diff.path ?? null
                : scene.kind === 'stacked-diff'
                    ? scene.steps[state.activeStepIndex]?.file ?? null
                : null;
        const location = getSceneLocation(tour, index);
        document.querySelectorAll('.tour-scene').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.sceneId === scene.id);
        });
        document.querySelector(`.tour-scene[data-scene-id="${scene.id}"]`)?.scrollIntoView({ block: 'nearest' });
        renderTourNarrative(scene, location);
        const parameters = new URLSearchParams(window.location.search);
        parameters.set('scene', scene.id);
        if (scene.kind === 'walkthrough' || scene.kind === 'stacked-diff') {
            parameters.set('step', scene.steps[state.activeStepIndex].id);
        } else {
            parameters.delete('step');
        }
        window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`);
        if (scene.kind === 'discussion') {
            document.body.classList.add('tour-discussion');
            updateTourFileSelection();
            return;
        }
        document.body.classList.remove('tour-discussion');
        if (scene.kind === 'walkthrough') {
            renderWalkthroughStep(scene);
            return;
        }
        if (scene.kind === 'stacked-diff') {
            renderStackedStep(scene);
            return;
        }
        emitDiffScene(scene);
    }

    function emitDiffScene(scene, annotation = null, comparisonId = scene.id) {
        const tour = state.tour;
        if (!tour) return;
        state.activeTourFilePath = scene.path;
        updateTourFileSelection();
        const diffModel = buildTwoWayDiffModel(scene.leftContent, scene.rightContent);
        const leftLabel = formatTourPaneLabel(scene, scene.leftLabel, 'base');
        const rightLabel = formatTourPaneLabel(scene, scene.rightLabel, 'head');
        emit({
            type: 'showDiff',
            file1: leftLabel,
            file2: rightLabel,
            comparisonId: `tour-${comparisonId}`,
            leftContent: scene.leftContent,
            rightContent: scene.rightContent,
            diffModel,
            history: null,
            fileNavigation: {
                canGoPrevious: Boolean(getCurrentTourFileTarget(-1)),
                canGoNext: Boolean(getCurrentTourFileTarget(1))
            },
            editableSides: { left: false, right: false },
            comparisonSummary: `${scene.path} · ${scene.takeaway}`,
            initialChangeIndex: annotation
                ? findChangeIndexAtSourceLine(diffModel, annotation.side, annotation.startLine)
                : scene.focusChangeIndex,
            tourAnnotation: annotation
        });
    }

    function formatTourPaneLabel(scene, label, role) {
        const suffix = label.startsWith(scene.path) ? label.slice(scene.path.length).trim() : label.trim();
        return suffix ? `${role} ${suffix}` : role;
    }

    function renderWalkthroughStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
        const side = step.focus.revision === 'base' ? 'left' : 'right';
        emitDiffScene(step.diff, {
            side,
            startLine: step.focus.startLine,
            endLine: step.focus.endLine,
            label: `${step.title}: ${step.body}`
        }, `${scene.id}-${step.id}`);
    }

    function renderStackedStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
        emitStackedFile(scene, step.file, step);
    }

    function emitStackedFile(scene, filePath, step) {
        const file = scene.files.find((candidate) => candidate.path === filePath);
        if (!step || !file) return;
        state.activeTourFilePath = file.path;
        updateTourFileSelection();
        const panels = file.panels.map((panel, index) => ({
            id: `${scene.id}-${file.path}-${panel.id}`,
            label: panel.label,
            path: panel.path || '',
            content: panel.content,
            savedContent: panel.content,
            dirty: false,
            editable: false,
            stackId: scene.stack[index].id
        }));
        const pairs = panels.slice(0, -1).map((panel, index) => ({
            leftIndex: index,
            rightIndex: index + 1,
            diffModel: buildTwoWayDiffModel(panel.content, panels[index + 1].content)
        }));
        const focusModel = pairs[step.pairIndex]?.diffModel;
        const initialChangeIndex = file.path === step.file && focusModel && step.startLine
            ? findChangeIndexAtSourceLine(focusModel, step.side, step.startLine)
            : 0;
        emit({
            type: 'showMultiDiff',
            panels,
            pairs,
            activePanelId: panels[step.pairIndex + (step.side === 'right' ? 1 : 0)]?.id,
            activePairIndex: step.pairIndex,
            initialChangeIndex,
            history: null,
            fileNavigation: {
                canGoPrevious: scene.files.indexOf(file) > 0,
                canGoNext: scene.files.indexOf(file) < scene.files.length - 1
            },
            mutationEnabled: false,
            comparisonSummary: `${file.path} · ${scene.takeaway}`
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
        showTourScene(target.sceneIndex, target.stepIndex);
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
        const activeScene = state.tour?.scenes[state.activeSceneIndex];
        if (activeScene?.kind === 'stacked-diff') {
            const currentIndex = activeScene.files.findIndex((file) => file.path === state.activeTourFilePath);
            const target = activeScene.files[currentIndex + direction];
            const step = activeScene.steps[state.activeStepIndex];
            if (!target || !step) return false;
            emitStackedFile(activeScene, target.path, step);
            return true;
        }
        const target = getCurrentTourFileTarget(direction);
        return target ? showTourFileAtIndex(target.fileIndex) : false;
    }

    function showTourFileAtIndex(index) {
        const file = state.tour?.files[index];
        if (!file || file.kind !== 'text-diff') {
            return false;
        }
        emitDiffScene(file);
        return true;
    }

    function returnToTourFocus() {
        const scene = state.tour?.scenes[state.activeSceneIndex];
        if (!scene || !state.tourFocusFilePath) {
            return false;
        }
        if (scene.kind === 'walkthrough') {
            renderWalkthroughStep(scene);
        } else if (scene.kind === 'stacked-diff') {
            renderStackedStep(scene);
        } else if (scene.kind === 'text-diff') {
            emitDiffScene(scene);
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
        if (scene.kind === 'walkthrough' || scene.kind === 'stacked-diff') {
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

    function renderTourNarrative(scene, location) {
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
        chapter.textContent = location.chapter?.title || 'Change tour';
        title.textContent = scene.title;
        summary.textContent = scene.summary;
        bullets.replaceChildren(...scene.bullets.map((text) => {
            const item = document.createElement('li');
            item.textContent = text;
            return item;
        }));
        tags.replaceChildren(...scene.tags.map((text) => {
            const tag = document.createElement('span');
            tag.textContent = text;
            return tag;
        }));
        takeaway.textContent = scene.takeaway;
        const step = scene.kind === 'walkthrough' || scene.kind === 'stacked-diff'
            ? scene.steps[state.activeStepIndex]
            : null;
        stepPanel.hidden = !step;
        if (step) {
            stepTitle.textContent = step.title;
            stepBody.textContent = step.body;
            if ('connection' in step && step.connection) {
                connection.hidden = false;
                connection.textContent = `${step.connection.from.path} → ${step.connection.to.path} · ${step.connection.label}`;
            } else {
                connection.hidden = true;
                connection.textContent = '';
            }
        } else {
            connection.hidden = true;
            connection.textContent = '';
        }
        previous.disabled = !getCurrentLinearTourTarget(-1);
        next.disabled = !getCurrentLinearTourTarget(1);
    }

    function compareTestFiles() {
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
