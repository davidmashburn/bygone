# Expectations and reader feedback

Read this reference for optional audience fields or when a reader supplies a
captured Bygone concern. General writing and review workflows can use this
skill, but are not prerequisites for authoring a tour.

## Handle captured context

The capture identifies a passage, mode, pinned range, and authored/displayed
evidence. It is a snapshot, not proof of the current workspace state. Verify
which revision the claim concerns before editing. Synthetic panels are teaching
states, not commits; an excerpt may omit code needed to evaluate the claim.

Check the claim against relevant surrounding implementation, tests, and existing
requirements or explanations. An opening restates an expectation; it does not
establish that expectation's authority. Label inferred intent and unresolved
conflicts. Do not change the expectation merely to fit the implementation.

Answer the reader's concern and identify any artifact needing repair:

- **Implementation code:** incorrect or unnecessarily obscure behavior.
- **Maintained docs:** missing reusable concepts, usage, or architectural context.
- **PR explanation:** missing change rationale or tradeoffs.
- **Tour document:** misleading wording, missing causal links, or a poor evidence path.
- **Viewer:** navigation, focus, or comparison behavior that prevents inspection.

A disputed requirement may need a human decision; missing evidence may need a
check. A clear answer may need no saved change. Follow existing task authorization
for repairs; tour feedback alone does not authorize unrelated edits or shared
communications. Do not use extra tour prose to conceal a defect elsewhere.

When repairing a tour, keep the outcome, mechanism, and decisive evidence visible.
If an authorized implementation repair changes the intended committed range,
regenerate context, resolve affected anchors, revisit claims, and validate. If
code remains uncommitted, disclose that the pinned tour does not yet show the fix.
Historical tours can intentionally retain their original range.

Distinguish the agent's answer from edits to the saved tour document. Report the
actual repair and checks, including unresolved concerns. Validation is evidence
of structural grounding, not a demonstration of reader understanding.

## Describe the reader

Use optional v5 `details.audience` on the root or an independently authored
`tours.historical` / `tours.deconstructed` object. If present, supply:

- `codebase`: `none`, `some`, or `maintainer`.
- `language`: `none`, `basic`, `fluent`, or `advanced`.
- `readingDemand`: `general`, `technical`, or `specialist`.
- `purpose`: `overview`, `explanation`, or `review`.
- `scope`: what this tour explains and any material limit.
- Optional `domain`: concrete prerequisites, and `estimatedMinutes`: reading time.

Independent modes describe their own readers. These fields set expectations;
they are not quality grades. Language expertise, codebase familiarity, and prose
reading demand are distinct. Do not invent an audience or reading-time estimate
merely to populate Tour details.
