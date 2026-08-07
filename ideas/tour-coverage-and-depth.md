# Tour coverage and depth

## Summary

Measure how thoroughly a tour discusses the underlying change along two
separate dimensions:

- **Coverage:** the percentage of changed material connected to at least one
  tour step.
- **Depth:** how substantially the tour explains the covered material, from a
  simple mention through behavior, rationale, dependencies, and tradeoffs.

Coverage could be reported for the whole tour and broken down by file, hunk,
or another meaningful unit. Depth might be expressed as levels or a profile
rather than a single precise-looking percentage.

## Why it might matter

Authors could see which parts of a change remain unexplained before sharing a
tour. Readers could understand whether a tour is a quick orientation, a review
guide focused on risky areas, or a comprehensive walkthrough.

The metrics could also support tooling that suggests uncovered changes or
places where a step points at code without explaining why it matters.

## Open questions

- Should coverage count changed lines, hunks, files, symbols, semantic changes,
  or a weighted combination?
- How should generated files, vendored code, lockfiles, binaries, and mechanical
  changes affect the denominator?
- Does merely focusing a changed range count as coverage, or must the step
  contain an explanation tied to it?
- What signals distinguish shallow coverage from deep explanation reliably?
- How should overlapping steps and one explanation that covers several changes
  be counted?
- How can the metric communicate uncertainty and avoid encouraging authors to
  game a score?
- Should authors be able to intentionally exclude changes and record why?

## Possible next steps

- Define a minimal coverage metric based on changed hunks referenced by tour
  steps.
- Add explicit exclusions for generated or intentionally omitted changes.
- Draft a small depth rubric such as `mentioned`, `explained`, and
  `contextualized`.
- Evaluate the metrics against several existing tours and compare the scores
  with human judgments of completeness.
- Prototype a coverage report that highlights uncovered areas without turning
  the score into a pass/fail gate.
