const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { build } = require('esbuild');

const repositoryRoot = path.resolve(__dirname, '..');
let temporaryDirectory;
let buildOutput;
let buildTourDirectoryEvidence;

test.before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bygone-tour-directory-evidence-'));
    buildOutput = path.join(temporaryDirectory, 'tourDirectoryEvidence.cjs');
    await build({
        entryPoints: [path.join(repositoryRoot, 'src/tourDirectoryEvidence.ts')],
        outfile: buildOutput,
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        target: 'es2020',
        logLevel: 'silent'
    });
    ({ buildTourDirectoryEvidence } = require(buildOutput));
});

test.after(() => {
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function panel(id, label, content, exists = true, filePath) {
    return {
        id,
        label,
        ...(filePath ? { path: filePath } : {}),
        content,
        exists
    };
}

function stackScene(files, steps, overviewPath, comparison) {
    return {
        id: 'stacked-directory',
        kind: 'stacked-diff',
        title: 'Stacked directory',
        summary: '',
        bullets: [],
        tags: [],
        takeaway: '',
        overview: {
            kind: 'directory-diff',
            ...(overviewPath ? { path: overviewPath } : {}),
            ...(comparison ? { comparison } : {})
        },
        stack: [
            { id: 'base', ref: 'base', oid: 'base-oid', label: 'base' },
            { id: 'step', ref: 'step', oid: 'step-oid', label: 'step' },
            { id: 'head', ref: 'head', oid: 'head-oid', label: 'head' }
        ],
        files,
        steps
    };
}

function textFile(pathname, changeKind = 'modified', leftContent = 'old', rightContent = 'new', previousPath) {
    return {
        id: `file-${pathname}`,
        kind: 'text-diff',
        title: pathname,
        summary: '',
        bullets: [],
        tags: [],
        takeaway: '',
        path: pathname,
        ...(previousPath ? { previousPath } : {}),
        changeKind,
        leftLabel: 'base',
        rightLabel: 'head',
        leftContent,
        rightContent,
        additions: 1,
        deletions: 1
    };
}

test('defaults to the full authored panel span and ignores saved step pairs', () => {
    const scene = stackScene([
        {
            path: 'selected.ts',
            panels: [
                panel('base-selected', 'base / selected.ts', 'BASE'),
                panel('step-selected', 'step / selected.ts', 'STEP'),
                panel('head-selected', 'head / selected.ts', 'HEAD')
            ]
        },
        {
            path: 'future.ts',
            panels: [
                panel('base-future', 'base / future.ts', 'SAME'),
                panel('step-future', 'step / future.ts', 'SAME'),
                panel('head-future', 'head / future.ts', 'FUTURE')
            ]
        }
    ], [{ id: 'step-1', title: 'First pair', body: '', file: 'selected.ts', pairIndex: 1, side: 'right' }]);
    scene.kind = 'deconstructed-diff';
    scene.panels = scene.stack.map((entry, index) => ({
        id: entry.id,
        label: entry.label,
        role: index === 0 ? 'baseline' : 'stage'
    }));
    delete scene.stack;
    scene.realRange = { baseRef: 'base', targetRef: 'head', baseOid: 'base-oid', targetOid: 'head-oid' };

    const evidence = buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'base-oid', headOid: 'head-oid' },
        files: [textFile('selected.ts', 'modified', 'BASE', 'HEAD')]
    }, scene);

    assert.deepEqual(evidence.labels, ['base', 'head']);
    assert.deepEqual(evidence.files.map((file) => file.path), ['selected.ts', 'future.ts']);
    const selected = evidence.files.find((file) => file.path === 'selected.ts');
    assert.equal(selected.leftContent, 'BASE');
    assert.equal(selected.rightContent, 'HEAD');
    const future = evidence.files.find((file) => file.path === 'future.ts');
    assert.equal(future.leftContent, 'SAME');
    assert.equal(future.rightContent, 'FUTURE');
    assert.equal(evidence.entries.find((entry) => entry.relativePath === 'future.ts').status, 'modified');

    scene.steps = [{ id: 'step-2', title: 'Second pair', body: '', file: 'selected.ts', pairIndex: 0, side: 'right' }];
    const evidenceAfterStepChange = buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'base-oid', headOid: 'head-oid' },
        files: [textFile('selected.ts', 'modified', 'BASE', 'HEAD')]
    }, scene);
    assert.deepEqual(evidenceAfterStepChange.labels, evidence.labels);
    assert.deepEqual(evidenceAfterStepChange.files.map((file) => [file.path, file.leftContent, file.rightContent]),
        evidence.files.map((file) => [file.path, file.leftContent, file.rightContent]));
});

test('uses an explicit authored endpoint subset and labels both endpoints', () => {
    const scene = stackScene([
        {
            path: 'selected.ts',
            panels: [
                panel('base-selected', 'base / selected.ts', 'BASE'),
                panel('step-selected', 'step / selected.ts', 'STEP'),
                panel('head-selected', 'head / selected.ts', 'HEAD')
            ]
        }
    ], [{ id: 'step-1', title: 'First pair', body: '', file: 'selected.ts', pairIndex: 1, side: 'right' }], undefined,
    { from: 'base', to: 'step' });

    const evidence = buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'base-oid', headOid: 'head-oid' },
        files: []
    }, scene);

    assert.deepEqual(evidence.labels, ['base', 'step']);
    assert.deepEqual(evidence.files.map((file) => [file.path, file.leftContent, file.rightContent]), [
        ['selected.ts', 'BASE', 'STEP']
    ]);
});

test('rejects unknown and duplicate authored endpoints', () => {
    const scene = stackScene([
        { path: 'selected.ts', panels: [panel('base', 'base', 'BASE'), panel('step', 'step', 'STEP'), panel('head', 'head', 'HEAD')] }
    ], [], undefined, { from: 'missing', to: 'head' });
    assert.throws(() => buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'base-oid', headOid: 'head-oid' }, files: []
    }, scene), /comparison|endpoint|panel|defined|unknown/i);

    scene.overview.comparison = { from: 'head', to: 'head' };
    assert.throws(() => buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'head', mergeBaseOid: 'base-oid', headOid: 'head-oid' }, files: []
    }, scene), /distinct|comparison|endpoint/i);
});

test('reports added, deleted, and modified files from the selected real pair', () => {
    const scene = stackScene([
        {
            path: 'added.ts',
            panels: [panel('base-added', 'base / added.ts', '', false), panel('step-added', 'step / added.ts', 'new'), panel('head-added', 'head / added.ts', 'new')]
        },
        {
            path: 'deleted.ts',
            panels: [panel('base-deleted', 'base / deleted.ts', 'old'), panel('step-deleted', 'step / deleted.ts', 'old'), panel('head-deleted', 'head / deleted.ts', '', false)]
        },
        {
            path: 'modified.ts',
            panels: [panel('base-modified', 'base / modified.ts', 'old'), panel('step-modified', 'step / modified.ts', 'old'), panel('head-modified', 'head / modified.ts', 'new')]
        },
        {
            path: 'same.ts',
            panels: [panel('base-same', 'base / same.ts', 'same'), panel('step-same', 'step / same.ts', 'same'), panel('head-same', 'head / same.ts', 'same')]
        }
    ], [{ id: 'step-1', title: 'Pair', body: '', file: 'modified.ts', pairIndex: 0, side: 'right' }]);

    const evidence = buildTourDirectoryEvidence({
        range: { baseRef: 'base', headRef: 'step', mergeBaseOid: 'base-oid', headOid: 'step-oid' },
        files: []
    }, scene);
    const entriesByPath = new Map(evidence.entries.map((entry) => [entry.relativePath, entry]));

    assert.deepEqual(evidence.files.map((file) => file.path), ['added.ts', 'deleted.ts', 'modified.ts']);
    assert.deepEqual(entriesByPath.get('added.ts').sides, [false, true]);
    assert.equal(entriesByPath.get('added.ts').status, 'right-only');
    assert.deepEqual(entriesByPath.get('deleted.ts').sides, [true, false]);
    assert.equal(entriesByPath.get('deleted.ts').status, 'left-only');
    assert.deepEqual(entriesByPath.get('modified.ts').sides, [true, true]);
    assert.equal(entriesByPath.get('modified.ts').status, 'modified');
    assert.equal(entriesByPath.has('same.ts'), false);
});

test('scopes walkthrough evidence to a directory boundary and retains omitted reasons', () => {
    const evidence = buildTourDirectoryEvidence({
        range: { baseRef: 'main', headRef: 'feature', mergeBaseOid: 'base-oid', headOid: 'head-oid' },
        files: [
            textFile('web/app.ts'),
            textFile('web/nested/file.ts'),
            textFile('web-other/app.ts'),
            textFile('docs/readme.md'),
            {
                id: 'omitted-web',
                kind: 'omitted',
                title: 'bundle.bin',
                path: 'web/bundle.bin',
                changeKind: 'modified',
                additions: 0,
                deletions: 0,
                reason: 'Binary content is unavailable.'
            },
            {
                id: 'omitted-sibling',
                kind: 'omitted',
                title: 'other.bin',
                path: 'web-other/other.bin',
                changeKind: 'modified',
                additions: 0,
                deletions: 0,
                reason: 'Sibling must be excluded.'
            }
        ]
    }, {
        id: 'walkthrough-directory',
        kind: 'walkthrough',
        title: 'Walkthrough directory',
        summary: '',
        bullets: [],
        tags: [],
        takeaway: '',
        overview: { kind: 'directory-diff', path: 'web' },
        steps: []
    });

    assert.deepEqual(evidence.files.map((file) => file.path), ['web/app.ts', 'web/nested/file.ts']);
    assert.equal(evidence.files.some((file) => file.path.startsWith('web-other/')), false);
    assert.equal(evidence.entries.some((entry) => entry.relativePath === 'web-other/'), false);
    assert.equal(evidence.entries.some((entry) => entry.isDirectory && entry.relativePath === 'web'), true);
    assert.equal(evidence.entries.some((entry) => entry.isDirectory && entry.relativePath === 'web/nested'), true);
    assert.deepEqual(evidence.omitted.map((file) => file.path), ['web/bundle.bin']);
    assert.equal(evidence.omitted[0].reason, 'Binary content is unavailable.');
    assert.equal(evidence.labels[0].includes('web/'), true);
    assert.equal(evidence.labels[1].includes('web/'), true);
});
