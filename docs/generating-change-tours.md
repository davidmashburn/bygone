# Generating change tours with an LLM

Bygone treats an LLM as a narrative planner and evidence selector, not as the authority on Git or source locations. The model writes `.bygone`; Bygone resolves its anchors against pinned commits and rejects missing, ambiguous, or structurally invalid references.

For agents that support repository skills, use the agent-agnostic [`pr-tour-guide` skill](../skills/pr-tour-guide/SKILL.md). It packages the complete evidence, authoring, validation, and handoff workflow without depending on a particular agent vendor.

Install it with the skills CLI:

```sh
# project scope (works with PromptScript)
npx skills add davidmashburn/bygone -s pr-tour-guide -y

# global scope — pass -a so PromptScript is not included
npx skills add davidmashburn/bygone -s pr-tour-guide -g -y -a cursor codex claude-code
```

The skill documents how to install Bygone itself when the CLI is missing.

## Recommended loop

1. Generate a deterministic change dossier instead of asking the model to rediscover the Git range:

   ```sh
   bygone tour context HEAD --base origin/main --output change-context.json
   bygone tour context https://github.com/owner/repo/pull/1753 --output change-context.json
   ```

   The context contains commits, file roles, rename metadata, bounded unified patches, changed line ranges, basic symbol hints, and explicit binary or oversized-patch omissions. When the range came from a pull request, it also carries `pullRequest` with the author's title, account, state, and description. Read that description first: it is the author's stated intent, and narrative should start there rather than inferring purpose from diffs.

2. Inspect the merge-base-to-head change, its commits, production files, tests, renames, and binaries.
3. Identify the small set of reviewer questions that explain why the change exists and how it works.
4. Arrange those questions into conceptual chapters rather than filename order.
5. Attach every walkthrough step to an exact snippet in either the base or head revision.
6. Add a connection only when it explains a meaningful relationship between two pieces of evidence.
7. Write the `.bygone` source.
8. Validate it and repair every reported problem:

   ```sh
   bygone tour validate review.bygone --json
   ```

9. Compile or present the verified result:

   ```sh
   bygone tour compile review.bygone --output review.tour.json
   bygone present --tour review.bygone
   ```

Use `bygone tour schema` to print the current JSON Schema. The checked-in schema is also available at [`schemas/change-tour-source.schema.json`](../schemas/change-tour-source.schema.json).

## Narrative constraints

- Prefer one reviewer question per scene and three to seven steps per scene.
- Lead with contracts, invariants, or architectural boundaries before their consumers.
- Pair behavior with the tests or evidence that prove it.
- Keep mechanical, generated, and lockfile changes out of the authored narrative unless they alter the reviewer’s conclusion; they remain visible in the complete Files rail.
- Make each annotation explain why the focused code matters; do not merely paraphrase its syntax.
- Avoid claims about runtime behavior, safety, or intent that have no linked evidence.
- Use connections sparingly. A connection should answer “how are these two facts related?”
- Preserve access to the complete change instead of presenting the tour as exhaustive review.

## Anchor rules

- Never emit line numbers or generated hunk indexes.
- Prefer the shortest snippet that is still unique within its file and revision.
- Include `occurrence` only when repeated text is intentional and the selected occurrence is stable.
- Pin immutable commit IDs in `range` for a durable artifact.
- Treat a failed anchor as useful feedback. Do not silently redirect it to nearby code.

## Suggested generation prompt

```text
Create a Bygone change tour for the supplied Git range.

First identify the central reviewer questions and the concrete code evidence for each answer.
Then produce YAML conforming to the schema returned by `bygone tour schema`.

Requirements:
- pin the exact base and head commits;
- organize the narrative by concepts, not filenames;
- link every step to a unique source snippet;
- connect code locations only when the relationship adds explanatory value;
- include behavior and its proof;
- leave secondary files to Bygone's complete Files rail;
- run `bygone tour validate <file> --json` and repair all errors before finishing.
```

The generated prose remains a proposal. Validation proves that its evidence exists and is reproducible; a reviewer must still judge whether its interpretation is correct.
