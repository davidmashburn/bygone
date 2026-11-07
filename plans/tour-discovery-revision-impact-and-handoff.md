# Tour discovery, revision impact, and handoff

## Status and goal

Proposed, 2026-11-07. Saved at the user's request after reviewing the ideas in
the attached *Clarifying the Bygone Git Tool* conversation. This document records
future work; it does not start implementation or change the priority of other
active workstreams.

Help a reader find an existing explanation from the code they are inspecting,
help an author identify explanations needing reconsideration after a committed
change, and reduce the remaining friction in sharing the intended tour location.

Recommended order: **Related explanations first**, **authored-tour revision
impact second**, and **portable handoff only after observing a concrete gap**.
Each slice should be useful independently.

## Context and existing decisions

The capability audit inspected public Bygone `main` at
[`fb3f45f01bf638af03190ac88bbaa6a7f6c91fac`](https://github.com/davidmashburn/bygone/commit/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac).
Planning was reconciled with `project-planning` at `1c93eeb89f2a96c277a965d4cf358cd290a8a291`.
Recheck implementation before starting a slice; absence from documentation is
not proof that an implementation is absent.

The source conversation is an idea prompt, not evidence about current features.
Bygone already documents agent authoring, context/schema/validation/compilation,
exact anchors, optional branches, narration, coverage, evidence checks, local
section links, and standalone HTML exports. The plan extends these foundations.

| Existing foundation | Proposed increment | Evidence |
| --- | --- | --- |
| Tour-to-code navigation, narrative/code search, exploration and Return to Tour | Find authored steps associated with selected code in the loaded tour | [Presenter][present], [format][format] |
| Pinned review evidence and explicit refresh, with conservative inspection freshness | Connect refresh observations to authored explanations needing attention | [Evidence review][evidence], [feedback guidance][feedback] |
| Local section links and Minimal/Full HTML snapshots | Validate and complete handoff between different checkouts | [Sharing][sharing], [portable-link plan](deep-linking.md) |

Preserve these decisions:

- [Workflow integration](workflow-integration-reconciliation.md) owns the
  evidence-to-edit-and-refresh loop. New comparisons require renewed inspection
  even when cited bytes are unchanged. Preserve narrative IDs and useful reading
  position where possible; do not preserve inspection validity by implication.
- [Tour expectations and feedback](tour-assessment-and-feedback.md) removed
  numeric quality grades and assessment hash/staleness machinery. This plan adds
  concrete navigation and source-change observations, not a new assessment
  subsystem, approval ledger, or Review Notes panel.
- [Deep links](deep-linking.md) already plans portable repository resolution.
  Slice 3 activates a bounded part of that direction if the handoff trial shows
  it is needed; it is not a competing link architecture.
- [HTML exports](self-contained-html-tours.md) already has a production
  counterpart. Older planning baselines can predate delivered behavior; use the
  pinned implementation docs above to establish the current capability.
- Tours remain optional aids to comprehension. Keep the complete change and
  ordinary investigation available, including code not referenced by a tour.

## Slice 0: confirm the integration points

Before implementation, follow one existing tour through loading, compilation,
source focus, optional-branch navigation, evidence refresh, and export. Identify
the current data structures and consumers rather than introducing parallel ones.

Record the supported source identities and range units. Real commit evidence,
old/new diff sides, and synthetic explanation stages must remain distinguishable.
Check how walkthroughs, stacks, symbol stops, connections, and optional paths
expose their resolved evidence. State unsupported cases explicitly.

For revision impact, inspect the existing requirement-review refresh semantics
and decide what can be reused for general authored tours. An arbitrary authored
tour must not acquire invented requirements just to enter that pipeline.

**Exit:** a small implementation delta with named owners and a representative
fixture. Do not use this discovery pass to reopen the tour schema or product
architecture without a concrete incompatibility.

## Slice 1: related explanations from selected code

### Reader interaction

Provide **Related explanations** for a cursor position or selection in the
currently loaded tour's code view. Results identify their chapter/scene, step
title, a short explanation preview, and authored mode or optional-path context
when needed to disambiguate them.

Selecting a result opens the existing authored step through normal navigation.
Looking up results, moving the cursor, or scrolling code must not advance the
narrative or start narration. Dismissing the results preserves the reader's place.

Scope the first version to the **loaded tour**. A no-match result means no
resolved reference in that tour matches the selected code; it does not mean the
code has no explanation elsewhere. Match existence is a navigation fact, not a
judgment that the prose answers every question about the selected range.

### Implementation approach

Build a derived, in-memory index from compiled source evidence. Keys must retain
repository/document context, evidence revision or synthetic-stage identity,
canonical path, diff side, and the existing source-span representation. Targets
retain authored mode, scene, and stable step IDs. Include optional branches and
supported secondary evidence such as connection endpoints.

Use actual range intersection for cursor/selection matches. Deduplicate a step
matched through several references, and order results predictably using authored
order. If a broader file-level fallback is useful, label it separately from an
exact range match. Repeated snippets or equal line numbers across revisions
must not create inferred matches.

Invalidate the derived index when the document or compiled evidence changes.
Discard stale asynchronous results after a tour switch. Reuse existing navigation
to enter optional paths and restore their parent context. Respect the currently
displayed comparison rather than guessing a revision from the filename.

The first host is Desktop/browser Present. An eventual VS Code context action
can hand off to Desktop; it should not duplicate the presenter in the extension.
Offline exports use only their packaged evidence and existing navigation support.

### Acceptance and focused verification

- An overlapping selection finds the intended step; multiple valid explanations
  remain individually accessible and have distinguishable labels.
- Old-side deleted code and renamed paths resolve against their actual evidence
  identity. A matching path/line on another revision is not a match.
- Optional steps open at their intended depth and retain normal return behavior.
  Title edits or step reordering do not break targets whose IDs are unchanged.
- No-match, unavailable evidence, and unsupported source kinds are distinguishable.
  Switching tours or refreshing evidence cannot expose an old result as current.
- Keyboard access, focus restoration, and narration behavior remain predictable.
  Live and offline presenters agree for the evidence packaged in both.

Add focused index and navigation tests for these cases, plus a representative
large-tour responsiveness check. Reuse existing reading/navigation fixtures.
Trial with a reader starting at a code question; observe whether the result helps
them locate and correctly explain the relevant rationale.

## Slice 2: revision impact on authored explanations

### Author interaction

After an explicit request to consider a newer committed range, show which known
references changed and which authored steps use them. Preserve the original
pinned tour and its evidence. A historical tour does not need to follow current
`main`; the user chooses whether a new current version is wanted.

The initial deliverable is a report with links to affected steps and the old/new
evidence. It need not introduce persistent assessment records or automatically
rewrite prose. These are proposed observations, not a new public enum contract:

| Observation | Meaning and next action |
| --- | --- |
| Referenced content unchanged | Known referenced text matches; contextual or behavioral validity remains unassessed. |
| Reference relocated, content unchanged | A supported mapping found the same text elsewhere; inspect relevant surrounding relationships. |
| Referenced content changed | Reconsider the explanation and inspect the changed evidence. |
| Reference missing or ambiguous | Repair or remove the target; retain the old evidence for comparison. |
| Analysis incomplete or unavailable | State the reason and scope that could not be compared. |
| New changes not referenced by current anchors | Link to the existing changed-file/coverage view so the author can decide whether to extend the explanation. |

Prefer observations about specific references over a single step score. One step
can have an unchanged implementation reference and a changed test or connection.

### Reuse and correctness boundaries

Start from the existing `evidence refresh` policy and validated correspondence
where applicable. Preserve the original comparison baseline. An old-head to
new-head delta helps locate changes but is not the full PR comparison.
Rewritten/divergent history requires the existing explicit new-import or
new-comparison path; a changed base must not silently redefine the review.

Keep stable authored IDs, order, and unaffected prose when producing a new draft.
Use existing output conventions to avoid overwriting the historical artifact.
A failed refresh leaves the original baseline intact. Repeated analysis must
continue to identify the requested old/new versions rather than silently
treating the previous automatic run as an accepted explanation.

**Every new comparison still requires renewed inspection.** An unchanged-byte
observation must not carry inspection decisions forward or relabel old checks as
current. Retained notes and past execution results remain historical evidence.
This slice prioritizes attention; it does not certify unaffected explanations.

Use the existing coverage inventory for unreferenced changes. Distinguish a
referenced file from referenced hunks, visiting a step from inspecting it, and a
linked test from an observed passing execution. Existing authored check statuses
must retain their actual scope and provenance.

The first report is limited to evidence already associated with the tour plus
the existing change inventory. It may miss effects in unreferenced callers,
callees, configuration, or runtime behavior. Existing dependency evidence may
inform attention when available; neither unchanged text nor unchanged graph
edges prove semantic freshness. Do not add universal AST tracking as a prerequisite.

### Acceptance and focused verification

Use a follow-up revision containing an identical-text move, a meaningful edit to
referenced behavior, a deleted reference, a changed supporting test, and a new
change outside the current tour. Verify each observation and access to the
original evidence. Include overlapping references and more than one authored mode.

Also exercise a changed comparison with identical cited bytes, a requirement-only
edit where the evidence workflow supports it, a rewritten head, a changed base,
missing Git objects, an incomplete refresh, and retry after failure. Verify that
inspection freshness follows the existing conservative policy in every case.

The reader trial asks what needs reconsideration and why, then checks for missed
new changes and added author effort. Do not use a passing anchor check or a model
reader's response as evidence of human comprehension or runtime correctness.

## Slice 3: portable handoff, conditional on observed friction

### Validate the need

Try the existing local link and HTML export with a second checkout at a different
path and a reader unfamiliar with the tour. Record the actual obstruction:
finding the artifact, binding a checkout, obtaining the exact evidence, locating
the section, or knowing how to continue. If the existing export resolves the
use case, improve the handoff guidance instead of building another integration.

### Bounded extension

For desktop opening, implement the relevant portable phase of
[Deep links to Bygone views](deep-linking.md). Resolve a shareable repository
hint to a validated local binding. A remote URL is a locator hint, not sufficient
checkout identity. Ask for a choice when multiple worktrees or clones qualify;
remember a binding only after validating the requested objects and document.

Keep three identities separate: the authored document/version, all resolved code
evidence including intermediate revisions, and the semantic mode/section target.
Pinning only base/head does not freeze prose or intermediate stack evidence.
Untracked documents can use the existing export path rather than invented Git
provenance. Preserve the distinction between current-document and fixed-snapshot
links, and never substitute current `HEAD` for missing pinned evidence.

An optional **Copy review handoff** action can assemble the tour title, intended
comparison, relevant section, and an existing export/desktop destination. When
no hosted export URL exists, describe the HTML attachment and semantic fragment
honestly. Copying a handoff does not create hosting or publish a PR comment.

Use the existing protocol and resolver architecture. Do not add another browser
extension, hosting service, or review-comment backend for this slice. Opening
links preserves the recipient's work and does not automatically clone, fetch,
checkout, or execute payload commands. Never serialize credentials in remote hints.

### Acceptance and focused verification

Verify the intended section in two clones with different paths, and distinguish
multiple worktrees, forks/remotes, missing history, a changed document, and a
deleted step. Check Unicode/reserved path characters and out-of-order open
requests. Missing targets retain the current view and provide an explicit
recovery action rather than opening a different target as if it matched.

A pinned handoff either opens the exact document and evidence or explains the
unavailable dependency. A current-document link is labeled accordingly. For an
HTML handoff, verify the recipient can open its section with no Bygone install.

## Scope and deferred directions

This plan adds no automatic fuzzy repair, general tour recorder, numeric health
score, approval carry-forward, new branching schema, background agent execution,
historical sandbox, runtime replay, GitHub/GitLab overlay, or two-way comment sync.
Those directions require separate evidence of need. Existing question capture,
narration, symbol comparisons, and portable export remain available foundations.

## Delivery and evaluation

1. Confirm the source/navigation and refresh integration points in slice 0.
2. Prototype loaded-tour Related explanations and run its focused reader trial.
3. Add a revision-impact report only after reconciling it with the existing
   evidence model and freshness policy; keep generation of an updated tour explicit.
4. Run the handoff trial, then select the smallest demonstrated improvement from
   the existing portable-link plan or handoff packaging.
5. For each implemented slice, update the owning product docs, run focused
   regressions and repository-required checks, and record platform/manual limits.

Evaluate time to locate relevant rationale, correctness of the reader's answer,
missed changed evidence, and total added author work. Use different changes or
counterbalanced order to reduce familiarity effects. Compare against existing
Bygone navigation and ordinary diffs with equivalent source links. Completion
rate, generated word count, and link clicks alone do not establish usefulness.

No application tests or human trials were run for this planning-only change.
The next implementation action is slice 0 followed by the bounded slice 1 prototype.

## Sources and related plans

Current implementation evidence is pinned below so subsequent readers can
distinguish the inspected baseline from future changes:

- [Present navigation and question capture][present]
- [Tour format, branches, and compiled evidence][format]
- [Pinned evidence, refresh, and renewed inspection][evidence]
- [Local links and standalone HTML export][sharing]
- [Reader feedback and tour repair guidance][feedback]
- [Checks and evidence semantics][checks]

Related planning: [product map](../ideas/bygone-product-map.md),
[workflow integration](workflow-integration-reconciliation.md),
[expectations and feedback](tour-assessment-and-feedback.md),
[optional navigation](optional-tour-navigation.md),
[review comprehension](review-comprehension.md),
[deep links](deep-linking.md), and [HTML exports](self-contained-html-tours.md).

[present]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/docs/present.md
[format]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/docs/change-tour-format.md
[evidence]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/docs/evidence-review.md
[sharing]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/docs/sharing-tours.md
[feedback]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/skills/pr-tour-guide/references/expectations-and-feedback.md
[checks]: https://github.com/davidmashburn/bygone/blob/fb3f45f01bf638af03190ac88bbaa6a7f6c91fac/docs/tour-checks.md
