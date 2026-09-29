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
    readingKey: 'step:scene-three:step-five',
    navigatorTab: 'commits',
    view: 'step',
    narrativeParent: null,
    sceneIntroVisible: false
};
const compareLocation = {
    sceneIndex: 1,
    stepIndex: 0,
    path: 'b.ts',
    line: 18,
    navigatorTab: 'files',
    commit: 'abc123'
};

const session = new TourZoomSession('history');

// A first visit can keep relevant context from the mode being left.
const historySeed = { sceneIndex: 8, stepIndex: 2, path: 'mapped.ts', commit: 'seed123' };
assert.deepEqual(session.enter('history', historySeed), {
    location: historySeed,
    restore: false
});

// Each mode owns its cursor after the first visit.
session.depart(historyLocation);
session.navigate();
assert.deepEqual(session.enter('compare'), { location: defaultLocation, restore: false });
session.navigate();
session.depart(compareLocation);
assert.deepEqual(session.enter('history', historySeed), { location: historyLocation, restore: true });
assert.deepEqual(session.enter('compare'), { location: compareLocation, restore: true });

// Saving again always replaces the active mode's cursor exactly.
const updatedHistoryLocation = { ...historyLocation, sceneIndex: 3, view: 'scene' };
session.enter('history');
assert.equal(session.depart(updatedHistoryLocation), updatedHistoryLocation);
assert.deepEqual(session.enter('history'), { location: updatedHistoryLocation, restore: true });

console.log('Tour zoom session tests passed.');
