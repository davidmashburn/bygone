# Tour assessment and feedback

Status: Approved implementation scope (2026-10-12). The user authorized the build
and local implementation/planning commits, with no release. This is a research-
informed adaptation, not a validated code-tour instrument or a merge gate.

## Relationship to the existing work

This plan extends [Tour reasoning and salience](tour-reasoning-and-salience.md),
which remains the source of truth for the narrative experiment: causal
explanation, salience, comparison continuity, hierarchy, and the preserved
user-history record in [its conversation appendix](tour-reasoning-and-salience-context.md).
It does not replace that plan, repeat its earlier bibliography, or turn its
interactive [illustration](mockups/tour-reasoning-and-salience.html) into a
validated product pattern.

The evaluation foundation remains [Review comprehension](review-comprehension.md)
and its [paired code-and-prose case study](review-comprehension-case-study.md).
[Tour presentation review](../ideas/tour-presentation-review.md) and
[Tour orientation, scene framing, and conclusions](tour-orientation-and-narrative-framing.md)
preserve earlier UI observations and requirements. The [manual user-history
record](tour-reasoning-and-salience-context.md) is evidence about the problem
and evolving preferences, not a substitute for a reader study.

The central distinction in this follow-up is:

- descriptive details tell a reader what kind of tour this is and what it
  covers;
- quality assessment describes how well the explanation serves that stated
  purpose and audience;
- reader concerns are unresolved observations that require investigation.

Do not collapse these into one score or use an explanation score to certify the
underlying implementation.

## Rationale and confidence

The earlier iterations moved between too much inventory and too little context.
The preserved feedback shows that the missing ingredient was not a universal
word target. The reader needs a salient claim, a causal path from trigger to
mechanism to behavior, and enough orientation to know what is changing between
steps. The existing research plan identifies that strategy, but it does not yet
define a reviewable quality record or a low-friction way for a real reader to
say what is unclear or wrong.

Confidence is high that descriptive audience/context must be kept separate from
quality judgments: a specialist explanation can be appropriate and strong for
its intended audience, while a concise overview can be inadequate for a review
purpose. Confidence is moderate in the exact rubric and reader-feedback
surface. Those choices need calibration with real readers before they can
support any merge requirement.

Evidence that would change the design includes readers consistently answering
the intended questions while the rubric misses their confusion, readers needing
different context fields for different purposes, or feedback capture adding
more diagnosis and ceremony than it removes.

## Approved scope

### Descriptive tour details

Tour details are compact orientation metadata, not quality ratings. Keep them
separate from the authored explanation and make secondary detail expandable so
the opening remains salient.

| Detail | Allowed or expected value |
| --- | --- |
| Codebase familiarity | `none`, `some`, or `maintainer` |
| Language familiarity | `none`, `basic`, `fluent`, or `advanced` |
| Concrete domain prerequisites | Specific concepts the reader needs, or an explicit none/unknown statement |
| Reading demand | `general`, `technical`, or `specialist` |
| Purpose | `overview`, `explanation`, or `review` |
| Scope | The change/range, relevant files or areas, and material exclusions or unknowns |
| Estimated time | A plainly labeled approximate number of minutes |

Codebase familiarity and language familiarity are independent. A maintainer of
the repository may still need domain context; a fluent programmer may have no
familiarity with this codebase. Scope and estimated time set expectations but do
not promise exhaustive review or comprehension.

The main reading path should still lead with what the change does and why it
matters. Details should not reintroduce the rejected inventory-heavy opening.

### Explanation-quality rubric

Assess the explanation, not the correctness of the code. Every dimension is
scored independently on this four-point scale:

| Rating | Meaning |
| --- | --- |
| 0 — fails | The dimension is absent, contradictory, or misleading enough to block the stated purpose. |
| 1 — weak | A partial explanation exists, but the reader must make significant unsupported inferences. |
| 2 — adequate | The explanation serves its stated purpose with only minor gaps or friction. |
| 3 — strong | The relationship is explicit, coherent, evidence-grounded, and proportionate to the purpose. |

Record only dimensions actually assessed. A partial assessment contains some
ratings; missing dimensions are unassessed, not zero. Each recorded rating needs
a reason and scene/step references. Do not invent ratings for unchecked criteria.

The seven dimensions are:

1. **Purpose and salience** — Does the opening and each relevant scene make the
   important behavior, question, or consequence visible? Does the emphasis tell
   the reader what matters in the adjacent evidence rather than merely naming a
   file or activity?
2. **Orientation** — Can the reader tell where they are in the tour, what the
   chapter/scene/step levels mean, what evidence is currently shown, and whether
   the transition changed a file, a real or synthetic comparison, or only the
   explanatory question?
3. **Reasoning** — Does the explanation connect the trigger to the mechanism and
   then to the behavior or tradeoff? It must make the causal inference visible,
   including what behavior is preserved and what remains uncertain.
4. **Evidence fidelity** — Do claims match the displayed source, anchors, tests,
   and verified metadata? Does the explanation distinguish direct evidence,
   design inference, and unknowns instead of inventing author intent?
5. **Clarity and audience fit** — Is the explanation understandable for the
   declared familiarity, language, domain prerequisites, and reading demand?
   Are necessary terms introduced without forcing the reader to diagnose the
   missing context themselves?
6. **Economy** — Does the tour remove repeated or irrelevant processing while
   retaining the reasoning needed for the purpose? Economy is not a reward for
   omitting evidence or causal links.
7. **Completeness for purpose** — Is there enough to fulfill the declared
   overview, explanation, or review purpose, including important limitations and
   unresolved questions? This is not a claim that the tour covers every line or
   certifies the change.

Do not convert the dimensions to a `/100` aggregate. A blocker must remain
visible even when other dimensions are strong; averages must never make an
unresolved implementation defect, evidence gap, or audience failure disappear.
Scores describe the explanation and cannot dismiss a reader's unresolved
concern.

### Assessment presentation and provenance

If an assessment is shown to a reader, keep the default summary compact and
order observations from weakest to strongest so the most useful repair is easy
to find. Expand a dimension to reveal its reason, scene/step references, and
provenance. Keep full code and ordinary tour navigation available; the
assessment must not become another mandatory reading layer.

Each assessment record carries:

- reviewer;
- method: `self-review`, `simulated-reader`, or `human-reader`;
- assessment date;
- content hash for the narrative and source metadata that were assessed;
- partial map of per-dimension ratings; missing dimensions are unassessed;
- a reason and the relevant scene/step references;
- any unresolved blocker or reader concern.

An assessment is stale when the narrative or source metadata it describes
changes, including the range, endpoints, evidence anchors, or claims that the
record relies on. The content hash excludes assessment edits, so correcting a
reason, adding a reference, or changing a rating does not itself make the
underlying content stale. A refreshed tour range, anchor, or claim requires
fresh assessment rather than silently carrying scores forward.

Self-review and simulated-reader methods are useful for finding omissions, but
they are not evidence that a human reader understood the tour. A human-reader
method is required for calibration before any merge gate is proposed.

## Reader feedback

The reader-facing surface has two controls:

- **Explain this** — ask for clarification of the current explanation or
  evidence;
- **Question this change** — record doubt about the behavior, reasoning, or
  evidence.

Both controls open one freeform concern field. The reader should describe what
seems unclear, surprising, or wrong; the interface captures context
automatically:

- current scene and step, including the readable location;
- active comparison and whether it is a real range or explanation stages;
- file, code anchor, or visible evidence context.

The result is a reviewable request that the reader can copy and paste into an
agent. It is not sent to a backend and does not create a hidden ticket,
comment, or external message. Preserve the existing scope permissions; adding
these controls does not authorize shared-system writes or production actions.

Do not require the reader to select a diagnosis before they can report a
concern. Classification belongs to the investigation. A reader who says “I do
not see why this is safe” has supplied valuable evidence even if they cannot
decide whether the code, prose, scope, or viewer is at fault.

## Investigation and repair loop

The agent or review skill should:

1. restate the reader's concern in neutral terms, retaining the captured scene,
   step, comparison, and code context;
2. check the stated requirements, relevant source, callers, and tests before
   classifying the concern;
3. classify the result after investigation, allowing overlapping outcomes;
4. make the smallest repair that addresses the evidence;
5. verify both behavior and comprehension, rather than closing one because the
   other looks plausible;
6. refresh the tour range, anchors, and claims when the repair changes the
   source or narrative, and invalidate assessments that depend on them.

The five overlapping outcomes are:

| Outcome | What investigation establishes |
| --- | --- |
| Implementation defect | The code fails a requirement, invariant, or expected behavior. Prose cannot repair it. |
| Explanation defect | The implementation is supported, but the tour omits or misstates the trigger, mechanism, behavior, tradeoff, or evidence. |
| Design/scope disagreement | The concern is about what should be built or reviewed, not merely whether the current explanation is clear. Record the decision; do not persuade the reader away with prose. |
| Missing evidence | The claim may be plausible, but the required source, test, environment fact, or limitation has not been checked. Mark it unknown until evidence exists. |
| Viewer/tool issue | The underlying explanation or code may be sound, but navigation, anchoring, comparison identity, rendering, or context capture prevents the reader from seeing it. |

These outcomes can coexist. For example, a viewer issue can hide evidence while
the narrative also overclaims what that evidence proves. A strong rubric score
does not close an unresolved concern, and a design disagreement is not a low
comprehension score to average away.

### Cancellation-safety example

The question “Why is ignoring cancellation safe?” must not be answered from
the wording alone. At least two materially different findings are possible:

- an explanation defect: the prose omitted that cancellation belongs to a
  superseded replacement request, while the active request still owns and
  reports real failures;
- an implementation defect: the code is swallowing a genuine failure under a
  cancellation path rather than ignoring only the expected replaced request.

The investigation must inspect request ownership, replacement ordering,
callers, error propagation, and relevant tests. Only then should the skill
classify the concern and choose the smallest repair. If the code is repaired,
its behavior and tests must be rechecked; if the explanation is repaired, its
causal claim, anchors, and assessment must be refreshed. Neither prose nor a
score can defend flawed code or dismiss a legitimate design/scope dispute.

## Reader calibration and evaluation

Use the existing [review-comprehension experiment](review-comprehension.md)
and the [narrative experiment](tour-reasoning-and-salience.md) as the starting
point rather than creating a dashboard or universal score immediately.

The first calibration should include a small bug fix and a multi-commit feature,
with a knowledgeable maintainer checking the expected answers. Compare an
ordinary explanation with a revised one using matched changes or counterbalanced
order; do not treat a second reading of the same change as an unbiased first
impression.

Ask readers, without coaching:

- What behavior does this change produce, and why does it matter?
- What trigger and mechanism produce that behavior or tradeoff?
- Which source or test supports the conclusion?
- What remains unresolved or outside the evidence?
- At a selected transition, did the file change, did the comparison change, or
  did only the explanatory question change?
- Can the reader return to the relevant step after inspecting surrounding
  evidence?

Record reader answers and concrete concerns separately from time, preference,
click count, and word count. Use the answers to calibrate the rubric's anchors,
the meaning of “adequate” for each purpose, and whether the captured context is
enough for repair. A real-reader calibration is required before using these
assessments as a merge gate. Until then, the records are an experiment and
repair aid, not an approval mechanism.

### Evaluation limitations

- No source here validates a code-tour assessment instrument. The health-domain
  literacy rubrics below are adapted design references, not code-review studies.
- A small pilot can reveal missing context and disagreement, but cannot support
  a general productivity, defect-detection, or comprehension claim.
- A rating describes the authored explanation for a declared purpose and
  audience. It does not certify code correctness, exhaustive review, safety, or
  merge readiness.
- Reading-level formulas measure word and sentence features; they do not measure
  code expertise, domain knowledge, or comprehension. Optimizing for a grade
  level can omit essential concepts.
- Do not transplant a health-domain cutoff such as 90/100 into this rubric.
- Partial and unassessed dimensions remain explicit rather than being treated as
  failures. Missing evidence is a reason to investigate, not permission to
  assign a zero.

## Research inventory and evidence boundaries

The earlier narrative sources remain inventoried in
[Tour reasoning and salience — Research basis and limits](tour-reasoning-and-salience.md#research-basis-and-limits):

- [Assertion–evidence presentation structure](tour-reasoning-and-salience.md#assertionevidence-presentation-structure)
  (Garner and colleagues);
- [Mayer, coherence, signaling, proximity, and pacing](tour-reasoning-and-salience.md#coherence-signaling-proximity-and-pacing),
  2017;
- [di Biase et al., decomposition and rationale](tour-reasoning-and-salience.md#decomposition-does-not-supply-rationale-by-itself),
  2019;
- [Segel and Heer, guided narrative with exploration](tour-reasoning-and-salience.md#guided-narrative-with-reader-exploration),
  2010;
- [Microsoft, software-engineer code-change comprehension](tour-reasoning-and-salience.md#supporting-code-comprehension-research),
  2012;
- [Code Review Comprehension](tour-reasoning-and-salience.md#supporting-code-comprehension-research),
  2025.

The following sources were part of the parent research pass for this
follow-up. Their summaries are recorded here so the adaptation boundary stays
visible; this document does not claim a new independent validation.

### Standards and health-literacy references adapted cautiously

- [ISO 24495-1:2023 initiator](https://www.iplfederation.org/iso-standard/)
  and [ISO's standard summary](https://www.iso.org/standard/78907.html):
  relevant, findable, understandable, and usable information. The full
  standard was not read; use this as a framing reference, not as validation of
  a code-tour rubric.
- [CDC Clear Communication Index: how to use](https://www.cdc.gov/ccindex/tool/how-to-use.html),
  [Index](https://www.cdc.gov/ccindex/), and [full index score sheet](https://www.cdc.gov/ccindex/pdf/full-index-score-sheet.pdf):
  audience/literacy and objective, leading with the main message, visual cues,
  chunks, summaries, and known-versus-unknown information; independent raters
  reconcile ratings and test readers. The [validation study](https://pubmed.ncbi.nlm.nih.gov/24951489/)
  is health-domain evidence. Do not transplant its 90/100 cutoff.
- [AHRQ PEMAT 1](https://www.ahrq.gov/health-literacy/patient-education/pemat1.html)
  and [PEMAT 2](https://www.ahrq.gov/health-literacy/patient-education/pemat2.html):
  separate understandability from actionability and exclude not-applicable
  items. The related [development paper](https://pmc.ncbi.nlm.nih.gov/articles/PMC5085258/)
  was identified but not fully read.
- [Mayer and Fiorella, principles for reducing extraneous processing](https://www.cambridge.org/core/books/abs/cambridge-handbook-of-multimedia-learning/principles-for-reducing-extraneous-processing-in-multimedia-learning/F29A19FCD34C542806F736E0661C05F5):
  coherence, signaling, redundancy, and contiguity. The chapter landing
  summary was read; the full book was not.
- [CDC readability guidance](https://www.cdc.gov/nceh/clearwriting/mod2/index.html):
  readability formulas measure word and sentence features. Overoptimization can
  omit essential concepts, and reading grade is not code expertise or
  comprehension.

The design in this plan is an inference from those boundaries plus the Bygone
user history. In particular, the seven dimensions, rating anchors, staleness
rule, two feedback controls, and investigation loop are proposed product
behavior; they are not presented as requirements of ISO, CDC, AHRQ, Mayer and
Fiorella, or any cited code-comprehension study.

## Implementation boundaries and acceptance

The implementation should preserve the existing tour hierarchy and
full-code access, reuse the review-comprehension evaluation foundation, and keep
the main path focused on salient causal explanation. It should not add a
universal word limit, an automatic `/100` score, a forced reader diagnosis, a
backend feedback sender, or a merge gate before real-reader calibration.

Implementation acceptance:

- keep descriptive tour details distinct from explanation-quality assessment;
- represent all seven dimensions with optional 0–3 ratings, reasons, references,
  and provenance; show missing dimensions as unassessed;
- show blockers and weakest observations without averaging them away;
- mark assessments stale when the assessed narrative/source content changes,
  while excluding assessment-only edits from staleness;
- capture Explain this and Question this concerns with automatic scene/step,
  comparison, and code context, then provide copy-only review text;
- investigate and classify the five overlapping outcomes after checking
  requirements, source, and tests;
- close both behavior and comprehension after the smallest repair; and
- complete real-reader calibration before treating the assessment as a merge
  requirement.

No product files, source code, external comments, tickets, or production writes
are authorized by this planning record. Scope permissions remain inherited from
the surrounding task and repository rules.
