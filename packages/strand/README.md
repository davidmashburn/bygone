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

## Source references

Strand also pins and follows exact source references. These operations are
available from the package root and from `bygone-strand/source-references`; the
subpath includes TypeScript declarations.

```js
const { pinSourceRef, resolveSourceRef, relocateSourceRefs } = require('bygone-strand/source-references');
const before = { revision: 'snapshot:1', files: { 'a.js': 'function count() { return 1; }' } };
const after = { revision: 'snapshot:2', files: { 'b.js': before.files['a.js'] } };
const ref = pinSourceRef(before, 'a.js', 0, before.files['a.js'].length);
const destination = pinSourceRef(after, 'b.js', 0, after.files['b.js'].length);
// This example explicitly accepts the whole-declaration pair. Production callers
// must select accepted correspondence and validate it against their snapshots.
const [transition] = relocateSourceRefs([ref], before, after, [{ before: ref, after: destination }]);
resolveSourceRef(transition.after, after); // { status: 'valid', text: ... }
```

`parseSourceRef(unknown)` validates the interchange shape. A reference contains an
opaque revision ID, relative path, half-open UTF-16 range, and SHA-256 digest of
the source slice encoded as UTF-8. Snapshot IDs must identify immutable contents
within the host's scope; Git IDs and repository identity are host concerns.

`resolveSourceRef` reports valid or broken evidence. `relocateSourceRefs` returns
one transition per input reference: unchanged, relocated, changed, or unresolved.
An unchanged whole file permits carrying a reference forward; otherwise only an
exact match to a supplied pair's complete source endpoint can follow the pair.
It does not search for similar text or infer subrange mappings. An unresolved
transition retains the historical reference and has no destination. Caller
objects are not mutated.

Malformed inputs throw `TypeError`. Resolution and relocation recheck ranges and
digests against supplied snapshots; relocation rejects duplicate source or
destination endpoints and requires distinct revision IDs. This establishes
endpoint validity, not that a supplied correspondence is correct. The host owns
pair acceptance, snapshot authenticity, and cross-repository scope. The existing
snapshot input ceilings apply; relocation also enforces the combined comparison
budget and a maximum of `LIMITS.maxRecords` references and pairs.

Requirements, test executions, review decisions, baseline retention, and Bygone
artifact validation remain outside Strand. A valid or relocated reference says
nothing about behavior preservation, requirement fulfillment, or review approval.

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
