# Deconstructed diffs

## Status

Implemented on `main`; checked-in source examples and final authoring guidance remain.

## Goal

Allow a tour author to divide one real Git change into an ordered set of
virtual, cumulative stages that explain the change in a clearer conceptual
sequence. The final stage must reproduce the original target revision exactly;
the virtual stages do not rewrite Git history or claim to be commits.

The first release should be explicit and deterministic: authors assign changed
hunks to stages, stages only add portions of the original diff, and every
changed hunk belongs to exactly one stage unless intentionally excluded from
the tour.

## User-facing behavior

- A deconstructed scene clearly labels its sequence **Explanation stages** and
  displays the underlying base and target commits separately.
- Each stage has an ID, title, narration, and a set of hunk selectors. Moving
  forward cumulatively applies those hunks to the base snapshot.
- The comparison for a stage shows the prior virtual state on the left and the
  new cumulative state on the right, making that stage's contribution the
  active change.
- File navigation includes files introduced up to the current stage and files
  touched by the next stage. Renames and deletions retain clear source/target
  labels.
- Intermediate stages are not required to compile. The UI describes them as
  explanatory views and never exposes commit hashes for virtual states.
- The final stage is verified byte-for-byte against the target for every
  included textual file. A mismatch is an authoring error, not a warning.

## Source model

Add a tour scene kind equivalent to `deconstructed-diff`:

```yaml
- id: build-feature
  kind: deconstructed-diff
  title: Build the feature in conceptual order
  base: main
  target: feature
  stages:
    - id: model
      title: Introduce the data model
      narration: Start with the contract used by later behavior.
      changes:
        - file: src/model.ts
          hunks: [model-types]
    - id: behavior
      title: Add the behavior
      changes:
        - file: src/service.ts
          hunks: [execute-path, error-path]
```

Compilation assigns stable hunk IDs derived from path identity plus normalized
base/target context. Authors may use generated hunk IDs from an inspection
command; they should not hand-calculate line coordinates.

Initial constraints:

- textual patches only;
- each hunk is assigned to one stage;
- stages are cumulative and cannot remove a previously applied hunk;
- rename metadata is attached to the stage containing the rename;
- overlapping Git hunks that cannot be applied independently form one atomic
  assignment unit; and
- excluded hunks require an explicit path/hunk selector and rationale.

## Proposed architecture

### 1. Build an atomic change inventory

Resolve base and target commits, enumerate changed paths with rename metadata,
and parse a zero-context or minimal-context patch into atomic change units.
Where neighboring edits share context or patch application order, merge them
into one indivisible unit.

Each unit records stable identity, old/new paths, base and target ranges,
context hashes, binary status, and dependency information. Provide an
inspection output that authors can copy into a tour source.

### 2. Validate stage assignments

Validate unique stage IDs, known hunk IDs, single ownership, dependency order,
rename order, and explicit exclusions. Reject binary units in the first
release with a clear instruction to exclude them or use an ordinary scene.

Before producing a tour, apply all stages in order to clean base blobs and
verify that the final included state equals the target. Report the first file
and unit that cannot apply, with context for repairing a stale source.

### 3. Materialize virtual states safely

Represent virtual states as in-memory file maps or bounded compiled blobs, not
temporary Git commits. Apply units with a deterministic patch engine that
operates against exact base content and validates context hashes.

Cache cumulative states per stage during compilation so navigation does not
reapply every prior unit. Obey the existing tour context size limits and emit
only the files needed by the scene.

### 4. Present stages through existing diff scenes

Normalize each stage to the existing two-way or multi-file tour comparison
payload. Add stage rail metadata and a prominent virtual-stage label, while
reusing diff rendering, evidence focus, file navigation, and narrative text.

Do not make virtual stages appear in Git history controls. The real base and
target remain available in scene metadata and diagnostics.

## Scope and non-goals

Included:

- One base/target Git range, textual change units, cumulative explicit stages,
  exclusions with rationale, deterministic materialization, and final-state
  verification.
- File additions, deletions, and renames when their patches can be isolated.
- An inspection/generation command that produces initial hunk selectors.

Not included:

- Creating, amending, rebasing, or pushing Git commits.
- Automatically inventing the explanatory narrative or final stage order.
- Non-cumulative stages, revisions that undo earlier virtual work, arbitrary
  edits not present in the real diff, or executable intermediate snapshots.
- Binary patches, submodules, file-mode-only changes, or conflict resolution
  in the first release.

## Risks and decisions

- **Patch independence:** Some changes cannot be cleanly separated. Treat
  coupled hunks as one unit instead of manufacturing fragile ordering.
- **Stable identity:** Raw line numbers drift. Use path and normalized context
  hashes, then fail explicitly when the source no longer matches.
- **Misrepresenting history:** Label stages as explanatory and keep real Git
  identities visible in separate metadata.
- **Incomplete final state:** Require complete assignment or explicit
  exclusions, and verify the reconstructed target before presentation.
- **Scale:** Bound files, units, stages, and compiled content using existing
  context limits.

## Research findings

Initial code and Git-format research found that the existing
`src/changeInventory.ts` is useful groundwork, but it is not yet a safe
materialization format:

- It records ranges and hashes but not the exact old/new hunk bodies required
  to construct a virtual state.
- It uses three lines of unified context, which can fuse nearby independent
  edits. The deconstruction inventory should request zero context and zero
  inter-hunk context with an explicit diff algorithm so repository or user Git
  configuration cannot change unit boundaries. Adjacent changed lines that
  Git still emits as one hunk remain one atomic unit.
- Its Git-output helper trims trailing whitespace. Materialization must retain
  raw blob and patch bytes so whitespace-only changes and missing final
  newlines remain exact.
- Text-converted diffs are unsuitable because a textconv driver can be
  one-way. The inventory must use real blob content, disable external diff
  behavior, and reject content that cannot make a lossless round trip under
  the first-release text constraints.

Do not implement cumulative stages by repeatedly applying edited patch text.
Every unit is derived from the same base/target pair, so a safer model is to
materialize each cumulative state directly from the base blob: walk atomic
units in base order, copy unchanged base spans, and substitute the selected
unit's exact target span. This avoids line-offset drift and makes textual units
order-independent. Structural operations such as rename timing still need
explicit dependency rules.

Use a whitespace-sensitive unit ID derived from old/new path identity, exact
changed bytes, and bounded unchanged anchors, while excluding raw line
numbers. Git's patch-ID design is a useful precedent for ignoring coordinates,
but its whitespace-insensitive form is not appropriate for author-facing hunk
selectors. If two units remain indistinguishable after anchoring, report an
ambiguity instead of silently assigning an unstable occurrence suffix.

Model additions, deletions, and path transitions explicitly:

- an added file appears when its first assigned content unit is introduced;
- a deleted file disappears when its final content unit is introduced; and
- a rename or rename-plus-edit receives a structural path-transition unit with
  dependencies on any text units that must occur before or after it.

The compiled presentation can reuse the existing multi-panel diff renderer,
file navigation, and pair construction from `stacked-diff`. It should not reuse
the current Git-shaped panel contract unchanged: stacked panels require refs
and OIDs. Add an explicit real-versus-virtual panel discriminator, make OIDs
unavailable for virtual panels, and label the rail **Explanation stages** so a
virtual state cannot look like a commit.

The smallest implementation slice is therefore inventory v2 plus a pure blob
materializer, before schema or UI work. It should prove independent hunks,
adjacent atomic hunks, additions, deletions, final-newline preservation,
whitespace-only edits, and exact final reconstruction. Once that layer is
stable, stage assignment validation can build on it without coupling parsing
to presentation.

## Delivery sequence

1. Implement and test change-unit inventory and stable hunk IDs.
2. Add deconstruction schema, parser, assignment validation, and inspection
   output.
3. Implement cumulative patch application and final-state verification.
4. Compile virtual states into existing tour diff payloads.
5. Add stage navigation, labels, diagnostics, and representative fixtures.

## Validation

- Test independent and coupled hunks, additions, deletions, rename-plus-edit,
  stale selectors, duplicate assignment, missing assignment, invalid order,
  and exclusions.
- Property-test that applying all accepted units reconstructs target blobs.
- Confirm virtual materialization never writes repository refs or worktree
  files.
- Verify stage and file navigation, evidence focus, and real-versus-virtual
  labels in standalone and browser presentation.
- Run compile, lint, full tests, tour validation, and reproducibility checks.

## Acceptance criteria

- An author can inventory a real change and assign its textual change units to
  ordered explanatory stages.
- Each stage renders the exact incremental contribution between two cumulative
  virtual states.
- The final included state is verified against the real target before the tour
  can compile.
- Coupled or stale hunks fail with actionable diagnostics rather than yielding
  a misleading intermediate state.
- The UI never presents a virtual stage as an actual Git commit.
- No deconstruction operation mutates Git history or the working tree.
