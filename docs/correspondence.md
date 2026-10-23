# Try symbol correspondence evidence

This experimental integration connects externally produced symbol mappings to
Bygone's authoring context and presentation viewer. It does not run a matcher
or model automatically. RefactoringMiner and Java remain optional external
research tools; neither is a new Bygone runtime dependency.

## Import once for a specific comparison

Produce a normalized mapping report with the research adapter on
`research/move-tracking-slice0` (implementation `cb0edb6`,
`scripts/change-analysis/refactoring-mappings.md`). Reports may contain one
`analysis` or a `cases` array. Select a case explicitly when importing a batch:

```sh
bygone correspondence import mappings.json feature --base main \
  --case module-split --output /tmp/correspondence.json
```

The import resolves the selected review's merge-base/head to immutable commit
IDs. It checks every supplied document digest, symbol span and symbol digest
against those Git blobs, resolves endpoints uniquely, rejects conflicting or
ambiguous accepted continuations, and recomputes complete declaration diffs.
Producer-supplied quotations, line numbers, local diffs and equality flags are
not trusted. The artifact records analysis status, supplied document scope,
producer, unmatched counts, syntax exclusions and competing origins.

Only the selected producer case's supplied scope is checked. Source integrity
checks do not independently adjudicate the producer's symbol identities,
parsing, completeness or semantic claims. All mappings remain inferred and
behavior remains unassessed. Partial analysis suppresses engine-only mappings;
independent exact-declaration evidence can remain available. Extraction/inline
groups are counted as limitations but are not navigable in this slice.

## Use the same artifact in both places

```sh
bygone tour context feature --base main \
  --correspondence /tmp/correspondence.json --output /tmp/context.json
bygone present feature --base main --correspondence /tmp/correspondence.json
```

No authored `.bygone` file is required. In the viewer, select **Symbols**, filter
by name or path, and select a mapping to compare its complete old and new
source symbol slices, including edits within moved code. Variable slices can
exclude enclosing export/const/let syntax; inspect the complete file for that
context and for surrounding binding/import changes. The labels identify
both paths, source lines and revisions. Editor line numbers are relative to
the declaration slice. The **Files** rail still opens complete file diffs.
Symbols includes moved, renamed or edited declarations by default; enable
**Include unchanged local symbols** to see the remaining inferred mappings.
Open the limitations disclosure to inspect competing origins and scope limits.
The status always names the artifact's pinned base/head, even when exploring
other history comparisons. An uploaded tour does not inherit this evidence.

Both consumers revalidate the artifact against their selected comparison.
Advancing a branch does not silently reuse old evidence: a different head or
merge base requires a new import. Context's ordinary patches, counts and limits
are unchanged; correspondence is a separate optional field with its own
budgets (16 MiB artifact, 128 documents per side, 1 MiB per Git blob, 8 MiB total
source and 8 MiB total symbol text). Nested symbols overlap, so their diffs
must not be summed as coverage or subtracted from changed-line accounting.
For a declaration diff exceeding the comparison effort budget, its entire old
and new slices are retained as removal/addition rather than omitting content.

## Run this checkout's real example

After `npm run compile`, use the saved research report from its worktree:

```sh
node bin/bygone.js correspondence import \
  /path/to/bygone-move-research/scripts/change-analysis/results/refactoring-mappings-diagnostics-2026-10-22.json \
  726796b1fe --base '726796b1fe^' --case diagnostic-public-tour-details \
  --output /tmp/bygone-correspondence.json
BYGONE_FORCE_BUNDLED=1 node bin/bygone.js present 726796b1fe \
  --base '726796b1fe^' --correspondence /tmp/bygone-correspondence.json
```

Search for `validateChangeTourDetails`. The declaration comparison retains the
removed `validateAssessment(...)` call, removed context parameter and changed
allowed-key list. The artifact includes six moved functions and other inferred
continuations. `BYGONE_FORCE_BUNDLED=1` selects the newly built checkout instead
of an older installed desktop application.

`npm run test:correspondence` runs the source/CLI/server checks and an Electron
browser smoke using a portable fixture taken from that real module split.
This slice does not construct intermediate refactoring stages, hide raw edits,
add model annotations, or establish reviewer benefit.
