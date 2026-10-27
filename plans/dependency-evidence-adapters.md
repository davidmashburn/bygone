# Dependency evidence adapters and graph views

Status: approved for implementation, 2026-10-27. Implementation inspected: main at
`ee4a9790f3d13dad077b22328041a2e06599a2ba`. No implementation in this plan.
Builds on [the graph proposal](../ideas/dependency-graphs.md) and
[tool experiments](../ideas/dependency-graph-tools.md).

## Outcome and boundary

Let a reviewer select a changed file or function, inspect its dependencies and
consumers, distinguish initialization from later invocation, and open exact
source evidence. Additional languages/tools should not require the viewer to
understand their native formats.

Required language priority: **Python, JS/TS, Go, Rust, Mojo**, in that order.
All five are intended supported languages, not optional future possibilities.
Prioritize depth and correctness in that order and expose each adapter's actual
capabilities; do not imply equal semantic resolution from parser availability.

Make the evidence contract tool-agnostic; keep extraction and resolution
language-specific. Start with internal adapters and imported artifacts, not a
plugin marketplace, universal language framework or automatic analyzer installer.
Do not promise equivalent completeness across producers.

## Existing implementation and gaps

`src/dependencyGraph.ts` already has revision/blob identity, source ranges and
digests, bounded snapshots, diagnostics, resolution states and module-edge deltas.
`src/moduleDependencies.ts` already separates relationship, phase and loading.
Preserve these distinctions and the default committed-source analysis boundary.

The current graph has file targets, a single report-level producer and syntactic
evidence. Initialization sites have no resolved callees. Symbol nodes, mixed
producers, call/reference ownership, capability coverage and observed workloads
need additional representation. A common format must not discard existing module
evidence to accommodate a weaker producer.

## Contract to specify with examples

Use a versioned artifact with these conceptual records; names are provisional:

- **Snapshot:** source identity and analysis context. Track configuration and
  dependency-input identity where available. Live workspace evidence is distinct
  from historical Git evidence unless source bytes are verified.
- **Producer run:** tool/adapter versions, configuration fingerprint, supported
  languages/relations/phases, requested versus analyzed scope, limits and
  diagnostics. Successful parsing does not establish semantic completeness.
- **Node:** file/module, symbol, synthetic module-initialization owner or external
  boundary. IDs are snapshot-scoped; retain native IDs without assuming stable
  identity across renames, overloads or tool versions.
- **Site:** owner, source anchor, syntactic operation and lexical phase. Preserve
  the site when its target is unknown. Lexical phase is not runtime order or a
  summary of every transitive effect.
- **Evidence assertion:** site, relation, target/candidate set, producer run,
  evidence method, resolution status, phase and loading where meaningful.
  Begin with imports, reexports, calls, references and construction. Add other
  relations when a producer supplies useful evidence.
- **Optional observation:** workload/run identity, observed target, event context
  or aggregate count, instrumentation scope and sampling policy. Unobserved does
  not mean impossible.

Keep resolved, ambiguous, unresolved, external and unsupported outcomes explicit.
Retain confidence labels as producer metadata, not shared probabilities. A static
binding does not prove a runtime dispatch target. Allow namespaced extensions
without requiring every adapter to understand them.

Example using the observed Python failure:

```text
site:      head / main.py / shadow / alias() / invocation
syntax:    call through a local parameter
native:    indirect target; concrete callee unresolved
cgg:       lib.target, confidence=high, version=0.11.2
display:   conflicting evidence; no verified concrete target
```

An importer validates source identity, coordinates and structural consistency;
that does not establish semantic truth. Preserve competing assertions instead of
inventing a universal tool ranking. The conformance corpus can independently
specify the expected result for this known case.

Store occurrence evidence and derive aggregated display edges with counts and
inspectable sites. A caller calling `register`, referencing a callback value and
eventually invoking that callback are different relationships. The third needs
additional analysis or observation; the first two do not establish it.

Compare base/head only with explicit producer/configuration/coverage context.
Missing coverage means unknown, not removed. Distinguish phase changes and newly
resolved targets from ordinary endpoint changes. Begin with conservative symbol
correspondence; do not silently equate native IDs across revisions. Keep runtime
workload comparisons separate from static source deltas.

## First vertical slice

1. Write three serialized contract examples: existing module evidence, a TS call
   plus indirect callback reference, and a partially supported imported result.
   Project the existing report into the format without breaking its consumers.
2. Render a selected file's one-hop module neighborhood with incoming/outgoing
   edges, added/removed relations, phase, unresolved sites and coverage. Cap or
   group large neighborhoods visibly and allow expansion. Edge selection lists
   evidence sites, then opens source. Include an accessible list and deterministic
   Mermaid export.
3. Implement Python imports, initialization ownership and conservative local
   call/reference binding first, then TS local function/method calls and references with the existing
   compiler and synthetic initialization owners. Reuse snapshot reads and
   budgets. Installed dependencies, arbitrary builds and target execution remain
   outside the default slice; report insufficient context rather than guessing.
4. Normalize captured SCIP and cgg artifacts to test the contract against
   different evidence. This is a format experiment, not a commitment to shipping
   either integration. Verify source identity before attaching historical links.

This delivers module visualization early while testing the common format with
different producers. A full external runner and runtime instrumentation come later.

## Acceptance criteria and benchmark

Use hand-checked fixtures with expected sites, prohibited false edges, allowed
ambiguity and known unsupported cases. Existing experiments provide seeds.

- Shadowed parameters never become verified imported call targets.
- Aliases, reexports and receiver bindings retain exact source navigation.
- Top-level calls have initialization owners; deferred callbacks do not inherit
  that phase merely because registration occurs during initialization.
- Unicode range conversion selects the correct token. Wrong blobs and invalid
  ranges fail artifact validation visibly.
- Alternative targets remain alternatives, not multiple confirmed calls.
- Partial coverage remains visible on delta views. Analyzer changes alone do not
  silently appear as code dependency changes.
- Calls and references remain distinct; aggregation preserves their evidence.
- Importing data does not execute project code or embedded commands. Apply input
  size, record and path bounds before rendering.

Extend the corpus with cycles, decorators/default arguments/class bodies,
dynamic imports, missing dependencies, generated source and base/head renames.
Validate Python first against its initialization semantics and the supplied prior
art, followed by JS/TS, Go, Rust and Mojo. Each language needs representative
repository validation in addition to synthetic fixtures.

Report exact-target precision, site coverage, candidate-set behavior, unsupported
cases, anchor correctness and resource cost separately by relation/language.
Avoid a single score that rewards omitting hard cases. For traces, measure event
fidelity and workload/instrumentation coverage rather than static-analysis recall.

The UI pilot should answer three tasks: identify a direct unchanged consumer,
explain an initialization-to-invocation change, and distinguish a function value
reference from a demonstrated call. Compare with current source navigation;
record wrong conclusions and missing information as well as completion time.

## Decisions to settle through the slice

- Does the common artifact supplement v1 or replace it? Default to a projection
  first; decide migration after the prototype exposes compatibility needs.
- How much TS semantic context can committed blobs supply without installed
  dependencies? Measure gaps; do not quietly widen the execution boundary.
- Does compact rendering meet review needs before a larger interactive library
  is justified? Measure expansion and navigation needs.
- Which representative repository and resolution cases establish useful support
  for each language in the agreed priority order?
- How much symbol correspondence is necessary for useful deltas?

Confidence is high in separating evidence, resolution and phase, based on the
current schema and observed tools. Confidence in this delivery order is medium;
a weak module-view pilot or impractical historical compiler setup would change it.

## Verification

Inspected current source types and delta semantics at the baseline above; reused
prior tool experiments. No new analyzer, runtime, UI or implementation tests were
run. Existing package edits and unrelated planning notes are outside scope.
The user authorized implementation and publication of this proposal. No
implementation is claimed complete by this planning document.
