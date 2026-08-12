# Product surface overview

This is the internal map of Bygone's user-facing product. Update it whenever a
command, launch form, comparison mode, tour scene, or release artifact is added
or materially changed.

## Product boundaries

- **Explore — desktop:** open-ended file, directory, history, revision,
  multi-panel, and branch-change investigation.
- **Present — desktop/browser:** generated and authored tours with narrative,
  exact source evidence, and an independent changed-files rail.
- **VS Code companion:** contextual file comparison and file history near the
  current editor. Repository-, directory-, multi-panel-, and tour-scale work
  should hand off to desktop.
- **CLI and agent tools:** launch automation plus tour context, authoring,
  validation, compilation, schema, and coverage.
- **Development only:** fixtures, smoke/capture modes, generated screenshots,
  and developer tools. These must not appear in production menus or packages.

The shared Monaco renderer supplies diff semantics and presentation. Sharing a
renderer does not make every workflow appropriate in every host.

## Standalone Explore

| User question | Discovery and launch | Session/source | Mutability and lifecycle | Maturity | Verification |
| --- | --- | --- | --- | --- | --- |
| Start without source material | CLI `bygone` outside Git; blank startup | Blank multi-diff | Writable untitled panels; normal undo and dirty state | Core | `testBlankMultiDiffStartsWithTwoEditablePanels` |
| Compare files | File → Compare Files; drag/drop; `bygone left right`; `--diff` | Files, two-way or multi-diff | Files are writable; save, reload, refresh, and external-change policy apply | Core | standalone smoke and multi-diff tests |
| Compare directories | File → Compare Directories; drag/drop; two or more directory arguments | Directory comparison | Directory rows are read-only; writable file drill-down depends on source/review state | Core | directory smoke and directory-diff tests |
| Follow one file or directory through Git | Git → View File or Directory History; one path; `--history` | Git commits plus supported index/worktree states | Commits are read-only; worktree/index provenance is explicit | Core | Git history and directory-history tests |
| Compare named revisions | `bygone --git-diff <refs…>` | Git blobs/revisions | Read-only snapshots | Secondary; CLI discovery needs improvement | Git comparison tests |
| Explore the current branch change | Git → Explore Current Branch Change; `bygone review` | Merge-base-to-tip branch inventory | Read-only review snapshots; dirty state is reported, not silently included | Core | branch comparison and review-path tests |
| Search comparison code | Edit → Find or Search Comparison | Active, visible, or all loaded comparison-panel Monaco models | Find is read-only; Replace requires the active writable model | Core | find and comparison-search tests |
| Move through a multi-panel comparison | Strip buttons, panel headers, gutters, wheel, or `Alt+Arrow` | Active panel and adjacent pair | Does not change source identity | Core | focused-strip controller and standalone smoke tests |

The File menu owns sources and persistence; Edit owns focused text operations;
Git owns historical/revision questions; Present changes product area; Navigate
owns movement within the current session; View owns display preferences; Window
owns native window lifecycle. Developer fixtures appear only when Electron is
not packaged.

## Standalone Present and browser presenter

| User question | Discovery and launch | Identity/provenance | Mutability | Maturity | Verification |
| --- | --- | --- | --- | --- | --- |
| Explain the current branch automatically | Present → Present Current Branch; `bygone present` | Committed merge-base-to-tip range | Read-only | Core | presentation launch and generated-tour tests |
| Open an authored walkthrough | Present → Open Authored Tour; `bygone present --tour`; VS Code hand-off | Manifest range, scene, step, exact source anchor | Read-only | Core | reproducible example and tour validation tests |
| Explain a real stack | `stacked-diff` scene | Exact real Git revisions per panel | Read-only | Advanced | `examples/stacked-diff.bygone.yaml` |
| Explain a change in conceptual stages | `deconstructed-diff` scene | Explicitly labeled synthetic explanation stages backed by exact hunk IDs | Read-only | Advanced/experimental authoring | `examples/deconstructed-diff.bygone.yaml` |
| Browse away from the narration | Files rail, change navigation | Browsed file versus active tour focus remain distinct | Read-only; Return to Tour restores narrative focus | Core | tour focus and persistent-anchor tests |

Tour authoring remains file/CLI/agent driven. The desktop UI opens and presents
tours but does not attempt to duplicate schema-aware authoring forms.

## VS Code companion

| Command | Intended ownership | Current state | Editing contract | Follow-up |
| --- | --- | --- | --- | --- |
| Compare Files / Compare With Selected | VS Code contextual comparison | Implemented in shared Activity Bar host | Treat cautiously until VS Code documents own writable state | Move to an editor-area tab in the deferred host project |
| Compare File History / Active File History | VS Code contextual history | Implemented | Historical content is read-only | Retain in the eventual editor-area lifecycle |
| Explore Current Branch in Desktop | Desktop hand-off | Implemented for local configured executable | No source content crosses the boundary | Add trust, remote, multi-root, and versioned-intent checks |
| Present Current Branch in Desktop | Desktop hand-off | Implemented | Read-only presentation | Same launch-contract hardening |
| Open Authored Tour in Desktop | Desktop hand-off | Implemented | Read-only presentation | Same launch-contract hardening |
| Compare Directories / Three or More Files in Desktop | Desktop hand-off | Implemented with local multi-selection | Desktop owns the comparison and writable lifecycle | Keep contextual visibility narrow |
| Legacy in-extension directory, N-panel, and branch-review commands | Desktop-owned | Removed from production contributions | Parallel extension state is not the target product | Internal compatibility code can be removed with the deferred host rewrite |
| Open Standalone App Downloads | Setup fallback | Implemented | Not applicable | Prefer installed-app detection and actionable missing-app guidance |

The production extension does not contribute test fixtures. The VSIX is checked
against an explicit runtime-file allowlist. VS Code repository search should use
VS Code's native Search rather than another bundled ripgrep process.

## CLI and authoring tools

| Surface | Purpose | Mutability/maturity |
| --- | --- | --- |
| `bygone`, paths, `--diff`, `--history`, `--git-diff`, `review` | Launch Explore sessions | Core launcher; desktop owns writes |
| `present` and `present --tour` | Launch Present sessions | Core, read-only presentation |
| `tour context` | Produce a bounded provider-neutral change dossier | Authoring support, read-only |
| `tour validate`, `compile`, `schema`, and coverage options | Validate exact evidence and build portable manifests | Advanced authoring, read-only except explicit output files |
| `completion` | Generate shell completions from the shared command specification | Supporting tooling |

## Provenance and mutability vocabulary

Use these labels consistently:

- **Writable file:** filesystem/worktree content participating in dirty, undo,
  save, reload, watcher, and refresh behavior.
- **Read-only snapshot:** committed Git, history, tour, or supplied content that
  cannot be replaced or saved over a source file.
- **INDEX** and **WORKTREE:** repository work states; do not describe them as
  commits.
- **Explanation stage:** synthetic deconstructed content; never imply that it
  is a real commit.
- **Real revision:** a panel resolved from an exact Git object identity.

Paths and labels are descriptive; object IDs, source descriptors, and compiled
tour locators are authoritative identities.

## Artifacts and production boundary

| Artifact | Intended contents | Exclusions/check |
| --- | --- | --- |
| VSIX | Extension manifest, extension bundle, shared renderer assets/workers, public docs and icon | `scripts/check-vsix-contents.mjs` rejects unexpected files |
| Desktop packages | Electron host, shared renderer, presenter, runtime assets | Production menus hide fixtures and DevTools |
| npm CLI package | Launcher, CLI/tour runtime, required desktop support | Dry-run package-content validation |
| Compiled tour | Bounded manifest plus exact referenced source evidence | Validation, reproducibility, and coverage checks |

Only open-source Bygone fixtures may be committed to tests, examples,
benchmarks, screenshots, tours, or release artifacts. Do not derive fixtures
from proprietary repositories even if names and paths are removed.

## Update checklist

When changing the product surface:

1. Add or revise the applicable row above.
2. State the owning host, source identity, mutability, and lifecycle behavior.
3. Link a representative automated test or checked-in example.
4. Update command help, menus, package contributions, and user docs together.
5. Verify production packages contain no development or proprietary material.
