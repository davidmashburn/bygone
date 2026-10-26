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
- `eager` distinguishes ordinary imports/require from `deferred` dynamic imports.
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
Package-based config extension and bundler-specific resolution may be unsupported.
Project references do not provide symbol binding or build output reconstruction.

Limits apply per snapshot: 2,000 source/config files, 1 MiB per file, 16 MiB total
input and 20,000 dependency/initialization records. JSON files share the input
budget and are read first for config/package metadata. Only UTF-8 text is parsed.
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

Runtime trace ingestion, resolved symbol/call graphs and visual graph layout are
later slices. No workload is run to generate this evidence.
