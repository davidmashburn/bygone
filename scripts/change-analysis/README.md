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
