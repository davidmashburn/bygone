# `.bygone` document format and native opening

## Status

Active

## Goal

Make `.bygone` the canonical filename extension for authored Bygone
presentations without changing the version 1 YAML schema, breaking existing
`.bygone.yaml` sources, or confusing Git-backed sources with portable compiled
tour manifests.

The rollout should also make direct desktop opening reliable where packaging
supports it. A file association is useful only when Bygone can locate the Git
repository needed to resolve the document's refs and anchors.

## Format contract

| Artifact | Role | Portability |
| --- | --- | --- |
| `review.bygone` | Canonical authored UTF-8, single-document YAML source | Requires the corresponding local Git repository and referenced objects |
| `review.bygone.yaml` | Permanently supported explicit-YAML alias | Same repository dependency as `.bygone` |
| `review.tour.json` | Compiled manifest containing resolved snapshots | Portable, subject to the sensitivity of embedded source |

The authored source keeps `version: 1`. A filename change does not alter the
data contract, and an explicitly supplied source with another extension should
continue to validate when its contents are valid.

Do not add a wrapper, archive, binary header, custom YAML tag, or repository
path field in this rollout. The top-level version identifies the format.

## Product rules

- Prefer `.bygone` in new documentation, examples, dialogs, help, and shell
  completions.
- Continue accepting and advertising `.bygone.yaml` as a compatibility escape
  hatch for editors that infer YAML support from the final suffix.
- Associate `.bygone` with YAML syntax in the VS Code extension without making
  a custom editor the default or claiming all YAML files.
- Treat authored sources as untrusted input. Loading must be bounded and errors
  must distinguish file access, YAML syntax, and source-schema failures.
- Never clone, fetch, check out, execute hooks, or otherwise mutate a repository
  while opening a document.
- Use only open-source Bygone fixtures and synthetic temporary repositories in
  tests.

## Native-opening contract

Classify `*.bygone` and `*.bygone.yaml` before the desktop's ordinary
single-file history route:

```text
document path
  -> canonicalize the real file location
  -> discover its enclosing Git worktree
  -> safely load and validate the source
  -> compile using that repository
  -> open a dedicated tour window
```

Repository discovery walks upward from the document's real parent directory.
The process working directory is not a valid fallback for Finder, Explorer, or
desktop-environment launches. If no enclosing worktree exists, fail with a
specific explanation that the authored source needs its repository.

Initial behavior should reject mixed presentation/ordinary path drops and
multiple presentation files with clear messages. One presentation maps to one
tour window and its own local server; closing that window closes that server.
The same classifier must cover initial argv, a packaged app's second-instance
argv, macOS `open-file`, drag-and-drop, and Open Authored Tour dialogs.

Filename classification should follow host filesystem expectations: compare
case-insensitively on Windows and macOS and case-sensitively on Linux, while
preserving the actual path.

## Implementation order

### 1. Safe source-loader boundary

- Centralize authored-source loading behind a small function rather than
  duplicating `readFileSync` plus `js-yaml` calls.
- Bound source bytes before parsing, reject NUL/non-text input, require UTF-8,
  accept a UTF-8 BOM consistently, and reject multiple YAML documents.
- Preserve the parser's strict unknown-field and cross-reference validation.
- Include the source filename and useful YAML location detail in diagnostics.
- Add boundary tests for the size limit, malformed YAML, duplicate keys,
  multiple documents, BOM, NUL, aliases/merge behavior, and schema errors.

### 2. Canonical alias and editor/tooling support

- Prefer `.bygone` in CLI usage, command specs, generated completions,
  documentation, examples, tours, and the PR tour-authoring skill.
- Keep completion filters and open dialogs compatible with `.bygone.yaml`.
- Contribute a narrow VS Code language association so `.bygone` opens as YAML.
- Keep `version: 1` and verify both filename spellings plus arbitrary explicit
  paths through CLI tests.
- Rename checked-in examples and tours in a dedicated commit, updating links
  atomically so repository references remain valid.

### 3. Repository discovery and document classification

- Add pure, testable helpers for authored-source filename detection and
  enclosing-worktree discovery.
- Resolve symlinks before discovery and require the selected file to be a
  regular file.
- Return explicit outcomes for authored source, ordinary path, mixed input,
  multiple authored sources, missing repository, and missing Git objects.
- Do not add a repository chooser or persistent path mapping yet.

### 4. Desktop routing and macOS association

- Route initial, second-instance, `open-file`, dropped-file, and dialog inputs
  through the shared classification path.
- Register `.bygone` as a Viewer document type in the macOS package.
- Preserve the existing multi-window tour lifecycle and focus the newly opened
  tour rather than the Explore window.
- Add launch-routing and lifecycle tests plus a packaged-app metadata check.

### 5. Follow-up platform associations

- Decide separately whether Windows per-machine NSIS installation is an
  acceptable requirement before registering the extension there.
- Add Linux MIME/desktop metadata only with package-level verification;
  AppImage desktop integration is environment-dependent.
- Consider a repository chooser only after there is evidence that sources
  commonly live outside their repositories.

## Verification

- Typecheck, lint, and full unit/integration suite.
- Validate every checked-in `.bygone` and legacy `.bygone.yaml` source.
- Compile at least one canonical source and parse the resulting portable
  manifest.
- Exercise direct opening from a nested repository directory and failure from
  outside a repository.
- Verify initial launch, second instance, macOS open-file, drag/drop, multiple
  tour windows, and server cleanup with open-source fixtures.
- Inspect the packaged macOS application's document-type metadata before
  considering double-click support complete.

## Compatibility and deferred choices

- Old `.bygone.yaml` links, scripts, and repositories remain supported.
- Generic editors may still prefer `.bygone.yaml`; the branded extension does
  not guarantee schema-aware editing outside integrations Bygone controls.
- Shallow or partial clones can still fail when pinned commits or blobs are
  unavailable. Opening does not fetch them automatically.
- `sourceUrl` remains informational and must not be used to find or clone a
  repository.
- Compiled manifests contain source snapshots and may disclose private code;
  portability is not the same as safe publication.

