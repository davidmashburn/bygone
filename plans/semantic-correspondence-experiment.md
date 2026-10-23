# Cross-file symbol correspondence experiment

## Intent and evidence baseline

Draft research plan, 2026-10-22. Decide whether a reviewable cross-file symbol
inventory is worth implementing, and whether to reuse RefactoringMiner for
edited relationships. Source reasoning: [semantic change evidence](../ideas/semantic-change-evidence.md).
This does not authorize product implementation, dependency adoption, publishing,
or a new public document format.

Inspected implementation: `main` at
`9d56b1121d33d0e3ab6b3ec42f51e93e183247ce`. Current `src/diffEngine.ts` and
`media/diff.worker.entry.js` produce ordinary line models; no move analyzer is
wired into that worker. `src/deconstructedChange.ts` assigns hunks, rejects
renamed files without path-transition units, and checks final content/existence.
A correspondence artifact does not itself add transform stages to that model.
The main checkout's pre-existing `package-lock.json` edit was not used as input.

Historical research baseline: `research/move-tracking-slice0` at
`c6907bb9df516d8e5ddb250d52fc26d2e186a3cd`. New local
probe and results: `scripts/change-analysis/symbol-probe.js`,
`symbol-probe.test.js`, and `results/symbol-probe-bygone-2026-10-22.json` on
that branch. Read the accompanying `symbol-correspondence-findings.md` first.
The separate `research/2026-10-09-inline-highlighting` ref at
`e2b3ad02efee826a86e1ba76021e5c5ab6b0c418` concerns fine-grained highlighting;
its work does not establish symbol matching or semantic equivalence.

## Engine evaluation follow-up (2026-10-22)

The local research checkout now contains a pinned RefactoringMiner build
experiment. Source artifacts on `research/move-tracking-slice0`:
`scripts/change-analysis/semantic-engine-findings.md`, the fixed
`semantic-corpus/manifest.json`, native `results/semantic-eval-2026-10-22.json`,
and normalized results, committed at `3f8fa0258e1a7bce1f3f4afd7bba892d41284e31`.
Read the [engine findings](https://github.com/davidmashburn/bygone/blob/3f8fa0258e1a7bce1f3f4afd7bba892d41284e31/scripts/change-analysis/semantic-engine-findings.md)
for the native responses, source checks, and reproduction commands.

Thirty fixed comparisons ran twice, with ten held out before execution and no
threshold tuning. Engine output supports 11 of 14 authored cross-file
relationships, the exact baseline supports 6, and their union supports 12.
There were no extra move groups against these labels. Twenty-three declaration
endpoints resolve through an independent parser; ten local diffs reconstruct
both endpoint texts exactly. Historical cases in this corpus are restricted
single-file snapshots, so the score does not measure real-history move recall.

Warm second-pass p95 was 62 ms on an M1; peak JVM resident memory was 237 MiB.
These tiny inputs do not validate the proposed 50-file performance target.
The engine returned `ok` without warnings on malformed syntax and zero end
columns in emitted locations. Preserve an independent parse/completeness
signal and recover ranges from pinned source; do not trust the raw status as
“analysis complete.”

Two separate, post-score diagnostics refine the recommendation. A corrected
cross-file extraction with its import and aligned locals was recognized. On
the real `726796b1fe` rewrite (seven changed src TS paths, 259 kB of input), the
engine took 2.40 seconds and reported module/type movement and parameter
removals, rather than enumerating every corresponding function. The documented
MCP refactoring list is therefore insufficient as the inventory itself.

Decision: continue with the **richer mapping API plus independent inventory**,
using that real rewrite as the next mixed-edit case. Confidence is medium in
this next step and low in general accuracy/reviewer benefit. More public
cross-file adjudication, statement-mapping validation, Python coverage, larger
inputs, and a reviewer task remain open. No product adapter or semantic hiding
is approved by these results. The original plan below remains the experiment
contract and records the earlier baseline.

## What was measured now

The exact AST baseline extracts only top-level named JS/TS function declarations
and function variables from complete changed-file snapshots, including added
and deleted files. It pairs unique path/kind/name entries tentatively, then
requires globally unique declaration syntax (excluding only the declared name)
for remaining correspondences. Copies remain unresolved.

On 60 non-merge commits ending at the pinned main revision, it inventoried
8,419 before and 8,305 after **occurrences across comparisons**, not distinct
repository symbols. It paired 8,200; 234 pairs had changed declaration bytes or context,
including three exact cross-file pairs in commit `726796b1fe`. Six destination
occurrences had repeated/retained equivalent syntax. These are volume findings,
not measured precision or recall. The 13 synthetic scenarios check conservative
abstention, parse failures, duplicates, arrows, changed bodies, and identical
bodies under different bindings. No candidate engine was run.

## Bounded next slice

Inputs: a manifest of pinned before/after files and expected inventory entries,
plus adjudicated relationships. Outputs: engine-native output, normalized
occurrences/relationships with source evidence, failure reasons, and a scorecard.
Keep this in the research branch until the product decision is made.

Build 30 hand-checked comparisons: 10 synthetic controls, 10 public historical
comparisons sampled independently of detector success, and 10 difficult cases
with mixed edits. Tag overlapping features rather than selecting only commits
whose subjects claim a refactor. Reserve 10 comparisons as held-out data before
tuning. Include at least:

- Cross-file exact move; whole-file rename; module split; same-file reorder;
  move plus literal/operator edit; move plus rename and formatting.
- Recurring helpers and boilerplate; source retained with a new occurrence;
  two sources/one destination; same name with unrelated replacement.
- Extraction and inline with changed call sites; nested methods/classes;
  exported arrows, anonymous defaults, overloads, and GraphQL registration.
- Same text under changed imports/bindings; documentation edit; unsupported
  syntax; invalid parse; unchanged-file origin outside changed-file scope.

The small probe's 13 scenarios can seed controls but cannot serve as independent
test data. Extend equivalent cases to Python before claiming cross-language
support. Use public or newly authored fixtures; do not copy private corpora.

## Candidate evaluation and adapter boundary

Run the exact baseline first, then a **pinned** RefactoringMiner build. As of
2026-10-22, upstream HEAD was `e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`.
Its [MCP documentation](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/documentation/mcp.md)
describes local file-content analysis and JSON results; this establishes a
candidate interface, not tested compatibility or accuracy. A language-specific
API adapter may be necessary for full statement mappings and coordinates.

Retain the native tool result, but expose a Bygone-owned comparison artifact.
Do not make Java classes, temporary WebDiff URLs, or mutable engine IDs part of
tour documents. Normalize UTF-16/byte offsets and inclusive/exclusive conventions;
verify each range by slicing the pinned text. Treat truncated output and
unsupported files as incomplete analysis. Never infer an inventory by listing
only the symbols an engine reported as refactored.

Evaluate GumTree only if RefactoringMiner fails a concrete requirement that
GumTree could satisfy. Use Difftastic as a local syntax-diff presentation
baseline if needed; its introduction does not establish a cross-file inventory
API. Compare SemanticDiff's documented moved-block interaction separately from
an analysis-engine benchmark. No dependency decision follows from a demo alone.

## Measurements and decision gates

Report inventory recall by declaration kind, correspondence precision/recall,
operation-label accuracy, endpoint-boundary accuracy, unresolved rate, parse and
scope exclusions, latency (cold/warm), and peak memory. Count erroneous links,
not just changed lines “explained.” Score extraction groups independently of
simple pairs. Report denominators and uncertainty; a small zero-error sample
cannot substantiate 99% production precision.

Before running, record hardware, runtime versions, engine revision, timeouts,
file/byte limits, and the manifest digest. Provisional feasibility target:
warm p95 <=2 seconds for <=50 changed source files / <=1 MiB combined source;
a cold run must report startup separately. Abort an individual comparison after
30 seconds; report unavailable/partial instead of dropping it from averages.
These are experiment gates, not measured product performance promises.

Continue toward a product prototype only if:

1. All curated adversarial controls preserve body edits and avoid unsupported
   equivalence claims; all emitted ranges resolve to the expected text.
2. Held-out outputs have no known false **automatic** move links. Analyze every
   miss and abstention; do not lower thresholds merely to improve explained share.
3. The inventory is independently useful with matching disabled, and exclusions
   are visible rather than rendered as absence.
4. A simple review task with seeded moved-code bugs shows no loss in detection
   compared with the ordinary diff. A small study is a feasibility observation,
   not a population claim; record order, tasks, mistakes, and time.

If edited matching fails, retain the inventory and exact correspondences. If
inventory coverage fails, fix extraction or stop; adding an LLM label does not
recover missing evidence. If runtime fails, prefer an explicit host-side
analysis action before designing incremental background indexing.

## Handoff

First reproduce the saved exact baseline and hand-label the three cross-file
pairs plus the six unresolved destinations. Build the manifest next, then run
the candidate adapter. Defer persistent history identity, arbitrary repository
clone search, move-aware application, and transform-stage serialization. No
production tests, renderer smoke checks, or upstream-engine execution were
performed for this planning document.
