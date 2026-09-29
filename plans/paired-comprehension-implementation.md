# Paired comprehension review: implementation plan

Status: Implemented locally, then reconciled with newer `main` behavior under
the user's instruction to commit all in-flight work. See the integration record
below. No push or publication.

## Intended outcome

Make the [case study](review-comprehension-case-study.md) repeatable through
existing skills, and apply its bounded Bygone repairs. Review should distinguish
incorrect explanations from avoidable reasoning work and propose the smallest
useful repair to code, prose, or both.

## Scope

| Slice | Changes | Acceptance |
| --- | --- | --- |
| Shared guidance | Add a comprehension reference to `code-review`; route substantial conceptual changes to it. | Findings identify the reader task, obstacle, evidence, remedy, and reasoning removed; correctness and subjective judgments stay distinct. No score or finding quota. |
| Workflow integration | Route the tour skill and task-workspace v3 to the shared reference; adjust tour quality checks and existing review template. | Draft explanations can expose implementation problems before final polishing. Final evidence is refreshed after repair. Mechanical work remains lightweight; no extra mandatory ledger. |
| Bygone repairs | Correct stale mode and overview instructions, lead example prose with behavior, remove the inert session navigation API and ignored mapping argument after inspecting consumers. | Current mode semantics and root-v2 compatibility requirements are accurate; pending renderer-restoration cancellation remains intact. |
| Verification | Validate skills and links; compile and test affected Bygone behavior; use a fresh agent for a bounded reader exercise. | Results name checked revisions, actual checks, limits, and deferred work. The reader is not supplied expected findings. |

## Boundaries and preserved behavior

- Use local implementation branches in skills-library and the existing Bygone
  development worktree, based on its `2b5add9` feature head. Keep planning on
  `project-planning`; never merge its orphan history into implementation.
- Preserve legacy manifest fields, URL aliases, coverage fallbacks, independent
  mode cursors, and render-request-token protection.
- Do not implement the broader restoration refactor, a new UI, schema, CLI,
  standalone skill, entropy metric, or automatic merge gate.
- Preserve unrelated edits and existing Markdown metadata. Shared skill examples
  must remain generic and contain no employer information.
- Keep the case study as the before record. Add an implementation outcome rather
  than rewriting historical findings as if they had never occurred.

## Work sequence

1. Create local implementation branches and inspect current consumers.
2. Write the shared reference and its entry points while a bounded worker repairs
   Bygone code, documentation, and examples.
3. Review the complete diff against the approved scope. Run skill validation,
   link checks, Bygone compilation, focused tests, and lint for changed code.
4. Give a fresh reader the revised guidance and raw artifacts without our
   findings. Check the answers against source; record limitations without
   treating agent agreement as human efficacy evidence.
5. Record a concise outcome with branch names, changes, checks, and open work.

## Evaluation limits

The first implementation can establish accurate guidance and preserved behavior.
It cannot establish reduced human review time or incremental benefit over an
ordinary review. The original proposal's second compatibility-focused change,
maintainer-checked answer key, and comparative human trial remain follow-up work.

## Initial implementation outcome

The following records the original implementation and checks against the older
feature head. References to uncommitted work describe that point in time;
the integration record below supersedes that status.

Skills implemented locally on `feat/paired-comprehension-review`, based on
`e9c9aafbe3d7b50cc7d2fc14a989ee9de51de661`, including uncommitted changes to the
three skill entry points, shared reference, quality rubric, artifact guidance,
and existing review template. All three skills passed `quick_validate.py`.
All five new reference paths checked in the repository and installed symlink
locations resolve. No new skill or mandatory report was added.

A fresh agent applied the guidance to two synthetic requests without an answer
key. It identified the ignored argument/documentation contradiction, preserved
the saved-cursor behavior, named the uncovered test case, and skipped extra
analysis for a mechanical rename. It did not claim to have executed tests.
Its feedback exposed an ambiguity about explicitly requested mechanical reviews;
the guidance now explicitly honors that request. This establishes a narrow
instruction-following result, not human benefit or real-world detection rates.

Bygone repairs are implemented locally on `fix/comprehension-review-repairs`,
based on `2b5add94769bf5fc4c22d89f60be07886913a4b7`, plus six uncommitted files:
`src/tourZoomSession.ts`, `web/host.js`, `test/tourZoomSession.test.js`,
`docs/change-tour-format.md`, `docs/present.md`, and
`examples/navigation-lab.bygone.yaml`. The removed API had only host/test
consumers in repository search; the npm packaging script does not distribute
its standalone module, and package entry points do not expose it. Undocumented
external deep imports were not audited.

The host still cancels pending restoration at the same six call sites under
the same `!state.zoomSwitching` guard. Legacy serialized metadata, aliases,
coverage fallbacks, independent cursors, and render tokens are unchanged.
The authoring guide now distinguishes root-v2 compatibility requirements from
explicit Deconstructed tours. Overview documentation qualifies file scope and
omitted entries while retaining ordinary step-browsing guidance. The example
states the user-visible behavior before its URL mechanism.

Validation on the working tree:

- `npm run compile`: passed, including TypeScript checking.
- `node --test test/tourZoomSession.test.js test/tourHistory.test.js test/changeTourAuthoredModes.test.js test/tourDirectoryOverview.test.js test/tourDirectoryEvidence.test.js test/renderCompleteToken.test.js`:
  18 passed, no failures or skips.
- `npx eslint src/tourZoomSession.ts web/host.js test/tourZoomSession.test.js --max-warnings=0`:
  passed.
- `node ./bin/bygone.js tour validate examples/navigation-lab.bygone.yaml --json`:
  passed. Pinned range remains `1f8fdc07d56fc7a0e50dcab0383a63159c77178c` to
  `901a193203e4840dbf6e06c6a273fac7f2d713bd`; it illustrates that historical
  change, not this uncommitted repair. Validator reports two chapters, four
  included scenes, 21 walkthrough steps, and no omitted files. No standalone
  compiled manifest was produced.
- No full test suite, browser interaction, narration/audio, packaged desktop
  checks, or human reader trial was run. No commit, push, or publication.

Open the edited example with:

```sh
bygone -C /Users/davmash/code/worktrees/bygone-tour-reading-layout present --tour /Users/davmash/code/worktrees/bygone-tour-reading-layout/examples/navigation-lab.bygone.yaml
```

A separate fresh reader inspected the revised docs and source without the case
study, prior findings, or expected answers. Its four answers correctly predicted
mode availability and Final diff placement, independent cursor restoration,
root-v2 versus explicit Deconstructed requirements, and overview file/omission
scope. The answers cited the relevant implementations and matched the
orchestrator's source checks. It also clarified that “endpoint steps” does not
mean one step for each endpoint; the guide now says “nonempty walkthrough
steps.” No clarification request was made; navigation effort and reading time
were not measured. The reader inspected source as well as prose, so this is not
a docs-only or human comprehension result.

This slice is complete locally with high confidence in the bounded corrections
from source inspection and focused checks. Evidence of a supported external
consumer of the removed API or a failing browser restoration sequence would
change that assessment. Broader restoration consolidation and extraction of a
compatibility boundary remain hypotheses for a separate slice. CLI help also still
uses old Final/Explanation terminology for coverage; that adjacent wording was
observed, not changed in this slice. Human benefit and incremental value over
ordinary review remain unproven.

## Integration on 2026-09-29

The user requested committing all in-flight work to local `main` and explicitly
warned that the older Bygone edits target behavior that has since changed.
The drafts were preserved before adapting them:

- `0a4c542` on `fix/comprehension-review-repairs` captures the original six-file
  repair against `2b5add9`.
- `2813de4` on `chore/release-0.7.0` captures the older product-surface and
  scene-authoring documentation draft.
- `45386ac` on `draft/review-comprehension` captures the original UI investigation;
  its copy is now on `project-planning` and labeled as historical.

Skills-library `main` now includes the paired pass (`2a8312e`), both earlier
complexity-movement and meaning-preservation drafts (integrated by `089ddbb`
and `6bb8fc4`), and current comparison/portability wording (`1239747`). All four
changed skills passed `quick_validate.py`; new reference paths and the installed
code-review, tour, and reticence symlinks resolve. The merged quality rubric
retains both the paired-review guidance and its meaning-preservation reference.

Bygone `64d2af0` adapts the repairs onto `main` at `2d9e65e`:

- Remove the still-inert `navigate()` method and name the host helper for its
  actual effect: canceling pending mode restoration.
- Preserve `enter(mode, initial)`. Unlike the older ignored mapping argument,
  the current parameter seeds first-visit History with the active file. Existing
  first-visit and saved-cursor assertions remain intact.
- Preserve version 3 modes, multi-revision Compare, navigator tabs, and the
  newer continuous reading flow. Correct only current overview scope and
  root-versus-explicit Deconstructed authoring explanations.
- Keep the example pinned to its original evidence; lead the prose with the
  resumable step behavior and describe the current mode buttons accurately.

Validation on the integrated Bygone revision passed: `npm test` (legacy suite
plus 71 node tests, no failures or skips), `npm run lint`, and validation of
`examples/navigation-lab.bygone.yaml` (two chapters, four included scenes,
21 walkthrough steps, no omitted files). The four skills also passed validation.
These checks establish selected behavior and artifact validity, not reduced
human cognitive load. No new browser interaction, narration/audio test, human
reader trial, push, or publication was performed during this integration.

Planning remains on the orphan `project-planning` branch. Generated screenshots,
logs, and temporary presentation snapshots are not source changes and were not
committed. The preserved old drafts are evidence of prior work, not instructions
to apply their obsolete behavior wholesale.

Bygone `0913403` reconciles the older product map with the current hosts,
repository-bound v2/v3 tours, authoring menus, workspace modules, packaging,
and tests. Obsolete prototype and missing-feature claims were superseded;
96 local CODEBASE references resolve. The old draft's scene-choice guidance is
already covered by the current authoring guide, with corrected v3 requirements
in `64d2af0`.

The repository-required `npm run dev:sync` completed after the final Bygone
`main` commit: CLI, shell completions, VSIX, and macOS desktop build were
installed; the desktop app restarted. `bygone --version` reports `0.9.1`.
The Bygone main worktree remained clean after installation. This verifies the
local build/install path, not a new interactive UI or audio regression pass.
