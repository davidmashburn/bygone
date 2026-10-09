# Inline highlighting investigation — 2026-10-09

This directory preserves the investigation code, data, generated engines, logs,
and interactive report from `/tmp/bygone-inline-study-20261009`. The original
files are unchanged; `SHA256SUMS` records their archival checksums.

Open [report.html](report.html) directly in a browser to explore the comparisons.

## Provenance

- Examined commit: `c08545c9976f53c5d8632ddbaf0645fde3ba41cb`
  (`feat(compare): simplify revision selection controls`).
- Recorded experiment time: `2026-10-09T19:18:15.204Z`.
- Recorded environment: Node `v26.10.0`, `diff` `5.2.2`.
- `source-snapshot.ts` is byte-identical to `src/diffEngine.ts` at that commit;
  its SHA-256 is
  `161aea6b5a72b48e3b9c221ff3874a19f0ef1b8c60ea275a74665f3f8f39a361`.
- The research branch starts at that commit, not at the later implementation.

## Decision after the investigation

The report retains its original recommendation, which included identifier-part
matching. Subsequent discussion selected the simpler **word diff plus edge
trimming** approach: within each replacement, preserve matching prefix and
suffix text and highlight the remaining contiguous middle. This handles prefix,
suffix, and middle edits; it does not search for matching islands inside that
middle. For example, `userStatisticalCount` → `userMetricsCount` preserves
`user` and `Count` and highlights `Statistical` / `Metrics`.

The subsequent implementation also preserves grapheme boundaries and gives an
intact shorter word precedence for a pure prefix or suffix addition (for example,
`Name` → `[New]Name`). The original `affixes` prototype lacks these later
refinements. Its results therefore do not directly describe the final
implementation. This branch archives the investigation, not the implementation.

## Contents and scope

- `candidates.cjs`, `fixtures.cjs`, `run.cjs`: eight candidate algorithms,
  designed cases, corpus extraction, regression comparisons, and seeded fuzzing.
- `results.json`, `summary.json`, `corpus.json`, `corpus.patch`: detailed outputs,
  summary metrics, and sampled source changes.
- `holdout.json`, `stress.cjs`, `stress.json`: additional identifier probes and
  long-input performance experiments.
- `report.cjs`, `report.html`: report generator and self-contained report.
- Candidate directories: generated engines, copied regression fixtures, and logs.
- `source-snapshot.ts`, `*.log`: examined source and original execution logs.

The retained run includes 52 designed cases, 441 changed-line pairs from this
repository, 35 existing regression tests per candidate, and 1,500 seeded Unicode
mutations per candidate. This is a single-repository investigation with subjective
readability judgments, not a human readability study or an exact comparison of
Meld's implementation. The report's browser presentation is separate from
Bygone's application renderer.

## Reproduction

To verify the original archived files, run `shasum -a 256 -c SHA256SUMS` from
this directory. `node report.cjs` regenerates the HTML from the saved data without
project dependencies; use a scratch copy to preserve the original archive.

The experiment scripts intentionally retain their original absolute paths.
To rerun the study, use a separate checkout of the recorded baseline commit,
install its locked dependencies, and copy this archive into a scratch directory.
Update `root` in `run.cjs` and the dependency path in `candidates.cjs` to that
checkout, then run `node run.cjs`, `node stress.cjs`, and `node report.cjs` in
the scratch directory. These commands overwrite generated outputs. The saved
`holdout.json` is retained evidence; a separate holdout generator was not present
in the original archive. Timings and timestamps will differ between runs.

Do not rerun against the later edge-trimming implementation: the runner injects
candidates by replacing an exact baseline source expression. The archive was
verified for byte integrity and baseline provenance when committed; the full
experiment suite was not rerun as part of archiving.
