# Meld feature gaps worth considering

## Status

**Needs evaluation — DO NOT IMPLEMENT UNQUALIFIED.**

The four selected features below require qualified designs before implementation.
Meld is a reference for possible user needs, not an approved design or a parity
target. Feature selection does not authorize wholesale adoption of Meld's
decisions, including its filtering defaults and matching semantics. Deferred
features are outside the current scope; cut features are rejected from this work.

Assessed against Bygone `main` at `e53862f` (version 0.9.5) and Meld's official
help on 2026-10-02. The assessment uses source inspection and documentation;
neither application was exercised specifically for this comparison.

## Feature decisions

The user selected the following scope on 2026-10-02. These decisions supersede
the initial recommendations and apply to the remaining evaluation work.

| Feature | Decision | Qualification or reason |
| --- | --- | --- |
| Filename/folder filters | Selected | Active exclusions stay visible and easily reversible. |
| Explicit errors and symlink identity | Selected | Unreadable directories must not appear empty. |
| Basic whitespace options | Selected | Explicit opt-in, original content preserved, obvious return to raw comparison. |
| File-state filters | Selected | Show modified, identical, or one-sided files. |
| Directory copy/delete | Deferred | Overwrite, dirty-buffer, recovery, and filesystem lifecycle overhead. |
| Differently named file pairing | Deferred | Potential lightweight shortcut; not part of the selected scope. |
| Manual alignment points | Cut | Edit persistence and multi-panel coordination add complexity. |
| Regex text filters | Cut | Ordering, line mapping, performance, and filtered-equality semantics add complexity. |
| Supported merge resolution | Cut | Substantial new product scope and write lifecycle. |
| Case-insensitive filename matching | Cut | Limited demonstrated benefit and ambiguous name collisions. |

Deferred work requires a separate decision to resume. Cut features are not later
phases of the selected work; reopening one requires an explicit scope decision.

## Evaluation gate

Before promoting a selected feature to an implementation plan:

- Demonstrate the user problem with representative Bygone workflows.
- Evaluate Meld's behavior against alternatives, including keeping Bygone's
  current behavior or solving only a smaller part of the problem.
- Assess fit with Bygone's review, history, multi-panel, editing, and tour
  semantics; identify tradeoffs and surprising defaults.
- Record an explicit decision to adopt, adapt, reject, or defer each proposed
  behavior, with rationale and a qualified scope.

Only behaviors qualified through that evaluation belong in an implementation
plan. The feature decisions above select the problems to pursue; they do not
approve every possible behavior or establish complete acceptance criteria.

## Suggested evaluation order

Evaluate filename and file-state filtering together, then explicit folder
errors/symlink identity and basic whitespace options. The appropriate Bygone
design remains open within the selected scope. This evaluation must not grow
into regex filtering, manual alignment, merge tooling, case-insensitive matching,
directory mutation, or differently named file pairing.

Confidence is **high** for the documented comparison-filter gap and current
directory/merge boundaries. Confidence is **medium** for the suggested evaluation
order; representative user sessions would change that ordering. A supported
command or UI path absent from the inspected sources would change the gap
assessment. The user's feature selection is a scope decision, not evidence that
any particular design is correct.

## Selected features requiring qualified design

### Filename and folder filters

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

### Basic whitespace options

[Meld text filtering](https://help.gnome.org/meld/text-filters.html) includes
blank-line handling and broader regex-based rules. Only basic whitespace
options are selected for Bygone; regex text filtering is cut.

Bygone's matcher uses normalized content internally to score likely line
counterparts. That is not a user-selected rule for suppressing differences;
the comparison model has no exposed text-filter policy.

Evaluate explicit whitespace options, including whether blank-line handling
belongs in the basic scope. Preserve original contents,
line coordinates, selection, copy-across, edits, and saved bytes. Distinguish
“identical” from “equivalent under active filters” in file and folder views,
and allow a quick raw comparison. Define behavior consistently across adjacent
multi-panel pairs, workers, change navigation, and inline highlights.

This extends [diff matching](../plans/diff-matching-between-panels.md) and
[conservative replacement blocks](../plans/conservative-replacement-blocks.md)
without treating weak automatic matches as evidence that text is ignorable.

### File-state filters

Meld can show selected file states such as modified, new, or same in its
[folder comparison](https://help.gnome.org/meld/file-filters.html).

Bygone already has change navigation and “Collapse unchanged folders.”
Collapsing a subtree does not hide identical files in mixed folders or select
only modified / left-only / right-only / partial entries.

Evaluate state toggles for ordinary directory comparison. Keep parent paths useful
when their children are filtered, make empty results explainable, and retain
the complete inventory. A new flat-path view is outside the selected scope.
Branch review already has a changed-file
inventory and [file-change overview](../plans/file-change-overview.md); avoid
building that again.

### Explicit folder errors and symlink identity

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

## Deferred features

### Differently named file pairing

Meld supports marked comparisons of differently named files in its
[folder view](https://help.gnome.org/meld/folder-mode.html).

Bygone can already compare arbitrary file paths, and Git review pairs detected
renames. The remaining convenience is selecting two unrelated tree entries
for a comparison without leaving the directory session. Ordinary directory
pairing currently keys exact entry names.

Deferred. If separately resumed, keep it a lightweight directory-navigation
shortcut. Case-insensitive filename matching is a distinct, cut feature.

### Directory copy/delete

Meld can copy or delete files from its
[folder comparison](https://help.gnome.org/meld/folder-mode.html). Bygone's
directory rows are intentionally read-only, although eligible file drill-down
panes are editable.

Deferred. If separately resumed, scope it to writable local filesystem roots,
with an inspectable destination/overwrite preview, dirty-buffer handling,
recoverable deletion, and refreshed comparison state. Historical snapshots and
explicit read-only launches remain incapable of mutation. Directory operations
deserve their own plan rather than inheriting file-edit permissions implicitly.

## Cut features

### Manual alignment points

[Meld synchronization points](https://help.gnome.org/meld/syncpoints.html) let
users match lines explicitly and partition the comparison. Cut because anchors
add edit/refresh persistence rules and multi-panel coordination. Keep the
existing automatic matcher and its quality gates; no manual-anchor phase is
planned here.

### Regex text filters

Cut. Ordered regex rules add line-mapping, performance, and filtered-equality
semantics beyond the selected basic whitespace options. They are not a later
phase of whitespace support.

### Supported merge resolution

Meld is a supported [Git merge helper](https://help.gnome.org/meld/resolving-conflicts.html).
Bygone has an experimental merge algorithm and result renderer, but its README
explicitly excludes merge tooling from the supported product surface.

Cut. The gap is a complete workflow: base/local/remote/result provenance, per-conflict
choices and editing, remaining-conflict navigation, result saving, cancellation,
and a `git mergetool` invocation whose exit status reflects completion. Multiple
diff panes alone do not provide this contract. Do not promote the experimental
code as part of the selected comparison improvements.

### Case-insensitive filename matching

Meld offers a [filename-case policy](https://help.gnome.org/meld/file-filters.html).
Cut because benefit is not demonstrated and `README` and `readme` can coexist
on some filesystems, creating ambiguous collisions. Exact-name directory
pairing remains the baseline for this work.

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
representative whitespace, unreadable-directory, and symlink fixtures for the
other selected features. Validate the gaps in both installed
applications, compare alternative designs, and record the decisions required
by the evaluation gate before promoting any selected scope into a plan.
