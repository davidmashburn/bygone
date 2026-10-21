# Symbol change inventory and provenance

## Status

Exploring. Research captured 2026-10-20. Tool
capabilities were checked against upstream documentation; no candidate was
installed or benchmarked. This is a proposal, not an implementation commitment.

## Summary

Give reviewers a per-file table answering what happened to each top-level
symbol: what stayed, changed, was renamed or moved, appeared, or disappeared.
Each row should open the supporting before/after code. Use the same inventory
as evidence for tours and agent explanations.

A symbol table can expose both structural changes and the pieces that remain
intact. As a hypothetical example, `summarizeByRegion` becoming
`summarizeByProduct` changes the aggregation model; describing it only as a
rename would conceal the consequential change.

## Separate inventory, matching, and explanation

1. **Inventory:** Parse pinned base/head snapshots and enumerate top-level
   declarations and exports. Represent relevant framework registrations, such
   as named GraphQL types, as distinct kinds of entries. Retain source ranges
   and report unsupported syntax or incomplete extraction.
2. **Matching:** Attach evidence that entries correspond across revisions.
   Keep identity/location changes independent of signature, body, and
   documentation changes: a symbol can move, be renamed, and change behavior.
   Preserve ambiguous candidates rather than forcing a match. Unmatched entries
   mean no counterpart was found in the declared search scope.
3. **Explanation:** Describe behavioral changes from the supporting code.
   Labels such as “replaced” or “ownership moved to the API” are interpretations,
   not consequences of textual similarity. Identify their evidence and
   uncertainty separately from mechanical classifications.

The basic inventory should work without successful move detection. Bygone
would own presentation and navigation; a reusable analysis tool could supply
correspondences. A bounded JSON artifact containing revision IDs, entries,
relationships, source ranges, analysis scope, and evidence could feed both the
table and tours. Avoid persistent identities across arbitrary history until
their meaning and ambiguity are established.

## Existing tools to evaluate

- **[RefactoringMiner](https://github.com/tsantalis/RefactoringMiner):** first
  candidate for the analysis engine. Its current language matrix advertises
  JavaScript, TypeScript, and Python refactoring detection and AST differencing;
  its features include cross-file moves and overlapping refactorings. JS/TS
  precision/recall validation is still on the roadmap. Language support does
  not establish accuracy on arrow functions, exports, or GraphQL registrations.
- **[SemanticDiff](https://semanticdiff.com/docs/understand-diff/moved-code/):**
  candidate for an existing review experience. Its documented move view shows
  within-file movement and edits inside moved blocks. A headless export or
  embedding interface suitable for Bygone has not been established here.
- **[GumTree](https://github.com/GumTreeDiff/gumtree):** lower-level alternative
  for AST mappings and edit actions, including moves. Parser integration,
  symbol inventory, and reviewer explanations would still need evaluation and
  integration work.

These are candidates, not selected dependencies. Before adopting one, check
runtime, licensing, local/offline operation, output stability, source-coordinate
mapping, and latency on representative comparisons.

## What CRDT research contributes

CRDT research offers useful models for identity independent of location,
explicit movement, and causal history. It does not by itself identify the
changes most important to a reviewer. For example,
[Yjs document updates](https://docs.yjs.dev/api/document-updates) can encode
updates missing from another replica; that is a synchronization requirement,
not an assessment of semantic significance.

[Moving Elements in List CRDTs](https://martin.kleppmann.com/2020/04/27/papoc-list-move.html)
studies explicit moves and their interaction with concurrency.
[Extending JSON CRDTs with Move Operations](https://arxiv.org/abs/2311.14007)
extends the question to nested structures.
[Automerge's change model](https://automerge.org/docs/reference/glossary/)
records dependencies between changes. These are useful precedents for
representing provenance, not substitutes for matching existing Git snapshots.

Two snapshots do not reveal whether an author moved an object or deleted and
recreated similar content. Retrofitting a CRDT cannot recover unrecorded
operations. Character-level editing history also does not automatically encode
symbol-level intentions or prove behavioral equivalence.

A later input could be structured operations recorded by an editor or agent:
rename a symbol, move it to another module, then edit its body. Preserve the
distinction between recorded operations, inferred correspondences, and authored
explanations. Bind recorded claims to revisions and validate their source/result
ranges so stale or incomplete logs cannot silently override snapshot evidence.
A structured operation log may suffice; a CRDT becomes relevant if concurrent
editing and merging are themselves requirements.

## Relationship to existing research

- [Text-block move tracking](../plans/text-block-move-tracking.md) handles
  correspondence between text ranges, including prose and configuration. Its
  initial same-file scope and separation from ordinary diff alignment remain
  useful. Symbol inventory is a separate layer; it should not expand that
  plan's first release into semantic analysis.
- [Verified refactor decomposition](verified-refactor-decomposition.md)
  distinguishes checked mechanical transforms from claimed behavior changes.
  The inventory can help select and explain those transforms, but a matched
  symbol is not a verified behavior-preserving refactor.

## Possible next steps and open questions

1. Build hand-checked symbol tables from synthetic or suitably licensed public
   JavaScript/TypeScript and Python examples, with pinned revisions. Include
   pure moves, move-plus-edit, extraction, unrelated deletion/addition,
   duplicate boilerplate, and GraphQL registrations. Do not import private
   review fixtures into this repository.
2. Evaluate RefactoringMiner first. Record false matches, missed relationships,
   missing inventory entries, coordinate accuracy, and runtime. Assess matching
   separately from the quality of generated explanations.
3. If useful, adapt its evidence into a small inventory artifact and render a
   table with linked diffs. If matching is unreliable, ship the inventory with
   explicit unmatched entries rather than blocking on a universal detector.
4. Investigate whether existing editor/agent tooling exposes reliable symbol
   identities and refactoring operations before designing an event recorder.

Open choices include changed-files-only versus wider repository search, how to
represent extraction and one-to-many replacements, and whether unchanged
entries appear by default or behind a per-file expansion. Any presentation must
state its scope and distinguish “not found” from “did not happen.”

Confidence is high in separating inventory, matching, and explanation, and
medium in the proposed engine choice. Actual fixture results could change the
tool recommendation; usable recorded refactoring history could make provenance
support worthwhile earlier. Neither has been validated yet.
