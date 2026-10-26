# Workflow integration reconciliation

## Status and evidence

Approved for implementation by the user on 2026-10-26, following the assessment
below. Implemented locally from dependency validation commit `dda37567`; see the
implementation reconciliation below for delivery evidence and remaining limits.
The original assessment inspected Bygone `main` at
[`c7219ed06351626b8a65627fbb0427b57c576bbf`](https://github.com/davidmashburn/bygone/commit/c7219ed06351626b8a65627fbb0427b57c576bbf),
Daniel's PR Reviewer local fork at `581d9137bbba8e01f184fe93907ba76682267f10`,
and relevant skills-library workflow sources at `0dd4d52`. PR Reviewer was
clean on `pr/requirements-only-mode`; this is not a claim about its latest
upstream state. This assessment does not depend on uncommitted product code.

Dependency compatibility/performance validation belongs to the active
[Evaluate Dependency Graphs thread](t3-thread://v1/85fecd06-8b4d-4dd3-9e4a-2648a6026a40).
Its completed validation checked 36 labeled dependency sites and 158 source
references. It identified newer TypeScript syntax/options, malformed package
metadata fallback, and unrelated JSON consuming input budgets as remaining gaps.
Its benchmark/documentation commit landed as `dda37567`; production behavior was unchanged.
Those findings constrained the original integration. After that thread finished,
the user authorized dependency improvements in this thread; the follow-up below
records those fixes separately from the original validation baseline.

## Assessment

The components now cover much of the work, but their handoffs remain incomplete.
The next useful integration is a bounded loop from an intended outcome to
pinned evidence, into a live edit, and back to a refreshed review. Building
another outline, review database, or general graph surface would not close that
loop by itself.

### What is actually available

- **SCM, symbols, editing:** merged. Native Git comparisons, provider-selected
  symbol focus, snapshot matching, pinned targets, and synchronized working
  documents have production consumers. Working documents are authoritative in
  VS Code; staged and historical endpoints remain read-only. Scope is JS/TS
  file pairs, including Git-reported rename pairs. See
  [the implemented contract](https://github.com/davidmashburn/bygone/blob/c7219ed06351626b8a65627fbb0427b57c576bbf/docs/vscode-integration.md).
- **Strand and requirements:** source-reference validation/relocation and the
  version-2 requirements model are compiled and tested. Requirements navigation,
  reports, and tour projection are still experimental scripts, not a native
  requirements panel or production import command. There is no separate
  requirements package. See
  [the experiment and limits](https://github.com/davidmashburn/bygone/blob/c7219ed06351626b8a65627fbb0427b57c576bbf/scripts/requirements-experiment/README.md).
- **Dependencies:** committed module evidence is available through the CLI and
  opt-in tour context. It describes syntactic module relationships and potential
  initialization sites, not a runtime trace or symbol call graph. A change from
  one imported symbol to another in the same module can leave the module edge
  unchanged. Compatibility and usefulness are being measured in the other thread.
- **Tours and review feedback:** evidence navigation, pinned exports, and copied
  explanation/review requests already exist. Feedback captures authored versus
  displayed comparison context. The broader live originating-agent conversation
  plan remains separate; copied requests are not evidence that it is implemented.
- **PR Reviewer:** requirements, fulfillment assessments, inferred flow, and
  mutable reviewer state exist. The inspected checkout has no production Bygone
  bridge, and Bygone has no production consumer of `src/requirements.ts` beyond
  the experiment/tests. Shared concepts are not an implemented interoperability
  contract.

## Friction and recommended boundaries

### 1. Preserve comparison identity through every handoff

The live editor, committed tour, requirements report, dependency report, and
PR Reviewer can refer to different versions while showing the same filename.
Reuse the existing source-reference and comparison contracts through small
adapters. Do not collapse live snapshots and committed evidence into one
undifferentiated revision string.

At the handoff retain repository identity separately from the local worktree
locator; ordered comparison endpoints and baseline policy; exact source focus;
and an optional origin/return location. Live targets additionally need their
document version and captured digest. Pinned review links need immutable Git
OIDs. Existing `DeepLink` supports pinned comparisons or tour document positions;
it does not encode a requirement ID, live edit target, or a cross-tool return path.
Start with local session return context and existing links; version any durable
extension only once a concrete consumer needs it.

Dependencies already use UTF-16 ranges and SHA-256 selected-text digests, as
Strand does. Adapt `{oid,file,start,end,digest}` into Strand's
`{revision,path,start,end,digest}` after validating the snapshot, retaining
dependency-specific blob identity, resolution, phase, and coverage. PR Reviewer's
anchors are inclusive new-file line ranges: convert against exact text, never
treat line numbers as offsets. Include non-ASCII and CRLF fixtures. Strand's
offsets are UTF-16 code units, not bytes.

### 2. Make evidence availability understandable

The committed viewer hides Symbols whenever no correspondence artifact is
loaded (`web/host.js`, `renderCorrespondences`). That makes an available feature
look removed; this also occurred in actual use. Explain missing analysis near
the existing navigation: not requested, computing, available, partial, stale,
unsupported, or failed, with a relevant next action. Do not show every possible
tool as a permanent empty tab or automatically run expensive analyses.

Live VS Code symbol analysis and committed viewer analysis have different entry
paths. Make that distinction visible. Keep analysis availability, reference
validity, recorded test results, and human inspection separate. In particular,
zero linked evidence, an unresolved edge, and a complete analysis are different
facts; none is a fulfillment or safety score.

### 3. Connect Daniel's tool without copying its application

Preserve the earlier agreed boundary: Strand owns generic source references and
correspondence; the small Bygone module owns requirement/evidence bookkeeping
and its review freshness policy; Daniel's application owns its analysis pipeline,
findings, discussions, checklists, and publication state. The task workflow owns
execution and authorization. No Python service needs to run inside Bygone, no
LLM orchestration port is needed, and no new package is justified yet.

A versioned, one-way import/export adapter is the first interoperability slice,
not the entire long-term integration. Native deterministic inspection and refresh
remain TypeScript operations. Bidirectional decision synchronization needs a
separate, agreed ownership contract and evidence of demand.

Two correctness prerequisites come before an Open in Bygone button:

- PR Reviewer's `PRInfo` records branch names and timestamps, not immutable
  base/head OIDs. Capture the actual analyzed comparison when acquiring inputs,
  including the merge-base policy, and ensure the diff/content agrees with those
  OIDs. Fetching today's HEAD during export must not relabel yesterday's review.
  Legacy results without provable identities remain unpinned or require rerunning.
- `merge_rerun_state` carries verified cards by normalized text. That checkbox
  cannot become a current Bygone inspection decision. Preserve it as source-owned
  historical state; Bygone's requirement/evidence fingerprints determine its own
  freshness. A valid anchor also does not prove the linked requirement is met.

Map quoted source snapshots and evidence roles explicitly. Preserve unmapped
requirements, contradictory interpretations, partial flow, and omitted input
warnings. Keep PR Reviewer's inferred flow distinct from syntactic dependencies
and future runtime observations; one cannot validate the others by renaming it.

### 4. Close the edit-and-review loop

From a pinned requirement or tour stop, offer an explicit action to locate the
current working counterpart. Reuse the existing VS Code controller and guarded
editing path. Preserve the original evidence and a return location. If mapping
is ambiguous, deleted, outside the supported scope, or stale, retain historical
evidence and offer file context rather than opening an arbitrary editable slice.

Saving a document does not refresh a committed review. After a new commit, the
host reads exact snapshots, obtains validated old-head-to-new-head correspondence,
and calls `refresh`; requirement-only edits also need reassessment at the same
commit. Retain the original PR comparison baseline or explicitly start a new
comparison if the base changes. An incremental head delta is not the full PR.

The existing conservative rule requires renewed inspection on every new
comparison, even if cited bytes are unchanged. Keep it. A changed dependency or
unchanged consumer can prioritize what to inspect next, but cannot establish that
all other requirements remain correct. Refresh affected current tours after a
repair; intentionally historical tours keep their pinned revisions and labels.

## Broader workflow reconciliation

Retain the task-workspace loop: intent, context, action, drift, evidence, review,
memory. Integrate by linking existing issue/task/PR identities and recording the
relevant artifact/revision; do not require a second ledger or every tool on every
task. The `prepare-change-for-review` prototype already supports an ordinary diff
with links, a verified synthetic comparison, an optional tour, or no new artifact.

Requirement extraction can help identify intended outcomes. Bygone makes cited
evidence inspectable. Questions expose missing or disputed intent; they do not
resolve it automatically. Repair code, tests, maintained docs, PR rationale, or
the tour according to the problem. A reply from an agent does not itself update
any of those artifacts. Tracker decisions, PR approval, CI, and merge remain in
their existing systems. The viewer does not become the task orchestrator.

For authored/synthetic comparisons, retain source-revision provenance and endpoint
tree validation. Do not attach a real-PR dependency report or verification receipt
to reconstructed commits merely because displayed files look similar. Resolve
the artifact's actual range and disclose any translation.

Related direction: [product map](../ideas/bygone-product-map.md),
[paired comprehension](paired-comprehension-implementation.md),
[review comprehension](review-comprehension.md),
[deep links](deep-linking.md), and
[originating-agent routing](conversational-voice-and-agent-routing.md).

## Proposed delivery order and acceptance

1. **One pinned requirement workflow.** Add the smallest host load/inspect/open
   path around the existing module, plus PR Reviewer export capture/import.
   Use a synthetic shared fixture first. A requirement opens exact evidence,
   reports missing evidence and partial inputs, and survives serialization.
   A changed PR head between acquisition and export is rejected or explicitly
   historical. A requirement-only edit invalidates the prior decision. Existing
   unpinned reviews never acquire false provenance.
2. **Live edit and return.** Hand a verified working counterpart to VS Code and
   restore the original requirement/comparison afterward. Demonstrate full-file
   and slice edits, an intervening native edit, a staged/dirty mismatch, save/undo,
   and an ambiguous move. Reuse existing editing tests and add only handoff cases.
   Commit, refresh evidence, and show retained notes with renewed-review status.
3. **Dependency-guided inspection.** After the active validation thread settles
   its findings, consume its existing report as context and navigation. Show
   changed module edges and direct unchanged consumers with per-analysis limits.
   Test a same-module imported-symbol change as a negative control. A graph UI,
   runtime importer, and semantic call graph remain separate follow-ups.
4. **Evaluate the whole loop.** Compare with an ordinary diff plus equivalent
   source links on a real, authorized review. Measure locating decisive evidence,
   understanding a boundary case, losing/restoring context, and total preparation,
   review, and refresh effort. Neither linked coverage nor agent agreement proves
   comprehension. Prioritize further UI from observed friction.

The Symbols availability explanation is a small independent usability repair
that can precede this sequence. Broader library extraction, new outline engines,
automatic approvals, background runtime tracing, and a universal graph are not
prerequisites.

## Verification and confidence

High confidence in the identified wiring and identity gaps: inspected source,
import consumers, current docs, existing plans, and a focused independent
PR Reviewer audit, then checked its consequential findings against code. Corrected
that audit's range terminology to UTF-16 and strengthened its proposed export
boundary to capture identity at analysis time, not by querying current refs later.

Primary evidence includes Bygone `src/requirements.ts:152-234`,
`packages/strand/src/source-references.js:16-63`, `src/dependencyGraph.ts:19-53`,
`src/deepLink.ts:9-20`, `src/tourFeedback.ts:51-64`, and
`web/host.js:2172-2188`; PR Reviewer `models.py:27-49,167-188`,
`providers/github.py:74-98`, and `pipeline.py:683-711`, at the revisions above.

Moderate confidence in the delivery order and user benefit. A successful real
handoff, evidence that the inspected PR Reviewer branch differs materially from
Daniel's intended integration surface, or final dependency-validation results
could change it. No application was started, test suite rerun, live PR analyzed,
upstream fetched, or new native UI interaction validated during this assessment.
Earlier implementation test results are inherited evidence, not tests performed
for this reconciliation. No implementation changes, shared-system writes,
commits, or pushes were made by this planning pass.

## Implementation reconciliation — 2026-10-26

The plan was committed as `799a64eb` and implementation started from Bygone
`dda37567`, which includes the dependency thread's completed validation commit.
The earlier assessment above remains a record of the pre-implementation state.
Implementation is committed in Bygone as `d161ce5c` (version 0.11.1) and in the
PR Reviewer fork as `6e8dc5e`. Publication is tracked separately; these commits
do not claim an upstream PR Reviewer merge.

Delivered locally:

- `src/reviewWorkspace.ts`, `src/evidenceController.ts`, and `cli/evidence.js`
  provide bounded load/inspect/import/refresh/tour paths around the existing
  requirements model. Source references, questions/alternatives, execution
  records, inspection notes, incomplete analysis, and uncovered files remain
  separate. Refresh preserves the original baseline and historical artifact;
  divergent history needs a new import, and requirement-only updates must name
  the original repository and comparison.
- PR Reviewer captures immutable GitHub base/head/merge-base and diff identity
  during acquisition, with a metadata race check. Its versioned export converts
  inclusive line anchors to UTF-16 against captured source, preserves quoted
  requirements, discloses omitted inputs, and excludes reviewer checklist,
  publication, and approval state. Old unpinned reviews remain readable but
  cannot export invented provenance. Export is producer-side; Bygone validates
  the resulting v2 contract against the selected local Git repository.
- Pinned evidence hands off to the existing guarded full-file/symbol editor.
  Exact mapping survives intervening native edits; absent counterparts stay
  read-only, unsupported/ambiguous mapping falls back to file context, and
  Git-reported rename pairs retain their source/destination paths. Return keeps
  the originating review distinct from the live working document.
- Dependency import validates range/blob/source identity, declared per-snapshot
  limits against referenced source files, and full inventory identity before
  exposing added/removed edges and unchanged consumers. Its negative control documents unchanged module edges
  despite an imported-binding change. Validation has an elapsed-time budget;
  producer input without records and original producer elapsed time cannot be
  independently reconstructed. The existing Symbols surface explains
  when correspondence was not supplied.

Verification: Bygone legacy runner plus 494 Node tests; PR Reviewer 52 tests,
including actual export/import/tour interoperability; typecheck/lint/bundle and
VSIX/npm packaging; fresh Lima Extension Host runs with 8 evidence, 29 SCM, and
16 following checks on each of VS Code 1.74.0 and 1.143.1. See the implementation's
`docs/evidence-review.md` for commands, limits, and the verification record.

The real-review comparison used merged SCM repair `c7219ed0`: one quoted
requirement, two validated implementation/test links, three explicitly uncovered
changed files, and an equivalent ordinary diff. Inspection took approximately
234 ms in one local run; this is neither a benchmark nor a measure of human
review speed. Return/refresh correctness is automated evidence. Locating decisive
evidence, comprehension, and total human effort still need a paired user trial;
acceptance slice 4 is therefore only functionally evaluated. No human benefit
claim is made.

Intentional limits remain GitHub-only capture, trusted local workspaces, existing
editing/source budgets, explicit refresh, no automatic fulfillment/approval,
and no runtime/call graph or bidirectional reviewer-state synchronization.
Live provider/model calls, manual browser visual QA, and Windows/macOS Extension
Host testing were not performed in this implementation pass. The dependency
compatibility gaps remain owned by the dependency follow-up, as agreed.

The final independent review identified incomplete dependency summary identity
and unenforced source budgets. Both were repaired and covered by regression
tests; the 494-test run and both evidence Extension Host suites passed afterward.
No other confirmed defect remained in the scoped review.

## Full-workflow and dependency follow-up — 2026-10-26

The user requested a full-workflow review and authorized dependency/call-graph
improvements after the initial implementation. The follow-up is committed in Bygone `d161ce5c` and PR Reviewer `6e8dc5e`,
based respectively on `dda37567` and `581d9137`. Release publication remains
a separate operation.

The dependency analyzer now uses isolated TypeScript 5.9.3 for bundler options and
modern syntax, while Strand and the extension compiler remain on 4.9.5. Explicit
compiler paths prevent the npm alias from changing repository typecheck/watch
behavior. Only source-ancestor compiler/package metadata, relative inheritance
closure, and required directory-import metadata consume the source budget.
Malformed/unavailable required package metadata yields partial coverage and
`invalid-config`, not a fallback target. Deferred imports retain unknown timing.

The follow-up corpus passes 38 labeled HEAD sites in 11 contract cases, four
scale cases and 158 source-reference checks. Selected public-file labels match
Express 9/9, p-limit 1/1 and Redux 13/13; Redux previously resolved none of its
13 expected internal entry-file targets. Exact source/bundle hashes and measured
timings live in `scripts/dependency-benchmark/results-2026-10-26-compatibility.json`
beside implementation. These results do not prove runtime behavior or general
accuracy. Lexical call binding, runtime traces, graph visualization and human
utility trials remain separate work.

Workflow review fixes retain producer-reported unexplained hunks and overflow
counts as explicit limitations, surface discussion-fetch failure, correct rename
coverage and make import reports match their cleared inspection decisions.
Producer receipt hashing is documented as initial projection identity, not
authentication or a checksum of later edits. Dependency navigation includes the
relationship, specifier, target, phase and loading without claiming call binding.

Latest checks: legacy runner and 503 Node tests; PR Reviewer 56 tests including
actual export/import/tour interoperability; explicit root TypeScript checking,
ESLint, bundle budgets, VSIX and npm packaging. The final evidence suite passed
9 checks on each VS Code 1.74.0 and 1.143.1 in Lima. The earlier 29 SCM and 16
following checks per version remain inherited evidence for unchanged bridges.
Live provider/model calls, manual visual QA, Windows/macOS Extension Hosts and
human review benefit remain unverified.

The bounded final review also identified inconsistent discussion truncation and
a combined dependency byte cap that rejected otherwise valid snapshot pairs.
Both are fixed and regression-tested: discussion extraction/quote validation/
retention share the same slice; dependency import retains per-snapshot limits
and allows their combined budget. The final broad review also found a
review-switch race during symbol mapping and incomplete dependency counter
validation. Generation/identity checks now discard stale handoffs, and imported
coverage must account for every candidate and unresolved edge. Both repairs passed the full Node suite and real Extension Host tests on
both versions, including review replacement/closure while a symbol worker is
pending. The full-workflow review is complete with no remaining confirmed defect
in the delivered scope. Human workflow benefit and the listed platform/provider
limits remain unverified.
