# Tour coverage and depth

## Status

Draft

## Goal

Give tour authors an evidence-based report showing which parts of a change the
tour discusses and how substantial that discussion is. Coverage and depth
must remain separate signals: coverage measures referenced change units, while
depth describes the explanatory intent an author explicitly assigns to each
step.

The first release should report coverage by changed hunk and file, support
documented exclusions, and use a small author-declared depth rubric. It should
guide authoring without turning one score into a quality gate.

## Definitions

### Coverage

The denominator is the set of textual changed hunks in the tour's resolved Git
range after exclusions. A hunk is covered when at least one valid tour step
references a line range that intersects that hunk on either side of the diff.

Report:

- covered and total hunk counts;
- a percentage derived from those counts;
- covered and total changed-line counts as secondary detail;
- per-file hunk coverage; and
- uncovered hunk identities and ranges.

Do not average file percentages, because a one-hunk file and a fifty-hunk file
should not have equal weight in the overall result.

### Depth

Depth is an explicit step annotation, not an inferred natural-language score:

- `mentioned`: identifies what changed;
- `explained`: describes behavior or implementation mechanics; and
- `contextualized`: explains rationale, dependencies, consequences, or
  tradeoffs.

A hunk's reported depth is the highest level among steps that cover it. The
report presents a distribution of covered hunks across levels, not a combined
percentage or pass/fail grade.

## Source model

Allow walkthrough steps with code evidence to declare `depth`, defaulting to
`mentioned` for backward compatibility. Add scene- or tour-level exclusions:

```yaml
coverage:
  exclusions:
    - path: package-lock.json
      reason: Generated lockfile update
    - path: src/generated.ts
      hunks: [generated-schema]
      reason: Generated from the reviewed schema
```

Every exclusion requires a reason. Whole-path exclusions cover all units for
that path; hunk exclusions use the same stable change-unit identity as the
report. Binary files, submodules, and file-mode-only changes are reported
separately as unsupported material and are not silently included in the
textual percentage.

## User-facing behavior

- Add a CLI command or option that builds a coverage report for a tour source
  without launching presentation mode.
- Print a concise terminal summary followed by per-file uncovered hunks. Offer
  deterministic JSON output for automation and future UI consumers.
- During tour validation, malformed depth values, unknown exclusions, missing
  reasons, and evidence outside the resolved change are errors.
- Coverage below any value is informational by default. An optional explicit
  `--minimum-coverage` flag may make a chosen threshold fail CI; the tour
  source itself should not impose a universal quality threshold initially.
- A later authoring UI may visualize the JSON report, but the first release
  should keep presentation mode free of reader-facing scores.

## Proposed architecture

### 1. Normalize the change inventory

Build a reusable inventory from the tour's resolved base/target range. Each
unit contains a stable hunk ID, path/rename identity, old and new ranges,
changed-line counts, and material type. Share this inventory with future
deconstructed-commit work rather than creating two incompatible hunk models.

### 2. Map evidence to change units

Normalize every code-focused tour step into path, side, and line intervals.
Intersect those intervals with inventory hunks. Track all covering steps per
hunk so overlapping narration is visible and depth can take the highest
declared level.

Evidence that points only to unchanged context remains useful narration but
does not cover a changed hunk. Report it separately as contextual evidence so
authors understand why it did not increase coverage.

### 3. Apply exclusions transparently

Resolve exclusions after inventory creation and before percentage
calculation. Reject selectors that match nothing, include every reason in JSON
and human output, and show both the original and adjusted denominator.

Provide built-in classification suggestions for lockfiles, generated paths,
vendored code, and binaries, but never exclude them automatically. The author
must accept an exclusion and record why.

### 4. Produce one versioned report model

Define a versioned report structure containing range identities, totals,
per-file results, depth distribution, exclusions, unsupported material,
uncovered hunks, and contextual-only evidence. Render terminal and JSON output
from that same model.

Keep calculation deterministic for a fixed tour source and resolved commits.
Include commit OIDs so reports from moved symbolic refs can be distinguished.

## Scope and non-goals

Included:

- Hunk- and changed-line-based textual coverage.
- Per-file detail, explicit exclusions, contextual-only evidence, an explicit
  three-level depth annotation, terminal output, and versioned JSON.
- Optional caller-chosen minimum coverage for CI.

Not included:

- AI grading of prose, inferred correctness, sentiment, reviewer quality, or a
  universal acceptable score.
- Reader-facing badges, rankings, gamification, or blocking tour publication
  by default.
- Semantic symbol coverage, runtime test coverage, binary-content coverage, or
  repository-wide documentation coverage.
- Automatically modifying a tour to improve its score.

## Risks and decisions

- **Gaming:** Separate factual intersection from declared depth and expose raw
  counts so a percentage cannot masquerade as tour quality.
- **False precision:** Hunk coverage is a useful proxy, not semantic
  completeness. State this in report output and avoid decimal-heavy scores.
- **Generated material:** Suggest classifications but require explicit,
  reasoned exclusions.
- **Moving refs:** Record resolved OIDs and ensure report generation uses the
  same range as tour context compilation.
- **Hunk drift:** Use stable normalized identities and actionable diagnostics
  when authored exclusions become stale.

## Delivery sequence

1. Extract a shared, stable change-unit inventory with hunk IDs and tests.
2. Add depth and exclusion schema fields with validation.
3. Implement evidence intersection, adjusted denominators, depth distribution,
   and contextual-only evidence.
4. Add versioned JSON and human-readable CLI reports.
5. Add optional caller-selected CI threshold and representative tour fixtures.

## Validation

- Test full, partial, overlapping, and zero coverage; left/right evidence;
  additions, deletions, renames, and unchanged-context evidence.
- Test whole-file and hunk exclusions, mandatory reasons, stale selectors,
  unsupported material, and adjusted totals.
- Test depth defaults, invalid levels, multiple depths on one hunk, and report
  distributions.
- Snapshot terminal and JSON reports and verify deterministic output for fixed
  OIDs.
- Compare reports for several existing tours with manual hunk review.
- Run compile, lint, full tests, tour reproducibility checks, and CLI smoke
  tests.

## Acceptance criteria

- An author can generate a deterministic coverage report for a tour and its
  exact resolved Git range.
- The report identifies every uncovered textual hunk and summarizes coverage
  overall and by file.
- Exclusions are explicit, reasoned, visible, and reflected in original and
  adjusted totals.
- Depth is reported as an author-declared distribution across covered hunks,
  never collapsed into a quality score.
- Evidence on unchanged context is preserved but does not falsely count as
  changed-hunk coverage.
- Existing tours remain valid with `mentioned` as the default depth.
