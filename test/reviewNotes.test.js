const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
    buildChangeInventory,
    buildChangeTourManifest,
    parseChangeTourManifest,
    parseChangeTourSource
} = require('../out/changeTour.js');

const BASE_OID = '1'.repeat(40);
const HEAD_OID = '2'.repeat(40);

function sourceWithReview(review = validReview()) {
    return {
        version: 3,
        anchors: {
            changed: { file: 'value.txt', revision: 'head', contains: 'changed' }
        },
        connections: [],
        chapters: [{
            id: 'flow',
            title: 'Flow',
            scenes: [{
                id: 'walkthrough',
                title: 'Walkthrough',
                summary: 'Explain the change.',
                bullets: [],
                tags: ['change'],
                takeaway: 'The change is explicit.',
                steps: [{
                    id: 'changed-step',
                    title: 'Read the changed value',
                    body: 'The final value carries the new behavior.',
                    focus: 'changed'
                }]
            }]
        }],
        review
    };
}

function validReview(overrides = {}) {
    return {
        baseOid: BASE_OID,
        headOid: HEAD_OID,
        items: [{
            id: 'concept-1',
            kind: 'concept',
            title: 'Explicit value',
            body: 'The changed value is the behavior under review.',
            evidence: [{ sceneId: 'walkthrough', stepId: 'changed-step' }]
        }, {
            id: 'question-1',
            kind: 'question',
            title: 'What should we check next?',
            body: 'Confirm the value remains compatible with callers.',
            evidence: [],
            nextCheck: 'Inspect the caller contract.'
        }],
        ...overrides
    };
}

function makeManifest(review = validReview()) {
    const manifest = {
        version: 3,
        repository: { root: '/tmp/bygone-review-notes' },
        title: 'Review notes',
        generatedAt: '2026-09-19T00:00:00.000Z',
        range: {
            baseRef: 'main',
            headRef: 'feature/review',
            mergeBaseOid: BASE_OID,
            headOid: HEAD_OID
        },
        summary: {
            changedFiles: 1,
            includedScenes: 1,
            additions: 1,
            deletions: 0,
            commitCount: 1,
            omittedFiles: []
        },
        commits: [],
        files: [{
            kind: 'text-diff',
            id: 'file-1',
            title: 'value.txt',
            path: 'value.txt',
            changeKind: 'modified',
            leftLabel: 'value.txt @ base',
            rightLabel: 'value.txt @ head',
            leftContent: 'old\n',
            rightContent: 'changed\n',
            additions: 1,
            deletions: 1,
            summary: 'Changed value.',
            bullets: [],
            tags: [],
            takeaway: 'The value changed.'
        }],
        chapters: [{ id: 'flow', title: 'Flow', sceneIds: ['walkthrough'] }],
        scenes: [{
            kind: 'walkthrough',
            id: 'walkthrough',
            title: 'Walkthrough',
            summary: 'Explain the change.',
            bullets: [],
            tags: ['change'],
            takeaway: 'The change is explicit.',
            steps: [{
                id: 'changed-step',
                title: 'Read the changed value',
                body: 'The final value carries the new behavior.',
                focus: { id: 'changed', path: 'value.txt', revision: 'head', startLine: 1, endLine: 1, excerpt: 'changed' },
                diff: {
                    kind: 'text-diff',
                    id: 'walkthrough-changed-step',
                    title: 'value.txt',
                    path: 'value.txt',
                    changeKind: 'modified',
                    leftLabel: 'value.txt @ base',
                    rightLabel: 'value.txt @ head',
                    leftContent: 'old\n',
                    rightContent: 'changed\n',
                    additions: 1,
                    deletions: 1,
                    summary: 'Changed value.',
                    bullets: [],
                    tags: [],
                    takeaway: 'The value changed.'
                }
            }]
        }],
        ...(review === undefined ? {} : { review })
    };
    manifest.zoom = {
        authoredDepth: 'final',
        modes: ['final', 'history'],
        revisions: [],
        final: { chapters: manifest.chapters, scenes: manifest.scenes }
    };
    return manifest;
}

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function createReviewRepo() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-review-notes-')));
    git(root, 'init');
    git(root, 'config', 'user.email', 'review-notes@example.test');
    git(root, 'config', 'user.name', 'Review Notes Test');
    fs.writeFileSync(path.join(root, 'value.txt'), 'old\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    git(root, 'branch', '-M', 'main');
    const baseOid = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-b', 'feature/review');
    fs.writeFileSync(path.join(root, 'value.txt'), 'changed\n');
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'change');
    const headOid = git(root, 'rev-parse', 'HEAD');
    return { root, baseOid, headOid };
}

test('source review notes validate shape, evidence, and question follow-up', () => {
    const source = sourceWithReview({
        baseOid: BASE_OID,
        headOid: HEAD_OID,
        items: [{
            id: 'question',
            kind: 'question',
            title: 'Open question',
            body: 'The answer needs a follow-up check.',
            evidence: [],
            nextCheck: 'Read the caller.'
        }]
    });
    assert.equal(parseChangeTourSource(source).review.items[0].id, 'question');
    assert.throws(() => parseChangeTourSource({ ...source, version: 2 }), /Review notes require version 3/);
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [] } }),
        /review\.items must be a non-empty array/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, baseOid: 'short' } }),
        /review\.baseOid must be a full 40- or 64-character hexadecimal Git OID/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, extra: true } }),
        /review contains unknown field: extra/
    );
    assert.throws(
        () => parseChangeTourSource({
            ...source,
            review: {
                ...source.review,
                items: [{ ...source.review.items[0], extra: true }]
            }
        }),
        /review\.items\[0\] contains unknown field: extra/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [{ ...source.review.items[0], kind: ['question'] }] } }),
        /review\.items\[0\]\.kind must be concept, boundary, tradeoff, or question/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [{ ...source.review.items[0], nextCheck: '' }] } }),
        /nextCheck must be a non-empty string/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [{ ...source.review.items[0], nextCheck: '   ' }] } }),
        /nextCheck must be a non-empty string/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [{ ...source.review.items[0], title: ' \t' }] } }),
        /title must be a non-empty string/
    );
    assert.throws(
        () => parseChangeTourSource({ ...source, review: { ...source.review, items: [{ ...source.review.items[0], evidence: [{ sceneId: 'missing', stepId: 'step' }] }] } }),
        /unknown authored walkthrough scene/
    );
    assert.throws(
        () => parseChangeTourSource({
            ...source,
            review: {
                ...source.review,
                items: [{ id: 'claim', kind: 'boundary', title: 'Boundary', body: 'Needs evidence.', evidence: [] }]
            }
        }),
        /evidence must contain at least one reference for claims/
    );
});

test('compiler pins review notes to the resolved range and preserves evidence', () => {
    const repo = createReviewRepo();
    try {
        const source = sourceWithReview({
            baseOid: repo.baseOid,
            headOid: repo.headOid,
            items: [{
                id: 'claim',
                kind: 'concept',
                title: 'Changed value',
                body: 'The changed value is grounded in the walkthrough.',
                evidence: [{ sceneId: 'walkthrough', stepId: 'changed-step' }]
            }]
        });
        const manifest = buildChangeTourManifest(repo.root, { source, baseRef: 'main', headRef: 'feature/review' });
        assert.deepEqual(manifest.review, source.review);
        assert.equal(manifest.review, source.review);
        assert.deepEqual(parseChangeTourManifest(JSON.parse(JSON.stringify(manifest))).review, source.review);

        const stale = sourceWithReview({
            ...source.review,
            baseOid: 'f'.repeat(40)
        });
        assert.throws(
            () => buildChangeTourManifest(repo.root, { source: stale, baseRef: 'main', headRef: 'feature/review' }),
            /Stale review: review\.baseOid/
        );

        fs.writeFileSync(path.join(repo.root, 'unrelated.txt'), 'The anchored value is unchanged.\n');
        git(repo.root, 'add', 'unrelated.txt');
        git(repo.root, 'commit', '-m', 'advance review range');
        assert.notEqual(git(repo.root, 'rev-parse', 'HEAD'), repo.headOid);
        const staleHead = sourceWithReview({
            ...source.review,
            headOid: repo.headOid
        });
        assert.throws(
            () => buildChangeTourManifest(repo.root, { source: staleHead, baseRef: 'main', headRef: 'feature/review' }),
            /Stale review: review\.headOid/
        );
    } finally {
        fs.rmSync(repo.root, { recursive: true, force: true });
    }
});

test('manifest review validation rejects dangling evidence and allows absent review', () => {
    assert.equal(parseChangeTourManifest(makeManifest()).review.items.length, 2);
    assert.throws(() => parseChangeTourManifest({ ...makeManifest(), version: 2 }), /Review notes require manifest version 3/);
    const withoutReview = makeManifest();
    delete withoutReview.review;
    assert.equal(parseChangeTourManifest(withoutReview).review, undefined);
    assert.throws(
        () => parseChangeTourManifest(makeManifest({
            ...validReview(),
            items: [{
                ...validReview().items[0],
                evidence: [{ sceneId: 'walkthrough', stepId: 'missing-step' }]
            }]
        })),
        /unknown authored walkthrough step walkthrough\/missing-step/
    );
    assert.throws(
        () => parseChangeTourManifest(makeManifest({ ...validReview(), headOid: '3'.repeat(40) })),
        /Stale review: review\.headOid/
    );
});

test('v3 reviews resolve evidence against explicit deconstructed final steps', () => {
    const repo = createReviewRepo();
    try {
        const inventory = buildChangeInventory(repo.root, { baseRef: 'main', headRef: 'feature/review' });
        const hunkId = inventory.files.find((file) => file.path === 'value.txt').units[0].id;
        const source = {
            version: 3,
            range: { base: 'main', head: 'feature/review' },
            anchors: {
                changed: { file: 'value.txt', revision: 'head', contains: 'changed' }
            },
            connections: [],
            chapters: [{
                id: 'explanation',
                title: 'Explanation',
                scenes: [{
                    id: 'explain-value',
                    kind: 'deconstructed-diff',
                    title: 'Explain the value',
                    summary: 'Explain the changed value.',
                    bullets: [],
                    tags: ['explanation'],
                    takeaway: 'The final step names the endpoint evidence.',
                    stack: [
                        { id: 'base', ref: 'main' },
                        { id: 'head', ref: 'feature/review' }
                    ],
                    steps: [{
                        id: 'final-value',
                        title: 'Read the final value',
                        body: 'The endpoint walkthrough keeps the final evidence navigable.',
                        focus: 'changed'
                    }],
                    stages: [{
                        id: 'value-stage',
                        title: 'Introduce the value',
                        narration: 'The value changes in the final revision.',
                        changes: [{ file: 'value.txt', hunks: [hunkId] }]
                    }]
                }]
            }],
            review: {
                baseOid: repo.baseOid,
                headOid: repo.headOid,
                items: [{
                    id: 'endpoint',
                    kind: 'boundary',
                    title: 'Endpoint evidence',
                    body: 'The note points to the explicit final walkthrough step.',
                    evidence: [{ sceneId: 'explain-value', stepId: 'final-value' }]
                }]
            }
        };
        const parsed = parseChangeTourSource(source);
        const manifest = buildChangeTourManifest(repo.root, { source: parsed });
        assert.equal(manifest.version, 3);
        assert.equal(manifest.zoom.final.scenes[0].kind, 'walkthrough');
        assert.equal(manifest.zoom.final.scenes[0].steps[0].id, 'final-value');
        assert.deepEqual(manifest.review, source.review);
        assert.deepEqual(parseChangeTourManifest(JSON.parse(JSON.stringify(manifest))).review, source.review);

        assert.throws(
            () => parseChangeTourManifest({
                ...manifest,
                review: {
                    ...manifest.review,
                    items: [{ ...manifest.review.items[0], evidence: [{ sceneId: 'explain-value', stepId: 'missing' }] }]
                }
            }),
            /unknown authored walkthrough step explain-value\/missing/
        );
        assert.throws(
            () => parseChangeTourManifest({
                ...manifest,
                review: { ...manifest.review, headOid: '3'.repeat(40) }
            }),
            /Stale review: review\.headOid/
        );
    } finally {
        fs.rmSync(repo.root, { recursive: true, force: true });
    }
});
