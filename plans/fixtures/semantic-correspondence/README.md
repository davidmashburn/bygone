# Semantic correspondence development controls

Research fixtures, checked 2026-10-22. These make the next
[cross-file experiment](../../semantic-correspondence-experiment.md)
reproducible without depending on an unpublished probe. They do not implement
a product feature or establish semantic equivalence.

## Reproduce

From a checkout with Bygone's installed development dependencies and the pinned
historical commits available:

```sh
node /Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/semantic-correspondence/check.cjs /Users/davmash/code/bygone > /tmp/bygone-semantic-controls.json
```

Both paths are local examples; the first argument is the development checkout
whose TypeScript dependency and Git objects to use. The checker reads pinned
commits, not worktree source. It writes JSON to stdout and exits nonzero on
incorrect inventory entries, source coordinates, exclusions, historical labels,
or false automatic links. Missed correspondences are reported, not treated as
successful detections. No package installation is performed.

`controls.json` contains complete authored file snapshots and independently
specified declaration strings, ranges, and allowed exact relationships.
`history.json` pins a public comparison and hand-checked declaration endpoints.
`check.cjs` checks the labels and runs a deliberately small exact baseline.
`observation-2026-10-22.json` captures this run, including input/checker hashes,
runtime versions, exclusions, and per-file content digests. A changed checker
or manifest requires a new observation; never reuse the old numbers silently.

## Observed result

Node v26.10.0 and TypeScript 4.9.5 on macOS arm64. All 22 expected supported
declarations across ten development controls have the labeled ranges and text.
The checker validates zero-based half-open UTF-16 and UTF-8 byte offsets, plus
one-based inclusive lines, including a surrogate pair, multibyte text, and CRLF.
Ranges exclude leading trivia; file snapshots still retain comments and context.

The baseline emits three of four labeled exact relationships, with no false
links in these controls. It misses `move-rename-format`: TypeScript's printer
retains the original block's single-line/multiline layout choice. Removing
comments and replacing a declaration name is insufficient to canonicalize
formatting. The miss remains in the saved observation; the matcher was not
tuned to eliminate it. These are development cases, not held-out accuracy data.

The operator-edit and helper-extraction controls have authored non-exact
relationships described in their review notes. The exact baseline leaves them
unmatched. They are not included in the four exact-relationship denominator,
and their abstentions say nothing about edited/extraction recall. Path and name
alone do not cause a same-name body replacement to be treated as unchanged.

Retained copies and competing origins produce ambiguous groups. Matching a
retained occurrence locally does not remove it from the global uniqueness
check. A byte-identical function under a changed free-variable binding does
produce an exact declaration link, explicitly marked **behavior unassessed**.
This is a positive correspondence and a counterexample to equivalence.

The parse-error, class, and anonymous-default control produces three explicit
exclusions. Supported inventory is deliberately limited to top-level named
functions with bodies and single-variable arrows. It does not enumerate all
symbols, object methods, registrations, overloads, or nested declarations.
Declaration comments and module context must remain independently reviewable;
printer equality does not authorize hiding them.

## Public historical labels

Comparison: `7bd04dbbb69d4bd2b8da0e0ef885071967676d37` →
`726796b1feebc3dfd7f396c83179753ef67ee119` in Bygone. The baseline inventories
317 before and 308 after supported declarations over 17 changed JS/TS paths.
These counts describe the supported subset within one comparison.

Three byte-identical, unique-in-scope declarations correspond from
`src/tourAssessment.ts` to `src/tourDetails.ts`:

- `validateAudience`: before lines 97–127; after lines 32–62.
- `requireString`: before lines 181–185; after lines 68–72.
- `requireStringArray`: before lines 187–191; after lines 74–78.

The checker verifies each endpoint against its pinned text and digest. These
three declarations were inspected in their surrounding modules; the labels
establish correspondence, not unchanged program behavior. In particular,
`validateAudience` calls module-local helpers, and its callers also changed.

Other identical helpers retain competing origins: `isRecord` has four before
and three after occurrences in the declared scope; `requireOnlyKeys` has two
on each side. The fixture checks those full competing endpoint sets. Neither
group permits a unique origin claim. Unchanged files are outside this search.

This commit was selected because the earlier notes already reported its three
matches. It is a reproduction target, not an independently sampled historical
test. The earlier report of six unresolved destinations across 60 comparisons
cannot be reconstructed from these groups and is not claimed as reproduced.

## Next evidence

Freeze independently sampled historical comparisons and difficult mixed cases
before tuning. Reserve the planned held-out partition separately; none of these
ten controls or this selected historical example belongs to it. Add expectations
for edited relationships and extraction groups separately from exact pairs.
The [engine smoke](engine/README.md) verifies multi-file execution and records
the MCP mapping limitation and identical-file pruning. Check Java mapping export
and range fidelity against the now-implemented
[research adapter](../../semantic-correspondence-experiment.md#mapping-adapter-implemented-2026-10-22)
before extending the accuracy and runtime benchmark.
No broad engine accuracy, Python support,
latency, memory, renderer behavior, or reviewer benefit was measured here.
