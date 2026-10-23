# Cross-file symbol correspondence experiment

The approved [language rollout](symbol-language-support.md) extends the
implemented adapter: Python first, then the remaining pinned RefactoringMiner
languages, then languages requiring another correspondence producer. It records
the current feature integration, scope, and per-language acceptance gates.

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
The reproduction below reads pinned Git snapshots, not development worktree edits.

Historical research baseline: `research/move-tracking-slice0` at
`c6907bb9df516d8e5ddb250d52fc26d2e186a3cd`. The earlier notes referenced
`scripts/change-analysis/symbol-probe.js`, `symbol-probe.test.js`,
`results/symbol-probe-bygone-2026-10-22.json`, and
`symbol-correspondence-findings.md`. After fetching on 2026-10-22, none was
present in the local research worktree or the remote branch at that revision.
Those artifacts are now present in fetched research commit `cb0edb6` as of
2026-10-23. Their reported aggregate measurements below have not been rerun in
this planning worktree; the local controls independently reproduce one example.
The new [development controls and pinned historical labels](fixtures/semantic-correspondence/README.md)
include their own checker and saved output on this planning branch. Matcher
prototypes and product implementation still belong in development/research
history, separate from the orphan planning branch.
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

## Mapping adapter implemented (2026-10-22)

A research adapter is committed on `research/move-tracking-slice0` at
`cb0edb6`: `scripts/change-analysis/refactoring-mappings.md` documents the
Java API bridge, independent JS/TS inventory, normalization, and bounded runner.
It uses the same pinned jar and introduces no shipped dependency.

The real `726796b1fe` example now has all six module-moved function
continuations, including the edited `validateChangeTourDetails`. Its removed
assessment validation remains visible both as unmapped old source and in the
full declaration diff. Class/type mappings are normalized against actual
language declarations rather than shown as generic engine classes/modules.

Validation: 13 unit and 4 integration checks passed, including actual timeout,
export-limit and output-overflow failures. Thirty fixed plus two diagnostic
comparisons reconcile; 239 local diffs reconstruct both endpoints and 1,991
attached fragment mappings resolve to source slices. Those checks establish
byte/range integrity, not broad correspondence accuracy. Existing MCP results
remain frozen. More public adjudication, Python support, reviewer benefit, and
product integration remain outside the completed adapter slice.

## RefModel-style prompt test (2026-10-22)

The research checkout now also contains `scripts/change-analysis/refmodel-findings.md`,
frozen prompt protocols, runners, source validators, and raw/scored answers.
Following the user's model preference, the primary follow-up uses authenticated
Codex with gpt-6.1-sol at medium reasoning: 32 comparisons, two arms, 64 completed
calls, no task tool use. A preliminary GPT-OSS pass remains separately recorded.

The grounded arm passed source/shape checks on 30/32 answers. It explicitly
surfaced the removed assessment validation in the real module split, which the
plain catalog-label answer omitted. That answer still failed other citation
checks: useful observations do not make an entire model response acceptable.
Both variants spotted several synthetic literal/binding/import changes.

RefModel's class-based catalog inconsistently covers module-level functions and
omits extraction and class-movement labels needed here. Keep language-neutral
symbol correspondence and complete local edits as the underlying model; attach
model hypotheses and explanations as checked annotations. Confidence is medium
in that research direction, low in reviewer benefit over the adapter alone.
The experiment changed both evidence and prompting, used one run per variant,
and has no independent/blinded adjudication or reviewer task. No product
integration or semantic hiding follows from these results. These additions
are committed in research commit `cb0edb6`.

## Earlier reported measurements

The earlier report describes an exact AST baseline extracting top-level named
JS/TS function declarations and function variables from complete changed-file snapshots, including added
and deleted files. It pairs unique path/kind/name entries tentatively, then
requires globally unique declaration syntax (excluding only the declared name)
for remaining correspondences. Copies remain unresolved.

It reports 60 non-merge commits ending at the pinned main revision, with
8,419 before and 8,305 after **occurrences across comparisons**, not distinct
repository symbols. It paired 8,200; 234 pairs had changed declaration bytes or context,
including three exact cross-file pairs in commit `726796b1fe`. Six destination
occurrences had repeated/retained equivalent syntax. These are volume findings,
not measured precision or recall. The 13 synthetic scenarios check conservative
abstention, parse failures, duplicates, arrows, changed bodies, and identical
bodies under different bindings. This initial baseline did not run a candidate
engine. The recovered probe/output make these totals and six destinations
checkable; they have not been independently rerun during this rebase.

## Reproduced development evidence

The [saved observation](fixtures/semantic-correspondence/observation-2026-10-22.json)
uses Node v26.10.0 and TypeScript 4.9.5. Ten authored controls check all 22
supported declaration endpoints, Unicode/CRLF coordinates, retained duplicate
competitors, body edits, changed bindings, and extraction/parse exclusions.
They are development data, not the held-out partition.

A small AST-printing baseline emits three of four labeled exact relationships
with no false links in these controls. It misses the rename-plus-format case:
the printer preserves a block-layout distinction. It abstains on edited moves
and extraction; those are separate relationships with no recall estimate yet.
Exact declaration matches still include the changed-binding counterexample,
so all output links explicitly leave behavior unassessed.

The public comparison `7bd04dbb` → `726796b1` reproduces the three reported
byte-identical relocations: `validateAudience`, `requireString`, and
`requireStringArray`, from `src/tourAssessment.ts` to `src/tourDetails.ts`.
Its 17 changed JS/TS paths contain 317 before and 308 after supported declarations.
`isRecord` and `requireOnlyKeys` retain competing origins and remain ambiguous.
This selected commit reproduces a known example; it does not validate the
earlier 60-comparison totals or establish broad accuracy.

## Bounded next slice

Inputs: a manifest of pinned before/after files and expected inventory entries,
plus adjudicated relationships. Outputs: engine-native output, normalized
occurrences/relationships with source evidence, failure reasons, and a scorecard.
Keep matcher development in the research branch until the product decision is
made. Keep the hand-label fixtures, checker, and observations alongside this plan
so the evidence can be reproduced after the research worktree is gone.

Complete 30 hand-checked comparisons: the 10 synthetic controls now captured,
10 public historical comparisons sampled independently of detector success,
and 10 difficult cases
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

The recovered probe's 13 scenarios are separate from the new controls.
The selected reproduction commit also does not fill an independently sampled
historical slot. Extend equivalent cases to Python before claiming cross-language
support. Use public or newly authored fixtures; do not copy private corpora.

## Candidate evaluation and adapter boundary

The interface probes below record the earlier MCP boundary and remain useful
regression inputs. The research adapter described above now implements the
richer export and independent inventory; the proposed checks here must be
reconciled with that implementation rather than treated as missing work.

Run the exact baseline first, then a **pinned** RefactoringMiner build. As of
2026-10-22, upstream HEAD was `e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`.
Its [MCP documentation](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/documentation/mcp.md)
describes local file-content analysis and JSON results. Source inspection now
confirms that `analyzeFileContents` accepts separate path-to-content maps for
both sides, so complete added/deleted files can be supplied together. This is
interface evidence, not measured JS/TS matching accuracy.

There is a concrete output limitation: the pinned
[MCP result](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/src/main/java/org/refactoringminer/mcp/McpAnalysisResult.java)
contains refactoring records, counts, and warnings, rather than the complete
inventory or AST mapping graph. Its
[location records](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/src/main/java/org/refactoringminer/mcp/McpRefactoringResult.java)
expose paths, lines, columns, and code-element metadata, not normalized byte and
UTF-16 offsets. A successful MCP call alone cannot fill the planned artifact.

The [archived engine smoke](fixtures/semantic-correspondence/engine/README.md)
now executes this multi-file path under Linux x86_64 Docker emulation. Three
changed JS/TS files produced a rename record and three AST diffs. A two-file
module relocation produced no refactoring record or moved AST diff. This does
not establish a matching failure: the source prunes identical files, including
renamed paths, before model construction. Both this case and the anonymous
export case report one file per side despite receiving two. Engine file counts
are therefore not an input coverage ledger. Preserve original snapshots and
independent inventory before passing defensive map copies to the engine; retain
duplicate competitors even when its preprocessing chooses a path match.

The rename record has `startColumn: 8` and `endColumn: 0` on the same line;
its coordinates are not yet usable as verified source slices. The native
Linux-arm64 image builds but actual parsing fails for a missing SWC4J native
library. Linux/amd64 emulation works; native macOS-arm64 parsing was not tested.
The successful Docker builds skip upstream tests.

For the full mapping benchmark, test a local Java adapter over
`ProjectASTDiff.getDiffSet()` and
`getMoveDiffSet()`, retaining each `ASTDiff`'s paths and `getAllMappings()`.
These APIs exist at the pin; their JS/TS outputs and coordinate fidelity remain
to be measured. Preserve independent inventory extraction when the engine
reports no refactorings. Confidence is **high** in this interface limitation
from the pinned result records; a successful export of the required complete
graph and inventory would change the adapter requirement.

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

The three cross-file pairs are now pinned and hand-checked; the ten development
controls and their checker are reproducible. The original probe/output are
recovered at research commit `cb0edb6`; their aggregate totals were not rerun
during this rebase. The pinned MCP smoke artifacts remain supplementary
development evidence, separate from the fixed research corpus.

The richer mapping adapter, independent inventory, and range-integrity checks
are now implemented in research. Next independently adjudicate more public
cross-file and mixed-edit cases, reconcile these supplementary controls with
the adapter, and assess reviewer benefit before product integration. Preserve
the fixed held-out split and report each corpus separately.
Defer persistent history identity, arbitrary repository clone search, move-aware
application, and transform-stage serialization. Product tests and renderer smoke
checks were skipped because this work changes planning fixtures only.
