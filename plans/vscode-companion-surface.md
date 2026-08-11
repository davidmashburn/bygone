# VS Code companion surface

## Status

Draft

## Goal

Make the VS Code extension a focused contextual companion to the standalone
application rather than a second, increasingly incomplete desktop host.

The extension should make Bygone useful at the moment a developer is looking
at a file in VS Code: compare it with another file, inspect its history, and
follow its changes without leaving the editor. Workflows that need an entire
repository canvas, several panels, directory navigation, branch-wide progress,
or guided presentation should open in the standalone application with the
relevant context already selected.

## Why this needs a separate plan

VS Code is a distinct product host, not merely another menu projection of the
standalone app. It has different constraints and native affordances:

- editor tabs and groups are the primary workspace, not an Electron window;
- VS Code already owns file editing, dirty state, undo, save, workspace search,
  source control, keyboard shortcuts, and context menus;
- extension webviews cannot safely or consistently behave like a desktop
  process with arbitrary CLI and filesystem capabilities;
- a narrow Activity Bar view is poorly matched to Bygone's horizontal visual
  comparison; and
- extension packaging, activation, trust, and remote-workspace behavior need
  their own contracts.

Without an explicit extension plan, shared renderer capability will continue
to leak into VS Code commands even when the resulting workflow does not fit
the host.

## Current surface and problems

The extension currently contributes commands for two- and multi-file
comparison, two- and multi-directory comparison, compare-with-selected, test
files, file history, branch review, and opening standalone downloads. Results
are hosted in a Bygone Activity Bar webview.

That surface has several issues:

- the Activity Bar gives a horizontal multi-pane tool too little width;
- standalone-scale workflows are reimplemented in the extension host;
- test fixtures are presented as a normal command;
- “Review Branch” implies a fuller review system than the viewed markers
  provide;
- the extension owns editing behavior in parallel with VS Code's document
  model; and
- users are offered a download link rather than a contextual hand-off when a
  workflow belongs in the desktop app.

## Product role

### Core in VS Code

Keep these workflows first-class and render them in an editor-area tab:

1. **Compare Active File With…**
   Choose another workspace or filesystem file and open a two-way Bygone
   comparison.
2. **Compare Selected Files**
   Compare exactly two compatible Explorer selections.
3. **Compare With Selected**
   Retain the familiar two-step selection workflow if users find it valuable,
   but make its staged selection state visible and cancellable.
4. **View Active File History**
   Follow one file through Git revisions, including the worktree/index states
   that the extension can represent accurately.
5. **Open This Comparison in Bygone Desktop**
   Continue a comparison when the user wants more panels or desktop features.

These workflows begin with the current file or a small explicit selection and
benefit from staying next to the developer's normal editor tabs.

### Hand off to standalone

Route these workflows to the standalone application instead of maintaining
full extension-host implementations:

- compare directories or directory histories;
- compare three or more files or revisions;
- compare arbitrary repository-wide Git states;
- explore the current branch change;
- present the current branch;
- open or present an authored tour; and
- advanced stacked or deconstructed scenes.

The command palette may still expose contextual commands such as **Explore
Current Branch in Bygone Desktop**. The distinction is ownership: VS Code
collects the workspace/repository intent, while standalone owns the session.

### Developer-only

Remove **Compare Test Files** from the production command palette and
activation surface. Keep fixtures callable only in extension development or
tests.

## Presentation location

Move primary comparison UI from a persistent Activity Bar webview to an
editor-area `WebviewPanel` or equivalent tab-based surface. Bygone needs
horizontal room, and users should be able to place it beside source editors,
move it between editor groups, restore it, and close it like other working
documents.

Do not keep a permanent Activity Bar container merely as a launcher. Commands,
Explorer/editor context menus, and an optional walkthrough or welcome action
are sufficient unless user evidence supports a persistent Bygone sidebar.

Each editor-area tab should have a stable title that names the comparison or
history target. Reopening or focusing an existing equivalent session is
preferable to creating duplicate tabs without warning.

## Editing ownership

VS Code remains authoritative for workspace-file editing:

- model writable content through `TextDocument`, `WorkspaceEdit`, or another
  VS Code-supported document path rather than direct filesystem writes from a
  webview;
- participate in VS Code undo, dirty indicators, save, file watchers, workspace
  trust, and external-change handling;
- mark Git blobs, historical revisions, and synthetic content read-only;
- do not maintain a second unsynchronized save/undo lifecycle merely because
  the standalone renderer supports one; and
- preserve unsaved editor content when it is the selected worktree source.

If this integration cannot be made reliable in the first editor-panel slice,
ship the extension comparison as read-only and add editing only after the VS
Code document bridge is verified. A clear read-only contract is safer than a
parallel editor that can overwrite newer workspace state.

## Find, replace, and search

The extension follows the same conceptual scales as the multi-scale search
plan but relies on VS Code where VS Code already has the stronger product:

- `Cmd/Ctrl+F`, Find Next/Previous, and writable-pane Replace operate within
  the active Bygone Monaco model.
- Search across the two currently displayed panes may be added through the
  shared comparison-search contract after active-pane behavior stabilizes.
- Repository and workspace search should defer to VS Code's native Search
  surface. Do not ship a second ripgrep process and competing ignore/filter UI
  inside the extension.
- Git-history search, directory comparison search, branch-change search, and
  tour search belong to standalone initially and can be launched with context.

When navigating from a Bygone match to a workspace file, use VS Code's normal
editor APIs so the user arrives in an ordinary editor with the expected
selection and focus.

## Desktop hand-off contract

Define a versioned, narrow launch-intent protocol instead of constructing an
arbitrary shell command. Supported intents initially include:

- compare resolved files;
- open a repository at a file or directory history target;
- compare named Git refs;
- explore a branch against a base; and
- open an authored tour path.

The hand-off should carry paths, repository root, refs, and requested mode—not
source contents. Validate that paths belong to the intended workspace or an
explicit user selection. Preserve remote-workspace identity rather than
pretending a local desktop app can open a remote path.

Preferred transport order:

1. a registered and versioned desktop URL/deep-link protocol;
2. an explicit user-configured executable path with argument-array spawning;
3. a clear installation/download action when the app is unavailable.

Never interpolate paths or refs into a shell string. If a hand-off cannot be
represented safely or the workspace is remote, explain why and keep the
current VS Code session usable.

## Workspace trust and environment support

- Read-only comparison of explicitly selected local files may work with
  limited trust if VS Code permits it.
- Git execution, broad filesystem discovery, and desktop hand-off must honor
  workspace trust.
- Remote SSH, containers, Codespaces, and virtual workspaces require explicit
  capability detection. Do not advertise local desktop hand-off for paths the
  desktop cannot access.
- Multi-root workspaces must retain the owning workspace folder and repository
  for every command.

## Command and menu surface

Recommended production commands:

- **Bygone: Compare Active File With…**
- **Bygone: Compare Selected Files**
- **Bygone: Compare With Selected** if the staged workflow remains
- **Bygone: View Active File History**
- **Bygone: Open This Comparison in Desktop**
- **Bygone: Explore Current Branch in Desktop**
- **Bygone: Present Current Branch in Desktop**
- **Bygone: Open Authored Tour in Desktop…**
- **Bygone: Install or Open Desktop App** only as a fallback/setup action

Explorer context menus should appear only for compatible selection counts and
resource kinds. Editor context menus should lead with current-file comparison
and history. Avoid separate “multiple” commands; selection count determines
whether an in-editor comparison is supported or a desktop hand-off is offered.

## Packaging boundary

Build the VSIX from an explicit allowlist of extension runtime assets. It
should not include standalone Electron sources, browser-presenter assets, tour
authoring documentation, shell completions, Homebrew templates, mockups,
internal plans, or release-only tooling merely because those files share the
repository.

Add an automated package-content assertion and a size budget. Shared renderer
bundles and their required workers remain valid extension assets; unrelated
host entry points do not.

## Relationship to other plans

- [Standalone product surface](standalone-product-surface.md) owns directory,
  branch, multi-panel, Git, and presentation workflows after hand-off.
- [In-document find behavior](find-behavior.md) defines the initial Monaco
  Find behavior shared by hosts.
- [Multi-scale search](multi-scale-search.md) defines common scopes and result
  contracts; VS Code delegates repository search to its native Search UI.
- [Refreshable sessions](session-refresh.md) supplies source identity and stale
  state semantics, but the extension adapts them to VS Code documents and
  workspace events.
- [Diff matching between panels](diff-matching-between-panels.md) remains a
  shared renderer/model concern and should behave identically for the same
  two-way input.
- [Text wrap option](text-wrap-option.md) is a shared editor preference, with a
  VS Code setting or editor action rather than a desktop View menu.

## Scope and non-goals

Included:

- A deliberate extension command set, editor-area presentation, native editing
  ownership, search delegation, standalone hand-off, trust behavior, and VSIX
  packaging boundary.

Not included:

- Recreating standalone directory, N-panel, branch, tour, or repository-search
  experiences inside VS Code.
- Replacing VS Code's Source Control or Search products.
- Assuming local desktop availability for remote workspaces.
- Building a hosted review/comment synchronization system.

## Delivery sequence

1. Instrument or manually audit current command use and document the migration
   mapping for every contributed command.
2. Define editor-area session identity and implement the two-way file
   comparison panel without changing diff semantics.
3. Integrate active-file history into the same editor-area lifecycle.
4. Make VS Code documents authoritative for editable worktree content, or
   explicitly ship the panels read-only until that bridge is safe.
5. Implement and test the versioned desktop hand-off for local workspaces.
6. Replace standalone-scale commands with contextual hand-off commands and
   remove test fixtures from production contributions.
7. Remove the Activity Bar container unless usage evidence justifies a smaller
   persistent role.
8. Apply an explicit VSIX allowlist and package-content tests.
9. Verify local, multi-root, untrusted, and supported remote-workspace behavior
   before calling the boundary stable.

## Validation

- Verify command visibility for zero, one, two, and three-or-more selected
  files and directories.
- Verify editor-area sizing, restoration, focus, keyboard access, theme,
  accessibility, and multiple editor groups.
- Verify active-file history through rename, staged, worktree, deleted, and
  untracked states as supported.
- Verify editing uses VS Code undo, dirty, save, external-change, and watcher
  behavior without direct stale writes.
- Verify every desktop hand-off intent, missing-app fallback, rejected path,
  unsafe ref, multi-root repository, and remote-workspace limitation.
- Verify package contents and activation events contain no developer-only or
  unrelated standalone/tour tooling.
- Use only open-source fixtures created for Bygone; do not add proprietary
  source, paths, history, screenshots, or derived snapshots to tests or
  release artifacts.

## Acceptance criteria

- The extension has a concise one-sentence role: contextual visual file
  comparison and file history inside VS Code, with hand-off for larger work.
- Core comparisons open in an editor-area tab with enough horizontal space.
- VS Code, not the webview, owns writable workspace documents and their
  lifecycle.
- Directory, N-panel, branch-wide, tour, and repository-search workflows do
  not require parallel extension implementations.
- Local desktop hand-off is safe and contextual, while remote limitations are
  explicit.
- Production commands and VSIX contents exclude test fixtures and unrelated
  host assets.
