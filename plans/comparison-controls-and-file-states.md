# Comparison controls and trustworthy file states

## Status

Selected. Draft implementation plan for filename/folder filters, explicit
errors and symlink identity, basic whitespace options, and file-state filters.

## Goal

Let readers remove comparison noise while keeping the current comparison
policy visible, reversible, and faithful to the underlying files. Make folder
results distinguish identical, different, missing, and unreadable inputs.

## Context

The source assessment at Bygone `main` commit `e53862f` identified four gaps:

- Repository search has include/exclude and ignore controls, but ordinary
  directory comparison has no configurable filename/folder filter policy.
- Directory entries have no explicit error state or symlink identity.
  `safeReadDir` converts read failures to empty listings; `safeStat` follows
  links, making failures and link identity difficult to interpret.
- Content normalization helps the automatic matcher score counterparts, but
  there is no user-selected whitespace comparison option.
- “Collapse unchanged folders” does not select file states or hide identical
  files inside mixed folders.

These changes extend the existing comparison surface and preserve its source
provenance, editing, history, and tour contracts.

## Scope

### Filename and folder filters

Provide include/exclude path patterns for directory comparisons and their file
navigators. Readers can omit generated artifacts, backups, and noisy subtrees.

- Show active patterns in a discoverable filter control and summarize active
  exclusions even when the control is closed.
- Provide a clear reset/reveal action. Changing filters must not destroy the
  comparison session or its review state.
- Define whether a pattern targets a basename or a root-relative path, how a
  matched folder affects descendants, and how inclusion and exclusion interact.
  Use one shared policy across hosts and comparison views.
- Keep comparison filters distinct from repository search controls and the
  rules used to construct a Git working-tree inventory. A tracked file remains
  part of the underlying Git change inventory even when hidden from a view.
- Give hidden-file visibility an explicit control rather than relying solely
  on the current dot-prefix rule. Keep host and repository metadata exclusions
  explainable.
- Distinguish filtered visibility from viewed/reviewed state. An authored tour's
  evidence remains addressable when a directory filter is active.

Session-local settings are the first slice. Decide reusable defaults after the
matching policy and persistence contract are established.

### Explicit errors and symlink identity

Preserve filesystem facts before deriving comparison status.

- Represent directory-listing and file-read failures explicitly, including
  which side failed and a useful reason. A failed read must not produce an
  “empty” or “identical” conclusion.
- Distinguish absent paths from inaccessible paths, and preserve useful rows
  when only one side can be inspected.
- Identify symlinks and display their targets, including dangling links.
  Use link-aware metadata so link identity is not lost through a referent read.
- Define link comparison semantics explicitly. The initial proposal compares
  link targets and does not recurse through directory symlinks; file-versus-link
  and folder-versus-link differences remain visible.
- Explain file-versus-folder mismatches without presenting either side as a
  normal paired file.
- Keep errors reachable and counted even when ordinary file-state filters are
  active. Users must be able to distinguish incomplete results from a clean
  comparison.

### Basic whitespace options

Keep raw comparison as the default. Expose simple whitespace choices explicitly
and show the active choice beside the comparison controls.

- Start with a small set of clearly described options, considering trailing
  whitespace and horizontal whitespace differences. Specify their exact
  treatment of indentation, spaces, and tabs before implementing the model.
- Provide an obvious action to return to raw comparison.
- Compare using a derived representation while retaining original text, source
  coordinates, selections, edits, copy-across behavior, and saved bytes.
- Distinguish byte-identical content from content equivalent under the active
  whitespace policy. A policy change must not mark a file saved or reviewed.
- Apply the same policy to adjacent multi-panel comparisons, worker and host
  results, inline highlights, change navigation, and folder status.
- Keep binary comparison based on bytes. Apply text policies only to supported
  text inputs and report when an input could not be classified or read.

Measure the cost of policy-aware folder equality before deciding whether to
compute it eagerly or on demand. Any pending classification must be visible
and must not masquerade as equality.

### File-state filters

Provide toggles for modified, identical, and one-sided files. Map multi-directory
partial presence into the same understandable presence controls.

- Filter visible rows and change navigation using the same selected states.
- Retain parent paths needed to locate visible descendants.
- Explain an empty filtered result and provide a reset action.
- Compose state filters with filename/folder filters and the active whitespace
  policy. Expose “equivalent under whitespace policy” distinctly from raw
  identity even when both are grouped under the identical-state toggle.
- Keep the complete change inventory intact. Branch-review overview and tour
  coverage continue to describe that inventory rather than silently shrinking
  their totals to the current view.

## Proposed implementation sequence

1. Refresh the source assessment and define the shared comparison policy and
   file-state contracts using representative filesystem and Git fixtures.
2. Preserve read failures and symlink metadata through inventory construction,
   host messages, and directory rendering.
3. Add filename/folder and file-state controls together, including reset,
   active-policy indicators, navigation, and session restoration.
4. Add basic whitespace policies to the shared diff model and directory text
   classification, preserving original source mappings and editing behavior.
5. Verify desktop, contextual VS Code comparisons, and browser views wherever
   the relevant comparison capability exists. Keep filesystem capabilities
   owned by the host that supplies them.

## Validation and acceptance

- A generated tree and backup files can be hidden and revealed without losing
  selection, edits, or review state. Hidden files have an explicit visibility
  policy, with tested path matching and include/exclude precedence.
- Tracked generated files remain in the Git inventory; filter controls explain
  their current visibility. Search and tour evidence retain their own scopes.
- Unreadable roots, nested folders, and files show side-specific errors rather
  than empty or identical results. Missing paths remain distinguishable.
- Symlinks, dangling targets, and mixed file/folder/link inputs have explicit
  identities and deterministic comparison behavior.
- Modified, identical, and one-sided toggles compose correctly with path and
  whitespace policies in two-directory and multi-directory comparisons.
- Whitespace-only differences can be suppressed and immediately restored.
  Original text, line mappings, copy-across, undo, save, and read-only provenance
  remain correct. Worker and host results agree.
- Representative large trees and text comparisons stay within measured latency
  and memory limits; failed or pending classifications are visible.

## Related plans and source evidence

- [Multi-scale search](multi-scale-search.md): reuse terminology while keeping
  search scope distinct from comparison visibility.
- [Refreshable sessions](session-refresh.md): policy restoration and refreshed
  source state.
- [Diff matching](diff-matching-between-panels.md) and
  [conservative replacement blocks](conservative-replacement-blocks.md): source
  mappings, model quality, and copy-across contracts.
- [File-change overview](file-change-overview.md): complete Git inventory and
  viewed-state semantics.
- [Deferred directory workflows](deferred-directory-workflows.md): separately
  retained filesystem operations and directory-selection conveniences.
- Source baseline: [directory comparison](https://github.com/davidmashburn/bygone/blob/e53862f/src/directoryDiff.ts),
  [repository search](https://github.com/davidmashburn/bygone/blob/e53862f/src/repositorySearch.ts),
  [diff engine](https://github.com/davidmashburn/bygone/blob/e53862f/src/diffEngine.ts),
  [desktop host](https://github.com/davidmashburn/bygone/blob/e53862f/standalone/main.js),
  and [product surface](https://github.com/davidmashburn/bygone/blob/e53862f/docs/product-surface.md).
