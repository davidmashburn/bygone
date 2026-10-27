const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    buildTourReadingItems,
    getTourReadingTarget,
    isImageOnlyTour,
    resolveTourReadingItem
} = require('../out/tourReading.js');

function mediaSessionHarness({ available = true, rejectPlay = false } = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../web/narrationMediaSession.js'), 'utf8');
    const actions = new Map();
    const calls = [];
    const audio = [];
    const revoked = [];
    const session = { setActionHandler: (name, handler) => {
        if (name === 'stop') throw new Error('Unsupported action');
        actions.set(name, handler);
    } };
    class Audio {
        constructor(src) { this.src = src; this.paused = true; audio.push(this); }
        addEventListener(_event, listener) { this.onPause = listener; }
        play() { this.paused = false; return rejectPlay ? Promise.reject(new Error('Autoplay denied')) : Promise.resolve(); }
        pause() { this.paused = true; }
        removeAttribute() { this.src = null; }
        load() {}
    }
    const create = new Function('navigator', 'Audio', 'MediaMetadata', 'URL', 'Blob',
        `${source.replace('export function', 'function')}\nreturn createNarrationMediaSession;`
    )({ mediaSession: available ? session : undefined }, Audio, class { constructor(data) { Object.assign(this, data); } }, {
        createObjectURL: () => `blob:${audio.length}`,
        revokeObjectURL: url => revoked.push(url)
    }, Blob);
    const bridge = create({ play: () => calls.push('play'), pause: () => calls.push('pause'),
        stop: () => calls.push('stop'), skip: direction => calls.push(direction) });
    const update = kind => bridge.update({ kind }, 'Test tour', { previous: false, next: true });
    return { bridge, update, session, calls, actions, audio, revoked };
}

test('media controls are optional and tolerate unsupported actions', () => {
    const absent = mediaSessionHarness({ available: false });
    absent.update('playing');
    absent.bridge.dispose();
    assert.equal(absent.audio.length, 0);
    const f = mediaSessionHarness();
    f.update('idle');
    assert.equal(f.audio.length, 0, 'Opening a tour never acquires audio focus');
    f.update('playing');
    assert.equal(f.session.playbackState, 'playing');
    assert.equal(f.session.metadata.title, 'Test tour');
    assert.equal(f.actions.get('previoustrack'), null, 'Unavailable previous action is disabled');
    f.actions.get('nexttrack')();
    assert.deepEqual(f.calls, [1]);
    f.update('paused');
    assert.equal(f.audio[0].paused, true);
    f.update('playing');
    assert.equal(f.audio.length, 1, 'Resume reuses the session');
    f.update('error');
    assert.equal(f.session.playbackState, 'none');
    assert.equal(f.session.metadata, null);
    assert.equal(f.audio[0].src, null);
    assert.deepEqual(f.revoked, ['blob:0']);
    f.bridge.dispose();
    assert.equal(f.revoked.length, 1, 'Cleanup is idempotent');
});

test('blocked media playback releases handlers without stopping device speech', async () => {
    const f = mediaSessionHarness({ rejectPlay: true });
    f.update('playing');
    await Promise.resolve();
    assert.equal(f.session.playbackState, 'none');
    assert.deepEqual(f.calls, []);
    assert.equal(f.actions.get('play'), null);
    assert.equal(f.audio[0].src, null);
});

test('late audio pause events cannot interrupt a replacement narration session', () => {
    const f = mediaSessionHarness();
    f.update('playing');
    const oldAudio = f.audio[0];
    f.update('idle');
    f.update('playing');
    oldAudio.onPause({ currentTarget: oldAudio });
    assert.deepEqual(f.calls, []);
    f.update('paused');
    f.update('playing');
    f.audio[1].onPause({ currentTarget: f.audio[1] });
    assert.deepEqual(f.calls, [], 'An already-resumed player ignores its queued pause event');
    f.audio[1].paused = true;
    f.audio[1].onPause({ currentTarget: f.audio[1] });
    assert.deepEqual(f.calls, ['pause'], 'A real audio-focus interruption pauses narration');
});

test('image-only guides skip structural stops in both directions without changing code tours', () => {
    const tour = {
        chapters: [{ id: 'one', summary: 'Preview one.', sceneIds: ['a'] }, { id: 'two', summary: 'Preview two.', sceneIds: ['b'] }],
        scenes: [scene('a', 'walkthrough', [{ id: 'a1', image: {} }, { id: 'a2', image: {} }]),
            scene('b', 'walkthrough', [{ id: 'b1', image: {} }])]
    };
    assert.equal(isImageOnlyTour(tour), true);
    const items = buildTourReadingItems(tour);
    assert.equal(getTourReadingTarget(items, 'title', 1, true).key, 'step:a:a1');
    assert.equal(getTourReadingTarget(items, 'step:a:a2', 1, true).key, 'step:b:b1');
    assert.equal(getTourReadingTarget(items, 'step:b:b1', -1, true).key, 'step:a:a2');
    assert.equal(getTourReadingTarget(items, 'step:a:a1', -1, true).key, 'title');
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
            { id: 'later', title: 'Later', summary: 'Preview Later.', sceneIds: ['second'] },
            { id: 'earlier', title: 'Earlier', summary: 'Preview Earlier.', sceneIds: ['first', 'third'] }
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
        { kind: 'scene', key: 'scene:second', chapterId: 'later', sceneIndex: 0, stepIndex: 0 },
        { kind: 'chapter', key: 'chapter:earlier', chapterId: 'earlier', sceneIndex: 1, stepIndex: 0 },
        { kind: 'scene', key: 'scene:first', chapterId: 'earlier', sceneIndex: 1, stepIndex: 0 },
        { kind: 'step', key: 'step:first:step-a', sceneIndex: 1, stepIndex: 0 },
        { kind: 'step', key: 'step:first:step-b', sceneIndex: 1, stepIndex: 1 },
        { kind: 'scene', key: 'scene:third', chapterId: 'earlier', sceneIndex: 2, stepIndex: 0 }
    ]);
});

test('keeps every scene, including non-stepped and zero-step scenes, and skips a chapter without preview prose', () => {
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
            { id: 'one', title: 'One', summary: 'Preview One.', sceneIds: ['a'] },
            { id: 'two', title: 'Two', summary: 'Preview Two.', sceneIds: ['b'] }
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


test('only authored previews create stops, including single-chapter tours', () => {
    const tour = {
        chapters: [
            { id: 'preview', summary: 'Trace the request.', sceneIds: ['a', 'c'] },
            { id: 'heading', sceneIds: ['b'] },
            { id: 'blank', summary: '  ', sceneIds: ['d'] }
        ],
        scenes: ['a', 'b', 'c', 'd', 'unassigned'].map(id => scene(id, 'discussion'))
    };
    const items = buildTourReadingItems(tour);
    assert.deepEqual(items.map(item => item.key), [
        'title', 'chapter:preview', 'scene:a', 'scene:b', 'scene:c', 'scene:d', 'scene:unassigned'
    ]);
    assert.equal(getTourReadingTarget(items, 'scene:a', 1).key, 'scene:b');
    assert.equal(getTourReadingTarget(items, 'scene:c', -1).key, 'scene:b');
    assert.equal(resolveTourReadingItem(items, 1, 0, 'chapter').key, 'scene:b', 'A skipped chapter cannot land on a previous preview');
    assert.equal(resolveTourReadingItem(items, 2, 0, 'chapter').key, 'chapter:preview');
    assert.equal(resolveTourReadingItem(items, 3, 0, 'chapter').key, 'scene:d');
    assert.equal(resolveTourReadingItem(items, 4, 0, 'chapter').key, 'scene:unassigned');
    const single = buildTourReadingItems({ chapters: [tour.chapters[0]], scenes: [tour.scenes[0]] });
    assert.equal(getTourReadingTarget(single, 'title', 1).key, 'chapter:preview');
    assert.equal(getTourReadingTarget(single, 'scene:a', -1).key, 'chapter:preview');
});
