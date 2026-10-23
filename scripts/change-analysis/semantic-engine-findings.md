# RefactoringMiner correspondence evaluation, 2026-10-22

## Decision

Continue evaluating RefactoringMiner’s **richer mapping API**, with an
independent inventory, parse preflight, and source-range validation. The tested
MCP refactoring list is useful evidence but is not a complete symbol inventory.
Do not wire its MCP success flag or refactoring labels directly into automatic
semantic filtering. No product implementation or dependency adoption follows
from this experiment.

Confidence **high** that it adds useful matching beyond the exact baseline on
these inputs: its normalized output supports 11 of 14 authored cross-file
relationships versus 6 for the exact probe. Their union supports 12. Confidence
**medium** in the next adapter step, and **low** in general accuracy or reviewer
benefit: positive cases are synthetic, historical scope is restricted, and no
human review task was run. Independent public cross-file examples or false
links on a broader adjudicated set could change the recommendation.

## Artifacts and reproduction

- [Corpus and sampling limits](semantic-corpus/README.md), with fixed inputs,
  expected relationships, inventory annotations, and ten held-out cases.
- [Native MCP responses and timing](results/semantic-eval-2026-10-22.json).
- [Exact-baseline score](results/semantic-baseline-score-2026-10-22.json).
- [Normalized declaration groups and score](results/semantic-normalized-2026-10-22.json).
- [Separate diagnostic inputs](semantic-corpus/diagnostics.json) and
  [responses](results/semantic-diagnostics-2026-10-22.json), excluded from the fixed score.

Engine source pinned at `e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`.
A sparse temporary checkout built successfully with `./gradlew shadowJar
--no-daemon --console=plain -x test`. Build warnings concerned Kotlin annotation
metadata and deprecated/unchecked APIs; upstream tests were not run. The jar
SHA-256 is `8f760b20a2be7552869cee1e1375008c76ac031c1c241f26cd55d32703887dce`.
Runtime: checksum-verified temporary Temurin JDK 21.0.13+9-LTS, macOS arm64,
Apple M1, 16 GiB RAM, Node v22.21.0, TypeScript 4.9.5. Java heap limit 2 GiB.
The JDK, Gradle cache, and engine checkout live under `/tmp`; no system Java,
Docker service, project dependencies, or app MCP configuration were changed.

From this research checkout, with its normal JS dependencies available:

```sh
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/check-semantic-corpus.js
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/run-semantic-eval.js \
  /path/to/jdk/bin/java /path/to/RefactoringMiner/build/libs/RM-fat.jar
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/normalize-semantic-eval.js
```

The local MCP client initializes protocol `2025-03-26`, lists the tools, calls
`refactoringminer_analyze` with file contents, and preserves native responses.
Per-request limits: 30 seconds, 50 paths, 1 MiB/file, 1,000 returned refactorings.
The same fixed 30 cases run twice without threshold or input tuning. Resource
measurement covers the whole JVM, not per-case memory allocations. It requires
macOS `/usr/bin/time -l` and `pgrep`; the research runner is not a portable product
adapter. The server reports version `development`, so the source pin and jar
digest, not that version string, identify this build.

## Measured cost on this corpus

The MCP initialization plus tool discovery took 600 ms. First-pass request p95
was 167 ms (maximum 764 ms); the second-pass p95 was 62 ms (maximum 72 ms), using
nearest-rank p95 over 30 requests per pass. Peak JVM resident memory reported by
macOS `time -l` was 248,430,592 bytes (237 MiB). These are two passes in one JVM,
not repeated cold starts or a representative 50-file load test. Native analysis
results agreed across both passes. No request timed out or truncated output.

Eleven operation groups recover 23 complete declaration endpoints, all uniquely
resolved against pinned source. Ten one-to-one local diffs reconstruct both
endpoint slices exactly; the inline group preserves its multiple endpoints.
The ten held-out cases contain four expected positive relationships: three
were supported by engine output versus one by the exact baseline. Most positive
cases are deliberately small, and this score is not calibrated natural-history
recall.

## What matched

The table counts labeled relationships, not all code or refactoring types.

| Capability in this corpus | Exact probe | Engine JSON plus range recovery |
| --- | --- | --- |
| Exact move and move/rename | Yes | Yes |
| Cross-file literal/operator edit | Abstains | Move relationship recovered; local diff still required |
| Moved class with nested edit | Unsupported | Class relationship recovered |
| Anonymous default function move | Unsupported | Function relationship recovered |
| Move with changed lexical/import context | Syntax correspondence only | Move label; no equivalence proof |
| Move-and-inline group | No | Group recovered, including target continuation |
| Cross-file extraction fixture | No | No matching operation group |
| Registration relocation fixture | Unsupported | No matching operation group |
| Whole-file relocation fixture | Exact correspondence | No refactoring result; native summary reports zero files |

There were no extra move/inline/class groups against these labels, and no
forced move on the retained-copy, duplicate-origin, shifted-line, unrelated
replacement, or unchanged-origin scope controls. This is a narrow observation,
not a production precision estimate. Non-move refactoring labels were not
included in the move score. The corpus and score expose all misses, rather
than dropping unsupported syntax from the denominator.

The ten small historical snapshots validate independently annotated function
inventories and continuations. They contain no positive cross-file labels;
they cannot support a claim about natural-history cross-file recall. The 60
comparisons from the prior [exact-symbol probe](symbol-correspondence-findings.md)
remain separate evidence and were not substituted for hand-labeled positives.

## Important integration failures

**Success does not imply complete parsing.** `control-10` supplies malformed
`export function invoiceTotal( {`. The exact probe marks the analysis partial;
the engine returns `ok`, zero refactorings, and no warnings. Its file counts
still include both supplied snapshots. An adapter must surface independent
parse diagnostics and must not interpret this as “no structural changes.”

**JSON coordinates are not complete character ranges.** Returned locations in
this sample have zero end columns. Declaration starts also exclude `export`.
The normalizer uses path, element kind, and complete line span as hints to
recover a unique declaration from the pinned source using TypeScript. It stores
zero-based, half-open UTF-16 offsets, original hints, full source text, and its
digest. All normalized declaration hints resolve uniquely in this corpus.
This does not validate arbitrary statement ranges or every language's coordinate
conventions. Retain unresolved hints instead of inventing endpoints.

**Matching is not inventory.** The whole-file relocation control returns zero
before/after files in the analysis summary even though the caller supplied one
on each side. Those counts reflect the differ's processed evidence, not all
input symbols. Retain the caller's inventory and scope independently.

**Refactoring labels do not explain every edit.** `control-03`, `mixed-03`,
`mixed-04`, and `mixed-06` contain literal/body edits inside accepted relocations.
The MCP response identifies operations; it does not export a complete nested
edit ledger. The research normalizer computes an ordinary diff between full
paired declarations and retains every changed byte. Inline groups remain
multi-endpoint groups rather than being flattened to one pair.

The engine also reports `Extract Variable` in the extraction fixture and
`Invert Condition` in the edited historical tour-orientation function. These
labels have not been accepted as complete explanations of either rewrite.
All non-move labels require separate adjudication before any semantic-hiding
feature; the 11/14 correspondence score does not measure their accuracy.

**Identical bodies can change behavior.** The binding fixture executes to 10
before and 20 after for the same input. Both detectors can match that function.
Every normalized group retains `behavior: unassessed`; neither a “Move Method”
label nor exact body bytes license suppressing the dependency/context edits.

## Supplemental diagnostics, after the fixed run

These cases were added after seeing the primary results and are not held-out
observations or additions to the 14-pair denominator.

A corrected extraction case includes the helper import and aligns the helper's
local variable with its old source. The engine returns `Extract And Move
Method`, plus `Extract Variable`. This supports extraction capability on this
example; it does not isolate whether the import or local-variable alignment
caused the difference from the frozen case. Preserve that original miss in
the primary score. The first request in this new JVM took 768 ms.

For the real Bygone `726796b1fe` rewrite, the diagnostic supplies every changed
`src/` TypeScript file, including complete added/deleted snapshots: seven paths,
258,687 combined input bytes. The engine takes 2.40 seconds and reports nine
refactorings: seven `Move Class` labels for the module, interface, and type-alias
representations, plus two parameter removals. The edited
`validateChangeTourDetails` appears in a `Remove Parameter` result; its removed
assessment validation remains a separate body edit to review. Three exact
function links recovered by the prior probe do not appear as individual move
records because the larger module mapping accounts for their context.

This confirms that `refactorings[]` is not a complete correspondence inventory.
Its generic `Move Class` labels also need language-specific presentation for
TypeScript aliases/interfaces and the synthetic `__module__`. A lower-level
mapping adapter must recover continuations under module movement and preserve
body edits. The 2.40-second diagnostic is not part of the tiny-corpus p95; no
50-file latency claim follows from either measurement.

## Gate outcome and next work

The engine adds six labeled relationships missed by the exact probe, but the
small-input result does not establish the 50-file latency target, broad accuracy,
or safer review. Parse completeness and statement-level evidence remain gaps.
No renderer, worker, tour schema, raw diff accounting, or copy/apply behavior
changed. Production compile/lint/test, accessibility checks, Python cases,
large-file stress, and reviewer studies were not performed.

Next, evaluate the engine API’s statement mappings for mixed changes, starting
with the now-reproduced public `726796b1fe` case. Independently hand-label more
public **cross-file** comparisons and score complete symbol continuations,
not only reported refactoring events. Check source coordinates and nested body
edits before attempting a product adapter. If those fail, retain an inventory plus exact
links rather than building a more permissive fuzzy matcher.
