/* global require, module, console */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const READING_SELECTOR = '.tour-reading-item[data-reading-key][data-reading-kind]';
const TRANSITION_TYPES = ['showDiff', 'showMultiDiff'];

async function runTourReadingSmoke({ browserContents, browserWindow }) {
    if (!browserContents || typeof browserContents.executeJavaScript !== 'function') {
        throw new TypeError('Tour reading smoke requires browser web contents.');
    }

    const evaluate = (code) => browserContents.executeJavaScript(code, true).catch((error) => {
        throw new Error(`Tour reading script failed: ${code}\n${error.message}`);
    });
    const waitFor = (condition, label = condition) => evaluate(`new Promise((resolve, reject) => {
        const start = performance.now();
        const check = () => {
            let matched = false;
            try { matched = Boolean(${condition}); } catch {}
            if (matched) resolve(true);
            else if (performance.now() - start > 15000) reject(new Error(${JSON.stringify(label)}));
            else requestAnimationFrame(check);
        };
        check();
    })`);
    const waitForRaf = () => evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const read = () => evaluate(`(() => {
        const content = document.querySelector('#tour-narrative-content');
        const elements = [...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})];
        const describe = (element) => ({
            key: element.dataset.readingKey,
            kind: element.dataset.readingKind,
            sceneIndex: element.dataset.sceneIndex,
            stepIndex: element.dataset.stepIndex,
            hidden: element.hidden,
            display: getComputedStyle(element).display,
            rects: element.getClientRects().length
        });
        const parameters = new URLSearchParams(location.search);
        return {
            content: content ? {
                scrollTop: content.scrollTop,
                scrollHeight: content.scrollHeight,
                clientHeight: content.clientHeight,
                overflowY: getComputedStyle(content).overflowY
            } : null,
            items: elements.map(describe),
            activeKeys: elements.filter((element) => element.classList.contains('is-active'))
                .map((element) => element.dataset.readingKey),
            url: {
                scene: parameters.get('scene'),
                step: parameters.get('step'),
                view: parameters.get('view'),
                mode: parameters.get('mode')
            }
        };
    })()`);
    const messages = () => evaluate('(window.__tourReadingSmokeMessages || []).slice()');
    const clearMessages = () => evaluate('(window.__tourReadingSmokeMessages || []).splice(0)');
    const activeKey = async () => (await read()).activeKeys[0];
    const waitForActive = (key) => waitFor(
        `document.querySelector(${JSON.stringify(`${READING_SELECTOR}.is-active`)})?.dataset.readingKey === ${JSON.stringify(key)}`,
        `active reading item ${key}`
    );
    const scrollToKey = async (key) => {
        await evaluate(`(() => {
            const content = document.querySelector('#tour-narrative-content');
            const element = [...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
                .find((candidate) => candidate.dataset.readingKey === ${JSON.stringify(key)});
            if (!content || !element) throw new Error('Cannot scroll to reading item ' + ${JSON.stringify(key)});
            content.scrollTop = Math.max(0, Math.min(
                content.scrollHeight - content.clientHeight,
                content.scrollTop + element.getBoundingClientRect().top - content.getBoundingClientRect().top
            ));
            content.dispatchEvent(new Event('scroll', { bubbles: true }));
        })()`);
        await waitForActive(key);
    };
    const clickById = (id) => evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`);
    const clickSelector = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    const assertLocation = (snapshot, item, sceneItems) => {
        const scene = sceneItems.find((candidate) => Number(candidate.sceneIndex) === Number(item.sceneIndex));
        const sceneId = scene?.key.slice('scene:'.length);
        assert.ok(sceneId, `Reading item ${item.key} has a scene location`);
        assert.equal(snapshot.url.scene, sceneId, `${item.key} updates the scene URL`);
        if (item.kind === 'title') {
            assert.ok(snapshot.url.step, 'The title item retains the scene landing step URL');
            assert.equal(snapshot.url.view, 'tour', 'The title item sets the tour URL view');
        } else if (item.kind === 'chapter') {
            assert.ok(snapshot.url.step, `${item.key} retains the scene landing step URL`);
            assert.equal(snapshot.url.view, 'chapter', `${item.key} sets the chapter URL view`);
        } else if (item.kind === 'scene') {
            assert.ok(snapshot.url.step, `${item.key} retains the scene landing step URL`);
            assert.equal(snapshot.url.view, 'overview', `${item.key} sets the overview URL view`);
        } else {
            const [, expectedScene, ...stepParts] = item.key.split(':');
            assert.equal(expectedScene, sceneId, `${item.key} has the expected scene id`);
            assert.equal(snapshot.url.step, stepParts.join(':'), `${item.key} sets the step URL`);
            assert.equal(snapshot.url.view, null, `${item.key} clears the parent URL view`);
        }
    };

    await evaluate(`(() => {
        const key = '__tourReadingSmokeMessages';
        window[key] = [];
        const listener = (event) => {
            const detail = event.detail;
            if (!detail || typeof detail !== 'object') return;
            window[key].push({
                type: detail.type || null,
                path: detail.path || detail.filePath || null,
                panelCount: Array.isArray(detail.panels) ? detail.panels.length : 0
            });
        };
        window.__tourReadingSmokeListener = listener;
        window.addEventListener('bygone:host-message', listener);
    })()`);

    try {
        await waitFor(
            `document.querySelector('#tour-narrative-content') && document.querySelectorAll(${JSON.stringify(READING_SELECTOR)}).length >= 9 && document.querySelector('.tour-reading-item.is-active')`,
            'continuous tour reading document'
        );
        const initial = await read();
        assert.ok(initial.content, 'The continuous narrative content exists');
        assert.ok(initial.content.scrollHeight > initial.content.clientHeight, 'The narrative content is scrollable');
        assert.ok(['auto', 'scroll'].includes(initial.content.overflowY), 'The narrative content uses scrolling');
        assert.equal(initial.activeKeys.length, 1, 'Exactly one reading item is active initially');
        assert.equal(initial.activeKeys[0], 'title', 'The title starts as the active reading item');

        const originalHeight = await evaluate("document.querySelector('#tour-narrative').getBoundingClientRect().height");
        const originalPreference = await evaluate("localStorage.getItem('bygone.tourNarrativeHeight')");
        const resizeKey = async (key) => {
            await evaluate(`document.querySelector('#tour-narrative-resizer').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ${JSON.stringify(key)} }))`);
            await waitForRaf();
        };
        const readSplit = () => evaluate(`(() => {
            const narrative = document.querySelector('#tour-narrative').getBoundingClientRect();
            const code = document.querySelector('#container').getBoundingClientRect();
            const resizer = document.querySelector('#tour-narrative-resizer');
            const handle = resizer.getBoundingClientRect();
            return { height: narrative.height, codeTop: code.top, codeHeight: code.height,
                handleY: handle.top + handle.height / 2, handleX: handle.left + handle.width / 2,
                value: Number(resizer.getAttribute('aria-valuenow')),
                max: Number(resizer.getAttribute('aria-valuemax')),
                stored: Number(localStorage.getItem('bygone.tourNarrativeHeight')),
                cursor: getComputedStyle(resizer).cursor };
        })()`);
        const assertSplit = (split) => {
            assert.ok(Math.abs(split.codeTop - split.height) <= 1, 'Code starts at the narrative boundary');
            assert.ok(Math.abs(split.handleY - split.height) <= 1, 'The divider tracks the narrative boundary');
            assert.equal(split.value, split.height, 'The separator exposes its current height');
            assert.ok(split.codeHeight >= 180, 'Resizing preserves room for code');
        };
        const dragSplit = async (height) => {
            const split = await readSplit();
            const x = Math.round(split.handleX);
            const y = Math.round(split.handleY);
            browserContents.sendInputEvent({ type: 'mouseMove', x, y });
            browserContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
            browserContents.sendInputEvent({ type: 'mouseMove', x, y: height });
            await waitFor(`Number(document.querySelector('#tour-narrative-resizer').getAttribute('aria-valuenow')) === ${height}`, 'dragged narrative boundary');
            browserContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y: height });
            await waitFor("!document.body.classList.contains('is-resizing-tour-narrative')", 'narrative drag completion');
            await waitForRaf();
        };
        try {
            assert.equal((await readSplit()).cursor, 'row-resize', 'The narrative divider is draggable');
            await resizeKey('Home');
            let split = await readSplit();
            assert.equal(split.height, 180, 'Home sets the minimum narrative height');
            assertSplit(split);
            await resizeKey('End');
            split = await readSplit();
            assert.equal(split.height, split.max, 'End sets the maximum narrative height');
            assertSplit(split);
            await resizeKey('ArrowUp');
            assert.equal((await readSplit()).height, split.max - 16, 'ArrowUp reduces the narrative height');
            await resizeKey('ArrowDown');
            assert.equal((await readSplit()).height, split.max, 'ArrowDown increases the narrative height');
            const target = Math.round((180 + split.max) / 2);
            await dragSplit(target);
            split = await readSplit();
            assertSplit(split);
            assert.equal(split.stored, target, 'Dragging saves the narrative height');
            assert.deepEqual((await read()).activeKeys, initial.activeKeys, 'Resizing preserves the selected passage');
            assert.deepEqual((await read()).url, initial.url, 'Resizing preserves the reading URL');
        } finally {
            await dragSplit(Math.round(originalHeight));
            await evaluate(originalPreference === null
                ? "localStorage.removeItem('bygone.tourNarrativeHeight')"
                : `localStorage.setItem('bygone.tourNarrativeHeight', ${JSON.stringify(originalPreference)})`);
        }
        assert.equal(initial.items.filter((item) => item.kind === 'title').length, 1, 'The title item is unique');
        assert.equal(initial.items.filter((item) => item.kind === 'chapter').length, 2, 'Each chapter has a reading item');
        assert.equal(initial.items.filter((item) => item.kind === 'scene').length, 2, 'Each scene has a reading item');
        assert.equal(initial.items.filter((item) => item.kind === 'step').length, 4, 'Each step has a reading item');
        assert.equal(initial.items.every((item) => item.hidden === false && item.display !== 'none' && item.rects > 0), true,
            'Reading items remain present and visible in the narrative document');
        assert.equal(initial.items.every((item) => item.sceneIndex !== undefined && item.stepIndex !== undefined), true,
            'Reading items expose scene and step indexes');
        assert.deepEqual(initial.items.map((item) => item.key), [
            'title', 'chapter:chapter-one', 'scene:scene-one', 'step:scene-one:step-one-a',
            'step:scene-one:step-one-b', 'chapter:chapter-two', 'scene:scene-two',
            'step:scene-two:step-two-a', 'step:scene-two:step-two-b'
        ], 'Reading items follow title, chapter, scene, and step order');
        assert.equal(await evaluate("Boolean(document.querySelector('#tour-next, #tour-previous, #tour-reading-path'))"), false,
            'The legacy linear navigation controls are absent');

        const sceneItems = initial.items.filter((item) => item.kind === 'scene');
        const chapterItems = initial.items.filter((item) => item.kind === 'chapter');
        const stepItems = initial.items.filter((item) => item.kind === 'step');
        const secondSceneId = sceneItems[1].key.slice('scene:'.length);
        const secondSceneSteps = stepItems.filter((item) => Number(item.sceneIndex) === Number(sceneItems[1].sceneIndex));
        assert.equal(secondSceneSteps.length, 2, 'The second scene has two steps');

        const sceneTitles = await evaluate(`Object.fromEntries([...document.querySelectorAll('.tour-scene[data-scene-id]')].map((element) => [
            element.dataset.sceneId, element.querySelector('.tour-scene-title')?.textContent.trim() || ''
        ]))`);
        const contextDetails = await evaluate(`([...document.querySelectorAll(${JSON.stringify(`${READING_SELECTOR}[data-reading-kind="step"]`)})]).map((element) => {
            const context = element.closest('.tour-scene-group')?.querySelector('details.tour-scene-context');
            const heading = element.querySelector('h3, .tour-step-title');
            const body = element.querySelector('.tour-step-body');
            const duplicateNavigation = context && context.querySelector(
                '.tour-outline-toggle, .tour-outline-step, .tour-reading-item, [data-reading-key]'
            );
            return {
                key: element.dataset.readingKey,
                sceneId: element.dataset.readingKey.split(':')[1],
                open: context?.open ?? null,
                summary: context?.querySelector('summary')?.getAttribute('aria-label') || null,
                repeatedContext: Boolean(element.querySelector('.tour-step-context')),
                beforeHeading: Boolean(context && heading
                    && (context.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)),
                beforeBody: Boolean(context && body
                    && (context.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)),
                duplicateNavigation: Boolean(duplicateNavigation),
                code: element.querySelector('.tour-step-code-location, .tour-step-code')?.textContent.trim() || ''
            };
        })`);
        assert.equal(contextDetails.length, 4, 'Every step belongs to a scene with an overview disclosure');
        for (const detail of contextDetails) {
            assert.equal(detail.open, false, `${detail.key} starts collapsed`);
            assert.equal(detail.repeatedContext, false, `${detail.key} does not repeat the scene overview`);
            assert.equal(detail.summary, `Scene overview: ${sceneTitles[detail.sceneId]}`, `${detail.key} labels its scene context`);
            assert.equal(detail.beforeHeading, true, `${detail.key} context precedes its heading`);
            assert.equal(detail.beforeBody, true, `${detail.key} context precedes its body`);
            assert.equal(detail.duplicateNavigation, false, `${detail.key} context contains no duplicate navigation`);
        }

        const toggles = await evaluate(`([...document.querySelectorAll('.tour-outline-toggle')]).map((element, index) => ({
            index, controls: element.getAttribute('aria-controls'), expanded: element.getAttribute('aria-expanded')
        }))`);
        assert.ok(toggles.length >= 4, 'Chapter and scene outline groups have independent toggles');
        for (const toggle of toggles) {
            const label = `outline toggle ${toggle.index}`;
            assert.ok(toggle.controls, `${label} identifies its child container`);
            const before = await read();
            await evaluate(`document.querySelectorAll('.tour-outline-toggle')[${toggle.index}]?.click()`);
            await waitFor(
                `document.querySelectorAll('.tour-outline-toggle')[${toggle.index}]?.getAttribute('aria-expanded') !== ${JSON.stringify(toggle.expanded)}`,
                `${label} toggles aria-expanded`
            );
            const collapsed = await evaluate(`(() => {
                const toggle = document.querySelectorAll('.tour-outline-toggle')[${toggle.index}];
                const child = document.getElementById(toggle?.getAttribute('aria-controls'));
                return { expanded: toggle?.getAttribute('aria-expanded'), hidden: child?.hidden ?? null };
            })()`);
            assert.equal(collapsed.expanded, toggle.expanded === 'true' ? 'false' : 'true', `${label} changes its own expanded state`);
            assert.equal(collapsed.hidden, collapsed.expanded !== 'true', `${label} controls only its child container`);
            assert.equal(await activeKey(), before.activeKeys[0], `${label} does not change the active reading item`);
            await evaluate(`document.querySelectorAll('.tour-outline-toggle')[${toggle.index}]?.click()`);
            await waitFor(
                `document.querySelectorAll('.tour-outline-toggle')[${toggle.index}]?.getAttribute('aria-expanded') === ${JSON.stringify(toggle.expanded)}`,
                `${label} restores aria-expanded`
            );
        }

        await scrollToKey(chapterItems[0].key);
        let snapshot = await read();
        assert.equal(snapshot.activeKeys[0], chapterItems[0].key);
        assertLocation(snapshot, chapterItems[0], sceneItems);
        await scrollToKey(sceneItems[0].key);
        snapshot = await read();
        assertLocation(snapshot, sceneItems[0], sceneItems);
        await scrollToKey(sceneItems[1].key);
        snapshot = await read();
        assertLocation(snapshot, sceneItems[1], sceneItems);

        await clearMessages();
        await evaluate(`(() => [...document.querySelectorAll('.tour-scene[data-scene-id]')]
            .find((element) => element.dataset.sceneId === ${JSON.stringify(secondSceneId)})?.click())()`);
        await waitForActive(`scene:${secondSceneId}`);
        snapshot = await read();
        assertLocation(snapshot, sceneItems[1], sceneItems);

        const secondStep = secondSceneSteps[1];
        await clearMessages();
        await evaluate(`(() => [...document.querySelectorAll('.tour-outline-step')]
            .find((element) => element.dataset.sceneId === ${JSON.stringify(secondSceneId)}
                && element.dataset.stepIndex === ${JSON.stringify(secondStep.stepIndex)})?.click())()`);
        await waitForActive(secondStep.key);
        await waitFor("document.querySelectorAll('.monaco-editor').length > 0", 'step code evidence');
        const directMessages = await messages();
        assert.equal(directMessages.some((message) => TRANSITION_TYPES.includes(message.type)), true,
            'Direct step navigation emits a diff source transition');
        snapshot = await read();
        assertLocation(snapshot, secondStep, sceneItems);

        const secondStepContext = contextDetails.find((detail) => detail.key === secondStep.key);
        assert.ok(secondStepContext, 'The selected step has context details');
        const contextBefore = await evaluate(`(() => {
            const element = [...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
                .find((candidate) => candidate.dataset.readingKey === ${JSON.stringify(secondStep.key)});
            const details = element?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context');
            return {
                open: details?.open ?? null,
                active: document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey || null,
                code: element?.querySelector('.tour-step-code-location, .tour-step-code')?.textContent.trim() || ''
            };
        })()`);
        await clearMessages();
        const contextClick = await evaluate(`(() => {
            const details = [...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
                .find((element) => element.dataset.readingKey === ${JSON.stringify(secondStep.key)})
                ?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context');
            details?.closest('.tour-scene-header')?.querySelector('.tour-scene-title-toggle')?.click();
            return { open: details?.open, html: details?.outerHTML };
        })()`);
        assert.equal(contextClick.open, true, `Context opens on click: ${JSON.stringify(contextClick)}`);
        await waitFor(`[...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
            .find((element) => element.dataset.readingKey === ${JSON.stringify(secondStep.key)})
            ?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context')?.open === true`, 'step context expansion');
        const contextAfter = await evaluate(`(() => {
            const element = [...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
                .find((candidate) => candidate.dataset.readingKey === ${JSON.stringify(secondStep.key)});
            const details = element?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context');
            return {
                active: document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey || null,
                code: element?.querySelector('.tour-step-code-location, .tour-step-code')?.textContent.trim() || '',
                open: details?.open ?? null
            };
        })()`);
        assert.equal(contextBefore.open, false, 'The selected step disclosure was initially closed');
        assert.equal(contextAfter.active, contextBefore.active, 'Expanding context preserves the active reading key');
        assert.equal(contextAfter.code, contextBefore.code, 'Expanding context preserves the selected code target');
        assert.equal((await messages()).some((message) => TRANSITION_TYPES.includes(message.type)), false,
            'Expanding context does not emit a code transition');
        await evaluate(`([...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
            .find((element) => element.dataset.readingKey === ${JSON.stringify(secondStep.key)})
            ?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context summary')?.click())`);
        await waitFor(`[...document.querySelectorAll(${JSON.stringify(READING_SELECTOR)})]
            .find((element) => element.dataset.readingKey === ${JSON.stringify(secondStep.key)})
            ?.closest('.tour-scene-group')?.querySelector('details.tour-scene-context')?.open === false`, 'step context collapse');

        await scrollToKey(secondStep.key);
        const beforeCodeScroll = await read();
        const codeNodes = await evaluate(`(() => {
            const nodes = [...document.querySelectorAll('.monaco-editor, .monaco-editor .overflow-guard, .monaco-editor .monaco-scrollable-element')];
            for (const node of nodes) {
                node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
                node.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            return nodes.length;
        })()`);
        assert.ok(codeNodes > 0, 'The selected step has a rendered code surface');
        await waitForRaf();
        const afterCodeScroll = await read();
        assert.deepEqual(afterCodeScroll.activeKeys, beforeCodeScroll.activeKeys, 'Code scrolling does not change the active reading item');
        assert.deepEqual(afterCodeScroll.url, beforeCodeScroll.url, 'Code scrolling does not change the narrative URL');

        if (browserWindow && typeof browserWindow.capturePage === 'function') {
            try {
                const image = await browserWindow.capturePage();
                if (image && typeof image.toPNG === 'function') fs.writeFileSync('/tmp/bygone-continuous-tour.png', image.toPNG());
            } catch (error) {
                console.warn(`Tour reading screenshot skipped: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        const beforeSidebar = await read();
        await clickSelector('#tour-sidebar-hide');
        await waitFor("document.querySelector('#tour-sidebar-show') && !document.querySelector('#tour-sidebar-show').hidden", 'tour sidebar collapse');
        const afterSidebar = await read();
        assert.deepEqual(afterSidebar.activeKeys, beforeSidebar.activeKeys, 'Collapsing the sidebar preserves the selected passage');
        assert.deepEqual(afterSidebar.url, beforeSidebar.url, 'Collapsing the sidebar preserves the reading URL');
        assert.ok(Math.abs(afterSidebar.content.scrollTop - beforeSidebar.content.scrollTop) <= 2,
            'Collapsing the sidebar preserves the narrative scroll position');
        await clickSelector('#tour-sidebar-show');
        await waitFor("document.querySelector('#tour-sidebar-show')?.hidden === true", 'tour sidebar restore');

        const readingKeys = initial.items.map((item) => item.key);
        const firstLastStepIndex = readingKeys.indexOf('step:scene-one:step-one-b');
        const secondSceneIndex = readingKeys.indexOf(sceneItems[1].key);
        await scrollToKey('step:scene-one:step-one-b');
        const forwardKeys = readingKeys.slice(firstLastStepIndex + 1, readingKeys.indexOf(secondSceneSteps[0].key) + 1);
        for (const key of forwardKeys) {
            await evaluate(`document.querySelector('#tour-narrative-content').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))`);
            await waitForActive(key);
        }
        assert.ok(secondSceneIndex > firstLastStepIndex, 'The reading order crosses the scene boundary');
        const backwardKeys = readingKeys.slice(firstLastStepIndex, readingKeys.indexOf(secondSceneSteps[0].key)).reverse();
        for (const key of backwardKeys) {
            await evaluate(`document.querySelector('#tour-narrative-content').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }))`);
            await waitForActive(key);
        }
        assert.equal(await activeKey(), 'step:scene-one:step-one-b', 'ArrowLeft returns across the scene boundary');

        await scrollToKey('step:scene-two:step-two-b');
        const beforeTitle = await read();
        await clickById('tour-title');
        await waitForActive('title');
        await waitFor("document.querySelector('#tour-narrative-content').scrollTop <= 1", 'title scroll top');
        const afterTitle = await read();
        assertLocation(afterTitle, initial.items[0], sceneItems);
        assert.ok(beforeTitle.content.scrollTop > 1, 'The title test starts from a scrolled passage');

        const modeRoundTrip = async (mode) => {
            await scrollToKey('step:scene-two:step-two-b');
            const before = await read();
            await clearMessages();
            await clickSelector(`[data-workspace-mode=${mode}]`);
            await waitFor(`document.querySelector('[data-workspace-mode=${mode}][aria-pressed=true]')`, `${mode} workspace mode`);
            await waitFor(
                `(window.__tourReadingSmokeMessages || []).some((message) => ${JSON.stringify(mode === 'history' ? ['showDirectoryDiff'] : TRANSITION_TYPES)}.includes(message.type))`,
                `${mode} source transition`
            );
            await clickSelector('[data-workspace-mode=historical]');
            await waitFor("document.querySelector('[data-workspace-mode=historical][aria-pressed=true]')", 'historical workspace mode');
            await waitFor(`document.querySelector('.tour-reading-item.is-active')?.dataset.readingKey === ${JSON.stringify(before.activeKeys[0])}
                && Math.abs(document.querySelector('#tour-narrative-content').scrollTop - ${JSON.stringify(before.content.scrollTop)}) <= 8`,
                `${mode} restores reading position`);
            const after = await read();
            assert.deepEqual(after.activeKeys, before.activeKeys, `${mode} round trip restores the reading key`);
            assert.ok(Math.abs(after.content.scrollTop - before.content.scrollTop) <= 8, `${mode} round trip restores scroll`);
            assert.deepEqual(after.url, before.url, `${mode} round trip restores the reading URL`);
        };
        await modeRoundTrip('history');
        await modeRoundTrip('compare');
    } finally {
        await evaluate(`(() => {
            if (window.__tourReadingSmokeListener) {
                window.removeEventListener('bygone:host-message', window.__tourReadingSmokeListener);
                delete window.__tourReadingSmokeListener;
            }
            delete window.__tourReadingSmokeMessages;
        })()`).catch(() => {});
    }
}

module.exports = { runTourReadingSmoke };
