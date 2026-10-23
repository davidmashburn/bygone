# Change-analysis probes

Investigation scripts behind two planning documents on the `project-planning`
branch: `plans/text-block-move-tracking.md` (slice 0 findings) and
`ideas/verified-refactor-decomposition.md`. They measure; they are not product
code and are not part of `npm test`. Run `npm run compile` first: they load
`out/diffEngine.js` and `out/moveTracking.js`. Repository paths are arguments,
so results can be reproduced on any local clones.

## Move tracking

| Script | Question | Usage |
| --- | --- | --- |
| `move-ties.js` | How often does an exact move sit on an equally long alternative backbone, and which side passes the size gate? | `node move-ties.js <repo> [commits]` |
| `move-boundaries.js` | When a moved block's boundary line stays in the backbone, could an equally long alignment release it? | `node move-boundaries.js <repo> [commits]` |
| `move-volume.js` | How many exact moves, copies, and unresolved groups do ordinary commits contain? | `node move-volume.js <repo> [commits]` |

## Refactor decomposition

`classify.js` partitions every raw changed line of a commit into formatting,
semantic whitespace (Python/YAML indentation of logical lines; not counted as
explained), consistent rename, exact move, or residual. Formatting equivalence
covers whitespace and line wrapping, quote style for simple strings, trailing
commas (preserving Python one-element tuples), whole-expression grouping
parentheses, and TypeScript leading union separators and final type-literal
separators. Two outputs are optimistic estimates and never counted as
explained: `lineLevel` (it can match precedence changes) and `crossFile`
(residual lines found verbatim in another file of the commit).

| Script | Purpose | Usage |
| --- | --- | --- |
| `adversarial.js` | Real changes that must stay unexplained, and formatter changes that must be explained | `node adversarial.js` |
| `groundtruth.js` | Formatter output, synthetic renames, swapped top-level blocks, all combined, formatter-canonicalized, and one injected real change | `node groundtruth.js <repo> py\|ts [files]` (uses `uvx ruff` or `npx prettier@3`) |
| `refactor-spike.js` | Explained share for commits whose subject marks them `refactor`, `mechanical`, or `control` (`feat`/`fix`) | `node refactor-spike.js <repo> <group> [commits] > <dir>/spike-<label>-<group>.json` |
| `summarize.js` | Table over saved spike outputs | `node summarize.js <dir>` |
| `composition.js` | Refactor-commit lines in added, deleted, and modified files | `node composition.js <repo> [commits]` |

## Recorded results (2026-10-08)

Ground truth on 30 files each from Hamilton (Python) and T3 Code (TypeScript):
renames 100% explained in both; moves 89% / 98%; formatting 83% / 70%; all
three combined 68% / 28%, rising to 75% / 97% when both sides are first
formatted with the same formatter. None of 44 injected one-token real changes
was explained, and all 14 adversarial cases behaved as expected.

Real history (644 commits from marimo, Hamilton, T3 Code, and three private
repositories): `refactor` subjects 3% explained, `mechanical` subjects 7%,
`feat`/`fix` controls 1%. In refactor commits, 30–70% of changed lines are
whole added or deleted files, and 1–11% of modified-file lines are explained.
Subject labels are an unreliable sample, and line-weighted totals are dominated
by large commits.

## Cross-file symbol baseline (2026-10-22)

Read [findings and reproduction](symbol-correspondence-findings.md) before
interpreting the [saved Bygone report](results/symbol-probe-bygone-2026-10-22.json).
`symbol-probe.js <repo> [ref] [commits]` uses the installed TypeScript parser
(no compiled `out/` required). `node symbol-probe.test.js` runs the 13 policy
scenarios. Set `NODE_PATH` if using dependencies from a separate checkout.
It inventories only top-level named JS/TS functions and function variables,
reports equivalent syntax separately from raw equality, and never claims
behavior preservation. The exact baseline is a comparator for a future reusable
engine evaluation, not a new product matcher.

## Pinned engine evaluation (2026-10-22)

[RefactoringMiner findings](semantic-engine-findings.md) compare the fixed
[30-case corpus](semantic-corpus/README.md) against the exact probe, with native
MCP responses, normalized declaration groups, source checks, and timing/memory.
The separate diagnostics test corrected extraction and the real tour-details
rewrite without changing the frozen score. Run `check-semantic-corpus.js`,
`run-semantic-eval.js <java> <jar>`, `normalize-semantic-eval.js`, and
`check-semantic-results.js`, with `NODE_PATH` if needed. These scripts do not
require compiled product output and are not part of `npm test`.

## Richer mapping adapter

[Implementation and reproduction](refactoring-mappings.md) describes the
original Java API bridge, independent JS/TS inventory, validated source spans,
full local edits, exact fallback, and grouped extraction/inline evidence.
It recovers function continuations beneath module moves and exposes the removed
validation in the public tour-details rewrite. Explicit JDK/jar paths are
required; this does not install a product dependency or global MCP server.

## RefModel-style model hypotheses

[Experiment and reproduction](refmodel/README.md) compares the pinned upstream
prompt with an evidence-constrained variant on the same 32 comparisons, using
authenticated Codex following the user's model preference.
[Findings](refmodel-findings.md) distinguish source-valid outputs, inferred
operations, residual edits, and catalog limitations; they are not a product
matcher or a population precision estimate.
