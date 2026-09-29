# Tour presentation review

Status: Local UI investigation; proposed direction, not an implemented redesign.

## Evidence

Inspected the browser presenter at implementation commit `8a13735` on
`feat/review-comprehension`, using `examples/bygone-history.bygone`. Walked
through the first three steps at 1440×1000 and resized to 1100×800.
The example reviews the immutable range `292fe9248c5c49f762489dc688296fc100d120bc`
to `75b6d7c0303124ec314aa790d6b808c4a9d9ea0e`.

- Scene title, summary, bullets, and takeaway persist while the current step
  changes. The scene title is visually stronger than the current step title.
- The scene outline says “5 code steps” but does not expose their titles or
  direct navigation. The displayed position is “Ch 1 · Scene 1/1 · Step 2/5”.
- At the narrower viewport, the current step began at y=338 while the narrative
  viewport ended at y=295. Reading it required scrolling the narrative pane.
  At the wide viewport the narrative also overflowed (375px into 295px).
- Playback controls, voice selection, and device-voice status appear before
  the explanation even when narration is idle.
- “Walkthrough 3/110 · 3%” appears as a progress bar. It is authored hunk
  coverage, not the reader's progress through the five steps.
- In this added-file example, the absent base receives half the diff width.
  At 1100px the readable code occupies only the right portion of the workspace.
- The notes prototype introduces another reading location and closes it when
  following evidence. Its content overlaps the tour's existing explanations.

## Assessment

High confidence that the current-step visibility and hierarchy need correction:
the clipping and emphasis are directly observable. Moderate confidence that the
following design direction improves comprehension; that requires human use of
several tours, including multi-scene and stacked examples. The present example
may overstate the cost of empty before panes because several files are added.

## First design experiment

Make the active step the primary reading unit, adjacent to its code evidence.

1. Expand the current scene in the outline to show named, clickable steps.
   Highlight the current step and show simple “Step 2 of 5” navigation.
2. Put the active step title and explanation first in the narrative region.
   Keep scene context available through an explicit disclosure. Present the
   scene introduction and conclusion intentionally rather than repeating the
   entire overview with equal prominence at every step.
3. Keep one Listen control in the ordinary reading view. Reveal transport,
   voice, and speed controls when narration is used or settings are requested.
4. Move hunk coverage into clearly labeled tour details. Reader position and
   coverage must not share an ambiguous progress treatment.
5. Keep Files accessible with a clear return to the current step. Avoid forcing
   the full file list and the full outline to compete for equal vertical space.
6. Fold useful concepts, tradeoffs, and open questions into tour content for
   the trial. Do not make the separate review-notes panel a design dependency.

Preserve full prose and keyboard access. A smaller default header must not
truncate explanations; expanded context should scroll independently of stable
step navigation. Test resizing with long text before choosing fixed dimensions.

Separately explore a single full-width code pane for added/deleted files, with
an explicit “file added/deleted” label and an option to show both sides. This
touches the shared diff renderer and should not block the first presenter trial.

## Validation before accepting a redesign

- At 1440×1000 and 1100×800, the current step title and beginning of its
  explanation are visible immediately after navigation, without manual scroll.
- Readers can identify where they are and directly revisit a named earlier step.
- Scene context, full changed-file access, and return-to-tour behavior remain
  available without losing the selected step.
- Compare short and long prose, multiple scenes, stacked/deconstructed views,
  keyboard navigation, narration, and browser/desktop hosts.
- Ask a reader to explain a change and find its evidence; record navigation
  confusion and missed context. Do not infer comprehension from fewer controls.

This investigation did not change runtime code, run a comprehension study,
exercise desktop packaging, or audit assistive-technology behavior. The archived
April chrome redesign is historical reference, not a mandate to restore that UI.
