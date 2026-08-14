---
name: pr-tour-guide
description: Act as a PR Tour Guide by generating, validating, compiling, and presenting evidence-grounded Bygone code-change tours from Git ranges. Use for requests such as "Tour this commit for me," or whenever an AI coding agent should explain a pull request, branch, commit, or code change as a guided walkthrough; create or repair a .bygone file; produce an LLM-ready Bygone change context; connect narrative claims to exact source evidence; or turn a diff into a browser-presentable review or demo. Always print the exact `bygone` CLI command to open the resulting diff, review, tour, or history view.
---

# PR Tour Guide

Use Bygone as the deterministic evidence and rendering layer. Treat the language model as the narrative planner, never as the authority on Git ranges or source locations.

## Locate Bygone

Run `bygone --help`. In a Bygone source checkout whose installed command is stale, use `node ./bin/bygone.js` instead. The CLI must expose `tour context`, `tour schema`, `tour validate`, and `tour compile`.

If neither `bygone` nor `node ./bin/bygone.js` exposes the `tour` subcommands, stop and report that the toolchain is unavailable rather than guessing.

Do not install, rebuild, commit, push, publish, or open a browser unless the user requests it or the surrounding task clearly requires it.

## Build the evidence context

Determine the intended head and base from the request and repository state. Prefer an explicit base; do not guess when different bases would materially change the explanation.

For a hosted review, resolve both immutable endpoint OIDs from provider metadata. Never assume the current checkout is the requested review head. For GitHub:

```sh
PR_JSON="$(gh pr view <n> --json baseRefOid,headRefOid)"
BASE_OID="$(jq -r .baseRefOid <<<"$PR_JSON")"
HEAD_OID="$(jq -r .headRefOid <<<"$PR_JSON")"
test -n "$BASE_OID" && test "$BASE_OID" != null
test -n "$HEAD_OID" && test "$HEAD_OID" != null
bygone tour context "$HEAD_OID" --base "$BASE_OID" --output /tmp/change-context.json
```

Use the equivalent API or CLI fields for other providers. If you are not reviewing a hosted change, compute the merge-base against the intended integration branch and pass that exact base OID or ref. Keep the existing preference for explicit endpoints and do not guess.

Use immutable commit IDs in the eventual tour. Dirty working-tree changes are reported but excluded from committed-range context.

Inspect progressively instead of loading every patch immediately:

```sh
jq '{range,summary,commits,files:[.files[]|{path,previousPath,changeKind,role,additions,deletions,binary,patchOmittedReason,symbolHints}]}' /tmp/change-context.json
```

Then read patches only for likely narrative-bearing files. Account explicitly for every `patchOmittedReason`; never claim to understand omitted binary or oversized evidence.

Compiled tours and context dossiers are large because they embed source snapshots. Inspect them progressively and do not load every patch unless the narrative really needs it.

## Plan the explanation

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

Write a `.bygone` file. The legacy `.bygone.yaml` spelling remains valid when
generic YAML tooling requires it. Treat either authored source as Git-backed,
not portable: pin `range.base` and `range.head` to the exact OIDs from the
context, and keep the file within the corresponding repository so Bygone can
resolve those objects. Use a compiled `.tour.json` only when a portable
snapshot is required.

For every step:

- make one concise explanatory claim;
- focus an anchor in `base` or `head` evidence;
- prefer changed lines, using unchanged context only when it establishes a required boundary;
- use the shortest snippet that is unique within that file and revision;
- connect behavior to tests, error handling, or other concrete proof;
- add a connection only when the relationship between two locations materially improves understanding.

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

- the first step establishes enough context for later steps;
- chapter boundaries follow conceptual transitions rather than a fixed count or one-scene-per-chapter pattern;
- important production behavior is not hidden in the complete Files rail;
- tests are connected to the behavior they prove;
- connections express causal, contractual, data-flow, ordering, or proof relationships;
- binary files and omitted patches are surfaced explicitly;
- the final step supplies proof or a clear reviewer conclusion.

## Always print the open command

Whenever you create, validate, compile, recommend, or open a diff, review, tour, history view, or Git comparison, **always** print the exact one-line `bygone` command the user can paste to open it in the desktop app.

Do this even when you also run the command yourself, when presentation was not requested, and when handing off artifacts. Use the real paths and refs from the work; prefer absolute paths when a tour or file lives outside the current directory.

| Goal | Command template |
| --- | --- |
| Authored tour | `bygone present --tour <path/to/review.bygone>` |
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

Compile a portable manifest when the user needs an artifact:

```sh
bygone tour compile review.bygone --output review.tour.json
```

Open the interactive browser only when requested or useful for verifying the result:

```sh
bygone present --tour review.bygone
```

Always print that same command (with the real tour path) in the response, even if you do not run it.

Compiled manifests contain source snapshots. Do not publish or upload them without explicit authorization.

## Hand off

Report:

- the exact base and head OIDs;
- the **open command** for the primary artifact (`bygone present --tour …`, `bygone review …`, `bygone --git-diff …`, etc.);
- the source and compiled artifact paths;
- authored chapter, scene, and step counts, plus compiled counts when the generated complete-change appendix changes them;
- omitted or unread evidence;
- validation and visual verification performed;
- whether generated files are temporary, uncommitted, committed, or pushed.

Distinguish syntactic grounding from interpretive correctness: Bygone proves that cited evidence exists at the pinned revision, not that the narrative's interpretation is unquestionably correct.
