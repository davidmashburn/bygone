# Bygone UI Button Redesign Plan

This note reduces the shell to two content axes and five navigation-focused action groups, then records the concrete layout decisions reflected in the mockup.

## Core Model

### Content axes

- `file` vs `directory`
- `git` vs `non-git`

That yields the main user-facing modes:

- standalone file diff
- file drill-down diff
- directory diff
- file history
- directory history

### Navigation-focused actions

These are the actions the shell should optimize for:

1. Into file view / out to directory view
2. Previous / next change
3. Previous / next file
4. Previous / next commit
5. Copy left / right

## Design Principles

- Keep the shell stable across modes.
- Put navigation actions in predictable regions, not scattered across the canvas.
- Make mode transitions obvious, but keep them secondary to traversal.
- Separate structural navigation from mutation actions.
- Do not force a control to mean two different things in two different modes unless the label and placement make that obvious.
- Avoid redundant labels when the selected mode and surrounding shell already communicate the state.
- Prefer one real choice over multiple fake choices. If a rail only has one valid scope, show one pill or none.

## Button Layout Plan

### Context row

Use this for hierarchy and drill-down context.

- back action when drill-down is active
- breadcrumb trail

The context row should answer “where am I?” and should not compete with history controls. In the current mockup, the extra mode label was removed because it repeated information already visible from the selected tab and overall shell state.

### Timeline bar

Use this only for git context.

- older / newer commit
- commit position
- left and right commit labels

This bar should answer “when am I?” and should disappear entirely outside git-backed views. Commit stepping stays here and should not be merged into file/change traversal controls.

### Navigator rail

Use this for sibling traversal.

- changed-files list in non-history directory/file drill-down modes
- history list by default in history modes
- changed-files as a secondary scope in history modes

The rail should be the place for “what else is nearby?” For this redesign, the rail intentionally moved away from a tree-first presentation:

- `Directory Diff` uses the same changed-files rail style as drill-down for consistency.
- `Directory History` and `File History` default to `History`, with `Changed files` available as a second pill.
- Same files should not appear in the changed-files rail.
- Status belongs on the left in the rail, using color and symbols:
  - blue `±` for changed on both sides
  - red `-` for left-only
  - green `+` for right-only
- The rail does not need a separate title when pills already provide the scope name.

### Canvas control strip

Keep within-file traversal and copy actions near the diff panes.

- previous / next file
- previous / next change
- copy left / right
- current position chip

The current arrangement is:

- left cluster: file/change traversal
- center cluster: copy left, position chip, copy right

Key decisions captured in the mockup:

- The `x/y` position chip must align to the visual gutter centerline, not merely the center of the control row.
- File navigation and change navigation remain distinct concepts.
- In directory modes, `Prev/Next Change` is dropped rather than overloaded.
- In history file views, copy into the historical left side is disabled while copy to the working-tree right side remains enabled.
- Copy controls are icon-based but should visually communicate “apply to left/right pane,” not generic duplicate semantics.

### Action bar

Keep save/help-style actions separate from navigation.

- save
- help or other secondary commands

The action bar should stay available, but it should not be the primary place users go to understand where they are. The redesign moved copy out of the footer and into the canvas control strip because copy is tightly coupled to the currently visible diff state.

## Proposed Button Hierarchy

### Always visible

- selected top-level mode tab
- breadcrumb/context row
- back button when drill-down is active

### Visible in file diff views

- previous / next file where sibling navigation exists
- previous / next change
- copy left / right

### Visible in directory views

- previous / next file
- changed-files rail
- no copy
- no previous / next change

### Visible in git-backed views

- older / newer commit
- commit labels / position

### Visible in drill-down file views

- back
- previous / next file
- previous / next change
- copy left / right

### Visible in history file views

- back
- older / newer commit
- previous / next change
- history rail by default
- copy to the working-tree side only

## Suggested Redesign Order

1. Stabilize the shell regions first.
2. Move navigation controls into the correct region for their job.
3. Align directory and file presentations to the same visual language.
4. Ensure file-history and directory-history share the same button vocabulary.
5. Only then polish spacing, iconography, and labels.

## Label And Icon Direction

Prefer labels that describe motion rather than implementation:

- `Back` rather than `Back to Directory` once context is already obvious
- icon-only commit buttons with tooltips for `Older commit` / `Newer commit`
- icon-only file and change traversal buttons with tooltips
- icon-only copy buttons with left/right target semantics, not generic clipboard semantics
- `History` and `Changed files` as the preferred rail pill labels

If a control only works in one mode, say so through placement, visibility, and disabled state rather than extra explanatory text.
