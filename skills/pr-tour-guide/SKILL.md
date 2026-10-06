---
name: pr-tour-guide
description: Act as a PR Tour Guide by generating, validating, compiling, and presenting evidence-grounded Bygone code-change tours from Git ranges. Use for requests such as "Tour this commit for me," or whenever an AI coding agent should explain a pull request, branch, commit, or code change as a guided walkthrough; create or repair a .bygone file; produce an LLM-ready Bygone change context; connect narrative claims to exact source evidence; or turn a diff into a browser-presentable review or demo. Always print the exact `bygone` CLI command to open the resulting diff, review, tour, or history view.
---

# PR Tour Guide

Use Bygone as the deterministic evidence and rendering layer. Treat the language model as the narrative planner, never as the authority on Git ranges or source locations.

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

This skill requires the `bygone` CLI with `tour context`, `tour schema`, `tour validate`, and `tour compile`. Install only when the user asks or when the task cannot proceed without it.

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

If neither `bygone` nor `node ./bin/bygone.js` exposes the `tour` subcommands, stop, share the install commands above, and report that the toolchain is unavailable rather than guessing.

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

## Gather ticket and PR framing

When available, read the ticket and PR context supplied by the user or directly
linked from the change, using accessible read-only sources. Follow relevant
parent-project or review links when they explain the change; keep discovery
bounded to this work. Missing metadata should not block a useful code tour.

Capture the facts that help a reader understand the change:

- **Ticket:** identifier, title, problem and requested outcome, relevant details
  or acceptance criteria, creator/requester and assignee as distinct roles,
  creation date or relevant timeline, and its place in a parent project, epic,
  or larger initiative.
- **PR:** number, title, URL, author, relevant creation/merge dates, associated
  ticket, and actual review history: who reviewed, when, their recorded outcome,
  and consequential feedback or resulting changes.

Be explicit about whose ticket it was, who authored the PR, and who reviewed
it when the sources establish those roles. Credit implementation contributors
when known; PR authorship alone does not establish sole implementation credit.
A requested reviewer is not an actual reviewer; a comment is not an approval. Do not assume an earlier review
covers the current head or an entire multi-PR range. For stacked work, keep
ticket, author, timing, and review provenance attached to the correct PR.

Link the supporting ticket, PR, and review sources in the tour's narrative.
Distinguish the ticket's requested outcome and the author's stated intent from
behavior established by code and tests. Do not invent ownership, dates, project
relationships, ticket associations, review status, or approval. Briefly disclose
material gaps or conflicting context where they affect the explanation; omit
irrelevant unavailable fields rather than filling the tour with placeholders.

## Plan the explanation

Begin with an opening slide that summarizes the high-level context before the
implementation: the problem, its place in the larger project, the ticket and
PR relationship, and what this change contributes. Include relevant people,
timing, and review status concisely; put detailed provenance beside the later
claims it explains. If separate authored modes have independent entry points,
give each enough opening context to stand on its own.

Use the first scene's summary/bullets or equivalent supported narrative fields
for this opening; do not invent a slide kind or metadata keys. Keep source
anchors for code claims and source links for external context distinct.

Identify the smallest set of reviewer questions that makes the change understandable. Organize by conceptual dependency rather than filename order. Usually move through:

1. motivation, contract, or invariant;
2. core implementation;
3. integration or side effects;
4. failure behavior and proof.

Keep secondary, generated, dependency, and mechanical files in Bygone's complete Files rail unless they alter a reviewer conclusion.

Let the change determine the hierarchy. A chapter is a named conceptual arc containing one or more related scenes; a scene answers one reviewer question or advances one thesis. Do not target a fixed chapter count, and do not create a chapter merely to wrap each scene. Repeated one-scene chapters usually indicate that headings are being generated from a template instead of the change's actual structure.

Scale the structure proportionally:

- A small commit may need one chapter and one scene.
- A normal pull request often needs one to three chapters with one or more scenes in each.
- A broad release or long-lived branch may need several chapters, but each boundary must mark a real conceptual transition.
- Prefer merging adjacent chapters when their scenes form one argument; split a chapter only when its scenes answer materially different reviewer questions.

These are pacing heuristics, not quotas. Preserve asymmetry when one capability deserves substantially more explanation than another.

Use these narrative constraints:

- State one reviewer question or thesis per scene.
- Give every chapter a coherent multi-scene arc when the material supports one; allow a single-scene chapter only when that scene is independently substantial.
- Decompose scenes by conceptual need, not a fixed template; do not force every scene to use the same step count.
- Prefer three to seven steps per scene.
- Explain why focused code matters instead of paraphrasing syntax.
- Keep summaries, bullets, annotations, and takeaways distinct; bullets that merely restate the summary are a defect.
- Avoid intent, safety, performance, or runtime claims unsupported by the evidence.
- Do not imply that the authored tour exhaustively reviews every changed file.

## Author the source

Retrieve the current contract:

```sh
bygone tour schema > /tmp/change-tour-source.schema.json
```

Write a version 4 `.bygone` file for new tours. The legacy `.bygone.yaml`
spelling remains valid when generic YAML tooling requires it. Treat the
authored source and its compiled `.tour.json` as Git-backed, non-portable
artifacts: pin `range.base` and `range.head` to the exact OIDs from the
context, and keep them with the corresponding repository so Bygone can resolve
those objects and live history. Versions 1 and 2 remain readable for legacy
inputs; v4 is the format for independent authored modes and directory overviews.
Version 3 is retired. The source has no `review` or ad hoc `notes` field.

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
- If a mode is omitted, v4 derives it from the root chapters by scene identity
  and order. Root walkthroughs and real stacks supply Historical; root
  deconstructed scenes supply Deconstructed. A root deconstructed scene enters
  Historical only when it also has explicit endpoint walkthrough `steps`; a
  real revision `stack` by itself is not that walkthrough. No cross-mode
  correspondence is inferred from filenames or narrative text.

For a root v4 `deconstructed-diff` scene, provide both an explicit real
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

Version 4 scenes may include a directory Overview:

```yaml
overview:
  kind: directory-diff
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
`examples/navigation-lab.bygone.yaml` for independently authored modes.

Never emit generated line numbers or hunk indexes. Verify candidate snippets against the pinned object when uncertain:

```sh
git show HEAD_OID:path/to/file | rg -F -n 'exact snippet'
```

Use `occurrence` only when repetition is intentional and stable. Treat rename identity as evidence rather than describing a rename as unrelated deletion and addition.

## Validate and repair

Always run validation before presenting or handing off:

```sh
bygone tour validate review.bygone --json
```

Repair every error. Do not weaken, delete, or redirect an anchor merely to make validation pass. If evidence no longer exists, revise the claim or report the broken premise.

After structural validation, check that:

Treat this as a required self-audit, not a claim the validator can prove. For each item, cite concrete evidence you actually opened or mark it not applicable; the hand-off must distinguish verified findings from interpretation.

- the opening slide establishes the problem, project context, and available
  ticket/PR provenance before the first implementation step;
- ticket ownership, dates, and actual review claims are traceable to opened
  sources and scoped to the PR/revision they describe;
- chapter boundaries follow conceptual transitions rather than a fixed count or one-scene-per-chapter pattern;
- important production behavior is not hidden in the complete Files rail;
- tests are connected to the behavior they prove;
- connections express causal, contractual, data-flow, ordering, or proof relationships;
- binary files and omitted patches are surfaced explicitly;
- every Historical tour excludes synthetic deconstructed scenes, and every
  Deconstructed tour contains at least one deconstructed scene;
- deconstructed stages cover every included change unit exactly once or record
  an explicit exclusion, contain no unqualified "Stage N" or "Step N"
  references, and keep comparison stages distinct from navigable tour steps;
- root deconstructed scenes have the required real stack and endpoint
  walkthrough evidence, while mode-specific synthetic scenes do not claim
  that evidence exists;
- the final step supplies proof or a clear reviewer conclusion.

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

Open the interactive browser only when requested or useful for verifying the result:

```sh
bygone -C /absolute/path/to/repository present --tour review.bygone
```

Always print that same command with the real repository and tour paths, even if you do not run it. `-C` gives Bygone an explicit working directory without changing the user's shell directory.

Compiled manifests contain source snapshots. Do not publish or upload them without explicit authorization.

## Hand off

Report:

- the exact base and head OIDs;
- the **open command** for the primary artifact (`bygone present --tour …`, `bygone review …`, `bygone --git-diff …`, etc.);
- the source and compiled artifact paths;
- authored root and Historical/Deconstructed chapter, scene, step, and stage
  counts, plus compiled counts when generated complete-change or per-mode
  scenes change them;
- omitted or unread evidence;
- ticket/PR context sources used and material unavailable or conflicting context;
- validation and visual verification performed;
- whether generated files are temporary, uncommitted, committed, or pushed.

Distinguish syntactic grounding from interpretive correctness: Bygone proves that cited evidence exists at the pinned revision, not that the narrative's interpretation is unquestionably correct.
