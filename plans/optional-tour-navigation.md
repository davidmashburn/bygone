# Predictable navigation through optional tour detail

## Status and goal

Proposed, 2026-11-02. Planning only; implementation is not started by this
document. Readers should be able to predict what will be read, what will be
skipped, and where each navigation action will land. Optional depth must not
make the main tour harder to follow.

Implementation baseline: `feat/optional-tour-branches` at
`b4c4a74b9fb3caa085ee1865db5c1e10acfb56fc`, plus the current uncommitted
optional-branch work. That work is a dependency, not part of the named commit.
The planning branch is `project-planning`; never merge its orphan history into
the implementation branch. Recheck the working tree before implementation.

Related: [tour reasoning and salience](tour-reasoning-and-salience.md) and
[text-to-speech](tour-text-to-speech.md).

## Current behavior and required delta

The local branch already represents optional paths, scopes step navigation and
narration to the active path, stops at branch ends, and distinguishes outline
expansion from entering detail. It also has named return controls and an action
that leaves all detail for the next main step. Current return bookkeeping saves
scroll position; restoring the originating narration sentence needs work.

Keep this route model. Add consistent keyboard/button actions and explicit
destinations. Separate movement within a path, movement between parent and
child paths, and visit history. Do not make Previous depend on visited branches.

## Proposed interaction contract

- **Left/Right: Previous/Next step.** Move within the current path, skipping
  child paths in both directions. Next is also how readers skip unopened
  optional detail; no separate skip shortcut is needed. Preserve PageUp/PageDown
  aliases where they already apply.
- **Shift+Left/Right: Previous/Next sentence.** Retain narration controls and
  their playback-state semantics. They must not implicitly enter or leave a
  branch. Disabled states and keyboard behavior must agree.
- **Enter: Drill into detail**, only when the reading surface has focus. Enter
  directly when one path is available; show a keyboard-accessible chooser when
  several are available. With none, do nothing. Do not silently pick a branch.
- **Escape: Return to parent.** Leave one level and restore the owning step,
  sentence, and scroll position. An open dialog or chooser consumes Escape
  first. At the main path, Escape has no tour-navigation action.
- **Branch boundaries:** Previous at the first step and Next at the last step
  are disabled. Narration stops at the end. Offer a named Return action and,
  at the end, **Continue [parent path] → [next step]** when that destination
  exists. Continue advances past the owner on the immediate parent path; it
  does not recursively climb or silently jump to the main tour.
- **Nested detail:** return unwinds one level. If an all-the-way-main action
  remains, keep it distinct and explicitly named; never bind it to Previous.
- **Direct entry:** search/deep links identify the active path. With no saved
  return position, Return goes to the owning step's beginning. Missing parent
  successors produce no Continue action.
- **Focus:** normal Enter/Space activation on focused controls takes precedence.
  Do not intercept editing, text-selection, widget, or browser-history keys.
  Move focus predictably after entry/return and expose shortcut help.

Entering optional detail and returning should not start idle narration.
Before coding, specify playing/paused transitions against the existing playback
controller. Trial a paused return at the saved sentence, with explicit Resume;
record the chosen rule rather than changing audio behavior incidentally.

## Communicating the reading path

Use one set of step controls and one narration transport, with visible
destination titles and useful accessible names. Show the active path and
position, optional detail available at the current step, and the next reading
destination. Communicate skipped detail without repeatedly narrating UI help.

Outline expansion only reveals choices. It must not enqueue detail, change the
active path, or start audio. Distinguish current reading position from keyboard
focus, expanded groups, and previously visited items. Keep main-tour progress
separate from optional-path progress.

## Implementation slices

1. **Specify and trial the transitions.** Use the existing optional-branch
   fixture to cover main A → B, detail A1 → A2, a nested branch, and multiple
   branches at A. Confirm Enter/Escape discoverability and branch-end friction
   with a real tour before treating the keymap as settled.
2. **Centralize action resolution.** Extend the existing reading/navigation
   helpers so keyboard, buttons, destination previews, disabled states, and
   narration share target resolution. Use named domain types for finite
   actions and outcomes. Preserve stable step IDs, serialized format, and
   existing invalid-target handling. Store return context per nesting level,
   including narration position; clear stale context when the tour changes.
3. **Wire reader controls and narration.** Add scoped entry/return shortcuts,
   branch selection, focus restoration, and one-level Continue. Reconcile
   existing all-detail exit behavior. Preserve Compare/History shortcuts.
4. **Validate and document.** Exercise the same fixture in live and offline
   presenters; then trial a real Tour Shelf tour. Document the final controls
   and update tour-authoring guidance only where needed to match their behavior.

Start with `src/tourReading.ts`, `src/tourNavigation.ts`,
`src/tourNarrationPlayback.ts`, and `web/host.js` (shortcut handlers,
`openTourBranch`, `returnFromTourBranch`, and branch navigation). Relevant
verification surfaces are `test/tourReading.test.js`, existing narration
tests, `test/optionalBranchesFixture.js`, and `standalone/tourBranchesSmoke.js`.

## Acceptance and verification

- Right from A reaches B without reading A1/A2. Left from B returns to A,
  whether or not its detail was previously visited.
- Entry reaches A1; Right reaches A2; Left returns to A1. Boundary arrows never
  change hierarchy. Escape from either returns to the saved position in A.
- Nested entry/return restores each level independently. Continue targets the
  immediate parent's next step, including when that parent is optional.
- Multiple branches require a deliberate choice; cancel preserves position.
  Deep-link entry and a parent with no successor have deterministic outcomes.
- Narration never reads an unselected branch. Check idle, playing, and paused
  states; sentence boundaries; branch completion; return/resume; and stale
  speech callbacks after navigation. Listen to actual audio, not only mocks.
- Buttons and shortcuts resolve to identical destinations. Focused editors,
  disclosure widgets, dialogs, and normal button activation retain their keys.
- Live and offline presenters show the same route and controls. Check narrow
  layouts, visible focus, accessible names, disabled states, and a screen reader.
- Run focused transition/playback tests and browser smoke tests, then repository
  lint/type checks and the required suite. Record exact results and any skipped
  platform or assistive-technology checks.

## Scope, evidence, and remaining uncertainty

No new branching schema, route editor, arbitrary history system, shortcut
customization framework, bulk tour rewrite, release, installation, or publishing
is included. Existing authoring guidance favoring one optional layer remains;
the reader must still handle already-supported nesting correctly.

[DAISY reading requirements](https://daisy.github.io/reading-apps-ux-reqs/requirements/published/FINAL-20251031/)
support same-level navigation and an explicit return after following a reference.
[DAISY's skipping/escaping distinction](https://daisy.org/news-events/articles/skippable-and-escapable-elements-in-epub-3/)
supports separating bypassing detail from leaving it after entry.
[W3C tree conventions](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/)
use Left/Right for hierarchy, which conflicts with the established reader step
controls. Do not partially apply those conventions to the reader. These sources
support the separation of actions, not the exact proposed Enter/Escape mapping.

Confidence is high in separate structural navigation and hierarchical return;
medium in the keymap and stopping at branch boundaries. A real-tour trial showing
frequent boundary confusion or assistive-technology conflicts should change those
choices before broader implementation.

Prior session validation reported 608 passing tests, legacy checks, lint, and
live/offline branch smoke coverage. These are inherited baseline results, not
verification of this proposal. This planning pass inspected repository state and
navigation entry points; it did not rerun tests, listen to audio, or validate
real Tour Shelf and screen-reader behavior. Local remote-tracking refs were not
refreshed. Next action is slice 1; resume only when implementation is requested.
