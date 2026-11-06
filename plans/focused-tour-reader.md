# Focused tour reader

Status: implemented locally on 2026-11-06; human comprehension, assistive-technology, and device-audio validation remain outstanding. Not installed, pushed, or published.

Inspected 2026-11-06: `local/tour-quality-seven-rounds` at `d567e1ee` (clean). This proposal follows [optional-tour navigation](optional-tour-navigation.md) and [tour orientation](tour-orientation-and-narrative-framing.md). It refines their presentation; it does not treat prior plans as implementation evidence. The planning checkout contains pre-existing edits, which this work preserves. Remote refs were not refreshed.

## Outcome and recommendation

Make the reason for a change, its behavior, and the consequential decisions the first things a reader sees. Keep a clear current position and route without repeating mechanical instructions. Make evidence and optional explanations easy to find at the point of interest.

Use a quieter default, with contextual disclosures rather than a compact/verbose preference or a new reader mode. Keep existing arrow navigation and make Escape a predictable route back to reading at the same location. Alternate key families and a command menu are rejected for this proposal.

## Observed sources of clutter at the proposal baseline

- `web/host.js` renders scene title, file path/type counts, and takeaway in outline rows, then repeats step numbers and optional-branch status below them. Chapter/scene groups start expanded unless explicitly collapsed.
- `src/tourOrientation.ts:describeStepOrientation` generates progress, unchanged-revision statements, and repeated full paths. These are UI output, not necessarily authored prose.
- `web/host.js:renderTourStepState` renders a persistent next-destination/skip explanation whenever a tour contains branches. `buildBranchNavigation` adds another progress/trail statement.
- `src/tourNarration.ts:buildReadingNarrationUnit` includes orientation in the sentence stream. Continuous audio already reduces some repetition, but visual and speech changes need to stay aligned; CSS-only hiding would leave invisible sentence targets.

## Design accepted for implementation

### Reading surface

Keep the step title and authored explanation dominant. Put a single compact progress indicator beside Prev/Next, labeled by scope (for example, `Main · 4/4`). Resolve the count from the same active route as navigation; introductions and conclusions must not cause misleading step counts. Inside optional material show local progress and a short parent breadcrumb; retain main position in the return context.

Remove generated “Keep the same revisions” and “Continue in …” sentences. Move the full path and exact revision pair to an expandable Evidence context control and the evidence panel header. Use a basename by default where unambiguous, with the full path available on activation/copy; disambiguate duplicate basenames visibly. Keep synthetic explanation stages clearly labeled whenever evidence is shown. Do not hide unavailable evidence, an invalid target, or a comparison change that affects interpretation.

When evidence context changes, show a compact persistent context cue beside the evidence control until the next step. On direct entry, make the current context recoverable without assuming the previous step was read. Avoid transient toast-only context. Audio should announce essential changed context or direct-entry context once, but should not recite unchanged paths or step counters as sentences. Preserve stable narrative sentence identity and highlights.

At a step with optional material, show one local action such as `Explore: Why this approach?` or `Explore detail (2)` when a chooser is needed. Only here, explain once that Next skips optional detail. For steps without branches, show no skip explanation. Within detail, provide `Return to [parent title]`; at its endpoint provide `Continue main tour` or `Continue parent detail`, using the existing immediate-parent semantics. Keep endpoint meaning explicit: Next does not silently enter or leave a branch.

Routine checks stay collapsed behind `Checks & evidence`. The full repository/range/stats, audience assumptions, and authoring diagnostics remain in Tour details. Warnings that change trust in the displayed result stay visible. Do not move authored tradeoffs or limitations into metadata merely because they are inconvenient to display.

### Outline

Use titles as the primary outline content. Remove routine paths, type labels, takeaway excerpts, per-row counts, and “Outside reading path” sentences. Mark the current item with more than color (for example a marker plus `aria-current`).

Initially expand the active chapter/scene and collapse inactive scene contents. Show main-path step titles within the active scene. Collapse optional paths under their owner with a short `Optional` label and meaningful title. Elide a chapter wrapper only when it has no independent title/content to convey; never delete meaningful chapter context merely to flatten nesting.

Respect manual expansion/collapse for the session. Following the reader may reveal an unvisited active ancestor; it must not repeatedly reopen a group the user deliberately closed or move keyboard focus. A collapsed ancestor still indicates that it contains the current item. Expansion never enters a branch or changes narration.

Keep the outline available at desktop widths; on narrow layouts use an explicit Outline drawer with a current-section label. An ordinary hide/show control is sufficient, not a preference panel. No automatic panel flapping while scrolling.

### Controls and Escape recovery

Keep one navigation row with Prev, progress, Next, and the relevant detail/return actions. Hide structurally irrelevant detail/return controls rather than displaying a permanent bank of disabled controls. Keep Prev/Next stable at endpoints, with an accessible explanation of the boundary. If hiding a focused control, restore focus to a stable control; do not move controls under an ongoing pointer interaction.

Keep existing Up/Down step navigation, Shift+Up/Down sentence navigation, Right to explore, and Left to return to the owning step. Enter retains native button/link activation and the existing focused-navigation alias. Sentence controls remain available independently of speech. Put shortcut help in a small disclosure; do not introduce a command menu, alternative chord family, density preference, or explicit reader mode.

Define the default state as reading the current passage on the current path, with reader navigation focused and no transient interaction owning its keys. Escape recovers this state without changing the current step, branch, sentence cursor, scroll position, or playback state. Expanded informational sections and the outline need not all collapse; this is focus recovery, not a visual reset.

Resolve unmodified Escape from the innermost owner outward:

1. An active composition, editor completion popup, menu, or dialog owns Escape first. Dismiss only that interaction using its cancellation contract; retain draft data and restore focus to its invoker. Never also dispatch reader navigation from the same key event. A further press may be needed when focus returns to another protected context. Browser-owned UI remains browser-owned.
2. When no transient child owns Escape, a tour search field, outline, evidence viewer, or other reader-owned interaction yields focus to the stable reader navigation group. Clear a non-editable prose selection when returning to reading so it cannot continue blocking arrows. Do not clear input values or discard edits. Native search-field Escape behavior may consume a first press; the next unconsumed press must have a recovery route. Widgets must not unconditionally swallow every Escape once their own dismissible state is gone.
3. In ordinary prose or on reader controls, Escape clears any remaining non-editable selection and focuses reader navigation. Once already there, it is a no-op. Repeated Escape must converge on this state; held-key repeats must not dismiss multiple layers.

A visible keyboard focus treatment on the navigation group confirms recovery. Avoid a permanent “mode” badge or repeated toast. Help can state `Esc: back to reading`. Menu/dialog dismissal preserves familiar focus restoration; the following press moves to reading if necessary. The resolver applies only within the narrative tour and must not steal Escape from unrelated Compare/History or host behavior.

This deliberately removes Escape as an alias for ReturnToParent. Left Arrow and the labeled Return parent action remain structural navigation. An optional path is a valid reading location, not a modal that repeated Escape must unwind. This makes recovery safe to repeat without accidentally leaving content. The existing first-arrow behavior outside protected widgets remains unchanged; Escape is a reliable recovery action, not a prerequisite for every navigation.

## Implementation boundary and slices

1. Remove generated repetition and make evidence context contextual. Start in `src/tourOrientation.ts`, `src/tourNarration.ts`, and the reading document/branch/navigation renderers in `web/host.js`. Represent shared progress/context as structured data rather than parsing presentation sentences.
2. Simplify the outline and toolbar using `web/index.html`, `web/presenter.css`, and outline state in `web/host.js`. Preserve deep links, branch ownership, return positions, explicit user expansion, and current path semantics.
3. Implement Escape recovery before the ordinary native-key-owner guard, while respecting consumed events, composition, open dialogs, and widget cancellation. Centralize the recovery result as a named domain action; remove the Escape-to-parent alias from `src/tourReaderKeyboard.ts`, tooltips, accessible labels, and documentation. Audit existing document/window Escape listeners so one event performs one action. Buttons and arrow shortcuts continue to share route resolution.
4. Rebuild a representative offline tour and run bounded reading/navigation checks before broad rollout. Keep implementation on a development branch carrying the current feature commits; never merge this orphan planning history into code.

No manifest/schema change, content rewrite, new preference framework, whole-app command palette, or Compare/History redesign is required. Do not install, publish, or push as part of this planning pass.

## Acceptance and evaluation

Use shared generic fixtures covering a four-step same-file tour, a real file/revision change, duplicate basenames, image/text/diff scenes, one/multiple/nested optional branches, and a long multi-chapter outline. Exercise narrow layouts and direct links. Use the same fixtures for browser checks and human trials.

- A default step shows its title, explanation, and relevant actions before routine metadata. An unchanged file/revision generates no repeated prose and no sentence-navigation stop. Progress occurs in one primary location.
- A reader can locate the current position, predict what Next will read/skip, open optional detail, and return without losing the saved position. Evidence identity and exceptional warnings remain discoverable or visible as appropriate.
- A five-minute skimmer can state why, what, and the key decision/tradeoff, find one supporting check when requested, and distinguish optional detail from the main route. Compare comprehension, first useful answer time, wrong turns, and unnecessary UI interactions with the current baseline; word count alone is not success. Use held-out tour content as well as the motivating example.
- Test real key events after clicking prose, controls, outline, search, and evidence. Cover text selection, editors, nested menus/dialogs, IME composition, repeat, and modifiers. Repeated Escape must eventually restore working arrows without changing reading location, branch, sentence cursor, scroll, playback, or draft data. At the default state, further Escape is a no-op. A single event dismisses at most one layer; held-key repeats do not cascade. Test inside nested optional branches to prove Escape cannot return to a parent. Verify keyboard-only and screen-reader operation in live and offline hosts.
- Narration in stopped/playing/paused states, silent sentence selection, direct-entry context, and branch return must target visible narrative text and avoid reading hidden metadata. Use actual audio as well as mocks.
- Run targeted orientation/narration/navigation tests, live/offline branch and export smoke checks, lint, and screenshots at wide/narrow widths. Update user-facing help and generic authoring guidance only where behavior changes.

## Evidence and confidence

High confidence that repeated generated orientation and multi-line outline rows cause avoidable duplication: confirmed in source at the baseline above. Medium confidence in the proposed default hierarchy until a rendered prototype is tried. Medium confidence in the Escape recovery interaction until tested with actual nested widgets and assistive technology. A widget that consumes Escape indefinitely, unexpected focus loss, or accidental reading movement would require revising the recovery implementation. Source inspection confirms that the current native-key-owner guard blocks reader Escape in protected widgets and that Escape currently aliases ReturnToParent; recovery therefore requires behavior changes, not only revised help.

W3C documents Escape dismissal and return of focus for modal dialogs: [Dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). The broader reader-recovery behavior is a product proposal, not a requirement of that pattern. Previously considered command-menu and home-row shortcuts are not part of this scope.

## Implementation evidence

Implemented on `local/tour-quality-seven-rounds` in two local commits:

- `a6bb4104 fix(tours): let Escape restore reading focus without leaving detail`
- `42fcaac1 feat(tours): focus the reader on claims and optional detail`

Escape now restores reading focus without structural navigation; menus/dialogs and focused disclosures consume the first dismissal, and the narrow Outline drawer closes before reading recovery. Held repeats do not cascade. Left Arrow and the labeled Return action retain parent navigation.

The reader now uses titles-only outline rows with explicit expansion state, one route-relative progress indicator, contextual Explore/Return controls, collapsed Evidence context and Keys disclosures, and a narrow Outline drawer. Authored prose precedes compact evidence-change cues. Unchanged evidence generates no repeated orientation or hidden sentence stops. Duplicate basenames are disambiguated. Meaningful chapter wrappers remain intact.

Verification passed: compilation, 91 tour-related unit tests, live/offline branch navigation, offline export/narration checks, image-tour smoke checks, desktop workspace smoke checks, lint, and whitespace checks. Wide and narrow generic-fixture screenshots were inspected. Escape classifier tests also passed in the first implementation slice. The desktop harness exercised its browser reading helper and native/embedded tours.

A representative existing offline artifact was rebuilt from unchanged source with the new runtime. Frozen experiment artifacts were preserved. No private content was added to this plan.

High confidence in the tested navigation behavior; the automated checks and rendered generic fixtures support it. Human five-minute comprehension trials, screen-reader sessions, actual device speech, and the full unrelated test/release suite were not run. The earlier rendered private-tour inspection restriction remains respected. Human wrong turns, unclear optional-path expectations, or assistive-technology focus failures would require revisiting the interaction. The historical confidence assessment above describes the proposal baseline, not the implemented test results.
