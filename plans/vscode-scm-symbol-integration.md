# VS Code Source Control and symbol integration

## Status and outcome

Merged and pushed to `main` on 2026-10-26 at
[`c7219ed0`](https://github.com/davidmashburn/bygone/commit/c7219ed06351626b8a65627fbb0427b57c576bbf),
after rebasing onto the requirements and dependency work and incorporating
review fixes. The original implementation and validation record below is
historical. This is an integration-complete claim, not a marketplace release
or complete manual/platform verification claim.

The final integration session recorded 484 Node tests plus the legacy runner,
typecheck, lint, bundle-size and VSIX packaging checks passing. It reused the
unchanged feature source's 29 SCM and 16 following Extension Host cases on
each of VS Code 1.74.0 and 1.143.1 in a fresh Lima Linux ARM64 checkout.
`dev:sync` completed from main. This planning reconciliation inspected the
merged source and reused those validation results; no tests were rerun here.
The manual/OS limits below remain. See the
[workflow reconciliation](workflow-integration-reconciliation.md) for the
next integration opportunities, rather than reopening this implementation scope.

Original proposal baseline: inspected local `main` at
`ec318cfbd9d9cddef2fcac150723958c0f7987c2`; the implementation checkout was clean.
This consolidates the Git and symbol follow-ups in
[following mode](vscode-following-mode.md), within the existing
[companion surface](vscode-companion-surface.md) boundary.

VS Code chooses the repository, comparison and source location. Bygone shows
the corresponding file or symbol change in one reusable editor panel.
SCM selects **what versions to compare**; Outline, Go to Symbol and cursor
navigation select **what part of that comparison to inspect**.

The user should be able to open a staged file in Bygone, select a method through
VS Code, inspect that method's staged change, stage or unstage using native
controls, and see the comparison update without losing their place.
When the comparison includes a working document, the user can edit it in either
the regular VS Code editor or Bygone, including a focused symbol slice. Both
surfaces reflect the same unsaved document.

## Original baseline capabilities and gaps

- Following mode already handles active files, dirty buffers, Pin, Resume and
  refresh. `src/followController.ts` currently rejects SCM diff tabs and does
  not subscribe to editor-selection events.
- `package.json` contributes Explorer/editor actions but no SCM resource actions.
- Bygone already has symbol inventories, accepted correspondences, ambiguity
  diagnostics, symbol slices and full-file context. See the implementation's
  `docs/correspondence.md`, `src/changeCorrespondence.ts` and
  `web/correspondenceTree.js`. These features must be reused.
- The documented analysis/import path is commit-based. Its range contract uses
  base/head commit IDs. Dirty-buffer and index evidence needs an explicit
  snapshot adapter; inventing commit IDs or reusing stale artifacts is invalid.
- `packages/strand/index.js` exposes inventory/matching without Git or UI access.
  This is a promising reuse boundary, not proof of extension-host readiness.
- VS Code supplies current-document symbol providers; those ranges do not prove
  cross-revision symbol identity or apply automatically to the index.
- Existing manual comparisons in `src/diffViewProvider.ts` apply edits through
  `WorkspaceEdit` and observe document changes. The current bridge queues whole
  document replacement text; it is not proof of safe concurrent slice editing.
  Following mode currently marks both sides read-only. Reuse the document
  ownership pattern, with explicit version/range protection for the new paths.

## One interaction contract

| Entry point | Comparison | Focus |
| --- | --- | --- |
| SCM Changes: Open in Bygone | Index to working document | Selected file |
| SCM Staged Changes: Open in Bygone | HEAD to index | Selected file |
| Follow Active Editor | HEAD to working document | Active file |
| Follow an ordinary Git SCM diff | That diff's supported endpoints | Active file/side |
| Outline, Go to Symbol, cursor | Preserve selected comparison | Enclosing symbol |
| Bygone: Reveal Source | Preserve selected comparison | Exact source endpoint |

“Working document” includes unsaved editor text and is visibly labeled when
dirty. Staged comparison never includes those edits. New/deleted files use
explicit absent endpoints; renames retain both paths. Conflicts, binary files
and unsupported diff inputs show an explicit fallback, not an ordinary
two-way comparison with misleading labels.

Opening a comparison is explicit. Following subsequent SCM diff navigation is
opt-in through the existing follow session; do not promise interception of the
SCM tree's default click or a global replacement for VS Code's diff editor.
Use one contextual panel, separate from existing manual comparison tabs.

Source navigation within the selected file preserves its staged/unstaged mode.
In following mode, navigating to a different ordinary source file uses the
explicit active-editor policy (initially HEAD to working document). Navigating
to a supported SCM diff selects its exact comparison instead. Merely focusing
Bygone does not change context. Labels always show the active policy/endpoints.

Default to file view. An optional **Follow Symbol** setting makes Outline/Go to
Symbol/cursor navigation focus the enclosing declaration using existing symbol
presentation. An explicit **Compare Symbol in Bygone** command offers the same
operation without continuous cursor following. Keep **Show File Context** and
**Reveal Source** available. Navigation preserves keyboard focus and suppresses
feedback loops; scrolling alone does not switch symbols.

Pin keeps the selected target, baseline snapshot and symbol focus. For buffer
comparisons, edits still update the working endpoint, matching the existing Pin
contract. A pinned staged comparison holds both captured endpoints. Indicate
when repository state has advanced; Resume resolves current endpoints. Live
unpinned sessions refresh after Git changes without silently switching from
staged to unstaged when a file leaves a group; show the now-empty comparison.

## Comparison and symbol boundaries

Maintain one comparison context containing repository/worktree identity,
comparison policy, source paths, endpoint kinds, immutable snapshot digests,
document versions where applicable, and a cancellation generation. Symbol
selection is separate from that context: it must not choose different revisions.

Use the built-in Git extension for repository discovery and state notifications.
Resolve content through supported document/Git access and capture consistent
snapshots; discard/retry reads when the index or document changes during capture.
The displayed text and symbol evidence must refer to the same snapshots.
Coalesce events and cancel stale analysis. Render file changes before optional
symbol analysis completes. Missing Git integration must leave ordinary explicit
file comparisons usable, with SCM functionality clearly unavailable.

Use VS Code's document-symbol provider to identify the selection's containing
declaration. Use Bygone's correspondence engine to establish its counterpart.
Adapt the existing symbol viewer and matching code to validated in-memory
snapshots, keeping committed artifact validation intact. Never pair by name
alone. Existing matched/unmatched/ambiguous semantics remain authoritative.

A working-buffer selection is not an index selection. If the buffer differs
from a staged endpoint, map it through validated snapshot correspondence or
report that symbol focus is unavailable and retain the staged file diff. Never
silently show unstaged content, reuse offsets, or infer a match from a name.
Reverse navigation opens the exact read-only revision when a historical symbol
has no verified current-source destination.

Initially analyze the selected file pair, including a Git-reported rename pair.
State that scope: arbitrary cross-file moves require a bounded repository-wide
snapshot set and are a later extension. Unsupported providers/languages and
ambiguous matches retain file view or a known one-sided slice, with a reason.
Use installed language providers for navigation without adding a second outline.

## Synchronized editing contract

The VS Code `TextDocument` is authoritative. Bygone's full-file view and symbol
slice are editable projections of that document, not independently saved copies.
Editing is a core requirement for working-document endpoints in both following
and SCM comparisons, including when pinned. HEAD, index, historical snapshots
and absent endpoints remain read-only. A staged review can offer an explicit
switch to the working comparison to edit; typing must never mutate the index.

Edits made in either surface update the other without requiring Save. Save from
Bygone saves the underlying document through VS Code; native Auto Save and dirty
state remain authoritative. Route undo/redo to the document's shared edit history
with tested transaction grouping, rather than allowing Monaco's local history
to diverge. Ordinary typing neither auto-saves nor stages changes.

For symbol slices, translate local edits into exact document ranges using the
snapshot/version that produced the slice. Apply granular document edits, never
replace the entire file with the slice. Validate document identity, comparison
generation, version and range before accepting an edit. Serialize bridge edits
and acknowledgments; prove stale-write protection against native editor changes.
If a pending edit cannot be safely mapped, preserve the attempted text for
recovery, refresh the projection and visibly report the conflict. Never silently
overwrite newer source or silently drop typed text.

Track range movement when edits occur before or within the selected declaration.
Keep typing stable while parsing is temporarily invalid: retain the versioned
editable range independently of correspondence, and recompute matching after
edits settle. If outside edits delete or invalidate the range, fall back to full
file context without applying later keystrokes to a different declaration.
Missing/ambiguous historical matches do not prevent editing a valid current
document range. Suppress feedback echoes without losing updates to other panels;
preserve selection, scroll and focus across acknowledgments and diff refreshes.

## Delivery sequence and gates

1. **Prove the combined path in the Lima Extension Host.** Use a synthetic
   partially staged TypeScript file with renamed/nested functions and unsaved
   edits. Prove SCM resource/group identification, Git event refresh, diff-tab
   endpoint resolution, Outline-driven source selection, and Strand analysis of
   index/buffer snapshots. Prove bidirectional full-file and symbol-slice edits,
   stale-edit handling, shared undo/redo and save. Measure analysis latency and packaged dependencies.
   Test supported minimum and current VS Code; identify API/version limitations
   before promising default-click integration or language coverage.
2. **Ship the common comparison context and SCM entry points.** Add inline and
   context-menu Open in Bygone, staged/unstaged source resolution, one-panel
   reuse, native-operation refresh, and supported SCM diff following. Include
   full-file working-document editing, endpoint identity and lifecycle tests
   from the start.
3. **Complete symbol navigation on that same context.** Add explicit Compare
   Symbol, optional Follow Symbol, full-file return, and exact reverse navigation.
   Reuse the current symbol UI and implement snapshot-valid matching and editable
   working-document symbol slices on the shared document bridge. Start with
   proven JS/TS coverage; advertise additional languages only after runtime and
   packaging checks. This is part of the coherent integration, not a speculative
   separate outline project.
4. **Broaden only after the combined workflow passes.** Add bounded cross-file
   matching and more language adapters as justified. Branch-wide review remains
   a contextual Desktop hand-off. Hunk staging inside Bygone, conflict resolution,
   blame, a custom SCM provider and a new outline are outside this plan.

## Acceptance and verification

- The same partially staged file opens different, correct comparisons from the
  two SCM groups. Unsaved edits appear only at the working endpoint.
- Type, paste, delete and undo/redo from both editors, in full-file and symbol
  views: both show identical unsaved content, Save targets the real document,
  and staged/historical bytes remain untouched. Test IME composition and rapid
  alternating edits, including multiple Bygone panels for the same document.
- Editing a slice changes only its mapped range. Insert lines before it, rename
  it, create temporary syntax errors, format the document, and delete it in the
  source editor: range tracking remains correct or safely falls back. Inject
  stale edit messages and verify newer source and pending user text survive.
- Outline/Go to Symbol navigation focuses the requested declaration while keeping
  the selected comparison. Duplicate names, renamed functions, nested methods,
  unmatched and ambiguous symbols never cause an unsupported identity claim.
- Dirty-buffer navigation into a staged comparison either uses verified mapping
  or visibly falls back; source return selects the correct revision and range.
- Native stage/unstage/discard/commit/checkout refresh live context; pinned
  snapshots remain stable. These operations are exercised only in fixtures.
- Rapid file/repository/branch changes, edits during analysis, close/reload,
  split editors and reverse navigation cannot render stale content or steal focus.
- Added/deleted/renamed files, unborn HEAD, linked worktrees and multi-root
  repositories retain correct identity. Unsupported conflicts/binary/remote or
  untrusted contexts have explicit, tested behavior. Do not broaden existing
  local/trusted support implicitly.
- Verify cancellation, snapshot validation and mapping with focused tests; verify
  user interaction in real Extension Hosts. Run existing regression, typecheck,
  lint, packaging and size checks for implementation. Measure representative
  file/symbol responsiveness before setting and enforcing a performance budget.

## Evidence and uncertainty

The original planning pass inspected code and official API documentation; it did not run
tests or start the VM. Prior following-mode tests are historical evidence, not
verification of the proposed integration. High confidence in the product boundary
and reusable components; medium confidence in implementation effort pending the
combined prototype, especially staged-to-dirty symbol mapping, concurrent slice
editing, shared undo behavior and extension packaging. No delivery estimate is
established. The existing editing bridge was inspected, not exercised in this
planning update.

### Implementation reconciliation, 2026-10-25

Implementation revision: `cfd5e335d75f2be324c0865abe4c2f5bdece06f5` on
`feat/vscode-scm-symbol-integration`, based on
`ec318cfbd9d9cddef2fcac150723958c0f7987c2`. The committed
[implementation record](https://github.com/davidmashburn/bygone/blob/cfd5e335d75f2be324c0865abe4c2f5bdece06f5/docs/vscode-integration.md)
describes the implemented contract, commands, budgets, measured worker latency,
test coverage and verification limits. The branch is pushed; release is pending.
The validation below ran before the implementation commit. This planning update
checked the committed record and reused those results; it did not rerun tests.

- **Implemented:** native Git API discovery/events, staged/unstaged SCM actions,
  optional supported diff-tab following, rename/add/delete/absent endpoints,
  policy-preserving refresh and pinned snapshot semantics.
- **Implemented:** installed-provider symbol selection with snapshot-validated
  Strand correspondence; dirty-to-index mapping, JS/TS file-pair scope, exact
  snapshot reveal, file return and explicit unsupported/unmatched fallbacks.
- **Implemented:** full-file and slice working projections, granular versioned
  writes, serialized acknowledgments, shared save/undo/redo, range tracking,
  invalid-syntax continuity and draft recovery. Existing manual two-way panels
  also receive document changes and reject stale writes.
- **Verified in fresh Lima checkout:** both integration suites on VS Code 1.74.0
  and 1.143.1. Coverage includes native Git lifecycle operations in disposable
  fixtures, concurrent WorkspaceEdit rejection, staged/dirty isolation,
  multi-panel synchronization, unchanged refresh during composition, disabled
  Git fallback, close/recovery and delayed-work cancellation. Regression,
  TypeScript, lint, renderer size and VSIX checks passed.
- **Measured:** representative 6/22/70-symbol files matched in roughly 109–238 ms
  including cold worker startup. Repetitive stress fixtures hit bounded record
  or candidate limits without invented matches. The worker is packaged in the
  extension; no external language executable is required for JS/TS.
- **Not verified as physical UI/OS actions:** Outline/Go to Symbol clicks,
  operating-system IME, whole-application restart, remote/restricted-mode host
  launches, macOS/Windows hosts, marketplace installation or release CI.
  Automated tests cover the provider/selection, composition-event, serializer
  and persisted-draft paths; remote/trust guards were inspected.

Confidence is high in the tested Linux Extension Host paths and guarded snapshot
and editing behavior; cross-platform/manual interaction evidence could change
that assessment. Cross-file matching, additional language adapters, hunk staging
and conflict resolution remain outside this implementation. Next step is review
and the remaining manual release checks, not another feature slice.

API references:
- [SCM menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus)
- [Git extension API](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts)
- [Document symbol command](https://code.visualstudio.com/api/references/commands)
- [Editor selection events](https://code.visualstudio.com/api/references/vscode-api#window.onDidChangeTextEditorSelection)
