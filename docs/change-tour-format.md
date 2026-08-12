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

Use a walkthrough by default. Use a [stacked-diff example](../examples/stacked-diff.bygone.yaml)
only when every panel is a real selected Git revision. Use a
[deconstructed-diff example](../examples/deconstructed-diff.bygone.yaml) when
the teaching order is clearer than the real commit history; its cumulative
panels are synthetic explanation stages and must never be described as
commits. Every changed hunk must be assigned once or explicitly excluded.

See [Bygone's self-referencing history tour](../examples/bygone-history.bygone.yaml) for a complete walkthrough that pins and explains the commit where branch review was introduced.

For agent workflows, see [Generating change tours with an LLM](./generating-change-tours.md) and the machine-readable [JSON Schema](../schemas/change-tour-source.schema.json).
