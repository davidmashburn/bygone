# Multi-panel highlight union and pair focus

## Status

Approved for implementation on main, 2026-10-15.

## Decision

Show the union of changes from adjacent comparisons by default. Use the existing
blue replacement and green one-sided change colors for blocks, connectors, and
boundaries. Blue union removes pair color distinctions; it does not remove
change-type colors. A middle panel answers “this changed” without encoding which
neighboring revision caused every highlight. Preserve existing two-way
colors and behavior.

Add an easily discoverable **Focus selected pair** toggle, off by default.
When enabled, only the selected pair's blocks, inline spans, boundaries, and
connectors are highlighted, using that pair's change-type colors. Switching pairs
keeps focus enabled; switching focus or pairs preserves scroll position. Change navigation remains
scoped to the selected pair. Keep the existing pair selector and copy semantics.

Compute a real union of overlapping line and word ranges; do not stack opacity,
extend highlights across unchanged gaps, or change source alignment to achieve
the effect. When a shared line is one-sided in one pair and replaced in another,
replacement blue takes precedence; focus reveals each pair’s own classification.
Keep each gutter's connectors attached to its own source blocks.
Support more than three panels and the existing visible-panel controls.

## Why

Interactive mockups with dense prose, overlapping edits, insertions, and
deletions favored a quiet default over continuously exposing ownership.
Focus provides the distinction when the reader needs it. The main cost is an
extra interaction to distinguish “before,” “after,” and “both” in a middle panel.
Confidence is moderate until the implemented view is exercised on real prose;
frequent compulsory focus toggling would be evidence to reconsider.

## Alternatives

- [Alternating comparison colors with horizontal splits](../ideas/alternating-comparison-colors.md)
  is **shelved**, not rejected permanently.
- Fading the non-selected comparison and showing inline words only for the
  selected pair were considered in both blue/violet and blue-only mockups.
  Neither is selected or exposed as another production mode.

## Validation and boundaries

- Verify both adjacent pairs, focus transitions, navigation over the full real
  three-way Markdown fixture, and the actual rendered connectors and highlights.
- Cover partial overlap, nested/identical ranges, unchanged gaps, one-sided
  changes, empty/unchanged pairs, three/four panels, and existing two-way behavior.
- Use invented regression text only. Private review documents, screenshots,
  repository locations, and internal links do not belong in planning commits.
- No diff-algorithm redesign, alternative-mode picker, or broad palette redesign.
  The broader [color design pass](color-and-highlighting-design.md) stays deferred.
- Local implementation and preview are authorized; publishing and replacement
  of the installed app require separate authorization.
