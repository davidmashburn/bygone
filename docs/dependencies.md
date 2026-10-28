# Dependency evidence

The Node CLI (npm installation or `node bin/bygone.js` in a source checkout)
compares JS/TS module dependencies at the merge base and head of a committed
review range:

```sh
bygone dependencies HEAD --base main
bygone dependencies HEAD --base main --json
bygone dependencies HEAD --base main --output dependencies.json
bygone tour context HEAD --base main --dependencies --output context.json
```

The text report lists added/removed module edges and direct, unchanged consumers
of changed files. Each site includes a `bygone://` link to its committed source.
JSON includes both bounded snapshot graphs, potential initialization calls and
constructors, diagnostics, and exact evidence coordinates. Ordinary tour context
generation is unchanged. The desktop and VS Code interfaces do not yet have a
graph view; these commands use the Node CLI rather than the desktop launcher.

## Reading an edge

Relationship, phase, and loading are separate fields. Static evidence can describe
initialization or later invocation; it is not a runtime trace.

- `import`, `reexport`, `require`, and `dynamic-import` describe syntax.
- `type` marks explicitly type-only dependencies and dependencies in declaration files. `module-init` marks syntax
  evaluated while a module initializes; a lazy-loaded module can initialize much
  later than process startup. `invocation` marks function/callback bodies.
  `unknown` retains sites where the extractor cannot assign a phase safely.
- `eager` distinguishes ordinary imports/require from `deferred` dynamic imports and namespace `import defer` declarations. Deferred namespace evaluation has `unknown` phase because namespace use determines when evaluation occurs.
  A dynamic import at top level is still labeled `module-init`. A `require` inside
  a function is `invocation` even though the require operation itself is eager.
- `resolution: resolved` means the TypeScript resolver found a committed target
  under the selected compiler options. It does not prove execution, runtime loader
  equivalence, or the identity of a shadowable `require` binding.
- `unresolved`, `computed`, and `invalid-config` preserve unknown targets. Builtins,
  external packages, and computed specifiers commonly remain unresolved.

Potential initialization calls are syntax sites, not inferred function-call
edges. Registration calls can appear here; their callback bodies are classified
separately. IIFE bodies are conservatively labeled invocation with a diagnostic.
Instance field initializers have unknown timing; static fields and class static
blocks inherit the enclosing evaluation phase. Conditions are not evaluated.
Non-explicit type import elision and transpiler-specific emission are not modeled.

## Historical resolution and coverage

Both graphs are built from Git tree/blob objects at immutable OIDs. Dirty files,
installed packages, symlink targets, compiler plugins and target code are never
read or executed for resolution. The nearest committed `tsconfig.json` (or
`jsconfig.json`) supplies compiler options, including relative `extends`, `baseUrl`
and `paths`. Missing/invalid config is diagnosed. Without a config, analysis uses
TypeScript's Node-style resolution with JavaScript enabled. The report records
the analyzer's TypeScript version; it need not match the target project's compiler.
The dependency analyzer uses an isolated TypeScript 5.9.3 parser/resolver (without changing Strand or the extension compiler), including `bundler` resolution and modern syntax such as `using`. Package-based config extension and bundler runtime plugins remain outside scope. Malformed package metadata produces partial coverage; resolution that needs that metadata is `invalid-config`, without a fallback target.
Project references do not provide symbol binding or build output reconstruction.

Limits apply per snapshot: 2,000 source/config files, 1 MiB per file, 16 MiB total
input and 20,000 dependency/initialization records. Source-ancestor package.json, tsconfig.json and jsconfig.json files, plus their relative config inheritance closure, share the input budget and are read first. Directory imports can load other required package metadata on demand through the same bounds. Unrelated JSON, package files and lockfiles do not consume this budget. Relative inheritance supports transitive and array parents within the same bounds. Only UTF-8 text is parsed.
The dependency analysis budget is 30 seconds, including standalone Git range
discovery and both snapshots. It is checked between parsing/resolution operations;
it is not a hard interrupt inside the parser. Tour context reuses its pinned range,
and its ordinary context generation is outside this budget. Git tree enumeration is
bounded to 16 MiB. Up to 1,000 diagnostics per snapshot are retained with an omitted
count. Programmatic callers may lower these limits.

`coverage` reports supported source candidates, indexed/omitted files, unresolved
edges and whether indexing completed within the supported scope. Configuration,
parser and scope diagnostics matter even when an endpoint was found. A resolved
target can itself be outside the indexed subset. Partial graphs produce provisional
deltas and consumer lists; missing edges never establish independence. Submodules,
non-JS/TS languages and installed `node_modules` are outside scope.

The delta compares module endpoints, relationship, phase and loading, aligning
Git-detected renames. Source spelling/location and repeated occurrences alone do
not constitute new module edges. When a module edge changes, all matching source
sites appear in the delta. Alias/config retargeting can change dependencies of an
unchanged file. Consumer lists are one hop and include type-only edges, with phases
retained so callers can filter them. They are not a transitive impact analysis.

Every source reference contains a commit OID, Git blob OID, repository-relative
path, UTF-16 half-open range, one-based line/column, and SHA-256 of the selected
UTF-8 text. Links are local to the repository that generated the report. Equal
base/head revisions and paths outside the deep-link grammar retain coordinates
without a link. No source content is embedded in the dependency report itself.

Runtime trace ingestion remains a later slice. The opt-in symbol/call graphs and
visual exports below use a separate schema. No workload is run to generate this evidence.

The [validation corpus and measured results](../scripts/dependency-benchmark/README.md)
cover labeled module edges, source evidence, bounded scale and pinned public
repositories. The historical baseline documents compatibility and metadata gaps; the follow-up validation records their fixes. Complete indexing is not proof that runtime
loading is valid.

## Multilingual symbol and call evidence

The opt-in version 2 report adds symbol nodes and individual dependency sites:

```sh
bygone dependencies HEAD --base main --graph --json --output dependencies.json
bygone dependencies HEAD --base main --html --output dependencies.html
bygone dependencies HEAD --base main --mermaid --output dependencies.mmd
```

`--html` and `--mermaid` imply `--graph`. The original command and tour-context
integration continue to produce the version 1 JS/TS module report described
above. The two versions have different schemas; consumers should check
`version` and, for version 2, `kind: "dependency-evidence"`.

The HTML file works offline without a server or downloaded scripts. It offers
base/head selection, language, relationship and evaluation-phase filters,
folder/file/symbol views, search, direct-neighbor selection, and a table of source
sites. ELK layered layout routes relationships between nodes; fit, zoom, drag to
pan, and horizontal/vertical direction controls navigate the graph. Larger indexes
open at folder level; select a folder or file and inspect its contents to drill
down. References are hidden by default and can be selected with the relationship
filter. Repeated relationships are combined with site counts; selecting an edge
shows its original evidence. Source links open the pinned comparison in Bygone.

Mermaid exports the grouped head snapshot for embedding in other tools. It omits
references and within-group sites; unresolved sites remain in JSON and HTML. Both
views cap diagrams at 150 nodes and 300 aggregated relationships, disclose
truncation, and retain the selected node when its neighborhood exceeds the cap.
Use JSON for the entire bounded index. The HTML embeds ELK and its license, so it
needs no network access to render.
These views are CLI exports, not panels embedded in the desktop or extension.

### Evidence model

Each snapshot contains `nodes`, `sites`, `producers`, `diagnostics`, and
`coverage`. Nodes represent module initialization scopes, functions, or classes.
Sites distinguish `import`, `reexport`, `call`, `construct`, and `reference`:
passing a function as a callback is a reference, not evidence that it was called.

Every node and site has a repository-relative file, commit OID, blob OID,
half-open UTF-16 range, one-based line/column, source-slice SHA-256, and a Bygone
link when representable. IDs are local to a snapshot; they are not stable
symbol identities across edits. The version 2 report provides both snapshots,
without asserting that syntactic node IDs establish cross-revision identity.

A site records its owner, producer, evaluation phase, and resolution status.
`resolved` means that the adapter identified a source binding whose target
exists in the validated snapshot inventory. It does **not** prove execution,
reachability, or a runtime dispatch target. Ambiguous, unresolved, external,
and unsupported sites remain explicit. A resolved call must target a symbol;
resolving only its imported module is insufficient.

Phases are `module-init`, `invocation`, `type`, or `unknown`. Import-time work
and function-body work remain separate. This is not a transitive startup graph:
a top-level call does not automatically relabel its callee's body. Rust constant
evaluation and uncertain Mojo phases must not be interpreted as runtime
initialization. There is currently no runtime trace collection or ingestion.

### Adapter coverage

| Language | Producer and intended scope | Boundaries |
| --- | --- | --- |
| Python | Installed Python 3 AST parser in isolated mode; explicit source roots, imports, function/class scopes and direct bindings | No target imports or execution; dynamic attributes, callbacks, decorators and rebinding can prevent target resolution; parser syntax support follows installed Python |
| JS/TS | Bundled TypeScript compiler over in-memory committed files; symbol bindings, relative imports, direct calls and references | No installed libraries, bundler execution, or runtime dispatch proof; the version 1 module report remains available for its separate configuration-aware import analysis |
| Go | Pinned Tree-sitter syntax, imports and conservative source bindings | No compiler/type checking, build-tag selection, interface dispatch, or generated code |
| Rust | Pinned Tree-sitter syntax, modules/use sites, visible direct bindings, and `self`/`super` paths | No Cargo builds, cfg evaluation, macro expansion, or trait-dispatch proof |
| Mojo | Pinned experimental grammar, imports and conservative source bindings | Grammar-version-specific syntax; uncertain evaluation phases and dispatch remain explicit |

Python defaults to repository root and `src` as import roots. Specify all
project roots explicitly when that layout differs; repeated options replace
the defaults. The report records them in `configuration.pythonRoots`:

```sh
bygone dependencies --base main --graph --python-root . --python-root services/api
```

Adapters receive only bounded, committed source/metadata inputs. Python requires
`python3` on PATH; Go, Rust, and Mojo use shipped WASM grammars and require no
language toolchain. Missing parsers, malformed sources, invalid adapter ranges,
encoding failures and exhausted budgets produce diagnostics and partial
coverage. Unresolved targets do not by themselves mean a file was unindexed;
check both `indexComplete` and `unresolvedSites`. No graph is proof that two
components are independent.

The index shares the 20,000-record snapshot cap across declarations and sites.
Declarations are inventoried first, round-robin across files, then imports,
reexports, calls and constructions receive priority over references. Site
allocation also distributes space across files. Exhausting any budget still
produces partial coverage: `indexedFiles` counts complete declaration inventories,
while `indexComplete: false` and `record-budget` diagnostics can indicate omitted
sites even when every file has declarations.

Whole-repository analysis can also exhaust the shared 30-second analysis budget
before both revisions finish. Each revision reports its own coverage and adapter
diagnostics; use a narrower scope when either side is incomplete.

Use repeated `--scope` options to analyze selected repository-relative files or
directories. This opts into the version 2 graph and applies to both revisions:

```sh
bygone dependencies --base main --scope src --scope cli --html --output graph.html
```

Scopes match exact files or directory boundaries, not globs. `.` selects the whole
repository; no scopes is also whole-repository analysis. The report records the
normalized selection in `configuration.scopes`. Coverage counts describe that
selection only. Source targets outside it are not indexed, so a scoped report
cannot establish independence from the rest of the repository. Relevant ancestor
metadata remains available within the same file/byte budgets. A scope matching
no source files produces an empty inventory.
