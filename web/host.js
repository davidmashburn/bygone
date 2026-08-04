import { buildTwoWayDiffModel } from '../src/diffEngine.ts';
import { createJavaScriptSampleFilePair } from '../src/sampleFiles.ts';
import { parseChangeTourManifest } from '../src/changeTourManifest.ts';

(function initializeWebHost() {
    const state = {
        mode: 'empty',
        left: null,
        right: null,
        comparisonId: 0,
        tour: null,
        activeSceneIndex: -1,
        activeStepIndex: 0
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
            showTourScene(state.activeSceneIndex + (message.direction === 'previous' ? -1 : 1));
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
        window.addEventListener('keydown', (event) => {
            if (state.mode !== 'tour' || event.metaKey || event.ctrlKey || event.altKey) {
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
            const requestedScene = new URLSearchParams(window.location.search).get('scene');
            const requestedIndex = state.tour.scenes.findIndex((scene) => scene.id === requestedScene);
            showTourScene(requestedIndex >= 0 ? requestedIndex : 0);
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
        const commits = document.getElementById('tour-commits');
        const commitsSummary = document.getElementById('tour-commits-summary');
        if (!shell || !title || !source || !range || !stats || !scenes || !commits || !commitsSummary) {
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
        stats.textContent = `${tour.summary.changedFiles} files · +${tour.summary.additions} −${tour.summary.deletions} · ${tour.summary.commitCount} commits`;
        commitsSummary.textContent = `${tour.summary.commitCount} commits`;
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
                    ['tour-scene-path', scene.kind === 'text-diff' ? scene.path : scene.kind === 'walkthrough' ? `${scene.steps.length} code steps` : 'Discussion'],
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
        state.activeStepIndex = scene.kind === 'walkthrough'
            ? Math.min(Math.max(stepIndex, 0), Math.max(scene.steps.length - 1, 0))
            : 0;
        const location = getSceneLocation(tour, index);
        document.querySelectorAll('.tour-scene').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.sceneId === scene.id);
        });
        document.querySelector(`.tour-scene[data-scene-id="${scene.id}"]`)?.scrollIntoView({ block: 'nearest' });
        renderTourNarrative(scene, location);
        const parameters = new URLSearchParams(window.location.search);
        parameters.set('scene', scene.id);
        window.history.replaceState(null, '', `${window.location.pathname}?${parameters.toString()}`);
        if (scene.kind === 'discussion') {
            document.body.classList.add('tour-discussion');
            return;
        }
        document.body.classList.remove('tour-discussion');
        if (scene.kind === 'walkthrough') {
            renderWalkthroughStep(scene);
            return;
        }
        emitDiffScene(scene, index);
    }

    function emitDiffScene(scene, index, annotation = null, comparisonId = scene.id) {
        const tour = state.tour;
        if (!tour) return;
        const diffModel = buildTwoWayDiffModel(scene.leftContent, scene.rightContent);
        emit({
            type: 'showDiff',
            file1: scene.leftLabel,
            file2: scene.rightLabel,
            comparisonId: `tour-${comparisonId}`,
            leftContent: scene.leftContent,
            rightContent: scene.rightContent,
            diffModel,
            history: null,
            fileNavigation: {
                canGoPrevious: index > 0,
                canGoNext: index < tour.scenes.length - 1
            },
            editableSides: { left: false, right: false },
            comparisonSummary: `${scene.path} · ${scene.takeaway}`,
            initialChangeIndex: annotation
                ? findChangeIndexAtSourceLine(diffModel, annotation.side, annotation.startLine)
                : scene.focusChangeIndex,
            tourAnnotation: annotation
        });
    }

    function renderWalkthroughStep(scene) {
        const step = scene.steps[state.activeStepIndex];
        if (!step) return;
        const side = step.focus.revision === 'base' ? 'left' : 'right';
        emitDiffScene(step.diff, state.activeSceneIndex, {
            side,
            startLine: step.focus.startLine,
            endLine: step.focus.endLine,
            label: `${step.title}: ${step.body}`
        }, `${scene.id}-${step.id}`);
    }

    function getLinearTourTarget(direction) {
        const tour = state.tour;
        const scene = tour?.scenes[state.activeSceneIndex];
        if (!tour || !scene || direction === 0) {
            return null;
        }
        if (direction > 0) {
            if (scene.kind === 'walkthrough' && state.activeStepIndex < scene.steps.length - 1) {
                return { sceneIndex: state.activeSceneIndex, stepIndex: state.activeStepIndex + 1 };
            }
            if (state.activeSceneIndex < tour.scenes.length - 1) {
                return { sceneIndex: state.activeSceneIndex + 1, stepIndex: 0 };
            }
            return null;
        }
        if (scene.kind === 'walkthrough' && state.activeStepIndex > 0) {
            return { sceneIndex: state.activeSceneIndex, stepIndex: state.activeStepIndex - 1 };
        }
        if (state.activeSceneIndex > 0) {
            const previousScene = tour.scenes[state.activeSceneIndex - 1];
            return {
                sceneIndex: state.activeSceneIndex - 1,
                stepIndex: previousScene.kind === 'walkthrough' ? previousScene.steps.length - 1 : 0
            };
        }
        return null;
    }

    function showTourLinear(direction) {
        const target = getLinearTourTarget(direction);
        if (!target) {
            return false;
        }
        showTourScene(target.sceneIndex, target.stepIndex);
        return true;
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
        if (scene.kind === 'walkthrough') {
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
        const step = scene.kind === 'walkthrough' ? scene.steps[state.activeStepIndex] : null;
        stepPanel.hidden = !step;
        if (step) {
            stepTitle.textContent = step.title;
            stepBody.textContent = step.body;
            if (step.connection) {
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
        previous.disabled = !getLinearTourTarget(-1);
        next.disabled = !getLinearTourTarget(1);
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
