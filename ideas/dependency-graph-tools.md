# Dependency graph tool evaluation

Assessment date: 2026-10-27. Implementation baseline:
`ee4a9790f3d13dad077b22328041a2e06599a2ba`. Research only; no Bygone runtime
dependency or implementation change. This extends [dependency graphs](dependency-graphs.md).

The [adapter and graph-view proposal](../plans/dependency-evidence-adapters.md)
develops the next slice into contract boundaries and acceptance criteria.

## Decision

Use a common evidence format with language-specific producers. Retain the
committed-source module graph, extend TypeScript through its existing compiler,
and evaluate SCIP as an optional semantic-reference input. Do not adopt a single
polyglot analyzer as the authoritative source of call edges yet.

This recommendation is **medium confidence**. Small executable tests support
the direction, but there is no representative cross-language accuracy benchmark.
Confidence is **high** in the specific failures and schema limitations below.
Corrected tool versions passing a broader fixture corpus, including initialization
and historical revisions, could change the producer choice.

The next useful implementation is a bounded graph view of existing module
evidence plus a TypeScript call/reference prototype. A new analyzer is not a
prerequisite for displaying what Bygone already knows.

## Candidates and evidence strength

| Candidate | Evidence in this assessment | Fit and material limitation |
| --- | --- | --- |
| Existing TypeScript 5.9.3 compiler | Executed binding probe; zero fixture diagnostics | Best immediate TS producer. Handles aliases, reexports, receiver methods and the tested dynamic import. A signature declaration can be a parameter type, not a concrete callee; dispatch and callback flow still need explicit modeling. |
| [cgg 0.11.2](https://github.com/NeuralNotwerk/cgg/releases/tag/v0.11.2) | Executed TS, Python and Go fixtures, minimal reproductions, relocation check, pinned Bygone source smoke; source inspected | Convenient polyglot call graph and direct rendering. Incorrect high-confidence Python edge, extra TS dynamic-import target, and omitted TS/Python top-level calls prevent authoritative adoption now. Useful optional exploratory producer. |
| [SCIP / scip-typescript](https://github.com/sourcegraph/scip-typescript) | Executed indexer 0.4.0, decoded with SCIP CLI 0.10.0; schema inspected | Strong interchange for definitions/references. Does not itself provide caller/callee edges or execution phase. Pair with syntax/containment analysis, revision provenance and coverage reporting. |
| [LSP call hierarchy](https://github.com/microsoft/language-server-protocol/blob/gh-pages/_specifications/lsp/3.18/language/callHierarchy.md) | Specification and VS Code TS adapter inspected; no server run | Actual incoming/outgoing-call interface with call-site ranges. Optional server capability, language-dependent completeness, live workspace state and no inherent Git binding. Good optional editor enrichment. |
| [dep-tree](https://github.com/gabotechs/dep-tree) | Source and release metadata inspected; not executed | Polyglot file dependencies for JS/TS, Python, Rust and Go. Local-file graph, no call relations or source-site locations in the inspected graph model. Useful import-graph baseline. |
| [Depends](https://github.com/multilang-depends/depends) | Source and release metadata inspected; not executed | File/method analysis with explicit binding passes; Java, C++, Ruby, Kotlin, Python, Go and POM in current registry. Inspected entity locations store lines only. Broad candidate, not proven best resolver. |
| [ENRE-ts](https://github.com/xjtu-enre/ENRE-ts) | Source and release metadata inspected; not executed | Rich entities, relations and source locations. Inspected resolver leaves subpath imports and built-ins TODO; no tsconfig aliases/package exports found there. ENRE is a family of language analyzers, not one validated universal producer. |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | Source/schema and release metadata inspected; not executed | Strong TS/JS module-graph comparator with dynamic/type-only flags and resolver ecosystem. Inspected output lacks symbol/call relations and import-site ranges. It does not answer the polyglot requirement. |
| [Joern](https://github.com/joernio/joern) | Official docs/release inspection only | Rich code-property-graph analysis and querying, with a much larger distribution/integration surface. Consider externally generated artifacts if deeper dataflow justifies it. |
| [CodeQL](https://github.com/github/codeql-cli-binaries/blob/main/README.md) | Official licensing/docs inspection only | Potential existing analysis input. CLI commercial-use constraints mean the MIT query repository is not evidence of unrestricted CLI redistribution/use. No default bundling recommendation. |

Maintenance snapshot from official repository/release APIs, checked 2026-10-27:

| Tool | Published release / activity | Declared license and packaging observation |
| --- | --- | --- |
| cgg | 0.11.2, 2026-10-23; repository created May 2026 | MIT and Apache license files shipped; Mac arm64 archive 41.2 MB including libraries |
| dep-tree | 0.23.4 and last source push, 2025-03-22 | MIT |
| Depends | 0.9.7, 2022-09-20; source pushed 2026-04-20 | MIT; current source capability may exceed published artifact |
| ENRE-ts | 0.4.3, 2024-01-09; source pushed 2025-09-30 | LGPL-2.1; README describes Node 16–18 and ongoing development |
| dependency-cruiser | Stable 18.7.0, 2026-10-19; source pushed 2026-10-26 | MIT |
| Joern | 4.0.666, 2026-10-27 | Apache-2.0; Mac arm64 archive 1.76 GB |

These are screening facts, not a transitive-license audit or a maintenance
guarantee. Archive sizes are downloads, not installed footprint or memory use.
Coregraph was also screened: MIT, latest 0.2.9 in June 2026, small binary and
claimed multi-language analysis; it was not executed or deeply source-reviewed,
so it is not promoted over tested candidates here.

## Executable findings

### cgg: useful resolution, but confidence labels are not accuracy guarantees

Ran `cgg FIXTURE -t json --no-entry-nodes --metrics AUDIT.json`, with a second
run adding `--reference-edges`. Disabling synthetic framework entry nodes kept
the test focused on extracted source relationships. Fixture programs were not
executed by the analysis. The release archive SHA-256 matched its GitHub asset
digest: `6fe77f87f5b57f6efd32421322f08cafc8b9db2d8b59f75d7b04a09733b488cc`.

- Ordinary import aliases, TS barrel reexports and receiver calls resolved in
  the tested cases. The Go fixture produced seven expected direct call edges,
  including `init`, and reference mode added its callback argument reference.
- Python shadowing produced a wrong **high-confidence** edge in both the larger
  fixture and this independent minimal reproduction:

  ```python
  # lib.py
  def target():
      return 1
  # main.py
  from lib import target as alias
  def shadow(alias):
      return alias()
  ```

  The argument owns `alias`; the result instead connected `shadow` to
  `lib.target`, using resolver `cross-file:imports`.
- In TS, `const m = await import('./lib.js'); return m.target()` produced both
  `lib.target` and an unrelated same-named `other.target` as medium-confidence
  targets. Reproduced with only those modules and the caller. This is an
  overapproximation, not an exact resolved call.
- Top-level TS and Python calls were absent from the graph. Python package
  initializer calls were also absent. Audit events saw calls without a source
  callable; an import-time graph needs an explicit module-initialization owner.
- `register(alias)` did not emit the callback reference in the TS/Python
  fixtures even with `--reference-edges`. It did emit the ordinary call to
  `register`. A function reference must remain distinct from callback execution.

The JSON has file content hashes, callable byte ranges, call-site starting byte
and line, resolver identity and confidence. It lacks a call-site end range,
execution phase and Git revision binding. Bygone must recover/validate exact
ranges and convert byte offsets to its UTF-16 coordinates against matching
source. Relocating an identical fixture preserved callable/file IDs and edges;
paths and timings changed. Rename, overload and cross-version identity were not
tested. `--since` seeds a graph filter from Git diff; it is not two immutable
revision graphs plus a semantic delta.

A smoke run on the pinned Bygone `src` snapshot analyzed 67 files, 807 callables
and 2,127 edges in about 55 ms end to end. This is one small local run, **not a
performance or accuracy benchmark**. Stage audit counts do not map cleanly to
final-edge coverage; do not report them as a precision score.

### Native TypeScript: stronger immediate fit, still not whole-program execution

A small `createProgram` / `getTypeChecker` / `getResolvedSignature` probe on the
same TS fixture found the correct imported declarations, including the top-level
call and only the correct dynamic-import target. The shadowed parameter resolved
to its function-type declaration, which must be represented as indirect/unknown,
not converted into a concrete function edge. An implicit class constructor had
no signature declaration in this probe.

This used TypeScript 5.9.3 already installed for Bygone; diagnostics were empty.
It used a normal filesystem compiler host, not a completed historical Git-blob
adapter. Virtual dispatch, overloads, generated code and full callback propagation
remain untested. [Compiler API documentation](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

### SCIP: semantic references need syntax and provenance

Pinned `@sourcegraph/scip-typescript@0.4.0` and SCIP CLI 0.10.0 were run on aliases,
reexports, callbacks, a receiver method, top-level calls and Unicode source.
Node 26.10.0 was outside the indexer's documented Node 18/20 range, so successful
execution here is not supported-runtime certification.

The index resolved imported/reexported symbols and receiver methods. Calling a
function, assigning it to a variable and passing it as a callback all produced
ordinary references. Definition enclosing ranges help containment, but there is
no explicit call relation or initialization phase. Local alias propagation is
not a complete call graph either.

The Unicode fixture emitted `[4,28,35]` for `aliased` after an emoji: column 28 is
UTF-16, whereas the UTF-8 byte offset is 30. The index omitted the newer document
`position_encoding` field. **Do not infer range units from metadata's
`text_document_encoding`: that describes source files on disk**, not positions.
Use declared position encoding or a tested producer/version convention.
[SCIP schema](https://github.com/scip-code/scip/blob/v0.10.0/scip.proto).

An unresolved import produced an undefined local symbol; external library
references lacked definitions in this index. `scip lint` reported missing symbol
information. External indexes can supply library definitions, but consumers must
not interpret missing definitions as proof of no dependency or as complete
coverage. Symbol package/version descriptors are not Git/blob provenance.

Normal project indexing relies on configuration, installed dependencies and
possibly generated declarations. Merely reading SCIP does not execute a project;
producing a faithful historical index can require build/setup work. Keep that
optional and separate from Bygone's current committed-blob analysis boundary.

## Import-time and runtime evidence

Static versus observed evidence and execution phase must stay independent.
Neither a file-import graph nor a function-only graph captures initialization
effects adequately. Give module evaluation its own node; classify eager/deferred
loading and calls in decorators, class bodies, initializers and callbacks using
language semantics. A lexical top-level test alone is insufficient.

Import externally generated runtime evidence with workload, tool/runtime version,
revision/source identity and instrumentation coverage. Preserve absent edges as
unobserved, not impossible. Sampling profiles describe resource use and observed
stacks, not an exhaustive call set; traces provide only instrumented events.
[Node CPU profiling](https://nodejs.org/api/cli.html#--cpu-prof).

OpenTelemetry offers a cross-language trace interchange path, but spans typically
represent operations rather than every function. Initialization needs explicit
loader/import events. Python `-X importtime` provides timing evidence; it is not
a substitute for resolved call relations. No runtime instrumentation was executed
in this assessment. [OpenTelemetry Node setup](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/),
[Python import timing](https://docs.python.org/3/using/cmdline.html#cmdoption-X-importtime).

## Display tools and next experiment

Use [Mermaid](https://mermaid.js.org/syntax/flowchart.html) for compact exported
change neighborhoods: low implementation cost, readable source, subgraphs and
styled relations. Keep the canonical evidence in JSON; do not reverse-engineer
semantics from diagram text. Escape labels, use opaque node IDs and retain
source anchors through the host's navigation contract.

For an embedded explorer, [Cytoscape.js](https://js.cytoscape.org/) offers graph
selection, traversal, compound nodes and layout extensions. Dagre suits directed
neighborhoods; ELK is worth evaluating for nested groups and ports. These are
renderer candidates, not measured winners. Daniel's bounded flow view remains a
useful product reference: keep the view tied to the change, show source evidence,
and distinguish inferred relationships from verified bindings.

Recent [CG-Diff research](https://arxiv.org/abs/2609.32057) directly studies
call-graph-oriented review. Its reported orientation benefits support a bounded
pilot; its reported problems with repeated functions and less-visible globals/
imports support preserving a module/initialization view. Only its abstract was
reviewed here; do not treat it as validation of Bygone's specific UI.

Recommended sequence:

1. Display existing module evidence around the selected change, with phase and
   added/removed relation filters and exact source navigation. Export Mermaid.
2. Prototype TS calls/references with the existing compiler. Explicitly represent
   module initialization, indirect targets and callback references. Test parameter
   shadowing and dynamic imports before judging graph size or visual appeal.
3. Add a producer contract for optional SCIP/LSP/heuristic/runtime artifacts with
   revision and blob identity, tool/version/configuration, range encoding,
   relation/evidence/phase, ambiguity and coverage. Keep distinct edge evidence
   even when multiple producers describe the same endpoints.
4. Benchmark a second language before choosing the polyglot fallback. Include
   decorators/default arguments/class bodies, cycles, deferred imports, aliases,
   reflection, generated code and two historical revisions. Compare absence and
   ambiguity, not just counts of emitted edges.

## Reproduction and limits

Synthetic fixtures and selected outputs are preserved in
[`dependency-tool-evidence/`](dependency-tool-evidence/). Full temporary runs,
downloaded tools and source inspections are under `/tmp/bygone-tool-analysis`,
`/tmp/bygone-tool-analysis-scip` and `/tmp/bygone-tool-analysis-alternatives`;
these temporary paths are not durable deliverables.

Skipped: live LSP execution; runtime traces; executing dep-tree, Depends, ENRE,
dependency-cruiser, Joern or CodeQL; production-scale memory/performance and
accuracy benchmarks; two-revision index generation; UI usability trials;
exhaustive security/transitive-license review. No tests of shipped Bygone behavior
were necessary because this work changes planning notes only.
