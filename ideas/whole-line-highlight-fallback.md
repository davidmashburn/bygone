# Whole-line highlighting when word matches become fragmentary

## Status

Exploring, 2026-10-15. This note captures a proposed presentation fallback and
research questions, not an approved implementation or a completed usability
study. Evidence below comes from local source inspection and the current
highlighting investigation; no external literature review was performed.

## Question and working recommendation

When a replacement leaves only scattered unchanged fragments, would one uniform
whole-line treatment communicate the edit better than many word highlights?

The working recommendation is to preserve detailed highlights when unchanged
context helps locate the edit, and use a single blue line treatment when that
context becomes unhelpfully fragmented. Suppress inline change fills on a line
using that fallback. Keep green's existing meaning of one-sided content; poor
word matching does not turn a replacement into an insertion or deletion.

Confidence is moderate in the presentation direction and low in any specific
heuristic. Reader comparisons that show slower or less accurate edit detection,
especially for short but important changes, would change the recommendation.

## What prompted this

The recent local fix restored detailed highlights for long paragraphs and
expanded instructions. The previous 500-character cutoff and restrictions on
comparing unmatched groups could leave changed replacement lines without word
emphasis. The working implementation raises the length allowance, bounds word
diff work, and compares unmatched gaps between established alignment anchors.
Unavailable detail now receives an explicit `≠` indicator; line-ending-only
differences also remain visible and navigable.

That fixes missing information, but exposes a separate presentation problem:
an extensive rewrite can have an exact textual diff whose surviving spaces,
punctuation, word endings, or isolated words contribute little useful context.
Exact matching alone does not establish that its presentation aids reading.

These observations describe uncommitted development work at the time of writing.
They are not a claim that the fallback discussed here already exists.

A subsequent independent review identified a boundary case, reproduced locally:
`The item is here.` → `The item\n is here.` produces a replacement with
`hasChanges: true`, but every word segment is context and there is no `≠` marker.
The line-level treatment remains. This does not report the files as identical,
but raises a separate question: should source-line reflow receive an explicit
formatting cue even when all words are preserved? Include it in evaluation;
do not treat preserved words as evidence of an identical source line, or label
an intentional reflow treatment as a computation failure.

## Existing behavior and implementation touchpoints

Paths below refer to the development checkout; the orphan planning branch does
not contain application source.

- `src/diffEngine.ts`: `applyInlineHighlightPair` and
  `applyWrappedReplacementHighlights` produce word segments. The latter compares
  unmatched gaps while preserving physical row alignment. Edge trimming retains
  shared grapheme prefixes and suffixes within changed words.
- `media/script.js`: line decorations identify replacements and one-sided
  changes; `addInlineDecorations` adds word emphasis and omitted-detail markers.
- `media/style.css`: replacements already have a faint blue line fill, with
  stronger blue inline fills. A uniform fallback could retain that line fill or
  use a different strength; the strength has not been selected.
- `media/decorationUtils.js`: `unionChangeDecorations` merges change ranges and
  gives replacement blue precedence over overlapping one-sided green in shared
  panels. A new treatment must participate in that resolution.

## Candidate decision signals

Evaluate the usefulness of unchanged context, rather than using changed
percentage as the sole trigger. A long insertion beside one intact sentence
may still benefit from precise highlighting.

| Signal | Possible use | Limitation |
| --- | --- | --- |
| Longest contiguous unchanged phrase | Preserve detail when a recognizable phrase anchors the edit | Character length alone overvalues repeated punctuation or boilerplate |
| Complete unchanged words or identifiers | Distinguish useful anchors from shared word endings | A single identifier can matter more than several prose words |
| Number and size of unchanged islands | Detect a fragmented presentation | Many small edits can still be useful to inspect individually |
| Changed proportion | Support a fallback decision for extensive rewrites | A high proportion does not imply useless context |
| Type and position of a small edit | Protect numbers, operators, negation, and short identifiers | Requires care across languages and prose; avoid English-only rules |

Start with a small deterministic policy over existing segments. Do not add a
semantic model or change alignment to obtain a visual result. Compare no
heuristic, a simple proportion threshold, and a context-aware candidate before
selecting thresholds. Thresholds remain open until representative fixtures have
been inspected.

## Presentation and overlap rules to investigate

1. Keep three states distinguishable: detailed word changes, deliberately
   simplified presentation, and detail unavailable because computation was
   bounded. Simplification should not claim that word matching failed. Preserve
   exact segments underneath if feasible; choose whether an explanatory hover
   or detail reveal is needed after evaluation.
2. Resolve paint once per visible line. Do not add another blue or green fill
   on top of the existing line treatment, or leave strong inline fills beneath
   the uniform treatment. Selection, search, and tour emphasis retain their own
   meanings.
3. In a shared panel, test the case where one comparison requests uniform
   treatment and the other has useful precise highlights. Candidate behavior:
   uniform treatment wins in the union view, while focusing a pair restores that
   pair's chosen detail. This costs precision in the default view and needs
   explicit evaluation before adoption.
4. Choose the decision unit deliberately: physical line, aligned pair, or
   unmatched group. Prefer a local decision so one rewritten line does not hide
   a useful edit elsewhere. Unequal line counts and prose reflow complicate
   symmetric decisions; do not invent line correspondences to make them match.
5. Make the decision independent of viewport wrapping. Resizing may change the
   visual rows, but should not change which source text qualifies for detail.
   Empty lines and line-ending-only changes still need a visible non-text cue.

## Evaluation fixtures

Use invented text only. Do not copy private review documents, screenshots,
repository locations, or internal links into planning or regression fixtures.

| Case | Desired property to test |
| --- | --- |
| “Bring the copper badge to the north desk.” → “Leave a violet ribbon beside the south entrance.” | Compare uniform treatment with fragmented matches in a broad rewrite |
| An intact sentence followed by a long new instruction | Preserve useful precise insertion detail despite high changed proportion |
| “Ship 12 crates.” → “Ship 21 crates.”; adding “not” to an instruction | Small consequential edits stay easy to locate |
| Renaming `cachedTotal` to `cachedCount` | Shared identifier fragments can remain useful; do not discard them categorically |
| Multiple independent small edits in one long paragraph | Do not mistake edit count alone for poor matching |
| One paragraph split across several lines, and the reverse | Preserve reflow and alignment behavior |
| Three- and four-panel chains with overlapping replacements and one-sided changes | No stacked change fills; focus exposes each pair accurately |
| Timeout, oversized input, whitespace-only changes, and final newline differences | Changed content never looks identical; unavailable detail remains explicit |

Reuse and extend the invented workshop fixture in `test/proseDiffFixture.js`.
Inspect real Monaco rendering in light and dark themes, at narrow and wide
widths, with selection/search over the same text. Model assertions alone cannot
establish that composited fills are readable or that inline fills are absent.

## Research exit criteria

- Show baseline and candidate treatments on the same synthetic cases. Ask
  readers to locate and describe edits; record errors and hesitation separately
  from aesthetic preference. State who participated and what was not tested.
- Select or reject a deterministic heuristic using those results. Document
  known counterexamples, especially short meaningful edits and identifiers.
- Settle line versus group decisions, shared-panel precedence, fill strength,
  and the explanation for deliberate simplification.
- Verify the proposed renderer behavior does not stack change fills, report
  unequal content as identical, or alter alignment, navigation, or source text.
- If the evidence supports implementation, move the chosen scope into `plans/`
  with targeted model and renderer checks. Keep palette redesign and move
  tracking outside this work.

## Related planning

- [Multi-panel highlight union and pair focus](../plans/multi-panel-highlight-union.md)
- [Color and highlighting design pass](../plans/color-and-highlighting-design.md)
- [Conservative replacement blocks](../plans/conservative-replacement-blocks.md)
- [Wrapped diff marker layout artifacts](wrapped-diff-marker-layout.md)
