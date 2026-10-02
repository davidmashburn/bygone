# Change tour authoring format

A `.bygone` file is a UTF-8, single-document YAML source containing the
human-authored reading order and narrative. It points to code with named
anchors; it does not store generated hunk indexes or line numbers. The legacy
`.bygone.yaml` spelling remains supported for editors that depend on a `.yaml`
suffix, and explicitly supplied files are validated by content rather than
rejected by extension.

An authored source is Git-backed, not portable: resolving refs and anchors
requires the corresponding local repository and Git objects. Version 2 and 3
compiled manifests remain bound to that repository so the presenter can load
live file history. Version 1 manifests remain readable as legacy portable
artifacts, without the mode switcher. Version 3 adds independent authored
tours, scene directory overviews, and review notes; versions 1 and 2 remain
accepted without those fields.

## Version 3 stability and compatibility

Format version **3 is the stable authoring contract for Bygone 0.9.2**. The
application version (`0.9.2`) and document version (`version: 3`) are separate:
UI fixes, navigation changes, and application patch releases do not require
rewriting a tour or incrementing its format version.

| Document version | Reader support in 0.9.2 | Contract |
| --- | --- | --- |
| 1 | Supported | Legacy source and portable compiled manifests |
| 2 | Supported | Repository-bound manifests, real revision stacks, and endpoint walkthroughs |
| 3 | Supported; use for new sources | Version 2 capabilities plus independent authored tours, scene directory overviews, and review notes |
| Greater than 3 | Rejected with an upgrade message | Never interpreted as version 3 |

The v3 field names, types, required fields, enum values, and meanings are fixed
by the [source schema](../schemas/change-tour-source.schema.json) and the
semantic rules in this document. Valid v3 sources and compiled manifests must
remain readable by later compatible releases; required fields must not be
added, existing fields removed, or evidence and mode semantics repurposed under
the same format number. New syntax that existing v3 readers cannot accept
requires a new document version, even when the new field is optional. Fixes
that enforce the documented contract do not make malformed documents valid.

The source is strict: unknown properties are errors, not an extension
mechanism. JSON Schema covers document structure; `bygone tour validate`
additionally checks IDs and references, Git objects, unique anchor matches,
stage coverage, comparison endpoints, and review freshness. A schema-only pass
does not prove that the source compiles. Validate against the intended local
repository before sharing a tour.

Keep authored YAML as the editable source. Compiled JSON is generated evidence,
not a second authoring syntax; v2/v3 manifests retain repository identity and
resolved Git objects. Stable format support does not make missing repositories
or pruned objects available, and does not promise byte-identical generated
timestamps or presentation layout. Pin full commit IDs in `range` when the
underlying comparison must stay fixed.

The compatibility checks cover v1/v2 acceptance, v3-only field gates,
independent authored modes, overview evidence and fallback semantics, review
freshness, and rejection of future versions. Run `npm test` before releasing a
parser, compiler, or schema change; update those checks with any new contract.

## Opening and compiling a source

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
contents, and diffs into the JSON manifest served by the presenter.
Compilation fails if an anchor has no match or has multiple matches without an
explicit `occurrence`.

The optional `windowTitle` sets the native window title for the tour presenter.
Use a short label such as a pull request number when several tours may be open at
once. When omitted, the presenter falls back to `title`, then a generic tour label.

## Independent authored tours

Version 3 can supply `tours.historical.chapters` and
`tours.deconstructed.chapters`. Each uses the chapter and scene structure below,
with the document's shared range, anchors, and connections. This lets one file
explain actual revisions and also teach the change through synthetic stages.

The required root `chapters` remain the compatible default tour. When a mode is
not explicitly supplied, its authored content can come from those chapters:
real walkthroughs and stacks supply Historical tour; deconstructed scenes supply
Deconstructed tour. Explicit endpoint walkthrough steps on a deconstructed scene
can supply Historical content, but a generated revision stack alone cannot.

Historical tour accepts walkthroughs and real stacked diffs, including a stack
with just two endpoints. It rejects synthetic deconstructed scenes.
Deconstructed tour requires at least one deconstructed scene; other walkthrough
scenes can add context and proof. Its synthetic stages do not need a matching
authored historical step. Both modes retain their own chapter, scene, and step
order; the presenter does not infer cross-tour mappings.

See `examples/navigation-lab.bygone.yaml` for both tours in one file, and
[presentation navigation](./present.md#explore-and-follow-tours) for History and
Compare.

## Scene directory overviews

In version 3, an authored walkthrough, stacked-diff, or deconstructed-diff scene may carry a
directory overview for the presenter to render alongside the current scene:

```yaml
overview:
  kind: directory-diff
  path: web
```

`path` is optional and is relative to the repository root. Omit it or use `.`
for the root directory. Absolute paths, backslashes, and `..` path segments are
rejected. The compiler preserves this evidence on the corresponding compiled
scene in the root tour and any authored mode or fallback that contains it; it
does not create a separate scene kind.

The comparison is stable regardless of the saved step. Stacked and deconstructed
scenes default to their first and last panels and compare only files materialized
in those scene panels. Walkthroughs use the review's base-to-head comparison and
its tour files, including omitted entries. Any of the three scene types can
scope the overview to a subdirectory. For a narrower authored comparison, add:

```yaml
comparison:
  from: before
  to: hierarchy
```

Place `comparison` inside `overview`. For stacked scenes, endpoints are `stack`
entry IDs. For deconstructed scenes, use `explanation-baseline` or
`explanation-stage-<stage-id>`. Both endpoints must exist and differ. Walkthroughs
reject this option. When a deconstructed scene produces a fallback Historical
or walkthrough view, its synthetic endpoints are not mapped to real revisions:
the fallback retains the directory scope and uses its default full comparison.
Use an explicit authored Historical scene to choose a narrower real comparison.

## Structure

```yaml
version: 3
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
            body: This exact line establishes the ordering guarantee before the side effect runs.
            focus: durable-decision
            connection: contract-to-write
            requirement:
              id: R1
              text: Decisions must be durable before any side effect runs.
              status: fulfilled
              source: tracker:PROJ-123
              confidence: high
```

Scene fields provide framing: `summary` states the scene's purpose, `bullets`
give supporting points, and `takeaway` states what the reader should retain.
Step `body` is the canonical place for the evidence-specific explanation,
including why the focused code matters and any rationale or tradeoff that the
source supports. Keeping that explanation beside `focus` lets the reader assess
the claim while the code is visible and avoids repeating it in scene framing.

Narrative text supports inline Markdown links such as `[ticket](https://example.com/ticket)`. HTTP and HTTPS destinations open outside the tour; link labels remain visible and clickable during narration highlighting. Authored HTML, other URL schemes, and local-file destinations are treated as plain text. This is link support, not a general Markdown renderer.

The source schema has no ad hoc `notes` field. In v3, use the top-level `review`
block below for evidence-linked review observations and unresolved questions;
do not present those questions as settled step rationale.

## Review notes

The optional v3 `review` block records authored interpretation separately from
the narrative and deterministic evidence. It contains `baseOid`, `headOid`, and
a nonempty `items` array. Both OIDs must be full 40- or 64-character hexadecimal
Git IDs, matching the resolved **merge base** and head, respectively. A changed
range makes the review stale and compilation fails rather than silently
carrying the conclusions forward.

Each item has a unique nonblank `id`, a `kind` (`concept`, `boundary`,
`tradeoff`, or `question`), nonblank `title` and `body`, and an `evidence` array
of `{ sceneId, stepId }` references to endpoint walkthrough steps in the root
`chapters` (not scenes defined only inside an independent `tours` mode).
Synthetic stage IDs and stacked-diff step IDs are not walkthrough evidence.
Claims require at least one reference. Questions may use an empty evidence
array but require a nonblank `nextCheck`; other items may also supply it.
Validation confirms the references, not the truth of an author's claim or the
state of an external deployment.

For example, add this item to `review.items` alongside the structure above:

```yaml
- id: check-caller
  kind: question
  title: Is the caller compatible?
  body: The source shows persistence, but the deployed caller has not been checked.
  evidence:
    - sceneId: decision-flow
      stepId: persist-first
  nextCheck: Verify the deployed caller contract against this exact head revision.
```

## Requirements

A walkthrough step may carry an optional `requirement` that names the stated
requirement the focused code fulfills. It turns a walkthrough into a
requirements tour: each step answers which requirement it satisfies, where that
requirement was stated, and how confident the author is in the mapping.

| Field | Required | Value |
|-------|----------|-------|
| `id` | yes | Short requirement label, such as `R1` |
| `text` | yes | The requirement statement in its original wording |
| `status` | no | `fulfilled` or `gap` |
| `source` | no | Where the requirement was stated, such as `pr-description` or `tracker:PROJ-123` |
| `confidence` | no | `high`, `medium`, or `low` |

The presenter shows a chip with the id and status beside the step title, the
requirement text next to it, and the source and confidence on a secondary line.
Steps without a requirement render unchanged. A `gap` status records a
requirement the author judged unmet at the anchored code; it does not fail
validation, since the judgment is narrative rather than mechanical.

Only the active step's connection is shown. This keeps relationships useful without adding a permanent second layer of curves to Bygone's diff view. The Tour rail contains only authored scenes; the adjacent Files rail independently lists the complete change set. Browsing a file does not move the narrative, and “Return to tour” restores the file and annotation focused by the current scene.

The presenter search (`Cmd/Ctrl+Shift+F`) can search narrative and code together
or restrict either scope. Narrative results open the exact scene or step. Code
results search the compiled base and head snapshots, open the exact file and
side, and preserve **Return to tour** so exploration does not lose authored
context.

Version 2 and 3 tours show one mode control for moving among live Git History,
arbitrary Compare ranges, and the authored tours available in that manifest.
Previously compiled version 2 deconstructed tours retain their authored final
endpoint walkthrough as **Final tour** beside **Deconstructed tour**. Other
version 2 tours appear as **Historical tour**, while their endpoint comparison
remains available through **Final diff** in Compare. Each mode retains its own
location; switching back restores that location exactly.

Use a walkthrough by default. Use a [stacked-diff example](../examples/stacked-diff.bygone)
only when every panel is a real selected Git revision. Use a
[deconstructed-diff example](../examples/deconstructed-diff.bygone) when
the teaching order is clearer than the real commit history; its cumulative
panels are synthetic explanation stages and must never be described as
commits. In versions 2 and 3, a `deconstructed-diff` scene in root `chapters`
requires a real `stack` with the same base and final endpoints and nonempty
walkthrough `steps` for compatibility. In version 3, a scene authored inside
`tours.deconstructed` may omit both because that tour is synthetic by design.
Explicit `tours.historical` content supplies its own explanation of real
revisions. Bygone does not infer a real stack from Git history. Every changed
hunk must be assigned once or explicitly excluded.

See [Bygone's self-referencing history tour](../examples/bygone-history.bygone) for a complete walkthrough that pins and explains the commit where branch review was introduced.

For agent workflows, see [Generating change tours with an LLM](./generating-change-tours.md) and the machine-readable [JSON Schema](../schemas/change-tour-source.schema.json).
