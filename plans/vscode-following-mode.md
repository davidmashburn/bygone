# VS Code following mode

## Status and recommendation

First slice implemented and locally verified, 2026-10-23, following user approval.
The opt-in comparison pane follows the active source editor. Its implementation
is present in local `main` at `ec318cfbd9d9cddef2fcac150723958c0f7987c2`, inspected
2026-10-24. Git context and symbol navigation are now consolidated in the
[SCM and symbol integration plan](vscode-scm-symbol-integration.md), which
supersedes the deeper-integration sequencing below. This extends the
[VS Code companion surface](vscode-companion-surface.md).

The [Lima feasibility spike](vscode-following-mode-feasibility.md) now verifies
the development environment, real renderer/focus behavior, buffer updates,
TypeScript outline access, and Git API availability. It also reproduces a
refresh race that the implementation now fixes, along with asynchronous
comparison setup targeting. See the implementation follow-up in that evidence
note for validation and remaining limits.

Interpret “any file open in VS Code” as the file the user is actively viewing,
including files reached through Quick Open, Explorer, or Go to Definition.
Opening documents in the background must not change the target. The initial
comparison is **HEAD → current editor buffer**, including unsaved edits.
The user approved this first-slice scope. Following the latest historical change
remains a distinct possible future mode.

## Experience and first-release contract

1. **Bygone: Follow Active Editor** opens one reusable editor-area pane beside
   the source, preserving typing focus. Subsequent source switches update that
   pane in place; they do not create tabs or move it between groups.
2. The pane names the repository, file, baseline, and unsaved-buffer state.
   Following is visibly enabled. **Pin** holds the current file and baseline;
   its buffer can continue updating. **Resume Following** selects the current
   source editor. These controls do not change ordinary comparison tabs.
3. Closing the pane stops following and cancels pending work. Starting again
   is explicit. Reload does not silently resume following in the first slice;
   any restored follow tab is paused until resumed.
4. Switching between source editors changes the target. Focusing Bygone,
   terminal, or other non-text UI retains the last target. An explicitly
   selected unsupported document shows its own unavailable state instead of
   presenting the previous file as current.
5. Followed comparisons are read-only inside Bygone initially. Edit, save,
   undo, and redo remain in the source editor and update the comparison.
   Existing editable manual comparisons retain their current behavior.
6. Show unchanged files with **No changes from HEAD**. Never silently fall
   back to the last commit that changed the file. Offer the existing file
   history command as a deliberate alternative, pausing following while the
   user explores history.

“Any file” means predictable handling, not a fabricated diff for every input:

- Local text files in a trusted Git worktree: compare the resolved HEAD blob
  with the open document. Resolve the owning repository per file, including
  multiple workspace roots and linked worktrees.
- New/untracked files and repositories without commits: use an explicitly
  absent baseline and show an addition. Distinguish a missing path from a Git
  failure; permission or command errors must not become empty baselines.
- Renames: use a verified old/new Git path mapping when available; otherwise
  disclose the missing baseline at the new path rather than guessing identity.
- Files outside Git: show **No Git baseline**, with manual comparison access.
- Untitled documents, remote/virtual URIs, notebook cells, binary inputs,
  oversized files, and untrusted workspaces: show a concise unsupported state
  for this first slice. Do not automatically launch Desktop or external tools.
- Native SCM diff tabs: resolving the intended working-file side is deferred;
  recognize the diff tab and explain that the source file must be opened.

## Implementation boundaries

Add a small extension-owned follow controller, registered in `src/extension.ts`,
with explicit stopped/following/pinned states and disposable subscriptions.
Separate target selection, baseline loading, and panel rendering so ordinary
comparison/history state is not repurposed as global follow state.

Use active-editor changes as the trigger, not document-open events. Observe
document edits and saves for the selected target. Coalesce bursts and attach
a generation plus document version to each request: a slow response for A
must never overwrite B or a newer edit. Invalidate pending requests on pin,
resume, close, and repository changes. Recompute only the selected file;
do not build its entire history or scan the workspace on each switch.

The spike demonstrated that guarding the Git lookup alone is insufficient:
`refreshCurrentDocumentDiff` reads mutable `currentTwoWayDiff` across awaits.
Capture the panel, comparison identity, both source URIs, and document version
before asynchronous reads; publish only if that same request is still current.
Test a switch between the left and right reads and disposal during either read.
The existing provider can otherwise combine A's baseline with B's buffer.

Extend `src/diffViewProvider.ts` with a dedicated follow panel identity and a
render/update path that preserves focus. Its current file-pair identity and
focus-taking reveal path are unsuitable for direct reuse as the follow loop.
Keep baseline content immutable and buffer content document-backed without
treating the baseline as an editable filesystem URI. Preserve navigation on
same-file refresh; reset intentionally when the target changes.

Resolve HEAD to an OID for each selected target and label it. Refresh the
baseline on target activation, explicit Refresh, and return to the VS Code
window; avoid Git subprocesses on every keystroke. In the first slice,
external Git changes while the window remains active require Refresh and
the UI must make that limitation clear. Keep Git reads asynchronous and
bounded; cache blobs by repository/OID/path. Pin holds the resolved OID;
Refresh while pinned refreshes the buffer without advancing that baseline.

Reuse the existing renderer and document-content access. Add only the narrow
HEAD resolver needed here, retaining missing/error distinctions. Do not wire
automatic following through synchronous full-history construction. Define
file-size and subprocess-time budgets before implementation QA; defer expensive
inputs with an explanation and keep ordinary file switching responsive.

## Deeper integration, in order

### 2. Git-aware comparison context

Add explicit source choices: HEAD → buffer, index → buffer (unstaged changes),
HEAD → index (staged changes), and a selected revision or merge-base → buffer.
Label endpoints accurately: staged mode does not contain unsaved buffer edits.
Keep baseline preferences scoped to their owning repository; never carry a
revision selected in repository A silently into repository B.

Add read-only Git status, native SCM entry points, rename/deletion handling,
and baseline invalidation on branch, commit, index, and worktree changes.
Evaluate the built-in Git extension's exported API before selecting an event
source; keep a graceful fallback if it is unavailable. Handle linked-worktree
metadata correctly. No stage, commit, checkout, or discard actions are needed.
Branch-wide exploration continues through the existing Desktop hand-off.

### 3. Symbol tree and source navigation

Ask VS Code's document-symbol provider for the current buffer's outline.
Preserve hierarchical results; handle flat results and unavailable providers.
Selecting a symbol reveals its current range in Bygone. Offer explicit return
to the source location, then optionally cursor-to-symbol following once focus
and navigation loops are tested. Do not automatically mirror every scroll.

VS Code exposes the provider through
[`vscode.executeDocumentSymbolProvider`](https://code.visualstudio.com/api/references/commands).
Associate results with the document version and discard stale responses.
Outline availability depends on installed language support and must not block
the diff. This describes current structure; it does not prove cross-revision
identity, moves, renames, or behavioral equivalence.

### 4. Historical symbols and richer context

Connect validated comparison-local symbol evidence from
[semantic correspondence](semantic-correspondence-experiment.md) and
[Symbols language support](symbol-language-support.md). Require source hashes
and ranges to match the displayed endpoints. An artifact for committed HEAD
cannot be applied silently to a dirty buffer; either compute matching evidence
or mark it unavailable. Keep ambiguity visible and retain the whole-file diff.

Definition/reference navigation may later use installed language providers,
but current-workspace bindings do not establish historical bindings. A live
Desktop follower would require a separate connection lifecycle, routing, and
buffer-sharing contract; existing launch commands are not that connection.

## Acceptance and next slice

The first implementation should demonstrate these behaviors in an Extension
Development Host using small public or synthetic repositories:

- Enable on A, switch A → B → C rapidly: one follow pane, C wins, and the
  source keeps keyboard focus. Split editors and preview tabs behave alike.
- Type, undo, save, and make an external edit: the pane reflects the current
  VS Code document without replacing dirty buffers or writing files itself.
- Pin A, navigate to B, then resume: A remains pinned until resume chooses B.
  Clicking the pane does not trigger an update loop or steal later focus.
- Close during loading: no resurrected panel, late render, or retained
  subscription. Reload requires explicit resume.
- Exercise unchanged, added, renamed, absent-baseline, unborn-HEAD, non-Git,
  unsupported, and Git-error cases with accurate labels and no stale target.
- Switch between repositories and linked worktrees; commit or change branches
  and Refresh. Verify the displayed OID and buffer belong to the same target.
- Existing manual file-pair tabs, editing/undo, history, restoration, and
  Desktop commands continue working independently.

Use focused automated controller tests for lifecycle, stale-result rejection,
and baseline/error handling; use real Git fixtures for source resolution.
Manual host QA is required for focus, editor-group behavior, and disposal.
Then run the extension's existing automated checks and package validation.
Measure switch-to-render latency before choosing a performance threshold;
no latency claim or delivery estimate has been established by this scoping.

## Evidence and confidence

Inspected clean `main` at `b1f7627e800be34d4bc9611b7ac4136789bb9d7a`
on 2026-10-23. This proposal depends on no uncommitted implementation changes.
Source links below pin the inspected version:

- [`extension.ts`](https://github.com/davidmashburn/bygone/blob/b1f7627e800be34d4bc9611b7ac4136789bb9d7a/src/extension.ts): command-driven activation, no active-editor follow subscription.
- [`diffViewProvider.ts`](https://github.com/davidmashburn/bygone/blob/b1f7627e800be34d4bc9611b7ac4136789bb9d7a/src/diffViewProvider.ts): reusable panels, document-change subscriptions, and focus-taking `revealPanel`.
- [`fileComparator.ts`](https://github.com/davidmashburn/bygone/blob/b1f7627e800be34d4bc9611b7ac4136789bb9d7a/src/fileComparator.ts): open-buffer reads and shared history-navigation state.
- [`gitHistory.ts`](https://github.com/davidmashburn/bygone/blob/b1f7627e800be34d4bc9611b7ac4136789bb9d7a/src/gitHistory.ts): HEAD/index/worktree comparison concepts and synchronous Git execution.
- [VS Code API](https://code.visualstudio.com/api/references/vscode-api): active-editor/document events and focus-preserving webview controls. Relevant focus/event declarations also exist in the installed VS Code type definitions.

High confidence in feasibility of a bounded active-file follower, based on
these existing seams and the completed Linux ARM64 host spike. The initial
source-only scoping ran no runtime checks; the linked feasibility record
supersedes that verification limit. Human UX, realistic performance, minimum
VS Code version compatibility, automatic Git event integration, and historical
symbol providers remain unverified. No application source changed.
