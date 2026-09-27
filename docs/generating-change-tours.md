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
   ```

   The context contains commits, file roles, rename metadata, bounded unified patches, changed line ranges, basic symbol hints, and explicit binary or oversized-patch omissions.

2. Inspect the merge-base-to-head change, its commits, production files, tests, renames, and binaries.
3. Identify the small set of reviewer questions that explain why the change exists and how it works.
4. Arrange those questions into conceptual chapters rather than filename order.
5. Attach every walkthrough step to an exact snippet in either the base or head revision.
6. Put the reason the focused code matters, including any evidence-grounded tradeoff, in that step's `body`.
7. Add a connection only when it explains a meaningful relationship between two pieces of evidence.
8. Write the `.bygone` source.
9. Validate it and repair every reported problem:

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
- Make each step body explain why the focused code matters, including a concise rationale or tradeoff when the source supports one; do not merely paraphrase its syntax.
- Use scene summary, bullets, and takeaway for the scene's purpose and retained point. Do not repeat step bodies there when the step already carries the explanation.
- Avoid claims about runtime behavior, safety, or intent that have no linked evidence.
- Use connections sparingly. A connection should answer “how are these two facts related?”
- Preserve access to the complete change instead of presenting the tour as exhaustive review.
- Keep unresolved questions and review decisions in the external review record that accompanies the tour. The current `.bygone` schema has no separate notes field for them.

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
- put each evidence-grounded rationale or tradeoff beside its focused step;
- leave secondary files to Bygone's complete Files rail;
- keep unresolved questions and review decisions in the accompanying review record rather than adding an unsupported notes key;
- run `bygone tour validate <file> --json` and repair all errors before finishing.
```

The generated prose remains a proposal. Validation proves that its evidence exists and is reproducible; a reviewer must still judge whether its interpretation is correct.

## Optional review notes

An authored source may add a top-level `review` block when a reviewer needs a
small set of concepts, boundaries, tradeoffs, or open questions alongside the
walkthrough. This is opt-in: the Present header shows a **Review notes** button
only when the compiled manifest includes review notes, and the button opens a
read-only panel. The panel is an authored interpretation layer; its linked
scene/step evidence is checked, while its conclusions remain claims for the
reviewer to assess. The complete Files rail remains available and unchanged.

Review notes pin the exact range they describe:

```yaml
review:
  baseOid: 292fe9248c5c49f762489dc688296fc100d120bc
  headOid: 75b6d7c0303124ec314aa790d6b808c4a9d9ea0e
  items:
    - id: range-contract
      kind: concept
      title: The range has one historical boundary
      body: The note explains the invariant a reviewer should keep in mind.
      evidence:
        - sceneId: review-pipeline
          stepId: establish-boundary
```

Each item uses one of `concept`, `boundary`, `tradeoff`, or `question`.
Concept, boundary, and tradeoff items need at least one link to an existing
walkthrough scene and step. A question may leave `evidence` empty, but it must
include a `nextCheck` describing the follow-up that would resolve it. Evidence
for a version 1 source resolves against its original walkthrough scenes. For a
version 2 source it resolves against the **Final walkthrough**; if the reader
is in history or a revisions view, following an evidence link first returns to
that final range before selecting the scene and step.

The `baseOid` pin is the resolved merge-base OID, which may differ from the
requested base ref; `headOid` is the resolved head OID. Both pins must match
the resolved range. Compilation rejects a review whose pins describe a changed
range, and imported manifests reject a review whose pins do not match the
manifest range. `tour validate` checks the shape, OIDs, and scene/step
grounding of review notes; it does not verify that an authored interpretation
is semantically correct. It also does not run or attest to external checks such
as tests, CI, or the `nextCheck` follow-up. Those claims belong in the note only
when the author has evidence for them.
