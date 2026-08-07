# Multi-panel diff tours for stacked PRs

## Summary

Support tours that show multiple related diffs at once for a stack of pull
requests. Each panel could represent one layer of the stack, allowing a tour
to explain both the incremental change in each PR and how the full sequence
builds toward the final result.

A tour step could focus the relevant files or hunks across several panels so
the reader can follow an idea as it is introduced, extended, or revised across
the stack.

## Why it might matter

Stacked PRs reduce review size, but understanding the stack still requires the
reviewer to reconstruct relationships among several diffs. A multi-panel tour
could preserve the benefits of small PRs while making their dependencies and
overall narrative visible.

This could also help when a later PR modifies code introduced earlier in the
stack, since the tour could show that evolution directly instead of relying on
the reader to compare PRs mentally.

## Open questions

- Should each panel show a complete revision, an adjacent diff, or a selected
  PR or commit?
- Should the default layout follow stack order, conceptual grouping, or the
  current tour step?
- How should navigation and scrolling stay synchronized when the same file
  appears in multiple layers?
- How should the tour handle rebases, force-pushes, and changing stack bases?
- What is the useful panel limit before the interface becomes too dense?
- Can a tour remain meaningful when only some PRs in the stack are available
  locally?

## Possible next steps

- Define a minimal tour source model for a base plus two stacked PRs.
- Prototype a three-panel walkthrough with synchronized step navigation.
- Compare adjacent-diff panels with full-revision panels using a real stack.
- Identify which stack metadata should be stored in the tour and which should
  be resolved from Git or GitHub when the tour opens.
