# In-document find behavior

## Status

Implemented on `main`; pane-local Replace and Replace All remain an immediate follow-up.

## Goal

Add familiar, reliable text find to Bygone's code panes without conflating
in-document search with repository search, changed-file filtering, or search
across revisions.

The first release should let a user press `Cmd+F` on macOS or `Ctrl+F` on
Windows and Linux, enter a query, and move among matches in the active text
pane. It should behave consistently in the standalone app, VS Code webview,
and browser-hosted diff or tour wherever the shared Monaco renderer is used.

Pane-local Replace and Replace All are the immediate follow-up needed for the
standalone application's conventional Edit menu. They use Monaco only when the
active model is writable. Broader comparison, repository, history, and tour
search remain separate scopes in the multi-scale search plan.

## Context

Bygone already renders textual two-way and multi-panel comparisons with one
Monaco editor per pane. The renderer tracks an active side in two-way mode and
an active panel in multi-panel mode, updating that state when an editor or
pane receives focus. Monaco supplies a mature find widget, match decorations,
query options, and next/previous navigation, but Bygone does not currently
expose those capabilities as an intentional application behavior.

Electron's page-level `webContents.findInPage` is not a suitable foundation.
Monaco virtualizes text, so page search cannot reliably see the complete
document and would also mix code with filenames, toolbar labels, history
rails, and other interface text.

## User-facing behavior

### Search target

Find operates on exactly one text pane at a time:

- In a two-way diff, history view, branch review, or text-file tour scene, it
  searches the pane that most recently received focus. If neither editor has
  focus, it uses Bygone's current active-side state.
- In a multi-panel diff, it searches the active panel. Clicking a pane header
  or focusing its editor makes that panel the target before find opens.
- The query scans the pane's complete Monaco model, including both changed and
  unchanged lines. It is not restricted to visible lines or diff blocks.
- Moving to another pane and invoking find searches that pane only. Matches
  are not combined into one count across panes.

This pane-local rule keeps counts, current-match selection, and navigation
unambiguous. A future cross-pane or cross-file search can use a separate
surface and command rather than silently changing the meaning of `Cmd/Ctrl+F`.

### Commands and controls

- `Cmd/Ctrl+F` opens Monaco's find widget in the target pane and focuses its
  query field.
- `Enter` or the widget's next control advances to the next match;
  `Shift+Enter` moves to the previous match.
- `F3` and `Shift+F3` perform Find Next and Find Previous while a text pane or
  its find widget is active.
- `Escape` closes the widget and returns focus to its editor.
- The standalone Edit menu exposes **Find**, **Find Next**, **Find Previous**,
  **Replace**, and **Replace All** with platform-standard accelerators and
  routes them to the same active-pane behavior. Replace commands disable for
  read-only models until the immediate follow-up slice is implemented.
- Monaco's built-in case-sensitive, whole-word, and regular-expression
  toggles remain available. The initial defaults are case-insensitive with
  whole-word and regular-expression matching off.

Selection seeding should follow Monaco's normal behavior: a single-line text
selection can prefill the query when find opens. Bygone should not implement a
second query-state layer unless testing reveals a host-specific inconsistency.

### Unsupported modes and transitions

- Directory comparisons, binary/image comparisons, the non-Monaco
  experimental merge view, and an empty window have no in-document target.
  Find should be disabled in host menus when the host can determine this and
  should otherwise no-op without opening page search.
- Opening a different file, history revision, or tour scene ends the old
  model's find session. The implementation does not promise to carry a query
  between files or restore a match position after navigation.
- Editing a writable pane while its widget is open relies on Monaco to update
  match results. Find must not alter dirty-state, save, diff recomputation, or
  active-change navigation behavior.

## Proposed approach

### 1. Centralize target resolution in the shared renderer

Add a small renderer-level find controller in `media/script.js`. It should
resolve the target editor from `currentMode`, `activePaneSide`,
`activeMultiPanelId`, `leftEditor`, `rightEditor`, and `multiEditors`. Keep
target resolution separate from command dispatch so it can be unit tested
without relying on Monaco internals.

The controller should expose operations equivalent to:

- open find in the active editor;
- move to the next match;
- move to the previous match; and
- report whether a text editor target currently exists.

Use Monaco editor actions such as its built-in find and match-navigation
actions rather than reimplementing query parsing, decorations, or scrolling.
Before running an action, focus the resolved editor so Monaco owns subsequent
keyboard handling and accessibility state.

Register the find keybinding on every editor in `createEditor`, alongside the
existing change-navigation and save commands. Also add a window-level fallback
for `Cmd/Ctrl+F` so invoking find from a pane header or another non-editable
part of the webview still targets the active editor. The fallback must respect
`event.defaultPrevented` and must not override typing or shortcuts inside an
open Monaco widget.

### 2. Route standalone menu commands to the renderer

Add the three commands to the Edit menu in `standalone/main.js`. Their click
handlers should send a narrow host message to the shared renderer instead of
calling Electron page search. The renderer consumes that message through the
existing host-message path and calls the same find controller used by keyboard
shortcuts.

Menu enablement can be conservative. Enable commands for sessions that render
textual two-way, history, review, or multi-panel content, while retaining the
renderer-side target check as the source of truth for binary transitions and
other cases the main process cannot distinguish cheaply.

No new preload capability is required: the existing main-to-renderer
`bygone:host-message` bridge already carries trusted application messages.

### 3. Preserve host consistency

The VS Code extension and browser presenter should use the renderer's editor
keybindings and window fallback. They do not need to duplicate find logic in
`DiffViewProvider` or `web/host.js` for the initial scope. If VS Code intercepts
`Cmd/Ctrl+F` before a focused Monaco editor receives it, add an explicit Bygone
command in a follow-up; do not fall back to DOM/page search.

Treat the source `media/script.js` as authoritative and rebuild generated
webview assets through the repository's normal compile process. Do not edit a
generated bundle directly.

## Scope and non-goals

Included:

- Text matching within the active Monaco model.
- Two-way, history/review, multi-panel, and text-tour diff panes.
- Standard open, next, previous, close, case, whole-word, and regex behavior.
- Standalone menu integration and shared-renderer keyboard access.
- Clear no-op or disabled behavior when there is no text model.

Not included:

- Searching all panes at once or synchronizing corresponding matches across
  revisions.
- Searching all changed files, commits, tour scenes, directory entries, or
  repository content.
- Filtering history rails or directory trees.
- Cross-pane or cross-file replacement, structural search, fuzzy search, or
  Git-aware search. Pane-local Replace/Replace All are an immediate follow-up
  after the initial find-only slice.
- Search in binary payloads, image metadata, rendered discussion text, or
  other application chrome.
- Persisting queries between files, sessions, or app launches.

## Risks and decisions

- **Shortcut ownership:** Electron, VS Code, the browser, and Monaco can all
  claim find shortcuts. The active editor command is primary; the renderer
  fallback and standalone menu cover focus outside the editor without adding
  competing search implementations.
- **Multiple widgets:** Each Monaco editor has its own find state. The pane-
  local contract makes that acceptable, but visual testing should confirm that
  switching panes does not leave overlapping widgets that imply a combined
  search. If it does, close the previous editor's widget when opening another.
- **Multi-panel activation:** Opening find must not change the active diff pair
  or current change merely because it focuses the already-active panel.
- **Synchronized scrolling:** Revealing a match may trigger Bygone's existing
  scroll synchronization and connector redraws. This is desirable only if it
  remains stable and keeps the selected match visible; it needs explicit
  multi-panel testing.
- **Generated assets:** Tests should exercise source-level behavior and the
  compile step should verify that the distributed webview bundle includes it.

## Validation

### Automated coverage

- Unit-test target resolution for left and right two-way panes, active
  multi-panel panes, disposed editors, and unsupported modes.
- Assert that opening, next, and previous dispatch the expected Monaco action
  to only the resolved editor.
- Test that the renderer host-message handler routes standalone menu requests
  through the same controller.
- Test standalone Edit menu labels, accelerators, enablement, and message
  dispatch without using `webContents.findInPage`.
- Retain the normal compile and full test suite as the integration gate.

### Manual matrix

Verify on at least the standalone app and VS Code webview:

1. Open find from each side of a two-way diff, including read-only history.
2. Search text that occurs in one pane, both panes, changed lines, and
   unchanged lines; confirm the count is pane-local.
3. Exercise next, previous, wrapping, case sensitivity, whole-word, regex,
   selection seeding, and Escape.
4. Repeat in a three-or-more-panel diff and confirm focus, horizontal layout,
   synchronized scrolling, active-pair styling, and connectors remain stable.
5. Edit a matching string and confirm results update without breaking dirty
   state or diff recomputation.
6. Navigate to another file or revision with find open and confirm stale
   matches disappear.
7. Invoke find in directory, binary, empty, and experimental merge modes and
   confirm no misleading page search appears.
8. In the standalone app, repeat open/next/previous from the Edit menu as well
   as the keyboard.

## Delivery sequence

1. Extract and test active-editor target resolution.
2. Add Monaco action dispatch and per-editor/window keybindings.
3. Add standalone menu commands over the existing host bridge.
4. Compile generated assets and run the automated suite.
5. Complete the manual mode/host matrix, then document any host-specific
   shortcut limitations before expanding scope.

## Related plans

- [Standalone product surface](standalone-product-surface.md)
- [VS Code companion surface](vscode-companion-surface.md)
- [Multi-scale search](multi-scale-search.md)
- [Product implementation roadmap](implementation-roadmap.md)

## Follow-up questions

These questions do not block the initial pane-local implementation:

- Should a later command search all visible panes and present a combined,
  revision-labeled result list?
- Should directory mode get a separate filename/path filter, and should that
  use a different shortcut such as `Cmd/Ctrl+P`?
- Should tour mode eventually search narrative prose and code as distinct
  result kinds?
- Is replace useful in editable comparisons, or would it conflict with
  Bygone's role as a diff and review tool?
