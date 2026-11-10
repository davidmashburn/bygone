# Predictable navigation through optional tour detail

## Status and goal

Implemented locally, 2026-11-05, on `feat/optional-tour-branches`; not yet
committed or released. Automated and browser checks pass; human usability,
actual audio, and assistive-technology trials remain open. Readers should be
able to predict what will be read, what will be skipped, and where each
navigation action will land. Optional depth must not
make the main tour harder to follow.

Implementation baseline: `feat/optional-tour-branches` at
`b4c4a74b9fb3caa085ee1865db5c1e10acfb56fc`, plus the current uncommitted
optional-branch work. That work is a dependency, not part of the named commit.
The planning branch is `project-planning`; never merge its orphan history into
the implementation branch. Recheck the working tree before implementation.

Related: [tour reasoning and salience](tour-reasoning-and-salience.md) and
[text-to-speech](tour-text-to-speech.md).

## Current behavior and required delta

The 2026-11-02 local baseline already represents optional paths, scopes step
navigation and narration to the active path, stops at branch ends, and distinguishes outline
expansion from entering detail. It also has named return controls and an action
that leaves all detail for the next main step. Current return bookkeeping saves
scroll position; restoring the originating narration sentence needs work.

Keep this route model. Add consistent keyboard/button actions and explicit
destinations. Separate movement within a path, movement between parent and
child paths, and visit history. Do not make Previous depend on visited branches.

## Interaction contract

- **Up/Down: Previous/Next step.** Move within the current path, skipping
  child paths in both directions. Down is also how readers skip unopened
  optional detail; no separate skip shortcut is needed.
- **Shift+Up/Down: Previous/Next sentence.** Available throughout the active
  tour interface, without requiring reader-navigation focus, active narration,
  or an available speech engine, subject to the native-key exceptions below.
  Move the visible sentence cursor within the current path. Idle or paused
  narration stays silent; playing narration continues from the destination.
  Listen/Resume starts at the selected sentence. Never implicitly enter or
  leave a branch. Buttons use the same availability and boundary rules.
- **Right: Drill into detail.** Enter directly when one path is available;
  show a keyboard-accessible chooser when several are available. With none,
  do nothing. Do not silently pick a branch. Enter may remain an equivalent
  activation on the reader navigation target.
- **Left: Return to parent.** Leave one level and restore the owning step,
  sentence, and scroll position. At the main path, Left has no tour-navigation
  action. Escape remains an alias when no dialog, chooser, or other dismissible
  widget needs it; a local dismissal consumes Escape first.
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
- **Focus and scrolling:** plain arrows act only on a focusable current-step
  navigation target with visible focus and concise shortcut help. Tab can reach
  and leave it. Return focus there after step movement, branch entry, or return.
  Elsewhere plain arrows and PageUp/PageDown retain native scrolling. Broader
  sentence shortcuts must not steal keyboard focus from the invoking control.
- **Native-key exceptions:** Shift+Up/Down may run from nonediting tour chrome,
  including ordinary buttons, but yield to editing fields, code editors,
  selectable document text/caret navigation, active text selections, and widgets
  or dialogs with their own key handling. Ignore consumed/composing events and
  additional Ctrl/Meta/Alt modifiers. Do not rely only on an existing nonempty
  selection: initiating selection must work too. Keep the shortcut inactive
  outside the tour. Do not force assistive technology into an application mode.
  The trial must verify these exceptions before broader shortcut handling ships.
- **Migration:** update visible icons, labels, tooltips, accessible shortcut
  descriptions, and documentation together. Do not retain Left/Right as step
  aliases or Shift+Left/Right as sentence aliases in the new reader target.
  Preserve native PageUp/PageDown scrolling there instead of the old step
  aliases. Compare/History retain their own controls.

Entering optional detail and returning should not start idle narration.
Before coding, specify playing/paused transitions against the existing playback
controller. Trial a paused return at the saved sentence, with explicit Resume;
record the chosen rule rather than changing audio behavior incidentally.

## Communicating the reading path

Use one set of step controls and one narration transport, with visible
destination titles and useful accessible names. Show the active path and
position, optional detail available at the current step, and the next reading
destination. Communicate skipped detail without repeatedly narrating UI help.
Use up/down chevrons for step and sentence buttons and left/right chevrons for
return/drill-in buttons; keep text labels so direction alone carries no meaning.

Outline expansion only reveals choices. It must not enqueue detail, change the
active path, or start audio. Distinguish current reading position from keyboard
focus, expanded groups, and previously visited items. Keep main-tour progress
separate from optional-path progress.

## Implementation slices

1. **Specify and trial the transitions.** Use the existing optional-branch
   fixture to cover main A → B, detail A1 → A2, a nested branch, and multiple
   branches at A. Trial vertical movement, horizontal entry/return, navigation
   focus versus ordinary scrolling, Shift+arrow selection conflicts, and branch
   ends with a real tour before treating the keymap as settled.
2. **Centralize action resolution.** Extend the existing reading/navigation
   helpers so keyboard, buttons, destination previews, disabled states, and
   narration share target resolution. Keep the sentence cursor and target
   resolution independent of speech-engine availability or engagement. Use
   named domain types for finite actions and outcomes. Preserve stable step IDs, serialized format, and
   existing invalid-target handling. Store return context per nesting level,
   including narration position; clear stale context when the tour changes.
3. **Wire reader controls and narration.** Replace reader step/sentence
   shortcuts with the vertical mapping; add horizontal entry/return, branch
   selection, focus restoration, and one-level Continue. Update directional
   button icons and shortcut help. Reconcile existing all-detail exit behavior
   and remove conflicting old reader aliases. Preserve Compare/History keys.
4. **Validate and document.** Exercise the same fixture in live and offline
   presenters; then trial a real Tour Shelf tour. Document the final controls
   and update tour-authoring guidance only where needed to match their behavior.

Start with `src/tourReading.ts`, `src/tourNavigation.ts`,
`src/tourNarrationPlayback.ts`, and `web/host.js` (shortcut handlers,
`openTourBranch`, `returnFromTourBranch`, and branch navigation). Relevant
verification surfaces are `test/tourReading.test.js`, existing narration
tests, `test/optionalBranchesFixture.js`, and `standalone/tourBranchesSmoke.js`.

## Acceptance and verification

- Down from A reaches B without reading A1/A2. Up from B returns to A,
  whether or not its detail was previously visited or its outline is expanded.
- Right from A enters A1; Down reaches A2; Up returns to A1. Vertical boundary
  arrows never change hierarchy. Left (or Escape) from either detail step
  returns to the saved position in A. At main level Left is a no-op; Right
  at a step without optional detail is a no-op.
- Shift+Up/Down moves by sentence within the active path from the reader and
  ordinary tour buttons, even before Listen is used, while paused, or without
  a speech engine. Silent navigation highlights the destination; Listen/Resume
  uses it. While playing, speech follows the destination. Focus is not stolen.
  Old horizontal shortcuts do not still trigger step or sentence navigation.
- Nested entry/return restores each level independently. Continue targets the
  immediate parent's next step, including when that parent is optional.
- Multiple branches require a deliberate choice; cancel preserves position.
  Deep-link entry and a parent with no successor have deterministic outcomes.
- Narration never reads an unselected branch. Check idle, playing, and paused
  states; sentence boundaries; branch completion; return/resume; and stale
  speech callbacks after navigation. Listen to actual audio, not only mocks.
- Buttons and shortcuts resolve to identical destinations. Focused editors,
  disclosure widgets, dialogs, and normal button activation retain their keys.
  Tab reaches and leaves reader navigation without trapping focus. Outside its
  target, plain Up/Down and PageUp/PageDown scroll normally. Shift+arrows can
  initiate and extend native selection in text contexts without moving the tour.
  Verify no sentence shortcuts fire in Compare/History or dismissible dialogs.
  If the outline later becomes a tree, its focus movement must not start audio
  or silently change the active reading path.
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
use Up/Down for movement and Left/Right for hierarchy. The revised proposal
borrows those spatial axes, accepting a change from the old reader shortcuts.
It is not a full tree interaction: standard tree Up/Down visits visible nodes,
whereas reader Up/Down follows only the chosen reading path; reader Right enters
rather than merely expands. Keep the outline's disclosure semantics and do not
label the reader as an ARIA tree. Outline inspection must not alter narration.
The earlier rejection of these axes solely to preserve old shortcuts is
superseded by the user's willingness to change them. The exact keymap and
focus boundary are product proposals, not requirements of the W3C pattern.
[Apple's keyboard shortcuts](https://support.apple.com/en-ie/102650) reserve
Shift+Up/Down for extending text selection. Sentence navigation can be available
without narration or reader focus, but unconditional interception would conflict
with that behavior. Plain-arrow navigation remains focus-scoped.

Confidence is high in separate structural navigation and hierarchical return;
medium in the revised keymap, focus boundary, and stopping at branch ends. A
real-tour trial showing frequent boundary confusion or assistive-technology conflicts should change those
choices before broader implementation.

Prior session validation reported 608 passing tests, legacy checks, lint, and
live/offline branch smoke coverage. These are inherited baseline results, not
verification of this proposal. This planning pass inspected repository state and
navigation entry points; it did not rerun tests, listen to audio, or validate
real Tour Shelf and screen-reader behavior. Local remote-tracking refs were not
refreshed. Next action is slice 1; resume only when implementation is requested.

The 2026-11-05 revision changes the proposed keymap and corresponding acceptance
criteria only. W3C guidance was rechecked; implementation behavior, audio,
accessibility, and usability were not retested. The implementation baseline
above remains a historical observation, not a fresh reconciliation.


## Local implementation and verification — 2026-11-05

The reader now uses Up/Down for the current path and Right/Left for optional
entry and one-level return. Shift+Up/Down selects sentences across nonediting
tour controls, including with narration idle or device speech absent. Native
text selection, widgets, dialogs, composition, and modified shortcuts keep
their keys. Plain arrows remain confined to the focusable navigation group.
Sentence buttons remain visible with audio settings collapsed.

Entry pauses playing narration. Return restores the owning step, sentence,
and scroll; previously engaged narration returns paused, requiring Resume.
Continue advances to the immediate parent's successor. The toolbar holds
Parent/Detail actions; named Return/Continue destinations live at the branch
footer to keep the sticky header from crowding prose. Previous stays structural.
Multiple details open a chooser whose Escape/cancel restores navigation focus.

Verification evidence:

- `npm test`: legacy checks and all 611 Node tests passed. Focused controller,
  keyboard, and parent-path tests and legacy checks also passed after UI revisions.
- Typecheck/build, lint, and diff whitespace checks passed.
- Branch smoke passed in live and offline presenters with speech APIs removed:
  native keyboard movement, chooser Escape, Tab exit, no focus theft by sentence
  shortcuts, nested return, sentence/scroll restoration, immediate-parent
  continuation, search, direct links, and narrow-layout controls.
- Export smoke passed across both profiles and modes, including paused/playing
  narration via a stub speech engine, native-key guards, media controls,
  section-link focus, History/Compare, and server restart/reopen behavior.
- Image-tour and desktop workspace smoke passed. Updated the desktop smoke's
  obsolete bundled-skill version expectation to the already-implemented v7.
- An existing authored tour, `examples/navigation-lab.bygone.yaml`, passed
  offline navigation and silent sentence selection across its 12 reading items.
  Its first export exposed a literal-replacement-token serialization defect:
  string replacement interpreted code containing dollar replacement tokens.
  Callback replacements fix it; the regression failed before the fix and all
  six export tests passed afterward. Branch smoke passed again after this fix.
- Inspected screenshots at desktop and narrow widths. Removed duplicate sticky
  branch actions and prevented the collapsed-sidebar toggle covering Previous.

Not verified: actual spoken output, screen-reader interaction, other browser
engines/platforms, or a human Tour Shelf usability session. Confidence is high
in the tested route and playback transitions; medium in the interaction design
until those trials. Frequent focus confusion or native-selection conflicts
should reopen the shortcut/focus decision. No installation or publication was
performed. Existing unrelated working-tree changes were preserved.
