# Change tour authoring format

A `.bygone` file is a UTF-8, single-document YAML source containing the
human-authored reading order and narrative. It points to code with named
anchors; it does not store generated hunk indexes or line numbers. The legacy
`.bygone.yaml` spelling remains supported for editors that depend on a `.yaml`
suffix, and explicitly supplied files are validated by content rather than
rejected by extension.

An authored source is Git-backed, not portable: resolving refs and anchors
requires the corresponding local repository and Git objects. A compiled
`.tour.json` manifest contains the resolved source snapshots and is the
portable artifact, although those snapshots may contain sensitive code.

Packaged macOS builds register `.bygone` with Bygone, allowing a presentation
inside its repository to open directly from Finder. Windows and Linux builds
currently do not install an operating-system file association; open the source
through Bygone or pass it explicitly to `bygone present --tour`. Direct opening
discovers the repository from the source file's real location, including when
the selected path is a symbolic link, and reports an error when no containing
Git worktree can be found.

Run it against a committed branch range, or omit the refs when the source file pins its own range:

```sh
bygone present <head> --base <base> --tour path/to/review.bygone
bygone present --tour path/to/pinned-review.bygone
```

The optional `range` pins the source's revisions for reproducibility; explicit
command-line refs take precedence. Pinned OIDs still require their Git object
database. The compiler resolves every anchor against the exact merge-base or
head commit and writes the resulting commit IDs, line ranges, excerpts, file
contents, and diffs into the portable JSON manifest served by the presenter.
Compilation fails if an anchor has no match or has multiple matches without an
explicit `occurrence`.

The optional `windowTitle` sets the native window title for the tour presenter.
Use a short label such as a pull request number when several tours may be open at
once. When omitted, the presenter falls back to `title`, then a generic tour label.

## Structure

```yaml
version: 1
title: A reviewer-facing title
windowTitle: PR-1234
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

The presenter search (`Cmd/Ctrl+Shift+F`) can search narrative and code together
or restrict either scope. Narrative results open the exact scene or step. Code
results search the compiled base and head snapshots, open the exact file and
side, and preserve **Return to tour** so exploration does not lose authored
context.

Use a walkthrough by default. Use a [stacked-diff example](../examples/stacked-diff.bygone)
only when every panel is a real selected Git revision. Use a
[deconstructed-diff example](../examples/deconstructed-diff.bygone) when
the teaching order is clearer than the real commit history; its cumulative
panels are synthetic explanation stages and must never be described as
commits. Every changed hunk must be assigned once or explicitly excluded.

See [Bygone's self-referencing history tour](../examples/bygone-history.bygone) for a complete walkthrough that pins and explains the commit where branch review was introduced.

For agent workflows, see [Generating change tours with an LLM](./generating-change-tours.md) and the machine-readable [JSON Schema](../schemas/change-tour-source.schema.json).
