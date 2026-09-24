const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'script.js'), 'utf8');

function loadRenderCompletionNotifier() {
    const start = rendererSource.indexOf('function notifyRenderComplete(');
    const end = rendererSource.indexOf('\n\nhost.onMessage', start);
    assert.ok(start >= 0 && end > start, 'renderer should define notifyRenderComplete before host message handling');

    const callbacks = [];
    const messages = [];
    const context = {
        applyPendingNavigationRestore() {},
        currentMode: 'two-way',
        host: { postMessage(message) { messages.push(message); } },
        requestAnimationFrame(callback) { callbacks.push(callback); }
    };
    vm.runInNewContext(rendererSource.slice(start, end), context);
    return { callbacks, context, messages };
}

function flushRenderCompletion(callbacks) {
    assert.equal(callbacks.length, 1);
    callbacks.shift()();
    assert.equal(callbacks.length, 1);
    callbacks.shift()();
}

test('render completion echoes a request token captured before animation frames', () => {
    const { callbacks, context, messages } = loadRenderCompletionNotifier();

    context.notifyRenderComplete(17);
    context.currentMode = 'multi-way';
    flushRenderCompletion(callbacks);

    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'renderComplete', mode: 'multi-way', renderRequestId: 17 }]);
});

test('render completion omits the token for legacy hosts', () => {
    const { callbacks, context, messages } = loadRenderCompletionNotifier();

    context.notifyRenderComplete();
    flushRenderCompletion(callbacks);

    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'renderComplete', mode: 'two-way' }]);
});
