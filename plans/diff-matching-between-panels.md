# Diff matching between panels

## Status

Implemented on `main`; retain the corpus and benchmark gates for future matcher changes.

## Goal

Make changed lines pair with the lines a reader would recognize as their
counterparts, especially inside uneven replacement hunks. Better matching
should improve inline highlights, connector shapes, synchronized scrolling,
change navigation, and copy-across behavior without changing file content or
turning the first release into a language-aware diff engine.

The first release should improve matching for every adjacent pair and verify
the result in three-or-more-panel scenarios. It should not yet introduce a
full N-way alignment model.

## Context

Bygone currently builds each adjacent comparison independently with
`buildTwoWayDiffModel`. Exact-line runs come from `diffArrays`; when a removed
run is followed by an added run, `alignReplacementLines` uses dynamic
programming to choose monotonic line pairs.

That replacement matcher has four important limitations:

- similarity is only the character-level common-subsequence ratio;
- every gap is free, while every match above a fixed `0.45` threshold adds a
  positive score;
- ambiguous structural lines, repeated boilerplate, indentation, and length
  differences receive no special treatment; and
- a replacement larger than 10,000 candidate cells falls back to pairing
  lines by position.

The chosen pairs feed inline word highlights and row-based scroll maps.
Diff-block ranges then drive decorations, navigation, connectors, and
copy-across operations. A poor pairing is therefore not merely cosmetic: it
can suggest the wrong relationship and make an active change land at an
unexpected vertical position.

Multi-panel views compound the problem because each adjacent boundary is
computed separately. The same middle-panel line can participate in plausible
but contradictory matches on its left and right. Bygone's current UI and copy
model are still pair-local, so the first step should make those local matches
high-confidence and deterministic, then measure whether a shared N-way model
is necessary.

## Desired behavior

- Pair distinctive edited lines even when insertions or deletions shift their
  positions within the same replacement hunk.
- Leave a line unpaired when the evidence is weak or ambiguous. A truthful
  insertion and deletion is preferable to a confident-looking false match.
- Avoid matching blank lines, lone delimiters, and repeated boilerplate based
  mainly on punctuation or indentation.
- Preserve source order. Crossed matches are never allowed.
- Produce the same result on the host and in the diff worker.
- Remain deterministic across repeated runs and panel edits.
- Degrade predictably on large hunks without reverting to naive positional
  pairing.
- Preserve the existing `TwoWayDiffModel` contract unless measurements show
  that explicit correspondence metadata is needed.

## Proposed approach

### 1. Establish a matching corpus and observable quality bar

Before changing the algorithm, add table-driven fixtures that record the
expected row pairing for difficult replacement hunks. Include:

- an edited line surrounded by inserted and deleted lines;
- repeated declarations, calls, imports, comments, and closing delimiters;
- indentation-only and formatting-heavy changes;
- short lines whose character overlap is accidentally high;
- one old line splitting into two new lines and the reverse;
- reordered lines, which must remain unmatched when pairing would cross;
- long replacement hunks above the current 10,000-cell cutoff; and
- three-panel evolutions where the middle revision is compared on both sides.

Represent expected alignment as source-line index pairs plus unpaired indices.
This makes matching quality testable independently of rendered HTML while
retaining a small set of end-to-end `TwoWayDiffModel` assertions for inline
segments and block ranges.

Add a benchmark corpus with realistic source snippets and generated repeated
lines. Record candidate-cell count, elapsed time, and peak working-set proxy
for small, medium, and large hunks. Use this to set the final cutoff instead
of preserving `10_000` by assumption.

### 2. Extract a pure replacement-alignment seam

Move replacement alignment and line scoring behind a small pure API, for
example:

```text
alignReplacementLines(leftLines, rightLines, options) -> aligned rows
scoreLinePair(left, right) -> score plus evidence
```

Keep this code host-independent so the production engine, worker bundle, unit
tests, and benchmark use one implementation. Expose diagnostics only to tests
and benchmarks initially; do not enlarge webview messages for debugging data.

Define named options for candidate limits, confidence thresholds, and gap
costs. Production should use one checked-in default policy rather than host or
language-specific tuning.

### 3. Replace the single similarity ratio with conservative evidence

Use a syntax-agnostic composite score built from cheap, explainable signals:

- non-whitespace character similarity;
- token or word-with-punctuation similarity;
- shared meaningful prefix and suffix tokens;
- compatible leading indentation and terminal punctuation as weak signals;
- relative length as a penalty for implausible matches; and
- an information penalty for blank, delimiter-only, or very low-entropy
  lines.

Token and content overlap should dominate. Indentation, braces, commas, and
common keywords must not make a pair eligible by themselves.

Return both a numeric score and evidence flags so eligibility is explicit.
Require a minimum content signal before dynamic programming can choose a
match. Calibrate thresholds from the fixture corpus; do not special-case file
extensions or parse language syntax in this phase.

### 4. Make alignment confidence-aware

Retain monotonic dynamic programming, but change its objective and tie rules:

- assign a real gap cost so matching and leaving lines unpaired are comparable;
- reward only eligible pairs;
- penalize weak matches rather than merely excluding scores below one global
  ratio;
- prefer a gap when candidates are tied or when the best candidate lacks a
  sufficient margin over alternatives; and
- define deterministic tie-breaking explicitly.

The result should optimize alignment quality, not the number of barely
acceptable pairs. Keep one-to-one pairing for the first release. Line splits
and joins should appear as one paired line plus an insertion/deletion, or as
unpaired lines, rather than inventing a many-to-many row contract.

### 5. Replace positional fallback with bounded matching

For large replacement hunks, avoid allocating the full line-count product and
avoid pairing by array index. Use the fixture and benchmark results to choose
between these bounded strategies:

1. identify high-confidence unique anchors, partition the hunk around them,
   and run the normal matcher within each partition; then
2. apply a diagonal band or bounded candidate window to any still-large
   partition.

If a partition remains too ambiguous or expensive, emit its lines as
unpaired deletions and insertions. This is visually noisier but semantically
safer than false positional correspondence.

Abort checks are not required in the synchronous API initially, but the
algorithm must have explicit cell and candidate budgets so worker jobs cannot
grow quadratically without a bound.

### 6. Integrate without changing pair-local product semantics

Continue producing one `TwoWayDiffModel` per adjacent pair. Route all model
creation through the improved shared engine, including:

- VS Code and standalone host construction;
- renderer recomputation after edits;
- the web worker and its synchronous fallback;
- browser-host multi-file loading; and
- stacked and deconstructed tour panels.

Verify that row changes do not alter diff-block source ranges. Decorations,
change navigation, connector bounds, and copy-across should continue using
real source-line indices. Scroll maps may change because their placeholder
rows encode the improved correspondence; that is intended.

When an editable panel changes, recompute only its adjacent pairs as today.
Matching must not introduce state shared across pairs that makes distant
panels stale.

### 7. Evaluate cross-panel consistency after local matching lands

Add three-panel assertions that detect obvious contradictions, such as a
distinctive middle line matching unrelated lines on its two sides. Record a
small diagnostic metric in benchmarks: eligible middle lines with strong
matches on both sides, ambiguous matches, and unmatched lines.

Only introduce a shared multi-panel correspondence model in a follow-up if the
corpus still shows material pair-to-pair inconsistency. That follow-up would
need to define stable correspondence IDs, incremental recomputation after
edits, worker payload changes, and how copy/navigation select a boundary.
Those decisions are intentionally outside this implementation.

## Scope and non-goals

Included:

- line pairing inside replacement hunks;
- syntax-agnostic scoring, eligibility, confidence, and tie-breaking;
- bounded behavior for large hunks;
- shared host/worker behavior;
- pair-level and three-panel regression fixtures;
- performance benchmarks; and
- validation of inline highlights, scroll mapping, navigation, connectors,
  and copy-across behavior.

Not included initially:

- full N-way or multiple-sequence alignment;
- AST, parser, language-server, or file-extension-specific matching;
- moved-code detection outside the replacement hunk identified by the base
  line diff;
- many-to-many line split/join representation;
- changes to semantic diff colors or connector styling;
- user-configurable matching thresholds; or
- replacing the `diff` package's exact-line hunk detection.

## Delivery sequence

1. Add the alignment fixture harness, baseline cases, and benchmark command.
2. Extract the pure scorer and aligner without changing production behavior.
3. Implement composite eligibility and confidence-aware dynamic programming.
4. Add anchor partitioning and bounded large-hunk matching.
5. Wire the shared implementation through worker and synchronous paths.
6. Add three-panel, editing, scroll-map, connector-range, and copy-range
   regression tests.
7. Tune checked-in defaults against the corpus, document benchmark results,
   and decide whether N-way matching merits a separate plan.

## Validation

- Unit-test scoring, eligibility, gaps, ambiguity margins, and deterministic
  tie-breaking separately from the full diff model.
- Assert exact aligned index pairs for every fixture, including reversed input
  where the expected relation is symmetric.
- Assert source-line numbers and block ranges remain correct for insert,
  delete, replace, empty-file, and missing-trailing-newline cases.
- Verify only the changed panel's left and right adjacent models are rebuilt
  after an edit.
- Compare worker and synchronous results byte-for-byte for the same inputs.
- Exercise active-change navigation, synchronized scrolling, inline
  highlighting, connector drawing, and copy in two-, three-, and six-panel
  views.
- Benchmark common hunks and adversarial repeated-line hunks below, around,
  and above the bounded-alignment cutoff.
- Run compile, lint, full tests, bundle-size check, and standalone multi-panel
  smoke tests.

## Acceptance criteria

- All curated misalignment fixtures produce the expected monotonic line pairs
  and unpaired rows.
- Ambiguous or low-information lines remain unpaired unless meaningful content
  establishes correspondence.
- Large hunks never use naive positional pairing and stay within the checked-in
  candidate and memory budgets.
- Worker and synchronous paths return identical models.
- Improved row alignment does not change source content, block source ranges,
  dirty state, save behavior, or the range copied between adjacent panels.
- Three-panel fixtures show no known contradictory high-confidence matches.
- Existing two-way and multi-panel tests, smoke tests, lint, and bundle checks
  pass without host-specific matching branches.

## Follow-up decision gate

Plan a shared N-way correspondence model only if, after this work:

- curated multi-panel examples still contain misleading adjacent matches;
- pair-local recomputation causes visible correspondence instability while
  editing; or
- product behavior needs one logical change identity spanning more than one
  boundary.

If none of those conditions holds, keep adjacent matching as the simpler
authoritative model.
