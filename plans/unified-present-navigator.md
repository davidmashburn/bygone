# Unified Present navigator

## Problem

Present currently owns a permanent tour sidebar while the shared comparison
renderer can add a second history sidebar. A tour with History or Compare open
therefore spends 582 pixels on adjacent navigation rails before showing code.
The fixed narrative region consumes another 320 pixels vertically. Controls for
tour structure, files, revisions, metadata, search, narration, and comparison
setup remain visible together even though only one of those tasks is active.

## Outcome

Present has one left navigator and one evidence workspace. The navigator shows
one task at a time through direct `Tour`, `Files`, and `Commits` tabs. The shared
renderer does not create its own rail inside Present. Narrative for the current
tour item sits above its evidence and sizes to its content instead of reserving
a resizable region across the full window.

## Interaction contract

### Navigator

- `Tour` lists scenes and steps and is the default tab in walkthrough modes.
- `Files` lists changed files and preserves the distinction between the active
  tour focus and a file opened for exploration.
- `Commits` shows the existing history/revision list and is the default tab in
  History and Compare.
- Each tab preserves its selection and scroll position when another tab opens.
- The navigator has one collapse control and one width. There is never a nested
  renderer rail in Present.
- On narrow windows the navigator becomes an overlay; the evidence workspace
  retains the full window width while the navigator is closed.

### Commit comparison

- Commit selection happens directly in the `Commits` list.
- Two or more selections enable `Compare selected`; ordering remains oldest to
  newest regardless of click order.
- Compare keeps the same `Commits` list visible so selections can be adjusted.
- Panel headers carry revision identity. The toolbar carries the current file,
  selection count, and actions that apply to the comparison.
- Switching files preserves the selected revisions.

### Narrative and secondary information

- The current scene or step appears in a content-sized narrative card above the
  evidence with previous/next navigation in the same row.
- Long context expands within the card. Discussion-only scenes use the
  workspace because they have no code evidence.
- Search, tour details, coverage, and review notes open on demand. They do not
  occupy permanent navigator sections.
- Narration starts from a compact `Listen` action; transport and voice controls
  appear only while narration controls are expanded.

### Mode vocabulary

- `Final`, `Historical`, and `Explanation` remain direct choices for authored
  ways of telling the tour.
- `Tour`, `Files`, and `Commits` are navigator views, not additional modes.
- `Compare` is the result of selecting commits and may still be represented in
  the URL for deep-link compatibility.

## Implementation scope

1. Recompose the existing Present markup into a single tabbed navigator.
2. Render the tour history payload inside its `Commits` tab and suppress the
   shared renderer rail when the Present host owns navigation.
3. Move the narrative into a content-sized region above the evidence and remove
   its resize state and separator.
4. Move persistent metadata and search surfaces behind compact actions while
   preserving their current behavior and accessibility.
5. Keep the existing comparison protocol, URL compatibility, Git semantics,
   tour manifest formats, renderer, and desktop/browser parity.
6. Update structural tests, product-surface documentation, and presenter docs.

## Acceptance scenarios

1. Open a tour, select three commits in `Commits`, compare them, switch files,
   inspect a tour step, and return without losing commit or file selection.
2. At desktop width, only one left navigator is present in every Present mode.
3. Collapsing the navigator gives its width back to the evidence workspace.
4. A normal code-backed step leaves most of the window to code; a discussion
   scene remains readable without showing an empty evidence area.
5. Keyboard focus, current-item semantics, selection checkboxes, deep links,
   Return to Tour, search, review notes, and narration remain operable.

## Non-goals

- Redesigning the standalone Explore workflows outside Present.
- Changing the tour file format or minting another format version.
- Replacing Monaco or the existing multi-panel interaction model.
- Adding persisted workspace layouts or new authoring features.
