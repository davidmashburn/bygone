# Change tour authoring format

A `.bygone` file is a UTF-8, single-document YAML source containing the
human-authored reading order and narrative. It points to code with named
anchors; it does not store generated hunk indexes or line numbers. The legacy
`.bygone.yaml` spelling remains supported for editors that depend on a `.yaml`
suffix, and explicitly supplied files are validated by content rather than
rejected by extension.

An authored source is Git-backed, not portable: resolving refs and anchors
requires the corresponding local repository and Git objects. Version 2, 4, 5, 6, 7, and 8
compiled manifests remain bound to that repository so the presenter can load
live file history. Version 1 manifests remain readable as legacy portable
artifacts, without the mode switcher. Version 4 supports independent authored
tours and scene directory overviews; versions 1 and 2 remain accepted without
those fields.

## Version stability and compatibility

Format version **8** is the current authoring contract. Application and document
versions are separate; UI fixes do not require rewriting a tour.

| Document version | Reader support | Contract |
| --- | --- | --- |
| 1 | Supported | Legacy source and portable compiled manifests |
| 2 | Supported | Repository-bound manifests, real revision stacks, and endpoint walkthroughs |
| 3 | Retired | Remove the top-level `review` block, set source `version: 4`, and recompile |
| 4 | Supported | Independent authored tours and scene directory overviews; no Review Notes |
| 5 | Supported | Optional opening, conclusion, and chapter previews; explicit overview purpose |
| 6 | Supported | Optional pinned symbol comparisons in walkthrough stops |
| 7 | Supported | Optional nested explanation branches and generation attribution |
| 8 | Use for new sources | Explicit tour options, inferred choices, human attribution, and accounted non-text changes |
| Greater than 8 | Rejected with an upgrade message | Never interpreted as version 8 |

Version 4 removes the `review` field and the separate Review Notes panel.
Concepts, boundaries, tradeoffs, and unresolved questions belong in scene or
step narrative. Clearly distinguish an unknown from a supported conclusion and
state the next check that would resolve it. Neither source nor compiled manifests
accept a `review` field; existing v3 documents receive a migration error.

The v5 field names, types, required fields, enum values, and meanings are fixed
by the [source schema](../schemas/change-tour-source.schema.json) and the
semantic rules in this document. Breaking syntax or semantic changes require
a new document version. Fixes enforcing the documented contract do not make
malformed documents valid.

The source is strict: unknown properties are errors, not an extension
mechanism. JSON Schema covers document structure; `bygone tour validate`
additionally checks IDs and references, Git objects, unique anchor matches,
stage coverage, and comparison endpoints. A schema-only pass
does not prove that the source compiles. Validate against the intended local
repository before sharing a tour.

### Tour options and human authorship

Version 8 accepts root `options` and optional complete mode-specific `options`
objects under `tours.historical` and `tours.deconstructed`. A mode without its
own options inherits the root object. Style expresses authoring intent; `final`
uses the existing endpoint walkthrough, not an additional workspace mode.

```yaml
version: 8
options:
  style: final
  depth: guided
  audience: peer
  familiarity: some
  coverage: key-changes
  emphasis: [correctness, tests]
  inferred: [depth, audience, familiarity]
author:
  name: Example Author
  url: https://example.com/about
generatedBy:
  model: example-model-1
  provider: example-provider
  harness: example-agent
  effort: high
```

The five core options are required when `options` is present. Optional `emphasis`
and `inferred` contain distinct supported values. `notes` is nonempty audience/task
context; `paths` contains repository-relative files/directories without traversal
(omitted or empty means the whole comparison). See the
[authoring guide](generating-change-tours.md#tour-menu-and-inferred-options) for
all choices. Unknown keys or values are rejected; older versions cannot carry
these v8 fields. Options express requested intent, never verified correctness.

`author.name` is required when `author` is supplied; its optional `url` must use
HTTP(S). Attribution is explicit and never inferred from Git. The compiler and
exports preserve these fields. The reader shows them in collapsed Tour details,
including which choices were inferred, outside narration.

For a complete tour, `coverage.accountedFiles` may identify non-text and zero-hunk
changes using unique `path` / nonempty `reason` entries. The strict coverage report
checks the full pinned inventory independently of the legacy selected coverage
score; exclusions prevent a complete result. Full textual coverage needs narrated
main-path endpoint evidence covering both changed sides. Optional evidence alone
cannot make the main path complete.

`bygone tour coverage <source> --json` adds a `complete` map when complete
coverage was requested. Each authored mode has its own report (`historical` or
`deconstructed`); a root-only tour uses `tour`. Reports retain pinned endpoint
OIDs, requested and resolved paths, the inventory before exclusions, raw hunk
counts, missing sides, explicit file accounting, and limitations. Status is
`complete`, `incomplete`, or `no-textual-changes`. An empty textual inventory
never earns a 100% claim, and an explicit base that differs from the merge-base
blocks completion rather than silently changing the requested comparison.

Local presentation and export retain these results under
`authoringCoverage.complete`. This is a compiler-produced diagnostic, not an
authenticated attestation. The viewer validates its structure, range, and scope;
it does not reconstruct coverage from a repository or authenticate hand-edited
reports. Recompile the source after changing narration or evidence. The existing
Tour details disclosure identifies the compiler report and shows the
exact scope and gaps. A file with only `options.coverage: complete` displays
“requested · not verified.” These diagnostics are compiler accounting, not a
judgment that the explanation is useful or the code is correct. The older
coverage percentage and CLI minimum-coverage threshold retain their existing
semantics; inspect the strict report for a complete-tour claim.

### Generation attribution

Version 7 accepts optional top-level generation provenance:

```yaml
generatedBy:
  model: example-model-1
  harness: example-agent
  effort: high
```

`provider` is an optional nonempty string added in version 8.
`model` is required when the object is present; `harness` and `effort` are optional
non-empty strings. Record the exact model identifier from the runtime that authored
the tour, including a delegated author rather than its orchestrator. Omit unknown
values; Bygone does not infer a generator or treat attribution as review approval.
Compilation and export preserve this object. The reader displays it in collapsed
Tour details, outside the reading and narration paths. Substantial regeneration
replaces the attribution; there is no per-step contributor history.

### Whole-path reading cost

`tour validate --json` reports authored prose under the existing
`readingCosts[mode].main` and `.optional` fields. Its additive `.narration` object
reports `{main: {stops, words}, optional: {stops, words}}` using the reader's actual
continuous speech projection, including openings, chapter/scene framing,
conclusions, and generated orientation. Optional paths are counted separately,
including nested detail once each. These are word counts, not speaking-time estimates.

`bygone tour narration <source>` prints that continuous main-path speech in reading
order, with per-stop word counts and optional branches excluded. Use it to inspect
repeated framing before delivery. `--json` returns `{title, modes}`, with each mode's
`main` containing `stops`, `words`, and `items` (`key`, `title`, `words`, `text`).
This is the default journey; fresh playback and optional-path entry can add context.

Continuous narration announces file and comparison changes without repeating an
unchanged file or revision pair at every step. The visible orientation and a fresh
playback start retain the full context.

Judge the default journey by whether readers understand why, what, and the key
decisions, including supported alternatives and tradeoffs. Keep a concrete case
and consequential constraints in the main path. Use word counts to diagnose
repetition, not as a quality threshold. Routine evidence belongs in the optional
[Checks & evidence checklist](tour-checks.md), outside narration.

Keep authored YAML as the editable source. Compiled JSON is generated evidence,
not a second authoring syntax; v2/v4/v5/v6/v7/v8 manifests retain repository identity and
resolved Git objects. Stable format support does not make missing repositories
or pruned objects available, and does not promise byte-identical generated
timestamps or presentation layout. Pin full commit IDs in `range` when the
underlying comparison must stay fixed.

The compatibility checks cover v1/v2 acceptance, v4-only field gates,
independent authored modes, overview evidence and fallback semantics, retired
v3 rejection, removed-field rejection, and rejection of future versions. Run
`npm test` before releasing a parser, compiler, or schema change; update those
checks with any new contract.

## Optional explanation branches

Version 7 steps can carry `branches`, each with a stable `id`, a question as its
`title`, and a non-empty `steps` list. A branch's steps use the same evidence
fields as their parent and may contain further branches. Step IDs and branch
IDs share one namespace and must be unique throughout their scene, including
nested detail.

```yaml
# Within a version 7 walkthrough scene:
steps:
  - id: retry-safety
    title: Retries require a deduplication key
    body: The key lets the service recognize an operation already completed.
    focus: retry-guard
    branches:
      - id: ambiguous-timeout
        title: Why can a timeout repeat an operation?
        steps:
          - id: completed-before-timeout
            title: Completion can precede the lost response
            body: A timeout does not establish whether the operation ran.
            focus: timeout-handler
```

Use actual named anchors for every `focus`. Optional evidence is validated and
exported with the same rules as main-path evidence. Walkthrough, stacked-diff,
and explicit deconstructed walkthrough steps support branches. Existing tours
without branches keep their reading order and need no migration.

The default reading path skips every branch. Opening a question enters its
direct steps; nested questions open another path. Return restores the parent,
and Continue main path skips remaining optional detail. Search and stable step
links can open any depth. Narration follows the active path and stops at its end.
`bygone tour validate` reports main and optional step/word counts separately,
including per-mode counts in JSON output. These are authoring diagnostics, not
quotas or evidence-coverage scores; `depth` retains its coverage meaning.

Compiled manifests keep a flat evidence-step list. Each optional step carries
`branch: {id, title, parentStepId}` identifying its direct branch and owner.
Sibling members share that metadata. Parent references must remain within the
scene, and cycles, conflicting metadata, and scenes without a main step are
invalid. Authors should edit nested source rather than generated manifests.

## Symbol-focused stops

Version 6 adds an optional repository-relative `correspondence` artifact and a
`symbol` selector on walkthrough steps. Generate the artifact as described in
[Symbol correspondence evidence](correspondence.md), then use an accepted
relation ID or one unmatched symbol ID from its inventory:

```yaml
version: 6
correspondence: evidence/symbols.json
# Pin range.base and range.head to the artifact's comparison.
anchors:
  moved-declaration:
    file: src/moved.py
    revision: head
    contains: "def transfer("
# Within a walkthrough scene's steps:
# - id: transfer
#   title: Read the moved declaration
#   body: Compare the complete declaration before and after the move.
#   focus: moved-declaration
#   symbol: { relation: relation-transfer }
```

The ordinary `focus` anchor remains required and must resolve inside the selected
declaration on its revision side. It preserves source navigation and existing
anchor validation. `symbol: { symbol: after-uncertain }` selects one unmatched
endpoint instead. IDs are unique across the artifact's symbol inventory; matched
endpoints must use their accepted relation ID. An ambiguous endpoint remains
one-sided, with no invented origin. Symbol stops cannot also use an image or
connection.

Compilation revalidates the artifact against the exact Git comparison and
embeds complete declaration text, source spans, revisions, and both full file
contexts. The source artifact path must stay inside the repository, including
through symlinks. Stale artifacts and selectors outside the chosen declaration
are errors. An accepted relation is still an inferred correspondence; behavior
remains unassessed.

The viewer opens the declaration comparison. **Show file context** widens to the
complete source and destination files, highlights both declarations, and keeps
the current tour stop. **Return to symbol comparison** restores the slices;
**Return to tour** restores the authored stop after exploring another file.
The compiled evidence also works in an offline HTML export without the artifact
or repository. Export packs repeated text once. Coverage counts only changed
units intersecting either selected declaration, or the single available endpoint
for an unmatched symbol; overlapping stops do not multiply coverage.

Existing sources and ordinary anchor stops keep their existing behavior. Live
presentations load the source's artifact into Symbols and Files automatically;
offline exports retain the selected stops and their context, rather than the
entire symbol inventory.

## Opening and conclusion passages

Version 5 adds optional `opening` and `conclusion` at the document root and
inside each independently authored `tours.historical` or `tours.deconstructed`.
Each belongs to that narrative; one mode does not inherit another mode’s prose.
Switching modes stops narration and restores the selected mode’s reading position.
Returning from file exploration keeps the current passage and paused speech position.

```yaml
version: 5
opening:
  title: What this tour will establish
  summary: Explain the problem, the review question, and the route through the evidence.
  bullets:
    - Name the boundaries this tour will and will not cover.
conclusion:
  title: What the evidence established
  summary: Summarize the supported behavior and its consequence for the reviewer.
  bullets:
    - State any remaining uncertainty and the next check that would resolve it.
```

Both passages require nonblank `title` and `summary`; optional `bullets` contain
nonblank strings. Unknown fields are rejected. They are narrative reading
positions, not scenes or evidence: they add no files, steps, or coverage.
The opening extends the title page, and the conclusion follows the last step.
Keyboard navigation, narration, search, and heading links include both, including
image-only guides. A conclusion link uses `part=conclusion`; requesting it in a
mode without a conclusion reports an unavailable target. Legacy tours remain
readable and receive no invented closing.

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

Version 4 can supply `tours.historical.chapters` and
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

## Chapter previews

Version 5 chapters may include a nonblank `summary`: one or two sentences
explaining what comes next and why. It is optional in root chapters and each
independently authored mode. The compiler preserves it in the corresponding
compiled chapters and derived modes.

Only chapters with summaries have presentation and narration stops. Chapters
without summaries remain in the contents; selecting their heading or opening
a chapter link goes to their first scene. Scene-title links alone do not create
a chapter introduction. Earlier format versions accept chapters without this field.

## Scene directory overviews

In versions 4 and 5, an authored walkthrough, stacked-diff, or deconstructed-diff scene may carry a
directory overview for the presenter to render alongside the current scene:

```yaml
overview:
  kind: directory-diff
  purpose: See which web layers changed together before tracing their interaction.
  path: web
```

Version 5 requires a nonblank `purpose`: explain what the inventory establishes
and why it is useful at this point. A scene without an explicit `overview` previews
its first step’s evidence with a “Coming up” caption and no active annotation.
Title, chapter, discussion, and conclusion passages show narrative only.

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
version: 4
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

Version 2 and 4 tours show one mode control for moving among live Git History,
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
commits. In versions 2, 4, and 5, a `deconstructed-diff` scene in root `chapters`
requires a real `stack` with the same base and final endpoints and nonempty
walkthrough `steps` for compatibility. In versions 4 and 5, a scene authored inside
`tours.deconstructed` may omit both because that tour is synthetic by design.
Explicit `tours.historical` content supplies its own explanation of real
revisions. Bygone does not infer a real stack from Git history. Every changed
hunk must be assigned once or explicitly excluded.

See [Bygone's self-referencing history tour](../examples/bygone-history.bygone) for a complete walkthrough that pins and explains the commit where branch review was introduced.

For agent workflows, see [Generating change tours with an LLM](./generating-change-tours.md) and the machine-readable [JSON Schema](../schemas/change-tour-source.schema.json).

## Bounded reader experiments

`bygone tour reader-packet review.bygone.yaml --json` compiles the source and
returns a text packet per mode in `modes`. Each packet has `schema_version: 1`,
a title, ordered `main` nodes, and optional `branches` and `checks`. Nodes contain
stable `id`, `title`, `text`, and `child_ids`. Select one mode's packet before
initializing a bounded reader session. The packet contains the full candidate;
only the parent may read it. Give the skim reader only harness responses.

This projection uses continuous narration and the reader's titles, branch labels,
and check statuses. It removes exact repeated title segments and excludes
repository data and generator attribution. Each optional path's steps are joined
in reading order; nested branch labels become available on entering that path.
It is a text comprehension surrogate, not a simulation of viewport layout,
step-by-step branch controls, code inspection, images, or audio. Test those in the
presenter separately. Keep projection and budget parameters frozen within a
comparison, and do not claim human reading performance from model trials.
