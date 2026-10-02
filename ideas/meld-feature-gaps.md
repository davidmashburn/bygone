# Meld feature gaps worth considering

## Status

**Needs evaluation — DO NOT IMPLEMENT UNQUALIFIED.**

Every candidate and suggested behavior below requires evaluation for Bygone.
Meld is a reference for possible user needs, not an approved design or a parity
target. This document does not authorize implementation or wholesale adoption
of Meld's decisions, including its filtering defaults and matching semantics.

Assessed against Bygone `main` at `e53862f` (version 0.9.5) and Meld's official
help on 2026-10-02. The assessment uses source inspection and documentation;
neither application was exercised specifically for this comparison.

## Evaluation gate

Before promoting any candidate to an implementation plan:

- Demonstrate the user problem with representative Bygone workflows.
- Evaluate Meld's behavior against alternatives, including keeping Bygone's
  current behavior or solving only a smaller part of the problem.
- Assess fit with Bygone's review, history, multi-panel, editing, and tour
  semantics; identify tradeoffs and surprising defaults.
- Record an explicit decision to adopt, adapt, reject, or defer each proposed
  behavior, with rationale and a qualified scope.

Only behaviors selected through that evaluation belong in an implementation
plan. The list below is neither an approved backlog nor acceptance criteria.

## Suggested evaluation order

Evaluate **comparison filename filters and ignored-text rules** first. They
appear relevant to everyday comparison noise, but the appropriate Bygone
design remains open. Consider state filters, explicit folder error/symlink
representation, and manual alignment points against demonstrated needs next.

Folder mutations and a supported merge tool are larger product decisions.
Keep them separate from filtering: they introduce new write workflows, while
the current product explicitly presents directory rows as read-only and keeps
merge tooling outside its supported surface.

Confidence is **high** for the documented comparison-filter gap and current
directory/merge boundaries. Confidence is **medium** for the relative priority
of the remaining candidates; representative user sessions would change that
ordering. A supported command or UI path absent from the inspected sources
would change the gap assessment.

## Candidates

### 1. Filename and folder filters — evaluate first

[Meld filename filters](https://help.gnome.org/meld/file-filters.html) use globs,
can exclude an entire subtree, and have defaults plus per-comparison toggles.

Bygone already supports include/exclude, hidden-file, and ignore controls in
repository **search**. Git working-tree inventories also respect Git's ignore
rules for untracked files. Those are not configurable comparison filters.
Ordinary directory traversal currently hides dot-prefixed entries by default;
it does not expose a comparison policy for selecting hidden files or ignoring
generated and backup files.

Possible behaviors to evaluate, not approved requirements:

- Include/exclude path globs, hidden-file visibility, and named filter presets.
- Per-session overrides with a visible active-filter indicator and a clear
  action to reveal excluded files.
- Explicit semantics for basename versus root-relative path matching,
  directory pruning, and conflicting include/exclude rules.
- Separate filesystem ignore behavior from committed Git inventory. A tracked
  file must not disappear merely because a worktree ignore rule matches it.
- Filter counts must distinguish hidden files from reviewed files. Authored
  tour evidence and the underlying complete change inventory stay intact.

Reuse the vocabulary in [multi-scale search](../plans/multi-scale-search.md),
but keep search scope and comparison visibility distinct.

### 2. Ignored text and whitespace differences — evaluate first

[Meld text filters](https://help.gnome.org/meld/text-filters.html) ignore regex
matches for comparison while retaining the original visible text, also affect
folder equality, and offer special handling for blank-line-only changes.

Bygone's matcher uses normalized content internally to score likely line
counterparts. That is not a user-selected rule for suppressing differences;
the comparison model has no exposed text-filter policy.

Start with explicit whitespace and blank-line options; consider ordered regex
presets only after the mapping contract is clear. Preserve original contents,
line coordinates, selection, copy-across, edits, and saved bytes. Distinguish
“identical” from “equivalent under active filters” in file and folder views,
and allow a quick raw comparison. Define behavior consistently across adjacent
multi-panel pairs, workers, change navigation, and inline highlights.

This extends [diff matching](../plans/diff-matching-between-panels.md) and
[conservative replacement blocks](../plans/conservative-replacement-blocks.md)
without treating weak automatic matches as evidence that text is ignorable.

### 3. File-state filters — useful companion to filename filters

Meld can show selected file states such as modified, new, or same in its
[folder comparison](https://help.gnome.org/meld/file-filters.html).

Bygone already has change navigation and “Collapse unchanged folders.”
Collapsing a subtree does not hide identical files in mixed folders or select
only modified / left-only / right-only / partial entries.

Add state toggles to ordinary directory comparison. Keep parent paths useful
when their children are filtered, make empty results explainable, and retain
the complete inventory. A flat filtered-path view is a possible later
extension, not a prerequisite. Branch review already has a changed-file
inventory and [file-change overview](../plans/file-change-overview.md); avoid
building that again.

### 4. Manual alignment points — useful for difficult comparisons

[Meld synchronization points](https://help.gnome.org/meld/syncpoints.html) let
users match lines explicitly and partition the comparison around those points.

Bygone's current alignment is automatic. Repeated boilerplate and large
replacements can remain ambiguous despite matcher improvements. Let a reader
mark corresponding lines, remove a matched pair, and clear all anchors.
Require monotonic anchors; define how edits, refresh, and revision changes
invalidate them. Begin with two panes before choosing an N-panel contract.

This is an escape hatch for demonstrated ambiguous cases, not a substitute
for the existing matcher corpus and quality gates.

### 5. Explicit folder errors and symlinks — correctness before convenience

[Meld folder states](https://help.gnome.org/meld/folder-mode.html) include errors
and symlink indicators.

Bygone's directory-entry schema lacks an error state or symlink identity.
`safeReadDir` turns read failures into an empty listing, and `safeStat` follows
links. Consequently, an unreadable directory can appear empty rather than
unreadable, and a link has no distinct visible identity.

Preserve read failures as explainable entries, distinguish a missing path from
an inaccessible one, and decide explicitly whether comparison examines a
link's target text or its referent. Cover dangling links, file-versus-folder
mismatches, and cycles before offering recursive link traversal. No filesystem
mutation is required for this improvement.

### 6. Pair differently named files and choose filename-case semantics

Meld supports marked comparisons of differently named files in its
[folder view](https://help.gnome.org/meld/folder-mode.html), and an optional
[case-insensitive filename policy](https://help.gnome.org/meld/file-filters.html).

Bygone can already compare arbitrary file paths, and Git review pairs detected
renames. The remaining convenience is selecting two unrelated tree entries
for a comparison without leaving the directory session. Ordinary directory
pairing currently keys exact entry names.

Treat manual pairing as a focused directory-navigation feature. Consider case
folding only with collision handling; `README` and `readme` can both exist on
some filesystems. Do not silently turn ambiguous names into one row.

### 7. Directory copy/delete — defer pending a write-workflow decision

Meld can copy or delete files from its
[folder comparison](https://help.gnome.org/meld/folder-mode.html). Bygone's
directory rows are intentionally read-only, although eligible file drill-down
panes are editable.

If this becomes a product goal, scope it to writable local filesystem roots,
with an inspectable destination/overwrite preview, dirty-buffer handling,
recoverable deletion, and refreshed comparison state. Historical snapshots and
explicit read-only launches remain incapable of mutation. Directory operations
deserve their own plan rather than inheriting file-edit permissions implicitly.

### 8. Supported three-way conflict resolution — separate product decision

Meld is a supported [Git merge helper](https://help.gnome.org/meld/resolving-conflicts.html).
Bygone has an experimental merge algorithm and result renderer, but its README
explicitly excludes merge tooling from the supported product surface.

The gap is a complete workflow: base/local/remote/result provenance, per-conflict
choices and editing, remaining-conflict navigation, result saving, cancellation,
and a `git mergetool` invocation whose exit status reflects completion. Multiple
diff panes alone do not provide this contract. Decide whether merge resolution
belongs in Bygone before promoting the experimental code.

## Already covered or not a current recommendation

Do not add duplicate plans for two-way editing, multi-directory comparison,
change navigation, find/replace, line wrapping, refresh, Git history, or basic
block copy-across. These already exist or have implementation/reference plans.
Likewise, full staging/commit administration and additional version-control
systems are not necessary to address these comparison gaps.

## Evidence and next steps

Bygone evidence is pinned to the inspected development snapshot:

- [Product surface](https://github.com/davidmashburn/bygone/blob/e53862f/docs/product-surface.md):
  supported workflows, repository search controls, and directory write boundary.
- [Directory comparison](https://github.com/davidmashburn/bygone/blob/e53862f/src/directoryDiff.ts):
  name-based union, hidden-path default, entry states, reads, and equality.
- [Repository search](https://github.com/davidmashburn/bygone/blob/e53862f/src/repositorySearch.ts)
  and [desktop host](https://github.com/davidmashburn/bygone/blob/e53862f/standalone/main.js):
  existing search filtering and Git working-tree inventories.
- [Diff engine](https://github.com/davidmashburn/bygone/blob/e53862f/src/diffEngine.ts)
  and [renderer](https://github.com/davidmashburn/bygone/blob/e53862f/media/script.js):
  automatic alignment, unchanged-folder collapse, and experimental merge view.
- [README](https://github.com/davidmashburn/bygone/blob/e53862f/README.md):
  current merge-tool limitation and arbitrary-path comparison support.

Evaluate filename/state filtering using one generated tree, one Git review
with tracked generated files, and one hidden-file example. Collect
representative whitespace and ambiguous-alignment fixtures to test whether
those needs warrant new behavior. Validate the gaps in both installed
applications, compare alternative designs, and record the decisions required
by the evaluation gate before promoting any selected scope into a plan.
