import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeFocusedStripLayout } = require('../media/focusedStripController.js');
const iterations = 250_000;
let checksum = 0;

for (let index = 0; index < 10_000; index += 1) runLayout(index);

const startedAt = performance.now();
for (let index = 0; index < iterations; index += 1) runLayout(index);
const elapsed = performance.now() - startedAt;
const operationsPerSecond = Math.round(iterations / (elapsed / 1000));

console.log(`Focused strip: ${iterations.toLocaleString()} layouts in ${elapsed.toFixed(1)}ms (${operationsPerSecond.toLocaleString()} ops/s)`);
console.log(`Checksum: ${checksum.toFixed(1)}`);

if (elapsed > 1000) {
    throw new Error(`Focused-strip layout exceeded its 1000ms budget: ${elapsed.toFixed(1)}ms`);
}

function runLayout(index) {
    const panelCount = 2 + (index % 9_999);
    const layout = computeFocusedStripLayout({
        panelCount,
        activePanelIndex: index % panelCount,
        activePairIndex: index % (panelCount - 1),
        viewportWidth: index % 2 === 0 ? 1440 : 640,
        minimumPaneWidth: 360,
        gutterWidth: 96
    });
    checksum = (checksum + layout.offset + layout.paneWidth) % 1_000_000_007;
}
