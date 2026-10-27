const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeTypescriptDependencies } = require('../out/dependencyTypescript.js');
const dependencyTypescript = require('dependency-typescript');

function site(document, relation, name) {
    return document.sites.find(candidate => candidate.relation === relation && candidate.name === name);
}

test('resolves supplied imports, aliases, nested functions, callbacks, and execution phases', () => {
    const result = analyzeTypescriptDependencies({
        'lib.ts': [
            'export class Widget {',
            '    method() { return 1; }',
            '}',
            'export function leaf() { return 1; }',
            'export function nested() {',
            '    function inner() { return leaf(); }',
            '    return inner;',
            '}'
        ].join('\n'),
        'main.ts': [
            'import { Widget, leaf as alias } from "./lib";',
            'function decorate(value: unknown) { return value; }',
            '@decorate',
            'class Local extends Widget {',
            '    static eager = alias();',
            '    instance = alias();',
            '    method() { return alias(); }',
            '}',
            'function outer(callback = alias) { return callback(); }',
            'outer(alias);',
            'new Widget();'
        ].join('\n')
    });

    assert.equal(result.producer, `bygone-typescript/${dependencyTypescript.version}`);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    const main = result.documents['main.ts'];
    assert.equal(main.status, 'complete');
    assert.deepEqual(main.nodes[0], {
        id: '<init>',
        name: '<init>',
        kind: 'module-init',
        start: 0,
        end: main.nodes[0].end
    });
    assert.ok(main.nodes.some(node => node.id.startsWith('Local@') && node.kind === 'class'));
    assert.ok(main.nodes.some(node => node.id.startsWith('outer@') && node.kind === 'function'));

    const imported = site(main, 'import', './lib');
    assert.equal(imported.resolution, 'resolved');
    assert.deepEqual(imported.target, { file: 'lib.ts' });

    const staticCall = main.sites.find(candidate => candidate.relation === 'call' && candidate.name === 'alias' && candidate.phase === 'module-init');
    assert.equal(staticCall.resolution, 'resolved');
    assert.equal(staticCall.target.node.startsWith('leaf@'), true);
    assert.equal(staticCall.owner.startsWith('Local@'), true);

    const instanceCall = main.sites.find(candidate => candidate.relation === 'call' && candidate.name === 'alias' && candidate.phase === 'unknown');
    assert.equal(instanceCall.resolution, 'resolved');

    const methodCall = main.sites.find(candidate => candidate.relation === 'call' && candidate.name === 'alias' && candidate.phase === 'invocation');
    assert.equal(methodCall.resolution, 'resolved');
    assert.equal(methodCall.owner.startsWith('method@'), true);

    const defaultReference = main.sites.find(candidate => candidate.relation === 'reference' && candidate.name === 'alias' && candidate.owner.startsWith('outer@'));
    assert.equal(defaultReference.phase, 'invocation');
    assert.equal(defaultReference.resolution, 'resolved');

    const indirectCall = site(main, 'call', 'callback');
    assert.equal(indirectCall.resolution, 'unresolved');
    assert.equal(indirectCall.target, undefined);

    const construct = site(main, 'construct', 'Widget');
    assert.equal(construct.resolution, 'resolved');
    assert.equal(construct.target.file, 'lib.ts');
    assert.equal(construct.target.node.startsWith('Widget@'), true);

    const nested = result.documents['lib.ts'];
    assert.ok(nested.nodes.some(node => node.id.startsWith('inner@')));
    const nestedCall = site(nested, 'call', 'leaf');
    assert.equal(nestedCall.resolution, 'resolved');
    assert.equal(nestedCall.owner.startsWith('inner@'), true);
});

test('keeps UTF-16 spans, unresolved dynamic modules, and signature calls conservative', () => {
    const source = '// 🧪\ninterface Runner { run(): void }\ndeclare const runner: Runner;\nrunner.run();\nconst pending = import("./missing");\n';
    const result = analyzeTypescriptDependencies({ 'main.ts': source });
    const document = result.documents['main.ts'];

    assert.equal(document.nodes[0].start, 0);
    assert.equal(document.nodes[0].end, source.length);
    const run = site(document, 'call', 'run');
    assert.equal(run.resolution, 'unresolved');
    assert.equal(run.target, undefined);
    assert.match(run.reason, /signature|runtime declaration|direct/);

    const dynamic = site(document, 'import', './missing');
    assert.equal(dynamic.loading, 'deferred');
    assert.equal(dynamic.resolution, 'unresolved');
    assert.equal(source.slice(dynamic.start, dynamic.end), 'import("./missing")');
    assert.ok(document.diagnostics.some(diagnostic => diagnostic.code === 'module-unresolved'));

    const emojiOffset = source.indexOf('runner.run');
    assert.equal(run.start, emojiOffset);
    assert.equal(run.end, source.indexOf('();', emojiOffset) + 2);
});

test('resolves a simple relative import through the supplied virtual source host', () => {
    const result = analyzeTypescriptDependencies({
        'util.ts': 'export function compute() { return 1; }',
        'app.ts': 'import { compute } from "./util";\ncompute();'
    });
    const app = result.documents['app.ts'];
    const imported = site(app, 'import', './util');
    assert.equal(imported.resolution, 'resolved');
    assert.deepEqual(imported.target, { file: 'util.ts' });
    const call = site(app, 'call', 'compute');
    assert.equal(call.resolution, 'resolved');
    assert.deepEqual(call.target, { file: 'util.ts', node: 'compute@0' });
    assert.equal(app.diagnostics.some(diagnostic => diagnostic.code === 'compiler-module-resolution'), false);
});

test('does not resolve a mutable variable from a stale function initializer', () => {
    const result = analyzeTypescriptDependencies({
        'main.ts': 'function other() { return 2; }\nlet f = () => 1;\nf = other;\nf();'
    });
    const call = site(result.documents['main.ts'], 'call', 'f');
    assert.equal(call.resolution, 'unresolved');
    assert.equal(call.target, undefined);
});

test('does not resolve variables written through object and array destructuring', () => {
    const result = analyzeTypescriptDependencies({
        'main.ts': [
            'function other() { return 2; }',
            'let objectFn = () => 1;',
            'let arrayFn = () => 1;',
            '({ objectFn } = { objectFn: other });',
            '[arrayFn] = [other];',
            'objectFn();',
            'arrayFn();'
        ].join('\n')
    });
    const calls = result.documents['main.ts'].sites.filter(candidate => candidate.relation === 'call');
    assert.deepEqual(calls.map(call => call.name), ['objectFn', 'arrayFn']);
    assert.ok(calls.every(call => call.resolution === 'unresolved' && call.target === undefined));
});

test('records property decorators and invalidates reassigned field initializers', () => {
    const result = analyzeTypescriptDependencies({
        'main.ts': [
            'function replacement() {}',
            'function decorate() {}',
            'class C {',
            '    @decorate()',
            '    fn = () => 1;',
            '}',
            'const instance = new C();',
            'instance.fn();',
            'instance.fn = replacement;',
            'instance.fn();'
        ].join('\n')
    });
    const document = result.documents['main.ts'];
    const decorator = site(document, 'call', 'decorate');
    assert.equal(decorator.phase, 'module-init');
    assert.ok(decorator.owner.startsWith('C@'));
    const calls = document.sites.filter(candidate => candidate.relation === 'call' && candidate.name === 'fn');
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.resolution === 'unresolved' && call.target === undefined));
});

test('does not resolve value uses of type-only named and namespace imports', () => {
    const result = analyzeTypescriptDependencies({
        'lib.ts': 'export function fn() {}',
        'main.ts': [
            'import type { fn as named } from "./lib";',
            'import type * as namespace from "./lib";',
            'import { type fn as inline } from "./lib";',
            'named();',
            'namespace.fn();',
            'inline();'
        ].join('\n')
    });
    const calls = result.documents['main.ts'].sites.filter(candidate => candidate.relation === 'call');
    assert.deepEqual(calls.map(call => call.name), ['named', 'fn', 'inline']);
    assert.ok(calls.every(call => call.resolution === 'unresolved'));
    assert.ok(calls.every(call => /type-only/.test(call.reason)));
});

test('does not index runtime declarations nested in ambient namespaces', () => {
    const result = analyzeTypescriptDependencies({
        'main.ts': [
            'declare namespace Ambient {',
            '    class Service {}',
            '    function run(): void;',
            '}',
            'new Ambient.Service();',
            'Ambient.run();'
        ].join('\n')
    });
    const document = result.documents['main.ts'];
    assert.deepEqual(document.nodes.map(node => node.id), ['<init>']);
    assert.equal(site(document, 'construct', 'Service').resolution, 'unresolved');
    assert.equal(site(document, 'call', 'run').resolution, 'unresolved');
});

test('marks malformed and unsupported inputs invalid without reading outside the input map', () => {
    const result = analyzeTypescriptDependencies({
        'broken.ts': 'function broken( {',
        'notes.txt': 'not source code'
    });

    assert.equal(result.documents['broken.ts'].status, 'invalid');
    assert.ok(result.documents['broken.ts'].diagnostics.some(diagnostic => diagnostic.code.startsWith('ts-')));
    assert.equal(result.documents['notes.txt'].status, 'invalid');
    assert.ok(result.documents['notes.txt'].diagnostics.some(diagnostic => diagnostic.code === 'unsupported-file-type'));
});
