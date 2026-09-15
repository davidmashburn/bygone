# Editable worktree Git comparisons

## Status

Ready to implement as a focused standalone Explore correction.

## Decision

Use the existing command:

```sh
bygone -C /path/to/repository --git-diff HEAD WORKTREE
```

Do not add another option. `WORKTREE` already names the intended source; it
should mean the live checked-out filesystem and be writable wherever it appears
in a Git comparison. Commits, tags, branches, and `INDEX` remain read-only
snapshots.

This also gives N-panel comparisons coherent behavior. In `HEAD~1 HEAD
WORKTREE`, for example, only the `WORKTREE` panel is editable.

## Goal and current gap

Let a reader compare committed or staged Git states with the current worktree,
edit that worktree in place, and save to the real repository path.

Today `openGitRefs` materializes every source into a temporary directory.
`WORKTREE` is therefore a detached copy. Mutability is also derived from
comparison-wide state rather than each source: two-panel Git-ref drill-down can
make temporary snapshots look writable, while multi-panel drill-down makes
every panel read-only.

## Required behavior

- `bygone --git-diff HEAD WORKTREE` opens the existing directory-level Git
  comparison with read-only `HEAD` and writable `WORKTREE` files.
- Save, undo, dirty state, external-change handling, refresh, and close
  confirmation operate on the actual worktree file.
- Worktree additions are writable. A deleted worktree path can be edited and
  saved to recreate the file at its repository location.
- N-panel comparisons derive editability independently for every source.
- Labels distinguish `Working Tree · Writable file` from read-only snapshots.
- `WORKDIR` and `WORKINGTREE` remain equivalent aliases.
- Ordinary file/directory comparisons stay writable; branch review, history,
  tours, commits, and `INDEX` stay read-only.

## Proposed approach

### 1. Resolve sources into per-side descriptors

Use a small closed source shape in the standalone host:

- commit/index snapshot: temporary root, `editable: false`, host-owned cleanup;
- worktree: repository root, `editable: true`, no cleanup, Git path inventory.

Keep persisted session identity unchanged as `{ kind: 'git-refs', repoRoot,
refs }`. Reconstruct temporary roots and capabilities when opening or restoring
a session. Do not create a general provider abstraction for these two cases.

### 2. Read the live tree without exposing ignored files

Pointing directory comparison at the repository root without filtering would
include ignored output and other files excluded by current `WORKTREE` behavior.
Build its included-path set with the existing rule:

```sh
git ls-files -co -z --exclude-standard
```

Allow directory comparison to accept an optional included-path set per side.
Derive parent directories from the set, but read contents from the real
worktree root. Snapshot sides continue to use materialized trees. Ordinary
directory comparisons without inventories retain recursive filesystem
behavior.

Validate every relative path before resolving a read or write target beneath
the repository root.

### 3. Propagate and enforce capability per panel

Store the side descriptors on directory and return-to-directory session state.
Use them for two-way `editableSides` and multi-panel `editable` values.

Keep an intended path even when a file does not exist. Existence determines
initial content; the source descriptor determines whether saving may create
it. Enforce read-only state in the standalone host before accepting mutations
or writes, with renderer flags serving as UI feedback rather than the sole
guard.

### 4. Preserve refresh and lifecycle behavior

The existing `git-refs` fingerprint already observes refs, index state, and
worktree status. Refresh should rematerialize snapshots, rebuild the worktree
inventory, retain the live root, and restore the selected relative path when
possible. Reuse current watchers and dirty-session confirmation rather than
adding polling or a second conflict policy.

Update CLI help and Explore/product-surface docs to say that `WORKTREE` is live
and writable in trusted desktop comparison. The command and completion grammar
do not change.

## Expected implementation surface

- `standalone/main.js`: resolve live worktree descriptors, propagate
  capabilities, enforce writes, and restore/refresh them.
- `src/directoryDiff.ts`: optional per-side included-path inventories.
- `test/runTests.js`: inventory, mutability, saving, refresh, and regressions.
- `cli/commandSpec.js`, `docs/explore.md`, and `docs/product-surface.md`: corrected
  source and mutability contract.

No persisted session-format or renderer-message change is expected: `git-refs`
already persists the required identity, and renderer messages already carry
two-way and per-panel editability.

## Scope and non-goals

Included:

- live `WORKTREE` sources in two-way and N-way `--git-diff`;
- per-source read/write capability and host-side enforcement;
- tracked plus unignored-untracked Git inventory; and
- worktree save, creation, refresh, dirty, and external-change behavior.

Not included:

- a new command or mutability flag;
- editing/staging `INDEX`, committing, or other source-control actions;
- writable branch review, history, tours, or browser-presented Git content;
- mixing arbitrary filesystem paths and Git refs; or
- general directory/editor lifecycle redesign.

## Validation

- Resolve a commit and `INDEX` to read-only temporary descriptors and
  `WORKTREE` to a writable repository-root descriptor.
- Compare `HEAD WORKTREE`; only the right pane is editable, saving changes the
  repository file, and the left snapshot is unchanged.
- Compare `HEAD~1 HEAD WORKTREE`; only the worktree panel is editable.
- Cover modified, added, deleted/recreated, ignored, and untracked files;
  exclude `.git` and ignored files.
- Verify external edits and refresh update the live side while preserving file
  navigation when possible.
- Restore a session without persisting temporary paths or capabilities.
- Regress ordinary directories as writable and every non-worktree Git source
  as read-only.
- Run `npm test`, `npm run lint`, and applicable standalone smoke tests.

## Acceptance criteria

- The exact command below edits real worktree files and only those panels:

  ```sh
  bygone -C /path/to/repository --git-diff HEAD WORKTREE
  ```

- Commit, branch, tag, and `INDEX` panels cannot be edited or saved.
- Worktree inventory matches Git's tracked plus unignored-untracked files.
- Saving, missing-file creation, refresh, external changes, and dirty-close
  handling retain normal writable-file behavior.
- Existing non-Git comparisons and read-only Git workflows do not regress.
