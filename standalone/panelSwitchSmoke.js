/* global require, module, console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function runPanelSwitchSmoke({ browserContents, openMulti }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-panel-switch-'));
    const evaluate = (code) => browserContents.executeJavaScript(code, true);
    try {
        const files = [0, 1, 2].map((index) => {
            const file = path.join(root, `panel-${index}.txt`);
            fs.writeFileSync(file, `shared\nrevision ${index}\nshared\n`);
            return file;
        });
        await openMulti(files);
        await evaluate(`new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                if (document.querySelectorAll('.multi-pane').length === 3
                    && document.querySelectorAll('.bygone-paired-line').length > 0) resolve();
                else if (Date.now() - started > 10000) reject(new Error('Panel switch fixture did not render'));
                else requestAnimationFrame(check);
            };
            check();
        })`);
        const results = await evaluate(`(async () => {
            const canvas = document.getElementById('connection-canvas');
            const context = canvas.getContext('2d');
            const clearRect = context.clearRect;
            const createLinearGradient = context.createLinearGradient;
            let gradients = [];
            context.clearRect = function (...args) {
                gradients = [];
                return clearRect.apply(this, args);
            };
            context.createLinearGradient = function (...args) {
                gradients.push([args[0], args[2]]);
                return createLinearGradient.apply(this, args);
            };
            const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const switchPair = (index) => document.querySelectorAll('.multi-gutter')[index].click();
            const read = () => {
                const pairIndex = Number(document.querySelector('.multi-gutter.is-active-pair').dataset.pairIndex);
                const editors = document.querySelectorAll('.multi-pane .monaco-editor');
                const left = editors[pairIndex].getBoundingClientRect();
                const right = editors[pairIndex + 1].getBoundingClientRect();
                const bounds = canvas.getBoundingClientRect();
                return { pairIndex, gradients, expected: [left.right - bounds.left - 2, right.left - bounds.left + 2] };
            };
            try {
                await pause(250);
                switchPair(1);
                await pause(400);
                const forward = read();
                switchPair(0);
                await pause(400);
                const backward = read();
                switchPair(1);
                await pause(60);
                switchPair(0);
                await pause(400);
                const interrupted = read();
                const track = document.querySelector('.multi-view-track');
                track.style.transition = 'none';
                switchPair(1);
                await pause(100);
                const immediate = read();
                track.style.removeProperty('transition');
                return { forward, backward, interrupted, immediate };
            } finally {
                context.clearRect = clearRect;
                context.createLinearGradient = createLinearGradient;
            }
        })()`);
        for (const [name, result] of Object.entries(results)) {
            assert.ok(result.gradients.length > 0, `${name}: connectors were drawn`);
            for (const gradient of result.gradients) {
                assert.ok(gradient.every((x, index) => Math.abs(x - result.expected[index]) < 1),
                    `${name}: connector edges must follow the settled panels: ${JSON.stringify(result)}`);
            }
        }
        console.log('Panel switch smoke passed: forward, backward, interrupted, and immediate connector alignment.');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

module.exports = { runPanelSwitchSmoke };
