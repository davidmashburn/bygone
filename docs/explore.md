# Explore with Bygone

Explore is the standalone workspace for investigating differences without a
prescribed reading order.

## Start a comparison

- **Compare Files…** accepts two or more files. Two files open a side-by-side
  comparison; additional files open the focused multi-panel strip.
- **Compare Directories…** accepts two or more directories and compares their
  trees.
- Drag files or directories into the window for the same selection-count
  behavior.
- Start without paths to get a blank, writable two-panel comparison.

Writable filesystem panels are labeled **Writable file**. Git revisions,
history, tours, and supplied snapshots are labeled **Read-only snapshot**.
Replace and save operations are unavailable for read-only content.

## Ask Git questions

- **View File or Directory History…** follows one path through commits and
  supported index/worktree states.
- **Explore Current Branch Change** compares the branch tip with its merge
  base and shows the complete changed-file inventory.
- CLI `--git-diff` compares explicit revisions when you already know the refs.

Branch exploration uses committed content. Dirty index and worktree changes
are reported separately and are never silently folded into a commit snapshot.

## Navigate and search

The focused strip shows an adjacent pair when space permits and one readable
panel on narrow windows. Use the strip buttons, panel headers, gutters, wheel,
or `Alt+Left`/`Alt+Right` to change focus.

- `Cmd/Ctrl+F` searches the active pane.
- `Cmd/Ctrl+Shift+F` searches either the panes currently displayed by the strip
  or every loaded panel in the comparison, using the explicit scope selector.
- `Cmd/Ctrl+H` replaces only in the active writable pane.
- `Alt+Z` toggles long-line wrapping.
- `Cmd/Ctrl+R` refreshes sessions whose source can be rebuilt safely.

Search results identify the panel and line they came from. In a directory or
branch session, choose **Current change set** to search changed text files that are not
currently open; selecting a result opens its comparison and reveals the exact
side and line.

While viewing one file's history, choose **Git history** and then select the
query meaning: **Content occurrence** finds every revision snapshot containing
the text, while **Introduction or removal** finds revisions where the number of
matches changed. Selecting a result opens that exact parent-to-commit comparison.

Use **Edit → Search in Files…** for a read-only filesystem search rooted at a
directory you choose. It supports literal or regular-expression queries,
case and whole-word matching, include/exclude globs, hidden files, ignore-file
policy, cancellation, and explicit result limits. It requires ripgrep 14 or
newer; **Help → Repository Search Status…** reports the detected capability.
The [search scopes and semantics](./search.md) reference records the different
engines, options, limits, provenance, and stale-result rules.

## Move into Present

**Present Current Branch** creates a guided tour of the committed branch range.
**Open Authored Tour…** opens a checked and compiled `.bygone.yaml` narrative in
its own presentation window, leaving the Explore window available.
