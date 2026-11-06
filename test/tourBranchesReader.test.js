const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TourReaderAction: Action, resolveTourReaderKey } = require('../out/tourReaderKeyboard');
const { TourNarrationController } = require('../out/tourNarrationPlayback');
const { getTourBranchContinueTarget } = require('../out/tourReading');
const { tourReadingTitle } = require('../out/tourOrientation');
const { buildChangeTourManifest } = require('../out/changeTour');
const { optionalBranchesFixture } = require('./optionalBranchesFixture');

const context = { readerActive: true, navigationFocused: true, nativeKeyOwner: false,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, isComposing: false };
test('reader keys separate path movement, detail and sentence selection without taking native keys', () => {
    const bindings = { ArrowUp: Action.PreviousStep, ArrowDown: Action.NextStep,
        ArrowRight: Action.EnterDetail, Enter: Action.EnterDetail, ArrowLeft: Action.ReturnToParent, Escape: Action.ReturnToParent };
    for (const [key, action] of Object.entries(bindings)) {
        assert.equal(resolveTourReaderKey({ ...context, key }), action);
        assert.equal(resolveTourReaderKey({ ...context, key, navigationFocused: false }), null);
    }
    for (const navigationFocused of [false, true]) {
        assert.equal(resolveTourReaderKey({ ...context, navigationFocused, key: 'ArrowUp', shiftKey: true }), Action.PreviousSentence);
        assert.equal(resolveTourReaderKey({ ...context, navigationFocused, key: 'ArrowDown', shiftKey: true }), Action.NextSentence);
    }
    for (const blocked of ['nativeKeyOwner', 'ctrlKey', 'altKey', 'metaKey', 'defaultPrevented', 'isComposing']) {
        for (const shiftKey of [false, true]) assert.equal(resolveTourReaderKey({ ...context, key: 'ArrowDown', shiftKey, [blocked]: true }), null);
    }
    assert.equal(resolveTourReaderKey({ ...context, key: 'ArrowDown', shiftKey: true, readerActive: false }), null);
    assert.equal(resolveTourReaderKey({ ...context, key: 'ArrowRight', shiftKey: true }), null);
});

test('silent sentence selection crosses path units and starts speech only at the selected sentence', () => {
    const units = ['first', 'second'].map(id => ({ id, readingKey: id, segments: [0, 1].map(n => ({ id: `${id}-${n}`, speechText: `${id} ${n}.` })) }));
    const spoken = [], highlights = [];
    let claims = 0;
    const adjacent = (unit, direction) => units[units.indexOf(unit) + direction] || null;
    const controller = new TourNarrationController({ speak(segment, callbacks) { spoken.push({ segment, callbacks }); }, cancel() {}, pause() {}, resume() {} }, {
        claimAudio() { claims++; }, onStateChange() {}, onSegmentChange(segment) { highlights.push(segment); },
        canNavigateUnit: (unit, direction) => !!adjacent(unit, direction), navigateUnit: adjacent
    });
    controller.select(units[0]);
    assert.equal(controller.engaged, false);
    assert.equal(controller.skipSegment(-1), false);
    controller.skipSegment(1);
    controller.skipSegment(1);
    assert.equal(controller.position.unit, units[1]);
    assert.equal(controller.position.segmentIndex, 0);
    controller.skipSegment(-1);
    assert.equal(controller.position.unit, units[0]);
    assert.equal(controller.position.segmentIndex, 1);
    assert.equal(highlights.at(-1), units[0].segments[1]);
    assert.equal(spoken.length, 0);
    assert.equal(claims, 0);
    controller.start(controller.position.unit, true, controller.position.segmentIndex);
    assert.equal(spoken.at(-1).segment, units[0].segments[1]);
    assert.equal(claims, 1);
    const stale = spoken.at(-1).callbacks;
    controller.select(units[1], 1);
    stale.onEnd(); stale.onError('stale');
    assert.equal(controller.state.kind, 'selected');
    assert.equal(controller.position.segmentIndex, 1);
    assert.equal(controller.skipSegment(1), false, 'End of the selected path is a hard boundary');
    controller.select(units[0], 1, true);
    assert.equal(controller.state.kind, 'paused');
    assert.equal(spoken.length, 1, 'Restoring a parent position never starts speech');
    controller.skipSegment(1);
    assert.equal(controller.state.kind, 'paused');
    controller.togglePause();
    assert.equal(spoken.at(-1).segment, units[1].segments[0]);
});

test('Continue advances on the immediate parent path, with no implicit ancestor exit', () => {
    const fixture = optionalBranchesFixture();
    try {
        const tour = buildChangeTourManifest(fixture.root, { source: fixture.source });
        assert.equal(getTourBranchContinueTarget(tour, { sceneIndex: 0, branchId: 'evidence' }).key, 'step:scene:qualification');
        assert.equal(getTourBranchContinueTarget(tour, { sceneIndex: 0, branchId: 'why' }).key, 'step:scene:boundary');
        tour.scenes[0].steps = tour.scenes[0].steps.filter(step => step.id !== 'qualification');
        assert.equal(getTourBranchContinueTarget(tour, { sceneIndex: 0, branchId: 'evidence' }), null);
        assert.equal(tourReadingTitle(tour, { kind: 'title', key: 'title' }), fixture.source.opening.title);
        assert.equal(tourReadingTitle(tour, { kind: 'conclusion', key: 'conclusion' }), fixture.source.conclusion.title);
    } finally { fixture.dispose(); }
});
