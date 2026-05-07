# Bygone UI Button Redesign Plan

This note reduces the current shell design to two content axes and five navigation-focused action groups, then turns that model into a button layout plan.

## Core Model

### Content axes

- `file` vs `directory`
- `git` vs `non-git`

That yields the main user-facing modes:

- file diff
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

## Button Layout Plan

### App header

Keep only persistent, global controls here.

- app title
- mode chip
- read-only toggle
- open/external or palette-style global actions

### Context bar

Use this for hierarchy and drill-down context.

- back to directory view
- breadcrumb trail
- current file or directory label

This bar should answer “where am I?” and should not compete with history controls.

### Timeline bar

Use this only for git context.

- previous / next commit
- commit position
- left and right commit labels

This bar should answer “when am I?” and should disappear entirely outside git-backed views.

### Navigator rail

Use this for sibling traversal.

- directory tree in directory modes
- changed-files list in drill-down file modes
- history list where applicable

The rail should be the place for “what else is nearby?”

### Canvas change nav

Keep hunk traversal near the diff panes.

- previous / next change
- current change position

This should stay close to the visible diff, because it is about moving within the current file, not changing context.

### Action bar

Keep edit/copy operations separate from navigation.

- copy left/right
- save
- open external
- hint/help affordances

The action bar should stay available, but it should not be the primary place users go to understand where they are.

## Proposed Button Hierarchy

### Always visible

- app title
- mode chip
- read-only toggle
- context back button when drill-down is active

### Visible in file diff views

- previous / next change
- copy left / right

### Visible in directory views

- previous / next file
- directory tree controls

### Visible in git-backed views

- previous / next commit
- commit labels / position

### Visible in drill-down file views

- back to directory view
- previous / next file
- previous / next change
- copy left / right

## Suggested Redesign Order

1. Stabilize the shell regions first.
2. Move navigation controls into the correct region for their job.
3. Make copy/save actions visually subordinate to traversal.
4. Ensure file-history and directory-history share the same button vocabulary.
5. Only then polish spacing, iconography, and labels.

## Button Label Direction

Prefer labels that describe motion rather than implementation:

- `Back to Directory`
- `Older` / `Newer` for commits
- `Prev File` / `Next File`
- `Prev Change` / `Next Change`
- `Copy Left` / `Copy Right`

If a button only works in one mode, say so through placement and visibility rather than more text.

