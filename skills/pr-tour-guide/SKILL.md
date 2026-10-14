---
name: pr-tour-guide
description: Create, repair, validate, and present Bygone code-change tours grounded in Git evidence. Use for requested guided walkthroughs of commits, branches, or pull requests, .bygone tour documents, and Bygone tour context extraction. General review preparation or documentation work does not require a tour.
---

# PR Tour Guide

Create a guided reading path that connects an explanation of a change to exact
code evidence. Bygone resolves and displays that evidence; the authoring agent
is responsible for the explanation and its claims.

This skill owns tour authoring, validation, and presentation. It works standalone;
no writing, review, or orchestration skill is required. Existing code, maintained
docs, requirements, and PR discussion keep their roles. A tour can summarize and
link to them, but does not replace them or certify a review.

Honor an explicit request for a tour. When a broader task leaves the medium open,
a concise explanation or ordinary code links may suffice; no tour is a valid
outcome. Do not create a tour to compensate for a defect in another artifact.

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

## Plan the explanation

Lead with what changes for the user or system and why it matters. Use version 5
`opening: { title, summary, bullets? }` for a short orientation and
`conclusion: { title, summary, bullets? }` for what the evidence established and
what remains unresolved. Give each independently authored mode enough context
to stand alone: place its `opening` and `conclusion` inside `tours.historical`
or `tours.deconstructed`; independently authored modes do not inherit root bookends.
Restate an important expected behavior or boundary from its
existing source when useful; the opening is an explanation, not a new specification.
Never silently weaken an expectation to match the implementation.

Choose the smallest set of questions that makes the change understandable:

- A chapter groups related questions. A scene answers one question; several
  steps can supply its evidence. Split for a new reasoning task, not simply
  a new file or viewport. Use no fixed chapter or step count.
- Use optional v5 `chapter.summary` for one or two brief sentences that explain
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
  Do not repeat the same point across summaries, bullets, and takeaways.

Support claims about intent, safety, performance, or runtime behavior with
appropriate evidence. A selected reading path is not an exhaustive code review.
Do not invent slide kinds or metadata keys; keep code anchors and links to
external explanations distinct.

## Author the source

Retrieve the current contract:

```sh
bygone tour schema > /tmp/change-tour-source.schema.json
```

Write a version 5 `.bygone` file for new tours. The legacy `.bygone.yaml`
spelling remains valid when generic YAML tooling requires it. Treat the
authored source and its compiled `.tour.json` as Git-backed, non-portable
artifacts: pin `range.base` and `range.head` to the exact OIDs from the
context, and keep them with the corresponding repository so Bygone can resolve
those objects and live history. Versions 1, 2, and 4 remain readable for legacy
inputs; v5 adds bookends, optional chapter previews, and requires a purpose for explicit directory overviews.
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
Version 5 requires an explicit purpose:

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
`examples/navigation-lab.bygone.yaml` for independently authored modes.

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

Read the resulting path against its evidence: does each scene establish a useful
point, do transitions preserve orientation, and does the conclusion stay within
what was shown? Check the compiled path where generated focus steps or fallback
modes could introduce repetition or change the intended sequence. Report material
omissions and checks actually performed; do not require a scored audit or a
separate reader-review process for every tour.

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

Provide the tour document path, compiled path if produced, exact range, and open
command. Briefly report validation, any visual verification, material omissions
or unresolved claims, and whether artifacts are temporary, uncommitted, committed,
or pushed. Do not turn the handoff into an inventory of every scene and step.

Bygone establishes that cited evidence exists at the pinned revision, not that
the narrative interpretation or implementation is correct.
