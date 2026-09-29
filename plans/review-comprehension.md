# Review comprehension

Status: Draft proposal. No runtime feature implemented.

An initial [paired code and prose case study](review-comprehension-case-study.md)
examines the tour navigation change at `2b5add9`. It records agent-checked
findings and proposed improvements; the two-change human evaluation below
remains outstanding.

## Problem and intended outcome

A reviewer can navigate every changed file and still miss a new prerequisite,
an ordering constraint, or an unsupported explanation. File attention ranking
and tour coverage help navigation, but neither establishes comprehension.

Help a reviewer answer: what must I understand to evaluate this change, and
which conclusions still need evidence? Keep access to the complete diff.

## Existing foundation

Development snapshot examined: `1b4f966` on the development branch.

- `src/changeAttention.ts` provides file roles, suggested reading order, and
  reasons for attention. Its ranking is a heuristic, not a risk assessment.
- `src/tourCoverage.ts` computes referenced change coverage and records authored
  depth labels. Neither anchor intersection nor a depth label proves correctness.
- `docs/generating-change-tours.md` organizes explanations around reviewer
  questions and distinguishes structural validation from interpretation.

These paths refer to development history; they do not exist on this orphan
planning branch. Recheck them against the implementation base before coding.

## First experiment

Use two public or synthetic changes: one local behavior change and one change
with a consumer/provider compatibility requirement. Do not derive committed
fixtures from proprietary code or incidents.

For each change, author a small companion assessment using existing tour prose
and exact source anchors. No new schema, CLI, or UI is required for this trial.
Include only items that affect a review decision:

| Item | Required content |
| --- | --- |
| Concept or invariant | What the reader must understand, why, and source evidence |
| Boundary or prerequisite | Producer, consumer, required relationship, and evidence or explicit unknown |
| Complexity tradeoff | Reasoning removed and new reasoning required of callers or operators |
| Unresolved question | What is unknown and what observation could resolve it |

A synthetic compatibility example: a client begins selecting a new schema field.
The source shows the requirement; compatibility with a deployed server remains
unknown until checked against a specific deployment. The assessment must not
infer deployment from a merged backend commit.

Allow "none identified in the inspected scope" and distinguish it from a claim
that no dependencies exist. State omitted or unread evidence.

## Evaluate before building a product surface

Compare the ordinary review with the companion assessment. Ask readers to
identify changed behavior, preserved invariants, failure behavior, compatibility
requirements, and supporting evidence. Record correct answers, missed conditions,
elapsed review time, clarification requests, and navigation effort separately.

Use distinct matched changes or counterbalance the reading order; a reader who
has already studied a change cannot supply an unbiased second first impression.
Have a knowledgeable maintainer check the answer key. A small pilot produces
qualitative evidence, not a validated productivity claim. Agent trials can find
missing context but cannot establish the benefit for human readers.

Proceed to a UI proposal only if the assessment exposes useful missing context
or improves comprehension without obscuring uncertainty or adding disproportionate
reading and authoring effort. Revise or stop if it mostly repeats the diff.

## Candidate product follow-up

If the trial is useful, prototype an optional review panel with a concise list
of concepts, boundaries, and unresolved questions. Each item opens its evidence;
the complete Files rail stays available. Show authored interpretation separately
from deterministic facts and external checks.

Tie each assessment to exact base/head object IDs. A changed range makes the
assessment stale and requires revalidation; do not silently carry conclusions
to a new revision. Mark unavailable external evidence as unknown.

Do not introduce a universal entropy score or block merges on an agent's
judgment. Public API, schema, persistence, and host placement decisions remain
open until the trial shows which information is useful.

## Acceptance for this proposal's experiment

- Two public or synthetic changes with immutable ranges and checked evidence.
- A comparison of ordinary review and the companion assessment, with limitations.
- Explicit accounting for omitted evidence, inference, and external unknowns.
- A recorded decision to proceed, revise, or stop based on observed reader answers.

This document defines the experiment. The initial case study is preparatory;
the comparative reader evaluation and acceptance criteria remain incomplete.
