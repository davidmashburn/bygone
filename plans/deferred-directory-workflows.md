# Deferred directory workflows

## Status

Deferred. Preserve directory copy/delete and differently named file pairing as
separate future work. They are not scheduled phases of
[comparison controls and file states](comparison-controls-and-file-states.md).

## Goal

Keep two potentially useful directory workflows easy to resume with their
scope and costs already identified.

## Directory copy/delete

### Context and value

Bygone's directory rows are read-only. Eligible local file drill-down panes
already support editing, but copying or deleting tree entries would add a
filesystem operation lifecycle beyond that editing contract.

Copying an entry between local roots could help synchronize selected files.
Deletion could remove unwanted local entries while reviewing a comparison.

### Proposed scope when resumed

- Limit operations to explicitly writable local filesystem roots. Historical
  snapshots and explicit read-only launches retain their capability boundaries.
- Show the exact source, destination, and overwrite/delete consequence before
  mutation. Handle existing destinations and file/folder/link mismatches
  deliberately.
- Account for unsaved buffers and changes to either path since the comparison
  was built. Revalidate before executing the operation.
- Use recoverable deletion and define rollback or recovery for copy failures
  and partially completed folder operations.
- Refresh the affected inventory and file panes while preserving useful
  navigation and review state.

### Reason for deferral and next decision

Overwrite rules, dirty-buffer coordination, recovery, and recursive filesystem
operations add substantial lifecycle overhead. Resume only when representative
workflows justify those costs. Start by deciding whether single-file copy alone
provides enough value before adding folder operations or deletion.

## Differently named file pairing

### Context and value

Bygone already compares arbitrary file paths, and Git review pairs detected
renames. A directory-view shortcut could let a user choose two unrelated tree
entries and compare them without leaving the directory session.

### Proposed scope when resumed

- Select one entry on each side and open an ordinary comparison using their
  actual paths and source provenance.
- Keep the action lightweight and explicit; the directory inventory retains
  its original path-based relationships.
- Preserve a clear route back to the originating directory selection.
- Reuse the existing file-comparison lifecycle, binary classification, editing,
  and read-only rules.

### Reason for deferral and next decision

This is a convenience rather than a missing comparison capability. Resume if
users repeatedly need it and the existing arbitrary-file launch is cumbersome.
Choose the smallest tree-selection interaction that solves those examples.

## Related plans and evidence

- [Comparison controls and file states](comparison-controls-and-file-states.md)
  is the selected directory-comparison work.
- [Editable worktree Git comparisons](editable-worktree-git-comparisons.md)
  records source provenance and writable-file lifecycle constraints.
- Source baseline at `e53862f`: [product surface](https://github.com/davidmashburn/bygone/blob/e53862f/docs/product-surface.md),
  [directory comparison](https://github.com/davidmashburn/bygone/blob/e53862f/src/directoryDiff.ts),
  and [README](https://github.com/davidmashburn/bygone/blob/e53862f/README.md).
