# Refreshable sessions

## Status

Implemented on `main`.

## Goal

Let a user update the comparison currently open in Bygone without reconstructing
it manually or losing their place. Refresh should mean “re-resolve this
session's original sources and show their current state,” not “reload the
renderer.”

The first release should provide one explicit refresh action across standalone
session types, preserve useful navigation state, protect unsaved edits, and
make changed Git or filesystem inputs visible without interrupting an active
review. Automatic refresh should initially be limited to sources where the
meaning is unsurprising and the update cannot silently move the review target.

## Context

Bygone currently has several different update behaviors:

- Direct two-way and multi-panel file comparisons watch open files. When a
  source changes on disk, the app asks whether to reload that pane.
- Authored tours watch their source and hot-reload through the tour server.
- Git history, directory history, branch review, Git-ref comparison, and
  directory comparison materialize a snapshot when opened. New commits,
  changed refs, and changed directory contents are not reflected until the
  user opens the session again.
- Re-running a CLI command now routes into the running desktop app and replaces
  its central session, but that is an indirect refresh mechanism and does not
  intentionally preserve the user's location.
- The standalone View menu exposes Electron's generic renderer reload role.
  That reloads application chrome rather than recomputing session sources, so
  it is misleading as a user-facing refresh operation.

This fragmentation will become more visible as the desktop app behaves like a
long-lived review workspace. A branch review may stay open while commits are
amended, a directory comparison may outlive a build, and a history session may
need to incorporate a new working-tree or staged state.

## Product principles

1. **Refresh the source, not the page.** A refresh reruns source resolution and
   comparison for the current session descriptor.
2. **Preserve orientation.** Keep the selected file, active pane, relevant
   history entry, scroll/focus target, and tour location when those objects
   still exist.
3. **Never discard edits implicitly.** Reuse the existing save, discard, and
   cancel decision before any refresh that would replace editable content.
4. **Do not interrupt review silently.** Git-derived sessions should announce
   that fresher inputs exist and wait for an explicit refresh by default.
5. **Use one recognizable action.** A circular-arrow refresh button, a menu
   item, and a standard shortcut should invoke the same behavior. A star or
   flag would incorrectly imply favoriting, pinning, or persistent status.
6. **Keep source-specific behavior behind a common contract.** The renderer
   should not need to understand how a Git range, directory tree, or file set
   is rebuilt.

## User-facing behavior

### Primary action

Add **Refresh Session** in three places:

- a circular-arrow button in the main comparison toolbar, with a tooltip and
  accessible label;
- **View → Refresh Session** in the standalone menu; and
- `Cmd+R` on macOS or `Ctrl+R` on Windows and Linux.

The command is enabled when the current session has a refreshable source
descriptor and disabled for blank, sample, or purely synthetic sessions.
Replace Electron's generic `reload` menu role with this command. Keep renderer
reload available only through development tooling, such as DevTools, because
it is not a product operation.

While refresh is running, the toolbar button should show a busy state and
reject duplicate invocations. A successful refresh should normally be quiet.
If nothing changed, a short status message such as **Already up to date** is
sufficient when the action was explicit. Failures should leave the previous
session intact and report a useful source-specific error.

### Changes-available state

When Bygone detects that a snapshot source may be stale, do not immediately
replace the comparison. Change the refresh button to an emphasized
**Changes available** state and expose the same wording in its tooltip. The
signal should be noticeable but should not become another persistent badge or
review ledger.

The signal is advisory. Detection may be coarse—for example, a Git ref or
repository metadata changed—and refresh remains the authoritative operation.
If rebuilding produces the same effective comparison, clear the signal and
report that the session is current.

### State preservation

Before refreshing, capture a renderer-independent navigation snapshot. After
the replacement data is ready, restore state in this order:

1. selected or drilled-down relative file path;
2. history entry identity, using commit OIDs or named working states rather
   than the old array index;
3. active pane or panel, mapped by source identity rather than generated ID;
4. current change, preferably matched by stable line or hunk context;
5. editor selection, focus, and scroll position where the underlying file is
   still comparable.

If an object disappeared, fall back predictably: the nearest surviving
history entry, the first changed file, the first available pane, and then the
first change. Do not retain stale indexes that now point at unrelated content.

Directory drill-down should remain on the same relative path if it still
exists. If the file no longer exists in any source, return to the directory
view and briefly explain why.

### Unsaved changes

Explicit and automatic refresh must use the same edit-safety policy:

- If the session has no unsaved Bygone edits, refresh can proceed.
- If there are unsaved edits, prompt with **Save All**, **Discard**, and
  **Cancel** using the existing session-replacement language adapted for
  refresh.
- A background change detector must never open this prompt by itself. It only
  marks **Changes available**; the prompt appears after the user chooses to
  refresh.
- Automatic refresh is suspended while a session is dirty.

Saving can itself generate filesystem notifications. Refresh and watcher code
must suppress or coalesce self-authored events so the app does not immediately
ask to reload its own write.

## Behavior by session type

| Session type | Explicit refresh | Background detection | Default automatic behavior |
| --- | --- | --- | --- |
| Two-way file comparison | Reread both paths atomically | Existing file watchers | Auto-reload clean panes; prompt only when a pane is dirty |
| Multi-panel file comparison | Reread every path | Existing per-file watchers | Same as two-way files |
| Directory comparison | Rescan every root and recompute union/diffs | Watch roots with debounce or mark stale after coarse events | Mark changes available; do not replace drill-down automatically initially |
| File history | Re-read log and working/index states | Watch Git metadata and target working file | Mark changes available |
| Directory history | Re-read log and working/index directory states | Watch Git metadata and directory root | Mark changes available |
| Branch review | Re-resolve base, head, merge base, renames, and materialized trees | Watch relevant refs, `HEAD`, index, and worktree metadata as applicable | Mark changes available |
| Git-ref comparison | Re-resolve every symbolic ref and rematerialize non-live sources | Watch symbolic refs and live `INDEX`/`WORKTREE` sources | Mark changes available |
| Binary/image comparison | Reread bytes and metadata through its parent file or directory session | Inherit parent source detection | Inherit parent policy |
| Authored tour | Keep existing tour-source hot reload | Existing tour watcher | Preserve current behavior; do not route through central session refresh initially |
| Blank/sample/synthetic diff | No source refresh | None | Disabled |

Direct files are the one justified exception to explicit-by-default behavior:
their existing pane-level watcher already gives users immediate, local
feedback. The implementation may simplify the clean-pane case to reload
automatically, while retaining a prompt for a dirty pane. Directory and Git
sessions should begin conservatively because recomputation can reorder files,
move history, or change the review range.

## Proposed architecture

### 1. Introduce a session source descriptor

Store a serializable `source` descriptor alongside materialized session state.
It records enough intent to rebuild the session without depending on temporary
directories or renderer output. Representative variants are:

```text
blank
files(paths)
directories(paths, labels?)
fileHistory(path, includeStaged)
directoryHistory(path, includeStaged, skipUnchanged)
gitRefs(repoRoot, refs)
branchReview(repoRoot, headRef, baseRef?)
```

Paths should be canonicalized when the session opens. Git descriptors retain
the user's symbolic refs as well as the last resolved OIDs: symbolic refs are
needed to refresh intent, while resolved OIDs support change detection and
state restoration.

The descriptor should not contain ephemeral panel IDs, materialized temporary
roots, current text content, dirty buffers, or UI indexes. Those belong to the
current session instance or navigation snapshot.

Every open path—dialogs, drag-and-drop, CLI routing, URI handling, and internal
navigation—should construct or retain the appropriate descriptor. Derived
views such as directory drill-down must keep the parent descriptor rather than
replacing it with a temporary two-file descriptor.

### 2. Centralize session rebuilding

Add a main-process refresh coordinator with a shape equivalent to:

```text
refreshSession(reason: explicit | detected | automatic)
  -> capture navigation
  -> confirm dirty-state policy
  -> build replacement from source descriptor
  -> atomically swap session and temporary resources
  -> render replacement
  -> restore navigation
  -> clear stale state
```

Refactor existing `open*` functions only as far as necessary to separate
source resolution/materialization from confirmation and final session
installation. Initial opening and refreshing should call the same builders so
they cannot drift into different comparison semantics.

Build the replacement before mutating the live session. Git materialization
should use new temporary roots; only after a successful renderer handoff should
the old roots be scheduled for cleanup. If any step fails, retain the existing
session and its resources.

Assign each refresh an incrementing generation or cancellation token. A slow
directory computation from an earlier generation must never overwrite a newer
explicit refresh or a newly opened session.

### 3. Separate detection from recomputation

Create a source-monitor layer that emits only `possibly-stale` events. It may
use `fs.watch`, targeted Git ref files, or a modest polling fallback, but it
must debounce bursts and tolerate missing, replaced, or renamed files.

The monitor owns no renderer state and performs no full diff. It compares
cheap source fingerprints where possible:

- file size, modification time, and optionally content hash for open files;
- directory event generation plus a lightweight tree fingerprint;
- resolved OIDs for symbolic Git refs;
- index metadata and working-tree status fingerprints for live Git sources;
- tour source modification state through the existing tour watcher.

False positives are acceptable; missed permanent changes are not. Explicit
refresh always bypasses the fingerprint and rebuilds from source.

Reconfigure monitors only after a new session is installed, and dispose them
when its window closes or another session replaces it.

### 4. Add a narrow host/renderer protocol

Extend the existing main-to-renderer and renderer-to-main message paths with
small semantic messages rather than exposing filesystem operations:

- renderer requests `refreshSession`;
- main reports `refreshState` as idle, stale, refreshing, or failed;
- main requests navigation-state capture before swap;
- renderer returns or applies a normalized navigation snapshot;
- main posts the new comparison through existing show messages.

The main process remains authoritative for whether a source can refresh,
whether edits block it, and which generation is current. The renderer owns
visual state and the toolbar presentation.

### 5. Keep tour refresh separate initially

Tour hot reload already rebuilds authored narrative and evidence through a
dedicated server and window. Preserve that behavior. The central window's
Refresh Session command should not change tour scenes, and tour navigation
must remain independent from file navigation.

A later unification may let the tour window expose the same refresh icon and
state vocabulary, but it should delegate to the tour server rather than force
tours into the central materialized-session model.

## Automatic-refresh policy

Do not begin with one global on/off preference. Different source types have
different disruption costs, and a universal toggle would obscure those
semantics.

Initial policy:

- Automatically update clean direct-file panes after a debounced disk change.
- Preserve the current dirty-pane prompt.
- For directories and Git-derived sessions, detect changes and emphasize the
  explicit refresh action.
- Suppress automatic work while the app is unfocused if it would require a
  full directory or Git rebuild; detection may continue cheaply.
- Refresh explicitly when the user clicks the button, chooses the menu item,
  presses the shortcut, or re-runs the same CLI request.

After observing real use, consider a per-session menu option:
**Refresh Automatically for This Session**. If introduced, it should be an
ordinary checked menu option, default off for Git/directory sessions, and not
a toolbar flag. Persisting it globally should require separate evidence.

## CLI behavior

Do not add `--refresh` in the first release. Invoking the same Bygone command
already sends a fresh request to the running app, and an explicit flag would
mostly duplicate that behavior.

Improve repeated-command routing instead:

- If the incoming source descriptor is equivalent to the active one, treat it
  as an explicit refresh and preserve navigation.
- If it differs, retain the current session-replacement behavior and dirty
  confirmation.

Defer `--watch` until terminal-driven workflows demonstrate a need to control
automatic refresh independently from the app. If added later, it should map to
the same per-session policy rather than start a second watcher implementation.

## Scope and non-goals

Included:

- A reusable source descriptor for central-window sessions.
- Explicit toolbar, menu, and keyboard refresh.
- Preservation of meaningful navigation state.
- Dirty-state protection and atomic replacement.
- Stale-source detection for directory and Git-derived sessions.
- Existing file watching aligned with the shared refresh coordinator.
- Equivalent repeated CLI requests treated as refreshes.

Not included initially:

- Periodic network fetch, `git fetch`, GitHub PR polling, or any mutation of
  repositories.
- Automatically changing a branch-review range while the user is reading it.
- A persistent global auto-refresh preference.
- A favorites, pinning, flagging, or reviewed-state system.
- Restoring sessions after the app quits.
- Unifying authored-tour hot reload with central-window refresh internals.
- Guaranteeing exact scroll restoration after arbitrarily large structural
  changes.

## Risks and decisions

- **Temporary Git sources:** Current branch and ref comparisons materialize
  trees into temporary directories. Refresh must build new roots and clean old
  roots only after a successful swap to avoid blank or half-updated sessions.
- **Ref movement:** Preserve symbolic ref intent. Pinning only the original OID
  would make refresh appear to succeed while showing the old commit.
- **Merge-base changes:** A refreshed branch review may legitimately gain a
  new merge base. Make the updated range visible in panel labels and do not try
  to preserve a history index across unrelated OIDs.
- **Watcher reliability:** `fs.watch` is advisory and platform-dependent.
  Explicit refresh remains available, and coarse events should trigger a
  stale signal rather than attempting to infer exact changes.
- **Refresh storms:** Debounce watcher bursts, coalesce events by session
  generation, and prevent a refresh from scheduling itself through temporary
  tree creation or app-authored saves.
- **Async race conditions:** Every build and diff result must be generation-
  checked before installation. Opening a different session always wins over
  an older refresh.
- **Navigation identity:** Generated panel IDs and array indexes are not stable
  enough. Restore using canonical paths, source keys, commit OIDs, and hunk
  context.
- **Shortcut expectations:** `Cmd/Ctrl+R` conventionally means refresh, but in
  Electron it currently reloads the page. Remove the generic role so only the
  semantic command owns the shortcut.
- **Large repositories:** Background detection must stay cheap. Full tree
  materialization and diff computation happen only after explicit refresh by
  default.

## Validation

### Unit and integration coverage

- Round-trip and equality tests for every source descriptor variant.
- Verify every supported open path attaches the correct descriptor, including
  CLI second-instance routing and directory drill-down.
- Test source equivalence: canonical path spelling, optional default base,
  ordered panels, and relevant preference changes.
- Test navigation restoration when files, commits, panels, and hunks survive,
  move, or disappear.
- Test dirty refresh choices: save, discard, cancel, save failure, and watcher
  events while dirty.
- Test atomic failure: source resolution, Git materialization, diff compute,
  and renderer handoff failures leave the original session usable.
- Test generation ordering so stale asynchronous results cannot overwrite a
  new refresh or session.
- Test watcher debounce, self-write suppression, deletion/recreation, and
  cleanup on replacement or window close.
- Test branch refresh after head movement, base movement, merge-base movement,
  rename changes, and no effective diff.
- Test history refresh with new commits and changing `WORKTREE`/`INDEX` states.
- Test menu label, shortcut, enablement, and renderer button state without
  invoking Electron's generic reload.
- Test a repeated equivalent CLI request as refresh and a different request as
  replacement.

### Manual matrix

1. Refresh direct two-file and multi-panel sessions after clean and dirty
   external edits.
2. Add, remove, rename, and modify files in a directory comparison while both
   the directory view and a drill-down are active.
3. Amend and add commits during a branch review; verify **Changes available**,
   new range labels, rename pairing, and selected-file preservation.
4. Move tags and branches in a multi-ref comparison, including `INDEX` and
   `WORKTREE` sources.
5. Add working-tree, staged, and committed history states and verify identity-
   based restoration rather than stale index restoration.
6. Trigger several rapid filesystem/Git events and confirm one stable refresh
   state with no prompt storm.
7. Start a refresh, then open another session; confirm the new session wins.
8. Force a missing path, invalid ref, and materialization failure; confirm the
   existing comparison remains intact.
9. Re-run the active CLI command and verify it refreshes in place; run a
   different command and verify normal replacement confirmation.
10. Confirm tour hot reload remains unchanged and the central refresh shortcut
    does not move tour chapters or files.

## Delivery sequence

### Phase 1: Explicit refresh foundation

1. Define source descriptors and attach them to supported sessions.
2. Extract source builders from session installation where needed.
3. Add the generation-safe refresh coordinator and dirty confirmation.
4. Add the toolbar button, View menu command, shortcut, and host messages.
5. Preserve selected path, history identity, and active source across refresh.
6. Treat equivalent repeated CLI requests as explicit refreshes.

This phase is independently useful even without background detection.

### Phase 2: Stale-source detection

1. Add the monitor lifecycle and debounced stale state.
2. Cover symbolic Git refs, index/worktree state, directory roots, and missing
   or recreated files.
3. Surface **Changes available** without interrupting the current view.
4. Add watcher cleanup, self-event suppression, and performance limits.

### Phase 3: Conservative automatic updates

1. Route existing direct-file watchers through the coordinator.
2. Automatically reload clean file panes while retaining dirty prompts.
3. Measure whether users want opt-in automatic directory or Git refresh.
4. Add a per-session checked menu option only if that demand is clear.

## Acceptance criteria

- A branch, history, Git-ref, file, or directory session can be explicitly
  refreshed without reopening dialogs or reconstructing its CLI command.
- Refresh recomputes from the original live source intent, including moved Git
  refs, rather than rereading stale temporary files.
- The selected file and revision remain stable whenever their identities still
  exist.
- Unsaved Bygone edits are never discarded without an explicit choice.
- A failed or superseded refresh cannot replace the current usable session.
- Directory and Git source changes can produce a non-disruptive
  **Changes available** signal.
- Direct clean-file updates remain fast and unsurprising.
- `Cmd/Ctrl+R`, the menu item, and the toolbar button all invoke the same
  semantic refresh operation.
- Tours retain their existing hot-reload and navigation behavior.

## Follow-up questions

These do not block the initial explicit-refresh implementation:

- Should the stale indicator identify which source changed, or is a single
  session-level signal clearer?
- Should automatic refresh be offered for a branch review when the app is not
  focused and restored only when the user returns?
- How much hunk-context matching is worthwhile beyond selected-file and
  commit-identity restoration?
- Should a refreshed session expose a brief before/after summary such as
  “2 files added, 1 removed,” or would that compete with the diff itself?
- Once session persistence exists, should reopening the app refresh restored
  sessions immediately or first show their saved snapshot?
