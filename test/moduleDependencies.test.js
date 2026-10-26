const assert = require('node:assert/strict');
const test = require('node:test');

const { extractModuleDependencies } = require('../out/dependencyGraph.js');

function edgeSummary(source, edge) {
    return {
        specifier: edge.specifier,
        relationship: edge.relationship,
        phase: edge.phase,
        loading: edge.loading,
        slice: source.slice(edge.start, edge.end)
    };
}

test('classifies static imports, reexports, empty forms, and type import nodes', () => {
    const source = [
        'import "side-effect";',
        'import {} from "empty";',
        'import type { TypeOnly } from "type-only";',
        'import { type MixedType, Runtime } from "mixed";',
        'import { type OnlyType } from "only-type";',
        'export {} from "empty-reexport";',
        'export type { ExportType } from "export-type";',
        'export { type ExportOnly } from "export-only";',
        'export { type ExportMixedType, ExportRuntime } from "export-mixed";',
        'type Imported = import("type-package").Imported;'
    ].join('\n');

    const result = extractModuleDependencies('imports.ts', source);

    assert.deepEqual(result.edges.map(edge => edgeSummary(source, edge)), [
        { specifier: 'side-effect', relationship: 'import', phase: 'module-init', loading: 'eager', slice: 'import "side-effect";' },
        { specifier: 'empty', relationship: 'import', phase: 'module-init', loading: 'eager', slice: 'import {} from "empty";' },
        { specifier: 'type-only', relationship: 'import', phase: 'type', loading: 'eager', slice: 'import type { TypeOnly } from "type-only";' },
        { specifier: 'mixed', relationship: 'import', phase: 'module-init', loading: 'eager', slice: 'import { type MixedType, Runtime } from "mixed";' },
        { specifier: 'only-type', relationship: 'import', phase: 'type', loading: 'eager', slice: 'import { type OnlyType } from "only-type";' },
        { specifier: 'empty-reexport', relationship: 'reexport', phase: 'module-init', loading: 'eager', slice: 'export {} from "empty-reexport";' },
        { specifier: 'export-type', relationship: 'reexport', phase: 'type', loading: 'eager', slice: 'export type { ExportType } from "export-type";' },
        { specifier: 'export-only', relationship: 'reexport', phase: 'type', loading: 'eager', slice: 'export { type ExportOnly } from "export-only";' },
        { specifier: 'export-mixed', relationship: 'reexport', phase: 'module-init', loading: 'eager', slice: 'export { type ExportMixedType, ExportRuntime } from "export-mixed";' },
        { specifier: 'type-package', relationship: 'dynamic-import', phase: 'type', loading: 'deferred', slice: 'import("type-package").Imported' }
    ]);
    assert.deepEqual(result.effects, []);
    assert.deepEqual(result.diagnostics, []);
});

test('retains literal and computed require/import calls and supports import equals forms', () => {
    const source = [
        'const literal = require("literal");',
        'const computed = require(moduleName);',
        'function shadowed(require) { require("shadowed"); }',
        'const lazy = import("lazy");',
        'const dynamic = import(moduleName);',
        'import legacy = require("legacy");',
        'import type LegacyType = require("legacy-type");'
    ].join('\n');

    const result = extractModuleDependencies('calls.ts', source);

    assert.deepEqual(result.edges.map(edge => edgeSummary(source, edge)), [
        { specifier: 'literal', relationship: 'require', phase: 'module-init', loading: 'eager', slice: 'require("literal")' },
        { specifier: undefined, relationship: 'require', phase: 'module-init', loading: 'eager', slice: 'require(moduleName)' },
        { specifier: 'shadowed', relationship: 'require', phase: 'invocation', loading: 'eager', slice: 'require("shadowed")' },
        { specifier: 'lazy', relationship: 'dynamic-import', phase: 'module-init', loading: 'deferred', slice: 'import("lazy")' },
        { specifier: undefined, relationship: 'dynamic-import', phase: 'module-init', loading: 'deferred', slice: 'import(moduleName)' },
        { specifier: 'legacy', relationship: 'require', phase: 'module-init', loading: 'eager', slice: 'import legacy = require("legacy");' },
        { specifier: 'legacy-type', relationship: 'require', phase: 'type', loading: 'eager', slice: 'import type LegacyType = require("legacy-type");' }
    ]);
    assert.equal(result.diagnostics.filter(diagnostic => diagnostic.code === 'require-binding-ambiguous').length, 3);
});

test('keeps invocation and instance-field dependencies out of module initialization', () => {
    const source = [
        'require("top");',
        'new TopLevel();',
        'function callback() { require("function"); }',
        'const arrow = () => import("arrow");',
        'run(() => require("callback"));',
        'class Example {',
        '    instance = require("instance");',
        '    static value = require("static-field");',
        '    static { require("static-block"); }',
        '    method() { require("method"); }',
        '}',
        '(function () { require("iife"); })();'
    ].join('\n');

    const result = extractModuleDependencies('phases.ts', source);
    const phases = new Map(
        result.edges
            .filter(edge => edge.relationship === 'require' || edge.relationship === 'dynamic-import')
            .map(edge => [edge.specifier, edge.phase])
    );

    assert.equal(phases.get('top'), 'module-init');
    assert.equal(phases.get('function'), 'invocation');
    assert.equal(phases.get('arrow'), 'invocation');
    assert.equal(phases.get('callback'), 'invocation');
    assert.equal(phases.get('instance'), 'unknown');
    assert.equal(phases.get('static-field'), 'module-init');
    assert.equal(phases.get('static-block'), 'module-init');
    assert.equal(phases.get('method'), 'invocation');
    assert.equal(phases.get('iife'), 'invocation');

    assert.deepEqual(result.effects.map(effect => ({
        kind: effect.kind,
        slice: source.slice(effect.start, effect.end)
    })), [
        { kind: 'call', slice: 'require("top")' },
        { kind: 'construct', slice: 'new TopLevel()' },
        { kind: 'call', slice: 'run(() => require("callback"))' },
        { kind: 'call', slice: 'require("static-field")' },
        { kind: 'call', slice: 'require("static-block")' },
        { kind: 'call', slice: '(function () { require("iife"); })()' }
    ]);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'iife-phase-conservative'));
});

test('uses UTF-16 half-open spans and exposes parser diagnostics', () => {
    const source = '// 🧪\r\nconst dependency = require("slice");\r\n';
    const result = extractModuleDependencies('spans.ts', source);
    const edge = result.edges.find(candidate => candidate.specifier === 'slice');

    assert.ok(edge);
    const expectedSlice = 'require("slice")';
    const expectedStart = source.indexOf(expectedSlice);
    assert.equal(edge.start, expectedStart);
    assert.equal(edge.end, expectedStart + expectedSlice.length);
    assert.equal(source.slice(edge.start, edge.end), expectedSlice);
    assert.equal(edge.line, 2);
    assert.equal(edge.column, source.slice(source.indexOf('\r\n') + 2).indexOf('require') + 1);

    const malformed = extractModuleDependencies('broken.ts', 'import { from "broken";\nconst value = ;');
    assert.ok(malformed.diagnostics.some(diagnostic => diagnostic.code.startsWith('ts-')));
    assert.ok(malformed.diagnostics.some(diagnostic => diagnostic.start !== undefined));
});


test('default bindings prevent all-type classification and namespace aliases are not module edges', () => {
    const result = extractModuleDependencies('mixed.ts', 'import Default, { type Only } from "mixed";\nimport Alias = Namespace.Member;');
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].specifier, 'mixed');
    assert.equal(result.edges[0].phase, 'module-init');
});


test('class definition work includes computed names and parameter decorators, not parameter defaults', () => {
    const source = 'class C { [require("name")](@decorate(require("dec")) arg = require("default")) {} }';
    const result = extractModuleDependencies('decorators.ts', source);
    const phases = new Map(result.edges.map(edge => [edge.specifier, edge.phase]));
    assert.equal(phases.get('name'), 'module-init');
    assert.equal(phases.get('dec'), 'module-init');
    assert.equal(phases.get('default'), 'invocation');
});


test('declaration files describe types, never initialization work', () => {
    const result = extractModuleDependencies('api.d.ts', 'import { API } from "./api"; export { API } from "./api"; import Legacy = require("./legacy");');
    assert.equal(result.edges.length, 3);
    assert.ok(result.edges.every(edge => edge.phase === 'type'));
    assert.deepEqual(result.effects, []);
});
