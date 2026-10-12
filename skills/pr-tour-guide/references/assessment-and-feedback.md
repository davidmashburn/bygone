# Assessment and reader feedback

Use this workflow when authoring an assessment, evaluating comprehension, or
responding to a reader's question or concern. The goal is a correct change and
an adequate explanation for the intended reader. Do not optimize a score at the
expense of either.

## Diagnose before repairing

1. Restate the concrete concern and the claim under question. Recover the tour
   mode, section, pinned range, focused evidence, and reader expectation from
   the captured context. Verify the current source and workspace revision;
   a copied request can be stale, and synthetic panels are not Git commits.
2. Distinguish the required behavior, the tour's claim, and the implementation's
   actual behavior. Inspect surrounding code and relevant tests. Missing
   requirements or evidence remain unknowns, not assumptions to defend.
3. Identify the repair destination; more than one may apply:

| Finding | Next action | Evidence of resolution |
| --- | --- | --- |
| Implementation defect | Reproduce the mismatch; fix within the authorized scope | Targeted regression check and an accurate refreshed explanation |
| Explanation defect | Restore a missing causal link, concept, boundary, or useful evidence; trim irrelevant detail | Reader can explain the outcome and mechanism or predict a concrete case |
| Design or scope disagreement | State the competing goals and tradeoffs; identify the decision needed | Decision recorded, with its consequences explained |
| Missing evidence | Inspect source or run the smallest decisive check | Claim supported, narrowed, or explicitly left unresolved |
| Viewer/tool defect | Reproduce navigation, comparison, focus, or accessibility failure | Original reading action works and the evidence matches the passage |

For example, “Why is ignoring cancellation safe?” may reveal an omitted
explanation that a replacement request owns the result, or code that also
swallows real failures. Check ownership and failure paths before choosing.
Do not assume a question is merely a writing defect, use more prose to defend
incorrect code, or try to persuade away an informed design disagreement.

4. Make the smallest sufficient repair. Keep reasoning visible: trigger →
   mechanism → outcome, plus the boundary that matters. Add background only
   when the target reader needs it. Avoid turning every concern into a new
   scene, glossary, or scope inventory.
5. Close both loops. Verify changed behavior and re-read the explanation against
   the actual evidence. If code changes, refresh the pinned range, regenerate
   context, re-resolve anchors, revisit claims and omissions, and validate the
   tour. Do not weaken anchors just to pass validation. Reassess affected
   content; never simply replace an old assessment's hash.
6. Return to the original concern: what was wrong, what changed, what proves
   it, and what remains uncertain. For comprehension, ask for a short teach-back
   or a prediction of one consequential example. A simulated reader is useful
   but must be labeled as simulation. Do not require ritual questions when the
   concern already has a directly verifiable answer.

An unresolved code defect cannot be dismissed by strong writing scores. An
unresolved decision or missing evidence stays open. Follow the surrounding
task's authorization: a request to explain or author a tour alone does not
authorize unrelated implementation edits, commits, publication, or messages.

## Describe the reader separately

Use optional v5 `details.audience` on the root or the independently authored
`tours.historical` / `tours.deconstructed` object. If present, supply:

- `codebase`: `none`, `some`, or `maintainer`.
- `language`: `none`, `basic`, `fluent`, or `advanced`.
- `readingDemand`: `general`, `technical`, or `specialist`.
- `purpose`: `overview`, `explanation`, or `review`.
- `scope`: a concise statement of what this tour explains and any material limit.
- Optional `domain`: concrete prerequisites, and `estimatedMinutes`: reading time.

These are expectations, not grades. “Maintainer” is not better than “new to this
codebase.” Do not infer language expertise from prose reading level. Reading
formulas are rough diagnostics of sentence/word features, not comprehension
tests; shortening sentences must not remove necessary definitions or reasoning.

## Rate explanation quality

Read the tour as its stated audience, follow the evidence, and assess each
dimension independently. No composite score or pass threshold is defined.

| Key | Dimension | Observable criterion |
| --- | --- | --- |
| `purpose` | Purpose & salience | The opening explains problem/outcome; each scene's contribution is clear before evidence; the conclusion consolidates the result. |
| `orientation` | Orientation | The reader can identify the comparison and scope, their place, and whether a transition changes revisions or only focus. |
| `reasoning` | Reasoning | Trigger, mechanism, outcome, and important tradeoffs form a supported causal explanation. |
| `evidence` | Evidence fidelity | Displayed code supports the claim; synthetic stages, real revisions, test results, intent, and uncertainty are distinguished. |
| `clarity` | Clarity & audience fit | Concepts and terms are introduced at the intended reader's level; necessary prerequisites are explicit. |
| `economy` | Economy | Passages and focus changes add understanding; repetition and incidental details are removed without breaking reasoning. |
| `completeness` | Completeness for purpose | Essential behavior, boundaries, risks, and material omissions are covered relative to the declared purpose. |

Apply the same anchors to each criterion:

- **0 — Fails:** absent or misleading; the reader cannot accomplish the purpose.
- **1 — Weak:** substantial gaps force guesswork or incorrect conclusions.
- **2 — Adequate:** usable for the intended purpose with specific, bounded gaps.
- **3 — Strong:** consistently meets the criterion with concrete supporting evidence.

Leave dimensions unassessed when not evaluated. For every rating provide a
specific `reason` and nonempty `references` to authored scene/step IDs (or
`opening` / `conclusion` when those bookends exist). Cite the relevant mode's
content; qualify step IDs as `sceneId/stepId` when IDs repeat across scenes. Put false claims, broken evidence, and other unresolved blockers in
`blockers`; never average them away. Scores evaluate the explanation and do
not certify implementation correctness.

Use `details.assessment` with `reviewer`, `method` (`self-review`,
`simulated-reader`, or `human-reader`), `assessedAt` (ISO timestamp),
`contentHash`, `ratings` (a partial map of the seven keys), and optional
`blockers`. Each rating is `{ score, reason, references }`. Record only work
actually performed and identify a model simulation truthfully.

After finishing narrative and audience edits, run:

```sh
bygone tour validate review.bygone --json
```

Use its current `contentHash` for the assessment you just performed. Assessment
edits do not change that hash; narrative, audience, source range, and evidence
edits do, including movement of symbolic Git refs after they are pinned. The viewer preserves mismatched ratings as stale, rather than
silently presenting them as current. A full-source hash conservatively marks
all modes stale when any authored mode changes. Independent modes do not
inherit root ratings. Validate again after adding the assessment.

## Validate the rubric in use

This is a research-informed adaptation, not a validated code-tour instrument.
Independent raters should compare reasons and disagreements, and real readers
should explain what changed, why, predict a meaningful example, and identify
remaining uncertainty. Compare those observations with ratings before using
them for any acceptance gate. More detail, fewer words, or higher scores alone
do not demonstrate better understanding.
