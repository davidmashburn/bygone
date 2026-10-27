/* global require, module */
const assert = require('node:assert/strict');

// Uses the real presenter, DOM, controller and media element; only device speech
// is stubbed so the test is silent and does not depend on installed voices.
async function runNarrationControlsSmoke({ evaluate, wait, window }) {
    await evaluate(`(() => {
        window.narrationSmoke = { spoken: [], actions: {}, audio: [] };
        const smoke = window.narrationSmoke;
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        speechSynthesis.speak = utterance => { smoke.spoken.push(utterance); };
        speechSynthesis.cancel = () => {};
        speechSynthesis.pause = () => {};
        speechSynthesis.resume = () => {};
        speechSynthesis.getVoices = () => [{ voiceURI: 'smoke', name: 'Smoke', lang: 'en', localService: true }];
        speechSynthesis.dispatchEvent(new Event('voiceschanged'));
        const Audio = window.Audio;
        window.Audio = function (src) { const audio = new Audio(src); smoke.audio.push(audio); return audio; };
        const setHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (action, handler) => {
            smoke.actions[action] = handler; setHandler(action, handler);
        };
        smoke.key = (key, options = {}, selector = '#tour-narrative-content') => {
            const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options });
            document.querySelector(selector).dispatchEvent(event);
            return event.defaultPrevented;
        };
        document.querySelector('#tour-audio-settings').hidden = true;
    })()`);
    const activeKey = () => evaluate("document.querySelector('.tour-reading-item.is-active').dataset.readingKey");
    const status = () => evaluate("document.querySelector('#tour-narration-status').textContent");
    const key = (value, options = {}, selector) => evaluate(`narrationSmoke.key(${JSON.stringify(value)}, ${JSON.stringify(options)}, ${JSON.stringify(selector)})`);
    const originalKey = await activeKey();
    assert.equal(await key('ArrowRight', { shiftKey: true }), true);
    assert.equal(await activeKey(), originalKey, 'Idle skip does not advance the tour');
    assert.equal(await evaluate('narrationSmoke.spoken.length'), 0, 'Idle skip does not start speech');

    await evaluate("document.querySelector('#tour-narrative-content').tabIndex = -1; document.querySelector('#tour-narrative-content').focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await wait("document.querySelector('#tour-listen-label').textContent === 'Pause'");
    assert.equal(await activeKey(), originalKey, 'Space starts at the current passage, without advancing it');
    assert.equal(await evaluate("document.querySelector('#tour-audio-settings').hidden"), false, 'Starting reveals the controls');
    await wait("narrationSmoke.audio[0]?.readyState >= 2 && !narrationSmoke.audio[0].paused");
    assert.equal(await evaluate('navigator.mediaSession.playbackState'), 'playing');
    assert.equal(await evaluate('narrationSmoke.audio[0].loop'), true);
    assert.equal(await evaluate('narrationSmoke.audio[0].duration'), 10, 'Silent PCM decodes under the offline export policy');

    assert.equal(await key(' ', { repeat: true }), true);
    assert.match(await status(), /^Speaking/);
    assert.equal(await key(' '), true);
    assert.match(await status(), /^Paused/);
    await wait('narrationSmoke.audio[0].paused');
    assert.equal(await evaluate('navigator.mediaSession.playbackState'), 'paused');
    const paused = await status();
    const selectedSegment = await evaluate("document.querySelector('.tour-narration-segment.is-speaking').dataset.narrationSegmentId");
    await evaluate("document.querySelector('#tour-audio-settings').hidden = true");
    assert.equal(await key('ArrowRight', { shiftKey: true }), true);
    assert.match(await status(), /^Paused/);
    assert.notEqual(await evaluate("document.querySelector('.tour-narration-segment.is-speaking').dataset.narrationSegmentId"), selectedSegment);
    await key('ArrowLeft', { shiftKey: true });
    assert.equal(await status(), paused, 'Skipping back returns to the same paused segment');
    assert.equal(await activeKey(), originalKey);

    // Inputs, buttons, contenteditable, selection, modal dialogs and editor
    // surfaces must retain their native keyboard behavior.
    await evaluate(`(() => {
        const guards = document.createElement('div'); guards.id = 'narration-smoke-guards';
        guards.innerHTML = '<input id="ns-input"><button id="ns-button">Next</button><div id="ns-editable" contenteditable="plaintext-only">edit</div><div class="monaco-editor" id="ns-editor"></div><div id="ns-resizer" role="separator"></div><p id="ns-selection">Selected text</p>';
        document.body.append(guards);
    })()`);
    for (const selector of ['#ns-input', '#ns-button', '#ns-editable', '#ns-editor', '#ns-resizer']) {
        assert.equal(await key(' ', {}, selector), false, `Preserve Space in ${selector}`);
        assert.equal(await key('ArrowRight', { shiftKey: true }, selector), false, `Preserve selection in ${selector}`);
    }
    for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
        assert.equal(await key(' ', options), false);
    }
    await evaluate("const range = document.createRange(); range.selectNodeContents(document.querySelector('#ns-selection')); getSelection().addRange(range)");
    assert.equal(await key(' '), false);
    assert.equal(await key('ArrowRight', { shiftKey: true }), false);
    await evaluate("getSelection().removeAllRanges(); const modal = document.createElement('dialog'); modal.id = 'ns-dialog'; document.body.append(modal); modal.showModal()");
    assert.equal(await key(' '), false);
    assert.equal(await key('ArrowRight', { shiftKey: true }), false);
    await evaluate("document.querySelector('#ns-dialog').remove(); document.querySelector('#narration-smoke-guards').remove()");
    assert.equal(await status(), paused, 'Guarded shortcuts never change narration');

    await evaluate('narrationSmoke.actions.play()');
    await wait("navigator.mediaSession.playbackState === 'playing' && !narrationSmoke.audio[0].paused");
    await evaluate('narrationSmoke.actions.play()');
    assert.match(await status(), /^Speaking/, 'Repeated system play is idempotent');
    await evaluate('narrationSmoke.actions.nexttrack()');
    assert.match(await status(), /^Speaking/);
    await evaluate('narrationSmoke.actions.previoustrack()');
    assert.equal(await activeKey(), originalKey);
    await evaluate('narrationSmoke.actions.pause(); narrationSmoke.actions.pause()');
    assert.match(await status(), /^Paused/, 'Repeated system pause is idempotent');
    await key(' ');
    await wait("navigator.mediaSession.playbackState === 'playing' && !narrationSmoke.audio[0].paused");
    await evaluate('narrationSmoke.audio[0].pause()');
    await wait("document.querySelector('#tour-listen-label').textContent === 'Resume'");

    // Plain arrows retain passage navigation, including paused narration.
    await key('ArrowRight');
    await wait(`document.querySelector('.tour-reading-item.is-active').dataset.readingKey !== ${JSON.stringify(originalKey)}`);
    await key('ArrowLeft');
    await wait(`document.querySelector('.tour-reading-item.is-active').dataset.readingKey === ${JSON.stringify(originalKey)}`);
    await evaluate('narrationSmoke.actions.stop()');
    assert.equal(await evaluate('navigator.mediaSession.playbackState'), 'none');
    assert.equal(await evaluate('navigator.mediaSession.metadata'), null);
    assert.equal(await evaluate('Object.values(narrationSmoke.actions).every(action => action === null)'), true);
    assert.equal(await evaluate("narrationSmoke.audio[0].hasAttribute('src')"), false, 'Stop releases audio focus and the blob');

    // Exercise completion and disposal after a fresh session too.
    await evaluate("location.hash = '#location=1&mode=historical&part=conclusion'");
    await wait("document.querySelector('.tour-reading-item.is-active').dataset.readingKey === 'conclusion'");
    await key(' ');
    await evaluate(`(() => {
        let count = 0;
        while (navigator.mediaSession.playbackState === 'playing' && count++ < 100) narrationSmoke.spoken.at(-1).onend();
    })()`);
    assert.equal(await evaluate('navigator.mediaSession.playbackState'), 'none', 'Completion releases media controls');
    await key(' ');
    await wait("navigator.mediaSession.playbackState === 'playing'");
    await evaluate("document.querySelector('[data-workspace-mode=compare]').click()");
    await wait("document.querySelector('[data-workspace-mode=compare][aria-selected=true]')");
    // Mode changes may pause exploration; opening a different document stops it.
    await evaluate("window.dispatchEvent(new Event('beforeunload'))");
    assert.equal(await evaluate('navigator.mediaSession.playbackState'), 'none', 'Disposal releases media controls');
}

module.exports = { runNarrationControlsSmoke };
