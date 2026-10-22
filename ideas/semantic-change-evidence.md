# Semantic change evidence

## Status and recommendation

Exploration, 2026-10-22. Builds on [symbol inventory](symbol-change-inventory.md),
[text-block correspondence](../plans/text-block-move-tracking.md), and
[refactor decomposition](verified-refactor-decomposition.md). No product change
or dependency adoption is approved by this document.

Build a review inventory that preserves edits inside relocated code. Evaluate
cross-file symbol correspondence before investing further in fuzzy same-file
copy detection. Keep language-independent text moves as a separate useful
capability. The previous plan's slice order remains valid for that capability;
it should not dictate the semantic-review research order.

Confidence: **medium** on prioritizing the cross-file experiment. The October 8
history probes identified whole-file additions/deletions as a large gap, and the
new [bounded experiment](../plans/semantic-correspondence-experiment.md) finds
useful cross-file examples. Neither measures reviewer benefit or broad accuracy.
A hand-labeled sample showing few useful cross-file relationships, or a tool
that cannot expose reliable ranges, would change this recommendation.

## Four questions hidden inside “semantic diff”

| Question | Output | What the evidence establishes |
| --- | --- | --- |
| Where does this content correspond? | Range/symbol relationships | Similar or matching representations in two snapshots |
| What structural operation explains it? | Rename, move, extraction hypotheses | A model of the change, with possible competing explanations |
| What transformation can we reproduce? | Generated intermediate snapshots | The declared operation reproduces the checked bytes under its preconditions |
| What will the program do differently? | Behavioral claims with dependencies and tests | Only what the attached evidence actually supports |

A parser handles syntax, a resolver handles bindings, and program behavior also
involves execution context, effects, external interfaces, and inputs. “Semantic”
should describe the review question, not imply that parsing proves equivalence.

Concrete counterexample, exercised in the research corpus:

```typescript
// before: prices.ts                 // after: billing.ts
const rate = 1;                      const rate = 2;
export function cost() {             export function cost() {
  return rate;                         return rate;
}                                    }
```

The function body is byte-identical; the binding changes. A correct display can
say “same body syntax, different module; behavior unassessed.” It cannot hide
this as verified harmless movement. Imports resolving to different modules,
changed class receivers, initialization order, Python indentation, and dynamic
property names are related failure modes. An import-path edit outside a matched
range is relevant evidence, not noise to discard.

## Evidence and ownership model

Use one comparison-owned artifact with separate inventories, relationships,
operations, and claims. This is a conceptual contract, not a public schema:

```text
Comparison: pinned base/head tree IDs, direction, input digests, engine/policy
Scope: requested documents, loaded documents, exclusions, completeness/reasons
Occurrence: snapshot, path, language/kind, parent, byte/UTF-16 range, line range
Correspondence: sources[], destinations[], evidence[], unresolved alternatives
Operation hypothesis: kind, participating occurrences, supporting relationships
Transform check: preconditions, input/output digests, operation/version, result
Behavior claim: statement, evidence references, limitations, author/tool
```

Every evidence record names its producer, version, normalization, and scope.
Keep literal equality, syntax equality, binding equality, and recorded operation
history distinct. Do not average them into one confidence score. A caller's
intent and an engine's refactoring label are inputs to inspect; neither proves
the result. IDs are comparison-local, not persistent symbol identities.

A simple move is one-to-one; extraction is a relation among the old container,
its new continuation, the new helper, and changed call sites. Introduce a group
with multiple endpoints rather than forcing extraction into a pairwise move.
Nested method/class matches can overlap for navigation. Counting uses disjoint
raw changed ranges and a documented ownership rule; do not add parent and child
sizes. Preserve alternative groupings when evidence does not choose among them.

A recorded operation needs before/after digests and replay validation. Its
presence can strengthen provenance; its absence means “not recorded.” Snapshot
comparison still checks unrecorded edits. CRDT adoption would add concurrency
machinery without recovering missing history; keep that decision separate.

## Matching in stages

1. Inventory pinned snapshots independently. Report extraction coverage by
   language and declaration kind, including parse failures and unsupported
   registrations. A method omitted by extraction is not a deleted method.
2. Establish tentative local continuations using path, container, kind, and
   name. This is weak correspondence evidence; compare the full signatures,
   bodies, modifiers, and documentation even when names agree.
3. Match unique exact representations across the declared scope. Retained
   duplicate occurrences remain competitors; removing them from consideration
   can fabricate a unique origin. File renames provide context, not proof that
   every symbol in a file was retained unchanged.
4. Ask a reusable refactoring engine for edited/moved and extraction groups.
   Keep source ranges and residual edits. Engine disagreements go into
   adjudication; an LLM should not break a tie merely by telling a plausible story.
5. Resolve conflicts conservatively and validate endpoint ownership. For edited
   candidates, measure correspondence precision separately from boundary and
   operation-label accuracy. Abstention is a valid result.
6. Build behavioral explanations only after collecting dependency context.
   A one-token literal/operator change inside a 200-line move must remain visible.

Changed-files-only search must include complete added/deleted files and both
sides of modified files. It misses origins in unchanged files. A later explicit
repository search can expand scope; its cache and invalidation belong to the
comparison coordinator, not a two-string renderer worker. Missing snapshots,
budgets, parse failures, and cancellation produce partial/unavailable results.
“Nothing found” is valid only within the completed declared scope.

## Review experience and accounting

Start with a per-file inventory and a comparison-wide “relocated across files”
list. A row can read “cost: module changed · body syntax equal · behavior
unassessed”; another can read “summarize: name changed · body edited.” Open a
focused source/destination comparison with original paths and coordinates.
Show declaration, documentation, nested body edits, and context separately.
For cross-file moves, offer relevant import/export and call-site changes nearby.

Recurring text should say “matching occurrence” or “also appears at” unless the
available evidence supports a stronger copy claim. Keep copy exploration out
of automatic move navigation until its usefulness and precision are measured.
This directly addresses the October 8 finding that most exact copies were idiom.

Keep the raw diff, scroll alignment, copy-across operations, Git statistics,
coverage units, and coverage denominator authoritative. Relationships add
navigation and explanation; they do not silently remove changes from review.
An optional focus/filter must identify hidden regions and allow full reveal.
Avoid “real change only”: residuals can include missed mechanical edits, while
mechanical changes can alter behavior. Use “unexplained by these transforms.”

For transform stages, verify exact preconditions, replay, and endpoint equality
independently of any equivalence claim. Distinguish pure relocation of bytes,
repair of imports/references, and subsequent edits. A build/test result applies
to the actual intermediate snapshot tested. Final-state equality does not prove
that every intermediate state builds or that tests establish equivalence.

## Decisions still requiring evidence

- Does a symbol inventory help reviewers find a seeded bug inside moved code?
- Is changed-files scope enough, or are unchanged origins routinely essential?
- Does RefactoringMiner improve edited/extracted matches over the cheap exact
  baseline without unacceptable false links, runtime, or coordinate failures?
- Can binding/context warnings be precise enough to be useful without becoming
  a generic warning on every move?
- Does authoring one checked transform stage justify its integration complexity?

The [next experiment](../plans/semantic-correspondence-experiment.md) fixes
inputs, outputs, scoring, and stop conditions before another general matcher
or persistent identity system is built.
