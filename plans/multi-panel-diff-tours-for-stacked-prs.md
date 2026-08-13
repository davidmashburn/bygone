# Multi-panel diff tours for stacked PRs

## Status

Implemented on `main`, with checked-in open-source examples and authoring
guidance distinguishing real revision panels from synthetic explanation
stages.

## Goal

Let a Bygone tour explain a local stack of related branches or commits as an
ordered multi-panel comparison. Readers should be able to see what each layer
adds, follow one concept across the stack, and understand the final cumulative
result without mentally reconciling several independent reviews.

The first release should support a base plus two or more locally resolvable Git
revisions. It should use adjacent revision panels, explicit tour steps, and
the existing multi-panel renderer. Remote PR discovery and network refresh are
outside the initial scope.

## User-facing behavior

- A tour source declares an ordered stack: base, layer one, layer two, and so
  on. Each entry has a stable ID, a Git ref, and an optional display label.
- The tour materializes one complete revision per panel. Adjacent panel pairs
  show the incremental diff for that layer; the first and last panels also
  make the cumulative outcome visible.
- A walkthrough step selects a file, an active panel or adjacent pair, and an
  optional evidence range. The selected panel and pair receive the existing
  active styling and connector behavior.
- File navigation uses the ordered union of files changed anywhere in the
  stack. Missing files appear as empty, non-editable panels with clear labels.
- Steps may focus the same conceptual code as it evolves through several
  layers, but each step has one authoritative active pair.
- If a ref cannot resolve or the declared order is inconsistent, tour loading
  fails with a source-specific error before replacing the current scene.

## Source model

Add a tour scene kind equivalent to `stacked-diff`:

```yaml
- id: review-stack
  kind: stacked-diff
  title: Build the event pipeline
  stack:
    - id: base
      ref: main
      label: Main
    - id: model
      ref: feature/model
      label: Data model
    - id: behavior
      ref: feature/behavior
      label: Behavior
  files:
    - src/event.ts
    - src/pipeline.ts
  steps:
    - id: introduce-model
      file: src/event.ts
      pair: [base, model]
      side: right
      lines: [8, 30]
      narration: Introduce the event contract first.
```

Require at least three stack entries so ordinary two-revision scenes remain
the simpler representation. Stack IDs and step IDs must be unique. A `pair`
must reference adjacent entries in declared order. Initially, paths are
repository-relative and evidence ranges refer to the selected revision's
materialized file.

Store symbolic refs in the authored source but include resolved OIDs in the
compiled tour context for reproducibility and diagnostics. Opening a source
tour resolves current refs; opening a compiled portable tour uses its pinned
evidence unless explicitly rebuilt.

## Proposed architecture

### 1. Parse and validate the stack

Extend tour parsing and schema validation with the scene, stack entries, and
step targeting fields. Resolve every ref within one repository and verify
adjacency. Produce precise errors for duplicate IDs, missing refs, invalid
pairs, paths outside the repository, and evidence ranges outside the model.

### 2. Build a shared stack context

Introduce a stack-context builder that:

1. resolves symbolic refs to commits;
2. computes the union of paths changed across adjacent pairs;
3. records rename endpoints per pair;
4. reads requested file blobs at every revision;
5. represents missing files explicitly; and
6. computes adjacent diff models using the existing diff engine.

Do not create one independent tour scene per pair. Return one normalized scene
payload with panels, adjacent pairs, file navigation, resolved OIDs, and step
targets so the renderer can reuse its multi-panel path.

Bound compiled context size using the existing tour evidence limits. Include
only declared files or the files referenced by steps when a tour does not opt
into the complete changed-path union.

### 3. Reuse multi-panel rendering and tour navigation

Adapt the current multi-panel payload to accept read-only Git panels and tour
annotations. The tour host should select the requested file, active panel,
pair, change, and evidence range before reporting the scene ready.

Preserve horizontal panel order. File navigation must retain the active stack
layer where possible. Existing synchronized scrolling and connector logic
remain pair-oriented; only the active adjacent pair needs emphasized
connectors at a time.

### 4. Keep GitHub and mutable stack state separate

The first release resolves local refs only. It does not infer a stack from PR
metadata, fetch remotes, or follow force-pushes automatically. Rebuilding the
tour source intentionally re-resolves symbolic refs and reports changed OIDs.

## Scope and non-goals

Included:

- Local Git stacks with a base and at least two ordered layers.
- Full-revision panels, adjacent diff pairs, explicit files, rename-aware
  missing states, and step-level focus.
- Authoring validation, compiled tour context, browser presentation, and
  standalone presentation through existing tour flows.

Not included:

- GitHub/GitLab PR discovery, authentication, comments, review state, or
  network fetching.
- Arbitrary non-adjacent comparisons, branching stack graphs, merge queues, or
  automatic stack-order inference.
- Editing stack panels or rewriting commits.
- Showing an unlimited number of panels; warn above four and reject above six
  in the initial UI.

## Risks and decisions

- **Density:** Many panels become unreadable. Establish a hard initial limit
  and rely on file- and step-focused navigation.
- **Rebases:** Authored refs are mutable. Surface resolved OIDs and make rebuild
  changes explicit rather than pretending a compiled tour is live.
- **Renames across layers:** Track rename identity per adjacent pair; do not
  assume one path exists unchanged through the whole stack.
- **Context size:** Blob content grows by files times revisions. Apply limits
  during compilation and provide an actionable size error.
- **Concept continuity:** The system cannot infer narrative relationships.
  Authors explicitly choose files, pairs, ranges, and narration.

## Delivery sequence

1. Add schema, parsing, validation, and fixtures for `stacked-diff` scenes.
2. Implement Git stack resolution, changed-path union, rename mapping, and
   bounded context compilation.
3. Adapt multi-panel scene payloads and file navigation for read-only stacks.
4. Add step focus across file, panel, pair, change, and evidence range.
5. Add authoring diagnostics and end-to-end example tours.

## Validation

- Test valid and invalid stack schemas, mutable refs, missing refs, duplicate
  IDs, invalid pairs, file addition/deletion, and rename chains.
- Build a three-revision fixture and assert every adjacent diff and cumulative
  file union.
- Verify step navigation preserves panel order and selects the declared file,
  pair, side, and range.
- Test context-size limits and portable compiled-tour reproducibility.
- Manually review a real three-PR local stack in standalone and browser hosts.
- Run compile, lint, full tests, tour validation, and presentation smoke tests.

## Acceptance criteria

- An author can declare a local base plus at least two stack layers in one tour
  scene.
- The reader sees ordered revision panels and correct adjacent incremental
  diffs for every declared file.
- Tour steps can focus an exact file and adjacent pair without reordering the
  stack.
- Added, deleted, and renamed files are represented accurately at each layer.
- Invalid or unavailable refs fail before a partial scene replaces the current
  view.
- Compiled tours identify resolved OIDs and obey existing portability and size
  limits.
