# Consistent source controls in Compare and History

## Status

Selected for implementation planning. The interaction direction is approved;
implementation and runtime validation remain outstanding.

## Goal

Make `+` and `×` useful throughout desktop Compare while keeping History a
contiguous sequence of adjacent revisions. The shared meaning is **add a
comparison source here** and **remove this source from the comparison**.
History supplies the adjacent revision automatically. Compare lets the reader
choose a source appropriate to the current comparison.

Closing a source never deletes a file, directory, or Git object.

## Context and source assessment

The assessment used the development checkout based on `main` commit
`bd10789abda2471b9d94d8c944d3f75f923eee42`, including local changes. The central
workspace History inconsistency was also confirmed in that committed baseline.
This is source inspection, not evidence that the proposed interactions have
been implemented or tested.

- Ordinary multi-file comparisons insert an editable blank panel through
  `addMultiPanel` in `standalone/main.js`.
- Filesystem directory comparisons already open a directory picker, but add
  only at outer edges and retain a minimum of two columns.
- Workspace revision Compare disables panel mutation. Directory file
  drill-down also disables it in the ordinary multi-panel host.
- Workspace History enables removal on every panel and filters the requested
  panel out of its revision list. Legacy file History and directory History
  restrict removal to the edges. Removing an interior revision creates a gap
  in a view whose sequence should remain contiguous.
- Two-way text, multi-panel text, and directory views have different control
  surfaces and session paths. Adding buttons alone will not establish parity.

Relevant source entry points:

- [Desktop sessions, add/remove actions, and directory drill-down](https://github.com/davidmashburn/bygone/blob/bd10789abda2471b9d94d8c944d3f75f923eee42/standalone/main.js)
- [Workspace mode state and revision mutations](https://github.com/davidmashburn/bygone/blob/bd10789abda2471b9d94d8c944d3f75f923eee42/standalone/workspaceHost.js)
- [Revision view policy](https://github.com/davidmashburn/bygone/blob/bd10789abda2471b9d94d8c944d3f75f923eee42/src/revisionView.ts)
- [Shared text renderer](https://github.com/davidmashburn/bygone/blob/bd10789abda2471b9d94d8c944d3f75f923eee42/media/script.js)
- [Directory renderer](https://github.com/davidmashburn/bygone/blob/bd10789abda2471b9d94d8c944d3f75f923eee42/media/dom.js)

Refresh this assessment against the implementation branch before editing code;
the development checkout contained unrelated work that this planning change
does not incorporate.

## Interaction contract

### History: extend and trim the sequence

History controls operate on the host's existing deterministic history axis.
Adjacency means consecutive entries on that axis; this plan does not introduce
a new merge-parent or commit-graph traversal policy.

- Left-edge `+` reveals the next older adjacent revision; right-edge `+`
  reveals the next newer adjacent revision. Disable the action at a boundary.
- Interior panels cannot add or remove revisions. `×` trims only the first or
  last panel, and removal of the last remaining panel is disabled.
- Apply these rules to workspace History, legacy file History, directory
  History, their file drill-downs, and menu/keyboard equivalents.
- Enforce the policy in the host as well as the renderer. A stale or directly
  supplied interior-removal message must leave the sequence unchanged.
- File-change markers and skip-unchanged navigation do not make edge `+`
  skip intervening entries on the history axis.
- Keep existing supported index, worktree, and empty-tree boundary identities
  explicit. They must not become fabricated commits.

For example, History `[A, B, C]` permits trimming `A` or `C`, but never `B`.
Compare may deliberately show `[A, C]`. Switching modes restores the retained
mode state rather than carrying a gapped Compare sequence into History.

### Compare: choose before inserting

`+` opens a context-aware source chooser before creating a panel. Canceling,
invalid selection, or a failed read leaves the displayed comparison unchanged.
Do not create a placeholder blank and require the reader to replace it.

| Comparison context | Source choices | Scope retained |
| --- | --- | --- |
| Git revisions of a file | Commit search, branch/tag/ref, and supported staged or working-tree states | Repository and logical file |
| Git revisions of a directory/repository | The same revision choices | Repository and selected directory/path scope |
| Independent local files or scratch text | `File…` or explicit `Blank text` | Existing ordered file/text sources |
| Independent local directories | Native directory picker | A set of roots paired by relative path |
| File within a directory comparison | Another parent root or revision, according to the parent comparison | Current relative path and the shared parent source set |

Use a compact chooser for file/blank choices and a searchable modal for Git
revisions. Reuse native filesystem pickers. Offer only choices the active host
and comparison support; a directory comparison has no blank-text choice.

Resolve a selected branch/tag/ref to its exact commit when inserted. Preserve
the originating repository/worktree for live states. Revisions from branches
outside the currently loaded history list must be validated by the existing
repository backend rather than rejected merely for being outside that list.
An already displayed revision can be labeled `Already shown` and unavailable
for insertion in the initial implementation.

### Order, removal, and focus

- Left/right `+` inserts immediately beside its anchor, including between
  existing Compare sources. Never silently sort the displayed set afterward.
- Compare allows nonconsecutive and reversed revisions. A reversed or
  non-ancestral comparison must retain the existing exact-range explanation;
  do not swap endpoints or substitute a merge base.
- `×` can remove any Compare source, including an interior one. Keep at least
  one source in every supported Compare context.
- With one source, keep browsing/editing and `+` available, disable `×` and
  pair-dependent actions, and show no diff connectors or difference claims.
  Single-directory browsing therefore needs an explicit neutral state.
- Inserting a source focuses it and its comparison with the anchor. Removing
  a source preserves the active pair if it survives; otherwise choose the
  nearest surviving panel and valid adjacent pair. Preserve the current
  visible group where possible.
- Use the same semantics in two-way and multi-panel views, menus, and keyboard
  actions. Tooltips name the actual operation, such as `Add revision to the
  left`, `Add file to the right`, or `Remove directory source from comparison`.

### Directory ownership and missing content

A directory column represents a source tree. A file drill-down renders the
selected relative path in each tree. The Files rail changes that selected
path; it does not add independent columns.

Adding or removing a source in drill-down updates the parent source set too.
Returning to the overview, selecting another file, refreshing, and switching
modes must retain the resulting columns and their order. Removing a directory
source must protect unsaved edits associated with that source across files,
not just the currently displayed file.

If a newly added source lacks the current path, retain that path and show
`File absent`. Do not substitute another file, create a file, or present the
absence as editable blank text. Preserve supported rename-aware identity.
Read failures, binary content, and oversized content retain explicit existing
states; they must not turn into empty or identical text conclusions.

### Revision drafts and mode restoration

Displayed sources, the unapplied checkbox draft, and History focus remain
separate states. Header mutations apply directly to the displayed comparison
and immediately update numbered panel markers. They do not silently apply,
clear, or modify an unrelated pending draft.

The existing bulk Apply action continues to replace the displayed revision
set using its documented oldest-to-newest draft order. A positional insertion
is not a bulk Apply action. Selecting displayed revisions into the draft must
not reorder the live panels. Matching displayed state must account for order
where order affects the comparison, rather than comparing membership alone.

Preserve each mode's source order, focus, path, layout, and pending draft on
round trips. Compare's one-source state does not require changing the existing
two-selection minimum for submitting a new bulk revision comparison.

## State, editing, and host boundaries

Use one authoritative ordered source set per comparison, projected into its
overview and file panels. Sources need stable identities independent of array
position, explicit kind/provenance, and host-owned capabilities. Extend the
existing session contracts where sufficient; this plan does not require a
general plugin or source-provider framework.

- Preserve surviving editor models, unsaved content, undo, selections, scroll,
  writable-file identity, and active-panel identity across mutations. Avoid
  rebuilding surviving state from saved disk content.
- Apply the existing save/discard/cancel guard to content that removal or
  replacement would discard. Adding a source must not discard existing edits
  or demand an unrelated save merely to insert another panel.
- Committed/index snapshots remain read-only; working files and explicit
  scratch panels retain only their existing editing capabilities. Explicit
  read-only launches cannot gain write access through the chooser.
- Preserve provenance per source when mixing files with scratch text. A blank
  has no Git identity, but adding it must not erase known file provenance or
  misrepresent the resulting set as a valid all-Git History context.
- Validate anchor/source IDs, mode, selection, repository ownership, and
  capabilities in the host. Revalidate after an asynchronous picker returns;
  do not insert into a different session or beside a removed anchor.
- Recompute affected adjacent pairs and directory inventories, invalidate
  stale search/range results, and update the source descriptor used for
  refresh, History eligibility, and workspace labels.

Desktop Explore owns initial delivery. Browser views may expose matching
revision controls only through an existing authorized repository backend;
they acquire no arbitrary local-path or filesystem-write capability. VS Code
retains its contextual comparison and desktop handoff boundary. Authored tour
stacks are not mutated by this feature.

## Scope and non-goals

In scope are the History correction, contextual Compare insertion/removal,
two-way/multi-panel parity, directory ownership, one-source states, accessible
labels and keyboard operation, editing guards, and refresh/mode restoration.

Separate work: arbitrary `path@revision` combinations in independent-file
comparisons, mixed file/tree comparisons, cross-repository Git comparison,
directory copy/delete, new binary multi-panel rendering, merge resolution,
new durable session formats, and authored-tour/schema changes. Panel reordering
is independently scoped; coordinate stable source IDs and order preservation
with any implementation already underway rather than creating another reorder
mechanism here.

## Implementation sequence

1. **Correct History first.** Share or align edge eligibility and host guards
   across the existing History paths. Add focused regression coverage for
   interior removal and boundaries. This correction can ship independently.
2. **Enable revision Compare.** Implement contextual revision selection,
   positional mutations, stable identities, draft separation, and one-source
   behavior. Support both tree overview and selected-file projections without
   losing their shared revision set.
3. **Unify local file and scratch controls.** Replace unconditional blank
   insertion with file/blank selection and provide two-panel parity. Preserve
   editing, read-only launches, refresh identity, and cancellation behavior.
4. **Complete filesystem directory behavior.** Allow insertion beside any
   column, synchronize drill-down mutations with the parent roots, protect
   associated edits, and support neutral one-root browsing.
5. **Verify integration and document the surface.** Exercise supported hosts,
   update `docs/product-surface.md` on the implementation branch, and complete
   targeted native interaction checks. Keep this planning branch separate.

Each increment must leave unsupported actions explicitly unavailable. Do not
route Compare actions through History's adjacent-revision mutation handler.

## Acceptance and verification

- History `[A, B, C]` rejects removal of `B` in both UI and direct host
  messages; trimming either edge works down to one panel. Edge expansion
  restores the actual neighbor, including a commit unchanged for the file.
- Compare `[A, C]` can insert `B` between them, or another valid revision in
  either position. Removing `B` is allowed; explicit reverse order survives
  refresh and mode round trips without being normalized away.
- Canceling a picker, choosing an invalid ref, or returning a delayed picker
  result to a changed session causes no partial mutation or loss of state.
- File and scratch comparisons exercise two, three, and one panel. Removing a
  dirty panel tests save, discard, and cancel; adding preserves unsaved edits
  and undo in surviving panels. Explicit read-only state remains effective.
- A directory source inserted or removed from a file drill-down appears
  identically in the overview and another selected file. Cover missing paths,
  an unreadable source, all-sources-absent paths, and edits in another file of
  a removed root. One remaining root shows browsing without diff status.
- Revision cases include commits outside the initial loaded list, branch/tag
  pinning, duplicate selection, supported index/worktree/empty states, absent
  and renamed files, binary/oversized notices, and invalid exact ranges.
- Panel numbers, labels, active pair, search scope, pending draft, refresh
  source, and History availability remain accurate after each mutation.
- Mouse and keyboard checks cover chooser focus, Escape cancellation, focus
  return, descriptive labels, disabled boundaries, and menu equivalence.

Extend relevant `test/workspaceHost.test.js`, `test/workspace*.test.js`, and
`test/runTests.js` contracts, plus native workspace/directory/panel smoke
coverage. During implementation run the configured compiler, lint, tests,
and relevant native smoke checks; record actual results and skipped checks.
Add browser regression coverage only where a supported browser control is
implemented. Documentation review alone does not satisfy these criteria.

## Risks and confidence

The largest risks are losing edits while rebuilding sessions, allowing parent
and drill-down source sets to diverge, and conflating displayed revisions with
an unapplied draft. Directory one-source behavior and two-way control parity
are real renderer/session work and must be included in estimates.

Confidence is medium-high in the interaction direction, based on the existing
source, panel, and directory models. Usability evidence that readers mistake
drill-down removal for closing only the current file would require revisiting
its labeling or moving that operation to an explicit source-level action.

## Related plans and precedence

- [Shared workspace and History bridge](shared-workspace-tour-discovery-and-history-bridge.md)
  governs source ownership, explicit draft submission, and restoration.
- [Multi-select history comparison](multi-select-history-compare.md) records
  the earlier bulk selection design. This plan adds a contextual picker and
  explicit positional Compare order; it supersedes the earlier exclusive
  rail-picker and universal chronological-order requirements for these
  actions. It does not restore immediate checkbox-to-panel mutation.
- [Comparison controls and file states](comparison-controls-and-file-states.md)
  separately scopes broader filtering, errors, and symlink behavior.
- [Deferred directory workflows](deferred-directory-workflows.md) retains
  filesystem operations and differently named file pairing.
- [Focused multi-panel strip](focused-multi-panel-strip.md) and
  [visible panel count](visible-panel-count.md) govern layout and navigation.
