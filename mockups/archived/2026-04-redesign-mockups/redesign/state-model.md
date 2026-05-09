# Bygone UI state model

A catalogue of the state changes and actions the chrome has to serve, before
we design the chrome against it. The goal is to name every axis once, note
where axes collide, and flag the decisions that are still open.

## The layered model

Bygone is two things stacked:

- **Layer 1 — Generic diff + edit engine.** N panes (N ≥ 2), each backed by
a source-of-truth that's a file or directory on disk. Each pane carries a
path, content, a `writable?` flag derived from the source, and viewport
state. Dir panes drill down to files. The engine has no concept of git —
it'd work just as well comparing `/tmp/a` and `/tmp/b`.
- **Layer 2 — VCS overlay.** Substitutes L1's filesystem inputs with
git-derived virtual ones (commit blobs, staged blobs, branch tips). Only
the working-tree input is writable — every other ref kind is read-only by
construction. "Working tree vs HEAD," "branch vs branch," "file history"
are all configurations of this layer. L2 tells L1 what to show; L1 still
does all the rendering and editing.

Writability, copy semantics, and most of today's confusing affordances live
at the coupling between the two.

## Layer 1 — diff + edit engine

### L1.1 Scope

- File ↔ file.
- Dir ↔ dir; drill into any row to become file ↔ file; zoom back out restores
the dir state.
- N ≥ 3 panes are supported by the engine but **CLI-only for now** — the
chrome is designed around N = 2. Growing a window from 2 to 3 panes
dynamically is deferred.

### L1.2 Pane inputs

- Each pane: path, content, `writable?`, viewport.
- `writable?` is derived from the source. A user-facing "editable" toggle is
only meaningful when the source *could* be writable and we're choosing to
lock it.

### L1.3 Within-view navigation

- File: next/prev change; next/prev line (cursor); next/prev sibling file on
disk (`[` / `]`).
- Dir: next/prev row; expand / collapse; expand-all, collapse-all,
collapse-unchanged.
- Pane focus: which pane is active (affects every "which side does this act
on?" answer).

### L1.4 Edit and copy

- Typing into any writable pane.
- Copy between panes where the target is writable. Three sub-axes:
  - **Granularity**: line / range / change / whole file.
  - **Direction**: any writable pane is a valid target. At N > 2 this is
  "from pane X to pane Y," not just L↔R.
  - **Trigger**: keyboard, button, context menu, drag.
- Save / revert / discard on each writable pane.

### L1.5 View flags

- Collapse-unchanged (file).
- Ignore whitespace.
- Sync scroll.
- Word wrap.
- Line numbers.
- Diff algorithm.

### L1.6 Async / load

- Large file; binary; LFS pointer; submodule; encoding issue.
- Stale (file changed on disk under us) → reload or ignore.

### L1.7 Error / empty

- Path missing on one side (added / deleted).
- Permission denied.
- No differences.

### L1.8 Launch context

- `bygone a b` (two paths — files or dirs).
- `bygone a b c ...` (N paths, CLI only).
- Drag-drop onto an open window.
- Multiple windows; new comparison in same window — replace current vs
stack (deferred).
- **Cold start always.** No persistence across launches, no recent-list, no
per-repo preferences. The filesystem is the source of truth; on exit the
app does a save-to-disk check for any unsaved writable pane and that's
the extent of its state.

## Layer 2 — VCS overlay

### L2.1 Configuration

- Two-ref comparison (any two of: commit / branch / tag / staged / working
tree). **The chrome target.**
- N-ref comparison is supported by the engine (`main`, `feature`, `working tree`; or `HEAD~2`, `HEAD~1`, `HEAD`; etc.) but not exposed in the chrome
at this time.
- **File history**: a single cursor on the file's commit list; the two
panes are the locked pair `(parent, commit)` at that cursor. Position is
a single number (e.g. 12 / 86). `includeStaged` adds virtual newest-end
entries. (An N-pane version of history — locked window vs independent
cursors per pane — is deferred along with N > 2 in L2.)

### L2.2 Ref kinds

- `commit SHA`, `HEAD~N`, `branch`, `tag`, `staged`, `working tree`,
`untracked-on-disk`.
- Only `working tree` (and a loose read of `untracked-on-disk`) is writable.
- Ref-kind legibility matters at the chrome level: `HEAD~1` and `working tree` look identical today but behave very differently.

### L2.3 Ref actions (non-history configurations)

- Change ref per pane.
- Swap ⇄ (N-pane reorder is deferred along with N > 2 in L2).
- Follow-renames (global).
- `includeStaged`, `includeUntracked` (global).

### L2.4 History actions

- Older / newer: shift the locked `(parent, commit)` pair one step along
the file's commit list.
- Jump to commit / scrubber.
- `includeStaged`: adds virtual newest-end entries.
- Entry points into history mode:
  - CLI: `bygone --history <file>`.
  - VS Code extension: right-click menu on a file.
  - Desktop app: `File → Open…` option (or similar) on a file.

### L2.5 Launch context

- `bygone .` (typically working tree vs HEAD on a repo).
- `bygone <ref> <ref>` (two-ref comparison).
- `bygone <ref> <ref> <ref> ...` (N-ref, CLI only).
- `bygone --history <file>`.
- VS Code webview invocation (including history entry via right-click).
- Cold start — see L1.8.

## L1 ↔ L2 coupling

The rules that live at the boundary between the layers carry most of today's
UI confusion:

- **Writability is derived from L2, enforced by L1.** At most one writable
pane (the working-tree pane, if present). At N = 2 this often reads as
"right side edits, left side doesn't"; worth making the rule visible
rather than implicit.
- **Copy direction is not symmetric under L2.** Pure-L1 copy is
any-writable-to-any-writable. Under L2 there's usually exactly one valid
target. Today's symmetric `← Copy` / `Copy →` implies a symmetry that
rarely holds.
- **Focused-pane visibility.** Every "which side does this act on?" answer
depends on it; at N = 2 it's easy to lose track, and the chrome should
make it obvious which pane is active.
- **Ref-kind legibility.** `HEAD~1` and `working tree` should not look
identical in the chrome — they behave very differently (read-only vs
writable, static vs moving under git operations).

## Overloading hotspots

1. **"Next" is many things.** Change / line / dir-row / sibling-file /
  pane-focus at L1; older-newer and ref-change at L2. Decide which live
   on dedicated controls vs contextual bindings.
2. `**[` / `]` vs next-changed-file.** Sibling-on-disk is pure L1;
  next-changed-file needs L2 to define "changed." They look similar but
   live on different layers.
3. **Focused pane invisibility.** One of the simplest things to fix; one of
  the most load-bearing for everything else.
4. **Copy chrome assumes symmetry** — a pure-L1 truth that L2 almost always
  breaks.
5. **Ref kind collapsed into one cell** — pure L2 legibility issue.

## Explicitly out of scope

Merge, conflict resolution, committing, stashing, branch management. Writing
to the staging area has been raised as a possible future extension but is
not currently planned — it'd blur the "edits only on working tree" rule and
is left off the design.

## Decisions

- **N-pane at L1**: engine supports N ≥ 3, chrome targets N = 2. N-pane is
CLI-only for now.
- **N-pane at L2**: not exposed in the chrome at this time.
- **History model**: locked `(parent, commit)` pair, one cursor. N-pane
history is deferred along with N > 2 at L2.
- **History entry points**: CLI (`--history`), VS Code extension
right-click, desktop app File menu.
- **Persistence**: cold start, every launch. No recent list, no per-repo
prefs. Filesystem is the source of truth; on exit, prompt to save unsaved
writable panes.
- **Repo mutation**: no. Bygone reads git and writes the working tree. No
stage / commit / checkout / stash from Bygone.

## Deferred

- Growing a window from N = 2 to N = 3 dynamically.
- N-pane history semantics (locked window vs independent cursors per pane).
- Column / pane reorder affordance.
- New comparison in the same window (replace vs stack).

## Open

The chrome problem now reduces to: a minimum set of controls whose state
and keybindings don't collide across the L1 × L2 axes above, with focused
pane, ref kind, and writability all legible at a glance.