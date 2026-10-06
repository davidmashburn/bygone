# Reader-controlled visible panel count

## Status

Scoped proposal; not implemented. Extends the shipped
[focused multi-panel strip](focused-multi-panel-strip.md).

## Goal

Let readers display three or four ordered revisions together, without requiring
a larger window or giving up focused comparison and deliberate strip navigation.

## Current behavior and evidence

Inspected development `main` at `e228f86`, including the local connector fix.

- `media/focusedStripController.js` chooses only `panel` or `pair`. Two panes
  consume the available width; a wider window never reveals a third pane.
- `media/script.js` uses a 360 px pane minimum and a 96 px gutter.
  `applyFocusedStripLayout` anchors every selection to one panel or pair.
- `updateFocusedStripControls` and `getVisibleSearchTargets` independently
  assume that exactly one or two panels are visible.
- `media/connectors.js` draws only the active adjacent pair. All adjacent diffs
  and editor decorations already exist; extra visible panels do not require
  additional comparison jobs.
- The local Desktop fix redraws connectors throughout the strip's transform
  animation. A failing native regression demonstrated stale connector positions
  after a switch; this behavior must remain covered when layout changes.

This requires a viewport-state change, not just smaller CSS pane widths.

## Recommendation

Add **Visible panels: 2 / 3 / 4 / Fit** beside the existing strip navigation.
Keep 2 as the initial default and the narrow single-pane fallback.

Explicit counts let readers trade code width for revision context. Only Fit
automatically adds panels as the window grows. A resize should not change an
explicit selection unless the panes would become unusably narrow.

Keep the ordered, translated strip and existing editor font size. Avoid free
horizontal scrolling, a two-row grid, or pinning unrelated revisions in the first
implementation; those introduce additional navigation and comparison semantics.

## Interaction contract

### Density and readability

- Persist the reader's requested count locally per host, independently of tour
  documents, comparison membership, active pair, and file edits.
- Show at most the requested count and available panel count. Retain the request
  when visiting shorter scenes so a later longer scene restores it.
- Use equal pane widths. Preserve the current 96 px gutter in two-pane mode;
  trial a 48 px gutter for three/four-pane mode.
- Start with a 360 px comfortable pane width for Fit and a 280 px lower bound
  for explicit three/four-pane choices. These are trial values requiring visual
  QA with real code, wrapped lines, long paths, and editable headers.
- If an explicit choice cannot meet the lower bound, show the largest readable
  count and explain the result, e.g. **4 selected · 3 fit**. Do not silently
  overwrite the saved choice. Restore it when room returns.
- Do not shrink fonts or turn on word wrap automatically. Both remain reader
  preferences. Single-pane mode has no inter-panel gutter.
- Fit chooses the largest comfortable count up to four. Cap the first release
  at four to bound density and interaction QA.

For an illustrative 1,200 px code viewport, excluding outer padding and chrome:

| Choice | Visible panes | Gutter width | Pane width |
| --- | ---: | ---: | ---: |
| 2 | 2 | 96 px | 552 px |
| 3 | 3 | 48 px | 368 px |
| 4 | 3 fit; 4 retained | 48 px | 368 px |
| Fit | 3 | 48 px | 368 px |

Four panes at the proposed lower bound require 1,264 px of code viewport. These
figures are layout calculations, not usability measurements.

### Stable visible group

- Model the visible group separately from active panel and active pair.
- Selecting a panel or adjacent pair already fully visible changes focus and
  comparison state without sliding the track.
- Reveal an off-screen panel or pair by moving the visible group the minimum
  number of slots necessary. Preserve order and clamp the group at both ends.
- On initial load, put the active pair near the middle when possible. On resize
  or a count change, preserve the visible group where possible and keep the
  active pair visible; do not recenter on every click.
- Keep previous/next strip controls as comparison navigation while multiple
  panes are visible. They select the preceding/following adjacent pair and shift
  the group only if needed. Single-pane mode keeps panel navigation.
- Show **Panels 2–4 of 7** separately from **Comparing 3 ↔ 4**. History rail
  visibility styling and active selection must be distinguishable.
- Tour navigation reveals the requested panel/pair within this group and keeps
  the reader's density preference.

### Gutters and comparison semantics

- Each visible adjacent boundary remains clickable to activate its comparison.
  There is still exactly one active pair.
- Retain active-pair-only connector ribbons for the first release. Three/four
  panes show neighboring code as context; the active gutter explains which
  comparison owns the ribbons and global change navigation.
- Preserve current panel copy controls and their destination/read-only checks.
  Showing more panels must not redefine copy or change-navigation semantics.
- Draw connectors from live editor rectangles, including during motion, after
  Monaco layout, word wrap, sidebar resize, and density changes. Suppress them
  if both editors are not presented.
- Quiet ribbons in every visible adjacent gutter can be a separate evaluated
  follow-up. They are not necessary to deliver more visible panels, and could
  make several simultaneous comparisons harder to read.

### Search and editor state

- Visible-pane Find searches the complete visible group; comparison-wide Find
  still searches all panels. Derive both the position indicator and search
  targets from the same layout result.
- Do not recreate models/editors or recompute diffs just to change density.
  Preserve selections, edits, undo history, active change, and model-line
  anchors when Monaco re-layout changes wrapping.
- Keep existing synchronized multi-pane scrolling in the initial scope. Its
  current proportional mapping is a known limitation for divergent revisions;
  improving correspondence-based synchronization is separate work.

## Implementation scope

1. Extend the pure layout controller to accept the requested density and the
   previous visible-group start. Return effective count, pane/gutter widths,
   visible panel indexes, visible pair indexes, offset, and any fit limitation.
   Use `paneWidth = (viewportWidth - (count - 1) * gutterWidth) / count`.
2. Add local preference storage and a labeled, keyboard-accessible count picker
   in the shared renderer. Read the same state in Compare, History, and textual
   tour scenes. Binary, directory, and merge layouts remain unchanged.
3. Route focus/reveal and strip controls through the visible-group controller.
   Update position text, history rail styling, and visible Find targets together.
4. Apply grid widths and track transforms without model replacement. Preserve
   the connector animation fix and re-layout/reveal model anchors after changes.
5. Extend layout tests and the native panel-switch regression; validate Desktop
   first, then browser and VS Code shared-renderer behavior.

No new host protocol or tour format should be required for a renderer-local
preference. Confirm host storage behavior before choosing a shared storage key.

Deferred: arbitrary panel counts, independently resizable panes, pinned or
non-adjacent comparisons, revision reordering, multiple rows, automatic font
scaling, new scroll-synchronization algorithms, and editor virtualization.

## Acceptance and verification

- Three-pane mode works in a 1,200 px code viewport without enlarging the window.
- Four-pane mode works when the lower bound fits. Narrowing preserves the
  requested count and transparently reduces the effective count.
- Fit can expose a third/fourth panel on resize; explicit counts remain stable.
- Clicking either visible gutter changes comparison without moving panels.
  Off-screen navigation shifts only enough to show the destination pair.
- Panel insertion/removal, shorter scenes, and final-pair selection leave no
  clipped resting pane or stale active identities.
- Visible Find includes every displayed editor and excludes hidden neighbors.
- Editing, save, undo, read-only copy checks, change navigation, and tour anchor
  reveal retain their behavior at every supported count.
- Native geometry assertions cover forward/backward moves, interrupted motion,
  density changes, reduced motion, wrap, and sidebar resizing. Connector edges
  match the intended gutter after every settled layout.
- Pure tests cover 1/2/3/4/Fit, exact width boundaries, preserved visible groups,
  end clamping, and focus movement within/outside a visible group.

## Assessment and next step

Confidence is high that the two-panel ceiling comes from the layout controller;
the source is explicit. Confidence is moderate that equal-width three/four-pane
choices are the best interaction: validate a three-pane Desktop prototype before
committing to the trial width limits. Cramped headers, unreadable code, or users
needing one wide editor with small context panes would favor asymmetric widths
in a subsequent iteration.

The first implementation should deliver the count control and stable group as
one coherent change, with search and connector verification included. The
proposal has not been prototyped; its density limits and multi-pane usability
have not been manually tested.
