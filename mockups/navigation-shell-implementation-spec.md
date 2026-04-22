---
author: David Mashburn
created_at: 2026-04-22T02:49:44Z
modified_at: 2026-04-22T02:49:44Z
generated_by: Codex
generated_for: David Mashburn
reviewed_by:
approved_by:
repo: https://github.com/davidmashburn/bygone
branch: main
repo_branch_url: https://github.com/davidmashburn/bygone/tree/main
repo_head_commit_url: https://github.com/davidmashburn/bygone/commit/6b0452b28f01ec99a0adb2f299414e78c9515e76
---

# Bygone Navigation Shell Implementation Spec

## Summary

This document turns the current Bygone navigation redesign into a concrete implementation spec for the existing codebase.

The central design move is to separate:

- `where am I?` hierarchy and mode
- `when am I?` history and timeline
- `what sibling am I on?` file-to-file traversal
- `what local change am I on?` hunk-to-hunk traversal
- `what can I do?` edit, copy, save, open external

Today these concepts are mixed into one header cluster. The refactor should give Bygone one stable shell whose regions change predictably by mode.

## Goals

- Keep one canonical window shell across extension and standalone.
- Make the meaning of arrows and controls consistent across all modes.
- Promote hierarchy, time, file traversal, and hunk traversal into separate visual groups.
- Preserve existing capabilities while reducing toolbar sprawl.
- Keep the shared browser runtime in `media/` as the main implementation surface.

## Non-Goals

- This spec does not redesign the diff engine.
- This spec does not turn the product into a full merge workflow.
- This spec does not require a new framework or component library.
- This spec does not change the standalone/extension split.

## Canonical Shell

The target shell has six regions:

1. `AppHeader`
2. `ContextBar`
3. `TimelineBar`
4. `NavigatorRail`
5. `CanvasStage`
6. `ActionBar`

The important rule is that the shell remains stable while the content inside these regions changes by mode.

```text
+--------------------------------------------------------------------------------------+
| AppHeader: app title | mode chip | edit mode | global actions                        |
+--------------------------------------------------------------------------------------+
| ContextBar: back | breadcrumb | current object label                                 |
+--------------------------------------------------------------------------------------+
| TimelineBar: older/newer | position | commit labels | only in history modes           |
+------------------------------+-------------------------------------------------------+
| NavigatorRail                | CanvasStage                                           |
| tree / changed files /       | diff panes / multi diff / merge prototype             |
| history list                 | local hunk navigation belongs here                    |
+------------------------------+-------------------------------------------------------+
| ActionBar: copy, save, open external, palette, hints                                 |
+--------------------------------------------------------------------------------------+
```

## Mode Model

Bygone should stop thinking of the UI as one big `mode` and instead treat it as a small state matrix.

### Primary content mode

- `diff`
- `directory`
- `history`
- `directory-history`
- `multi-diff`
- `three-way`

### Navigation scope

- `hierarchy`
- `timeline`
- `file`
- `change`

### Navigator mode

- `hidden`
- `tree`
- `changed-files`
- `history-list`

### Recommended derived UI state

```ts
type BygoneUiState = {
  contentMode: 'diff' | 'directory' | 'history' | 'directory-history' | 'multi-diff' | 'three-way';
  navigatorMode: 'hidden' | 'tree' | 'changed-files' | 'history-list';
  canGoUp: boolean;
  canGoOlder: boolean;
  canGoNewer: boolean;
  canGoPrevFile: boolean;
  canGoNextFile: boolean;
  canGoPrevChange: boolean;
  canGoNextChange: boolean;
  isEditableLeft: boolean;
  isEditableRight: boolean;
  breadcrumb: Array<{ label: string; kind: 'repo' | 'directory' | 'file' | 'history' }>;
  modeLabel: string;
  titleLabel: string;
};
```

This derived state should live in `media/script.js`, with the host continuing to own compare inputs and history data.

## Behavior Matrix

### `directory`

- `ContextBar` shows breadcrumb to compared directory roots.
- `TimelineBar` is hidden.
- `NavigatorRail` is the full directory tree.
- `CanvasStage` is either empty-state guidance or selected file diff.
- `Back` is hidden.
- `Prev/Next File` is hidden until a file is selected.
- `Prev/Next Change` is hidden until a file diff is active.

### `directory` drill-down file diff

- `ContextBar` shows directory breadcrumb plus selected file leaf.
- `NavigatorRail` defaults to `changed-files`.
- `Back` returns to the directory tree.
- `Prev/Next File` cycles sibling changed files.
- `Prev/Next Change` cycles hunks in the active file.

### `history`

- `TimelineBar` is visible and primary.
- `NavigatorRail` can stay hidden in phase 1.
- `Back` is hidden.
- `Prev/Next File` is hidden.
- `Prev/Next Change` works in the canvas only.

### `directory-history`

- `TimelineBar` is visible.
- `NavigatorRail` shows tree at snapshot level and `changed-files` in drill-down level.
- `Back` exits file drill-down and returns to the current snapshot tree.
- `Prev/Next File` changes file within the current snapshot pair.
- `Prev/Next Change` changes hunk within the current file.

### `multi-diff`

- `NavigatorRail` is hidden in phase 1.
- `TimelineBar` is hidden.
- `CanvasStage` owns the whole experience.
- `ActionBar` stays present for open external and palette access.

### `three-way`

- Same shell as `multi-diff`.
- Distinct mode chip and result-specific action cluster.

## Component Names

These names are intended for current plain DOM implementation, not a framework rewrite.

### `BygoneShell`

Owns overall layout.

Implementation:

- `standalone/index.html`
- `src/diffViewProvider.ts`
- `media/style.css`

### `AppHeader`

Contains persistent app identity and high-level state.

Children:

- `AppTitle`
- `ModeChip`
- `EditModeToggle`
- `GlobalActions`

### `ContextBar`

Contains hierarchy context.

Children:

- `BackButton`
- `BreadcrumbTrail`
- `ContextTitle`

### `TimelineBar`

Contains history-only navigation.

Children:

- `OlderButton`
- `TimelinePosition`
- `NewerButton`
- `TimelineMetaLeft`
- `TimelineMetaRight`

### `NavigatorRail`

Contains the current browseable list.

Children:

- `NavigatorHeader`
- `NavigatorScopeTabs`
- `NavigatorFilterBar`
- `NavigatorList`

### `CanvasStage`

Contains current compare surface.

Children:

- `CanvasHeaderLeft`
- `CanvasHeaderRight`
- `CanvasViewport`
- `CanvasChangeNav`

### `ActionBar`

Contains mutation and escape hatches.

Children:

- `CopyActions`
- `SaveActions`
- `ExternalActions`
- `CommandPaletteAction`
- `HintStrip`

## DOM Structure

The current shell in `standalone/index.html` and `src/diffViewProvider.ts` should be restructured to this shape.

```html
<div id="bygone-shell" class="bygone-shell" data-mode="directory-history">
  <header id="app-header" class="app-header">
    <div class="app-header-left">
      <h1 id="app-title" class="app-title">Bygone</h1>
      <span id="mode-chip" class="mode-chip">Directory History</span>
    </div>
    <div class="app-header-right">
      <button id="toggle-readonly" class="edit-mode-button" type="button">Editing On</button>
      <div id="global-actions" class="global-actions"></div>
    </div>
  </header>

  <div id="context-bar" class="context-bar">
    <button id="back-button" class="context-back-button" type="button">Back</button>
    <nav id="breadcrumb-trail" class="breadcrumb-trail" aria-label="Breadcrumb"></nav>
    <div id="context-title" class="context-title"></div>
  </div>

  <div id="timeline-bar" class="timeline-bar" hidden>
    <div class="timeline-meta timeline-meta-left">
      <div id="history-left-commit" class="history-commit"></div>
      <div id="history-left-time" class="history-time"></div>
    </div>
    <div class="timeline-nav">
      <button id="history-back" class="timeline-button" type="button">Older</button>
      <div id="history-position" class="timeline-position"></div>
      <button id="history-forward" class="timeline-button" type="button">Newer</button>
    </div>
    <div class="timeline-meta timeline-meta-right">
      <div id="history-right-commit" class="history-commit"></div>
      <div id="history-right-time" class="history-time"></div>
    </div>
  </div>

  <div id="workspace-shell" class="workspace-shell">
    <aside id="navigator-rail" class="navigator-rail" hidden>
      <div id="navigator-header" class="navigator-header"></div>
      <div id="navigator-scope-tabs" class="navigator-scope-tabs"></div>
      <div id="navigator-filter-bar" class="navigator-filter-bar"></div>
      <div id="navigator-list" class="navigator-list"></div>
    </aside>

    <main id="canvas-stage" class="canvas-stage">
      <div id="diff-container">
        <div id="two-way-diff" class="diff-view"></div>
        <div id="directory-diff" class="dir-view hidden"></div>
        <div id="multi-way-diff" class="multi-view hidden"></div>
        <div id="three-way-diff" class="diff-view hidden"></div>
      </div>

      <div id="canvas-change-nav" class="canvas-change-nav" hidden>
        <div class="file-nav-group">
          <button id="previous-file-change" class="nav-button" type="button">Prev File</button>
          <button id="next-file-change" class="nav-button" type="button">Next File</button>
        </div>
        <div class="change-nav-group">
          <button id="previous-change" class="nav-button" type="button">Prev Change</button>
          <div id="change-position" class="change-position"></div>
          <button id="next-change" class="nav-button nav-button-primary" type="button">Next Change</button>
        </div>
      </div>
    </main>
  </div>

  <footer id="action-bar" class="action-bar">
    <div class="action-group action-group-copy">
      <button id="copy-right-to-left" class="action-button" type="button">Copy Left</button>
      <button id="copy-left-to-right" class="action-button" type="button">Copy Right</button>
    </div>
    <div class="action-group action-group-save"></div>
    <div class="action-group action-group-open"></div>
    <div id="hint-strip" class="hint-strip"></div>
  </footer>
</div>
```

## Mapping From Current IDs

Current IDs that should be retired or absorbed:

- `directory-return-toolbar` -> `ContextBar`
- `directory-tree-toolbar` -> `NavigatorHeader` or `NavigatorFilterBar`
- `change-toolbar` -> split into `CanvasChangeNav` and `ActionBar`
- `history-toolbar` -> `TimelineBar`
- `file-info` -> `ContextTitle`

Current IDs that can remain:

- `history-back`
- `history-forward`
- `history-position`
- `previous-change`
- `next-change`
- `previous-file-change`
- `next-file-change`
- `toggle-readonly`

## CSS Token Plan

Add a small semantic token layer at the top of `media/style.css`.

```css
:root {
  --bg-shell: var(--vscode-editor-background);
  --bg-subtle: color-mix(in srgb, var(--vscode-panel-background) 82%, transparent);
  --bg-elevated: color-mix(in srgb, var(--vscode-panel-background) 94%, var(--vscode-editor-background));
  --border-muted: color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
  --border-strong: color-mix(in srgb, var(--vscode-panel-border) 85%, transparent);

  --accent-nav: rgba(79, 124, 255, 0.92);
  --accent-nav-fill: rgba(79, 124, 255, 0.14);
  --accent-time: rgba(221, 145, 67, 0.92);
  --accent-time-fill: rgba(221, 145, 67, 0.14);
  --accent-action: rgba(73, 190, 119, 0.92);
  --accent-action-fill: rgba(73, 190, 119, 0.14);

  --text-muted: var(--vscode-descriptionForeground);
  --text-strong: var(--vscode-foreground);
  --shadow-focus: inset 2px 0 0 var(--vscode-focusBorder, var(--accent-nav));

  --shell-gap: 12px;
  --shell-radius: 8px;
  --shell-padding: 12px;
  --rail-width: 280px;
  --timeline-height: 44px;
  --actionbar-height: 44px;
}
```

### Token semantics

- Use `--accent-nav` for hierarchy and file traversal.
- Use `--accent-time` only for history and timeline controls.
- Use `--accent-action` only for copy, save, and apply actions.
- Never use green to mean time.
- Never use amber to mean mutation.

## Keyboard Grammar

This should become the consistent keybinding vocabulary:

- `[` -> go up one hierarchy level
- `]` or `Enter` -> descend/open selected item
- `Left` / `Right` -> previous or next file
- `F7` / `Shift+F7` -> next or previous change
- `,` / `.` -> older or newer history step
- `Tab` -> move focus between navigator and canvas
- `Cmd/Ctrl+Alt+Left` / `Cmd/Ctrl+Alt+Right` -> copy current change

If a control is unavailable in the current mode, the keybinding should be inert rather than overloaded.

## Haptics And Motion

Bygone should use three distinct motion families.

### Hierarchy motion

- Use a short forward or backward slide for drill-down and back.
- Duration: `140ms` to `180ms`.
- Triggered by file open, back, and tree-to-file transitions.

### Timeline motion

- Use a crossfade with pinned headers.
- Duration: `120ms` to `160ms`.
- Triggered by older/newer history steps.

### Local change motion

- Use scroll reveal plus active hunk pulse.
- Duration: scroll-native plus `90ms` highlight pulse.
- Triggered by next/previous change.

File-to-file traversal inside drill-down should slide laterally inside the canvas but keep breadcrumb and timeline pinned.

## File Ownership

### `standalone/index.html`

- Replace the top stacked toolbar blocks with the canonical shell DOM.
- Keep IDs shared with the extension HTML.

### `src/diffViewProvider.ts`

- Generate the same HTML structure as `standalone/index.html`.
- Keep the shared shell identical except for CSP and resource URLs.

### `media/script.js`

- Own `BygoneUiState`.
- Derive shell region visibility from host data.
- Stop treating the header as separate toolbar islands.
- Add functions:
  - `updateModeChip()`
  - `updateContextBar()`
  - `updateTimelineBar()`
  - `updateNavigatorRail()`
  - `updateCanvasChangeNav()`
  - `updateActionBar()`

### `media/dom.js`

- Add rendering helpers for:
  - breadcrumb trail
  - navigator tabs
  - changed-files navigator list
  - history-list navigator list

### `media/style.css`

- Introduce token layer.
- Replace current header-only layout with shell grid layout.
- Keep Monaco and connector-specific styles intact.

### `standalone/main.js`

- Continue to own session state and host actions.
- Consider adding explicit UI payload fields rather than forcing the browser to infer every shell state from booleans.

### `src/fileComparator.ts`

- Mirror `standalone/main.js` behaviors where extension-side orchestration differs.

### `src/webviewMessages.ts`

- Add optional outbound shell metadata once phase 2 begins.

## Suggested Message Additions

Phase 1 can stay mostly derived in the browser, but phase 2 should add explicit shell metadata to outbound messages.

```ts
type ShellMeta = {
  modeLabel: string;
  breadcrumb?: Array<{ label: string; kind: string }>;
  navigatorMode?: 'hidden' | 'tree' | 'changed-files' | 'history-list';
  contextTitle?: string;
  canGoUp?: boolean;
};
```

Recommended placement:

- `ShowDiffMessage.shell?: ShellMeta`
- `ShowDirectoryDiffMessage.shell?: ShellMeta`
- `ShowMultiDiffMessage.shell?: ShellMeta`

## Implementation Phases

### Phase 1: Shell Reframe

- Introduce canonical DOM.
- Move history into `TimelineBar`.
- Move copy/edit into `ActionBar`.
- Keep directory tree rendering as-is.
- Keep changed-files navigation logic as-is.

Success criteria:

- One stable header/footer structure across all modes.
- No duplicated toolbar meanings.

### Phase 2: Navigator Rail

- Add `changed-files` rail.
- Add `Tree | Changed Files` switch in directory drill-down.
- Add selection persistence so active file is always obvious.

Success criteria:

- File traversal is visible, not just button-driven.
- Drill-down always shows sibling context.

### Phase 3: Haptics And Polish

- Add hierarchy slide, timeline crossfade, and active-hunk pulse.
- Improve keyboard focus ring and navigator focus handoff.
- Tune spacing and density for smaller windows.

Success criteria:

- Navigation layers feel distinct.
- Users can predict motion by action type.

## Acceptance Checklist

- `Back` always means hierarchy up, never previous file or previous commit.
- `Older/Newer` appears only for history traversal.
- `Prev/Next File` appears only when file sibling traversal is valid.
- `Prev/Next Change` never changes history or hierarchy.
- Copy and edit actions are never grouped with time controls.
- The same shell DOM is shared between extension and standalone.
- Directory drill-down keeps visible context about sibling changed files.

## Recommended First Build Order

1. Replace current toolbar DOM in `standalone/index.html` and `src/diffViewProvider.ts`.
2. Add shell region updaters in `media/script.js`.
3. Add shell layout tokens and grid in `media/style.css`.
4. Move current history and change controls into the new regions without changing behavior.
5. Add the `changed-files` navigator rail as a second pass.

## Open Questions

- Whether `NavigatorRail` should be collapsible in plain file history mode.
- Whether multi-diff should gain a navigator rail in phase 2 or stay canvas-only.
- Whether the action bar belongs at the bottom on desktop and on the right edge at wider widths.

Those are safe to defer. The shell split itself should happen first.
