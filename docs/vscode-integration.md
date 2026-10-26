# VS Code SCM, symbols and document editing

The contextual Bygone panel uses VS Code's built-in Git API for repository
identity and change notifications. Source Control actions choose HEAD → index
or index → working document. Ordinary source following chooses HEAD → working
document. Symbol navigation changes the focus within that comparison, never
its revisions. Native SCM diff following is opt-in.

## Snapshot and edit contract

`followController.ts` owns the comparison and captured endpoints. HEAD and index
reads are checked again before publication; working content comes from the open
`TextDocument`, including unsaved edits. Each policy reads only its endpoints.
Staged comparisons therefore remain usable even if unrelated working bytes are
binary or oversized. Git renames retain separate source and destination paths.

The installed document-symbol provider identifies the enclosing declaration.
`liveSymbols.ts` runs Strand's existing inventory and correspondence matcher in
a cancelable worker. Whole-snapshot and symbol-substring digests are checked
before accepting ranges. Dirty-to-staged navigation needs an accepted mapping;
matching names or offsets are insufficient. Committed correspondence artifacts
and their validation contract are unchanged.

Native insertions exactly at either edge of a focused symbol return to file
context: the inserted text may belong to that declaration or its neighbor.
Boundary edits made inside Bygone retain the known slice binding. Edits strictly
inside a slice and shifts caused by edits before it continue to track normally.

Working full-file views and symbol slices are projections of the same document.
`followSync.js` allows one edit in flight and keeps subsequent typing until an
acknowledgment. `followEdits.ts` computes a granular replacement, preserving
unrelated text and UTF-16/CRLF boundaries. Before submission, the controller
checks the projection identity, document version, range and content. An older
token from an unchanged refresh is accepted only when all those checks still
match the current projection; a changed version is always rejected. There is no
asynchronous gap between that check and `workspace.applyEdit`.

VS Code's extension host attaches the open document's version to bulk text edits;
the main thread rejects a changed version before applying them. See the
[1.74 extension-host bulk edit implementation](https://github.com/microsoft/vscode/blob/1.74.0/src/vs/workbench/api/common/extHostBulkEdits.ts)
and [main-thread validation](https://github.com/microsoft/vscode/blob/1.74.0/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts).
The integration suite submits competing native and Bygone edits without waiting
between them and verifies rejection rather than an overwritten native edit.

Rejected drafts open in untitled recovery documents. Pending text is also kept
in workspace state for restoration. Draft clearing is guarded against newer
drafts. Save, undo and redo operate on the authoritative VS Code document; typing
does not save or stage. Other comparison panels observe the document change.
The existing manual two-way bridge also checks its base text and document version.

Save, undo and redo retain the document binding from when they were requested.
Commands queued behind an edit execute in order, including repeated undo requests.
If the comparison changes before a document command executes, Bygone rejects it
with a notice rather than applying it to the new document. Recovery deduplicates
a draft only against an entire current, version-validated projection; a matching
prefix or an obsolete snapshot is insufficient.

Pin freezes the target, historical snapshots and symbol focus. A pinned working
projection remains editable. Repository changes produce a notice until Resume;
unpinned comparisons keep their policy when a file leaves its SCM group.
Live staged and working comparisons reconcile Git-reported rename paths while
preserving their comparison policy. A captured staged pin remains
visible even if the live index enters a conflict; Resume checks the current
index again. Working-change actions also appear in Git's separate untracked group.
If the Git API repository disappears, live SCM comparisons become unavailable
until it returns. Captured staged pins remain read-only and explicitly report
that Git integration is unavailable; Resume requires the repository again.

## Supported scope and budgets

- Trusted local text files; maximum 128 KiB and 5,000 lines per endpoint.
- JavaScript/TypeScript symbol analysis, including JSX/TSX, for the selected file
  pair or Git-reported rename. No repository-wide cross-file symbol matching.
- HEAD/index/absent endpoints are read-only. Conflicts, binary/invalid text and
  unsupported editor inputs have explicit unavailable states.
- The matcher allows 300 ms, 20,000 candidate comparisons and 2,000 result records.
  A 2.5-second worker deadline also bounds inventory/parsing and startup. Cancellation
  terminates stale workers. File rendering does not wait for optional analysis.
- Missing, ambiguous or budget-limited correspondence retains file context or a
  known one-sided slice; it never supplies an inferred counterpart. Invalid syntax
  during typing retains the guarded editable range until it can be analyzed again.

## Reproducing verification

Run the normal checks from a clean dependency install:

```sh
npm ci
npm test
npm run lint
npm run bundle:check
npm run package:vsix
```

The Extension Host runner makes disposable synthetic repositories and a disposable
extension profile. It never stages, commits or checks out the developer's repository.
On Linux with Xvfb and an installed VS Code binary:

```sh
BYGONE_VSCODE_EXECUTABLE=/path/to/code xvfb-run -a node scripts/test-following.mjs
BYGONE_SCM_TEST=1 BYGONE_VSCODE_EXECUTABLE=/path/to/code xvfb-run -a node scripts/test-following.mjs
```

Set `BYGONE_VSCODE_VERSION` instead to let the runner download a version. Compile
first (`npm test` includes compilation). The SCM suite injects a renderer driver
only into the disposable test bundle, so it exercises actual Monaco edits and
messages without adding production test commands.

## Verification record: 2026-10-24

Implementation branch: `feat/vscode-scm-symbol-integration`, based on
`ec318cfbd9d9cddef2fcac150723958c0f7987c2`. These checks ran against the feature
implementation before its initial commit, not a published release.

| Check | Result |
| --- | --- |
| Regression suite | 433 Node tests plus the existing diff-engine runner passed |
| TypeScript, ESLint, renderer size budgets | Passed |
| VSIX contents and packaging | Passed; 14 archive entries, 2.65 MB compressed, including the 3.39 MiB Strand worker |
| Original following suite | 16 cases passed on VS Code 1.74.0 and 1.143.1, Linux ARM64 in a fresh Lima guest checkout |
| SCM/symbol/editing suite | 19 cases passed on both versions; staged/dirty separation, full-file and slice edits, save/shared undo/redo, range shifts, temporary syntax errors, concurrent rejection/recovery, composition across unchanged refreshes, rapid typing, multiple panels, exact snapshot reveal, native Git lifecycle and disabled-Git fallback |
| Snapshot fixtures | Added/deleted/renamed files, unborn HEAD, linked worktrees, multiple repositories, conflict stages, encoding/binary/size rejection |
| Symbol adapter | Renames, duplicate method names, unmatched additions, digest/range validation and worker cancellation |

Cold worker measurements in the same Linux ARM64 guest (three runs per input,
adding an unsaved prefix; no warm worker reuse):

| Input | Bytes | Symbols / accepted pairs | Elapsed |
| --- | ---: | ---: | ---: |
| `followEdits.ts` | 2,272 | 6 / 6 | 109–153 ms |
| `gitIntegration.ts` | 4,403 | 22 / 22 | 111–171 ms |
| `followController.ts` | 35,789 | 70 / 70 | 222–238 ms |
| 50 repetitive generated functions | 3,380 | 50 / 0 (record budget) | 122–130 ms |
| 500 repetitive generated functions | 34,781 | 500 / 0 (candidate budget) | 186–202 ms |

These are bounded fixture observations, not a general latency guarantee.
The repetitive cases deliberately demonstrate safe budget fallbacks.

Verification limits: IME coverage dispatches composition events in real Monaco;
it does not drive an operating-system input method. Symbol navigation exercises
the installed TypeScript provider and command-generated cursor selections, not
physical clicks in Outline/Go to Symbol. Restoration exercises the serializer
and persisted-draft constructor path, not a whole application restart. Remote and
untrusted workspace guards were inspected; a remote host and restricted-mode
window were not launched. macOS/Windows Extension Hosts, marketplace installation,
release CI and publication were not exercised.

## Review-fix verification: 2026-10-26

The fixes applied over `cfd5e335d75f2be324c0865abe4c2f5bdece06f5` passed
435 Node tests plus the existing diff-engine runner, TypeScript compilation,
ESLint, renderer size budgets and VSIX packaging. In a fresh Linux ARM64 Lima
checkout, all 25 SCM cases and all 16 original following cases passed on each
of VS Code 1.74.0 and 1.143.1. Host and guest source/test SHA-256 hashes matched.

Six added Extension Host cases cover complete rejected deletion/reversion recovery,
deferred Save/Undo/Redo across a comparison switch, repeated Undo followed by
Save and Pin, a live staged rename, conflict-after-staged-pin, and separate
untracked resources. The untracked case checks the contributed menu conditions
and executes the command with a resource argument; it does not physically click
the SCM menu. The earlier platform, IME, restart, remote/restricted-host and
release-verification limits still apply.

## Rebase and follow-up fixes: 2026-10-26

Rebased onto main `728f41e6`, preserving both the requirements and VS Code
build/test entries. The rebased changes passed 464 Node tests plus the existing
diff-engine runner. Final source passed TypeScript, ESLint, renderer size budgets
and VSIX packaging. A fresh Linux ARM64 Lima checkout passed all 29 SCM cases
and all 16 following cases on each of VS Code 1.74.0 and 1.143.1.

New regressions cover native insertions at both symbol boundaries, index refresh
for two-dot filenames, live working comparisons through successive staged
renames, loss/recovery of the Git API in an already-open comparison, and the
explicit read-only snapshot behavior of a staged pin while Git is unavailable.
The platform and interaction limits above still apply; hosted CI was not run.

## Pinned evidence handoff

[Evidence Review](evidence-review.md) uses this same editing bridge for full-file
and exact symbol projections. Its left endpoint is an immutable cited snapshot,
and its Return action restores the originating review. It does not stage files
or alter saved evidence while editing.
