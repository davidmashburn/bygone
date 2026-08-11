# Multi-scale search

## Status

Draft

## Goal

Provide predictable search at several scales without making a single search
box ambiguously switch between an editor buffer, visible panels, files on
disk, Git history, and tour content.

Keep familiar in-document Find and Replace fast and local. Add an explicit
Search surface for broader scopes, with results that always identify the
file, panel or revision, line, and source kind they came from.

All search runs locally. It must not upload source, queries, matches, paths,
repository metadata, or tour content.

## Relationship to in-document find

The existing in-document find plan remains the first implementation slice:

- `Cmd/Ctrl+F` searches the active Monaco model.
- Find Next and Find Previous navigate that model's matches.
- Find options include case sensitivity, whole word, and regular expressions.
- Replace and Replace All extend that same widget only when the active model
  is writable.

Broader search uses a separate command and results panel, initially
**Search…** with `Cmd/Ctrl+Shift+F`. Its scope is explicit and persists while
the result set is open. Changing the active editor must not silently change a
repository search into an in-document search or vice versa.

## Search scales

### 1. Active pane

Search one complete Monaco model, including changed and unchanged lines.
Support immediate Find, Next, Previous, and Replace for writable models.

This scope includes unsaved and synthetic content because it searches the
actual in-memory model. It should use Monaco's search APIs rather than a
filesystem process.

### 2. Visible panels

Search all text panels in the active comparison and combine their matches in
panel order. Results identify the panel label and provenance—for example a
path, supplied snapshot, Git ref, worktree, or explanation stage.

Selecting a result activates its panel, reveals the match, and updates the
active adjacent pair without changing the underlying session. Result counts
are both per-panel and total.

Initial visible-panel search is read-only as a combined operation. A user may
open a result and replace within its writable active pane. Cross-panel Replace
All is deferred because panels often represent mutually exclusive revisions
or read-only history rather than multiple files intended for batch editing.

### 3. Current comparison or change set

Search every text file belonging to the current session, including files not
currently open:

- all changed files in a branch comparison;
- all paired files in a directory comparison;
- all files represented by a selected revision range; or
- all code snapshots in a compiled tour.

This is session-aware search. It should use the session's resolved sources so
that rename identities, Git blobs, worktree overlays, synthetic stages, and
tour provenance remain correct. Filesystem search alone cannot implement it.

### 4. Directory or repository

Search textual filesystem content under a selected root. Support path globs,
file-type filters, ignore rules, hidden-file inclusion, symlink policy,
literal versus regular-expression queries, case mode, context lines, and a
bounded result limit.

This is the primary candidate for `rg` under the hood. Results must stream,
remain cancellable, and carry exact path, line, column, match ranges, and
context into the common result model.

### 5. Git history

Search historical change, not merely the current checkout. Offer two distinct
query meanings:

- **Content occurrence:** revisions whose selected files contain matching
  text.
- **Change introduction/removal:** commits where the number of literal
  occurrences changes or whose patch matches a regular expression.

Use Git-native operations such as revision walking, blob access, pickaxe
search, and patch-regex search. `rg` cannot discover text that is absent from
the checked-out filesystem and should not be presented as the history engine.

The UI must state whether results are commits, blobs, or patch lines and must
honor the selected revision range and path filters.

### 6. Tour

Search authored narrative and code as separate result kinds:

- scene titles and descriptions;
- walkthrough narration and step labels;
- displayed code snapshots and focused evidence; and
- optionally file paths and panel labels.

Search the compiled manifest or the presenter's bounded index, not the YAML
source file as undifferentiated text. Selecting a narrative result moves to
the owning scene or step; selecting a code result moves to the scene, file,
panel, and line while preserving a visible way to return to the tour.

Synthetic deconstructed stages must be labeled as explanation stages in
results, while stacked panels retain their real Git identities.

## Unified interaction model

### Commands

- **Find…** searches the active pane.
- **Replace…** replaces within the active writable pane.
- **Search…** opens broader search with an explicit scope.
- **Find Next/Previous** remain pane-local when the find widget is active and
  navigate the selected result set when focus is in the Search panel.

Do not overload one match count with results from different scopes.

### Search panel

The broader Search panel contains:

- query input;
- scope selector;
- literal/regex, case, and whole-word options where supported;
- include and exclude path filters for file-based scopes;
- source-specific options such as include hidden files, respect ignores,
  revision range, narrative/code result kinds, or change introduction versus
  content occurrence;
- progress, cancellation, truncation, and error state; and
- grouped results with stable keyboard navigation.

Only show controls meaningful to the selected scope. Preserve the query when
changing scopes, but require the user to run the new search explicitly when
its meaning or cost changes materially.

### Result identity

Normalize every result to a common envelope while retaining source-specific
metadata:

- result kind;
- path or narrative identity;
- panel, revision, stage, or commit identity when applicable;
- line, column, and match ranges;
- preview text and bounded context;
- writable/read-only state; and
- an opaque locator that the owning session can resolve safely.

Do not treat filesystem line numbers as durable locators across edits. Refresh
or invalidate stale results when the source changes.

## Ripgrep integration

### Where `rg` fits

Use `rg --json` as the preferred engine for directory and repository
filesystem scopes because it provides streaming structured matches, mature
regular expressions, ignore-file handling, file filtering, binary detection,
and strong performance on large trees.

Run it only from a trusted host process. The renderer sends structured query
options; it never constructs a shell command. Spawn the executable with an
argument array, a validated root, a controlled working directory, and no
shell interpolation. Parse JSON incrementally, enforce result and byte limits,
and terminate the child process on cancellation or session disposal.

### Where `rg` does not fit

Do not use filesystem ripgrep for:

- unsaved Monaco models;
- Git blobs not present in the checkout;
- index content that differs from the worktree;
- synthetic deconstructed stages;
- narrative fields in compiled tours; or
- binary/image search.

Those scopes need Monaco, session-source, Git, or manifest-aware adapters.

### Distribution decision

Resolve distribution before advertising repository search as a core feature:

1. **System executable:** smallest package, but inconsistent availability and
   version behavior.
2. **Bundled per-platform executable:** predictable behavior, but increases
   package size, release matrix, license notices, provenance, signing, and
   security-update responsibility.
3. **Library fallback:** improves portability but creates two engines whose
   regex, ignore, and performance behavior can diverge.

Recommended path: prototype against a detected system `rg`, record a clear
capability state, and benchmark representative repositories. Before general
release, choose either a verified bundled binary per supported platform or a
documented fallback with a compatibility test suite. Never silently downgrade
to a materially different regex or ignore contract.

## Replace policy

Replacement has a higher safety bar than search:

- Active-pane Replace and Replace All use Monaco and normal editor undo.
- Visible-panel and session-wide replacement are not part of the first broad
  search release.
- A future filesystem Replace in Files must show a preview grouped by file,
  allow individual exclusions, revalidate files before writing, report
  partial failures, preserve encodings and final newlines, and integrate with
  recoverable undo or version-control guidance.
- Historical Git blobs, committed revisions, branch snapshots, tours, and
  synthetic stages are always read-only search sources.
- Repository replacement must never follow symlinks outside the resolved root
  or write ignored/binary files merely because a search option exposed them.

## Host architecture

Define a shared query and result contract, with host-owned adapters:

- **Monaco adapter** for active and visible in-memory models;
- **session adapter** for comparison, branch, directory, and synthetic sources;
- **filesystem adapter** backed by `rg` where supported;
- **Git adapter** for refs, blobs, patches, and history semantics; and
- **tour adapter** for narrative and compiled scene content.

The standalone application owns process spawning, filesystem roots, Git
access, cancellation, and result limits. The shared renderer owns query UI,
result presentation, navigation, and in-memory model search. The VS Code host
can initially expose active-pane Find/Replace and visible-panel search. It
should delegate repository/workspace search to VS Code's native Search surface
rather than spawn a second ripgrep process or reproduce ignore/filter controls
inside a webview. Git-history, directory, branch-change, and tour search remain
standalone-owned until a specific in-editor need justifies another adapter.

## Performance and resource boundaries

- Stream results instead of buffering complete output.
- Debounce only cheap in-memory searches; require explicit submission for
  repository and history scopes.
- Cancel the prior request when a new query supersedes it.
- Bound match count, preview bytes, context lines, files scanned where the
  source permits it, and retained result memory.
- Display truncation as a result state, never as a successful complete search.
- Exclude binary content by default and report skipped categories.
- Cache only source indexes whose invalidation is explicit; do not retain
  proprietary source content beyond the local session merely for speed.
- Benchmark cold and warm searches on small, medium, and large repositories,
  including many ignored files, long lines, large generated trees, and high-
  match queries.

## Scope and non-goals

Included:

- A coherent vocabulary and architecture for active-pane, visible-panel,
  session, filesystem/repository, Git-history, and tour search.
- A safe boundary for pane-local replace and future Replace in Files.
- Local-only operation, cancellation, limits, and provenance-rich results.
- An evidence-gathering prototype for ripgrep-backed filesystem search.

Not included in the initial delivery:

- Structural or language-semantic search.
- Fuzzy symbol navigation or command-palette behavior.
- Searching binary contents, image OCR, submodule contents, or remote hosts.
- Automatically rewriting committed Git history or authored tour sources.
- One universal regex dialect across Monaco, ripgrep, Git, and JavaScript when
  their engines do not support identical constructs. The UI must identify or
  constrain differences instead.

## Related plans

- [In-document find behavior](find-behavior.md)
- [Standalone product surface](standalone-product-surface.md)
- [VS Code companion surface](vscode-companion-surface.md)
- [Refreshable sessions](session-refresh.md), whose source descriptors and
  invalidation policy should precede session-wide search
- [Product implementation roadmap](implementation-roadmap.md)

## Delivery sequence

### Phase 1: familiar local editing

1. Implement active-pane Find, Next, Previous, Replace, and Replace All with
   correct read-only and writable enablement.
2. Add the conventional Edit menu and verify focus routing in every text mode.
3. Test dirty state, undo, save, reload, connector redraw, and navigation.

### Phase 2: comparison search

1. Define the shared query/result/locator contract.
2. Add visible-panel search over in-memory models.
3. Add current-comparison search through session sources.
4. Verify revision, rename, worktree, and synthetic-stage provenance.

### Phase 3: filesystem and repository search

1. Prototype a cancellable `rg --json` adapter without shell interpolation.
2. Benchmark representative repository scales and pathological result sets.
3. Decide executable distribution and compatibility behavior.
4. Add include/exclude, ignore, hidden, file-type, context, and limit controls.
5. Ship Search in Files as read-only before considering Replace in Files.

### Phase 4: Git history and tours

1. Add explicit Git content and change-introduction query modes.
2. Add tour narrative/code indexing and result navigation.
3. Document regex and filter differences across source adapters.
4. Add source-specific performance budgets and fixtures.

### Phase 5: guarded batch replacement

Only after read-only repository search is stable, design and test previewed
Replace in Files with revalidation, recoverability, exclusions, and partial-
failure reporting. Do not generalize replacement to historical or synthetic
sources.

## Validation

- Verify literal, case, whole-word, regular-expression, Unicode, multiline,
  long-line, no-final-newline, ignored-file, hidden-file, symlink, binary, and
  high-match behavior where each adapter supports it.
- Test cancellation, process failure, malformed streaming output, missing
  `rg`, stale results, source refresh, deleted files, and result truncation.
- Compare ripgrep output with the normalized result model for paths containing
  spaces and non-ASCII characters without invoking a shell.
- Confirm unsaved worktree edits are searched from Monaco/session sources and
  are neither omitted nor replaced from stale disk content.
- Confirm Git-history results distinguish commits, blobs, and patch matches.
- Confirm tour results distinguish prose, real revisions, and synthetic
  explanation stages and preserve Return to Tour behavior.
- Use local fixtures created for the open-source repository; do not incorporate
  proprietary repositories or source content into tests, examples, snapshots,
  benchmarks committed to the project, or release artifacts.

## Acceptance criteria

- The user always knows which scope a query searched and why each result is
  associated with a particular file, panel, revision, commit, or tour scene.
- `Cmd/Ctrl+F` remains a fast active-pane operation even after broader search
  ships.
- Large searches stream, cancel promptly, respect limits, and disclose
  truncation or skipped sources.
- Filesystem search uses ripgrep only through a safe structured host boundary,
  with explicit availability and distribution behavior.
- Search never sends source or query content off the machine.
- Replacement is enabled only for writable sources and cannot mutate
  historical, committed, tour, or synthetic content.
