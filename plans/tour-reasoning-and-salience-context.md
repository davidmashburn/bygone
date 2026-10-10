# Tour reasoning and salience: conversation context

This appendix accompanies [Tour reasoning and salience](tour-reasoning-and-salience.md).
It preserves the available public user/assistant message text from the
[originating thread](t3-thread://v1/4b887c25-e28f-4e36-ab80-97911377e0b6)
through the research response on 2026-10-10. Tool activity and private reasoning
are excluded. The [interactive example](mockups/tour-reasoning-and-salience.html)
is saved separately.

Messages are retained in their original order. Earlier observations describe
earlier code snapshots; later feedback refines earlier preferences. Historical
validation statements are preserved as reports, not fresh verification.
Absolute local links and commands in quoted history identify the original
environment and may not work elsewhere.

## 0. User

I keep getting jarred by tours returning to the directory overview at change of scene and not knowing wth is going on. Is that just the default when talking generically? Is it simply the top view? How can I tell if we're still talking about the same comparison or a different one (for multi-stop tours). Also, why multiple scenes within a single stop? I feel like the explanation gets fuzzy, the whole point of a tour is clear framing, and the tours are failing to explain the purpose of each scene in a clear and adequate way up front. Also, I feel like there's a use case for a conclusion slide even if only to end the tour with a summary (classic: tell them what you're going to tell them, tell them, tell them what you told them)

## 1. Assistant

I’ll trace how tours choose each scene’s view and label comparisons, then assess where the framing breaks down and how a conclusion could fit. I’m using the PR Tour Guide skill for the tour model and authoring rules.

## 2. Assistant

The directory jump is built into the presenter: scene introductions normally render a directory comparison, even when the author hasn’t explicitly requested one. That overview can also use different endpoints from the preceding code step. I’m checking what the UI exposes about that switch and whether the format supports a separate closing slide.

## 3. Assistant

The presenter currently treats a scene introduction as a reason to show the directory overview. **It isn’t detecting that the explanation is “generic”; it’s a navigation default.** Even without an authored `overview`, most code-tour scene introductions take this path. [Presenter logic](/Users/davmash/code/bygone/web/host.js:2170)

It also isn’t always the same “top view”:

- The tour title shows the overall base → head change.
- A walkthrough scene’s overview uses that overall comparison, optionally scoped to a directory.
- A historical or deconstructed scene’s overview defaults to its first → last panels, unless the author specifies another pair.
- A code step can focus an intermediate pair within that sequence.

So returning to the directory can change both the level of detail **and the comparison being shown**. The directory layout alone doesn’t tell you which changed. [Comparison selection](/Users/davmash/code/bygone/src/tourDirectoryEvidence.ts:12)

The current hierarchy is **tour → chapter → scene → step**. “Stop” means a navigation position; it isn’t a separate container holding scenes. A single comparison can support several scenes—for example, “the new contract,” “how callers adopt it,” and “failure handling”—with steps supplying evidence for each. But those boundaries only help when each scene clearly explains its distinct purpose. A scene change should never implicitly mean a comparison change.

My assessment is that this needs both presenter and authoring changes:

1. **Keep comparison identity visible.** Show the enclosing change/PR, exact endpoints, and whether the evidence is real history or synthetic explanation stages. Identify the focused pair separately from the overall range. Announce endpoint changes explicitly.
2. **Separate scene framing from directory navigation.** Show a scene’s introduction without automatically replacing the evidence with a directory. Use a directory overview when its file distribution actually supports the explanation, with an explicit reason for showing it.
3. **Require useful framing before the evidence.** Each scene should establish the question it answers, why it follows the previous scene, and what evidence we’re about to examine. For example: “We’ve established the new contract. Now we’ll trace its callers to see whether they preserve it. We’re still comparing A → B.”

The existing authoring guidance already says that a scene’s summary should explain its purpose. Validation only checks that the narrative fields contain text; it cannot establish that they provide adequate framing. That gap allows structurally valid, confusing tours. [Framing contract](/Users/davmash/code/bygone/docs/change-tour-format.md:204)

**A dedicated conclusion is warranted.** It should close the argument: what changed, what the evidence established, and what remains unresolved. That differs from an individual scene’s takeaway. Currently the reading sequence simply ends after the last scene or step, and the authored format has no dedicated conclusion type. A closing slide should be available without requiring an artificial code anchor or another directory jump.

Confidence is high in this diagnosis from the source. I haven’t reproduced your particular tour in the UI; that could reveal additional causes. No files changed, and no tests or visual checks were run.

## 4. User

Ok, make a detailed plan and put it in project-planning branch

## 5. Assistant

I’ll turn the diagnosis into a detailed implementation plan, including comparison identity, scene transitions, authoring requirements, and conclusion slides, and save it in a separate worktree on `project-planning`.

## 6. Assistant

The plan will treat scene changes and comparison changes as separate events, with explicit rules for what stays visible and what gets announced. I also found that narration uses a different navigation sequence from manual reading, so the plan will cover both. There’s already a planning worktree with unrelated edits; I’ll preserve those and commit only this plan and its index entry.

## 7. Assistant

The plan is drafted with six implementation phases and acceptance scenarios for same-comparison transitions, changed pairs, synthetic stages, narration, links, and exports. It proposes previewing the first evidence at scene introductions, while keeping directory overviews explicit, and includes a reader trial to validate that choice. I’m checking the document and isolating its commit from the existing planning edits.

## 8. Assistant

Committed the [detailed plan](/Users/davmash/code/worktrees/bygone-project-planning/plans/tour-orientation-and-narrative-framing.md) locally on `project-planning` as `a86aec7`.

It covers comparison identity, scene framing and transitions, opening/conclusion support, format compatibility, narration, links, exports, and six implementation phases with acceptance criteria.

Checked document links and formatting. Existing planning edits were preserved. Implementation and runtime testing remain pending.

## 9. User

implement in a feature branch

## 10. Assistant

I’ll implement the plan on a feature branch from `main`, starting with comparison context and scene landings, then adding opening and conclusion support across navigation, narration, links, and exports. I’ll first check the current worktree so the feature stays isolated from the other work in progress.

## 11. Assistant

The feature branch is isolated from the work in progress on `main`. I’m using the reticence and TypeScript design skills to keep the implementation focused. The plan now places orientation in existing headers and breadcrumbs, so I’ll follow that layout without adding another header strip.

## 12. Assistant

The directory jump comes from a blanket rule: every introduction tries to open an overview, even when none was authored. I’m replacing that with explicit scene landings and giving opening and conclusion passages their own reading identities so navigation and narration can reach them correctly.

## 13. Assistant

The format changes now support version 5 bookends while retaining versions 1, 2, and 4. New directory overviews require a stated purpose. I’m connecting those changes to the viewer, including first-step previews and comparison identity based on resolved revisions rather than labels.

## 14. Assistant

Opening, conclusion, search, and copyable links are connected, and narration now follows the document’s reading order. I’m checking that scene previews carry no active step annotation and that switching modes cannot attach one narrative’s summary to another.

## 15. Assistant

I’m working through regression checks now. The main behavior is in place: scene introductions preview their first evidence unless an overview is explicitly authored, and opening/conclusion passages have their own reading positions. I’m tightening navigation and adding tests before checking the viewer visually.

## 16. Assistant

The new tests cover mode-specific bookends, conclusion links, narration order, and comparison identity—even when two comparisons reuse the same labels. I’m also updating the authoring guidance and examples so each scene explains its purpose before showing evidence; viewer changes alone won’t fix vague narration.

## 17. Assistant

One integration issue surfaced: the multi-panel renderer ignored the comparison caption. I’m fixing that so stacked tours show the selected revision pair and update it when the reader focuses another pair. Explicit directory overviews will also show their endpoints and inventory scope.

## 18. Assistant

The full test suite passed before the latest renderer adjustments. The updated examples are being validated, and the export smoke test now checks conclusion reloads and scene previews. Next I’m checking the live viewer’s layout, especially whether framing remains readable above the evidence.

## 19. Assistant

The live viewer now shows “Coming up” for scene previews and keeps the comparison visible in the existing evidence header. Offline exports passed their new conclusion and preview checks. I also corrected an example that implied two scenes used the same pair when one actually used the full range—the prose now explains that change.

## 20. Assistant

The feature branch now has explicit scene framing, comparison context, and opening/conclusion passages. I’m checking navigation and file exploration so the labels stay accurate when readers leave the guided path, then running the final verification suite.

## 21. Assistant

I found and fixed a context edge case: opening a search result from a synthetic scene could label the real file comparison as synthetic stages. File exploration now reports the evidence actually displayed. Explicit directory-overview purpose is also included in narration.

## 22. Assistant

The new checks cover conclusion links and reloads, file exploration with “Return to passage,” mode restoration, and previews without active step markers. I’m also checking the narrow layout and the desktop and offline export viewers. The human comprehension check remains unverified.

## 23. Assistant

The offline export, image-guide, and desktop workspace checks have passed. I’m finishing the narration regression checks: returning from file exploration should preserve the paused passage, and switching modes should stop speech from the previous mode. I also revised the sample tour’s scene introductions to state each question and the evidence to watch for.

## 24. Assistant

The implementation is on `feat/tour-orientation-and-framing`. All 150 tests and lint pass. The final browser smoke check found a mismatch in the narration control after switching modes; I’m checking it before committing.

## 25. Assistant

The smoke failure was in the test: it read a tooltip attribute that the UI moves elsewhere. Checking the accessible label passes. The browser checks now also confirm that returning from file exploration resumes the interrupted narration segment, and switching modes stops the previous mode’s narration.

## 26. Assistant

The visual check caught one more issue: a direct link to the conclusion could leave the previous scene’s heading visible above it. I’m fixing that scroll alignment so the recap opens clearly at the top.

## 27. Assistant

The conclusion now opens at the top, and selecting another revision pair displays both the old and new comparisons. The full suite passes again. I’m checking the final caption change and preparing the local commit; reader comprehension still needs a human check.

## 28. Assistant

Implemented and committed on **`feat/tour-orientation-and-framing`** — `09e3cc9`. Main and its existing changes were left untouched.

- Scene introductions preview relevant evidence; directory overviews require explicit authoring.
- Captions identify the actual comparison and announce changes.
- Added mode-specific openings and conclusions, including narration, search, links, and exports.
- Updated authoring guidance and example tours with clearer scene purposes.

Passed: full test suite, lint, export/image/workspace smoke checks, example validation, and browser layout checks.

Confidence is high in tested behavior. Human comprehension, screen-reader audio, and cross-platform behavior remain unverified; reader feedback may warrant presentation adjustments.

Preview from the [feature worktree](/Users/davmash/code/worktrees/bygone-tour-orientation):

```sh
./bin/bygone.js present --tour examples/navigation-lab.bygone.yaml
```

## 29. User

The Intro slide should probably also be in the tour outline on the side explicitly. I'm still really struggling with connecting the prose to the code changes and how the tour moves through things. What are we shifting between? Files? Commits? PR's? I need orientation especially during scene changes, and I should get a high-level idea of what's in the tour on the opening slide. Prime the reader for what they are about to see

## 30. Assistant

I’ll add an explicit Intro entry to the outline and strengthen the opening and scene transitions so they explain the route through the tour: what question comes next, which files it uses, and whether the comparison changes.

## 31. Assistant

The current UI gives you revision labels, but still makes you infer how those labels relate to the story. I’m making that relationship explicit: the Intro will show the scene-by-scene route, each scene will name the evidence it is about to use, and the code caption will name the step it supports. Scene changes will distinguish a new file from a new revision pair or an explanation stage.

## 32. Assistant

I’m keeping two kinds of orientation separate: the planned route in the Intro, and what actually changed in the code view as you navigate. That lets a scene explain its purpose without implying that every scene boundary is a new commit or PR.

## 33. Assistant

The Intro now has its own outline entry and a clickable route through the scenes. Each scene lists its evidence files and comparisons; each step says whether you’re continuing in the same file or switching files or revisions. I’m checking these cues against both ordinary diffs and constructed explanation stages.

## 34. Assistant

The browser check exposed a layout problem: the Intro’s roadmap was below the fold while most of the window sat empty. I’m giving Intro and Conclusion the full reading area, then restoring the prose/code split when you enter a scene.

## 35. Assistant

The roadmap now fits in the Intro, and the code caption names the step it supports. I also corrected example prose that told readers to use controls from an older UI. The remaining checks cover scene transitions, image tours, and returning from Intro or Conclusion to code.

## 36. Assistant

The checks pass: the full test suite, export and image-tour smoke tests, lint, and example validation. Browser checks at desktop and narrow widths confirmed that Intro fills the reading area, scene entry restores the code split, and transitions distinguish a file change from a revision change. I’m committing the follow-up on the feature branch.

## 37. Assistant

Implemented on `feat/tour-orientation-and-framing`, commit `bf03d6c`.

- **Intro** appears explicitly in the outline.
- Opening includes a clickable scene roadmap with files and comparisons.
- Transitions distinguish file changes, revision changes, and explanation stages.
- Code captions name the step they support.
- Intro and Conclusion use the full reading area.

Tests, lint, export/image smoke tests, and browser checks passed. High confidence in navigation behavior; reader comprehension still needs your read-through. Real audio and cross-platform checks were skipped.

From the [feature worktree](/Users/davmash/code/worktrees/bygone-tour-orientation), open it with:

```sh
./bin/bygone.js present --tour examples/navigation-lab.bygone.yaml
```

## 38. User

reopen in preview window

## 39. Assistant

I’ll reopen the updated tour in the preview window.

## 40. Assistant

Loaded the tour at Intro, but the preview panel still reports hidden. [Open the tour](http://127.0.0.1:53925/?manifest=/tour.json#location=1&mode=historical&part=title).

## 41. User

The tour talks about scenes, but it's super unclear what the different levels represent. Could we be more clear up front about exactly what is covered in each chapter or scene (commit range, files, whatever) and number them as well as the steps?

## 42. Assistant

I’ll make the hierarchy explicit on the Intro and in the outline, with numbered chapters, scenes, and steps plus the comparison and files covered by each section. I’ll check the current structure first so those labels describe what the tour actually does.

## 43. Assistant

The current Intro lists scenes without their chapter grouping, and chapter pages show only a title. That leaves a real gap in the explanation.

I’m adding a numbered map—Chapter 1 → Scene 1.1 → Step 1.1.1—with each chapter’s files and revision comparisons, and each scene’s purpose and scope. The Intro will also explain that these are levels of the explanation; a scene boundary does not automatically mean a new commit or PR.

## 44. Assistant

The hierarchy and numbering are in place. Chapter pages now introduce their scenes and list the files and comparisons they cover. I’m checking navigation and narration next so the same numbers appear in the outline, headings, and spoken tour.

## 45. Assistant

The preview now shows, for example, Chapter 1 covering both the hierarchy commit and the full-range return-position comparison, with Scenes 1.1 and 1.2 explaining each separately. The outline and reading headings use matching numbers.

I’m finishing regression checks for chapter links, image tours, and narration. The initial checks caught test expectations that needed updating for the new labels and grouped roadmap.

## 46. Assistant

All 152 tests pass, along with lint and the export and image-tour checks. The browser check also showed that chapter introductions needed the full reading area; they now have it, so their scope and scene map aren’t squeezed above empty space.

I’m checking the final numbered step view, then I’ll return the preview to Intro.

## 47. Assistant

Implemented in `96ca627` on the feature branch.

- Explicit numbering: **Chapter 1 → Scene 1.2 → Step 1.2.3**.
- Intro explains each level and maps chapter/scene purposes, files, and comparisons.
- Numbers match across outline, headings, narration, and code captions.
- Chapter introductions use the full reading area.

Preview is back at Intro. All 152 tests, lint, and export/image checks pass. Actual audio playback wasn’t verified.

## 48. User

oh no, major tmi!!

## 49. Assistant

I overcorrected. I’ll keep the numbering, shorten the Intro to a chapter outline, and tuck file and commit details behind “Scope details.” Each chapter will get a brief scene list.

## 50. Assistant

The Intro now fits comfortably on one screen: a short opening, one sentence explaining the levels, and two chapter links. Scope details stay collapsed and are skipped by narration.

## 51. Assistant

Trimmed it down. Numbering stays; Intro shows a short chapter outline. File/commit details are expandable and skipped by narration.

Preview refreshed. Targeted tests, lint, and export checks pass; full suite wasn’t rerun.

## 52. User

need forward back buttons for the tour, otherwise scroll is awkward main interaction mechanism

## 53. Assistant

I’ll add visible Back and Next buttons that move through the Intro, chapters, scenes, steps, and Conclusion.

## 54. User

no, not more scope details. Need LESS info, more salience...

## 55. User

don't list out 1.x either, same reason. not a legal doc....

## 56. Assistant

I’ll remove the scope-detail blocks and outline-style numbering, keep short titles and a clear current position, and add Back/Next buttons.

## 57. Assistant

The Intro now keeps just the opening and topic titles. I’ve removed the scope disclosures and decimal numbering throughout; Back/Next stays visible above the reading pane.

## 58. Assistant

I’m checking that the buttons traverse the whole tour and stop at each end. The current-position label now uses the scene title and a simple “Step 2 of 3.”

## 59. Assistant

Removed scope details and hierarchical numbering. Kept plain titles and simple step progress. Added persistent **Back / Next** buttons.

Preview refreshed. Build, lint, targeted tests, and export/image checks pass; full suite wasn’t rerun.

## 60. User

More salient now, but missing key context. What does this change *do*
Also, I still wanted chapters, scenes, etc to have listed numbers for reference, but not refer to x.x all over the place

## 61. Assistant

I’ll make the opening explain what the change does, and restore simple numbers in the outline without repeating dotted references throughout the tour.

## 62. Assistant

The change lets readers move between an overview and code steps while keeping their place, and fixes resizing that could push highlighted code out of view. I’m putting that up front, with simple reference numbers confined to the lists.

## 63. Assistant

Both tour modes now open with the behavior change. Chapters and scenes have simple list numbers, and steps count from 1 within each scene. Headings and narration keep plain titles. I’m checking the refreshed preview and validation.

## 64. Assistant

The opening now explains the behavior: navigate from overview to code without losing your place, and keep highlighted code visible during resizing.

Restored simple numbers in chapter, scene, and step lists. No dotted references in headings or narration. Preview refreshed.

Build, lint, targeted tests, export checks, and tour validation pass. Full suite wasn’t rerun.

```sh
bygone -C /Users/davmash/code/worktrees/bygone-tour-orientation present --tour examples/navigation-lab.bygone.yaml
```

## 65. User

I want you to research optimal solutions to this presentation challenge. I feel like something is just off with the strategy. Ranging between overly terse and overly drowned in details. I want reasoning, salience.

## 66. Assistant

I’ll look at the current tour alongside research on explanation, cognitive load, and code walkthroughs. I’ll focus on what helps readers understand why a change matters and how the evidence supports it.

## 80. Assistant

The current example mixes two explanations: how the code change works, and how Bygone’s tour modes work. That makes readers switch between understanding the change and understanding the presentation.

The research also cautions against treating smaller sections as the solution: one controlled code-review study found that decomposition reduced false positives but did not improve understanding of the change’s rationale. I’m focusing on how each scene connects a claim, its cause, and its evidence.

## 97. Assistant

My strongest recommendation is to build each scene around a causal explanation: what changed, why it works, and what evidence could confirm or challenge it. The current marker-fix scene already does this better than the earlier navigation scenes.

I’m making a small illustrative sequence from that fix. It will show how to keep the reasoning visible without adding another layer of scope details.

## 103. Assistant

**The strategy needs to organize the reader’s reasoning.** My earlier iterations adjusted text volume and navigation without adequately deciding what the reader should understand at each point.

My confidence in that diagnosis is **high**. Confidence in the exact replacement design is **moderate**, pending reader testing. The research supports a direction; it does not establish one universally optimal tour format.

The clearest problem in the [current example](/Users/davmash/code/worktrees/bygone-tour-orientation/examples/navigation-lab.bygone.yaml:78) is that it mixes explaining the code change with explaining Bygone itself: inventories, synthetic stages, historical commits, reading levels, and mode switching. Each fact may be accurate, but their relevance keeps changing. Meanwhile, the marker-fix section has a much clearer causal thread.

**The strongest research-backed approach is a guided explanation with evidence and optional exploration.**

Several findings matter here:

- **State a meaningful claim, then support it.** Assertion–evidence presentation research found better understanding and retention when technical slides used sentence headlines expressing their main message, supported by visual evidence. This supports headings that communicate a finding rather than merely name a topic. It was presentation research, so applying it to code tours remains an informed adaptation. [Garner and colleagues](https://www.writing.engr.psu.edu/research.html)
- **Remove irrelevant processing while preserving the explanation.** Mayer’s research synthesis supports highlighting essential material, placing explanation beside the corresponding visual, and allowing readers to control the pace. My application: file inventories and repeated framing can disappear, but the causal connection between code and behavior must remain visible. [Mayer, 2017](https://onlinelibrary.wiley.com/doi/abs/10.1111/jcal.12197)
- **Smaller sections alone do not supply rationale.** A controlled study with 28 developers found that change decomposition reduced false positives, but did not improve understanding of the change rationale or the number of defects found. More chapters and scenes cannot carry the explanatory burden themselves. [di Biase and colleagues](https://pmc.ncbi.nlm.nih.gov/articles/PMC7924728/)
- **Provide a route while permitting investigation.** Segel and Heer describe interactive slideshows that let readers explore within an authored sequence. This is a useful design precedent for Bygone: readers can inspect surrounding code and return to a stable narrative position. Their work is a design-space analysis, not a controlled demonstration of superiority. [Segel and Heer](https://homes.cs.washington.edu/~jheer/files/narrative.pdf)

I would apply those findings in five ways.

1. **Give each scene an explanatory job.**  
   A scene should resolve a consequential question: why the bug happens, how a design prevents it, what behavior must survive, or what remains uncertain. Its steps develop that explanation. “Inspect these three files” describes activity without establishing a purpose.

   A useful authoring test is: *What can the reader now explain that they could not explain before this scene?* If there is no distinct answer, merge or remove the scene.

2. **Keep the reasoning in the main path.**  
   The reader should encounter the outcome, the mechanism that produces it, and enough evidence to assess the claim. Supporting metadata can be secondary. **“Why this works” should never require opening a details disclosure.**

   Salience comes from making relationships explicit: *because*, *therefore*, *however*, *this preserves*. Cutting those connections produces terse prose that requires more mental work.

3. **Let hierarchy organize the explanation without interrupting it.**  
   Chapters group related questions; scenes answer them; steps supply evidence. Keep the simple reference numbers you wanted in lists.

   But a chapter boundary should earn a separate screen by contributing useful framing. The [current reading sequence](/Users/davmash/code/worktrees/bygone-tour-orientation/src/tourReading.ts:30) inserts chapter and scene entries before their evidence. My design hypothesis is that some of those introductions should accompany the first evidence view, reducing repeated setup.

4. **Make comparison continuity a stable visual fact.**  
   Keep a compact comparison label visible. Changing scenes should not imply changing revisions. When the comparison actually changes, explain the transition briefly: “Now isolate the later fix.”

   A directory overview belongs where relationships among files are part of the argument. Otherwise, retain relevant code or show a small behavioral diagram. This addresses the original disorientation more directly than adding scope prose.

5. **Conclude with what the evidence establishes.**  
   The ending should reconnect the mechanism to the promised behavior, identify any meaningful limitation, and stop. A recap of chapter names contributes little. Likewise, tests belong near the behavior they support unless verification itself needs a separate explanation.

For this example, I would first rewrite the narrative around **preserving your place while navigating** and **preserving code focus while layout changes**. Discussion of tour modes should appear only where it changes how the evidence must be interpreted.

Before changing more viewer infrastructure, I would test that rewrite on a small bug fix and a multi-commit feature. Ask readers to explain what changed, why it works, what the evidence leaves unresolved, and whether the comparison changed. If the explanation improves but readers still lose their place, that would shift the priority toward viewer transitions.

I inspected the tour source, navigation code, and underlying fix. No product files changed. The illustration’s desktop/mobile rendering and buttons were checked; the live viewer, audio, and repository tests were not tested.
