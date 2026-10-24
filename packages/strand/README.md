# Bygone Strand

A private, reusable Node package for bounded source declaration correspondence.
It takes path-to-source snapshot maps. It does not read Git, load Bygone artifacts,
render a UI, or require Java. Publishing is deliberately disabled.

```js
const { inventorySnapshot, matchStrand } = require('bygone-strand');
const before = { 'old.js': 'function total(rows) { return rows.length + 1; }' };
const after = { 'new.js': 'function count(rows) { return rows.length + 2; }' };
const inventories = {
    before: inventorySnapshot(before, 'before', { strandFeatures: true }),
    after: inventorySnapshot(after, 'after', { strandFeatures: true })
};
const evidence = matchStrand(before, after, inventories);
```

`inventorySnapshot(files, side, options)` returns exact UTF-16, half-open ranges,
source digests, parser diagnostics, and syntax exclusions. Python currently uses
an isolated CPython subprocess (`python3` or `options.python`).
Invalid or over-budget snapshot maps throw a `TypeError` with the input reason.
Input ceilings are 50 paths, 1 MiB per file, and 4 MiB total per comparison;
configured analysis input limits can lower these ceilings. Parser timeout/output overrides
must be positive safe integers and are capped at their defaults (30 seconds for
Tree-sitter, 10 seconds for Python, 16 MiB output). Invalid parser options mark
affected documents unavailable with diagnostics. The public matcher also checks
the combined snapshot input budget before computing candidates.
`matchStrand(before, after, inventories, limits)` returns one-to-one candidate
mappers, ambiguous groups, rejection diagnostics, processed paths and status.
Its output is evidence, not proof of behavior preservation or a validated Bygone
artifact. The caller must validate endpoints against the supplied source.

JS/TS and Python implementations are preserved behind the package boundary.
Python stubs have inventory/exact coverage only. Candidate, token, output and
wall-clock budgets remain finite. No binding or type resolution, extract/inline,
or cross-language matches are claimed. The legacy analysis script entry points
remain compatible. Run `npm run test:strand` from the repository root.

The shared Tree-sitter frontend uses pinned `web-tree-sitter` WebAssembly in a
bounded Node subprocess. Grammars are local, hash-checked assets; there are no
runtime downloads or native addons. The subprocess owns async initialization
and tree disposal. JS/TS and CPython retain their existing frontends. Adapter
features share the same bounded matching and ambiguity rules. Language and
explicit receiver/implementation scope identities constrain both inferred and
independent exact matches.

Java supports named classes, records, interfaces, enums, annotation types,
constructors, methods, and single-declarator fields/constants. Local variable
bindings, anonymous classes/lambdas, initializer blocks, module directives, and
multi-declarator fields are explicitly excluded. This is syntax-based
correspondence; overload/type/binding resolution is not provided.

Go supports functions, receiver methods, named types/aliases, interface methods,
struct fields, and single-name package constants/variables. Receiver identity
normalizes pointers and generic arguments without resolving types. Receiver
type renames are not inferred. Blank identifiers, local bindings/types, embedded
fields, and multi-name specs are excluded.

Rust supports functions, modules, structs, enums, traits, impl blocks and their
methods/associated types, type aliases, constants and statics. Outer attributes
are included in declaration ranges and features. Impl/trait identities are
conservative: receiver/trait renames are not inferred across owners. Fields,
enum variants, closures, macro definitions and expansions are not inventoried
as separate symbols; macro/closure exclusions are reported. No crate or name
resolution is performed.

Mojo support is experimental and pinned to a community grammar. It supports
`.mojo` and `.🔥`, current `def` functions, generic structs, traits, experimental `__enum`,
methods, decorators, aliases (including parameterized `comptime`) and simple module/struct bindings. The pinned
grammar does not cover legacy `fn` syntax. Callable-local aliases/types,
local/destructured bindings, lambdas and Python-style `class` recovery productions are excluded.
Named nested functions are inventoried under their callable owner. A parse
error makes the whole document unavailable for correspondence. Grammar
acceptance is not a Mojo compiler check; compiler versions and real-world
syntax beyond the synthetic fixtures have not been qualified.

C# supports `.cs` block/file-scoped namespaces, named classes/structs/interfaces/
records/enums/delegates, constructors, methods, properties, enum members and
single-declarator fields. Attributes stay in declaration ranges. Namespace
identity is strict; repeated namespace regions can leave moved descendants
ambiguous. Compiler overload/partial-type resolution is absent.
Events, indexers, operators/conversions, destructors, local functions/bindings,
anonymous syntax, top-level statements and preprocessor conditionals are excluded.

Ruby supports `.rb` named classes/modules, constants, top-level private Object
methods, instance methods, and `self` singleton methods (including
`class << self`). Instance and singleton scopes remain distinct. Reopened classes are separate inventory declarations;
no runtime class merging or method lookup is attempted. Dynamic receivers,
metaprogrammed definitions, anonymous blocks and callable-local declarations/
bindings are excluded.

PHP supports `.php` named bracketed/unbracketed namespaces, classes/interfaces/
traits/enums, functions/methods, enum cases, and single-name properties/constants.
Anonymous classes/closures, promoted or hooked properties, multiple properties/
constants, callable-local declarations and anonymous global namespace blocks
are excluded. Namespace identity is strict, and repeated namespace regions can
leave moved descendants ambiguous. No autoload, trait composition or binding resolution is
performed.

C supports `.c` functions/prototypes, named structs/unions/enums and their
fields/enumerators, typedefs, and single-name globals. Local bindings/types,
multiple declarators, complex function pointers and standalone anonymous
aggregates are excluded. Aggregates inside typedefs are retained in the typedef
slice without separately inventoried fields. All preprocessor subtrees, including
conditional branches, are excluded: macros are not expanded. Ambiguous `.h` headers are not assigned to
C or C++. Field/enumerator owner identities stay strict across owner renames.

Lua supports `.lua` named global/local functions, nested named functions, and
static dot/colon table methods. Local/global and dot/colon identities are distinct;
member ownership must stay the same. Assignment bindings, anonymous functions
and dynamic receivers are excluded; table assignments are not resolved.

Adding another Tree-sitter language requires a pinned grammar/hash/license, a
small declaration adapter, and tests for ranges, edited matches, owner isolation,
invalid input and ambiguity. The shared matcher and Bygone artifact format stay
the same; a grammar alone does not define trustworthy declaration ownership.
