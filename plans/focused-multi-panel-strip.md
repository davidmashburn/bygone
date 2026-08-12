# Focused multi-panel strip

## Status

Draft

## Goal

Replace free-form horizontal scrolling in multi-panel diffs with deliberate,
snap-based navigation. Readers should move between panels or adjacent diff
pairs without fighting a second horizontal scroll surface inside each Monaco
editor.

The recommended direction is a Niri-inspired focused strip with carousel-like
snap points: panels retain a stable left-to-right order, one panel or adjacent
pair becomes the viewport anchor, and navigation moves that anchor rather than
leaving the reader at an arbitrary pixel offset.

## Context

Multi-panel views currently combine two horizontal axes:

- each Monaco editor scrolls horizontally through long code lines; and
- the outer multi-panel track scrolls horizontally through panels.

Minimum pane widths make the code readable, but activate the nested scrolling
conflict. Pointer and trackpad gestures need contextual routing, the native
outer scrollbar is slow for panel-sized movement, active panels can land at
awkward partial positions, and connector ribbons become confusing when one of
their panes is clipped.

More broadly, the current UX is awkward even when its scrolling works as
implemented. Showing many full editors simultaneously gives every revision
similar visual weight while the reader usually cares about one stage or one
adjacent comparison. Pane chrome, gutters, connectors, inner scrollbars, and
the outer track compete for attention, and the active conceptual step is not
the obvious unit of movement.

This is primarily a focus and navigation-model problem, not a scrollbar
styling problem. The UI needs a discrete concept of which panel or pair owns
the viewport. The existing free-scroll layout should be replaced rather than
polished further.

## Options considered

### Paged carousel

Render one panel or one adjacent pair per page. Previous and next actions swap
the page, with no continuously positioned strip exposed to the user.

Advantages:

- simplest mental model and accessibility story;
- no partial panes or outer scrollbar;
- predictable on narrow screens; and
- straightforward lazy mounting of off-screen editors.

Costs:

- weakens the sense that revisions form one ordered sequence;
- makes jumping several panels feel like replacing the view rather than moving
  through it;
- prevents useful neighboring-panel peeks; and
- can make direct panel selection and drag reordering feel disconnected from
  the presented layout.

This remains a useful narrow-viewport mode and implementation fallback.

### Niri-inspired focused strip

Keep panels in one ordered horizontal strip, but make layout state discrete.
One panel or adjacent pair is focused. Navigation calculates its position and
animates or snaps the track to that position. Off-screen panels remain ordered
and may appear as small edge peeks, but the user does not manage an arbitrary
outer `scrollLeft` value.

Advantages:

- preserves spatial continuity and revision order;
- maps naturally to active panel and active adjacent pair state already used
  by Bygone;
- supports keyboard, buttons, direct panel selection, and touch gestures with
  the same navigation primitive; and
- allows connectors to render only for the focused pair.

Costs:

- requires an explicit layout and transition controller;
- focus changes, resizing, sidebar changes, and file navigation must all
  recompute the anchor position; and
- fully mounted Monaco editors may still carry a memory and layout cost when
  many stages exist.

## Recommendation

Build the focused strip and use carousel rules at responsive breakpoints.

Treat the current outer-scroll implementation as an interim experiment. Do not
spend another iteration tuning scrollbar appearance, wheel routing, pane
minimums, or clipped-panel affordances before validating the focused model.

- When two readable panes plus one gutter fit, anchor an adjacent pair in the
  viewport.
- When they do not fit, anchor one panel and provide an explicit action to move
  to its previous or next neighbor.
- Allow a small, non-interactive edge peek only when it does not reduce the
  focused pane below its minimum readable width.
- Do not expose a native outer horizontal scrollbar as the primary control.
  The strip may retain an internal offset for layout, but navigation is by
  panel or pair identity.
- Keep Monaco's own horizontal scrolling fully local to the editor.

The product name can remain **multi-panel diff**. “Focused strip” describes the
implementation and interaction model; Niri is design inspiration, not a term
that needs to appear in the interface.

## User-facing behavior

### Focus and movement

- Exactly one panel is active. When adjacent comparison context is available,
  exactly one pair is active as well.
- Previous and next panel actions move one panel at a time and snap the active
  panel into the viewport.
- Previous and next pair actions move one adjacent comparison at a time. A
  pair-focused move places both panes and their gutter in view when space
  permits.
- Clicking a panel header, gutter, tour stage, file-navigation result, or
  changed-block result uses the same focus-and-reveal operation.
- A panel never settles partially clipped after navigation or resize unless it
  is an intentional edge peek.

### Input

- Monaco retains normal horizontal trackpad and Shift+wheel behavior for code.
- Buttons and keyboard shortcuts are the authoritative strip navigation:
  `Alt+Left/Right` moves panels and `Alt+Shift+Left/Right` moves pairs, subject
  to conflict review with existing commands.
- A horizontal trackpad gesture over panel chrome or a gutter accumulates
  distance and commits at most one snap after a threshold. It does not mirror
  raw wheel deltas into track position.
- Touch dragging may follow the panel directly, then settle to the nearest
  valid snap point. Pointer dragging with a mouse is optional for the first
  release.
- Reduced-motion preference disables animated travel and applies the final
  anchored layout immediately.

### Orientation and accessibility

- Show a compact position control such as **Panel 3 of 5** and, when relevant,
  **Comparison 3–4 of 5**.
- Provide an ordered panel picker for direct jumps. Tour stage controls may
  serve this role in presentation mode.
- The strip is not exposed as a generic scroll region. Navigation controls
  have clear labels, disabled boundary states, and predictable focus behavior.
- After a move, keyboard focus stays on the invoked control unless the action
  explicitly selected an editor. Screen readers receive a concise active-panel
  or active-pair announcement.

## Proposed architecture

### 1. Introduce discrete viewport state

Add renderer state equivalent to:

```text
activePanelId
activePairIndex
viewportMode: panel | pair
viewportAnchorId
transitionState: idle | dragging | settling
```

Derive the target transform from DOM measurements, minimum pane width, gutter
width, viewport width, and sidebar width. Do not persist a pixel offset as
authoritative state. On resize or sidebar change, recalculate the target for
the same anchor identity.

Centralize all callers behind operations equivalent to:

- focus panel;
- focus pair;
- move panel by one;
- move pair by one; and
- recompute anchored layout.

Tour navigation, file navigation, change navigation, header clicks, gutter
clicks, and host restoration should call these operations instead of directly
using `scrollIntoView` or setting `scrollLeft`.

### 2. Replace scroll layout with a translated strip

Keep an overflow-hidden viewport containing an ordered track. Position the
track with a transform or equivalent deterministic layout offset. CSS scroll
snap is not recommended as the core state mechanism because Monaco introduces
nested scroll containers and Bygone must restore panel identity precisely.

Use transform animation only for the outer track. During a transition:

- Monaco editors remain mounted and retain their local scroll positions;
- connector drawing is suspended or limited to the destination pair;
- repeated navigation updates or queues the destination without accumulating
  unbounded animations; and
- the final layout is measured again before connectors redraw.

### 3. Make connectors pair-local

Render connector ribbons only for the active adjacent pair. Hide them in
single-panel mode until the reader asks to compare with a neighbor. This avoids
clipped ribbons, reduces canvas work, and makes the gutter's meaning explicit.

The active gutter is a comparison target, not a third content column. Keep it
visually quiet when no connector crosses it and do not place revision labels
inside it.

### 4. Add responsive carousel mode

When the viewport cannot fit two minimum-width panes plus a gutter, switch to
single-panel mode without changing the active panel ID. Pair navigation moves
to the destination panel and records which neighbor is being compared so a
compact comparison indicator can remain visible.

Returning to a wider viewport restores pair mode around the active panel using
the most recent valid pair when possible.

### 5. Consider virtualization after interaction stabilizes

The first release may keep all editors mounted to reduce state-restoration
risk. Measure memory, layout time, and change-navigation latency with 6, 12,
and 20 panels. If needed, mount the focused panel or pair plus one neighbor on
each side, retaining model content and navigation snapshots for unmounted
panels.

Virtualization is a follow-up optimization, not a prerequisite for replacing
free-form scrolling.

## Scope and non-goals

Included:

- ordinary editable multi-panel comparisons;
- stacked-diff and deconstructed-diff tour scenes;
- panel, pair, keyboard, button, and direct-selection navigation;
- narrow single-panel carousel behavior;
- sidebar resize and hide/show recomputation;
- connector behavior for the focused pair; and
- preservation of each editor's vertical and horizontal state.

Not included initially:

- arbitrary zoomed-out overviews of every panel;
- inertial free-scrolling between many panels;
- drag reordering of revisions or explanation stages;
- changing the semantic order of tour stages;
- full editor virtualization before profiling shows a need; or
- mobile-specific gestures beyond a basic single-panel swipe.

## Risks and decisions

### Transforming Monaco editors

Monaco can mismeasure when ancestors move or resize. Layout every visible
editor after the strip settles and test text input, find widgets, hover UI,
selections, and pointer coordinates during and after transitions. If transform
animation causes rendering artifacts, animate a lightweight shell and apply
the editor position only at settlement, or use discrete non-animated layout.

### Navigation-command conflicts

Bygone already uses modified arrow keys for change and copy operations. Audit
the complete shortcut map before assigning strip commands. Buttons and direct
selection must remain complete alternatives even if keyboard bindings change.

### Active panel versus active pair

A middle panel belongs to two pairs. Preserve both IDs explicitly rather than
inferring the pair from panel position on every action. Panel selection should
retain the current pair when it still contains that panel; otherwise choose
the nearest pair deterministically.

### Editing during movement

Do not begin a strip gesture from inside Monaco content. A transition should
not steal editor focus, selection, find-widget input, or text dragging. If an
editor has pointer capture, the strip does not move.

### Large panel counts

Transforms solve navigation but not mounting cost. Establish performance
budgets and profile before adding virtualization complexity.

## Acceptance criteria

- No workflow requires manipulating an outer horizontal scrollbar.
- Horizontal gestures inside code affect only that Monaco editor.
- Every panel and adjacent pair is reachable with visible controls and the
  keyboard.
- Panel and pair moves always settle at a deterministic anchor.
- Active tour stages reveal their intended panel and first changed block.
- Narrow layouts show one readable pane rather than two compressed panes.
- Connectors render only when both panes of the active pair are presented.
- Resizing or toggling a sidebar preserves the active panel/pair and reanchors
  it without a partial resting position.
- Find, word wrap, editing, save, copy-change, file navigation, and change
  navigation continue to work in every mounted pane.
- Reduced-motion mode has no animated strip travel.

## Implementation sequence

1. Extract a pure layout function that returns panel mode, pair mode, pane
   widths, and target offset from panel count, active IDs, and viewport width.
2. Add focused-strip state and route existing header, gutter, tour, and file
   navigation through one focus-and-reveal controller.
3. Replace the outer scroll position with an overflow-hidden translated track;
   retain buttons first and add gesture snapping afterward.
4. Limit connectors to the active pair and verify canvas geometry after every
   settled layout.
5. Add responsive single-panel carousel behavior.
6. Add keyboard commands, announcements, reduced-motion handling, and direct
   panel selection.
7. Run browser, standalone, and VS Code webview interaction tests at narrow,
   medium, and wide sizes.
8. Profile large stacks and decide separately whether editor virtualization is
   justified.

## Open questions

- Should the wide default anchor a panel or an adjacent pair when a session
  opens without an explicit active pair?
- Are small neighboring edge peeks helpful orientation or visual noise?
- Should trackpad snapping be included in the first release, or should buttons,
  keyboard, and direct selection establish the model first?
- What shortcut family avoids conflicts with existing change navigation and
  copy commands across macOS, Windows, and Linux?
- Should editable free-form multi-panel sessions and read-only tours share the
  exact same chrome, or may tours use their stage controls as the primary
  strip navigator?
