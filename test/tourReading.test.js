const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    buildTourReadingItems,
    getTourReadingTarget,
    isImageOnlyTour,
    resolveTourReadingItem
} = require('../out/tourReading.js');

test('image-only guides skip structural stops in both directions without changing code tours', () => {
    const tour = {
        chapters: [{ id: 'one', sceneIds: ['a'] }, { id: 'two', sceneIds: ['b'] }],
        scenes: [scene('a', 'walkthrough', [{ id: 'a1', image: {} }, { id: 'a2', image: {} }]),
            scene('b', 'walkthrough', [{ id: 'b1', image: {} }])]
    };
    assert.equal(isImageOnlyTour(tour), true);
    const items = buildTourReadingItems(tour);
    assert.equal(getTourReadingTarget(items, 'title', 1, true).key, 'step:a:a1');
    assert.equal(getTourReadingTarget(items, 'step:a:a2', 1, true).key, 'step:b:b1');
    assert.equal(getTourReadingTarget(items, 'step:b:b1', -1, true).key, 'step:a:a2');
    assert.equal(getTourReadingTarget(items, 'step:a:a1', -1, true), null);
    assert.equal(getTourReadingTarget(items, 'step:b:b1', 1, true), null);
    assert.equal(getTourReadingTarget(items, 'step:a:a2', 1).kind, 'chapter');
    delete tour.scenes[1].steps[0].image;
    assert.equal(isImageOnlyTour(tour), false);
    assert.equal(isImageOnlyTour({ scenes: [] }), false);
    assert.equal(isImageOnlyTour({ scenes: [scene('empty', 'walkthrough', [])] }), false);
});

function scene(id, kind, steps = undefined) {
    return steps === undefined ? { id, kind } : { id, kind, steps };
}

test('builds a continuous order without reordering scenes by chapter', () => {
    const items = buildTourReadingItems({
        chapters: [
            { id: 'later', title: 'Later', sceneIds: ['second'] },
            { id: 'earlier', title: 'Earlier', sceneIds: ['first', 'third'] }
        ],
        scenes: [
            scene('second', 'discussion'),
            scene('first', 'walkthrough', [{ id: 'step-a' }, { id: 'step-b' }]),
            scene('third', 'text-diff')
        ]
    });

    assert.deepEqual(items, [
        { kind: 'title', key: 'title', sceneIndex: 0, stepIndex: 0 },
        { kind: 'chapter', key: 'chapter:later', chapterId: 'later', sceneIndex: 0, stepIndex: 0 },
        { kind: 'scene', key: 'scene:second', sceneIndex: 0, stepIndex: 0 },
        { kind: 'chapter', key: 'chapter:earlier', chapterId: 'earlier', sceneIndex: 1, stepIndex: 0 },
        { kind: 'scene', key: 'scene:first', sceneIndex: 1, stepIndex: 0 },
        { kind: 'step', key: 'step:first:step-a', sceneIndex: 1, stepIndex: 0 },
        { kind: 'step', key: 'step:first:step-b', sceneIndex: 1, stepIndex: 1 },
        { kind: 'scene', key: 'scene:third', sceneIndex: 2, stepIndex: 0 }
    ]);
});

test('keeps every scene, including non-stepped and zero-step scenes, and suppresses one chapter', () => {
    const items = buildTourReadingItems({
        chapters: [{ id: 'only', title: 'Only chapter', sceneIds: ['discussion', 'empty', 'file'] }],
        scenes: [
            scene('discussion', 'discussion'),
            scene('empty', 'walkthrough', []),
            scene('file', 'text-diff')
        ]
    });

    assert.deepEqual(items.map((item) => item.key), [
        'title', 'scene:discussion', 'scene:empty', 'scene:file'
    ]);
    assert.equal(items.filter((item) => item.kind === 'chapter').length, 0);
});

test('moves through adjacent reading items and stops at the ends', () => {
    const items = [
        { kind: 'title', key: 'title', sceneIndex: 0, stepIndex: 0 },
        { kind: 'scene', key: 'scene:a', sceneIndex: 0, stepIndex: 0 }
    ];

    assert.equal(getTourReadingTarget(items, 'missing', 1), null);
    assert.equal(getTourReadingTarget(items, 'title', -1), null);
    assert.deepEqual(getTourReadingTarget(items, 'title', 1), items[1]);
    assert.deepEqual(getTourReadingTarget(items, 'scene:a', -1), items[0]);
    assert.equal(getTourReadingTarget(items, 'scene:a', 1), null);
});

test('resolves title, chapter, overview, and step positions', () => {
    const items = buildTourReadingItems({
        chapters: [
            { id: 'one', title: 'One', sceneIds: ['a'] },
            { id: 'two', title: 'Two', sceneIds: ['b'] }
        ],
        scenes: [
            scene('a', 'walkthrough', [{ id: 'a1' }, { id: 'a2' }]),
            scene('b', 'discussion')
        ]
    });

    assert.equal(resolveTourReadingItem(items, 1, 0, 'tour')?.key, 'title');
    assert.equal(resolveTourReadingItem(items, 1, 0, 'chapter')?.key, 'chapter:two');
    assert.equal(resolveTourReadingItem(items, 1, 0, 'overview')?.key, 'scene:b');
    assert.equal(resolveTourReadingItem(items, 0, 1)?.key, 'step:a:a2');
    assert.equal(resolveTourReadingItem(items, 1, 0)?.key, 'scene:b');
    assert.equal(resolveTourReadingItem(items, 99, 0), null);
});
