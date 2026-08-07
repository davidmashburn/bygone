# Deconstructed commits

## Summary

Allow a tour to break a commit or larger change into smaller conceptual pieces
and build up the final result in a logical sequence. These pieces would be
virtual stages for explanation rather than rewritten Git commits.

For example, a tour could first introduce a data model, then show the behavior
that uses it, then add error handling, and finally reveal the tests—even when
all of those changes arrived in one commit or are interleaved across files.

## Why it might matter

The order in which code appears in a diff is rarely the best order in which to
understand it. Deconstructing a change would let an author present causality,
dependencies, and intent without requiring the original implementation
history to be perfectly organized.

The resulting tour could feel more like constructing the change with the
author than reading a retrospective list of modified lines.

## Open questions

- Should a piece contain files, hunks, symbols, arbitrary line ranges, or a
  combination of these?
- Must each intermediate stage compile or pass tests, or is conceptual
  coherence sufficient?
- How should moves, renames, and edits to the same lines across several pieces
  be represented?
- Are pieces strictly cumulative, or should a tour be able to revise or remove
  an earlier piece?
- Should the decomposition be authored manually, generated automatically, or
  generated and then edited?
- How should the UI distinguish the actual Git history from the tour's
  explanatory sequence?

## Possible next steps

- Model a deconstructed change as an ordered set of patch subsets that
  cumulatively produce the original diff.
- Test the model against one small feature and one cross-cutting refactor.
- Prototype navigation that clearly labels virtual stages versus real commits.
- Explore an assisted decomposition workflow based on symbols, dependencies,
  and change intent.
