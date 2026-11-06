# Focused tour reader

Status: proposed; product changes are not implemented by this plan.

Inspected 2026-11-06: `local/tour-quality-seven-rounds` at `d567e1ee` (clean). This proposal follows [optional-tour navigation](optional-tour-navigation.md) and [tour orientation](tour-orientation-and-narrative-framing.md). It refines their presentation; it does not treat prior plans as implementation evidence. The planning checkout contains pre-existing edits, which this work preserves. Remote refs were not refreshed.

## Outcome and recommendation

Make the reason for a change, its behavior, and the consequential decisions the first things a reader sees. Keep a clear current position and route without repeating mechanical instructions. Make evidence and optional explanations easy to find at the point of interest.

Use a quieter default, with contextual disclosures rather than a compact/verbose preference or a new reader mode. Keep arrows for now and provide an explicit command entry point. Adding alternate shortcuts alone will not remove the overload of plain arrows; revisit that separately after testing the alternative.

## Observed sources of clutter

- `web/host.js` renders scene title, file path/type counts, and takeaway in outline rows, then repeats step numbers and optional-branch status below them. Chapter/scene groups start expanded unless explicitly collapsed.
- `src/tourOrientation.ts:describeStepOrientation` generates progress, unchanged-revision statements, and repeated full paths. These are UI output, not necessarily authored prose.
- `web/host.js:renderTourStepState` renders a persistent next-destination/skip explanation whenever a tour contains branches. `buildBranchNavigation` adds another progress/trail statement.
- `src/tourNarration.ts:buildReadingNarrationUnit` includes orientation in the sentence stream. Continuous audio already reduces some repetition, but visual and speech changes need to stay aligned; CSS-only hiding would leave invisible sentence targets.

## Proposed experience

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

### Controls and shortcut candidates

Keep one navigation row with Prev, progress, Next, and the relevant detail/return actions. Hide structurally irrelevant detail/return controls rather than displaying a permanent bank of disabled controls. Keep Prev/Next stable at endpoints, with an accessible explanation of the boundary. If hiding a focused control, restore focus to a stable control; do not move controls under an ongoing pointer interaction.

Move the permanent shortcut legend to a small visible `Navigate…` entry point with a command list and shortcut help. Keep sentence navigation reachable in one interaction and its shortcuts available independently of speech. Narration settings remain disclosed; sentence controls are not conditional on starting Listen.

Candidate A — recommended first: a small tour-only command menu, opened by `Cmd/Ctrl+K` and the visible button. Offer previous/next step, previous/next sentence, explore detail, return to parent, and outline navigation. Arrow/Enter inside the menu are native menu interaction; Escape closes it and restores focus without also leaving a branch. This is deliberate reuse of a browser search shortcut while the reading surface is active, not a collision-free claim. Preserve browser behavior outside the reader, editable fields, and protected widgets. It is discoverable and avoids teaching six chords, but costs extra keystrokes for repeated movement.

Candidate B — direct home-row shortcuts for a trial: `Option/Alt+J/K` next/previous step, `Option/Alt+L/H` enter/return, and add Shift to J/K for sentences. This offers one-chord actions without arrows, but is less mnemonic and needs actual browser, keyboard-layout, host, assistive-technology, and OS conflict checks. Treat this as a candidate, not an approved cross-platform binding. Never capture alternate character input in editors or fields. Do not ship bare J/K/H/L globally.

Candidate C — modifier plus arrows: easiest mapping to remember, but least promising. Chrome uses Command+Left/Right for history and Command+Option+arrows for tabs/focus; other platforms and assistive tools reserve additional combinations. Do not adopt a generic Command-arrow layer on the assumption that it is free.

Do not add a full shortcut editor, shortcut modes, or compact/verbose settings in this slice. If use shows persistent accidental plain-arrow navigation after a viable alternative exists, consider one narrowly named `Use arrow shortcuts` control rather than a general density setting. Changing the current plain-arrow contract is a separate decision; it is not silently bundled into decluttering.

## Implementation boundary and slices

1. Remove generated repetition and make evidence context contextual. Start in `src/tourOrientation.ts`, `src/tourNarration.ts`, and the reading document/branch/navigation renderers in `web/host.js`. Represent shared progress/context as structured data rather than parsing presentation sentences.
2. Simplify the outline and toolbar using `web/index.html`, `web/presenter.css`, and outline state in `web/host.js`. Preserve deep links, branch ownership, return positions, explicit user expansion, and current path semantics.
3. Prototype the small command menu through existing `TourReaderAction` and target resolution. Check its actual host key delivery before settling the shortcut. Trial home-row alternatives only if a direct chord is still needed. Buttons, menu commands, and shortcuts must dispatch the same actions.
4. Rebuild a representative offline tour and run bounded reading/navigation checks before broad rollout. Keep implementation on a development branch carrying the current feature commits; never merge this orphan planning history into code.

No manifest/schema change, content rewrite, new preference framework, whole-app command palette, or Compare/History redesign is required. Do not install, publish, or push as part of this planning pass.

## Acceptance and evaluation

Use shared generic fixtures covering a four-step same-file tour, a real file/revision change, duplicate basenames, image/text/diff scenes, one/multiple/nested optional branches, and a long multi-chapter outline. Exercise narrow layouts and direct links. Use the same fixtures for browser checks and human trials.

- A default step shows its title, explanation, and relevant actions before routine metadata. An unchanged file/revision generates no repeated prose and no sentence-navigation stop. Progress occurs in one primary location.
- A reader can locate the current position, predict what Next will read/skip, open optional detail, and return without losing the saved position. Evidence identity and exceptional warnings remain discoverable or visible as appropriate.
- A five-minute skimmer can state why, what, and the key decision/tradeoff, find one supporting check when requested, and distinguish optional detail from the main route. Compare comprehension, first useful answer time, wrong turns, and unnecessary UI interactions with the current baseline; word count alone is not success. Use held-out tour content as well as the motivating example.
- Test real key events after clicking prose, controls, outline, and evidence; selected text, editors, menus, dialogs, OS/browser-reserved shortcuts, repeat, and modifier combinations. No double activation or focus loss. Verify keyboard-only and screen-reader operation; simulated events alone cannot establish host shortcut compatibility.
- Narration in stopped/playing/paused states, silent sentence selection, direct-entry context, and branch return must target visible narrative text and avoid reading hidden metadata. Use actual audio as well as mocks.
- Run targeted orientation/narration/navigation tests, live/offline branch and export smoke checks, lint, and screenshots at wide/narrow widths. Update user-facing help and generic authoring guidance only where behavior changes.

## Evidence and confidence

High confidence that repeated generated orientation and multi-line outline rows cause avoidable duplication: confirmed in source at the baseline above. Medium confidence in the proposed default hierarchy until a rendered prototype is tried. Shortcut delivery and ergonomics are unverified; observed browser interception, accessibility conflicts, or slower repeated navigation would change the keymap recommendation.

Chrome documents Command+arrow conflicts and Ctrl+K address-bar search: [Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179?hl=en). W3C explains why globally active character-only shortcuts need an off/remap/focus mechanism: [Understanding Character Key Shortcuts](https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts.html). These sources constrain shortcut design; they do not validate the proposed keymap or UI.

This planning pass inspected source and official shortcut guidance. It did not implement changes, run product tests, inspect the rendered private tour, perform assistive-technology testing, or conduct a new user trial.
