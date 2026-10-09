# Tour orientation, scene framing, and conclusions

Status: Detailed proposal; implementation has not started.

## Outcome

A reader always knows what the tour is explaining, why the current scene
exists, and which revisions or explanation stages the evidence compares.
Moving to another scene does not implicitly send the reader to a directory
overview. Every substantial authored tour opens with its purpose and closes
with the conclusions supported by its evidence.

The immediate user report is that scene changes repeatedly return to a
directory, making it unclear whether the comparison changed or the tour simply
zoomed out. Scene introductions do not adequately explain the next argument,
and tours end without a deliberate summary.

## Evidence and confidence

Inspected on 2026-10-09 against main
`8bdf0b414b2d6391f314c80283925c76f960278a` plus ongoing working-tree changes.
The source observations below describe that working tree, not an immutable
reproduction of the installed application. Recheck these functions before
implementation because presenter, export, and narration work is in progress.

- `src/tourReading.ts` builds title, optional chapter, scene introduction, and
  step reading items. It has no conclusion item. A stop is a position in this
  sequence, not an additional container of scenes.
- `web/host.js`, especially `showTourScene`, `showTourDirectoryOverview`, and
  `setSceneIntroVisible`, normally renders a directory when an introduction
  becomes active. This happens without an explicit authored `overview`.
- `src/tourDirectoryEvidence.ts` uses the tour range for walkthroughs, but the
  first and last scene panels for stacked/deconstructed overviews unless the
  author chooses endpoints. Those can differ from the preceding step's pair.
  Scene inventories can also be narrower than the complete change inventory.
- `web/host.js` displays panel labels and scene/step position, but those are
  separate pieces of orientation. The title uses the overall range, while
  chapter evidence currently inherits the first scene's overview semantics.
- `src/changeTourSource.ts` requires summary, bullets, tags, and takeaway. Its
  checks prove structure and evidence validity, not adequate explanation.
  Authored scenes support walkthrough, stacked-diff, and deconstructed-diff;
  there is no authored conclusion. Compiled/legacy discussion scenes exist,
  but are not a complete modern authoring solution.
- `src/tourNarration.ts` groups scene framing into the first step's narration,
  and `web/host.js` advances playback through scene/step positions separately
  from the reading-item sequence. A visual-only repair would leave an alternate
  path to the same disorientation and could skip new framing items.
- `docs/change-tour-format.md`, `docs/generating-change-tours.md`, and
  `skills/pr-tour-guide/SKILL.md` already require a scene thesis and useful
  context. They do not enforce an adequate transition or a tour-level closing.

Confidence is high in these code-path findings. Confidence is medium in the
proposed presentation behavior until it is tested with readers. Evidence that
would change it includes readers losing orientation with a first-evidence
preview, preferring a directory for specific explanatory tasks, or failing to
notice comparison changes despite the new labels. The reported tour itself
has not been reproduced; no browser walkthrough or comprehension trial was
performed while preparing this plan.

## Product contract

### Narrative structure and comparison identity

Keep the existing hierarchy: tour → chapter → scene → step. Do not add a
parallel hierarchy of stops or comparisons.

- A tour explains an overall change or related sequence of changes.
- A chapter groups a conceptual argument when grouping helps.
- A scene answers one question or establishes one thesis.
- A step presents evidence for that question.
- A comparison identifies evidence endpoints; it is independent of scene
  boundaries. Several scenes can examine the same comparison. One historical
  scene can examine several adjacent pairs in a revision stack.

Multiple scenes are warranted when their questions differ enough to need their
own framing. For example: establish a contract, trace its consumers, then prove
failure behavior. Split or merge based on that argument, never a fixed number
of files, steps, or slides. A one-scene tour is valid; a chapter heading should
not imply that its scenes use a single shared pair.

At every navigation position, distinguish these facts:

1. **Narrative position:** scene title and scene/step number, or opening/closing.
2. **Overall scope:** the tour's real base and head, with a meaningful title.
3. **Evidence shown:** actual displayed revisions/stages and the focused pair.
4. **File scope:** the current file or directory and whether the inventory is
   complete for the change or limited to the scene's materialized evidence.

Do not infer a PR identifier from a branch name or synthetic stage label.
Use verified existing metadata when available; otherwise use the tour title,
revision labels, and short OIDs. Remote PR discovery is outside this work.

### Persistent orientation and transitions

Add a compact context strip at the boundary between narrative and evidence.
Reuse the current header space where practical, especially on narrow windows.
An illustrative state is:

```text
Tour: Adopt the event contract · a1b2c3d → e4f5a6b
Scene 2 of 3: How callers preserve the contract
Showing: Data model (b2c3d4e) → Callers (c3d4e5f) · src/consumer.ts
```

For synthetic stages, the showing line must say `Explanation stages` and use
stage names. Keep the enclosing real range available without implying that a
synthetic stage is a commit. Display the active pair even when more panels are
visible; panning a visible panel group alone does not change that active pair.

Classify changes from evidence identity, not display labels or scene IDs:

| Transition | Reader-facing behavior |
| --- | --- |
| New scene, same real endpoints | Keep comparison identity stable; indicate `Same comparison` at the introduction. |
| Same scene, new active pair | Update the pair and announce the previous and next pairs. |
| New scene, new endpoint pair | Explicitly introduce the new comparison before its evidence-specific claim. |
| Same endpoints, different file or directory | Update scope; do not announce a new revision comparison. |
| Same endpoints, different scene inventory | Identify the scope change even if both inventories begin at repository root. |
| Real revisions ↔ synthetic stages | Explicitly identify the representation change as well as the endpoints. |
| Direct link or restored location | Show complete current orientation without inventing a prior transition. |

Do not rely on color, animations, or an ephemeral toast. Keep the destination
identity visible after any transition message disappears. Make transition text
available to assistive technology without repeatedly announcing it on ordinary
scroll/layout updates. Opening a source directly must be as understandable as
arriving through the preceding scenes.

### What an introduction displays

Replace the unconditional directory fallback with a deliberate presentation
policy. Keep continuous reading and existing outline navigation.

| Reading item | Default evidence behavior |
| --- | --- |
| Tour opening/title | Narrative framing with the overall range; no automatic directory. |
| Chapter heading | Conceptual heading; do not borrow a child's comparison as if it were chapter-wide. |
| Code scene introduction | Preview the first step's evidence, labeled `Coming up`, alongside the scene framing. Do not activate that step's annotation or count it as read. |
| Scene with an explicit directory overview | Show that authored directory comparison and its stated purpose. |
| Evidence step | Show exactly its file, pair, and anchor, with the ordinary active annotation. |
| Tour conclusion | Narrative closing; no automatic directory or stale last-step comparison. |

The first-evidence preview is deterministic for forward navigation, backward
navigation, direct links, refresh, and mode restoration. Do not retain the
previous scene's code under a new introduction: it can misrepresent the new
claim and makes the landing depend on navigation history.

During a narrative-only opening, chapter, or conclusion, show the tour scope
and indicate that no code comparison is displayed. Do not fabricate a focused
pair to satisfy renderer state. The reader can still explore Files or Commits
and return to this exact narrative position.

An explicit overview remains a useful tool when the explanation is about file
distribution, package boundaries, or where a change propagates. Preserve its
exact `path` and `comparison` semantics, including omitted-file behavior. New
authoring must explain why the directory is being shown; a directory is not a
generic background for prose. Existing overview-free tours adopt the new
default in updated viewers. Existing explicit overviews continue to display.

Legacy text-diff/discussion scenes and image-only guides need explicit fallback
policies: preserve file evidence for text-diff, use narrative-only discussion,
and preserve the current image-guide behavior of skipping redundant structural
stops. Newly authored opening/conclusion content must still be reachable in an
image guide; only absent or redundant structure is skipped.

### Scene framing and authoring quality

Before the first evidence step, the introduction must answer:

- What question are we answering, and why does it matter?
- How does it follow from what was just established?
- What evidence will we inspect, and what should the reader notice?
- Are we continuing the same comparison or changing its scope?

Use the existing scene `summary` and `bullets` for this prose rather than
requiring a collection of repetitive new fields. Use the runtime identity
strip for factual endpoint orientation. Keep `takeaway` for the retained scene
conclusion. Do not mechanically repeat the summary in bullets and takeaway.

For example:

> We have established the event contract. This scene follows its callers to
> check whether they preserve that contract, beginning with construction and
> ending with error propagation. Watch for the point where optional input
> becomes a required value.

This framing is more informative than `Update callers` or a list of filenames.
The comparison strip supplies `Same comparison: A → B` or the actual transition.
The prose need not manually repeat hashes that the presenter already knows.

Do not auto-generate interpretive explanations from file counts or identifiers.
Validation can require narrative fields and check references, but judging
whether the introduction makes sense remains an author/reviewer responsibility.
Use authoring guidance and a concrete self-audit, not a claim that schema
validation proves comprehension.

### Opening and conclusion

Add explicit, mode-scoped opening and conclusion content. The opening belongs
to the existing title position. It establishes the problem, intended outcome,
available project/PR context, and route through the explanation. The conclusion
is a new final reading item after the last authored scene's last evidence step.

The conclusion should synthesize:

- what changed and what the reader should retain;
- what the inspected evidence actually established;
- material limitations or unresolved questions, when present.

It can be short for a small change. It must not introduce unsupported claims,
claim exhaustive review, or promote a scene takeaway into a fabricated
tour-wide conclusion. Link back to evidence with supported document links
where helpful. No dummy file, anchor, or code step is required to author it.

The conclusion appears in the outline and search, has a copyable location,
participates in keyboard navigation and narration, and restores after file
exploration or mode changes. Advancing from the last step reaches it; advancing
beyond it stops. Backward navigation returns to the last authored step.
Narration says the conclusion once and then finishes.

Each independently authored mode owns its opening and conclusion. A historical
closing must not silently become a deconstructed closing. Legacy tours without
these fields keep their existing content and ending; an updated viewer must
not invent a recap. The authoring skill should normally include both in new
substantial tours, with an explicit self-audit explanation if omitted.

## Format and implementation design

### Versioned authoring contract

Reserve the next supported source and manifest version for the extension
(expected version 5; confirm at implementation time). Keep versions 1, 2, and 4
readable and preserve the deliberate rejection of retired version 3.

Proposed additions, to be finalized with the schema implementation:

```yaml
version: 5
opening:
  title: Why this change matters
  summary: The problem, intended outcome, and route through this tour.
  bullets:
    - The first question we will answer.
conclusion:
  title: What we established
  summary: The supported overall conclusion.
  bullets:
    - A result established by the walkthrough.
    - A remaining question, when applicable.
```

This is an illustrative fragment, not a valid standalone tour. Existing range,
anchors, connections, chapters, and evidence remain required as applicable.
`opening` and `conclusion` are optional objects on the root narrative and each
independent authored mode, with nonempty title/summary and optional bullets.
Do not require irrelevant tags or a second takeaway that repeats the summary.
Add a nonempty `purpose` to explicitly authored v5 directory overviews.

Keep these framing objects outside the evidence-scene union. That avoids
pretending a conclusion has a file, step zero, stack, or coverage contribution.
Compiled mode records preserve their own framing. Derived fallbacks may carry
the same framing only when they preserve the same narrative; do not copy text
between independently authored modes or across incompatible evidence claims.
When a fallback changes meaning, omit the unsafe framing and report the need
for an explicit authored mode rather than inventing replacement prose.

Do not accept new keys silently under v4. Audit exact version equality checks
in parser/compiler/export code so v4 features remain valid in the new version.
Older readers must reject the new format with the existing upgrade guidance.
Recompilation and HTML export must include a compatible viewer version.

### Comparison context derived from evidence

Add a small pure resolver for the current reading item and its evidence view.
Its result separates overall range, representation, displayed endpoints,
active pair, and file/inventory scope. A second pure operation compares old and
new results to produce the transition classification.

Use resolved OIDs and ordering for real endpoint identity. Synthetic identity
must include the owning document/scene and stage identity; equal stage labels
in different scenes must never be treated as identical snapshots. Display
labels are presentation only. Do not deduplicate independently authored
synthetic evidence based on names or content resemblance.

Keep the resolver as the common source for the context strip, directory labels,
active-pair reporting, and transition wording. Avoid a second independently
mutable comparison state that can drift from the renderer. Build on
`tourDirectoryEvidence.ts` for actual directory evidence, not a replacement
implementation of diff or Git semantics.

### Reading, narration, and restoration

Make reading-item identity the authoritative narrative cursor, including a
distinct `conclusion` item. Evidence positions remain available for rendering
steps, but conclusion/opening positions do not masquerade as scene zero or the
last step. Audit all callers that assume every location contains a valid
scene/step pair.

Adapt narration so it follows the same semantic order as manual navigation:
opening → chapter/scene framing → evidence steps → conclusion. Speak framing
once; do not replay it at step one after narrating the introduction. On direct
entry to a later step, supply concise orientation without forcing the reader
back to the start. Pausing, resuming, exploring files, or switching modes must
not duplicate or skip the closing. Coordinate with concurrent narration work
before changing this path.

Extend deep-link focus with a mode-scoped conclusion target and retain the
existing title target for the opening. Update parsing, serialization,
resolution, browser fragment/query compatibility, local desktop links, search
results, exports, and saved per-mode locations together. An absent conclusion
target returns a precise error instead of landing on an unrelated scene.

### Expected implementation areas

| Area | Files to inspect/change |
| --- | --- |
| Source/manifest contract and compilation | `src/changeTourSource.ts`, `src/changeTourManifest.ts`, `src/changeTour.ts`, `schemas/change-tour-source.schema.json` |
| Identity and directory evidence | New focused resolver beside `src/tourComparison.ts`; `src/tourDirectoryEvidence.ts` |
| Reading and saved state | `src/tourReading.ts`, `src/tourNavigation.ts`, `src/tourZoomSession.ts` |
| Narration and playback | `src/tourNarration.ts`, `src/tourNarrationPlayback.ts`, host integration |
| Presenter and layout | `web/host.js`, `web/index.html`, `web/presenter.css`; shared renderer changes only where required |
| Links, search, and coverage | `src/deepLink.ts`, `src/tourSearch.ts`, `src/tourCoverage.ts` |
| Desktop and exports | `standalone/index.html`, `standalone/main.js`, workspace host, `cli/tourFile.js`, `cli/tourExport.js`, export viewer integration |
| Authoring and documentation | `skills/pr-tour-guide/SKILL.md`, format/generation/presenter docs, representative examples |

Treat the repository's distributable skill as the source for guidance changes.
Check how project skill copies are maintained; do not independently rewrite
global installed skills or global rules as part of this implementation.

## Delivery sequence

1. **Reproduce and establish fixtures.** Capture a same-comparison scene change,
   a stacked active-pair change, a synthetic overview transition, and tour end.
   Include the user's offending tour when available; otherwise record that
   limitation and use checked-in examples. Reconcile concurrent host/narration
   changes before editing. Record what each current transition shows.
2. **Resolve and display comparison context.** Implement/test the pure identity
   and transition resolver, then wire the persistent strip to real renderer
   evidence. This can improve existing tours before the format extension.
3. **Remove implicit directory landings.** Implement the introduction policy,
   explicit-overview behavior, inventory labels, direct-entry behavior, and
   matching narration view changes. Verify same-comparison continuity.
4. **Add opening and conclusion end to end.** Land the versioned contract,
   compiler, reading cursor, narration, outline/search, links, restoration,
   and export handling as a coherent feature. Avoid exposing schema support
   before the viewer can correctly navigate the resulting document.
5. **Strengthen authoring and repair representative tours.** Update skill and
   docs with upfront scene purpose, meaningful transitions, explicit overview
   rationale, and evidence-grounded closings. Repair at least one small and
   one multi-scene/stacked example without manufacturing additional scenes.
6. **Run the acceptance matrix and reader check.** Verify browser, desktop,
   and exported viewers. Ask a reader to identify the current question,
   comparison, and conclusion; record confusion and revise before declaring
   the presentation behavior complete.

Implementation stays on branches based on `main`. Copy the relevant contract
into implementation context; never merge the orphan planning branch into
development. No implementation commit or release is part of this planning task.

## Verification and acceptance

### Automated behavior

- Parser/compiler tests accept the new framing, reject invalid/unknown keys,
  retain old inputs, preserve mode ownership, and reject unavailable targets.
- Identity tests distinguish same endpoints under different labels, different
  endpoints under identical labels, real versus synthetic evidence, reversed
  endpoint order, scoped inventories, and active-pair versus viewport changes.
- Reading tests cover opening through conclusion in both directions, absence
  of optional framing, one-scene tours, multiple chapters, and image guides.
- Narration tests prove introductions and conclusions are spoken exactly once,
  and manual, continuous, direct-entry, and restored navigation converge on
  the same evidence and narrative identity.
- Host regression tests prove that scene introductions without `overview` do
  not emit directory evidence; explicit overviews retain exact endpoints and
  scope; narrative-only items clear stale evidence and active-pair markers.
- Link, search, and restoration tests cover conclusion selection, invalid
  targets, mode switches, Files exploration, refresh, and Return to tour.
- Export tests cover Minimal and Full exports and applicable offline viewer
  configurations. Framing adds no fake evidence or changed-file/coverage count.
- Run focused tests during implementation, then `npm test` and `npm run lint`.
  Exercise relevant Electron reading and export smoke tests once integration
  is complete. Record skipped platform checks explicitly.

### Reader-facing acceptance matrix

| Scenario | Required result |
| --- | --- |
| Two scenes examining A → B | The next question is explained up front; the pair remains visibly A → B and no directory appears unless authored. |
| Stacked tour moves A → B to B → C | The active pair change is evident even if the same file and panel layout remain visible. |
| Step pair B → C followed by overview A → C | The cumulative comparison and reason for showing it are explicit. |
| Two synthetic scenes both label a panel `Stage 1` | Their identity is not conflated; ownership and enclosing real range remain correct. |
| Scene inventory narrows to selected files | The viewer does not imply that this is the full repository change. |
| Direct link to a scene or later step | Purpose/context and exact current evidence are understandable without prior navigation. |
| Last step followed by conclusion | The tour summarizes its supported findings; no dummy evidence or directory transition appears. |
| Explore a file from the conclusion, then return | The same conclusion and mode are restored, including narration state as applicable. |
| Switch Historical/Deconstructed modes | Each retains its own narrative position and closing; no invented correspondence. |
| Legacy tour without framing fields | It opens successfully with improved orientation, preserves authored content, and invents no conclusion. |

Check at 1440×1000 and 1100×800, plus the narrow navigator-overlay layout.
Long prose and long revision labels must remain readable without burying the
current scene's purpose. Check keyboard focus, screen-reader labels, reduced
motion, scrolling, and narrator playback. Verify that the preview is clearly
upcoming evidence and does not look like an already selected/read step.

For the reader check, pause at a same-pair scene transition and a changed-pair
transition. Ask which question is being answered, which endpoints are shown,
and whether they changed. At the conclusion, ask what the tour established and
what remains uncertain. Passing schema tests or reducing controls is not
evidence that this comprehension goal has been achieved.

## Scope boundaries and risks

- This work changes tour presentation and authoring, not diff matching,
  repository comparison semantics, edit permissions, or Git history discovery.
- Do not introduce a new stop hierarchy, a generic slide editor, automated
  prose generation, automatic PR fetching, or a new model service.
- Keep any workspace view-selector redesign independent. This plan supplies
  context for the selected view; it does not change which views exist.
- A first-evidence preview may still distract from framing. The reader trial
  should compare it with a narrative-only scene introduction; choose one
  consistent default based on the result, without proliferating per-scene
  presentation settings.
- Too much persistent context can consume code space. Prioritize the current
  scene and actual focused pair; make long provenance expandable while keeping
  the real/synthetic distinction and short endpoint identity visible.
- The source extension affects strict version checks, portable manifests,
  saved positions, and independently authored modes. Treat those as one
  compatibility surface rather than shipping a renderer-only conclusion.
- Existing tours can still contain poor prose after the UI repair. The
  representative authoring repairs and comprehension check are part of done.

## Related work

- [Tour presentation review](../ideas/tour-presentation-review.md) records an
  earlier investigation. Its recommendation for intentional introductions and
  conclusions is relevant; its old defect inventory is not the current baseline.
- [Paired comprehension implementation](paired-comprehension-implementation.md)
  and [review comprehension](review-comprehension.md) supply the evidence-led
  reader-check approach.
- [Multi-panel tours](multi-panel-diff-tours-for-stacked-prs.md),
  [deconstructed diffs](deconstructed-diffs.md), and
  [tour zoom modes](unified-tour-zoom-modes.md) document earlier contracts.
  Follow current source behavior where those historical plans are superseded.
- [Tour narration](tour-text-to-speech.md), [deep links](deep-linking.md), and
  [HTML exports](self-contained-html-tours.md) are integration surfaces.

## Planning completion

This plan is based on source and existing planning documents. Its schema
fragment is proposed, not supported by the current CLI. Implementation,
runtime tests, visual QA, and reader trials remain to be performed. The first
implementation deliverable is a reproducible transition fixture and verified
comparison-context contract, followed by the dependent slices above.
