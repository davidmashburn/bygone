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

- Give each scene one explanatory job. Choose the number of steps needed to
  develop it; do not split or pad an argument to meet a step-count target.
- Lead with contracts, invariants, or architectural boundaries before their consumers.
- Pair behavior with the tests or evidence that prove it.
- Keep mechanical, generated, and lockfile changes out of the authored narrative unless they alter the reviewer’s conclusion; they remain visible in the complete Files rail.
- Make each step body explain why the focused code matters, including a concise rationale or tradeoff when the source supports one; do not merely paraphrase its syntax.
- Use scene summary, bullets, and takeaway for the scene's purpose and retained point. Do not repeat step bodies there when the step already carries the explanation.
- Avoid claims about runtime behavior, safety, or intent that have no linked evidence.
- Use connections sparingly. A connection should answer “how are these two facts related?”
- Preserve access to the complete change instead of presenting the tour as exhaustive review.
- Put concepts, boundaries, and tradeoffs beside their evidence in scene or step narrative. Label unresolved questions explicitly and state the next check that would resolve them; do not present them as settled conclusions.

## Explain the causal link

Before selecting files, write what the reader should be able to explain after
each scene. “We inspected the handler” is an activity; “layout notifications
could invoke synchronization without a position change” is an understanding.
Merge scenes that produce the same answer, including a separate test scene
when its checks simply complete the explanation already underway.

Keep the connection from behavior to mechanism to evidence in the main path.
Do not hide the reason a change works behind a scope disclosure or replace it
with an inventory of files and revisions. Use enough prose to explain the
inference. A shorter description can require more reader effort when it removes
the causal link.

For example, “Ignore layout events” names an action. This explains its effect:

> Neither scroll position changed, so the guard redraws the connectors and
> returns before either synchronizer runs. This prevents a layout event from
> undoing the code reveal. Events that do change a position continue through
> the handler.

Use a title that states the important finding, then focus the code or assertion
that supports it. Include a preserved behavior, tradeoff, or uncertainty when
it affects that finding. These are writing responsibilities, not mandatory
claim/cause/proof fields or repeated labels on every slide.

Compare the small fix in [marker-focus.bygone](../examples/marker-focus.bygone)
with the multi-commit [navigation lab](../examples/navigation-lab.bygone.yaml).
The latter uses multiple questions within one comparison before deliberately
isolating the later correction. Its synthetic mode separates teaching stages
from real history; generated focus steps are not additional explanatory scenes.
Each constructed stage's narration appears at its first evidence step. Later
focuses retain their code targets and offer **Read stage explanation** instead
of repeating the paragraph. Write the stage narration to cover its argument
as a whole, and use the scene introduction to explain why the stages belong together.

After validation, walk the compiled route. Check for repeated stage narration,
unnecessary setup stops, and evidence that does not support the adjacent claim.
Compiling successfully establishes source validity, not reader understanding.
Ask an unfamiliar reader what changed, why the mechanism works, what evidence
supports it, and what remains unverified. At a transition, also ask whether the
comparison changed. Use those observations to choose further viewer changes.

## Anchor rules

- Never emit line numbers or generated hunk indexes.
- Prefer the shortest snippet that is still unique within its file and revision.
- Include `occurrence` only when repeated text is intentional and the selected occurrence is stable.
- Pin immutable commit IDs in `range` for a durable artifact.
- Treat a failed anchor as useful feedback. Do not silently redirect it to nearby code.

## Suggested generation prompt

The missing-tour buttons in History and Compare supply a short handoff like:

```text
Read and follow the Bygone tour skill at /path/to/SKILL.md.
Create a v4 deconstructed tour for /path/to/repository, from <base OID> to <head OID>.
Scope: <selected paths, or the whole repository>.
Additional context: …
```

The desktop supplies the actual installed Markdown path; the instructions are
outside the application archive so local coding agents can read them. Use
**Read instructions** to inspect the Markdown, **Save an editable copy** to fork
it, and **Use my copy** after editing your file or adding project-specific context.
Re-select a file after editing it to refresh the displayed instructions. Copies
belong to you and are not overwritten by application updates.

Browser prompts refer to an attachment instead of inventing a local filesystem
path. Download the Markdown and attach it with the prompt. Do the same when using
a desktop prompt with an agent that cannot access local files. The UI never
invokes an agent automatically. Edited prompt drafts survive instruction changes;
use **Reset prompt** to regenerate their file reference and workspace context.

The generated prose remains a proposal. Validation proves that its evidence exists and is reproducible; a reviewer must still judge whether its interpretation is correct.

## Frame the reading path

Use version 5 opening and conclusion passages to state the tour’s question and
recap what its evidence established. Give each authored mode its own framing.
The Intro is an explicit outline entry. Its “What you'll see” route links to
chapters, or scenes when there are no chapters. Lists use simple reference
numbers; headings and narration use plain titles.
Start the opening with the concrete behavior added or fixed and why it matters.
Keep that outcome to one or two sentences, then introduce the route.
Write the opening to explain the problem and the sequence of questions the route
will answer. Use scene titles that communicate those questions or findings.
The generated itinerary supplies navigation facts, not the reason the work matters.

A scene answers one reviewer question; steps provide the supporting evidence.
Multiple scenes may examine the same comparison when each has a different
question. Merge scenes that merely repeat a question across files.

Before the first step, explain why this scene comes next, what evidence will
appear, and what the reader should notice in connected prose. Do not repeat the
chapter route or list every file and revision in each introduction. Keep the
rationale visible; evidence headers and navigation carry reference details.
Use an explicit directory overview
only when the inventory itself supports that question, and state its `purpose`.
Without one, the viewer previews the first step. The comparison caption identifies
resolved revisions or synthetic stages; prose should explain why a transition
matters. A new scene or file does not inherently mean a new comparison. Close
by connecting the mechanism back to the promised behavior and stating material
limits, rather than reciting the chapter titles. Include any remaining checks without adding
fake code stops. See [the format](change-tour-format.md) for the fields.
