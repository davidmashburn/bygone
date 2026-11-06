---
name: pr-tour-guide
description: Create, repair, validate, and present Bygone code-change tours grounded in Git evidence. Use for requested guided walkthroughs of commits, branches, or pull requests, .bygone tour documents, and Bygone tour context extraction. General review preparation or documentation work does not require a tour.
---

# PR Tour Guide

Create a guided reading path that connects an explanation of a change to exact
code evidence. Bygone resolves and displays that evidence; the authoring agent
is responsible for the explanation and its claims.

This skill covers tour authoring, validation, presentation, and synthetic review
branches for clean comparisons with or without a tour. It works standalone;
no writing, review, or orchestration skill is required. Existing code, maintained
docs, requirements, and PR discussion keep their roles. A tour can summarize and
link to them, but does not replace them or certify a review.

Honor an explicit request for a tour. When a broader task leaves the medium open,
a concise explanation, ordinary code links, or a synthetic branch comparison
may suffice; no tour is a valid outcome. Do not create a tour to compensate
for a defect in another artifact.

## Install this skill

Install with the [skills CLI](https://skills.sh). Prefer **project** scope (default) or name agents explicitly on **global** installs — bare `-g` fans out to every detected host, and PromptScript only supports project-level skills, which produces a spurious failure line.

**This repo / PromptScript / team-shared (project scope):**

```sh
npx skills add davidmashburn/bygone -s pr-tour-guide -y
```

Installs to `.agents/skills/pr-tour-guide` (or your agent's project skills directory).

**Global, all projects (pick your agents):**

```sh
npx skills add davidmashburn/bygone -s pr-tour-guide -g -y -a cursor codex claude-code
```

Add or remove agent names for the tools you use. Omit `-a` only if you accept PromptScript possibly printing `does not support global skill installation` even when other agents succeeded.

**PromptScript only:**

```sh
npx skills add davidmashburn/bygone -s pr-tour-guide -y -a promptscript
```

List without installing:

```sh
npx skills add davidmashburn/bygone --list
```

From a Bygone source checkout, install the local copy instead:

```sh
npx skills add ./skills/pr-tour-guide -y
```

## Install Bygone

This skill uses the `bygone` CLI. Tour authoring requires `tour context`, `tour schema`, `tour validate`, and `tour compile`; a standalone synthetic branch comparison needs only `--git-diff`. Install only when the user asks or when the task cannot proceed without it.

**macOS (desktop app + CLI, recommended):**

```sh
brew tap davidmashburn/bygone
brew install --cask bygone-desktop
```

First install may require `brew trust davidmashburn/bygone`.

**CLI only (Node.js required):**

```sh
npm install -g @davmash/bygone
```

**macOS without Homebrew:** download the DMG from [GitHub Releases](https://github.com/davidmashburn/bygone/releases), then choose **Help → Install Command Line Tools…** in the app.

If macOS reports the app is **damaged**, the build is likely unsigned. Clear quarantine and open once:

```sh
xattr -cr /Applications/Bygone.app
open /Applications/Bygone.app
```

**From a Bygone source checkout:**

```sh
npm install
npm run dev:sync
```

## Locate and verify Bygone

Run `bygone --help`. In a Bygone source checkout whose installed command is stale, use `node ./bin/bygone.js` instead.

Verify tour support before authoring:

```sh
bygone tour schema >/dev/null
```

If neither `bygone` nor `node ./bin/bygone.js` exposes the `tour` subcommands, report that tour authoring is unavailable rather than guessing. A requested standalone comparison can still proceed when `--git-diff` is supported.

Do not rebuild, commit, push, publish, or open a browser unless the user requests it or the surrounding task clearly requires it.

## Build the evidence context

Determine the intended head and base from the request and repository state. Prefer an explicit base; do not guess when different bases would materially change the explanation.

Treat workspace paths named by the request as the explicit scope. The context
does not provide a path filter, so do not silently narrow or broaden that scope
based on which files seem easiest to explain; surface any scope ambiguity.

For a hosted review, resolve both immutable endpoint OIDs from provider metadata. Never assume the current checkout is the requested review head. For GitHub:

```sh
PR_JSON="$(gh pr view <n> --json baseRefOid,headRefOid)"
BASE_OID="$(jq -r .baseRefOid <<<"$PR_JSON")"
HEAD_OID="$(jq -r .headRefOid <<<"$PR_JSON")"
test -n "$BASE_OID" && test "$BASE_OID" != null
test -n "$HEAD_OID" && test "$HEAD_OID" != null
bygone tour context "$HEAD_OID" --base "$BASE_OID" --output /tmp/change-context.json
```

Use the equivalent API or CLI fields for other providers. If the requested
endpoints are unresolved, reversed, divergent, or have multiple candidates,
stop and report the ambiguity. Never silently invent an endpoint, choose among
candidates, or substitute a merge-base. If you are not reviewing a hosted
change, compute the merge-base only when the intended integration branch is
explicit, and pass that exact base OID or ref.

Use immutable commit IDs in the eventual tour. Dirty working-tree changes and
unsaved buffers are reported separately but excluded from committed-range
context, authored evidence, and compiled source.

Inspect progressively instead of loading every patch immediately:

```sh
jq '{range,summary,commits,files:[.files[]|{path,previousPath,changeKind,role,additions,deletions,binary,patchOmittedReason,symbolHints}]}' /tmp/change-context.json
```

Then read patches only for likely narrative-bearing files. Account explicitly for every `patchOmittedReason`; never claim to understand omitted binary or oversized evidence.

Compiled tours and context dossiers are large because they embed source snapshots. Inspect them progressively and do not load every patch unless the narrative really needs it.

## Use existing context

Read relevant code and the supplied or directly linked docs, requirements, and
PR explanation. Keep discovery bounded to the change. Bring in only the context
needed to explain its behavior and evidence; link to the existing account for
more detail. People, dates, and review history are useful only when they affect
the explanation, not as a required inventory.

Distinguish requested behavior, an author's stated intent, and behavior supported
by implementation and tests. Label intent inferred from the diff. Do not invent
requirements, rationale, authorship, or approval; disclose material uncertainty.
If another artifact is deficient, identify that destination instead of hiding
the gap in tour prose. Tour authoring alone does not authorize editing it.

## Choose a clean comparison, with or without a tour

A synthetic review branch is a first-class option when base-branch merges,
unrelated commits, or interleaved concerns obscure the change. Use it to keep
a shared baseline constant across before, author revision, and proposed revision,
or to decompose a change into cumulative conceptual commits. A standalone
comparison can complete the task; add a tour when narration would clarify
relationships the clean diff still leaves difficult to reconstruct.

Keep the real source endpoints and history as provenance. Create clearly named
local refs in an isolated worktree within the task's authorization, preserving
the development branch and dirty work. These are synthetic review artifacts,
not a silent substitution for a hosted review's endpoints or permission to push
or rewrite its branch. Do not invent implementation changes to fill a panel.

For a normalized comparison, retain unrelated baseline changes in every panel.
For decomposition, order cumulative commits by dependency and reviewer question.
Retain required dependencies and integration changes; label reconstructed states
and do not present the synthetic sequence as the author's actual history.

Verify intended endpoint equivalence with Git tree comparisons, or included-path
comparisons with explicit exclusions for a scoped view. Record a reconstructed
baseline's source range and transformation, replay the isolated change, and
verify that it reproduces the intended endpoint. Inspect conflict resolutions.
Verify that the final snapshot matches the real head or proposal, and disclose
intentional differences. Tree equality proves snapshot fidelity, not runtime
correctness; report untested intermediate states and reuse test results only
for equivalent code and dependencies.

Open the resulting refs with the needed number of panels:

```sh
bygone -C <worktree> --read-only --git-diff <before-ref> <author-ref> <proposed-ref>
```

Print the exact one-line command with real paths and refs. Report provenance
and whether the artifact is local or pushed. If adding a tour, pin its evidence
to the synthetic commits and link the real source revisions. These materialized
Git commits are distinct from the compiler's hunk-based Deconstructed stages;
do not imply they reproduce historical authorship merely because they have OIDs.

## Plan the explanation

Lead with what changes for the user or system and why it matters. Use version 7
`opening: { title, summary, bullets? }` for a short orientation and
`conclusion: { title, summary, bullets? }` for what the evidence established and
what remains unresolved. Give each independently authored mode enough context
to stand alone: place its `opening` and `conclusion` inside `tours.historical`
or `tours.deconstructed`; independently authored modes do not inherit root bookends.
Restate an important expected behavior or boundary from its
existing source when useful; the opening is an explanation, not a new specification.
Never silently weaken an expectation to match the implementation.

Keep routine evidence in the optional `details.checks` checklist when the installed
schema supports it: provenance, claims, behavior, coverage, uncertainty. Use
`verified`, `partial`, `not-checked`, or `not-applicable` honestly, with a concise
summary and optional `details` prose. Checks are not narration. Material limits
remain beside their claims. See [checks format](../../docs/tour-checks.md).

Before drafting, derive must-retain claims directly from the evidence, including
consequential requirements for preparation, reuse, and deliverables. Keep this
brief inventory internal. Choose the smallest set of reader questions that
explains those claims:

- A chapter groups related questions. A scene answers one question; several
  steps can supply its evidence. Split for a new reasoning task, not simply
  a new file or viewport. Keep the main route complete, including material
  caveats. Lead with why, what, and the key decisions. Explain supported
  alternatives and accepted tradeoffs; distinguish inference and unknown intent.
  Give a representative before/after case. Judge comprehension, not a word or
  stop quota; count narration only to diagnose avoidable reading cost.
- Use optional `chapter.summary` for one or two brief sentences that explain
  what comes next and why. Omit it when no useful preview is needed: chapters
  without summaries stay in the contents but are skipped as presentation and
  narration stops. A list of scene titles or links is not a preview.
- Give each scene a distinct purpose. Its summary should prepare the reader for
  the evidence and say what to notice. Meaningful chapter or scene titles form
  the opening's generated route; do not duplicate that itinerary in prose.
- A scene boundary need not change revisions. When the comparison changes,
  explain why the new revisions matter; otherwise explain the new question.
  Keep reference numbers in navigation and use descriptive titles in narration.
- Connect the observable outcome to its mechanism and evidence. Explain why
  focused code matters rather than paraphrasing syntax. Preserve causal links
  when shortening prose and include boundaries that change the conclusion.
- Keep tests beside the behavior they support. Distinguish a test's existence
  from a passing execution, and synthetic stages from real revision history.
- Add context, connections, and steps only when they add understanding. Keep
  mechanical files in the complete Files rail unless they affect the argument.
  Use short behavior titles and branch questions. Omit optional summaries,
  bullets, and takeaways that repeat another field; schema capacity is not a
  checklist to fill.

Support claims about intent, safety, performance, or runtime behavior with
appropriate evidence. A selected reading path is not an exhaustive code review.
Do not invent slide kinds or metadata keys; keep code anchors and links to
external explanations distinct.

## Author the source

Retrieve the current contract:

```sh
bygone tour schema > /tmp/change-tour-source.schema.json
```

Write a version 7 `.bygone` file for new tours. The legacy `.bygone.yaml`
spelling remains valid when generic YAML tooling requires it. Treat the
authored source and its compiled `.tour.json` as Git-backed, non-portable
artifacts: pin `range.base` and `range.head` to the exact OIDs from the
context, and keep them with the corresponding repository so Bygone can resolve
those objects and live history. Legacy v6 remains readable; v7 adds recursive
optional branches while retaining the v6 fields and behavior. Versions 1, 2,
4, 5, and 6 remain readable for legacy inputs. Existing tours do not need
migration merely because v7 is available.
Version 3 is retired. The source has no `review` or ad hoc `notes` field.

Keep full OIDs in `range` and routine provenance or historical bookkeeping in
supported metadata or linked sources, outside spoken fields. When the schema
supports it, set top-level `generatedBy.model` to the actual author model
identifier supplied by the runtime; include optional `harness` and `effort` only
when known. For delegation, supply the recorded author metadata in the worker
brief or add it from task metadata during integration. Never infer identity from
task names or stamp the integrator as author. Omit unknown values; `generatedBy`
is non-narrated provenance.

Set optional `windowTitle` when the tour should appear in the native window
title — for example a pull request number (`PR-1234`) so multiple open tours
stay distinguishable. When omitted, the presenter falls back to `title`.

### Choose the authored modes

The root `chapters` is required and is the compatibility tour. It shares the
top-level `range`, `anchors`, and `connections` with any independent modes.
When the source supplies them, `tours.historical.chapters` and
`tours.deconstructed.chapters` are separate authored tours; keep their chapter,
scene, and step order independent rather than expecting Bygone to match content
across modes.

- **Historical** explains real revision states. Its scenes may be walkthroughs
  or `stacked-diff` scenes, never `deconstructed-diff` scenes. Every stacked
  panel must resolve to a real Git revision; an explicitly authored Historical
  stack may contain two to six revisions, but its first and last panels must be
  the resolved review base and head.
- **Deconstructed** explains the change through synthetic cumulative stages. It
  must contain at least one `deconstructed-diff` scene and may include
  walkthrough scenes for context or proof. A mode-specific deconstructed scene
  may omit `stack` and endpoint `steps`: its stages, not Git history, define the
  explanation panels.
- If a mode is omitted, v4 and v5 derive it from the root chapters by scene identity
  and order. Root walkthroughs and real stacks supply Historical; root
  deconstructed scenes supply Deconstructed. A root deconstructed scene enters
  Historical only when it also has explicit endpoint walkthrough `steps`; a
  real revision `stack` by itself is not that walkthrough. No cross-mode
  correspondence is inferred from filenames or narrative text.

For a root v4 or v5 `deconstructed-diff` scene, provide both an explicit real
revision `stack` and regular endpoint `steps`. The stack is used for the real
Historical/Final fallback and must have the same base and final endpoints as
the source range; the synthetic stages remain separate. A
mode-specific Deconstructed scene may omit those fields as described above.

For every walkthrough step:

- make one concise explanatory claim;
- focus an anchor in `base` or `head` evidence;
- prefer changed lines, using unchanged context only when it establishes a required boundary;
- use the shortest snippet that is unique within that file and revision;
- connect behavior to tests, error handling, or other concrete proof;
- add a connection only when the relationship between two locations materially improves understanding.

### Add optional evidence hierarchically

Add `branches` to an authored walkthrough or stacked step when a reader may reasonably ask
for more detail. Each branch has an `id`, a question-shaped `title`, and
recursive `steps` using the same step shape as its parent. Default to one
optional layer; nest further only to answer a separate question. Walkthrough steps retain `title`, `body`, and
`focus`; stacked steps retain their `file` and `pair`; explicit walkthrough
steps in deconstructed tours can branch, but stages do not become branches.
Keep the main route's title as the claim and its body as the cause or
consequence; use branches for optional explanation and proof rather than
moving a material caveat out of the main route. With every branch closed, the
reader must still know the exact approval scope, prerequisites, prohibited
actions, and material exceptions when they govern the behavior being explained.
Branches may explain or prove those rules, not be their only statement.
Before handing off, verify the
reader identifies the active path, next destination, and skipped detail.
Expanding an outline group must not change the reading path.

The compiler flattens optional steps into scene evidence preorder. Stable IDs
therefore remain linkable and exportable, while default reading omits optional
steps. `depth` records evidence coverage (`mentioned`, `explained`, or
`contextualized`); it is not a navigation level. See
`examples/optional-branches.bygone.yaml` for a synthetic v7 source. Existing
v5 and v6 tours remain valid without edits.

For every `stacked-diff` step, use a real changed file and a `pair` of adjacent
stack entry IDs; use `side` or `lines` only to refine the focus. For every
deconstructed stage, assign concrete change-unit (hunk) IDs through `changes`
and build a cumulative teaching order. Assign each changed hunk exactly once,
or exclude it explicitly with a reason; unsupported, binary, and rename-path
changes generally need whole-file exclusions. Do not infer a real stack from
the synthetic stages or describe an explanation panel as a commit.

Keep deconstructed-tour coordinates distinct:

- A **stage** is an authored synthetic phase and cumulative comparison state;
  it is not a Git revision.
- The presenter derives one or more navigable Deconstructed tour steps from a
  stage's introduced changes. A root deconstructed scene's endpoint `steps`
  are ordinary anchor-based walkthrough items for the real range, not those
  synthetic stage steps.
- Do not refer to either by an unqualified ordinal such as "Stage 2" or "Step 11" in authored titles, summaries, narration, or takeaways. Prefer the stable descriptive title so the reference survives edits.
- When an ordinal is necessary, qualify the coordinate: "stage 2 of 4" versus "tour step 11 of 46."
- Treat presenter-generated labels as UI context; do not repeat them in authored prose unless the distinction itself needs explanation.

Use a directory overview only when its inventory answers the scene’s question.
Otherwise the viewer previews the first step without an active annotation.
Current authoring versions require an explicit purpose:

```yaml
overview:
  kind: directory-diff
  purpose: See which web layers changed together before tracing their interaction.
  path: web
```

Keep `path` relative and POSIX-style; omit it or use `.` for the repository
root. Stacked and Deconstructed scenes may set `overview.comparison` to two
distinct stack-entry IDs or to `explanation-baseline` and
`explanation-stage-<stage-id>`. Walkthrough overviews always use the review's
base-to-head comparison and reject an explicit comparison.

Put concepts, boundaries, and tradeoffs beside their code evidence in scene or
step narrative. Label unresolved questions explicitly and state the next check
that would resolve them. Never present an unknown as a settled conclusion.
Do not add a `review` block or an ad hoc `notes` key. See
`examples/navigation-lab.bygone.yaml` for independently authored modes and
`examples/optional-branches.bygone.yaml` for recursive optional evidence.

Never emit generated line numbers or hunk indexes. Verify candidate snippets against the pinned object when uncertain:

```sh
git show HEAD_OID:path/to/file | rg -F -n 'exact snippet'
```

Use `occurrence` only when repetition is intentional and stable. Treat rename identity as evidence rather than describing a rename as unrelated deletion and addition.

## Validate and repair

Use optional v5 `details.audience` when the intended reader and purpose are known.
Read [Expectations and reader feedback](references/expectations-and-feedback.md)
for those fields or when handling a captured reader concern.

Always run validation before presenting or handing off:

```sh
bygone tour validate review.bygone --json
```

Repair every error. Do not weaken, delete, or redirect an anchor merely to make
validation pass. If evidence no longer exists, revise the claim or report the
broken premise. Validation checks structure and evidence locations, not code
correctness or comprehension.

Read the actual continuous main path, including generated framing:

```sh
bygone tour narration review.bygone.yaml
```

It reports per-stop word counts with optional branches closed; add `--json` for
structured output. Check every delivered mode for repetition between opening,
scene, and first step. Omit generic framing such as “The rules, in order.”
Optional branches must answer an additional question; remove those that merely
repeat the parent. Inspect validation's `readingCosts[mode].narration` for main
and optional totals. With older tooling, inspect the rendered narration instead.

Cut redundant stops, framing, and sentences; preserve the causal explanation.
Read for why, what, key decisions, and a concrete result. With branches closed, map each must-retain source claim to explicit
main-path text, not merely an anchor. Preserve its actor, timing, and the rule
each exception qualifies. Generic “approval needed” does not preserve the
operation, scope, or effect of prior approval. Restore missing meaning before
accepting the cut. Keep required actions as well as failure conditions on the
main path. “The procedure lives elsewhere” does not preserve “read it before
acting.” Document names and rationale can be optional; the required action cannot.
If an overage remains necessary, name what would be lost by
cutting it in the handoff. Report material omissions and checks actually
performed; no separate scored audit is required.

## Always print the open command

Whenever you create, validate, compile, recommend, or open a diff, review, tour, history view, or Git comparison, **always** print the exact one-line `bygone` command the user can paste to open it in the desktop app.

Do this even when you also run the command yourself, when presentation was not requested, and when handing off artifacts. Use the real paths and refs from the work; prefer absolute paths when a tour or file lives outside the current directory.

| Goal | Command template |
| --- | --- |
| Authored tour | `bygone -C <repository> present --tour <path/to/review.bygone>` |
| Branch review (change set) | `bygone review <head> --base <base>` |
| App-hosted range tour (no authored file) | `bygone present <head> --base <base>` |
| Two-way file or directory compare | `bygone <left> <right>` |
| Explicit diff mode | `bygone --diff <left> <right>` |
| Multi-panel compare | `bygone <path1> <path2> <path3> [...]` |
| Git refs compare | `bygone --git-diff <ref1> <ref2> [<ref3>...]` |
| File or directory history | `bygone --history <path>` |
| Repo directory history | `bygone` (from inside the Git repo) |

Tour tooling that does not open the app (`tour context`, `tour validate`, `tour compile`, `tour coverage`) still warrants the matching open command when a human should inspect the result visually.

## Compile or present

Compile a repository-bound manifest when the user needs an artifact:

```sh
bygone tour compile review.bygone --output review.tour.json
```

For a standalone reader, bind the repository explicitly, especially when the
source lives outside its worktree. Export otherwise discovers Git from the source
location, not the shell's working directory:

```sh
bygone -C /absolute/path/to/repository tour export /absolute/path/to/review.bygone.yaml --output review.html --runtime embedded
```

Open the interactive browser only when requested or useful for verifying the result:

```sh
bygone -C /absolute/path/to/repository present --tour review.bygone
```

Always print that same command with the real repository and tour paths, even if you do not run it. `-C` gives Bygone an explicit working directory without changing the user's shell directory.

Compiled manifests contain source snapshots. Do not publish or upload them without explicit authorization.

## Hand off

Provide the tour document path, compiled path if produced, exact range, and open
command. Briefly report validation, any visual verification, material omissions
or unresolved claims, and whether artifacts are temporary, uncommitted, committed,
or pushed. Do not turn the handoff into an inventory of every scene and step.

Bygone establishes that cited evidence exists at the pinned revision, not that
the narrative interpretation or implementation is correct.
