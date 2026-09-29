# Change tour authoring format

A `.bygone.yaml` file contains the human-authored reading order and narrative. It points to code with named anchors; it does not store generated hunk indexes or line numbers.

Run it against a committed branch range, or omit the refs when the source file pins its own range:

```sh
bygone present <head> --base <base> --tour path/to/review.bygone.yaml
bygone present --tour path/to/self-contained-review.bygone.yaml
```

The optional `range` makes a tour self-contained and reproducible; explicit command-line refs take precedence. The compiler resolves every anchor against the exact merge-base or head commit and writes the resulting commit IDs, line ranges, excerpts, file contents, and diffs into the portable JSON manifest served by the presenter. Compilation fails if an anchor has no match or has multiple matches without an explicit `occurrence`.

## Structure

```yaml
version: 1
title: A reviewer-facing title
sourceUrl: https://example.test/pull/123
range:
  base: 0123456789abcdef
  head: fedcba9876543210

anchors:
  event-contract:
    file: src/events.py
    revision: head
    contains: "    parent_event_id: str | None"
  durable-decision:
    file: src/controller.py
    revision: head
    contains: "    store.persist(decision)"

connections:
  contract-to-write:
    from: event-contract
    to: durable-decision
    label: The contract is applied before the side effect.

chapters:
  - id: causal-chain
    title: The causal chain
    scenes:
      - id: decision-flow
        title: From decision to action
        summary: The short thesis for this walkthrough.
        bullets: [One supporting point]
        tags: [ordering]
        takeaway: What the reviewer should retain.
        steps:
          - id: persist-first
            title: Persist the recommendation
            body: This exact line establishes the ordering guarantee.
            focus: durable-decision
            connection: contract-to-write
```

Only the active step's connection is shown. This keeps relationships useful without adding a permanent second layer of curves to Bygone's diff view. The Tour rail contains only authored scenes; the adjacent Files rail independently lists the complete change set. Browsing a file does not move the narrative, and “Return to tour” restores the file and annotation focused by the current scene.

## Choosing a scene type

Use a normal walkthrough by default. It keeps the real base/head diff intact and moves the reader through exact anchored evidence.

Two advanced scene types exist for narrower explanations:

- `stacked-diff` places three to six real Git refs in adjacent panels. Use it only when the selected refs are meaningful historical milestones and the point is how the code actually evolved.
- `deconstructed-diff` divides one real base-to-target change into synthetic cumulative stages by assigning changed hunks to an explanation order. Use it when the logical teaching order is clearer than the actual commit history.

A deconstructed stage is not a commit and must not be presented as one. Its baseline and intermediate panels are virtual explanation states; the manifest retains the real range separately as provenance. Every changed hunk must be assigned to exactly one stage or explicitly excluded with a reason.

Both advanced forms are currently experimental authoring surfaces: they are validated, compiled, rendered, and unit tested, but do not yet have checked-in end-to-end source examples. See the product surface map in [`CODEBASE.md`](../CODEBASE.md#product-surface-map) for their intended role and maturity.

See [Bygone's self-referencing history tour](../examples/bygone-history.bygone.yaml) for a complete narrative that pins and explains the commit where branch review was introduced.

For agent workflows, see [Generating change tours with an LLM](./generating-change-tours.md) and the machine-readable [JSON Schema](../schemas/change-tour-source.schema.json).
