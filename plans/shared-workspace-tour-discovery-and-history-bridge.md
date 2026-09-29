# Shared workspace, tour discovery, and Open in History

Status: Proposed; captured for discussion, not authorization to implement.

## Outcome

Normal History and Compare should use the same recognizable workspace as tour-backed exploration. A tour adds authored explanation; it is not a prerequisite for the workspace. Missing tours should be discoverable opportunities, not disappearing features or dead controls.

A normal comparison should also offer an explicit **Open in History** action when its operands can be resolved to the same Git repository. This is a navigation action, not a reinterpretation of unrelated files as revisions of one file.

## Current implementation constraints

Evidence baseline: main `e6363cd`, version 0.9.1.

- `web/host.js` exposes History, Compare, and only the authored tour kinds present in a loaded presentation. Its mode/session initialization assumes a tour manifest.
- `standalone/main.js` manages Explore and dedicated Present windows separately, including restore and unsaved-edit handling. Sending every normal comparison through the existing Present launcher would change editing and window behavior.
- `standalone/sessionSource.js` records distinct file, directory, history, Git-ref, and branch-review sources. Git identity and exact revision provenance must come from these sources and host resolution, not display labels or temporary snapshot paths.
- `docs/product-surface.md` requires writable Explore content to retain its editing behavior, while committed snapshots and authored tours are read-only. Explicit read-only launches remain read-only through navigation.
- `docs/generating-change-tours.md` already provides provider-neutral context/schema/validation commands. Its context workflow uses merge-base semantics; arbitrary comparisons are not necessarily equivalent to that range.

This is a workspace/session integration, not just adding two disabled buttons to the tour presenter.

## Shared workspace and mode behavior

Use one mode strip: **History · Compare · Historical tour · Deconstructed tour**. Do not add another nested sidebar or mode dropdown.

- History and Compare remain usable without an authored document. Do not manufacture an empty tour manifest to stand in for a normal session.
- Reuse the shared navigator and panel UI while preserving the existing Explore window's ownership, editing permissions, and lifecycle. Existing explicit Present launches may retain their dedicated windows; merely changing normal modes must not spawn another window.
- Keep the active mode unchanged when opening help or editing a prompt. Only loading/selecting actual authored content enters a tour mode.
- Preserve each mode's selected file, revision focus, panel count, navigation state, and unapplied Compare selection. Compare checkboxes remain a draft until submitted.
- History lists commits across the selected revision axis, not just commits that changed the current file. Highlight file-changing commits separately from numbered active-panel badges. Up/down moves files; left/right moves commits. No-change commits remain visible by default.
- Retain History add/remove-panel controls, explicit Compare submission, and Clear without changing mode. A displayed base/parent outside the list still gets a clearly labeled matching entry.
- Non-Git comparisons retain a useful Compare workspace. History has a clear unavailable reason; tour help can explain the Git-backed authoring requirement without pretending a usable range exists.

## Missing-tour affordance

Render missing tour kinds as visually muted, **actionable help buttons**, not truly disabled controls. Existing mode controls are buttons with pressed state; a missing-tour help action must not announce itself as the selected mode or as a working tour tab.

Suggested copy:

> No Historical tour is available for this comparison. View or edit a sample LLM prompt.

Use the equivalent wording for Deconstructed tour.

- Hover or keyboard focus shows a short explanation. Click, Enter, or touch opens a compact prompt dialog associated with that tour kind.
- The hover tooltip contains no essential interactive controls. The dialog provides the editor and actions, with accessible labeling, Escape/close behavior, and focus returning to the initiating button.
- Actions: **Copy prompt**, **Reset sample**, **Open existing tour**, **Close**. No provider picker, automatic generation, or automatic shell execution.
- Opening/closing the dialog does not discard panel state or Compare selections. Switching prompt kinds retains each draft. Resetting or replacing edited text requires an explicit action.
- Distinguish missing content from loading, an invalid document, an unavailable repository, or a tour that targets a different range. Do not describe every failure as “No tour.”
- An available tour remains a normal mode button. A document containing only one tour kind leaves the other kind's help action visible.

“No tour is available” means no applicable tour is loaded/resolved in this session, not that the app has searched every file on disk. Start with existing discovery rules and explicit Open existing tour; do not add a background repository-wide search.

## Prompt contents and boundaries

Use a locally editable, provider-neutral template based on the existing authoring documentation. Keep drafts in the current workspace session; persistence across app restarts is not required for the first implementation.

The editor should make these inputs visible before copying:

- Requested tour kind: actual chronological revisions for Historical; explicitly synthetic explanatory stages for Deconstructed.
- Repository context, resolved base/head OIDs where available, and selected file/directory scope. Do not silently expand a file-specific request to the whole repository.
- Guidance to inspect bounded change context, consult `bygone tour schema`, author the document, and validate it with `bygone tour validate <file> --json` before opening it.
- Evidence rules: anchor claims to real source, preserve exact revisions, distinguish interpretation from facts, and never present synthetic stages as commits.

History alone does not necessarily define a tour range. If no meaningful range is selected, show explicit placeholders and a “choose revisions in Compare” action; do not invent a base. For more than two panels, show the included revisions and require an explicit base/head decision rather than silently dropping intermediate or unrelated revisions.

Do not translate an arbitrary comparison directly into `tour context --base`: its merge-base behavior can change the requested range. Detect reverse/non-ancestor endpoints and explain the distinction. If the current authoring pipeline cannot represent the exact comparison, label the limitation and require a deliberate range choice rather than generating misleading instructions.

Do not automatically read unsaved editor buffers into the prompt, embed full source contents, transmit anything to an LLM, or execute copied commands. Quote any generated shell arguments safely. Missing Git identity, uncommitted states, and unresolved scope must be explicit in the template, not fabricated as committed provenance.

Opening an existing tour validates its document and repository/range compatibility. A different range requires an explicit context switch with the normal preservation/unsaved-edit safeguards; it must not silently attach to the current comparison.

## Git-aware Open in History

Offer a labeled action in the normal comparison toolbar when eligible. Do not automatically jump on launch. For an ineligible comparison, show the reason in contextual help rather than opening an empty History view.

Resolve eligibility in the host from every operand:

1. Resolve canonical repository ownership and repo-relative paths; resolve refs to exact commit OIDs.
2. Distinguish repository identity from worktree identity. Linked worktrees may share committed history, but their WORKTREE/INDEX states are not interchangeable. Different clones are not one repository merely because they share a remote URL.
3. Respect nested repositories/submodule boundaries and symlink resolution. Extracted temporary files qualify only when retained source provenance identifies their repository and revision.
4. Confirm the requested history can actually be loaded. An unborn repository or unresolved commit cannot produce a usable timeline.

| Comparison operands | History destination |
| --- | --- |
| Same logical file at known revisions | File-focused History, anchored at the active panel's exact revision. Keep the original endpoints in Compare. |
| Different tracked files in one repository | Repository History scoped to those paths, initially focused on the active file. Do not treat the different paths as successive versions of one file. |
| Directories within one repository | Directory/repository History with the selected directory scopes and the active path retained. Show the scope explicitly; do not silently broaden to the entire repository. |
| Two or more commits in one repository | Repository History anchored at the active revision. Retain the original ordered comparison, including all selected revisions. |
| WORKTREE or INDEX plus Git-backed operands | History with explicitly labeled supported working/staged states and committed ancestry. Keep the exact originating worktree and read-only capabilities. |
| Untracked file inside one repository | Explain that the file has no committed history; offer containing-directory History explicitly, without fabricating a file timeline. |
| Mixed repositories, non-Git paths, untitled buffers, or snapshots without provenance | No automatic History bridge; explain which operand prevents resolution. |

For commits from multiple branches, the history axis must include the selected commits and relevant ancestry in deterministic topological order; a log rooted only at the active head must not quietly omit another selected branch. If the host cannot support that axis yet, clearly offer History of the active revision as a narrower destination instead of claiming to show the full comparison context.

Switching to History changes the coordinate system: the focused path is one axis and revisions are the other. Two unrelated files or directories are not evidence of rename ancestry. Only use supported Git rename provenance when following a logical file.

## Return navigation and editing safety

**Back to comparison** restores the original comparison, not a newly guessed endpoint diff. Preserve ordered sources, resolved revisions, panel count/layout, focus, and navigation state. Returning through Compare also restores the user's submitted comparison and pending selection draft.

Prefer retaining the original live editor/session models when switching modes. If the implementation must replace them, use the existing unsaved-edit confirmation before transition; cancellation leaves the comparison intact. Never silently save, discard, or reload edited content. Do not downgrade writable local comparisons to read-only simply to reuse Present, or upgrade an explicit read-only session to writable.

Browser Present cannot resolve arbitrary local paths or acquire desktop write capabilities. Expose the bridge only when its existing repository backend supports it. VS Code should retain its established desktop handoff boundary for repository/multi-panel exploration rather than implicitly gaining a new full workspace implementation.

## Implementation sequence

1. Establish normal-session workspace initialization and mode/source ownership without requiring a tour. Prove existing editing, restore, and navigation remain intact before routing default launches through it.
2. Add the host-resolved History bridge and reversible navigation for supported operands. Cover source identity, scope, and unsaved edits before enabling the action.
3. Add the always-visible tour-kind affordances and prompt dialog. Reuse documented authoring guidance and existing document loading/validation.
4. Exercise normal launch, mode transitions, tour attachment, and return navigation across desktop and supported browser/extension handoffs. Rebuild/install after any main commit per repository policy.

No tour format/version bump is implied: these are workspace and authoring-assistance changes. Reassess only if implementation reveals an actual serialized-format requirement.

## Acceptance checks

- Plain History and Compare open the shared workspace without an authored tour or extra nested sidebar.
- Missing-tour hover/focus explains availability; click/keyboard opens editable help while the active mode and panels remain unchanged. Existing and single-kind tours still work.
- Copy is the only clipboard action; no LLM request, shell execution, or tour generation occurs implicitly. Edited prompt drafts survive dialog close/reopen and mode changes within the session.
- Prompt range tests cover no selection, exact two-revision comparisons, reversed/non-ancestor endpoints, and more than two panels. No silent merge-base or scope substitution.
- File, directory, and commit comparisons in one repository offer the correctly scoped History action. Cross-branch selections are not silently omitted.
- Mixed clones, submodules, linked worktrees, symlinks, untracked paths, unborn repositories, and provenance-free temp files get correct eligibility and explanations.
- Round trips preserve ordered comparison operands, panel count, selection draft, focus, and navigation. Unsaved edits are retained or protected by a cancellable guard.
- Read-only launches stay read-only; writable Explore content remains editable. WORKTREE/INDEX never resolve through a different worktree.
- History retains the all-commit grid, file-change indicators, numbered active-panel badges, add/remove controls, and left/right commit versus up/down file movement.
- Missing/mismatched/invalid authored documents are distinguishable and cannot silently change the current repository or range.
- Native desktop smoke testing covers normal launch and switching; browser and VS Code checks confirm their existing capability boundaries. Automated host/session and UI tests cover the state transitions above.

## Scope and confidence

High confidence in the interaction recommendation: it makes tour discovery visible without making authored narration a gate to normal exploration. Evidence is the existing mode strip, shared renderer, and source/session contracts.

Medium confidence in implementation size until a normal-session shell spike verifies editor ownership, restoration, and arbitrary Git-axis support. Evidence of unavoidable duplicate session state or lost editing behavior would change the integration approach, not justify silently dropping those capabilities.

Out of scope: implementing an LLM integration, automatically authoring tours, inventing ancestry between unrelated files, a new tour schema, repository mutations, broad UI redesign beyond this shared workspace, publishing a release, or automatically changing existing comparison launch semantics.
