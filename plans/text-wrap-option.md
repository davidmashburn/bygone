# Text wrap option

## Status

Implemented on `main`.

## Goal

Let readers wrap long lines within Bygone's Monaco code panes without losing
the existing unwrapped view, diff semantics, active-change navigation, or
scroll synchronization.

The first release should provide one reader-controlled toggle across textual
two-way and multi-panel comparisons. The preference should persist locally,
apply consistently to every visible code pane, and remain independent from
tour authors or source files.

## Context

Bygone currently creates every Monaco editor with `wordWrap: 'off'`. That
preserves exact horizontal structure but makes narrow windows and multi-panel
comparisons expensive to read when files contain long lines. Monaco already
supports visual wrapping without changing model content, selections, line
numbers, decorations, or saved text.

The main implementation risk is not the Monaco option itself. Bygone maps
scroll positions across panes, draws connectors between changes, reveals
active diff blocks, and recreates editors as sessions or files change. The
display preference must flow through those systems without becoming document
state or producing mismatched pane layouts.

## User-facing behavior

- Add a **Wrap Long Lines** toggle to the comparison toolbar and standalone
  **View** menu.
- Use `Alt+Z`, matching Monaco and VS Code's familiar word-wrap shortcut.
- Apply the setting to all textual panes in the current view. A multi-panel
  comparison must not mix wrapped and unwrapped panes.
- Persist the reader's choice locally and use it for later sessions in the
  same host. Default to unwrapped when no preference exists.
- Hide or disable the control for directory, binary/image, empty, and
  experimental merge views where the shared Monaco panes are not active.
- Keep wrapping purely visual. It must not alter editor values, dirty state,
  line numbers, diff calculations, copied text, or tour evidence ranges.
- Re-layout editors and connectors immediately after a toggle. Keep the
  active change visible, using its model line rather than a pixel offset.

## Proposed approach

### 1. Add a shared renderer preference

Store a renderer-level `wordWrapEnabled` boolean and centralize its Monaco
translation in a helper that returns `wordWrap: 'on'` or `wordWrap: 'off'`.
Use the helper both when creating editors and when updating existing editors
so newly navigated files inherit the current setting.

Expose a small controller with operations to read, set, toggle, and apply the
preference to a list of editors. Keep storage access outside the controller so
the behavior can be unit tested with editor doubles.

For standalone and browser hosts, persist through `localStorage` under a
Bygone-specific key. For the VS Code webview, use `acquireVsCodeApi().getState`
and `setState` through the existing host bridge if available; fall back to
renderer storage only where the host permits it. Preference failures should
leave the in-memory toggle functional.

### 2. Integrate with layout and navigation

After applying the option:

1. call Monaco layout for active editors;
2. recompute connector canvas geometry;
3. redraw connectors after Monaco reports content-size changes; and
4. reveal the active change in the active pane without changing which change
   is selected.

Continue to synchronize panes by model-line correspondence rather than raw
scroll percentage where that mapping already exists. Wrapped visual heights
can differ when pane content differs, so the active source editor should
remain authoritative during user scrolling.

### 3. Add controls and host commands

Add a toolbar button with a conventional wrap-lines icon, pressed state,
tooltip, and accessible label. Register `Alt+Z` at the editor and window level
so it also works after a pane header receives focus.

Add a checked **View → Wrap Long Lines** menu item in standalone. Its handler
should send a semantic renderer message and its checked state should be
updated from renderer preference-state messages rather than maintained as a
second preference.

The browser and VS Code surfaces use the shared toolbar and renderer shortcut;
they do not need separate host commands initially.

## Scope and non-goals

Included:

- All shared-renderer two-way and multi-panel textual views, including history
  and text tour scenes.
- A reader-controlled toggle, `Alt+Z`, local persistence, and synchronized
  toolbar/menu state.
- Correct layout, decorations, connectors, and active-change reveal after the
  setting changes.

Not included:

- Per-file, per-pane, workspace, repository, or tour-authored wrap settings.
- Configurable wrap columns, rulers, indentation strategies, or word-breaking
  policy.
- Wrapping directory rows, prose scenes, binary metadata, or other chrome.
- Changing diff alignment to force corresponding lines to occupy identical
  visual heights.

## Risks and decisions

- **Unequal visual heights:** Corresponding changed lines may wrap differently.
  Preserve semantic line mapping and accept that connectors may slope.
- **Scroll feedback loops:** Monaco content-size and scroll events can arrive
  in bursts after toggling. Reuse the existing suppression flags and schedule
  one final connector redraw.
- **Persistence differences:** Host storage APIs differ. Define one semantic
  preference and isolate storage adapters rather than branching wrap behavior.
- **Toolbar density:** Use an icon button with a clear tooltip; do not add a
  permanent text label to the central change controls.

## Delivery sequence

1. Extract and test the wrap preference/controller.
2. Apply wrap state during editor creation and to live two-way/multi-panel
   editors.
3. Add toolbar, shortcut, accessibility state, and local persistence.
4. Add standalone checked-menu integration over semantic host messages.
5. Validate scroll synchronization, active-change reveal, connectors, and
   host consistency.

## Validation

- Unit-test defaults, toggling, application to multiple editors, disposed
  editors, and storage failure.
- Assert every editor receives the preference when created or replaced.
- Test standalone menu label, checked state, accelerator, and semantic message
  dispatch.
- Exercise long changed and unchanged lines in two-way and three-panel views.
- Verify inline highlights, selections, line numbers, dirty state, save, find,
  active-change navigation, and tour evidence remain correct.
- Run compile, lint, full tests, and standalone smoke scenarios.

## Acceptance criteria

- A reader can toggle wrapping from the toolbar, `Alt+Z`, and standalone View
  menu in any textual comparison.
- All visible panes use the same wrap state, including editors created after
  file or revision navigation.
- The choice persists locally and defaults to unwrapped for a new reader.
- Toggling does not mutate content or change dirty/save behavior.
- The active change remains selected and visible, and connector geometry
  settles correctly after layout.
- Unsupported views do not expose a misleading active control.
