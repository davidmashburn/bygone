const assert = require('node:assert/strict');
const { TourZoomSession } = require('../out/tourZoomSession.js');

const defaultLocation = { sceneIndex: 0, stepIndex: 0, path: null };
const historyLocation = {
    sceneIndex: 2,
    stepIndex: 4,
    path: 'a.ts',
    navigation: { scrollTop: 80 },
    focusId: 'tour-next',
    narrativeScroll: 120,
    view: 'step',
    narrativeParent: null,
    sceneIntroVisible: false
};
const compareLocation = {
    sceneIndex: 1,
    stepIndex: 0,
    path: 'b.ts',
    line: 18,
    commit: 'abc123'
};

const session = new TourZoomSession('history');

// Entering a mode for the first time always starts at the neutral cursor.
assert.deepEqual(session.enter('history'), {
    location: defaultLocation,
    restore: false
});

// Each mode owns its cursor, and navigating between modes never infers a landing.
session.depart(historyLocation);
assert.deepEqual(session.enter('compare'), { location: defaultLocation, restore: false });
session.depart(compareLocation);
assert.deepEqual(session.enter('history'), { location: historyLocation, restore: true });
assert.deepEqual(session.enter('compare'), { location: compareLocation, restore: true });

// Saving again always replaces the active mode's cursor exactly.
const updatedHistoryLocation = { ...historyLocation, sceneIndex: 3, view: 'scene' };
session.enter('history');
assert.equal(session.depart(updatedHistoryLocation), updatedHistoryLocation);
assert.deepEqual(session.enter('history'), { location: updatedHistoryLocation, restore: true });

console.log('Tour zoom session tests passed.');
