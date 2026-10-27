const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'cli', 'dependency-python.py');

function analyze(files, pythonRoots) {
    const input = { files };
    if (pythonRoots !== undefined) input.pythonRoots = pythonRoots;
    return JSON.parse(execFileSync('python3', ['-I', SCRIPT], {
        input: JSON.stringify(input),
        encoding: 'utf8'
    }));
}

function sites(document, relation, name) {
    return document.sites.filter(site => (!relation || site.relation === relation) && (!name || site.name === name));
}

test('emits the shared shape with UTF-16 offsets and local declaration nodes', () => {
    const source = '# 😀\ndef local():\n    return "🦕"\n\nvalue = local()\n';
    const result = analyze({ 'main.py': source });
    const document = result.documents['main.py'];

    assert.match(result.producer, /^bygone-python-ast\/\d+\.\d+/);
    assert.equal(document.status, 'complete');
    assert.equal(document.nodes[0].id, '<init>');
    assert.equal(document.nodes[0].start, 0);
    assert.equal(document.nodes[0].end, source.length);
    assert.deepEqual(document.nodes.find(node => node.name === 'local'), {
        id: 'local@5', name: 'local', kind: 'function', start: 5, end: 33
    });

    const call = sites(document, 'call', 'local')[0];
    assert.equal(call.owner, '<init>');
    assert.equal(call.phase, 'module-init');
    assert.deepEqual(call.target, { file: 'main.py', node: 'local@5' });
    for (const site of document.sites) assert.ok(document.nodes.some(node => node.id === site.owner));
});

test('keeps Unicode separators inside source lines aligned with AST positions', () => {
    const source = "label='a\u2028b'\ndef f(): pass\nf()\n";
    const document = analyze({ 'main.py': source }).documents['main.py'];

    assert.deepEqual(document.nodes.find(node => node.name === 'f'), {
        id: 'f@12', name: 'f', kind: 'function', start: 12, end: 25
    });
    const call = sites(document, 'call', 'f')[0];
    assert.equal(call.start, 26);
    assert.equal(call.end, 29);
});

test('resolves relative imports through package __init__ and preserves root ambiguity', () => {
    const files = {
        'main.py': 'from app import run\nrun()\n',
        'app/__init__.py': 'from .impl import run\n',
        'app/impl.py': 'def run():\n    return 1\n'
    };
    const result = analyze(files);
    const main = result.documents['main.py'];
    assert.equal(sites(main, 'import', 'run')[0].resolution, 'resolved');
    assert.deepEqual(sites(main, 'import', 'run')[0].target, { file: 'app/impl.py', node: 'run@0' });
    assert.deepEqual(sites(main, 'call', 'run')[0].target, { file: 'app/impl.py', node: 'run@0' });

    const ambiguous = analyze({
        'main.py': 'from pkg import helper\nhelper()\n',
        'pkg/helper.py': 'def helper(): pass\n',
        'src/pkg/helper.py': 'def helper(): pass\n'
    });
    const ambiguousSites = sites(ambiguous.documents['main.py'], null, 'helper');
    assert.equal(ambiguousSites[0].resolution, 'ambiguous');
    assert.deepEqual(ambiguousSites[0].candidates.map(candidate => candidate.file), ['pkg/helper.py', 'src/pkg/helper.py']);
    assert.equal(ambiguousSites[1].resolution, 'ambiguous');

    const rooted = analyze({
        'main.py': 'from app.run import run\nrun()\n',
        'src/app/run.py': 'def run(): pass\n'
    }, ['src']);
    assert.equal(sites(rooted.documents['main.py'], 'call', 'run')[0].resolution, 'resolved');
});

test('keeps imported calls conservative under parameters and unknown rebinding, while recording references', () => {
    const result = analyze({
        'main.py': [
            'from lib import helper as imported',
            '',
            'def direct():',
            '    return imported()',
            '',
            'def parameter(imported):',
            '    return imported()',
            '',
            'def shadow():',
            '    imported = 3',
            '    return imported()',
            '',
            'def registerer():',
            '    register(imported)',
            '    register(direct)',
            ''
        ].join('\n'),
        'lib.py': 'def helper():\n    return 1\n'
    });
    const document = result.documents['main.py'];
    assert.deepEqual(sites(document, 'call', 'imported')[0].target, { file: 'lib.py', node: 'helper@0' });
    assert.equal(sites(document, 'call', 'imported')[1].resolution, 'unresolved');
    assert.equal(sites(document, 'call', 'imported')[2].resolution, 'unresolved');

    const references = sites(document, 'reference');
    assert.deepEqual(references.map(site => site.name), ['imported', 'direct']);
    assert.deepEqual(references[0].target, { file: 'lib.py', node: 'helper@0' });
    assert.deepEqual(references[1].target, { file: 'main.py', node: 'direct@36' });
    assert.ok(!sites(document, 'call', 'direct').some(site => site.owner.startsWith('registerer@')));
});

test('labels enclosing evaluation, invocation, annotation, and dynamic import phases', () => {
    const source = [
        'def make():',
        '    return 1',
        '',
        'def decorate(value):',
        '    return value',
        '',
        'def base():',
        '    return object',
        '',
        '@decorate(make())',
        'class Box(base()):',
        '    value = make()',
        '    @decorate(make())',
        '    def method(self, value=make(), tag: make() = 1) -> make():',
        '        return make()',
        '',
        'def load(name):',
        '    return importlib.import_module(name)',
        '',
        'result = Box()',
        ''
    ].join('\n');
    const document = analyze({ 'main.py': source }).documents['main.py'];
    const enclosing = sites(document, 'call', 'make').filter(site => site.owner === '<init>' || site.owner.startsWith('Box@'));
    assert.ok(enclosing.some(site => site.owner === '<init>' && site.phase === 'module-init'));
    assert.ok(enclosing.some(site => site.owner.startsWith('Box@') && site.phase === 'module-init'));
    assert.ok(sites(document, 'call', 'make').some(site => site.owner.startsWith('method@') && site.phase === 'invocation'));
    assert.ok(sites(document, 'import', 'importlib.import_module').some(site => site.owner.startsWith('load@') && site.resolution === 'unsupported'));
    assert.ok(sites(document, null, 'Box').some(site => site.relation === 'construct' && site.phase === 'module-init'));
    assert.ok(sites(document, 'call', 'make').some(site => site.phase === 'unknown'));
});

test('does not misclassify an unrelated imported module as importlib', () => {
    const document = analyze({
        'main.py': [
            'import elsewhere as importlib',
            '',
            'def load(name):',
            '    return importlib.import_module(name)',
            ''
        ].join('\n')
    }).documents['main.py'];

    assert.equal(sites(document, 'import', 'importlib.import_module').length, 0);
    assert.equal(sites(document, 'call', 'importlib.import_module')[0].resolution, 'unsupported');
});

test('uses type phase for stubs and reports unresolved and invalid supplied fixtures', () => {
    const result = analyze({
        'api.pyi': 'from .impl import Thing\ndef f(value: Thing) -> Thing: ...\n',
        'impl.py': 'class Thing: pass\n',
        'unresolved.py': 'from .missing import absent\nabsent()\nimport os\n',
        'broken.py': 'def broken(:\n    pass\n'
    });
    const stub = result.documents['api.pyi'];
    assert.ok(stub.sites.every(site => site.phase === 'type'));
    assert.ok(sites(stub, 'reference', 'Thing').every(site => site.resolution === 'resolved'));

    const unresolved = result.documents['unresolved.py'];
    assert.equal(sites(unresolved, 'import', 'absent')[0].resolution, 'unresolved');
    assert.equal(sites(unresolved, 'call', 'absent')[0].resolution, 'unresolved');
    assert.equal(sites(unresolved, 'import', 'os')[0].resolution, 'external');

    const broken = result.documents['broken.py'];
    assert.equal(broken.status, 'invalid');
    assert.equal(broken.nodes[0].id, '<init>');
    assert.equal(broken.nodes[0].end, 'def broken(:\n    pass\n'.length);
    assert.ok(broken.diagnostics.some(diagnostic => diagnostic.code === 'syntax-error'));
});

test('records bare decorator applications separately from factories and diagnoses omitted lambda bodies', () => {
    const result = analyze({
        'main.py': [
            'from lib import decorate, factory, helper',
            '',
            '@decorate',
            'def plain(): pass',
            '',
            '@factory(1)',
            'def configured(): pass',
            '',
            'value = lambda: helper()',
            ''
        ].join('\n'),
        'lib.py': [
            'def decorate(value): return value',
            'def factory(value): return decorate',
            'def helper(): return 1',
            ''
        ].join('\n')
    }).documents['main.py'];

    const decorateCall = sites(result, 'call', 'decorate');
    assert.equal(decorateCall.length, 1);
    assert.equal(decorateCall[0].phase, 'module-init');
    assert.deepEqual(decorateCall[0].target, { file: 'lib.py', node: 'decorate@0' });

    const factoryCalls = sites(result, 'call', 'factory');
    assert.equal(factoryCalls.length, 2);
    assert.ok(factoryCalls.some(site => site.resolution === 'resolved' && site.phase === 'module-init'));
    assert.ok(factoryCalls.some(site => site.resolution === 'unsupported' && /factory result/.test(site.reason)));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'lambda-body-unresolved'));
    assert.equal(sites(result, 'call', 'helper').length, 0);
});

test('separates eager generator iterators from deferred body and filters', () => {
    const document = analyze({
        'main.py': [
            'def source(): pass',
            'def body(value): pass',
            'def predicate(value): pass',
            '',
            'def make():',
            '    return (body(value) for value in source() if predicate(value))',
            '',
            'items = (body(value) for value in source() if predicate(value))',
            ''
        ].join('\n')
    }).documents['main.py'];

    const makeBody = sites(document, 'call', 'body');
    assert.equal(makeBody.find(site => site.owner.startsWith('make@')).phase, 'invocation');
    assert.equal(makeBody.find(site => site.owner === '<init>').phase, 'unknown');

    const makePredicate = sites(document, 'call', 'predicate');
    assert.equal(makePredicate.find(site => site.owner.startsWith('make@')).phase, 'invocation');
    assert.equal(makePredicate.find(site => site.owner === '<init>').phase, 'unknown');

    const sourceCalls = sites(document, 'call', 'source');
    assert.equal(sourceCalls.find(site => site.owner.startsWith('make@')).phase, 'invocation');
    assert.equal(sourceCalls.find(site => site.owner === '<init>').phase, 'module-init');
});

test('keeps declaration and site output bounded with explicit one-shot diagnostics', () => {
    const declarations = [];
    for (let index = 0; index < 5002; index += 1) {
        declarations.push(`def function${index}(): pass`);
    }
    const nodeDocument = analyze({ 'declarations.py': declarations.join('\n') }).documents['declarations.py'];
    assert.equal(nodeDocument.nodes.length, 5001);
    assert.equal(nodeDocument.diagnostics.filter(diagnostic => diagnostic.code === 'node-limit').length, 1);

    const calls = [];
    for (let index = 0; index < 5002; index += 1) {
        calls.push(`function${index}()`);
    }
    const siteDocument = analyze({ 'calls.py': calls.join('\n') }).documents['calls.py'];
    assert.equal(siteDocument.sites.length, 5000);
    assert.equal(siteDocument.diagnostics.filter(diagnostic => diagnostic.code === 'site-limit').length, 1);
});

test('keeps relative imports beyond the project package and type-only runtime calls unresolved', () => {
    const relative = analyze({
        'main.py': 'from ..x import target\ntarget()\n',
        'x.py': 'def target(): pass\n'
    }).documents['main.py'];
    assert.equal(sites(relative, 'import', 'target')[0].resolution, 'unresolved');
    assert.equal(sites(relative, 'call', 'target')[0].resolution, 'unresolved');

    const typeOnly = analyze({
        'main.py': [
            'from typing import TYPE_CHECKING',
            'if TYPE_CHECKING:',
            '    from lib import helper',
            '    helper()',
            'helper()',
            ''
        ].join('\n'),
        'lib.py': 'def helper(): pass\n'
    }).documents['main.py'];
    assert.equal(sites(typeOnly, 'import', 'helper')[0].phase, 'type');
    assert.equal(sites(typeOnly, 'call', 'helper')[0].phase, 'type');
    assert.equal(sites(typeOnly, 'call', 'helper')[0].resolution, 'resolved');
    assert.equal(sites(typeOnly, 'call', 'helper')[1].resolution, 'unresolved');
});

test('resolves unique imported-module attributes but refuses rebinding and shadowing', () => {
    const result = analyze({
        'alias.py': [
            'import lib as module',
            'module.target()',
            'use(module.target)',
            '',
            'def shadow(module):',
            '    module.target()',
            ''
        ].join('\n'),
        'mutated.py': [
            'import lib as module',
            'module.target = replacement',
            'module.target()',
            ''
        ].join('\n'),
        'dynamic.py': [
            'import lib as module',
            'setattr(module, attr, replacement)',
            'module.target()',
            ''
        ].join('\n'),
        'loader.py': [
            'import importlib',
            'importlib.import_module = replacement',
            'importlib.import_module("lib")',
            ''
        ].join('\n'),
        'lib.py': 'def target(): pass\n',
        'use.py': 'def use(value): pass\n'
    });
    const alias = result.documents['alias.py'];
    const direct = sites(alias, 'call', 'module.target')[0];
    assert.equal(direct.resolution, 'resolved');
    assert.deepEqual(direct.target, { file: 'lib.py', node: 'target@0' });
    assert.equal(sites(alias, 'reference', 'module.target')[0].resolution, 'resolved');
    assert.equal(sites(alias, 'call', 'module.target')[1].resolution, 'unsupported');
    assert.equal(sites(result.documents['mutated.py'], 'call', 'module.target')[0].resolution, 'unsupported');
    assert.equal(sites(result.documents['dynamic.py'], 'call', 'module.target')[0].resolution, 'unsupported');
    assert.equal(sites(result.documents['loader.py'], 'import', 'importlib.import_module').length, 0);
    assert.equal(sites(result.documents['loader.py'], 'call', 'importlib.import_module')[0].resolution, 'unsupported');
});

test('does not mistake a shadowed __import__ for dynamic import syntax', () => {
    const document = analyze({
        'main.py': [
            'def run(__import__):',
            '    __import__("lib")',
            ''
        ].join('\n')
    }).documents['main.py'];
    assert.equal(sites(document, 'import', '__import__').length, 0);
    assert.equal(sites(document, 'call', '__import__')[0].resolution, 'unresolved');
});
