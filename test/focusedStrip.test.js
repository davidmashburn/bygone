const assert = require('node:assert/strict');
const test = require('node:test');
const { computeFocusedStripLayout: layout, readVisiblePanelPreference: read, writeVisiblePanelPreference: write } = require('../media/focusedStripController');

const base = { panelCount: 7, activePanelIndex: 3, activePairIndex: 2, viewportWidth: 1600 };

test('density boundaries retain readable panes and use the correct gutters', () => {
    for (const [request, width, count, gutter] of [
        [2, 815, 1, 0], [2, 816, 2, 96], [2, 3000, 2, 96],
        [3, 935, 2, 96], [3, 936, 3, 48], [3, 3000, 3, 48],
        [4, 1263, 3, 48], [4, 1264, 4, 48], [4, 655, 1, 0],
        ['fit', 815, 1, 0], ['fit', 816, 2, 96], ['fit', 1175, 2, 96],
        ['fit', 1176, 3, 48], ['fit', 1583, 3, 48], ['fit', 1584, 4, 48],
        ['fit', 1991, 4, 48], ['fit', 1992, 5, 48], ['fit', 2399, 5, 48],
        ['fit', 2400, 6, 48], ['fit', 2808, 7, 48], ['fit', 4000, 7, 48]
    ]) {
        const result = layout({ ...base, requestedVisibleCount: request, viewportWidth: width });
        assert.equal(result.effectiveCount, count, `${request} at ${width}px`);
        assert.equal(result.gutterWidth, gutter);
        assert.ok(Math.abs(result.paneWidth * count + gutter * (count - 1) - width) < 0.001);
        assert.equal(result.limitedByWidth, count < (request === 'fit' ? base.panelCount : request));
    }
});

test('visible comparisons stay stationary and offscreen comparisons move the minimum distance', () => {
    const initial = layout({ ...base, requestedVisibleCount: 4 });
    assert.deepEqual(initial.visiblePanelIndexes, [1, 2, 3, 4]);
    assert.deepEqual(initial.visiblePairIndexes, [1, 2, 3]);
    for (const pair of [1, 2, 3]) {
        const next = layout({ ...base, requestedVisibleCount: 4, previousVisibleStart: 1, activePairIndex: pair });
        assert.equal(next.visibleStart, 1);
        assert.equal(next.offset, initial.offset);
    }
    assert.equal(layout({ ...base, requestedVisibleCount: 4, previousVisibleStart: 1, activePairIndex: 4 }).visibleStart, 2);
    assert.equal(layout({ ...base, requestedVisibleCount: 4, previousVisibleStart: 1, activePairIndex: 0 }).visibleStart, 0);
    const last = layout({ ...base, requestedVisibleCount: 4, previousVisibleStart: 1, activePairIndex: 5 });
    assert.deepEqual(last.visiblePanelIndexes, [3, 4, 5, 6]);
    assert.equal(last.offset, last.trackWidth - base.viewportWidth);
});

test('resizing and shorter scenes keep the requested density independently of effective count', () => {
    const request = { ...base, requestedVisibleCount: 4, previousVisibleStart: 1 };
    const narrow = layout({ ...request, viewportWidth: 1000 });
    assert.deepEqual(narrow.visiblePanelIndexes, [1, 2, 3]);
    const restored = layout({ ...request, previousVisibleStart: narrow.visibleStart });
    assert.deepEqual(restored.visiblePanelIndexes, [1, 2, 3, 4]);
    for (const count of [1, 2, 3]) {
        const short = layout({ ...request, panelCount: count });
        assert.equal(short.effectiveCount, count);
        assert.equal(short.limitedByWidth, false);
        assert.equal(short.visibleStart, 0);
        assert.equal(short.offset, 0);
    }
    const single = layout({ ...request, viewportWidth: 500 });
    assert.deepEqual(single.visiblePanelIndexes, [3]);
    assert.deepEqual(single.visiblePairIndexes, []);
});

test('all group sizes clamp safely at both ends after membership changes', () => {
    for (let count = 1; count <= 9; count++) {
        for (const requested of [2, 3, 4, 'fit']) {
            for (let pair = 0; pair < Math.max(1, count - 1); pair++) {
                for (const previous of [-1, 0, 4, 9]) {
                    const result = layout({ ...base, panelCount: count, viewportWidth: 4000, activePanelIndex: pair, activePairIndex: pair,
                        requestedVisibleCount: requested, previousVisibleStart: previous });
                    assert.ok(result.visiblePanelIndexes.every(index => index >= 0 && index < count));
                    assert.ok(result.visiblePanelIndexes.includes(pair));
                    if (count > 1) assert.ok(result.visiblePairIndexes.includes(pair));
                    assert.ok(result.offset >= 0 && result.offset <= result.trackWidth - 4000 + 0.001);
                }
            }
        }
    }
});

test('optional host storage defaults safely and persists only supported choices', () => {
    let value = null;
    const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
    assert.equal(read(storage), 2);
    for (const request of [2, 3, 4, 'fit']) { write(storage, request); assert.equal(read(storage), request); }
    for (value of ['', '1', '5', 'nope']) assert.equal(read(storage), 2);
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
    assert.equal(read(blocked), 2);
    assert.doesNotThrow(() => write(blocked, 4));
    assert.equal(read(null), 2);
});
