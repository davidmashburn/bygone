# RefactoringMiner mapping adapter

Implemented locally on `research/move-tracking-slice0`, 2026-10-22, from research
baseline `3f8fa02`. This is an executable research adapter, not a shipped Bygone
feature. It uses the same pinned external jar as the earlier
[engine evaluation](semantic-engine-findings.md), and does not change Bygone's
renderer, ordinary diff, coverage accounting, CLI, or dependencies.

## What it does

The small original [Java bridge](refactoring-miner/BygoneMappingsBridge.java)
calls `diffAtFileContents`, then exports:

- Class/type correspondences from common, moved, inner-moved, and renamed class
  diffs. Synthetic module containers remain evidence, not fake user symbols.
- Operation-body mappers from those diffs, including continuations beneath
  module movement that do not appear in `refactorings[]`.
- Explicit move/rename/extract/inline mappers, child/lambda evidence, paired
  fragments, and unmapped leaves/inner nodes.
- Raw UTF-16 half-open offsets, literal source slices, and SHA-256 digests.
  `engineExact` is retained as an engine observation, never an equivalence claim.

It passes copies of the file maps to the engine: the API removes identical
files while building its model. The caller's original snapshots remain the
source of truth for coordinates and inventory.

[symbol-inventory.js](symbol-inventory.js) independently parses JS/TS snapshots.
It enumerates named declarations, interfaces, aliases, enums, classes/members,
anonymous defaults, and direct nested declarations. It retains body-less
overloads as separate occurrences. Unsupported languages, namespace members,
destructuring, registration statements, and callback expressions are explicit
exclusions. A file with parse errors has diagnostics instead of a misleading
empty symbol list. There is no Python extractor in this adapter.

[refactoring-mappings.js](refactoring-mappings.js) binds engine containers to
unique independently inventoried occurrences. It verifies every accepted span
against the original text and digest, then keeps full declaration diffs and
unmapped statements. Exact declaration fallback covers unique identical symbols
that the engine's identical-file pruning omits. Repeated occurrences remain
competitors; conflicting incoming or continuation edges stay unresolved.
Extraction/inline evidence remains a separate group and does not consume a
container as a one-to-one continuation. Nested declarations overlap for
navigation; these relations are **not** a partition of raw changed-line counts.

The result includes inventory, inferred relations, operation groups, unmatched
occurrences, rejected engine containers, invalid evidence, input/processed scope,
and completeness. An unmatched entry means no accepted counterpart in the
supported supplied scope. All relationships retain `behavior: unassessed`.
Complete means analysis completed for the declared scope, not universal
semantic coverage or proven accuracy.

## Real rewrite outcome

On pinned public commit `726796b1fe`, the adapter independently inventories
169 before and 146 after declarations. It produces 146 inferred continuations
in total, including six cross-file functions under the module movement:

`validateAudience`, `isRecord`, `requireString`, `requireStringArray`,
`requireOnlyKeys`, and `validateChangeTourDetails`.

The latter includes its removed `validateAssessment(value.assessment, ...)`
call both as an unmapped old statement and in the full declaration diff.
It also retains changes to parameters and allowed keys. Five unchanged
aliases/interfaces and the edited `ChangeTourDetails` interface have separate
cross-file correspondences. Repeated helpers are linked through their explicit
module/body-mapper context; that is stronger evidence than arbitrary exact-text
source selection, but remains inferred correspondence, not recorded history.

Source slices and coordinates were verified; the 146 correspondences were not
all independently adjudicated for identity or behavior. Engine synthetic module
containers and unsupported nested containers remain in `rejected`. This scope
is useful for the example without claiming a complete language-level model.

Reports:
[original 30 cases](results/refactoring-mappings-corpus-2026-10-22.json) and
[corrected extraction plus real rewrite](results/refactoring-mappings-diagnostics-2026-10-22.json).
These are separate from the frozen MCP score; the older 11/14 result is not
silently replaced by this adapter's richer output.

## Bounds and failures

[The runner](run-refactoring-mappings.js) accepts explicit JDK/jar paths, checks
the expected jar digest, compiles the bridge in a fresh temporary directory,
and uses a separate JVM for each comparison. Default limits are 50 paths,
1 MiB/file, 4 MiB combined input, 20,000 exported records, 30 seconds, 16 MiB
stdout, and a 2 GiB Java heap ceiling. These limits bound a research process;
they are not a latency or memory benchmark. Per-comparison processes add cold
startup cost; a production runtime strategy remains undecided.

Malformed input is stopped before engine execution. Timeout, process failure,
bad JSON, output overflow, and export truncation remain explicit. Partial
engine candidates are not promoted solely because competitors were omitted.
When analysis fails, independent inventory and exact evidence remain available;
over-budget input explicitly reports inventory unavailable rather than empty.
Parser diagnostics and exclusions are preserved regardless of engine status.

## Reproduce and verify

Use a JDK with `java` and sibling `javac`, and the externally built jar from
source `e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`. The default expected jar digest
is recorded in the runner. If rebuilding produces a different jar, verify its
source/build and pass that digest as the optional final argument. Nothing is
downloaded or configured globally by this adapter.

```sh
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/run-refactoring-mappings.js \
  /path/to/jdk/bin/java /path/to/RM-fat.jar \
  scripts/change-analysis/semantic-corpus/diagnostics.json /tmp/mappings.json

NODE_PATH=/path/to/bygone/node_modules node --test scripts/change-analysis/refactoring-mappings.test.js
MAPPING_JAVA=/path/to/jdk/bin/java MAPPING_JAR=/path/to/RM-fat.jar \
  NODE_PATH=/path/to/bygone/node_modules node --test scripts/change-analysis/refactoring-mappings.integration.test.js
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/check-refactoring-mappings-report.js
```

Verification performed: 13 unit tests; 4 integration checks including actual
JVM timeout/export/output failures; all 32 input comparisons; source-digest and
ownership reconciliation; 239 complete local diffs reconstructing both endpoint
texts; 1,991 attached fragment mappings validated against source slices; targeted
lint using this branch's rules and the main checkout's installed dependencies.
Temporary configuration only resolves those existing dependency imports; no
lint rules were relaxed. The supplied JS/TS function inventories and old frozen
MCP report were not used as semantic ground truth for new matches.

Not performed: product build/full test suite, renderer/accessibility smoke,
upstream engine tests, Python inventory, broader natural-history precision or
recall, a new performance benchmark, or a reviewer-comprehension study. Product
code and packaging did not change, so no product installation was run.
