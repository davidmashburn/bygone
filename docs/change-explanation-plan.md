# Change Explanation and Presentation Plan

This is a working design note for riffing on how Bygone can speed up understanding and presenting code changes without sacrificing clarity.

## Reframed Product Question

Bygone does not need to reproduce the granular review workflow of a Git hosting site. Its more distinctive opportunity is to make change legible:

- **Compare** shows how snapshots differ.
- **Explore** helps someone find the important parts of a change.
- **Explain** arranges those parts into a coherent path.
- **Present** makes that path replayable or embeddable elsewhere.

The product could expose all four while sharing one diff renderer and one change model.

## Why the Current Checkmarks Do Not Fit

The branch-review directory currently adds a checkmark after a file is opened. It means only “visited during this app session.” It is not explicit approval, persistent progress, or synchronization with a PR provider.

That state is too granular to be the center of the product, and the checkmark overstates its meaning. It should be removed or reduced to unobtrusive session navigation. Bygone should optimize the path through a change rather than ask users to maintain another review ledger.

## The Core Idea: A Change Explanation Engine

Build one reusable pipeline:

```text
Git range or supplied snapshots
        ↓
normalized change manifest
        ↓
files, commits, hunks, renames, binaries, and evidence
        ↓
Bygone renderer
        ↓
standalone explorer | authored tour | embedded component | static artifact
```

The normalized manifest is the important boundary. Electron, VS Code, a local web server, a generated HTML artifact, or a slideshow should all be hosts around the same content and interactions.

The existing web host and message-driven renderer are a useful start, but they are currently a test/demo host rather than a supported embedding API.

## Potential Product Forms

### 1. Standalone Change Explorer

Open a branch range and move fluidly among:

- the aggregate merge-base-to-tip change;
- individual commits or selected commit ranges;
- directory and file views;
- adjacent hunks;
- text, binary, and image changes;
- explicitly attached evidence.

The explorer should help users understand a change without imposing a process for declaring every file reviewed.

### 2. Guided Change Tour

An ordered sequence of “scenes,” where a scene can focus on:

- a file;
- one or more hunks;
- an entire commit;
- a multi-panel evolution;
- an image or other binary comparison;
- an overview, annotation, screenshot, test result, or benchmark.

A tour is closer to a code-change slideshow, but each scene remains a live, navigable Bygone view rather than a flattened screenshot.

### 3. Embeddable Diff Component

Expose the renderer as an iframe or web component with a versioned message API. A host supplies a manifest and controls the active scene; Bygone emits navigation and selection events.

Possible hosts include:

- a custom HTML slideshow;
- Reveal.js, Slidev, or another presentation system;
- generated engineering docs;
- an internal release or deployment page;
- a richer PR companion page;
- a product demo combining code, screenshots, and live application state.

The component should work without Git or filesystem access once it receives a self-contained manifest.

### 4. Portable Static Artifact

Generate a local HTML bundle pinned to exact object IDs:

```bash
bygone present HEAD --base origin/main --output change-tour.html
```

The artifact could open directly in a browser, be hosted as static files, or be inserted into a larger demo. A single-file option would favor portability; a directory bundle would favor large changes and lazy loading.

Private-code safety must be explicit because a self-contained artifact contains source snapshots.

## Ideas That Could Materially Speed Up Understanding

### Record Exploration Into a Tour

Let the user explore normally, then capture the useful path they took:

1. Start recording.
2. Open files and move among hunks or commits.
3. Pin the moments worth keeping.
4. Reorder or annotate the captured scenes.
5. Replay or export the result.

This avoids forcing users to author a slideshow before they understand the change. The investigation naturally becomes the first draft of the explanation.

### Deterministic Change Triage

Generate a suggested reading order using transparent signals rather than pretending to perform human review:

- foundational types and interfaces before consumers;
- production code before or alongside its tests;
- schema, migration, permissions, or public API changes early;
- renames and mechanical changes grouped or collapsed;
- generated files and lockfiles deferred;
- unusually large or cross-cutting changes called out;
- commits used as hints about authorial intent.

Every ordering decision should be inspectable and overridable.

### Narrative Grouping

Group changes into chapters that do not have to match directories or commits:

- data model;
- core behavior;
- integration points;
- tests and evidence;
- cleanup or mechanical follow-through.

Start with manual groups and simple deterministic suggestions. Semantic or AI-assisted grouping can remain optional and must link every claim back to concrete hunks.

### Aggregate and Temporal Views

Keep both answers close:

- “What will merge?” — aggregate merge-base-to-tip diff.
- “How did it get here?” — commit or selected-range evolution.

For merges, retain all parents. Default temporal inspection to first-parent history and expose an explicit parent chooser instead of flattening ambiguity.

### Progressive Disclosure

Offer presentation presets without hiding access to source truth:

- overview first;
- changed regions focused;
- surrounding context expandable;
- mechanical groups collapsed;
- full files always reachable;
- directory structure available without dominating the scene.

### Evidence Alongside Code

A change explanation may need more than source diffs. Scenes or chapters could attach:

- screenshots and image diffs;
- test output;
- benchmark tables;
- architecture diagrams;
- logs or traces;
- migration previews;
- links to issues, PRs, and deployed demos.

The artifact becomes a change dossier while Bygone remains the code-change lens within it.

### Presenter Mode

A focused display mode could add:

- large, legible controls;
- scene and hunk navigation from the keyboard;
- optional speaker notes visible only in a controller window;
- a clear breadcrumb showing chapter, file, and commit;
- stable layout that does not jump as context changes;
- deep links to individual scenes.

### Headless Capture

Support deterministic rendering of scenes to PNG, SVG where practical, or HTML fragments. This would let existing slide workflows use Bygone without adopting its entire presentation shell.

### Live PR Tour Guide Loop

Treat the saved `.bygone.yaml` as the shared boundary between an author, an agent, and the open presenter. When the author asks a question, the PR Tour Guide can revise the narrative or its evidence links and save the file; Bygone should validate, compile, and refresh the browser without restarting the presentation.

The refresh loop should:

- watch the authored tour and debounce partial editor writes;
- replace the presented manifest only after the new source validates and compiles;
- keep the last known-good tour visible when an edit is invalid and report the error clearly;
- preserve the active scene and step by stable IDs when they still exist;
- update the scene rail and focused code when the narrative changes;
- distinguish a narrative-only refresh from a changed Git range, which may require rebuilding source evidence;
- surface broken anchors rather than silently redirecting them.

This makes the first interactive workflow deliberately simple: conversation changes the durable tour file, and the presenter reflects it. An embedded chat UI or agent protocol can come later without becoming part of the tour format.

## A Possible Authoring Format

Keep the durable format declarative and host-neutral. For example:

```yaml
version: 1
range:
  base: origin/main
  head: HEAD
chapters:
  - title: Introduce the event model
    scenes:
      - file: src/events.ts
        hunk: event-envelope
        note: The stable boundary used by producers and consumers.
      - file: src/consumer.ts
        hunk: handle-event
  - title: Prove the behavior
    scenes:
      - file: test/events.test.ts
        hunk: preserves-order
```

The exact syntax can wait. The important constraints are:

- pin reproducible Git inputs;
- permit manual ordering and annotation;
- use resilient anchors where possible;
- remain renderable without the authoring environment;
- make included source and external assets obvious.

## Recommended Implementation Sequence

### Phase 0: Remove the False Review Metaphor

- Remove or soften automatic checkmarks.
- Rename the UI from files “reviewed” to files “visited” only where session navigation truly needs it.
- Keep `review` as a convenient merge-base range command for now, without making its checklist the product thesis.

### Phase 1: Define the Portable Change Manifest

- Extract a serializable model for range metadata, commits, changed paths, rename pairs, binary metadata, and file snapshots.
- Version the manifest.
- Validate it independently of Electron and VS Code.
- Add size limits, lazy-asset references, and clear handling for sensitive source content.
- Teach the web host to render a supplied manifest.

This is the architectural foundation for both standalone and component use.

### Phase 2: Build a Minimal Tour

- Let a user pin the current file/hunk as a scene.
- Show a simple ordered scene rail.
- Support reorder, title, and short annotation.
- Replay scenes with previous/next controls.
- Save and reopen the tour locally.
- Preserve full diff navigation within each scene.

Success criterion: a real branch can be turned into a clear five-to-ten-scene walkthrough faster than hand-building an HTML slideshow.

### Phase 3: Export and Embed

- Generate a static HTML bundle.
- Define an iframe/message API before committing to a custom element.
- Add scene-selection and navigation events.
- Add a minimal embed example in a plain HTML slideshow.
- Add deterministic headless captures for workflows that still need images.

Success criterion: the same authored tour works in Bygone, a browser artifact, and a larger demo.

### Phase 4: Suggest, Do Not Dictate, a Narrative

- Suggest scene candidates from commits and meaningful hunks.
- Group mechanical, generated, and lockfile changes.
- Suggest dependency-aware or risk-aware reading order.
- Allow one-click acceptance followed by manual editing.
- Keep all heuristics explainable and deterministic first.

### Phase 5: Attach Broader Evidence

- Add screenshots, test results, diagrams, and links as first-class scene types.
- Add presenter notes and export templates.
- Consider optional AI assistance for summaries or grouping only when every output stays grounded in selected changes.

## Smallest Valuable Experiment

Build a read-only prototype of:

```bash
bygone present HEAD --base origin/main
```

It should:

1. derive the existing branch range;
2. create a portable manifest;
3. open a browser-hosted overview;
4. let the user pin files or hunks into an ordered scene rail;
5. save that scene order and notes as JSON;
6. replay it in a clean presenter mode.

Do not start with PR APIs, persistent reviewed state, AI summaries, or a polished export pipeline. This experiment tests the central proposition: does a live diff tour make a change faster to explain than the user's current HTML slideshow process?

### Prototype Status

The first read-only vertical slice now exists:

- `bygone present [<head>] [--base <base>]` derives an exact committed range;
- a runtime-validated, versioned manifest contains immutable range IDs, commits, text snapshots, and Git-native line counts;
- deterministic chapters order context, contracts, behavior, tests, and dependency changes;
- the browser presenter reuses Bygone's real diff renderer;
- the scene rail, previous/next controls, file navigation, and Page Up/Page Down replay the tour;
- optional environment variables can set a title, source URL, manifest output path, browser behavior, and port while the interaction model is still experimental.

The second prototype slice adds an authored story overlay without sacrificing the complete diff:

- story definitions can interleave discussion scenes and narrated file scenes;
- every scene supports a summary, bullets, tags, and a concise takeaway;
- file scenes can focus an initial diff hunk;
- chapter tabs show scene counts and jump directly to the chapter;
- previous/next chapter controls complement scene-level navigation;
- files omitted from the authored path remain in a generated complete-change appendix.

Authoring is JSON-first for now through `BYGONE_TOUR_STORY`. The next question is whether recording and pinning scenes in the UI is faster than editing that definition directly.

## Architecture Guardrails

- Keep Git extraction separate from rendering.
- Keep the manifest independent of Electron, VS Code, and hosting providers.
- Treat the renderer as an input/output component, not a singleton app global.
- Pin exported content to immutable object IDs.
- Never imply omitted changes are absent; show scope and filtering clearly.
- Make static artifacts disclose that they contain source code.
- Keep hosted-provider integration optional and read-only until there is a compelling workflow.
- Preserve Bygone's visual clarity; do not solve composition with more connectors and badges.

## Questions to Riff On

- Is the primary authored unit a file, a hunk, a commit, or a freeform scene containing any of them?
- Should recording capture every navigation step or only explicitly pinned moments?
- Is a Bygone-owned presenter shell useful, or is embedding into existing slide tools the main goal?
- Would a static HTML artifact replace the current slideshow workflow, or should Bygone primarily emit embeddable scenes and captures?
- How much annotation belongs inside Bygone versus in the surrounding demo?
- Should deterministic suggested ordering prioritize dependency flow, risk, commit order, or author-defined chapters?
- What evidence types recur often enough to deserve first-class support?
- Does the command remain `review`, or should explanation/presentation become a separate mode such as `present`, `tour`, or `story`?

## Broader Product Work

This direction still depends on the existing fundamentals:

- diff and inline-highlight correctness;
- fast rendering on large changes;
- strong commit and directory navigation;
- predictable binary and image handling;
- reusable rendering across standalone, VS Code, and web hosts;
- clean packaging and local-first operation.
