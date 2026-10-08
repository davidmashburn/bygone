# Verified refactor decomposition

## Status

**It's complicated.** Explored 2026-10-08 and paused. The checking method
works when a change really is mechanical, and it did not misclassify any real
change in the tests. But real "refactor" commits are rarely mechanical, so
automatically explaining existing history would seldom produce the intended
result. The value lies in *authoring* decompositions and having Bygone verify
them, which was not prototyped.

Evidence comes from the probes in `scripts/change-analysis/` on development
branch `feat/move-tracking-slice0`, whose README records commands and results.

## Summary

Show a large commit as a chain of checkable transforms followed by its real
change, so a reader can see that "+1,240 / −1,198" is mostly mechanical:

```text
base ──format──▶ S1 ──rename──▶ S2 ──reorder──▶ S3 ──residual──▶ head
+1,240 / −1,198 lines
  1,150 explained: 610 formatting · 402 rename (3 identifiers) · 138 moved
     88 real change
```

Each intermediate snapshot is generated: Bygone applies the stated transform
to the previous one and checks it. The last snapshot must equal the commit's
real result, as deconstructed tours already require. Adjacent diffs stay small,
and the final one is the only real change.

The goal is to make deep, behavior-preserving refactors (renames, reorders,
reformatting, light rewrites) cheap to review and therefore worth doing, and
to let someone factor a messy commit into mechanical adjustments plus real
changes.

## Why it might matter

- Refactors are discouraged because their diffs look enormous and risky. A
  verified breakdown turns "trust me, it's just a rename" into evidence.
- A "real change only" view focuses review on what can break.
- Agents produce large mixed commits; a decomposition is a natural artifact for
  an agent to author and for Bygone to check.
- It reuses the multi-panel strip, deconstructed stages, exact final-state
  checking, tours, and narration.

## Evidence levels

Never present a weaker claim as a stronger one.

| Level | Examples | What Bygone can show |
| --- | --- | --- |
| Identical tokens | whitespace, wrapping, quote style, insignificant trailing commas | Token streams match under the language's rules |
| Mechanical | consistent rename, block move/reorder | The transform was applied consistently; not proof that behavior is unchanged |
| Claimed | `any(x == y for y in ys)` → `x in ys`, reordered independent statements | Only with attached evidence (tests at both ends, author statement); never labelled verified |
| Change | everything else | Shown as real change |

"Mechanical" carries caveats the UI must state: rename collisions and
shadowing, string or reflection references, public API names, statement order
with side effects, decorator order, CSS cascade, and YAML/list order.

## What the spike found

**When the change is mechanical, the method works.** Ground truth on 30 real
files each from Hamilton (Python) and T3 Code (TypeScript):

| Transform | Python | TypeScript |
| --- | --- | --- |
| Rename | 100% | 100% |
| Move | 89% | 98% |
| Formatting (`ruff`, `prettier`) | 83% | 70% |
| All three combined | 68% | 28% |
| Combined, both sides first run through the same formatter | 75% | 97% |

None of 44 injected one-token real changes was explained, and 14 adversarial
cases (precedence changes, a removed one-element tuple comma, edits inside
docstrings, Python lines re-indented into another block) behaved correctly.
Line-level token matching inside mixed hunks is unsafe (it matched a precedence
change) and must not count as explanation.

**Real "refactor" commits are mostly not mechanical.** Across 644 commits from
marimo, Hamilton, T3 Code, and three private repositories:

| Commit subject | Commits | Explained |
| --- | --- | --- |
| Starts with "refactor" | 194 | 3% |
| Mentions format, rename, move, reorder, sort imports | 224 | 7% |
| `feat`/`fix` controls | 226 | 1% |

In refactor commits, 30–70% of changed lines are whole added or deleted files
(module splits and moves), and only 1–11% of modified-file lines are
mechanical. Lines found verbatim in another changed file add an estimated 14%
(20–27% in Hamilton and marimo). Hand review found semantic rewrites ("replace
lodash with built-ins", "consolidate implementations"), light algorithm
rewrites (marimo `775012ba3`), and commits labelled refactor that also add tests
and change behavior (T3 Code `2a9832b80`). Subject labels are an unreliable
sample, and line-weighted totals are dominated by large commits.

**Interpretation.** Clean refactor commits are rare, which is consistent with
the premise that they are hard to produce today. The method can verify them
when they exist; it cannot conjure explanation for code that was genuinely
rewritten. That shifts the product from "explain any commit" to "author and
verify a decomposition".

## Transform types

| Transform | Check | Spike evidence |
| --- | --- | --- |
| Formatting | Canonical token streams equal; logical-line indentation unchanged for Python/YAML | 70–83% alone; a trusted formatter applied to both sides is much stronger, but needs each project's formatter and configuration |
| Rename | A commit-wide consistent identifier map turns old tokens into new | 100% on synthetic renames; real renames that keep the old name elsewhere are deliberately rejected |
| Move / reorder | Exact block relocation on normalized lines, renames applied first | 89–98% within a file; the base diff's closing-line reuse truncates some moves |
| Cross-file move, module split | Not built | The largest real-world gap |
| Claimed rewrite | Region pairs with attached evidence | Not built; the most common real refactor content |

Ordering matters: canonicalize formatting, apply renames, then match moves.
Applying renames first turns many "edited moves" into exact moves, avoiding the
precision risk of fuzzy similarity.

## Relationship to existing work

- [Deconstructed diffs](../plans/deconstructed-diffs.md) assign whole Git hunks
  to stages. A hunk mixing a rename with a real change cannot be split, and one
  rename spans many hunks. This idea needs **transform stages**, which generate
  text from the previous stage, alongside hunk-selection stages.
- [Text-block move tracking](../plans/text-block-move-tracking.md) becomes one
  transform layer. Its exact analyzer, accounting invariants, and corpus carry
  over. Copy detection matters less here; an extraction appears as a move.

## Workflows

1. **Read:** Bygone proposes formatting, rename, and move layers, shows the
   breakdown, and offers a "real change only" view. Expect low explained shares
   on typical commits.
2. **Factor:** an author or agent writes the decomposition; Bygone checks every
   transform and the final state. Optionally export a stack of commits
   (mechanical first, behavior change last) with per-step build or test checks.
3. **Encourage:** a "mechanical only" claim on a commit or branch that Bygone
   verifies, e.g. "2,438 lines changed · 0 real change".

## Precedents

- VS Code shows same-file moved blocks, including lightly edited ones, behind
  `diffEditor.experimental.showMoves` (off by default). No summary or
  decomposition.
- [SemanticDiff](https://semanticdiff.com/) hides formatting-only changes, shows
  moves, and groups refactorings across many languages. Closest precedent; not
  evaluated hands-on.
- Git `--color-moved`, GumTree, and RefactoringMiner (see the
  [move-tracking research](../plans/text-block-move-tracking-research.md)).

Bygone's distinct angle would be verified, narrated stages and factoring into
commits, not language-aware hiding alone.

## Open questions

- Formatter canonicalization: discover the project's formatter and
  configuration, or require it to be declared? How is the formatter's own
  correctness represented?
- Cross-file moves and module splits: what index and presentation are needed?
- What do "Claimed" items look like so they are useful without implying proof?
- How are transform stages authored in `.bygone`, and how do they coexist with
  hunk-selection stages?
- Do exported intermediate commits need to build? What happens when they don't?
- Would a deliberately authored refactor (or an agent-factored messy commit)
  reach the high explained shares the ground truth suggests? Untested.

## Possible next steps

1. Factor two or three real messy commits by hand (or with an agent) into
   mechanical and real stages, and run the classifier per stage. This tests the
   authoring workflow the spike points to.
2. Prototype formatter canonicalization against one repository with a known
   formatter configuration.
3. Scope cross-file moves using the verbatim-line estimate as the baseline.
4. Prototype a transform stage (rename) inside a deconstructed tour.
