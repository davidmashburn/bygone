# Product implementation roadmap

## Status

Active

## Current implementation order

The quick and near-quick pass completed plan reconciliation, standalone menu
organization, writable-pane Replace, production command cleanup, Open Authored
Tour, panel mutability labels, advanced checked-in tour examples, focused
multi-panel navigation, visible/all-panel/change-set search, Git-history search,
authored-tour narrative/code search, minimal VS Code desktop hand-off, and VSIX
content assertions. The repository-search adapter is benchmarked and reports
its ripgrep capability; standalone now exposes read-only Search in Files and a
guarded case-sensitive literal Replace in Files preview with exclusion,
revalidation, atomic writes, rollback, and hash-guarded undo. Search-engine
differences and in-memory adapter budgets are documented and tested.

The queued browser/presenter QA and VS Code companion work are complete.
Presenter layouts were exercised at 960, 1200/1280, and 1500 pixels. The VS
Code extension now uses independent editor-area file-pair tabs, a reusable
file-history tab, VS Code-owned document editing, reload restoration,
contextual commands, and guarded Desktop hand-off. Remaining platform work is
tracked by its owning plans rather than as unfinished host migration.

The canonical [`.bygone` document format and macOS native opening](bygone-document-format.md)
are complete. Windows and Linux associations remain explicit follow-up
packaging work.

## Goal

Order the current plans by dependency and product risk so each implementation
reinforces a coherent Bygone system rather than adding another isolated mode.

This roadmap is not a promise that every draft is still unimplemented. Several
planning documents describe capabilities that may already exist partly or
substantially on the development branch. The first step is to reconcile each
plan with shipped code and retain only unmet acceptance criteria; do not
reimplement behavior merely because its planning status still says Draft.

## Product boundaries that control the order

1. **Standalone Explore** owns full-canvas file, directory, multi-panel,
   revision, history, and branch workflows.
2. **Standalone Present** owns automatic and authored tours.
3. **VS Code** owns contextual two-way file comparison and file history in an
   editor-area tab, then hands larger work to standalone.
4. **The shared renderer and model layer** own diff semantics, active-pane
   editing commands, focused multi-panel behavior, and result presentation.
5. **Host adapters** own filesystems, Git, process spawning, refresh sources,
   workspace trust, and lifecycle integration.
6. **CLI and agent tools** own tour authoring, validation, compilation,
   coverage, and automation rather than desktop form complexity.

These boundaries must be accepted before broad search or additional tour
scenes expand the number of host integrations.

## Dependency map

| Foundation | Enables |
| --- | --- |
| Product-surface inventory and host ownership | Menu cleanup, VS Code narrowing, packaging assertions |
| Session source descriptors and explicit refresh | Stable hand-off, comparison search, stale-result invalidation |
| Active editor/target command routing | Edit menu, Find/Replace, host-consistent shortcuts |
| Diff matching quality gate | Trustworthy two-way and adjacent multi-panel rendering |
| Focused multi-panel interaction | Usable stacked revisions and advanced tour scenes |
| Shared change inventory | Tour coverage and deconstructed-diff validation |
| Shared search query/result contract | Visible-panel, session, Git, filesystem, and tour search adapters |

## Stage 0: reconcile plans with current main

Before feature work, perform a short evidence pass across every plan:

1. Record whether each acceptance criterion is implemented, partially
   implemented, or absent on current `main`.
2. Mark completed plans or split remaining work into a smaller follow-up.
3. Keep the planning and product term **Deconstructed diffs** so internal
   terminology cannot leak a false historical claim. Completed.
4. Ensure each plan links to the owning product surface and lists its host
   behavior.
5. Add the internal product-surface overview to the development branch and
   require updates when commands, modes, scenes, or artifacts are added.
6. Build all new tests and benchmarks from open-source fixtures created for
   Bygone; remove or replace any proprietary-derived evidence.

This stage prevents already-shipped matcher, refresh, focused-strip, coverage,
or advanced-tour work from being scheduled twice.

## Stage 1: settle product ownership and interaction foundations

### 1.1 Standalone and VS Code surface decisions

Approve together:

- [Standalone product surface](standalone-product-surface.md)
- [VS Code companion surface](vscode-companion-surface.md)

Decide the visible vocabulary, editor-area extension host, desktop hand-off,
production versus developer commands, and VSIX packaging boundary before
adding more commands.

### 1.2 Explicit session refresh foundation

Implement or finish Phase 1 of [Refreshable sessions](session-refresh.md):
source descriptors, centralized rebuilds, state preservation, dirty-content
conflict policy, and a narrow host/renderer protocol.

This precedes session-wide search and desktop hand-off because both need stable
source identity and invalidation semantics.

### 1.3 Active-pane editing commands

Implement [In-document find behavior](find-behavior.md) together with the Edit
menu slice of the standalone plan:

- active-target resolution;
- Undo/Redo, Cut/Copy/Paste/Delete/Select All routing;
- Find, Next, and Previous;
- Replace and Replace All only for writable active models; and
- read-only, dirty, save, reload, and diff-recomputation tests.

The original find plan's find-only delivery remains a valid first commit, but
pane-local Replace is the immediate completion criterion for the conventional
Edit surface.

## Stage 2: align the two primary hosts

### 2.1 Standalone information architecture

Regroup File, Edit, Git, Present, Navigate, View, Window/Help, and Developer
menus. Add visible session kind, provenance, and mutability guidance. Hide
fixtures and developer tools in production.

### 2.2 VS Code editor-area companion

Move two-way comparison and file history into editor-area tabs. Make VS Code
documents authoritative for writable content or deliberately ship read-only
until that bridge is verified. Add contextual desktop hand-off, then remove or
redirect directory, multi-panel, branch-review, and tour-scale extension
commands.

### 2.3 Packaging and launch contracts

Add the versioned desktop launch-intent protocol, remote/trust capability
checks, an explicit VSIX allowlist, package-content assertions, and artifact
size budgets.

Complete this stage before exposing repository search or new advanced scenes
through either host.

## Stage 3: stabilize comparison quality and layout

### 3.1 Matching quality gate

Reconcile [Diff matching between panels](diff-matching-between-panels.md)
against the released matcher. Run the open-source corpus, performance
benchmarks, confidence/ambiguity checks, and regression suite. Implement only
remaining acceptance gaps.

Good matching comes before richer N-panel layout because focused navigation,
connectors, tours, and search result revelation all depend on stable adjacent
pairing.

### 3.2 Focused multi-panel interaction

Finish or verify [Focused multi-panel strip](focused-multi-panel-strip.md)
after matching is stable. Settle active panel versus active pair, keyboard
navigation, responsive carousel behavior, connector ownership, and Monaco
layout behavior.

### 3.3 Text readability

Implement [Text wrap option](text-wrap-option.md) against the stabilized panel
geometry. Expose it through a standalone View action and an appropriate VS
Code setting/action without inventing a third preference model.

## Stage 4: expand search from local to repository scale

Follow [Multi-scale search](multi-scale-search.md) in increasing cost order:

1. active-pane Find/Replace, completed in Stage 1;
2. visible-panel search using in-memory models;
3. current-comparison/change-set search using session source adapters;
4. standalone directory/repository search with a cancellable `rg --json`
   prototype and an explicit distribution decision;
5. Git-history content and introduction/removal search using Git-native
   adapters; and
6. previewed Replace in Files only after read-only filesystem search is stable.

VS Code continues to use its native workspace Search rather than shipping a
second repository-search UI or ripgrep process. It may adopt the shared
visible-panel search contract for the two displayed panes.

Defer tour search until Stage 5 establishes stable narrative and advanced
scene identities.

## Stage 5: consolidate advanced tour semantics

### 5.1 One shared change inventory

Reconcile the inventory requirements in:

- [Tour coverage and depth](tour-coverage-and-depth.md)
- [Deconstructed diffs](deconstructed-diffs.md)

Design one versioned inventory that supports stable evidence mapping and exact
lossless hunk materialization. Do not build two subtly incompatible hunk-ID
systems. Coverage can consume normalized identities while deconstruction also
retains the exact bytes and dependency information needed to reconstruct the
target.

### 5.2 Coverage and deconstructed-diff hardening

Complete coverage reporting, explicit exclusions, exact final-state
verification, real-versus-virtual labeling, and checked-in end-to-end YAML
examples. Advanced scenes remain experimental until their authoring guidance
and examples match their compiler/renderer support.

### 5.3 Stacked revision tours

Implement or finish [Multi-panel diff tours for stacked PRs](multi-panel-diff-tours-for-stacked-prs.md)
after focused multi-panel interaction and real-revision provenance are stable.
Keep mutable GitHub/stack state outside the portable manifest.

### 5.4 Tour search

Add narrative-versus-code tour search only after walkthrough, real stacked
revisions, and synthetic explanation stages have stable result identities and
Return to Tour behavior.

## Stage 6: system hardening and release gates

Across all hosts and artifacts:

- close stale plans and link shipped behavior to tests and examples;
- test editing, refresh, hand-off, cancellation, and source invalidation as
  lifecycle interactions rather than isolated helpers;
- test local, multi-root, untrusted, and supported remote VS Code workspaces;
- test small, medium, large, and pathological search/matching fixtures;
- assert VSIX, desktop, npm, and tour artifacts contain only intended files;
- keep test fixtures, smoke/capture commands, and developer tools out of
  production menus; and
- verify no proprietary source, paths, screenshots, snapshots, or derived
  fixtures enter the open-source repository or release artifacts.

## Parallel work boundaries

Some work may proceed concurrently after its gate is settled:

- VS Code editor-area hosting and standalone menu regrouping can proceed in
  parallel after Stage 1.1, provided they share command and provenance terms.
- Diff matcher verification and session-refresh foundations can proceed in
  parallel because they touch different model seams.
- The ripgrep prototype can benchmark distribution choices while visible-
  panel search is built, but it should not define the shared result contract
  unilaterally.
- Coverage reporting and deconstructed materialization can proceed in parallel
  only after agreeing on the shared inventory identity/version contract.

Do not parallelize competing implementations of editing, refresh, search
results, launch intents, or change-unit identity across hosts.

## Decision gates

Pause and decide explicitly at these points:

1. **VS Code editing:** native document bridge or intentionally read-only?
2. **Desktop hand-off:** deep link, configured executable, and remote behavior.
3. **Ripgrep distribution:** system capability, bundled verified binaries, or
   compatible fallback.
4. **Multi-panel interaction:** focused strip behavior and responsive cutoff.
5. **Change inventory:** one stable identity model for coverage and exact
   deconstruction.
6. **Replace in Files:** preview, revalidation, failure recovery, and encoding
   policy before any batch write ships.

## Completion criteria

The roadmap is complete when:

- every plan is reconciled with current implementation state;
- standalone and VS Code have distinct, documented, tested responsibilities;
- editing, refresh, matching, navigation, and search share contracts without
  duplicating host lifecycle ownership;
- advanced tour terminology and provenance cannot imply synthetic stages are
  real commits;
- broad search scales predictably from pane to repository, history, and tour;
  and
- every production surface and artifact is discoverable, appropriately
  packaged, and backed by open-source validation evidence.
