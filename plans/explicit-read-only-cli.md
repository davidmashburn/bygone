# Explicit read-only CLI launches

## Status

Implemented on `main` by `35c09c2`.

The CLI now accepts a global `--read-only` option and carries the capability
ceiling through desktop launch intents, initial comparisons, directory
drill-down, history, and refresh. Without the option, existing writable
defaults are unchanged.

## Decision

Add one global desktop-launch option:

```sh
bygone --read-only <arguments...>
```

The option forces every otherwise-writable source in the launched Explore
session to be read-only. It is a host-enforced capability limit, not an initial
state for the renderer's editing toggle. The user cannot turn editing back on
for that session from the toolbar.

Keep existing behavior when the option is absent. Do not add a short spelling,
an opposite `--writable` option, per-panel flags, or configuration persistence.

## Goal

Let scripts, aliases, review workflows, and cautious users open live files for
inspection without granting the resulting session permission to modify them.

Today the CLI makes these live sources writable by default:

- ordinary file comparisons opened positionally or through `--diff`;
- ordinary directory comparisons and their file drill-downs;
- the `WORKTREE` side of file history when that entry exists; and
- every `WORKTREE`, `WORKDIR`, or `WORKINGTREE` panel in `--git-diff`.

The renderer has a temporary read-only toggle for writable two-way panes, but
that control is not a launch contract and can be switched back to editing. It
also does not replace host-side authorization of write operations.

Verified against `main` at `4fc8995`: file and directory sources construct
editable panels, file history makes its `WORKTREE` right side editable, and
Git-ref comparison gives live worktree columns `editable: true`. The existing
session-source identity has no mutability override.

## Command contract

`--read-only` is accepted as a global option for desktop Explore launches and
may appear before or after the mode token:

```sh
bygone --read-only left.txt right.txt
bygone --diff --read-only left.txt right.txt
bygone --read-only dir-before dir-after
bygone --history file.txt --read-only
bygone -C repo --read-only --git-diff HEAD WORKTREE
```

The option applies uniformly to the resulting session:

| Launch source | Without the option | With `--read-only` |
| --- | --- | --- |
| Ordinary files | All file panels writable | All panels read-only |
| Ordinary directories | All drill-down file panels writable | All drill-down panels read-only |
| File history | Only the `WORKTREE` result writable | Every result read-only |
| Git revision comparison | Only worktree aliases writable | Every ref panel read-only |
| Commit, `INDEX`, branch review, or other snapshot-only Explore source | Already read-only | Remains read-only |

Blank comparisons may accept the global option for a uniform parser contract,
although a read-only untitled panel has little practical value. Developer smoke
modes and non-desktop `tour` authoring commands are not part of the public
contract.

The option is attached to the session created by that invocation. It survives
refresh, directory drill-down and return, and desktop window restoration. It
does not become a process-wide preference: explicitly opening a new comparison
from the File menu uses that new source's normal mutability rules.

## Required behavior

- Preserve each source's intrinsic capability, then apply the launch override:
  `effectiveEditable = intrinsicEditable && !readOnly`.
- Enforce the effective capability in the standalone host for content updates,
  save, Save All, Replace, copy-into-neighbor, missing-file creation, and any
  other path that can reach a filesystem write.
- Disable editing controls when the flag removed the last writable pane. The
  existing renderer toggle must not be able to elevate capability.
- Continue watching and refreshing live files. Read-only means no writes from
  Bygone, not a detached snapshot and not stale content.
- Preserve the override while adding or removing directories, navigating among
  files, changing history display options, refreshing, and restoring a saved
  window.
- Distinguish a live file made read-only by request from a historical snapshot.
  Use **Read-only file** for the former and retain **Read-only snapshot** for
  commits, `INDEX`, history snapshots, tours, and synthetic content.
- Keep the flag local to Bygone. Do not inspect or change operating-system file
  permissions, Git state, or repository configuration.

## Proposed approach

### 1. Parse one global launch modifier

Add `--read-only` to the shared command specification, help, and generated Zsh,
Bash, and Fish completions. Strip it from launch operands regardless of its
position and carry `readOnly: true` on the parsed desktop launch target.

Forwarding through the npm launcher and Electron single-instance handoff must
retain the option. Unknown or duplicated value-taking options must continue to
produce their current errors; repeated `--read-only` is harmless and resolves
to true.

### 2. Persist the session constraint with source identity

Store `readOnly: true` on refreshable session-source descriptors only when the
option was supplied. Omitting false preserves compatibility with existing
saved window state. Include the field in source equality so opening the same
paths with a different mutability request rebuilds the session instead of
refreshing one with the wrong capability.

Thread the constraint through source constructors and every place that rebuilds
them, especially history-option changes and directory column add/remove flows.
Blank sessions can retain the constraint directly on session state because
they are not refreshable.

### 3. Separate intrinsic source type from effective editability

Keep the existing source rules as the intrinsic capability:

- filesystem and live worktree sources can be writable;
- commits, `INDEX`, branch review, tours, and materialized snapshots cannot.

Apply the session constraint when constructing side, column, and multi-panel
state. Carry enough provenance to render **Read-only file** rather than falsely
describing a live filesystem path as a snapshot. Avoid inferring provenance
from `editable: false`, because that boolean now covers both cases.

Use the same derivation in initial open, refresh restoration, Git-ref
materialization, file-history rebuilding, and directory drill-down. Do not add
a general permission-provider abstraction for this boolean override.

### 4. Enforce the boundary in host and renderer

Renderer editability remains feedback and editor configuration. Host handlers
must independently reject edits and writes when the effective capability is
false, including messages received after navigation or refresh.

For a forced-read-only session:

- Monaco models are read-only;
- Save, Replace, and write-oriented copy actions are disabled;
- dirty state cannot be created through renderer messages;
- close does not prompt to save content that could not be edited; and
- external filesystem changes can still mark the source stale and be loaded by
  refresh or the existing external-change flow.

## Expected implementation surface

- `cli/commandSpec.js` and `cli/completions.js`: public option, help, and shell
  completion generation.
- `standalone/main.js`: launch parsing, capability derivation, propagation,
  labels, and host-side enforcement.
- `standalone/sessionSource.js` and window-state tests: persisted session
  constraint and equality behavior.
- Shared renderer message/state code only as needed to distinguish read-only
  live files from snapshots and disable elevation through editing controls.
- `test/runTests.js`: parsing, propagation, restore/refresh, write guards, and
  regression coverage.
- `docs/explore.md` and `docs/product-surface.md`: CLI examples and the updated
  provenance/mutability vocabulary.
- Generated completion files under `completions/`.

No Git comparison, diff model, tour schema, repository-search, or VS Code
extension change is expected.

## Scope and non-goals

Included:

- one `--read-only` flag for desktop Explore launches;
- all-or-nothing suppression of writable panels in that session;
- session refresh, navigation, and restoration fidelity; and
- accurate live-file versus snapshot labels.

Not included:

- changing which sources are writable by default;
- per-side or per-panel mutability selection;
- a persistent setting or environment variable;
- changing filesystem permissions or detecting them proactively;
- making snapshots writable, editing `INDEX`, staging, or committing;
- disabling comparison-composition controls such as adding or removing a
  directory; or
- extending the flag to `tour compile` output or other non-desktop commands.

## Validation

- Parse the flag before and after `--diff`, `--history`, and `--git-diff`, and
  alongside `-C`; verify repeated flags remain idempotent.
- Open two ordinary files and a multi-file comparison with the flag; verify all
  panels are read-only and the files remain byte-identical after attempted edit,
  save, replace, and copy-into-neighbor messages.
- Open two and three ordinary directories; drill into multiple entries, add and
  remove a directory column, return, and refresh; verify every live file remains
  read-only.
- Open file history whose newest entry is `WORKTREE`; verify that entry loses
  editability while commit and `INDEX` behavior remains unchanged.
- Compare `HEAD WORKTREE` and `HEAD~1 HEAD WORKDIR`; verify every panel is
  read-only with the flag and only worktree panels are writable without it.
- Verify forced-read-only live content is labeled **Read-only file**, while
  commit and `INDEX` panels remain **Read-only snapshot**.
- Modify a flagged source externally and verify stale detection and refresh
  still update the displayed content without granting write capability.
- Restore a flagged window and confirm the constraint remains; launch the same
  paths without the flag and confirm source equality does not reuse the flagged
  session.
- Regress current writable behavior for every example above when the flag is
  absent.
- Regenerate completions, then run `npm test`, `npm run lint`, and the applicable
  standalone smoke tests.

## Acceptance criteria

- `bygone --read-only left.txt right.txt` cannot modify either file through any
  Bygone editing or save path.
- `bygone -C repo --read-only --git-diff HEAD WORKTREE` keeps both the commit and
  live worktree panels read-only while still refreshing external worktree
  changes.
- The renderer cannot turn a CLI-forced read-only source writable.
- Refresh, drill-down, history-option changes, and desktop restoration do not
  lose the constraint.
- Live paths are not mislabeled as snapshots.
- Omitting `--read-only` preserves current CLI, desktop, and persistence
  behavior.
