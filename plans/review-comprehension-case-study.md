# Paired code and prose review: tour navigation

Status: Historical first agent-only case study, inspected 2026-09-29. The
findings below precede the repairs; see the [implementation record](paired-comprehension-implementation.md)
for their later disposition and integration. This is preliminary evidence for
[Review comprehension](review-comprehension.md), not a completed reader trial.

## Result

The useful finding is a mismatch between models: the presenter offers independent
tours, the compiler retains an older depth-based representation, and parts of
the explanation still teach that older representation as current behavior.
Understanding the change requires reconstructing which model governs each layer.

There is also a concrete improvement already in the change: mode positions no
longer depend on inferred correspondence between narratives. That removes both
code machinery and an explanation burden. A comprehension review should record
reasoning removed as well as reasoning introduced.

## Scope and method

Repository: Bygone. Reviewed local branch `feat/tour-modes-and-directory-overviews`.

- Base: `901a193203e4840dbf6e06c6a273fac7f2d713bd`
- Head: `2b5add94769bf5fc4c22d89f60be07886913a4b7`
- Focus: authored modes, mode restoration, directory overview evidence, authoring
  instructions, and the navigation example. Surrounding navigation code was
  inspected where needed; this is not an exhaustive review of the whole commit.

All source paths and line numbers below refer to that head in the implementation
worktree, not files on this orphan planning branch.

For each reader question, trace the code that determines the answer, compare
the prose, then propose the smallest change that removes an inference or an
unnecessary rule. Separate factual contradictions from maintainability judgments.
Do not equate file length, word count, or branching with reader difficulty.

## Findings and proposed changes

### 1. The authoring guide teaches two incompatible mode models

**Confirmed documentation defect; high confidence.** A reader trying to author
a two-revision Historical tour gets incompatible answers in the same document.
`docs/change-tour-format.md:43` describes independent Historical and Deconstructed
tours, including two-endpoint Historical stacks. At line 194 the guide instead
says modes follow maximum authored depth and two-panel stacks collapse into
Final diff. The navigation example repeats the old “final endpoint walkthrough”
description at `examples/navigation-lab.bygone.yaml:223`.

The current presenter chooses available tours from `manifest.tours` or root
scene fallback (`web/host.js:146`), not `zoom.modes`. The two-panel Historical
case is explicitly exercised in `test/changeTourAuthoredModes.test.js:127`.

**Proposed prose:** replace the old depth paragraph with:

> History and Compare support unguided exploration. Historical and Deconstructed
> tours appear when authored content is available. A Historical tour can explain
> just two revisions. Each mode remembers its own position during the session;
> switching modes does not map your step into another narrative. Final diff is
> a base-to-head preset in Compare.

The following paragraph also needs the actual authoring distinction:

> In version 2 root `chapters`, a deconstructed scene requires real `stack`
> evidence and endpoint `steps` for compatibility. A scene authored inside
> `tours.deconstructed` may omit both. Explicit Historical content supplies its
> own explanation of real revisions.

That distinction is enforced at `src/changeTourSource.ts:301`; simply deleting
all references to required endpoint steps would introduce another error.

**Code counterpart:** name and isolate legacy zoom construction and validation
as compatibility work. Keep serialized fields unchanged. Coverage still reads
`zoom.final` as a fallback (`src/tourCoverage.ts:97`), so deleting the old model
is not a safe cleanup. A small boundary around it would let a maintainer answer
“what modes appear?” without first understanding legacy depth rules.

**Expected reduction:** one current product model, with the compatibility
exception stated where authors and maintainers encounter it. Confidence in the
documentation correction is high; benefit from extracting compatibility code
is a hypothesis to test, not a measured result.

### 2. A navigation method still suggests an effect it no longer has

**Maintainability finding; high confidence in the observation.**
`src/tourZoomSession.ts:28` retains a no-op `navigate()`; `enter()` accepts an
ignored mapping argument at line 42. The host calls `navigate()` from
`markZoomNavigation()` (`web/host.js:101`), so following that apparent dependency
adds no explanation of current behavior. Tests also retain calls to it.

**Proposed code change:** remove the unused session method and mapping parameter
from this internal API after confirming supported external consumers. Preserve
the host's cancellation of pending restoration: `markZoomNavigation()` still
clears `zoomRestore` and must not be removed wholesale. Name that remaining
operation for its actual effect, such as `cancelPendingModeRestore`.

**Matching explanation:** “Leaving a mode saves its current position; returning
restores that mode's saved position, or starts at the beginning.”

**Expected reduction:** callers no longer imply a dirty-state protocol or mapping
that does not exist. Repository search found the host and tests as callers;
external consumers were not audited. An external compatibility requirement
would change the removal recommendation to deprecation at a documented boundary.

### 3. Restoring a reading position requires reconstructing several hidden rules

**Maintainability hypothesis; medium confidence. No runtime failure established.**
A reading position includes a saved step, a visible parent, and possibly a file
opened from a directory overview. Those are distinct facts: being at a chapter
does not erase the step to resume, and opening a file does not change what the
narration describes.

The rules are spread across capture (`web/host.js:108`), mode entry and rollback
(`:308`), refresh loading (`:1040`), scene selection (`:1305`), parent selection
(`:1901`), and URL writing (`:2036`). For example, scene selection clears directory
evidence before it can be rebuilt, while parent selection can retain evidence.
The URL preserves the step even when it identifies a parent view.

**Proposed first change:** document the independent facts and restoration order
beside the capture/restore code; use a shared narrative restoration operation
for normal mode entry and rollback where their semantics match. Keep asynchronous
renderer restoration and its request token explicit. Do not collapse parent,
step, and evidence selection into one enum that loses remembered context.

**Matching reader explanation:** “Opening a parent or an overview file keeps
your saved step. Resume returns to that step. Overview returns to the directory
comparison; its narration continues to describe the overview.”

There is a prose-only improvement here even without a refactor. The example at
`examples/navigation-lab.bygone.yaml:180` leads with “The step ID remains in the
URL” and “The view parameter records which level is being read.” Those facts
are relevant code evidence, but the reader first has to infer their purpose.
Reverse that order:

> Selecting a parent keeps your current step ready to resume. The URL preserves
> the step and selected reading level, so refreshing restores both.

This preserves the technical detail while stating the behavior it explains.
It is a readability judgment, not a factual correction.

**Check before accepting a refactor:** cover a later step → overview file →
another mode → return; parent view → refresh; and failed mode entry → restoration.
Assert both the shown evidence and the saved step. The focused tests run for this
case study do not establish those complete browser sequences.

**Expected reduction:** one explicit restoration contract instead of inferring
it separately from success, rollback, and refresh paths. If these paths need
materially different ordering, retain that difference rather than forcing a
common abstraction.

### 4. “All changed files” omits an important browsing condition

**Confirmed documentation gap; high confidence.** `docs/present.md:39` says the
Files rail browses all changed files independently of the narrative. During a
directory overview, the host disables files outside that overview's available
evidence (`web/host.js:1750`), and selecting a file uses the overview comparison
(`:1668`). The reader must discover this qualification much later in the guide
or by interpreting disabled controls.

**Proposed prose at the first Files explanation:**

> Files lists the change set. While a directory Overview is active, files open
> in its comparison; files outside that comparison are disabled. Opening a file
> keeps the overview text and saved step. Select Overview above the diff to
> return to the tree, or Resume step to continue the tour.

Keep general step-browsing instructions alongside this qualified case. This is
a documentation fix, not a recommendation to change the browsing restriction.
The separate question of whether the restriction is desirable remains outside
this review.

The overview section also generalizes omitted-file handling too far
(`docs/present.md:153`). `src/tourDirectoryEvidence.ts:17` constructs stacked and
deconstructed evidence from materialized scene files; only the walkthrough path
collects omitted entries from the tour inventory. Qualify that promise:

> Authors can limit any overview to a subdirectory. Walkthrough overviews retain
> omitted-file notices from the review inventory. Stacked and deconstructed
> overviews compare the files materialized in their scene panels.

## Reasoning already removed

The prior `TourZoomSession` used dirty state, epochs, an origin, and a nearest
file/line mapping heuristic. The new implementation stores a cursor per mode
and returns that cursor or a default. The benefit is a removed obligation to
explain why a location was guessed or why a saved cursor lost precedence.

Likewise, `buildTourDirectoryEvidence` takes a tour and scene, not a current
step. Its default first-to-last comparison is stable by construction; a focused
test changes the saved step pair and checks unchanged evidence. This aligns a
short product rule with a function boundary. Preserve these simplifications.

## Validation and limits

- Ran `npm run compile` successfully, including TypeScript checking.
- Ran `node --test test/tourZoomSession.test.js test/changeTourAuthoredModes.test.js test/tourDirectoryOverview.test.js test/tourDirectoryEvidence.test.js test/renderCompleteToken.test.js`:
  15 tests passed, zero failed or skipped.
- Inspected current implementations, callers, parent diff, docs, and focused tests.
  A separate prose pass was checked against code before integration.
- Did not run the full suite, lint, browser interactions, narration, packaged
  desktop checks, or an external-consumer compatibility audit. No implementation
  was changed. Passing tests establish selected behavior, not readability.
- Did not inspect employer code, compare against an independent ordinary-review
  baseline, measure reader time, or test human comprehension.

## Decision and next experiment

Continue the paired-review experiment; do not build a dashboard or score yet.
This case produces actionable corrections and bounded refactor candidates, but
ordinary careful review could also find them. Incremental benefit is unproven.

The smallest follow-up is the contradictory-prose correction and the inert
navigation API cleanup, with compatibility checked before removal. Preserve
before/after artifacts. Ask fresh readers to predict available modes, restoration
behavior, and overview file scope, and to identify the evidence for each answer.
Use matched changes or counterbalanced groups, not the same reader's second
pass as an unbiased comparison. Record correctness, clarification requests,
navigation effort, and time separately.

The original proposal also requires a second compatibility-focused change and
a maintainer-checked answer key. Neither is complete. This first agent-only
inspection supports trying the method; it does not establish a productivity gain.
