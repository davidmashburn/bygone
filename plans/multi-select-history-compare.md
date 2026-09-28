# Multi-select history comparison

## Status

Approved for implementation on `main`.

## Goal

Make Compare a direct extension of browsing Git history: select two or more
revisions in the visible commit list, then compare all selected revisions as
adjacent panels. Remove the mode and comparison endpoint drop-downs so the
available actions and selected revisions stay visible.

## Interaction model

The History rail is the only revision picker.

- Each revision row has a selection control for comparison membership and a
  separate label action for previewing that revision in History.
- The previewed revision and the comparison selection are independent states.
- Entering History initially selects the current revision and its adjacent
  older revision when both exist.
- **Compare selected (N)** becomes available when at least two revisions are
  selected.
- In Compare, two selected revisions produce two panels; three or more produce
  one panel per selected revision.
- Panels are ordered oldest to newest, independent of the order in which the
  revisions were selected, and connectors describe each adjacent pair.
- The revision rail remains visible in Compare. Toggling a revision updates
  the panels, and activating a selected revision's label focuses its panel.
- Returning to History preserves both the selected set and the last previewed
  revision.

The mode drop-down becomes visible tab or segmented-button navigation for
History, Compare, Historical tour, and Deconstructed tour when those modes are
available. The Compare From and To drop-downs are removed. Parent, base,
final, swap, clear, and similar shortcuts may remain as explicit buttons when
they are meaningful; this plan does not redesign unrelated controls such as
search scope.

## State and runtime boundaries

Replace the two-endpoint comparison state `{ from, to, path }` with a selected
revision state shaped as `{ path, commits[] }`. Keep normalization as a pure
function that:

- validates commit identifiers against the loaded history;
- removes duplicates;
- requires at least two revisions before opening Compare; and
- orders the selection by repository chronology rather than click order.

History row messages must distinguish preview, selection toggle, and panel
focus. Treat messages and URL parameters as untrusted input and validate them
against the server-provided revision list before reading Git objects.

Reuse the existing arbitrary-panel renderer, focused panel strip, adjacent
pair model, and repository snapshot construction. Extend the repository API
only as needed to obtain the selected snapshots efficiently and preserve
rename-aware paths. Do not introduce a second comparison renderer.

## Compatibility

- Existing `mode=compare&from=<ref>&to=<ref>` links translate to a two-item
  selection.
- New Compare URLs encode the ordered revision list and current file path.
- A file that is absent at a selected revision renders as an empty endpoint;
  renames retain the revision-appropriate path and label.
- Binary or oversized content follows the existing omission and preview
  behavior rather than silently decoding it as text.
- Existing authored-tour modes, History preview navigation, narration, and
  per-mode cursor restoration remain intact.

No authored source or compiled manifest change is needed. This is presenter
session state, so it does not introduce format version 4.

## Scope and non-goals

In scope:

- visible multi-selection in the actual History commit rail;
- two-or-more revision panels with adjacent diffs;
- drop-down-free mode and comparison setup;
- URL compatibility and persistence within the active presentation session;
- keyboard and accessible labeling for the new controls.

Out of scope:

- inferred correspondence between independent authored tours;
- a commit graph or branch topology view;
- a redesign of unrelated search or file filters;
- cross-session persistence beyond the existing tour-session contract;
- a new `.bygone` schema or renderer.

## Verification

- Unit-test normalization for two and three revisions, noncontiguous choices,
  duplicate or unknown commits, click-order independence, and fewer than two
  selections.
- Exercise rename, create, delete, binary, and oversized-file cases across
  three or more revisions.
- Verify the rail distinguishes previewed, selected, and focused states with
  mouse and keyboard input.
- Verify old two-endpoint deep links and new ordered-selection links.
- Smoke-test three panels and two adjacent diffs in both browser presentation
  and the packaged desktop host.
- Run the configured TypeScript/compiler checks, lint, full tests, and
  standalone smoke check.
