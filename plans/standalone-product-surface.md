# Standalone product surface

## Status

In progress; the quick surface cleanup is implemented and broader guidance remains.

The development branch now has conventional File/Edit/Git/Present/Navigate/
View/Window menus, pane-local Find/Replace with read-only replacement
disablement, production-only removal of fixtures and developer tools, Open
Authored Tour, visible panel mutability labels, and visible-pane search.

## Goal

Give the standalone application a coherent information architecture as its
diff, Git, and tour capabilities grow. Users should be able to predict where
an action lives, what kind of state it operates on, and whether the result is
editable without learning CLI argument-count rules or internal session names.

The product should present two related jobs:

- **Explore** files, directories, revisions, and branch changes interactively.
- **Present** an automatic or authored explanation of a change.

Authoring automation and developer fixtures remain supporting tools rather
than additional top-level product modes.

## Context

The standalone application has grown from a file comparator into the primary
host for direct comparisons, directory browsing, multi-panel diffs, file and
directory history, arbitrary Git revision comparison, branch exploration, and
change tours. These capabilities largely belong in a full-canvas desktop app,
but their entry points currently overlap:

- one file means history while two files mean a comparison;
- a history picker may accept either a file or directory;
- general revision comparison and branch exploration both display Git deltas;
- an automatic branch tour and an authored tour use a separate presenter even
  though neither is discoverable as a desktop product area; and
- test fixtures and Chromium developer tools appear beside user workflows.

Argument-count shortcuts can remain convenient CLI behavior, but they should
not define the visible product vocabulary.

## Product model

### Explore

Explore is the normal application workspace. It answers open-ended questions
and permits editing only when a panel represents writable filesystem content.

| Workflow | User question | State model | Editing |
| --- | --- | --- | --- |
| Blank comparison | “I need panes for unsaved or pasted content.” | In-memory buffers | Yes |
| Compare files | “How do these supplied files differ?” | Filesystem snapshots | Yes when writable |
| Compare directories | “What differs between these directory trees?” | Filesystem trees and selected files | Yes when writable |
| Multi-panel comparison | “How does this content vary across several snapshots?” | Ordered supplied snapshots | Yes when writable |
| Path history | “How did this file or directory change over time?” | Git revisions plus optional index/worktree | Only writable worktree content |
| Compare revisions | “What differs between these exact Git states?” | Explicit refs, index, or worktree | Only writable worktree content |
| Explore branch change | “What is the total change on this branch?” | Merge base to branch head | Read-only committed snapshots |

Use **viewed**, not **reviewed**, for local progress markers. Exploring a
branch does not submit a review, synchronize comments, or represent approval.

### Present

Present is a guided reading experience in a dedicated presenter:

- **Present Current Branch** builds an automatic file-level tour from the
  current branch range.
- **Open Authored Tour…** validates and opens a `.bygone.yaml` source with
  authored narrative, ordering, focus, and optional advanced scenes.

A walkthrough focuses the reader within the real base/head change. A stacked
diff shows real selected Git revisions. A deconstructed diff shows synthetic,
cumulative explanation stages built from a real change; those stages are not
commits and must never be labeled “deconstructed commits.”

### Author and develop

Tour context, validation, compilation, coverage, and schema commands remain
CLI or agent-facing authoring tools. Test fixtures, smoke and capture modes,
window sizing, and Chromium developer tools remain developer-only. They
should not be mixed into production menus merely because the desktop host can
invoke them.

## Proposed menu structure

Exact labels should receive a final platform-native copy pass, but the menu
ownership and ordering should follow this structure.

### Application menu

Use the platform-standard application menu on macOS and its normal equivalents
elsewhere:

- About Bygone
- Settings… when user preferences exist
- Services, Hide, Hide Others, Show All, and Quit on macOS

Do not create empty or non-functional preference surfaces just to fill a
conventional menu slot.

### File

- **New Blank Comparison**
- **Compare Files…**
- **Compare Directories…**
- **Add Panel…** when the current session supports another panel
- **Remove Active Panel** when more than the minimum number of panels exists
- **Save**
- **Save All** when more than one writable panel is dirty
- **Reload from Disk** when filesystem-backed content can be refreshed
- **Close Window**

Two-item and multi-item selection should share the same file or directory
picker. Do not expose separate “multiple files” commands merely because they
produce more panels.

### Edit

Expose the conventional editing surface and route editor-sensitive actions to
the focused input or active Monaco pane:

- **Undo**
- **Redo**
- separator
- **Cut**
- **Copy**
- **Paste**
- **Paste and Match Style** where the platform provides it
- **Delete**
- **Select All**
- separator
- **Find…**
- **Find Next**
- **Find Previous**
- **Replace…**
- **Replace All**

Use platform-standard roles and accelerators wherever Electron can correctly
target the focused native or web input. When the active target is Monaco,
route the command to the editor action so selection, undo history,
accessibility, and find state remain owned by Monaco rather than Electron page
search.

Command enablement must reflect the active target:

- Copy, Select All, and Find work in writable and read-only text panes.
- Cut, Paste, Delete, Undo, Redo, Replace, and Replace All require a writable
  text target and disable for Git snapshots, tours, binary views, and directory
  lists.
- Find and Replace initially operate within the active text pane. Broader
  comparison, directory, repository, history, and tour search belongs to the
  separate search surface described in the multi-scale search plan.
- Replace must participate in the pane's normal dirty, undo, save, reload, and
  diff-recomputation lifecycle. It must never mutate a historical or synthetic
  snapshot.

### Git

- **View File or Directory History…**
- **Compare Revisions…**
- **Explore Current Branch Change**
- **Refresh Repository State** when the current session has a Git source

The three primary actions answer different questions:

- History follows one path through time.
- Compare Revisions compares explicitly chosen states.
- Explore Current Branch Change opens the complete merge-base-to-head delta.

### Present

- **Present Current Branch**
- **Open Authored Tour…**

Opening a tour should be discoverable in the desktop application even if the
presenter remains a separate window and local server internally.

### Navigate

- **Next Change**
- **Previous Change**
- **Next File**
- **Previous File**
- **Next Revision**
- **Previous Revision**
- **Return to Tour** when the user has browsed away from the active scene

Enable only commands meaningful to the current session. Navigation should not
silently change the active comparison kind.

### View

- Toggle file, history, or tour rail when present
- Toggle synchronized scrolling
- Toggle line wrapping
- Reset editor layout or panel widths
- Zoom In, Zoom Out, and Actual Size
- Toggle Full Screen

Avoid placing data-source actions such as history or branch comparison under
View merely because they alter what is displayed.

### Window and Help

Use platform-standard window controls. Help should link to concise user-facing
documentation for Explore, Present, keyboard shortcuts, and tour authoring,
plus release and issue-reporting information as appropriate.

### Developer menu

Show this menu only in development builds or after an explicit developer-mode
opt-in:

- Compare Test Fixtures
- Open Smoke or Capture Fixture
- Reload Renderer
- Toggle Developer Tools

## Discoverability and state guidance

Each newly opened session should identify itself in visible copy: comparison,
history, revision comparison, branch change, or tour. Empty states should
offer the relevant primary actions rather than expose internal mode names.

Every text panel should communicate its provenance and mutability:

- filesystem path and writable/read-only state;
- Git ref and object identity for historical content;
- `INDEX` or `WORKTREE` for repository work states; or
- **Explanation stage** for synthetic deconstructed content.

If an action changes product area—for example, presenting the current branch
from an Explore session—the UI should make the transition explicit rather
than replacing the current session with a visually similar but semantically
different state.

## Internal product-surface overview

Maintain one source-controlled internal overview on the development branch
that maps every user-facing command and launch form to:

- its user question and product area;
- the owning host and shared components;
- its state and revision model;
- editing, save, undo, reload, and refresh behavior;
- discoverability through menus, commands, files, or CLI;
- maturity: core, secondary, advanced authoring, experimental, or
  developer-only; and
- at least one representative test or documented example.

Update that overview in the same change that adds a mode, scene type, launch
form, or product command. This is the durable check against renderer sharing
turning into accidental product-surface sharing.

## Architecture follow-up

The current main-process and renderer coordinators own many cross-cutting
session concerns. After the menu and session vocabulary stabilize, separate
responsibilities around these boundaries:

- launch routing and intent normalization;
- mode-specific session controllers;
- filesystem editing and saving;
- Git snapshot sources;
- refresh and watcher policy;
- menu-state projection; and
- presentation launching.

This is not a prerequisite for relabeling and regrouping the current surface.
Avoid a large architectural rewrite before the desired product model has been
validated in the UI.

## Scope and non-goals

Included:

- Standalone product vocabulary, menu ownership, editing rules, development
  command isolation, and internal surface documentation.
- Clear separation of open-ended exploration and guided presentation.
- Compatibility guidance for current CLI launch shortcuts.

Not included:

- Removing CLI shortcuts that existing workflows may use.
- Turning branch exploration into a hosted code-review system.
- Moving tour-authoring schema and validation into desktop forms.
- Implementing multi-scale search, which has its own plan.
- Rewriting the renderer or main process before the surface is validated.

## Related plans

- [VS Code companion surface](vscode-companion-surface.md), which owns the
  contextual editor host and desktop hand-off boundary
- [In-document find behavior](find-behavior.md)
- [Multi-scale search](multi-scale-search.md)
- [Focused multi-panel strip](focused-multi-panel-strip.md)
- [Deconstructed diffs](deconstructed-diffs.md)
- [Product implementation roadmap](implementation-roadmap.md)

## Delivery sequence

1. Agree on the standalone/VS Code ownership boundary and inventory every
   current menu item, CLI launch form, session mode, extension command, and tour
   entry point against the product-surface overview fields.
2. Add the full Edit menu and active-target command routing, including
   pane-local Find and writable-pane Replace.
3. Regroup File, Git, Present, Navigate, and View commands; hide developer
   commands in production builds.
4. Add visible session-kind, provenance, and mutability guidance.
5. Add **Open Authored Tour…** and make the Explore-to-Present transition
   explicit.
6. Test menus, accelerators, enablement, focus routing, and state transitions
   on supported platforms.
7. Only then extract architectural controllers where the stabilized behavior
   provides clear boundaries.

## Acceptance criteria

- A new user can locate direct comparison, history, revision comparison,
  branch exploration, and presentation without learning CLI arity rules.
- The Edit menu contains the expected platform editing and find/replace
  commands, and each targets the focused writable or read-only pane correctly.
- No replace operation can mutate Git history, a tour, or a synthetic stage.
- Developer fixtures and tools are absent from normal production menus.
- Branch progress is described as viewed rather than reviewed.
- Every product mode and scene type appears in the internal overview with
  ownership, mutability, maturity, discovery, and verification guidance.
