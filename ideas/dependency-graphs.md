# Dependency graphs for change review

Status: 2026-10-27. Static module evidence and the compiler compatibility follow-up
are implemented. [Tool evaluation](dependency-graph-tools.md) now includes
executable cgg, native TypeScript and SCIP probes, plus a broader candidate
comparison. The [approved adapter proposal](../plans/dependency-evidence-adapters.md)
prioritizes Python, JS/TS, Go, Rust and Mojo, with a bounded graph view. The
original assessment below is followed by implementation and validation
updates.

## Recommendation

Add dependency evidence centered on a change: what it depends on, what depends on
it, and which relationships changed between revisions. Start with static module
relationships and explicit initialization effects. Follow with resolved symbol
references and optional imported execution traces. A repository-wide graph is a
possible navigation view, but is not the first product milestone.

Initial assessment confidence: **medium** that this improves review enough to
justify a feature; no human review experiment or performance prototype had yet
been run. Confidence is
**high** that discovery method, execution phase, and relation kind must remain
separate. A pilot showing that ordinary search and source links answer the same
questions just as well would reduce the recommendation to a context exporter.

This extends [semantic change evidence](semantic-change-evidence.md) and
[review comprehension](../plans/review-comprehension.md). It addresses the gap
between locating a moved declaration and understanding its changed context.

## Three useful views, two independent dimensions

“Static” describes how evidence is obtained; “import-time” describes when work
happens. Import-time execution is itself runtime behavior. Offer the requested
views, but do not encode them as mutually exclusive edge kinds.

| View | Useful question | Evidence and limits |
| --- | --- | --- |
| Static dependencies | What names, types, modules, and potential callees does this source depend on? | Parsing finds syntax; a resolver identifies targets under a particular configuration. Neither guarantees execution. |
| Import-time / initialization dependencies | What must load or execute to initialize this module, and what state or registrations does that create? | Static classification can identify immediate expressions; traces can observe initialization in a particular run. Import syntax alone cannot describe its effects. |
| Runtime interactions | What did this workload call, dispatch, read, or contact? | Instrumented runs can expose dynamic dispatch, callbacks, plugins, services, and resources. Unobserved does not mean unreachable or unused. |

Use independent fields for relation (imports, references, calls, registers,
reads, writes), evidence (syntactic, resolved, observed, authored), and phase
(type/build, module initialization, invocation, unknown). A call site may have
multiple execution contexts. Also record conditions and eager versus deferred
loading. A lazy import can initialize a module long after process startup;
“initialization” must not mean “at process start.”

Package-manifest and lockfile dependency graphs answer a different question.
Retain packages as boundary nodes or a later view, but do not infer application
calls or initialization effects from package declarations.

## Why initialization deserves explicit treatment

Consider this synthetic TypeScript module:

```ts
import type { Message } from './types';
import { Client } from './client';

const client = new Client(process.env.API_URL);
export function send(message: Message) {
  return client.send(message);
}
```

The type dependency belongs to static analysis. Module evaluation constructs a
client and reads configuration. Calling `send` later uses the captured client.
Moving construction into `send` can preserve the imported modules while changing
configuration timing, instance lifetime, and failure timing. The dependency
graph needs a phase delta to expose that distinction. This is an illustrative
example, not an executed observation or a claim about `Client`'s implementation.

Language-specific semantics matter:

- Type-only TypeScript imports are removed; value-import emission also depends
  on compilation policy. Do not label every source import a runtime load.
  [TypeScript import elision](https://www.typescriptlang.org/tsconfig/verbatimModuleSyntax.html).
- Python imports can execute module code. Decorators, default arguments, base
  expressions, and class bodies evaluate when their definitions execute; for
  module-level definitions, that is ordinarily module initialization. Function
  bodies execute on invocation. Nested definitions follow their enclosing
  execution context. Annotation behavior needs a version-specific policy.
  [Python import system](https://docs.python.org/3/reference/import.html),
  [definition semantics](https://docs.python.org/3/reference/compound_stmts.html#function-definitions).
- CommonJS caching and cycles affect initialization. A cycle can expose partial
  exports; a cycle is not itself proof of a defect. A source graph cannot be
  treated as an execution-order trace.
  [Node module caching and cycles](https://nodejs.org/api/modules.html#caching).

Represent module evaluation with a synthetic node such as `module::<init>`.
Calls and effects outside named functions need an owner. Distinguish registration
of a callback from subsequent invocation of that callback; infer a registry
lookup-to-handler connection only through a documented adapter or trace.
Do not connect arbitrary matching string names as if they established dispatch.

Bygone itself illustrates this: `web/host.js` invokes `initializeWebHost` at
module evaluation, creates a viewer, and registers message/DOM listeners. The
listener bodies run later if dispatched. Existing Strand inventory deliberately
excludes general callbacks, so declaration inventory alone misses these edges.

## Product behavior worth testing

For a selected changed file or symbol, show **Depends on** and **Used by** with
one-hop context by default, including unchanged files. Let readers expand paths
on demand. The initial surface should be a short relation list with exact source
links; add a compact graph when branching or cycles are easier to understand
spatially. Keep deterministic placement across base/head and collapse cycle
groups rather than displaying a changing force-directed cloud.

Prioritize four review questions:

1. Did a moved, otherwise identical function acquire a different binding?
2. Did a new import introduce eager work, a registration, or an initialization cycle?
3. Which unchanged consumers reference a changed interface or value?
4. Which interactions were observed for the supplied test or workload?

Compute graphs independently at base and head, then align their endpoints using
validated correspondence where available. Preserve ambiguity. Classify edges
as added, removed, retargeted, or changed in phase/condition. A mere path rename
should not produce spurious wholesale deletion/addition. A resolved target
change must remain visible even if source text is identical.

Reverse reachability means **potential dependents in the analyzed scope**, not
“will break.” Traversal must respect edge types: type-only edges should not
create runtime impact paths, and trace edges from different runs should not be
stitched into a supposedly observed execution. A timing difference between
two traces is not automatically a regression caused by the code change.

Keep the full diff, raw statistics, and review coverage authoritative. A graph
does not justify hiding an edit or labeling it behavior-preserving. Tours may
select a small subgraph and its exact evidence, and context export may include
bounded relevant relationships for agent review.

## Existing implementation and missing capabilities

Inspected development baseline: `main` at
`ec318cfbd9d9cddef2fcac150723958c0f7987c2`. The working tree also contains unrelated
source-reference and requirements work; the recommendation does not assume it
has landed. Paths below refer to development source, not this orphan branch.

| Existing seam | Reuse | Missing work |
| --- | --- | --- |
| `packages/strand/src/symbol-inventory.js` | Parser-backed declarations, UTF-16 ranges, digests, explicit exclusions; a narrow top-level `registerType` recognizer | Import/reference extraction, binding resolution, general effects, and callback/dispatch modeling |
| `packages/strand/src/input.js` | Bounded snapshot contract | Repository-wide indexing has different budgets: current ceilings are 50 paths and 4 MiB per comparison |
| `src/changeInventory.ts` and `src/changeTourContext.ts` | Pinned Git comparison and changed-file context | Unchanged dependency and reverse-consumer scope; current changed-file enumeration cannot establish all consumers |
| `src/changeCorrespondence.ts` and `src/tourSymbol.ts` | Validated endpoints, comparison-local identity and source navigation | Dependency records and their own validation; correspondence does not prove binding or behavior |
| `src/changeTour.ts`, `src/changeTourManifest.ts`, `src/tourDirectoryEvidence.ts` | Tour/evidence selection and navigation | A bounded dependency view with source access beyond changed files |
| Uncommitted `packages/strand/src/source-references.js` | Possible later shared pin/resolve primitive | It is not symbol-use resolution; it checks source ranges and accepted relocation pairs |

Keep syntax extraction in reusable language adapters. Put snapshot loading,
resolution configuration, caches, reverse indexes, and artifact validation in a
host-side coordinator. Keep parsers and trace collection out of the renderer.
Use a separate versioned dependency artifact, optionally referenced by change
context. Existing authored tour connections are narrative links, not computed
dependency edges. Native graph scenes would require an explicit source/manifest
schema extension; the initial experiment can use existing prose and anchors.
The current parser dependency is TypeScript 4.9; newer documentation describes
semantics and candidate APIs, not demonstrated compatibility with this checkout.

## Resolution and evidence contract

Use a small typed graph per snapshot, with multiple evidence records per edge:

```text
Snapshot: repository identity, revision/content digest, configuration fingerprint
Node: local ID, kind, source reference or external/unresolved target
Edge: source, target, relation, phase/context, condition, source-site reference
Evidence: producer/version, syntactic/resolved/observed/authored, provenance
Scope: requested/analyzed paths, omissions, budgets, diagnostics, completeness
Run: source/build identity, workload, environment fingerprint, instrumentation,
     sampling/coverage limits, event/trace identifiers
```

Specify each relation's direction, for example caller → callee and importer →
imported module. Do not mix containment with dependency traversal. External
services, configuration keys, registries, and unresolved specifiers can be
explicit boundary nodes; unresolved targets must not disappear.

Resolve each historical revision against its own configuration and available
dependency metadata. Never silently use today's working-tree `node_modules`
or TypeScript configuration for yesterday's source. Pin resolution conditions,
package exports, aliases, and build/source-map identity. TypeScript's `paths`
does not rewrite emitted imports, so compiler resolution is not automatically
runtime resolution. [TypeScript module resolution](https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-does-not-affect-emit).

A reverse index needs to inspect possible unchanged importers, not merely follow
outgoing imports from changed files. Build a separately budgeted module index
over the declared repository scope; analyze detailed symbol/effect neighborhoods
on demand. Cache by content plus resolver/tool/configuration versions, invalidate
dependents when resolution changes, and expose cancellation and partial results.
“No dependents” is meaningful only within a complete stated scope.

Do not import target modules or execute their build/configuration scripts to
discover dependencies. That could register services, touch files, or initiate
network calls just by opening a comparison. Start runtime support by reading
user-supplied trace artifacts. Any future collector should be an explicit,
separate operation with a known workload and execution environment.

Observed evidence must retain its run identity. Map compiled frames through
matching build artifacts/source maps; retain unmapped frames rather than guessing
source symbols. Resource traces and function-call traces have different
granularity. OpenTelemetry supplies instrumented spans and causal links, not a
complete function graph; sampling further limits absence claims.
[OpenTelemetry trace model](https://opentelemetry.io/docs/specs/otel/overview/#tracing-signal),
[sampling](https://opentelemetry.io/docs/concepts/sampling/).
Store only necessary, scrubbed metadata; request payloads and secrets are not
needed to show a dependency.

## Staged investment and alternatives

| Slice | Scope and relative effort | Advancement gate |
| --- | --- | --- |
| Experiment | Small JS/TS corpus, static imports/re-exports, type-only classification, exact sites, explicit top-level effects; moderate | Correct endpoints/phases and useful answers beyond ordinary source links |
| First product slice | Base/head module-edge deltas, unchanged consumers, bounded lists/navigation, partial-scope reporting; moderate to substantial | Historical resolution and responsive indexing demonstrated |
| Symbol context | Resolve references and direct call targets; add initialization/registration adapters and a Python pilot; substantial | Fixture-backed precision per adapter; unknown targets retained |
| Runtime overlay | Import run-scoped traces; distinguish observed paths and initialization events; substantial and integration-dependent | Revision/build mapping, instrumentation gaps, and workload comparability visible |

Do not promise all Strand languages at once: a declaration grammar does not
supply binding or initialization semantics. Python is a useful second pilot
because definition-time work makes phase differences explicit.

Compare a thin TypeScript compiler-API adapter with dependency-cruiser as an
external module-graph producer. The former offers compiler symbols through a
program/checker but needs our snapshot host and policies. The latter already
distinguishes dynamic and pre-compilation dependencies and exports graph data;
it still needs evaluation for exact source evidence and historical operation.
Neither provides the whole initialization-effects or observed-runtime model.
Reuse a producer if it meets the contract; do not adopt a graph database or new
layout dependency before a bounded prototype needs one.
[Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API),
[dependency-cruiser options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md).

## Next experiment and decision gates

Prepare public/synthetic before/after fixtures for: type-only imports; a side-effect
import; eager-to-lazy loading; re-export and alias retargeting; an unchanged
consumer; a same-body move with changed binding; callback registration versus
invocation; an initialization cycle; Python decorators/defaults/class bodies;
unresolved computed imports; stale traces; and deliberately incomplete scope.

Hand-label endpoints, relation kinds, phases, and expected unknowns. Report
precision and recall separately per supported relation, with resolution failures,
diagnostics, cold/warm latency, peak memory, and graph size. Every displayed
source link must validate at the pinned revision. Include negative cases so
plausible but false dispatch/call edges fail the experiment.

Then compare a short relation list and a small graph against ordinary search
and diff navigation on matched review tasks. Record correctly identified
dependencies and initialization changes, false conclusions, and navigation
effort. Agree response-time budgets from measured repository sizes. Advance only
if the dependency evidence improves answers; invest in graph visualization only
if it adds value over the list. Runtime collection remains a separate decision.

## Original assessment verification and limits

The initial evaluation inspected repository source and existing plans and consulted
primary language/tool documentation. No parser/resolver prototype, dependency
benchmark, trace collection, human trial, application build, or test suite was
run at that stage. Existing source-reference tests were not rerun. No production
files, dependencies, global rules, or shared-system records were changed during
the initial evaluation.

## Implementation update — 2026-10-26

The first JS/TS module-evidence slice is implemented in development commit
`3bc29f9e` (`feat(dependencies): add static module dependency evidence`).
`src/moduleDependencies.ts` extracts dependency syntax
and potential initialization sites; `src/dependencyGraph.ts` resolves committed
snapshots, aligns Git renames, and reports edge deltas and direct unchanged
consumers with pinned source evidence. `bygone dependencies` exposes bounded text
and JSON reports; `bygone tour context --dependencies` adds the same evidence on
request. Shipped-behavior documentation is in `docs/dependencies.md` beside the
implementation. The parser is bundled separately from ordinary app/context code.

Synthetic fixtures cover historical config/alias and package-mode changes,
type-only and declaration dependencies, eager/lazy phases, computed imports,
source coordinates, renames, unchanged consumers, invalid config, symlinks and
budgets. The 20 focused tests, typecheck/build, and targeted lint pass. A broader
467-test Node suite, full lint, and core checks passed before the final config
exception guard; targeted regressions cover that guard on both snapshots.
Independent review identified false completeness for invalid config, a
range-discovery timeout gap, and uncaught compiler exceptions on malformed config;
all are corrected in the commit.

At that stage, the decision gates above remained incomplete. Runtime traces, symbol/call
binding, Python analysis, graph UI, human review trials, and broad latency/memory
benchmarks remained unimplemented or unmeasured. Confidence is high for the tested
static cases, not for arbitrary resolver equivalence; failures on representative
project configs or measured review-task results would change that assessment.

## Validation update — 2026-10-26

The static validation pass is recorded beside implementation in
`scripts/dependency-benchmark/README.md` and
`scripts/dependency-benchmark/results-2026-10-26.json`, measured against development
commit `c7219ed06351626b8a65627fbb0427b57c576bbf` with source/bundle hashes. It adds
36 contract-labeled HEAD sites across ten cases, a separate two-site malformed
package characterization, delta/consumer and registration checks, four generated
scales, and pinned Express, p-limit, Redux and Bygone snapshots. All contract
labels and 158 checked source sites match. Public accuracy labels cover only four
selected files; compatibility observations are broader than that tiny oracle.
The corpus and report are published in development commit `dda37567`.

Local analysis times (both snapshots, excluding module load) were 136–147 ms for
100 tiny source files, 544–686 ms for 1,500, and 885–992 ms for Bygone's 261 files.
The 2,500-source case correctly stops at 1,999 indexed sources because its config
uses one input slot. Peak whole-process RSS ranged from 123 to 226 MiB across
runs on an Apple M4, Node v26.10.0. These are three fresh-process measurements per
input, not controlled cold-cache or user-perceived latency measurements.

The evidence changes the next slice: prioritize compiler compatibility and
metadata coverage before symbol context or visualization. Redux's bundler config
invalidates resolution at 367 of 397 sites under TypeScript 4.9; none of its 13
hand-labeled internal entry-file targets resolve. p-limit's `using` syntax makes
coverage partial. Malformed package JSON silently falls back to CommonJS without
a diagnostic, while unrelated oversized Redux lockfiles make coverage partial.
A bounded follow-up should evaluate parser/resolver compatibility, diagnose bad
package metadata, and select configuration-relevant JSON precisely, preserving
committed-only resolution and explicit unknowns. Replay the pinned public oracle
and scale checks before advancing.

Qualitative diff/search comparisons identify useful module-level answers for
alias retargeting and identical-source moves, and show why same-module symbol
changes still need ordinary code review. They do not measure human correctness,
navigation effort, or graph-versus-list utility. Runtime ingestion, Python,
symbol/call resolution, a graph UI, and human trials remain outstanding. No
production implementation changed in this validation pass. Confidence is high
for observed failures and labeled counts, moderate for local timings, and limited
for general accuracy or reviewer benefit. Broader unseen cases or human trials
could change the priority.

## Compatibility follow-up — 2026-10-26

After the validation thread completed, the user authorized the workflow
integration thread to implement its measured gaps. Bygone commit `d161ce5c` (0.11.1),
based on `dda37567`, isolates TypeScript 5.9.3 for dependency analysis, diagnoses malformed
package metadata, loads source-ancestor configs/packages and their relative
inheritance closure, and loads other required package metadata on demand within
the same bounds. Unrelated JSON, lockfiles and packages no longer displace source
input. The extension and Strand keep their existing TypeScript compiler.

The rerun passes 38 labeled sites across 11 contract cases, four bounded scales
and 158 source-reference checks. Redux's selected entry file now resolves 13/13
expected internal targets; p-limit and Redux complete supported-scope indexing.
The exact report is `scripts/dependency-benchmark/results-2026-10-26-compatibility.json`
in the implementation checkout. Invalid package metadata is now a correctness
contract, superseding its historical fallback characterization above.

The review workspace exposes module relationship/specifier/target, phase, loading
and coverage alongside pinned navigation. A resolved path is a compiler lookup,
not proof of a `require` binding or runtime execution; the explicit ambiguity
diagnostic remains. Named-symbol/call binding and runtime observations still
need their own evidence model and validation. No new graph UI, human review-speed
claim or arbitrary name-based call inference was added. The next decision gate
remains a paired human review/navigation trial and representative binding cases.
