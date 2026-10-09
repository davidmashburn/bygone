# Workspace identity and sidebar context

Status: Proposed follow-up, grounded in source inspection and live checks on
2026-10-09. The editability-indicator slice was approved and implemented in
`d8483e9`. The remaining proposal is not implemented or yet approved as an
implementation contract.

## Outcome and baseline

Give every view a stable workspace identity, show the tour title once in the
reading document, and make sidebar scope clear without adding another header
row or another level of navigation. Common controls should stay in predictable
places; their labels and data must describe what they actually cover.

The accepted [compact workspace tabs](workspace-view-selector.md) are already
implemented in `f0f5f26`, rebased onto main `cbe4707` for integration. Keep the four visible destinations, compact row, missing-tour empty
views, and navigation safeguards. This plan supplies the follow-up that the
implementation exposed; it does not reopen the dropdown proposal.

## Findings that constrain the design

Inspected the implementation worktree, not the uncommitted changes in main.
Source paths below are relative to the implementation repository at `4381bdf`.

| Observed behavior | Evidence | Consequence |
| --- | --- | --- |
| The same tour title appears in the sidebar, opening breadcrumb, and document H1. | `web/index.html`; `web/host.js`: `renderTourShell`, `renderTourNarrative`, `buildReadingDocument` | Give workspace identity, navigation, and authored title separate roles. |
| Derived History/Compare views inherit the tour's range, summary, and coverage. | `web/host.js`: `zoomTour`, `renderTourShell`, `renderWorkspaceControls` | Moving labels alone leaves misleading data. Derive view context from the actual loaded view. |
| A changed comparison updates its file inventory, but not the inherited summary/range. | Live fixture: intermediate `5b5c702` to head `9f9c531` showed **Files 5**, while Details said **4 files · +2 −1 · 2 commits** and the toolbar still showed `export-base → export-head`. | Add a regression around a comparison with a different inventory and range. |
| An absent Deconstructed tour retains the Historical tour's title, statistics, and authoring coverage. | Live missing-tour view of `Export <fixture>` | Empty views must not borrow another tour's metadata. |
| Files has several legitimate scopes. | `src/workspaceHistory.ts`: `collectFiles`; `web/host.js`: `showComparison`, `showZoomHistoryOverview`, `updateTourFileSelection` | Share placement, not a false promise that every list is the active pair's changed files. |
| Commits supports exploration in every mode, including tours. | `docs/product-surface.md`; native/web history renderers | Keep it available wherever the host provides history. Tour membership and loaded-panel markers have different meanings. |
| Authoring coverage includes walkthrough coverage and assignments across authored scenes. | `web/host.js`: `renderAuthoringCoverage` | Treat this as document metadata; do not relabel it as coverage of the selected view. |
| Exports intentionally remove repository and local-source information. | `cli/tourExport.js`: `materializeTour` | Use a safe fallback identity; do not restore local paths to exports. |

The live browser checks covered Historical tour, History, changed Compare,
and an absent Deconstructed tour in the existing development fixture. Export,
native, and VS Code constraints were checked in source, not rerun interactively.

## Proposed information hierarchy

### One stable workspace identity

Use the existing compact workspace row, with a restrained identity label before
the four tabs and the current view's revision context after them. Do not add a
title row above it. Identity is text, not another navigation control.

```text
bygone   History  Compare  Historical tour  Deconstructed tour   Tour range: base → head
```

Identity must remain stable when changing modes:

- Git workspace: repository basename, with the source scope available in Details.
- Non-Git comparison: original folder/file labels, compacted for multiple inputs;
  never a generated snapshot's temporary filename.
- Portable tour/export without repository metadata: known document basename;
  otherwise `Exported review` for an export or `Tour document` for a loaded tour.
- Blank workspace: `Untitled comparison`.

Use existing source metadata. Do not introduce a tour schema field, infer a
repository from the tour title, or fetch a remote project name. Full local paths
may remain available locally where already appropriate, but must not enter an
export to improve its label.

Bound and ellipsize long identity text before reducing tab usability; expose its
full accessible name. Preserve the existing narrow-screen wrap behavior. The
desktop target remains one row. Verify actual fit before committing the layout;
if the added identity forces a desktop row, reduce its allocation rather than
adding a permanent header band.

The outer workspace owns this identity and navigation in embedded mode. Browser
presentations own their row when standalone. Reuse the existing identity surface
in hosts without these workspace tabs; this work does not add workspace modes
to the VS Code companion. Native window/browser-tab titles may retain the tour
name for identifying the window; they are separate from repeated in-page chrome.

### The authored title belongs to the reading document

- Keep the tour title as the reading document's H1.
- Replace the sidebar title's back-to-start action with **Overview**, inside the
  tour outline. Preserve navigation, keyboard focus, deep links, and narration's
  reading identity for the title item.
- At the document opening, the reading breadcrumb says **Overview**. Later it
  shows the existing chapter/scene/step position. Keep Narration controls there.
- Non-tour modes and missing-tour views retain workspace identity and show no
  inherited authored title or tour coverage. The missing-tour heading remains
  the destination's name, such as **Deconstructed tour**.

### A shared sidebar with explicitly scoped content

Keep **Files** and **Commits** in fixed positions. Add **Outline** after them only
when an authored tour is being read. This is the current `Tour` navigator with a
clearer label, not a new navigation layer. Preserve internal selection keys and
per-mode restoration. Entering a tour for the first time may still select its
Outline; hiding Outline in other modes must select a usable existing panel.

Retain one collapsed **Details** disclosure for the current view's source and
revision facts. Remove the repeated title above it. Put **Tour details**, source
provenance, and authoring coverage within Outline, collapsed by default. Show
walkthrough coverage and deconstructed assignments with their actual ownership;
do not pretend aggregate document data belongs only to the active mode.

| Area | Shared behavior | Scope-specific content |
| --- | --- | --- |
| Workspace row | Stable identity and four destinations | Revision context of the confirmed mode |
| Details | Same disclosure and field ordering when fields exist | Actual source, loaded revisions, and trustworthy summary for that view |
| Files | Same position, selection behavior, and inventory count | Short scope caption describing the actual list; existing per-row availability and active-pair markers |
| Commits | Same position and revision-selection workflow when supported | Reachable history or exported subset; loaded panels, draft selection, and tour membership distinguished |
| Outline | Present only for an authored tour | Overview, chapter/scene outline, current tour search, collapsed Tour details |

Fields need not exist in every mode. Omit inapplicable statistics, coverage,
and source links; do not fill gaps with another mode's data or zeroes. A disabled
Commits control needs a capability reason where useful, and must not become the
fallback selected panel when history is unavailable. Preserve Minimal/Full export
restrictions and authoring-capable missing-tour actions.

Revision-selection actions belong with Commits: Compare/Update comparison,
Clear, and Reset/Select displayed revisions. Keep existing semantics and retain
Parent/Review base only where supported. Selecting revisions edits a draft;
only applying it changes the displayed comparison. Do not duplicate these
actions in the top workspace row.

### Define each scope before rendering its label

| View / host | Files inventory caption | Revision context |
| --- | --- | --- |
| Native workspace history inventory | `Workspace files`, with path scope when restricted | Actual loaded revisions, not the draft selection |
| Browser History derived from a tour | `Review files`, with the enclosing review range available | Loaded history revisions; do not describe the file list as every file reachable in history |
| Compare | `Comparison files`, with all-files or selected-file scope | Actual submitted comparison revisions |
| Historical / Deconstructed tour | `Tour files`; use `Scene files` only when the inventory is actually scene-limited | Enclosing real range explicitly labeled `Tour range` |
| Missing tour | Available workspace/review inventory, if any | Known workspace range, without implying an authored tour exists |

Keep existing inventory construction in this slice. In particular, browser
History need not gain a new repository-wide file discovery API. Disabled rows
outside a displayed overview and per-pair states remain meaningful and visible.

The Files badge counts the list it labels. A change summary is separate: show
additions/deletions/commit totals only when available for its stated scope.
Do not reuse manifest totals for a newly selected comparison or sum adjacent
panel diffs to manufacture an overall total. Missing totals can be omitted.

For more than two loaded revisions, make the multiple-panel nature explicit;
do not imply a single base/head diff. Existing evidence headers identify the
focused pair and file. Tour steps with synthetic stages must retain stage names
and must not imply those stages are Git commits. Draft selections, loaded
panels, and the enclosing tour range remain separate facts.

The workspace row supplies overall view context; the reading breadcrumb supplies
narrative position; existing evidence headers supply the focused comparison;
the sidebar caption supplies inventory scope. This allocation replaces the extra
context strip proposed in [tour orientation and narrative framing](tour-orientation-and-narrative-framing.md).
Its richer transition resolver, authored introductions/conclusions, schema
changes, and narration work remain a separate plan.

### Consistent editability indicators

Use the same compact treatment across tours, History, and Compare. Remove the
dedicated edit-mode row when it contains only the disabled `Read-only snapshot`
button. The live tour preview reserved 28px for that button plus a 10px top
margin; the information does not need a row of its own.

For a wholly read-only comparison, place a passive `Read-only` indicator beside
the existing file/status context, with an accessible explanation of the reason.
Reuse existing per-panel provenance where present rather than adding a duplicate
global label. Mixed writable/snapshot comparisons retain their per-panel
indicators. Preserve the distinction between committed snapshots, explanation
stages, and files opened with editing disabled.

When editing is available, keep the real editing toggle in the existing controls
row. This changes presentation only: host edit permissions, freeze/unfreeze
behavior, and copy-action availability stay intact.

## Implementation sequence and boundaries

1. **Establish presentation inputs from existing state.** Separate workspace
   identity, confirmed view context, inventory scope, available summary, and tour
   metadata. Start at `standalone/workspaceHost.js` and `web/host.js`; extend the
   shared controls' input only as needed. Do not create another navigation store
   or a generic cross-host framework.
2. **Repair title ownership.** Update `media/workspaceControls.js`/`.css`, host
   adapters, and web title/breadcrumb markup. Preserve the reading title's action
   identity and suppress inner workspace chrome when embedded. Fold editability
   status/toggling into existing file and control rows. Check a narrow real-app
   preview before extending the sidebar changes.
3. **Make sidebar scope explicit.** Update `web/index.html`, `web/host.js`,
   `web/presenter.css`, and native rail rendering in `media/script.js`/`.css` as
   needed. Stabilize Files/Commits placement, add Outline conditionally, move
   revision actions with Commits, and remove inherited metadata from derived and
   missing-tour views. Keep host-specific capability differences explicit.
4. **Verify the shared behavior and document it.** Add focused state/interaction
   regressions, update `docs/product-surface.md`, and run affected host/export
   checks. Reconcile with current main before implementation: it has ongoing
   uncommitted tour/history/export work, which must not be overwritten or
   included incidentally.

Required: stable identity, title deduplication, scoped/sidebar placement, compact
editability indicators, and correct context after mode or comparison changes.
Supporting: export fallback,
embedded ownership, session/focus preservation, and regression coverage.

Outside this slice: new modes, backend inventory unification, Git discovery
changes, new dependencies, tour schema changes, remote metadata lookup,
narration redesign, and the orientation plan's authored framing work.

## Acceptance and verification

- Plain Git and non-Git comparisons have an identity without an authored tour;
  identity remains stable across mode changes. Long names, blank workspaces,
  legacy tours, and exports lacking repository metadata have useful fallbacks.
- An authored tour shows its full title once in page content. Overview remains
  reachable from the sidebar, and reading position/narration/deep links survive.
- A changed comparison with a different file count and revisions updates its
  context; inherited tour counts, totals, and coverage cannot masquerade as
  comparison data. Returning to the tour restores its own context.
- Files captions match each inventory. Test multi-panel comparisons, restricted
  paths, directory overviews, omitted binary/large files, and synthetic stages.
- Files/Commits stay in the same positions. Outline and its search/coverage exist
  only for an authored tour. Neither/one/both tours and unavailable history choose
  a valid panel. Minimal/Full exports expose only supported operations.
- Draft selections remain separate from loaded panels. Cancelled dirty-edit
  navigation, failed loads, saved sessions, and per-mode position still work.
- Wholly read-only comparisons have no dedicated disabled-button row. Mixed
  writable/snapshot panels remain distinguishable, real editing toggles still
  work, and explicit read-only launches cannot become writable. Check tours,
  History, Compare, and non-Git files; avoid duplicate status labels.
- Check browser and desktop, embedded ownership, and the affected VS Code title
  surface. Inspect light/dark, 1280/620/320px, long labels, keyboard order, visible
  focus, and accessible names. Desktop gains no permanent header row.
- Run `npm test`, the affected desktop workspace smoke, and
  `npm run test:export-smoke` after implementation; update existing assertions
  where markup changes. Exercise changed comparison state, not only snapshots
  of static labels. A reader check should establish that scope is understood
  without opening Details.

High confidence in the duplication and stale-context diagnosis: both source and
live mode transitions demonstrate it. Medium confidence in the proposed layout
until the real-app width and reader checks pass. Crowding in the compact row or
confusion between review inventory and displayed comparison would change the
placement/wording decision, not justify copying metadata across modes.

This planning pass changed no product code. It checked source and live browser
state, but did not rerun builds, automated product tests, desktop/export smokes,
VS Code, or screen-reader checks. The new layout itself has not been rendered.
