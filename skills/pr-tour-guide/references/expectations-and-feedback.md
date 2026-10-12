# Expectations and reader feedback

Use this guidance when framing a tour, checking comprehension, or responding to
a reader's concern. Aim for correct behavior and an explanation the intended
reader can use.

## State the expected behavior

Use the existing opening to say what should happen and the boundary that matters,
in one or two concrete sentences. Take that expectation from the user's request,
agreed requirements, or existing behavior that must be preserved. If only the
diff is available, label the inferred intent and leave disputed intent unresolved.
An opening is an authored claim, not proof of a requirement or of correctness.

For example: “Moving to the next scene should preserve the comparison unless
the next scene explicitly changes revisions. The reader should know whether
only the focus changed.” Evidence can then establish whether navigation actually
keeps that promise.

This is the lightweight change contract: expected behavior, checked against
evidence. Use an existing step `requirement` when a particular requirement needs
traceability. Do not add a contract file, schema, checklist slide, or repeat the
expectation at every step. Each independent mode needs its own opening when its
purpose differs. End with what the evidence established and any material
unresolved question.

If implementation and expectation disagree, investigate before editing either.
An incorrect implementation needs a code repair; an inaccurate tour needs a
narrative repair. A disputed expectation needs a design or scope decision.
Never silently weaken the expectation to fit existing code.

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
   tour. Do not weaken anchors just to pass validation. Recheck affected claims.
6. Return to the original concern: what was wrong, what changed, what proves
   it, and what remains uncertain. For comprehension, ask for a short teach-back
   or a prediction of one consequential example. A simulated reader is useful
   but must be labeled as simulation. Do not require ritual questions when the
   concern already has a directly verifiable answer.

An unresolved code defect, decision, or missing evidence stays open. Follow the
surrounding task's authorization: a request to explain or author a tour alone does not
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

## Review with questions, not grades

Use these questions internally to find concrete weaknesses. Report the passage,
missing reasoning or evidence, and useful repair; do not generate ratings or a
seven-part report when there are no findings.

| Dimension | Review question |
| --- | --- |
| Purpose & salience | Is the changed behavior clear, and does the reader know why each scene matters? |
| Orientation | Can the reader tell where they are and whether revisions or only focus changed? |
| Reasoning | Does the explanation connect trigger, mechanism, outcome, and material tradeoffs? |
| Evidence fidelity | Does the displayed evidence support the claim, with intent, synthetic stages, test results, and unknowns distinguished? |
| Clarity & audience fit | Can the intended reader follow without hidden prerequisites or unexplained terms? |
| Economy | Does each passage add understanding without repetition or missing causal links? |
| Completeness for purpose | Are essential behavior, boundaries, risks, and material omissions covered? |

These questions adapt research on explanations; they are not a validated
code-tour instrument or a correctness gate. When useful, check understanding
with a concrete prediction or brief teach-back. Label simulated-reader work
as simulation and report only checks actually performed.
