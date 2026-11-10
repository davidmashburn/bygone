# In-app tour options menu

Status: Implemented and locally verified 2026-11-07 on `feat/tour-options-menu`; uncommitted, not installed or published.

## File metadata and display decision

Record the selected style, depth, audience, familiarity, coverage, emphasis,
and optional context notes explicitly as `options` in the tour source. Allow
independently authored modes to override root options. Record human authorship
as `author: { name, url? }`; retain `generatedBy: { model, harness?, effort? }`
and allow an optional provider name. The model identifier comes from the actual
authoring runtime. Never infer the human author from Git or equate the requesting
user with the author; prompt for an unknown name rather than invent it.

The authoring skill infers omitted settings from the user's request and code
context by default. Explicit choices win. Persist every resolved core setting
and list the inferred dimensions in `options.inferred`; inference is not an
excuse to leave the file ambiguous. Avoid a questionnaire for ordinary choices.
Use reliable supplied attribution for the human and actual runtime details for
the LLM; unknown authorship is not a tour-setting inference.

Introduce source/manifest version 8 for these additions. Older files remain
valid without invented metadata. Compilation and exports preserve the fields.
The options describe authoring intent, not measured quality or review completion.

Display the supplied metadata in the existing Tour details section, using plain
labels and a concise requested-configuration summary. Keep it out of the main
reading path; this uses an established secondary surface rather than a new
badge system. Missing human/model details remain absent. Broader display design
is deferred. Store metadata in `.bygone` files, not Markdown front matter.

Implementation baseline: clean `5a2f5a5b` on the existing development lineage,
a descendant of local `main` with the required current tour machinery. No
commit, push, or publication is implied by the build request.

## Intent and recommendation

Make the available ways of understanding a change discoverable inside Bygone,
including the existing tour kinds and an explicit exhaustive walkthrough.
Add a persistent **Tours…** action beside the workspace view controls, opening
a chooser with composable style, depth, audience, and coverage options, plus
useful starting presets. Keep History and Compare as direct
navigation, and retain the existing Historical/Deconstructed view controls in
the first slice. The chooser describes what to request and opens existing
content; it does not imply that every recipe has already been authored.

This extends the existing [tour discovery proposal](shared-workspace-tour-discovery-and-history-bridge.md).
It deliberately revisits that proposal's objection to a separate chooser for
this newly requested recipe menu, without replacing the workspace mode strip.

## Composable choices

Depth and audience are first-class scope. Offer named presets first, then show
their editable choices so readers can combine these independent decisions.
Do not enumerate every possible combination as a separate menu entry.

### Story style

- **Final result** — Explain what changed between the pinned endpoints and what
  survives in the finished result.
- **Historical** — Explain actual revisions, including updates, reversals, and
  decisions. Preserve the existing kind and its real-history semantics.
- **Deconstructed** — Teach the change through synthetic cumulative stages.
  Preserve the existing kind and label stages as constructed, not actual commits.

Final result is an authoring style over existing endpoint walkthroughs, not a
new revision representation. The current format can carry that evidence under
Historical, but the chronological label must not misdescribe it. Keep style,
recipe identity, and stored tour mode distinct. See the preserved
[tour-type alternatives](../ideas/tour-type-alternatives.md).

### Explanation depth

- **Headlines** — What changed, why it matters, and the main caveat. A few clear
  takeaways; implementation detail remains optional evidence.
- **Overview** — Behavior before/after, affected components, major decisions,
  and consequences. Enough to orient the reader.
- **Guided walkthrough** — Follow the relevant flow, explaining key mechanisms,
  contracts, and how the pieces fit together. Default for engineering readers.
- **Deep dive** — Explain invariants, alternatives, dependencies, edge cases,
  test evidence, and tradeoffs where supported by the change.
- **Line by line** — Explain individual edits and their local interactions,
  grouping repetitive mechanical edits explicitly. This is a granularity
  request, not a request to narrate unchanged lines or invent rationale.

These are explanation budgets, not guaranteed reading times. Any time estimate
must come from the authored artifact and be labeled as an estimate. Depth is
independent of breadth: a deep dive may cover one subsystem; a complete tour
may explain routine changes briefly. Do not confuse these user-facing choices
with the existing author-declared mentioned/explained/contextualized annotations.

### Audience

- **Peer engineer / code reviewer** — Contracts, correctness, tests, and what
  deserves close inspection. Default engineering audience.
- **New contributor** — Explain project vocabulary, component responsibilities,
  entry points, and how to investigate further; assume general coding knowledge.
- **Maintainer / code owner** — Invariants, compatibility, ongoing maintenance,
  extension points, and likely future failure modes.
- **Architect / technical lead** — Boundaries, dependencies, alternatives,
  architectural consequences, and longer-term tradeoffs.
- **Product / design** — User journeys, behavior changes, constraints, edge
  states, and acceptance criteria, with code evidence available on demand.
- **QA / test engineer** — Observable behavior, test scenarios, regressions,
  boundaries, and verified versus unverified coverage.
- **Operations / SRE** — Deployment, configuration, observability, failure
  handling, rollback, and migration implications when applicable.
- **Security / privacy reviewer** — Trust boundaries, access, data handling,
  abuse cases, and evidence gaps; do not invent a vulnerability to fit the lens.
- **Leadership / stakeholder** — Outcomes, scope, tradeoffs, dependencies, and
  unresolved risks in plain language, without unsupported impact estimates.
- **Library / API consumer** — Public behavior, migration examples,
  compatibility, and adoption implications; avoid assuming internal familiarity.

An optional **Familiarity** control (New to this codebase / Some context /
Already familiar) adjusts assumed background independently of role. New
contributor defaults to New to this codebase; every default is editable.
Do not infer technical competence from job title. Audience affects vocabulary,
framing, examples, and evidence emphasis, not the facts or confidence level.

### Coverage and optional emphasis

- **Key changes** — Select the changes most relevant to the requested audience
  and depth; disclose that selection.
- **100% of changes** — Include every textual hunk and account for every other
  changed file entry under the strict contract below. Keep the scope explicit.

Path/component selection remains the scope boundary, shown beside coverage.
An optional multi-select **Emphasis** offers behavior, design decisions,
correctness/edge cases, tests, performance, security/privacy, and rollout/
compatibility. These are lenses, not extra tour modes. Use only applicable
evidence and say when the repository does not establish an answer.

### Starting presets

- **Catch me up** — Final result · Overview · Peer engineer · Key changes.
- **Stakeholder briefing** — Final result · Headlines · Leadership · Key changes.
- **Product walkthrough** — Final result · Overview · Product/design · Key changes.
- **Help me review this** — Final result · Deep dive · Peer engineer · Key changes;
  emphasize correctness and tests.
- **Explain every change / 100%** — Final result · Guided walkthrough · Peer
  engineer · 100% of changes. Depth remains adjustable.
- **Line-by-line review** — Final result · Line by line · Maintainer · 100%.
- **Onboard me** — Deconstructed · Guided walkthrough · New contributor · Key changes.
- **Architecture deep dive** — Deconstructed · Deep dive · Architect · Key changes.
- **How we got here** — Historical · Guided walkthrough · Peer engineer · Key changes.
- **Test planning** — Final result · Deep dive · QA · Key changes; emphasize tests.
- **Deployment readiness** — Final result · Deep dive · Operations · Key changes;
  emphasize rollout, compatibility, and failure handling.
- **Security review tour** — Final result · Deep dive · Security/privacy · Key changes.

Use a short featured group plus **More presets**, rather than twelve permanent
workspace tabs. Selecting a preset populates visible controls; subsequent edits
produce a custom configuration. Include editable audience/context notes, but
defer persistent personal preset management. Also defer **Since my last review**
until there is a verified previous-review baseline.

### Combining choices honestly

Headlines + 100% means a brief opening plus a complete, concise walkthrough or
explicitly available detail path. It cannot promise a tiny total reading time.
Distinguish main-path coverage from coverage available in optional details;
opening the short main path does not mean the reader has traversed everything.
Line by line + Key changes is valid for a selected subset and must say so.

Historical or Deconstructed + 100% still refers to final-result inventory,
not every historical or synthetic intermediate edit. Include endpoint evidence
or a complete final-result companion section. Never silently change the style
or weaken coverage to accommodate the combination. A nontechnical audience can
request a deep dive: increase causal detail in appropriate language rather than
silently reducing depth or forcing source-level narration.

## Menu behavior and authoring handoff

Each preset has a one-sentence purpose and previews its selected dimensions,
and separate actions for **Open available tour** and **Prepare prompt**.
Show Open only when applicable content is actually identified; otherwise offer
**Open existing tour…**. Do not infer a recipe from a title, long narration, or
a file's existence. Legacy documents remain available by their actual tour
kind without invented audience, depth, or recipe classification. Existing tours
do not change merely because the user changes the requested configuration.

Prepare prompt reuses the editable, provider-neutral prompt dialog, including
Copy, reset, and the bundled tour instructions. Compose instructions from
style, depth, audience, familiarity, coverage, emphasis, and user notes, using
a shared typed configuration. Preserve edited drafts when controls change:
offer an explicit rebuild from selections, and keep the previous draft until
that action. Never silently replace manual edits with generated template text.
There is no provider setup or automatic model invocation in this scope.

Show the repository, pinned endpoints, and whole-change versus selected-path
scope before copying. No silent conversion of arbitrary comparisons to a
merge-base range. Missing, reversed, divergent, multi-revision, and uncommitted
inputs retain their explicit limitations and route to revision selection.
Browsing the menu or editing a prompt leaves the active view and unsaved
Compare selection untouched; only opening actual content changes the view.

Opening the menu works even when no tour is loaded. An empty state links to the
same chooser. Preserve keyboard navigation, Escape, focus return, per-view
positions, the Files rail, and Return to tour. Reuse the shared controls across
desktop and VS Code. Exported HTML exposes bundled tours and honest capability
limits; it must not advertise local file loading or history it cannot perform.

The first slice continues to load one document with its supported authored
modes. It does not require storing every configuration in one document or an
automatic tour library. Explicit recipe metadata may identify a loaded
artifact, but legacy files must work without it. If metadata is needed, use
the existing schema/version compatibility process; do not smuggle new recipe
strings into the current two-value tour-mode contract.

## What “100%” promises

The denominator is the pinned comparison's complete change inventory, or its
explicitly selected path scope. A path-scoped result must say **100% of selected
paths**, never imply the entire PR. This is final-result coverage, not coverage
of all historical edits that were later reverted.

For each textual hunk, provide an explicit explanation stop with the complete
hunk available as evidence. Account for additions, deletions, and both sides
of renames. Generated files and lockfiles may be grouped, but remain included
and accessible. No exclusion silently reduces the denominator. A partially
authored result stays usable and displays the uncovered count.

List binary files, mode-only changes, submodules, pure renames, and other
zero-hunk or unsupported entries separately, with an explicit explanation or
an unresolved limitation. Display textual coverage and this file accounting
separately. Unresolved material prevents an unqualified completion claim.
An empty textual inventory says “No textual changes,” not a vacuous 100% badge.

Keep **requested recipe**, **verified structural coverage**, and **reader
progress** separate. A tour titled “100%” is only a request until its artifact
passes the checks. Completion uses exact counts, not rounded percentages.
Changing endpoints or path scope invalidates previously computed coverage.
Coverage does not establish correct explanations, correctness of the code,
successful tests, or human review completion.

The current hunk-overlap coverage score is insufficient for this promise.
Retain its existing informational meaning for old tours. Add a bounded strict
check for this recipe, using the same inventory and exposing any gaps; do not
relabel the old percentage as complete explanation. Author-declared depth is
also not an automated measure of explanation quality.

## Implementation boundaries and sequence

1. Add named configuration types, a preset catalog, and a chooser to shared
   workspace controls. Include depth and audience in this first slice, not as
   deferred customization. Compose concrete authoring instructions per dimension;
   keep the existing mode type and wire values stable. This slice provides
   useful discovery and handoff without claiming generated artifacts are ready.
2. Add recipe-aware artifact identification and labels only where needed for
   opening/recognizing loaded content. Resolve exact scope and compatibility
   before introducing optional metadata. Do not broaden to discovery across
   disk, hosted collections, or multiple simultaneous documents.
3. Add strict 100% accounting and the reader-facing inventory/gap summary.
   Carry verified results into compiled/exported artifacts with their pinned
   range and scope. Make the complete label conditional on this evidence.

Touch points: `media/workspaceControls.js` and its CSS, `src/workspacePrompt.ts`,
`standalone/workspaceHost.js`, `web/host.js`, and existing VS Code host adapters.
Coverage work belongs with `src/changeInventory.ts` and `src/tourCoverage.ts`;
any artifact metadata belongs in the source/manifest schemas and parsers.
Update bundled authoring instructions and user documentation with the contract.

Non-goals: built-in AI execution, model selection, billing, automatic review
verdicts, semantic correspondence between recipes, new synthetic-stage
algorithms, a tour library/hosting service, or a general workspace redesign.

## Acceptance and verification

- No tour, one existing kind, both existing kinds, and legacy Final tour:
  chooser remains useful and identifies only content actually present.
- Each recipe produces distinct instructions with correct pinned endpoints
  and scope; reset/copy and draft retention work without changing views.
- Hold style/scope constant while changing depth or audience: verify the prompt
  changes the requested explanation, assumed context, and evidence emphasis,
  without changing facts or claiming an existing artifact was adapted.
- Exercise Headlines + 100%, Line by line + Key changes, Historical + 100%,
  Deconstructed + 100%, and Leadership + Deep dive. Preserve every explicit
  selection and show main-path versus optional-detail coverage accurately.
- Presets populate visible controls; custom edits, familiarity overrides, and
  edited prompt text survive navigation. Legacy artifacts have unknown optional
  dimensions rather than fabricated defaults.
- Unresolvable ranges and non-Git inputs produce actionable limitations;
  exports preserve Minimal/Full capability differences.
- One uncovered hunk, a partially intersecting anchor, exclusions, rounding
  near 100%, zero textual hunks, and unsupported files cannot falsely satisfy
  strict completion. Duplicate evidence cannot inflate it.
- Added/deleted/renamed files, mode-only changes, grouped generated material,
  selected paths, and changed revisions have explicit inventory outcomes.
- Verify keyboard/focus behavior and state restoration in shared-control tests,
  prompt tests, coverage fixtures, and desktop/VS Code/export smoke checks.
  Inspect a representative generated example of each new recipe for explanatory
  usefulness; mechanical coverage alone cannot validate that judgment.

## Original scoping evidence and handoff

Inspected 2026-11-07: development checkout `local/tour-quality-seven-rounds`,
commit `cb3223df5b3be52e3face6cebaa13a9a45fcbe96`. Implementation should start
from the then-current `main`, after checking which inspected behavior is merged.
The checkout has unrelated uncommitted work, including `web/host.js`; observations
of that file describe the working tree, not a clean release claim. This scope
does not depend on the untracked related-tour or revision-impact features.

- `media/workspaceControls.js`: four workspace modes, missing-tour entry,
  existing Create/Open actions, bundled skill and prompt dialog.
- `src/workspacePrompt.ts`: two authoring kinds and explicit exact-range guard.
- `web/host.js`: authored mode availability, legacy Final tour mapping, and
  export capability distinctions.
- `src/changeInventory.ts`: deterministic hunk/file inventory resolved through
  branch-review range semantics; arbitrary endpoint/path scope needs explicit
  verification before reuse for a completion claim.
- `src/tourCoverage.ts`: intersection-based coverage, exclusions, author-declared
  depth, rounding, zero-denominator handling, and Historical/legacy fallback
  selection. Strict checks must target the selected artifact, not an unrelated
  mode's evidence.

Confidence: high in the existing two-kind/prompt/coverage constraints from
source inspection; medium in the proposed composable chooser without user trials.
A current-main comparison, a usable existing recipe registry, or reader tests
showing confusion between recipes and modes could change the implementation
shape. First implementation investigation: prove recipe identification and
strict inventory scope with a small fixture before expanding the schema.

Only source/document inspection was performed. No application, automated tests,
generation trials, or export smoke checks were run for this scoping task.
The planning branch is locally ahead/behind its cached remote-tracking ref;
remote state was not refreshed, and no commit or publication is part of this task.


## Implementation evidence — 2026-11-07

Implemented locally on `feat/tour-options-menu`, based on development head
`5a2f5a5b`. No planning history was merged into implementation. Changes remain
uncommitted and are not installed or published.

- `src/tourOptions.ts`, `media/tourOptionsControls.js`, and
  `media/workspaceControls.js`: twelve presets, five independent depth choices,
  ten audiences, familiarity, style, coverage, emphasis, context, and human
  attribution. The persistent Tours menu reuses the prompt handoff and preserves
  edited drafts; exports expose only available navigation capabilities.
- `src/workspacePrompt.ts` and `skills/pr-tour-guide/SKILL.md`: concrete guidance
  for each choice, exact-range preservation, infer omitted settings by default,
  state the resolution, and record `options.inferred`. Human attribution and
  runtime provenance require evidence, not preference inference.
- Source/schema/manifest version 8: root and per-mode options, human `author`,
  generator model/provider/harness/effort, and explicit nontext file accounting.
  Existing supported source versions remain readable without invented metadata.
- `src/tourCoverage.ts` and `src/tourCompleteCoverage.ts`: strict mode-local
  endpoint coverage, full intervals on both changed sides, pinned range and
  scope, raw counts, exclusions/limitations, and explicit binary/zero-hunk
  accounting. Optional branches cannot count toward the main path. Empty
  textual inventories do not earn a vacuous 100% claim.
- Compiler/CLI/presenter/export integration preserves and validates the report.
  `web/tourDetails.js` and `web/tourCompleteCoverage.js` use the existing secondary
  details surface for configuration, attribution, and requested versus verified
  coverage. Legacy coverage thresholds keep their previous meaning.

Validation passed: `npm test` (core runner plus 662 Node tests, zero skipped),
`npm run typecheck`, `npm run lint`, `npm run bundle:check`, and `git diff --check`.
Electron workspace, offline export (both profiles/modes), and image-evidence
smokes passed. The web host budget was raised from 305 KB to 330 KB for the
options catalog, embedded guidance, metadata, and strict report UI; the built
host is approximately 323 KB. Browser inspection exercised the chooser, draft
preservation, narrow layout, and focus recovery. Regression fixtures cover
metadata round trips, legacy compatibility, all preset/depth/audience prompts,
mode isolation, optional evidence, partial hunks, exclusions, file accounting,
unknown scope, range overrides, and stale or inconsistent exported claims.

No human reader trials or generated-tour quality study was performed. The full
packaged VS Code/platform matrix and release/install workflows are out of scope.
Confidence is high in the exercised contracts and moderate in the menu's
usability pending reader trials; those trials could change labels and defaults.
