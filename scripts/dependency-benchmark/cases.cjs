'use strict';

// These labels intentionally project only the public edge fields. Source
// positions, digests, and Git evidence are not part of the benchmark oracle.
function edge(file, specifier, relationship, phase, loading, resolution, target) {
    return {
        file,
        ...(specifier === undefined ? {} : { specifier }),
        relationship,
        phase,
        loading,
        resolution,
        ...(target === undefined ? {} : { target })
    };
}

const cases = [
    {
        id: 'static-type-mixed-and-side-effect',
        before: {
            'src/api.d.ts': [
                'import { runtimeValue } from "./runtime";',
                'export { runtimeValue } from "./runtime";'
            ].join('\n'),
            'src/entry.ts': [
                'import "./polyfill";',
                'import type { User } from "./types";',
                'import { type UserId, runtimeValue } from "./runtime";',
                'import { type Shape } from "./types";',
                'export {} from "./side";',
                'export type { User } from "./types";',
                'export { type RuntimeType, runtimeValue as forwarded } from "./runtime";',
                'type Remote = import("external-types").Remote;',
                'export const value: User = runtimeValue;'
            ].join('\n'),
            'src/polyfill.ts': 'export {};',
            'src/runtime.ts': [
                'export type UserId = string;',
                'export type RuntimeType = number;',
                'export const runtimeValue = 1;'
            ].join('\n'),
            'src/side.ts': 'export {};',
            'src/types.ts': [
                'export interface User { id: string; }',
                'export type Shape = { x: number };'
            ].join('\n')
        },
        after: {
            'src/api.d.ts': [
                'import { runtimeValue } from "./runtime";',
                'export { runtimeValue } from "./runtime";'
            ].join('\n'),
            'src/entry.ts': [
                'import "./polyfill";',
                'import type { User } from "./types";',
                'import { type UserId, runtimeValue } from "./runtime";',
                'import { type Shape } from "./types";',
                'export {} from "./side";',
                'export type { User } from "./types";',
                'export { type RuntimeType, runtimeValue as forwarded } from "./runtime";',
                'type Remote = import("external-types").Remote;',
                'export const value: User = runtimeValue;'
            ].join('\n'),
            'src/polyfill.ts': 'export {};',
            'src/runtime.ts': [
                'export type UserId = string;',
                'export type RuntimeType = number;',
                'export const runtimeValue = 2;'
            ].join('\n'),
            'src/side.ts': 'export {};',
            'src/types.ts': [
                'export interface User { id: string; }',
                'export type Shape = { x: number };'
            ].join('\n')
        },
        expected: [
            edge('src/api.d.ts', './runtime', 'import', 'type', 'eager', 'resolved', 'src/runtime.ts'),
            edge('src/api.d.ts', './runtime', 'reexport', 'type', 'eager', 'resolved', 'src/runtime.ts'),
            edge('src/entry.ts', './polyfill', 'import', 'module-init', 'eager', 'resolved', 'src/polyfill.ts'),
            edge('src/entry.ts', './types', 'import', 'type', 'eager', 'resolved', 'src/types.ts'),
            edge('src/entry.ts', './runtime', 'import', 'module-init', 'eager', 'resolved', 'src/runtime.ts'),
            // This second type edge is a distinct source site and must count.
            edge('src/entry.ts', './types', 'import', 'type', 'eager', 'resolved', 'src/types.ts'),
            edge('src/entry.ts', './side', 'reexport', 'module-init', 'eager', 'resolved', 'src/side.ts'),
            edge('src/entry.ts', './types', 'reexport', 'type', 'eager', 'resolved', 'src/types.ts'),
            edge('src/entry.ts', './runtime', 'reexport', 'module-init', 'eager', 'resolved', 'src/runtime.ts'),
            edge('src/entry.ts', 'external-types', 'dynamic-import', 'type', 'deferred', 'unresolved')
        ],
        reviewTask: {
            question: 'Which HEAD edges represent runtime module initialization, and which are only type evidence?',
            expectedAnswer: 'The polyfill import, mixed runtime import, empty re-export, and mixed runtime re-export are module-init edges. Explicit type imports/exports, both declaration-file sites, and the import type query are type-phase evidence; the import type query is deferred and unresolved.',
            baselineMethod: 'Read entry.ts and api.d.ts in full; a diff of runtime.ts alone omits their unchanged imports and re-exports.',
            graphContribution: 'Separates runtime-facing module edges from type-only and declaration-file dependencies while preserving side effects and repeated sites.',
            limitation: 'It does not model type elision, emitted JavaScript, or whether a resolved module is executed.'
        }
    },

    {
        id: 'cjs-require-lazy-and-computed',
        before: {
            'src/config.ts': 'export const config = {};',
            'src/feature.ts': 'export const feature = true;',
            'src/loader.ts': [
                'const config = require("./config");',
                'const worker = require("./worker");',
                'function load() { return require("./worker"); }',
                'const lazy = () => import("./feature");',
                'const computed = import("./" + name);',
                'const unknown = require(moduleName);',
                'const external = require("external-runtime");',
                'module.exports = { config, worker, load, lazy, computed, unknown, external };'
            ].join('\n'),
            'src/worker.ts': 'export const worker = true;'
        },
        after: {
            'src/config.ts': 'export const config = {};',
            'src/feature.ts': 'export const feature = true;',
            'src/loader.ts': [
                'const config = require("./config");',
                'const worker = import("./worker");',
                'function load() { return import("./worker"); }',
                'const lazy = () => import("./feature");',
                'const computed = import("./" + name);',
                'const unknown = require(moduleName);',
                'const external = require("external-runtime");',
                'module.exports = { config, worker, load, lazy, computed, unknown, external };'
            ].join('\n'),
            'src/worker.ts': 'export const worker = true;'
        },
        expected: [
            edge('src/loader.ts', './config', 'require', 'module-init', 'eager', 'resolved', 'src/config.ts'),
            edge('src/loader.ts', './worker', 'dynamic-import', 'module-init', 'deferred', 'resolved', 'src/worker.ts'),
            edge('src/loader.ts', './worker', 'dynamic-import', 'invocation', 'deferred', 'resolved', 'src/worker.ts'),
            edge('src/loader.ts', './feature', 'dynamic-import', 'invocation', 'deferred', 'resolved', 'src/feature.ts'),
            edge('src/loader.ts', undefined, 'dynamic-import', 'module-init', 'deferred', 'computed'),
            edge('src/loader.ts', undefined, 'require', 'module-init', 'eager', 'computed'),
            edge('src/loader.ts', 'external-runtime', 'require', 'module-init', 'eager', 'unresolved')
        ],
        added: [
            edge('src/loader.ts', './worker', 'dynamic-import', 'module-init', 'deferred', 'resolved', 'src/worker.ts'),
            edge('src/loader.ts', './worker', 'dynamic-import', 'invocation', 'deferred', 'resolved', 'src/worker.ts')
        ],
        removed: [
            edge('src/loader.ts', './worker', 'require', 'module-init', 'eager', 'resolved', 'src/worker.ts'),
            edge('src/loader.ts', './worker', 'require', 'invocation', 'eager', 'resolved', 'src/worker.ts')
        ]
    },

    {
        id: 'alias-retarget-unchanged-consumer',
        before: {
            'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@shared":["src/old.ts"]}}}',
            'consumer.ts': 'import { value } from "@shared";\nexport const result = value;',
            'src/new.ts': 'export const value = "new";',
            'src/old.ts': 'export const value = "old";'
        },
        after: {
            'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@shared":["src/new.ts"]}}}',
            'consumer.ts': 'import { value } from "@shared";\nexport const result = value;',
            'src/new.ts': 'export const value = "retargeted";',
            'src/old.ts': 'export const value = "old";'
        },
        expected: [
            edge('consumer.ts', '@shared', 'import', 'module-init', 'eager', 'resolved', 'src/new.ts')
        ],
        added: [
            edge('consumer.ts', '@shared', 'import', 'module-init', 'eager', 'resolved', 'src/new.ts')
        ],
        removed: [
            edge('consumer.ts', '@shared', 'import', 'module-init', 'eager', 'resolved', 'src/old.ts')
        ],
        consumers: [
            edge('consumer.ts', '@shared', 'import', 'module-init', 'eager', 'resolved', 'src/new.ts')
        ],
        reviewTask: {
            question: 'Does the unchanged consumer remain independent when a committed path alias retargets its module?',
            expectedAnswer: 'No. The consumer has an added edge to src/new.ts and its old edge to src/old.ts is removed; because the consumer source is unchanged and the new target changed, it is a direct unchanged consumer in HEAD.',
            baselineMethod: 'Read the tsconfig diff, search for @shared imports, and inspect the selected old/new source files.',
            graphContribution: 'Shows that configuration changes can alter an unchanged file’s module edge and expose a one-hop consumer.',
            limitation: 'The consumer list is direct and one-hop; it is not symbol, transitive, or runtime impact analysis.'
        }
    },

    {
        id: 'nested-config-resolution',
        before: {
            'config/base.json': '{"compilerOptions":{"baseUrl":"..","paths":{"@lib":["src/root.ts"]}}}',
            'root-consumer.ts': 'import "@lib";',
            'src/nested.ts': 'export const nested = 1;',
            'src/root.ts': 'export const root = 1;',
            'sub/index.ts': 'import "@lib";',
            'sub/tsconfig.json': '{"compilerOptions":{"baseUrl":"..","paths":{"@lib":["src/nested.ts"]}}}',
            'tsconfig.json': '{"extends":"./config/base.json"}'
        },
        after: {
            'config/base.json': '{"compilerOptions":{"baseUrl":"..","paths":{"@lib":["src/root.ts"]}}}',
            'root-consumer.ts': 'import "@lib";',
            'src/nested.ts': 'export const nested = 2;',
            'src/root.ts': 'export const root = 1;',
            'sub/index.ts': 'import "@lib";',
            'sub/tsconfig.json': '{"compilerOptions":{"baseUrl":"..","paths":{"@lib":["src/nested.ts"]}}}',
            'tsconfig.json': '{"extends":"./config/base.json"}'
        },
        expected: [
            edge('root-consumer.ts', '@lib', 'import', 'module-init', 'eager', 'resolved', 'src/root.ts'),
            edge('sub/index.ts', '@lib', 'import', 'module-init', 'eager', 'resolved', 'src/nested.ts')
        ],
        reviewTask: {
            question: 'Which committed alias configuration governs each import in this snapshot?',
            expectedAnswer: 'root-consumer.ts inherits config/base.json through the root tsconfig and resolves to src/root.ts. sub/index.ts uses the nearer sub/tsconfig.json and resolves to src/nested.ts.',
            baselineMethod: 'Search for @lib imports and walk parent directories to the nearest config, then follow relative extends and paths by hand.',
            graphContribution: 'Preserves configuration scope boundaries instead of treating a root alias as global.',
            limitation: 'Unsupported package-based config extension, plugins, and project-reference output reconstruction remain outside the graph.'
        }
    },

    {
        id: 'nodenext-explicit-js-substitution',
        before: {
            'entry.ts': 'import "./lib";\nimport "./lib.js";',
            'lib.ts': 'export const value = 1;',
            'package.json': '{"type":"module"}',
            'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}'
        },
        after: {
            'entry.ts': 'import "./lib";\nimport "./lib.js";',
            'lib.ts': 'export const value = 2;',
            'package.json': '{"type":"module"}',
            'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}'
        },
        expected: [
            edge('entry.ts', './lib', 'import', 'module-init', 'eager', 'unresolved'),
            edge('entry.ts', './lib.js', 'import', 'module-init', 'eager', 'resolved', 'lib.ts')
        ],
        reviewTask: {
            question: 'What can the HEAD graph say about the two NodeNext imports?',
            expectedAnswer: 'The extensionless ESM import is unresolved, while the explicit .js specifier resolves to the committed lib.ts source through TypeScript substitution; both are eager module-init syntax sites.',
            baselineMethod: 'Read package.json, tsconfig.json and entry.ts, then inspect lib.ts and apply NodeNext extension rules.',
            graphContribution: 'Makes explicit-extension requirements and .js-to-.ts source resolution visible in the dependency evidence.',
            limitation: 'Resolution is not proof that the runtime loader, transpiler, or emitted artifact will accept or execute the edge.'
        }
    },

    {
        id: 'cycle-registration-callback-phases',
        expectedInitialization: [
            { file: 'a.ts', kind: 'call', phase: 'module-init', text: 'register("plugin", () => import("./plugin"))' },
            { file: 'a.ts', kind: 'call', phase: 'module-init', text: 'register("legacy", () => require("./worker"))' }
        ],
        before: {
            'a.ts': [
                'import { boot } from "./b";',
                'register("plugin", () => import("./plugin"));',
                'register("legacy", () => require("./worker"));',
                'export const start = () => boot();'
            ].join('\n'),
            'b.ts': [
                'import { start } from "./a";',
                'export function boot() { return start; }'
            ].join('\n'),
            'plugin.ts': 'import "./a";\nexport const plugin = true;',
            'worker.ts': 'export const worker = true;'
        },
        after: {
            'a.ts': [
                'import { boot } from "./b";',
                'register("plugin", () => import("./plugin"));',
                'register("legacy", () => require("./worker"));',
                'export const start = () => boot();'
            ].join('\n'),
            'b.ts': [
                'import { start } from "./a";',
                'export function boot() { return start; }'
            ].join('\n'),
            'plugin.ts': 'import "./a";\nexport const plugin = false;',
            'worker.ts': 'export const worker = true;'
        },
        expected: [
            edge('a.ts', './b', 'import', 'module-init', 'eager', 'resolved', 'b.ts'),
            edge('a.ts', './plugin', 'dynamic-import', 'invocation', 'deferred', 'resolved', 'plugin.ts'),
            edge('a.ts', './worker', 'require', 'invocation', 'eager', 'resolved', 'worker.ts'),
            edge('b.ts', './a', 'import', 'module-init', 'eager', 'resolved', 'a.ts'),
            edge('plugin.ts', './a', 'import', 'module-init', 'eager', 'resolved', 'a.ts')
        ],
        reviewTask: {
            question: 'Which dependencies are statically visible in the cycle, and which registration dependencies wait for callback invocation?',
            expectedAnswer: 'The a-to-b, b-to-a, and plugin-to-a imports are module-init edges. The plugin dynamic import is deferred invocation evidence, and the worker require is eager syntax inside an invocation callback; registration syntax alone does not promote either callback body to module-init.',
            baselineMethod: 'Read a.ts, b.ts and plugin.ts together; distinguish the registration call from each callback body and follow their imports manually.',
            graphContribution: 'Shows cycles and registration callback dependencies in one graph while keeping static phase and lazy loading distinct.',
            limitation: 'It does not prove registration occurs, callbacks run, or that a cycle is safe at runtime.'
        }
    },

    {
        id: 'invalid-compiler-config',
        before: {
            'src/dep.ts': 'export const value = 1;',
            'src/entry.ts': [
                'import "./dep";',
                'const lazy = import(moduleName);',
                'const required = require("./dep");'
            ].join('\n'),
            'tsconfig.json': '{"compilerOptions":{"moduleResolution":"node"}}'
        },
        after: {
            'src/dep.ts': 'export const value = 1;',
            'src/entry.ts': [
                'import "./dep";',
                'const lazy = import(moduleName);',
                'const required = require("./dep");'
            ].join('\n'),
            'tsconfig.json': '{"compilerOptions":{"moduleResolution":"not-a-mode"}}'
        },
        expected: [
            edge('src/entry.ts', './dep', 'import', 'module-init', 'eager', 'invalid-config'),
            edge('src/entry.ts', undefined, 'dynamic-import', 'module-init', 'deferred', 'computed'),
            edge('src/entry.ts', './dep', 'require', 'module-init', 'eager', 'invalid-config')
        ],
        added: [
            edge('src/entry.ts', './dep', 'import', 'module-init', 'eager', 'invalid-config'),
            edge('src/entry.ts', './dep', 'require', 'module-init', 'eager', 'invalid-config')
        ],
        removed: [
            edge('src/entry.ts', './dep', 'import', 'module-init', 'eager', 'resolved', 'src/dep.ts'),
            edge('src/entry.ts', './dep', 'require', 'module-init', 'eager', 'resolved', 'src/dep.ts')
        ],
        reviewTask: {
            question: 'What remains trustworthy when the committed compiler configuration is invalid?',
            expectedAnswer: 'The syntactic sites and their phase/loading labels remain visible. Literal target resolution is invalid-config with no target, while the computed dynamic import remains computed; target-dependent deltas should be treated as provisional and the snapshot is partial.',
            baselineMethod: 'Read the tsconfig diff and inspect entry.ts; recognize the invalid option before resolving its literal imports.',
            graphContribution: 'Prevents a broken config from being silently treated as a clean unresolved graph and preserves the distinction between computed and config-invalid sites.',
            limitation: 'The projected fixture does not include diagnostics or coverage; a code review must consult those report fields before drawing independence conclusions.'
        }
    },

    {
        id: 'invalid-package-config-falls-back-to-commonjs',
        kind: 'characterization',
        before: {
            'entry.ts': 'import "./lib";\nimport "./lib.js";',
            'lib.ts': 'export const value = 1;',
            'package.json': '{"type":"module"}',
            'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}'
        },
        after: {
            'entry.ts': 'import "./lib";\nimport "./lib.js";',
            'lib.ts': 'export const value = 2;',
            'package.json': '{"type":',
            'tsconfig.json': '{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext"}}'
        },
        expected: [
            edge('entry.ts', './lib', 'import', 'module-init', 'eager', 'resolved', 'lib.ts'),
            edge('entry.ts', './lib.js', 'import', 'module-init', 'eager', 'resolved', 'lib.ts')
        ],
        // The resolved module edge already existed through ./lib.js.
        added: [],
        removed: [
            edge('entry.ts', './lib', 'import', 'module-init', 'eager', 'unresolved')
        ],
        reviewTask: {
            question: 'How should a reviewer interpret a malformed package.json in this NodeNext snapshot?',
            expectedAnswer: 'The committed malformed package.json is read as an empty package object by the resolver, so the file falls back to CommonJS interpretation: the extensionless import resolves to lib.ts, and the explicit .js import also resolves to lib.ts.',
            baselineMethod: 'Read the package.json diff to detect malformed JSON; inspect the unchanged imports. The TypeScript fallback itself requires compiler knowledge.',
            graphContribution: 'Makes package-scope metadata an explicit cause of a module-edge retargeting.',
            limitation: 'The dependency report does not expose package-parser diagnostics for this fallback, so package metadata and coverage context must be reviewed separately.'
        }
    },

    {
        id: 'symbol-binding-change-same-module',
        before: {
            'consumer.ts': 'import { beforeName } from "./lib";\nexport const result = beforeName;',
            'lib.ts': 'export const beforeName = 1;'
        },
        after: {
            'consumer.ts': 'import { afterName } from "./lib";\nexport const result = afterName;',
            'lib.ts': 'export const afterName = 2;'
        },
        expected: [
            edge('consumer.ts', './lib', 'import', 'module-init', 'eager', 'resolved', 'lib.ts')
        ],
        added: [],
        removed: [],
        reviewTask: {
            question: 'What dependency change is visible when the imported symbol changes but the module endpoint stays the same?',
            expectedAnswer: 'No module-edge delta is visible: the consumer still has one eager module-init import of ./lib resolving to lib.ts. The changed binding names and exported declarations are outside this graph’s identity.',
            baselineMethod: 'Read the consumer.ts and lib.ts diffs: they directly reveal the changed imported and exported names.',
            graphContribution: 'Provides a control for the documented module-level limitation and prevents a same-module symbol edit from being scored as a new dependency.',
            limitation: 'The graph is not a resolved symbol or call graph and cannot show whether the new binding exists, is compatible, or is used.'
        }
    },

    {
        id: 'import-equals-and-declaration-file-edges',
        before: {
            'consumer.ts': 'import legacy = require("./legacy");\nexport const result = legacy;',
            'dep.ts': 'export const Value = 1;',
            'legacy.ts': 'import dep = require("./dep");\nexport = dep;',
            'types.d.ts': 'import { Value } from "./dep";\nexport { Value } from "./dep";'
        },
        after: {
            'consumer.ts': 'import legacy = require("./legacy");\nexport const result = legacy;',
            'dep.ts': 'export const Value = 2;',
            'legacy.ts': 'import dep = require("./dep");\nexport = dep;',
            'types.d.ts': 'import { Value } from "./dep";\nexport { Value } from "./dep";'
        },
        expected: [
            edge('consumer.ts', './legacy', 'require', 'module-init', 'eager', 'resolved', 'legacy.ts'),
            edge('legacy.ts', './dep', 'require', 'module-init', 'eager', 'resolved', 'dep.ts'),
            edge('types.d.ts', './dep', 'import', 'type', 'eager', 'resolved', 'dep.ts'),
            edge('types.d.ts', './dep', 'reexport', 'type', 'eager', 'resolved', 'dep.ts')
        ]
    }
];

cases.push({
    id: 'same-body-move-changes-relative-binding',
    before: {
        'old/reader.ts': 'import { value } from "./binding";\nexport function read() { return value; }',
        'old/binding.ts': 'export const value = 1;',
        'new/binding.ts': 'export const value = 2;'
    },
    after: {
        'new/reader.ts': 'import { value } from "./binding";\nexport function read() { return value; }',
        'old/binding.ts': 'export const value = 1;',
        'new/binding.ts': 'export const value = 2;'
    },
    expected: [edge('new/reader.ts', './binding', 'import', 'module-init', 'eager', 'resolved', 'new/binding.ts')],
    added: [edge('new/reader.ts', './binding', 'import', 'module-init', 'eager', 'resolved', 'new/binding.ts')],
    removed: [edge('old/reader.ts', './binding', 'import', 'module-init', 'eager', 'resolved', 'old/binding.ts')],
    reviewTask: {
        question: 'Does moving an identical reader preserve its imported value?',
        expectedAnswer: 'The source bytes are identical, but ./binding now targets new/binding.ts instead of old/binding.ts. The module edge changes even after Git rename alignment.',
        baselineMethod: 'Read the rename in the diff, expand ./binding relative to each directory, and inspect both binding files.',
        graphContribution: 'Exposes changed module context despite identical function and import text.',
        limitation: 'Does not resolve the value symbol or prove behavior equivalence.'
    }
});
module.exports = cases;
