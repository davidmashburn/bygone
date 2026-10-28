const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeParserDependencies } = require('../src/dependencyParsers');

const sites = (document, relation) => document.sites.filter(site => !relation || site.relation === relation);

test('recursive Rust module declarations cannot expand module ownership indefinitely', async () => {
    const result = await analyzeParserDependencies({ 'src/main.rs': 'mod main; fn main() {}' });
    assert.equal(result.documents['src/main.rs'].status, 'complete');
});

test('Go records imports, module-init initializers, and resolved cross-file calls', async () => {
    const files = {
        'go.mod': 'module example.com/demo\ngo 1.22\n',
        'lib/lib.go': 'package lib\nfunc Do(x int) int { return x }\n',
        'main.go': 'package main\nimport "example.com/demo/lib"\nvar value = lib.Do(1)\nfunc Local() {}\nfunc caller() { Local(); lib.Do(2) }\n'
    };
    const result = await analyzeParserDependencies(files);
    const document = result.documents['main.go'];
    assert.equal(document.status, 'complete');
    assert.deepEqual(document.nodes[0], { id: '<init>', name: '<init>', kind: 'module-init', start: 0, end: files['main.go'].length });
    const imported = sites(document, 'import')[0];
    assert.equal(imported.resolution, 'resolved');
    assert.deepEqual(imported.target, { file: 'lib/lib.go' });
    const calls = sites(document, 'call');
    assert.equal(calls.find(site => site.name === 'lib.Do').phase, 'module-init');
    assert.equal(calls.find(site => site.name === 'lib.Do' && site.owner !== '<init>').resolution, 'resolved');
    assert.equal(calls.find(site => site.name === 'Local').resolution, 'resolved');
});

test('local parameters shadow direct call names instead of borrowing a target', async () => {
    const source = 'package p\nfunc target() {}\nfunc caller(target func()) { target() }\n';
    const document = (await analyzeParserDependencies({ 'shadow.go': source })).documents['shadow.go'];
    const call = sites(document, 'call').find(site => site.name === 'target');
    assert.equal(call.resolution, 'unresolved');
    assert.equal(call.target, undefined);
    assert.match(call.reason, /shadowed/);
});

test('invalid syntax is fail-closed and Unicode keeps UTF-16 offsets', async () => {
    const bad = (await analyzeParserDependencies({ 'bad.rs': 'fn broken( {' })).documents['bad.rs'];
    assert.equal(bad.status, 'invalid');
    assert.deepEqual(bad.sites, []);
    assert.ok(bad.diagnostics.some(diagnostic => diagnostic.code === 'syntax-invalid'));

    const source = 'package p\nvar π = 1\nfunc helper() {}\nfunc caller() { helper() }\n';
    const document = (await analyzeParserDependencies({ 'unicode.go': source })).documents['unicode.go'];
    const call = sites(document, 'call').find(site => site.name === 'helper');
    assert.equal(call.start, source.lastIndexOf('helper()'));
    assert.equal(call.end, call.start + 'helper()'.length);
});

test('Rust macros are unsupported and compile-time calls do not become module-init runtime edges', async () => {
    const source = 'fn helper() {}\nfn caller() { helper(); call_macro!(helper); }\nstatic VALUE: i32 = helper();\n';
    const document = (await analyzeParserDependencies({ 'macro.rs': source })).documents['macro.rs'];
    const calls = sites(document, 'call');
    assert.equal(calls.find(site => site.name === 'helper' && site.owner.startsWith('caller@')).phase, 'invocation');
    assert.equal(calls.find(site => site.name === 'call_macro').resolution, 'unsupported');
    assert.equal(calls.find(site => site.name === 'helper' && site.owner === '<init>').phase, 'unknown');
    assert.ok(document.diagnostics.some(diagnostic => diagnostic.code === 'rust-macro-unexpanded'));
});

test('Mojo imports and uncertain header/member phases remain conservative', async () => {
    const source = [
        'from foo import baz',
        '@decorator(1)',
        'def f(x: Int = helper()):',
        '    baz(x)',
        '    obj.method(x)',
        ''
    ].join('\n');
    const document = (await analyzeParserDependencies({ 'phase.mojo': source })).documents['phase.mojo'];
    const imported = sites(document, 'import')[0];
    assert.equal(imported.phase, 'unknown');
    assert.equal(imported.resolution, 'external');
    assert.equal(sites(document, 'call').find(site => site.name === 'decorator').phase, 'unknown');
    assert.equal(sites(document, 'call').find(site => site.name === 'helper').phase, 'unknown');
    assert.equal(sites(document, 'call').find(site => site.name === 'obj.method').resolution, 'unsupported');
    assert.ok(document.diagnostics.some(diagnostic => diagnostic.code === 'mojo-experimental'));
});

test('scope boundaries prevent borrowed nested targets and preserve init/use phases', async () => {
    const rust = await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': 'mod hidden { pub fn target() {} }\nfn main() { target(); hidden::target(); }\n'
    });
    const rustCalls = sites(rust.documents['src/lib.rs'], 'call');
    assert.equal(rustCalls.find(site => site.name === 'target').resolution, 'unresolved');
    assert.match(rustCalls.find(site => site.name === 'target').reason, /not-visible/);
    assert.equal(rustCalls.find(site => site.name === 'hidden::target').resolution, 'resolved');

    const useDocument = (await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': 'mod hidden { pub fn target() {} }\nuse crate::hidden::target;\nfn main() { target(); }\n'
    })).documents['src/lib.rs'];
    assert.equal(sites(useDocument, 'import')[0].phase, 'unknown');
    assert.equal(sites(useDocument, 'call').find(site => site.name === 'target').resolution, 'resolved');

    const mojo = (await analyzeParserDependencies({
        'nested.mojo': 'def outer():\n    def target():\n        pass\n    target()\ndef main():\n    target()\n'
    })).documents['nested.mojo'];
    assert.equal(sites(mojo, 'call').find(site => site.owner.startsWith('outer@')).resolution, 'resolved');
    assert.equal(sites(mojo, 'call').find(site => site.owner.startsWith('main@')).resolution, 'unresolved');
    assert.match(sites(mojo, 'call').find(site => site.owner.startsWith('main@')).reason, /not-visible/);

    const go = (await analyzeParserDependencies({
        'init.go': 'package p\nfunc target() {}\nfunc init() { target(); func() { target() }() }\n'
    })).documents['init.go'];
    const targetCalls = sites(go, 'call').filter(site => site.name === 'target');
    assert.deepEqual(targetCalls.map(site => site.phase), ['module-init', 'invocation']);
});

test('Rust module paths require declared membership and use nested standard layout', async () => {
    const result = await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': 'use foo::target;\nmod foo;\nmod consumer;\nfn main() { target(); foo::target(); }\n',
        'src/foo.rs': 'mod bar;\npub fn target() {}\nfn nested() { bar::target(); }\n',
        'src/foo/bar.rs': 'pub fn target() {}\n',
        'src/bar.rs': 'pub fn target() {}\n',
        'src/consumer.rs': 'use crate::foo::target;\nfn consume() { target(); }\n'
    });
    const root = result.documents['src/lib.rs'];
    const foo = result.documents['src/foo.rs'];
    const rootImport = sites(root, 'import').find(site => site.name === 'foo::target');
    const rootModule = sites(root, 'import').find(site => site.name === 'foo');
    const rootCalls = sites(root, 'call');
    const nestedModule = sites(foo, 'import').find(site => site.name === 'bar');
    const nestedCall = sites(foo, 'call').find(site => site.name === 'bar::target');
    const consumer = result.documents['src/consumer.rs'];
    const consumerImport = sites(consumer, 'import').find(site => site.name === 'crate::foo::target');
    const consumerCall = sites(consumer, 'call').find(site => site.name === 'target');

    assert.equal(rootImport.resolution, 'resolved');
    assert.equal(rootImport.target.file, 'src/foo.rs');
    assert.equal(rootModule.phase, 'unknown');
    assert.equal(rootModule.resolution, 'resolved');
    assert.equal(rootCalls.find(site => site.name === 'target').resolution, 'resolved');
    assert.equal(rootCalls.find(site => site.name === 'foo::target').target.file, 'src/foo.rs');
    assert.equal(nestedModule.phase, 'unknown');
    assert.equal(nestedModule.resolution, 'resolved');
    assert.equal(nestedModule.target.file, 'src/foo/bar.rs');
    assert.equal(nestedCall.resolution, 'resolved');
    assert.equal(nestedCall.target.file, 'src/foo/bar.rs');
    assert.equal(consumerImport.resolution, 'resolved');
    assert.equal(consumerCall.resolution, 'resolved');
    assert.equal(consumerCall.target.file, 'src/foo.rs');
});

test('Rust files without mod declarations do not create visible modules', async () => {
    const result = await analyzeParserDependencies({
        'main.rs': 'fn main() { foo::target(); }\n',
        'foo.rs': 'pub fn target() {}\n'
    });
    const call = sites(result.documents['main.rs'], 'call').find(site => site.name === 'foo::target');

    assert.notEqual(call.resolution, 'resolved');
    assert.equal(call.target, undefined);
});

test('Rust direct calls compare local and import lexical depths conservatively', async () => {
    const source = [
        'mod source { pub fn target() {} }',
        'fn target() {}',
        'mod child {',
        '    use super::source::target;',
        '    fn outer() { fn target() {} target(); }',
        '    fn imported() { target(); }',
        '}',
        'mod collision {',
        '    use super::source::target;',
        '    fn target() {}',
        '    fn call() { target(); }',
        '}',
        ''
    ].join('\n');
    const document = (await analyzeParserDependencies({ 'src/lib.rs': source })).documents['src/lib.rs'];
    const calls = sites(document, 'call').filter(site => site.name === 'target');
    const sourceTarget = document.nodes.find(node => node.name === 'target' && node.start === source.indexOf('pub fn target'));
    const nestedTargetStart = source.indexOf('fn target() {}', source.indexOf('fn outer'));
    const nestedTarget = document.nodes.find(node => node.name === 'target' && node.start === nestedTargetStart);
    const localCall = calls.find(site => site.owner.startsWith('outer@'));
    const importedCall = calls.find(site => site.owner.startsWith('imported@'));
    const collisionCall = calls.find(site => site.owner.startsWith('call@'));

    assert.equal(localCall.resolution, 'resolved');
    assert.equal(localCall.target.node, nestedTarget.id);
    assert.equal(importedCall.resolution, 'resolved');
    assert.equal(importedCall.target.node, sourceTarget.id);
    assert.equal(collisionCall.resolution, 'unresolved');
    assert.equal(collisionCall.target, undefined);
});

test('Rust direct calls validate restricted visibility without falling back to outer imports', async () => {
    const source = [
        'mod source { pub fn target() {} }',
        'mod parent {',
        '    use super::source::target;',
        '    pub(in crate::parent) fn valid() {}',
        '    pub(in crate::other) fn invalid() {}',
        '    pub(in external) fn unknown() {}',
        '    fn call() { valid(); invalid(); unknown(); }',
        '    fn shadow() { pub(in crate::other) fn target() {} target(); }',
        '}',
        ''
    ].join('\n');
    const document = (await analyzeParserDependencies({ 'src/lib.rs': source })).documents['src/lib.rs'];
    const calls = sites(document, 'call');
    assert.equal(calls.find(site => site.name === 'valid').resolution, 'resolved');
    for (const name of ['invalid', 'unknown', 'target']) {
        const call = calls.find(site => site.name === name);
        assert.equal(call.resolution, 'unresolved');
        assert.equal(call.reason, 'rust-path-target-not-visible');
        assert.equal(call.target, undefined);
    }
});

test('Rust module candidates include inline ancestors and do not fall back to flat files', async () => {
    const inline = await analyzeParserDependencies({
        'src/lib.rs': 'mod a { mod b; pub fn run(){ b::f(); }}\n',
        'src/b.rs': 'pub fn f() {}\n',
        'src/a/b.rs': 'pub fn f() {}\n'
    });
    const inlineCall = sites(inline.documents['src/lib.rs'], 'call').find(site => site.name === 'b::f');

    assert.equal(inlineCall.resolution, 'resolved');
    assert.equal(inlineCall.target.file, 'src/a/b.rs');

    const flatOnly = await analyzeParserDependencies({
        'src/lib.rs': 'mod a { mod b; pub fn run(){ b::f(); }}\n',
        'src/b.rs': 'pub fn f() {}\n'
    });
    const flatCall = sites(flatOnly.documents['src/lib.rs'], 'call').find(site => site.name === 'b::f');

    assert.equal(flatCall.resolution, 'unresolved');
    assert.equal(flatCall.target, undefined);

    const fileAncestor = await analyzeParserDependencies({
        'src/lib.rs': 'mod a;\n',
        'src/a.rs': 'mod b; pub fn run(){ b::f(); }\n',
        'src/b.rs': 'pub fn f() {}\n',
        'src/a/b.rs': 'pub fn f() {}\n'
    });
    const fileCall = sites(fileAncestor.documents['src/a.rs'], 'call').find(site => site.name === 'b::f');

    assert.equal(fileCall.resolution, 'resolved');
    assert.equal(fileCall.target.file, 'src/a/b.rs');
});

test('Rust restricted visibility resolves valid ancestors and rejects invalid paths', async () => {
    const result = await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': [
            'mod parent;',
            'fn main() { parent::crate_target(); parent::parent_target(); parent::super_target(); parent::invalid_target(); parent::unknown_target(); }',
            ''
        ].join('\n'),
        'src/parent.rs': [
            'pub ( in crate ) fn crate_target() {}',
            'pub(in crate::parent) fn parent_target() {}',
            'pub(in super) fn super_target() {}',
            'pub(in crate::other) fn invalid_target() {}',
            'pub(in external) fn unknown_target() {}',
            'mod child;',
            ''
        ].join('\n'),
        'src/parent/child.rs': [
            'fn call() { super::crate_target(); super::parent_target(); super::super_target(); super::invalid_target(); super::unknown_target(); }',
            ''
        ].join('\n')
    });
    const rootCalls = sites(result.documents['src/lib.rs'], 'call');
    const childCalls = sites(result.documents['src/parent/child.rs'], 'call');
    const rootCall = name => rootCalls.find(site => site.name === name);
    const childCall = name => childCalls.find(site => site.name === name);

    assert.equal(rootCall('parent::crate_target').resolution, 'resolved');
    assert.equal(rootCall('parent::super_target').resolution, 'resolved');
    assert.equal(rootCall('parent::parent_target').resolution, 'unresolved');
    assert.equal(rootCall('parent::invalid_target').resolution, 'unresolved');
    assert.equal(rootCall('parent::unknown_target').resolution, 'unresolved');
    assert.equal(childCall('super::crate_target').resolution, 'resolved');
    assert.equal(childCall('super::parent_target').resolution, 'resolved');
    assert.equal(childCall('super::super_target').resolution, 'resolved');
    assert.equal(childCall('super::invalid_target').resolution, 'unresolved');
    assert.equal(childCall('super::unknown_target').resolution, 'unresolved');
});

test('Rust scoped paths enforce item and nested-module visibility and prefer imports', async () => {
    const source = [
        'fn target() {}',
        'fn root_private() {}',
        'mod source { pub fn target() {} }',
        'mod parent {',
        '    mod hidden { pub fn target() {} }',
        '    pub mod exposed { pub fn target() {} }',
        '}',
        'mod child {',
        '    use super::source::target;',
        '    use super::root_private;',
        '    fn call() { target(); super::source::target(); root_private(); super::root_private(); }',
        '    fn child_private() {}',
        '    pub fn child_public() {}',
        '    mod nested { fn descendant() { super::child_private(); } }',
        '}',
        'fn main() { child::child_private(); child::child_public(); parent::hidden::target(); parent::exposed::target(); }',
        ''
    ].join('\n');
    const document = (await analyzeParserDependencies({ 'src/lib.rs': source })).documents['src/lib.rs'];
    const calls = sites(document, 'call');
    const sourceTarget = document.nodes.find(node => node.name === 'target' && node.start === source.indexOf('pub fn target'));
    const importedTarget = calls.find(site => site.owner.startsWith('call@') && site.name === 'target');
    const scopedImportedTarget = calls.find(site => site.owner.startsWith('call@') && site.name === 'super::source::target');
    const hiddenTarget = calls.find(site => site.name === 'parent::hidden::target');
    const exposedTarget = calls.find(site => site.name === 'parent::exposed::target');
    const childPrivate = calls.find(site => site.name === 'child::child_private');
    const childPublic = calls.find(site => site.name === 'child::child_public');
    const descendant = calls.find(site => site.name === 'super::child_private');

    assert.equal(importedTarget.resolution, 'resolved');
    assert.equal(importedTarget.target.node, sourceTarget.id);
    assert.equal(scopedImportedTarget.resolution, 'resolved');
    assert.equal(scopedImportedTarget.target.node, sourceTarget.id);
    assert.equal(hiddenTarget.resolution, 'unresolved');
    assert.equal(hiddenTarget.target, undefined);
    assert.equal(exposedTarget.resolution, 'resolved');
    assert.equal(childPrivate.resolution, 'unresolved');
    assert.equal(childPrivate.target, undefined);
    assert.equal(childPublic.resolution, 'resolved');
    assert.equal(descendant.resolution, 'resolved');
});

test('Rust cross-file paths validate missing terminals and resolve super imports', async () => {
    const result = await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': [
            'mod parent;',
            'use crate::parent::missing;',
            'fn main() { parent::private_target(); parent::public_target(); missing(); }',
            ''
        ].join('\n'),
        'src/parent.rs': [
            'fn private_target() {}',
            'pub fn public_target() {}',
            'mod child;',
            ''
        ].join('\n'),
        'src/parent/child.rs': [
            'use super::private_target;',
            'fn call() { private_target(); super::private_target(); }',
            ''
        ].join('\n')
    });
    const root = result.documents['src/lib.rs'];
    const child = result.documents['src/parent/child.rs'];
    const missingImport = sites(root, 'import').find(site => site.name === 'crate::parent::missing');
    const missingCall = sites(root, 'call').find(site => site.name === 'missing');
    const privateCall = sites(root, 'call').find(site => site.name === 'parent::private_target');
    const publicCall = sites(root, 'call').find(site => site.name === 'parent::public_target');
    const childImport = sites(child, 'import').find(site => site.name === 'super::private_target');
    const childCalls = sites(child, 'call');

    assert.equal(missingImport.resolution, 'unresolved');
    assert.equal(missingImport.target, undefined);
    assert.equal(missingCall.resolution, 'unresolved');
    assert.equal(privateCall.resolution, 'unresolved');
    assert.equal(privateCall.target, undefined);
    assert.equal(publicCall.resolution, 'resolved');
    assert.equal(childImport.resolution, 'resolved');
    assert.equal(childImport.target.file, 'src/parent.rs');
    assert.equal(childCalls.find(site => site.name === 'private_target').resolution, 'resolved');
    assert.equal(childCalls.find(site => site.name === 'super::private_target').resolution, 'resolved');
});

test('Rust imports are visible only in their declaring module scope', async () => {
    const result = await analyzeParserDependencies({
        'Cargo.toml': '[package]\nname = "demo"\n',
        'src/lib.rs': [
            'mod foo { pub fn target() {} }',
            'mod one { use crate::foo::target; fn only_one() { target(); } mod nested { fn not_inherited() { target(); } } }',
            'mod two { fn only_two() { target(); } }',
            ''
        ].join('\n')
    });
    const calls = sites(result.documents['src/lib.rs'], 'call').filter(site => site.name === 'target');
    const one = calls.find(site => site.owner.startsWith('only_one@'));
    const nested = calls.find(site => site.owner.startsWith('not_inherited@'));
    const two = calls.find(site => site.owner.startsWith('only_two@'));

    assert.equal(one.resolution, 'resolved');
    assert.equal(nested.resolution, 'unresolved');
    assert.equal(nested.target, undefined);
    assert.equal(two.resolution, 'unresolved');
    assert.equal(two.target, undefined);
});

test('producer identifies pinned dependency grammars', async () => {
    const result = await analyzeParserDependencies({ 'a.go': 'package p\n' });
    assert.match(result.producer, /go@0\.25\.0#9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7/);
    assert.match(result.producer, /rust@0\.24\.0#f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57/);
    assert.match(result.producer, /mojo@e5905c480b9ebbeb4195032805781a5e535547f7#b5bdf5a4e16caced273927cec4ebfa4991c737f02e04a50487a61f08139c26f2/);
});
