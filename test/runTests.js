const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function loadBundledModule(entryPoint) {
    const result = buildSync({
        entryPoints: [entryPoint],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        target: 'node16',
        logLevel: 'silent'
    });

    const code = result.outputFiles[0].text;
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        require,
        __dirname: path.dirname(entryPoint),
        __filename: entryPoint,
        console,
        process,
        Buffer,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };

    vm.runInNewContext(code, sandbox, { filename: entryPoint });
    const clone = (value) => (
        value && typeof value === 'object'
            ? JSON.parse(JSON.stringify(value))
            : value
    );

    if (module.exports && typeof module.exports === 'object') {
        const wrapped = {};
        for (const [key, value] of Object.entries(module.exports)) {
            wrapped[key] = typeof value === 'function'
                ? (...args) => clone(value(...args))
                : clone(value);
        }
        return wrapped;
    }

    return module.exports;
}

const { buildTwoWayDiffModel, mergeText } = loadBundledModule(path.join(__dirname, '..', 'src', 'diffEngine.ts'));
const { buildDirectoryComparison, buildMultiDirectoryComparison } = loadBundledModule(path.join(__dirname, '..', 'src', 'directoryDiff.ts'));

function testTwoWayDiffAlignsInsertions() {
    const model = buildTwoWayDiffModel('a\nb\nc\n', 'a\nx\nb\nc\n');

    assert.equal(model.hasChanges, true);
    assert.equal(model.rows.length, 4);
    assert.equal(model.rows[1].left.kind, 'placeholder');
    assert.equal(model.rows[1].right.kind, 'added');
    assert.equal(model.rows[1].right.content, 'x');
    assert.equal(model.rightLines[1].segments, undefined);
}

function testInlineHighlightsSingleWordReplacement() {
    const model = buildTwoWayDiffModel('const value = oldName;\n', 'const value = newName;\n');

    assert.deepEqual(
        model.leftLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'removed', text: 'oldName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'const value = ', emphasis: false },
            { kind: 'added', text: 'newName', emphasis: true },
            { kind: 'context', text: ';', emphasis: false }
        ]
    );
}

function testInlineHighlightsPunctuationChange() {
    const model = buildTwoWayDiffModel('call(foo)\n', 'call(foo, bar)\n');

    assert.equal(model.leftLines[0].segments?.some((segment) => segment.emphasis), false);
    assert.deepEqual(
        model.rightLines[0].segments,
        [
            { kind: 'context', text: 'call(foo', emphasis: false },
            { kind: 'added', text: ', bar', emphasis: true },
            { kind: 'context', text: ')', emphasis: false }
        ]
    );
}

function testInlineHighlightsWhitespaceSensitiveChange() {
    const model = buildTwoWayDiffModel('return foo + bar;\n', 'return foo+bar;\n');

    assert.equal(model.leftLines[0].segments, undefined);
    assert.equal(model.rightLines[0].segments, undefined);
}

function testInlineHighlightsOnlyPairedReplaceLines() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha changed\nbeta changed\ngamma\n');

    assert.equal(model.blocks[0].kind, 'replace');
    assert.ok(model.leftLines[0].segments);
    assert.ok(model.leftLines[1].segments);
    assert.equal(model.rightLines[2].segments, undefined);
}

function testPureDeleteHasNoInlineSegments() {
    const model = buildTwoWayDiffModel('alpha\nbeta\n', 'alpha\n');

    assert.equal(model.blocks[0].kind, 'delete');
    assert.equal(model.leftLines[1].segments, undefined);
}

function testDirectoryDiffDetectsModifiedFiles() {
    const root = path.join(__dirname, '..', 'src');
    const entries = buildDirectoryComparison(root, root);
    const appEntry = entries.find((entry) => entry.relativePath === 'diffEngine.ts');

    assert.ok(entries.length > 0);
    assert.equal(appEntry?.status, 'same');
}

function testMultiDirectoryDiffDetectsPartialAndModifiedFiles() {
    const root = path.join(__dirname, '..', 'src');
    const entries = buildMultiDirectoryComparison([root, root, root]);
    const appEntry = entries.find((entry) => entry.relativePath === 'diffEngine.ts');

    assert.ok(entries.length > 0);
    assert.deepEqual(appEntry?.sides, [true, true, true]);
    assert.equal(appEntry?.status, 'same');
}

function testDirectoryDiffLeavesIdenticalFilesSame() {
    const root = path.join(__dirname, '..', 'src');
    const entries = buildDirectoryComparison(root, root);
    assert.equal(entries.find((entry) => entry.relativePath === 'diffEngine.ts')?.status, 'same');
}

function testMergeTextHandlesDeletedRanges() {
    const result = mergeText('one\ntwo\nthree\n', 'one\nTHREE\n', 'one\nTHREE\n');

    assert.equal(result.resultLines.join('\n'), 'one\nTHREE');
    assert.equal(result.conflictCount, 0);
}

function run() {
    const tests = [
        testTwoWayDiffAlignsInsertions,
        testInlineHighlightsSingleWordReplacement,
        testInlineHighlightsPunctuationChange,
        testInlineHighlightsWhitespaceSensitiveChange,
        testInlineHighlightsOnlyPairedReplaceLines,
        testPureDeleteHasNoInlineSegments,
        testDirectoryDiffDetectsModifiedFiles,
        testMultiDirectoryDiffDetectsPartialAndModifiedFiles,
        testDirectoryDiffLeavesIdenticalFilesSame,
        testMergeTextHandlesDeletedRanges,
    ];

    for (const testFn of tests) {
        testFn();
    }

    console.log(`ok ${tests.length} tests`);
}

run();
