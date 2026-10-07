# Text-block move tracking

## Status

Draft scope, researched 2026-10-07. No implementation or dependency selection.
The [research notes](text-block-move-tracking-research.md) compare open-source
implementations and academic work, with primary-source links and limitations.

## Goal and recommendation

Explain where a block of text came from and where it went: retained in place,
moved, copied, edited, added without an identified origin, or removed without
an identified destination. Start with contiguous ranges of physical lines in
one file comparison, including code, Markdown, configuration, and plain text.

Add a **correspondence layer beside the ordinary diff**. Keep its ordered rows
and executable edits authoritative for scrolling and copy-across. Represent
relocations and copies as separately inspectable relationships between ranges.
Movement and content editing are independent: a block can be moved and edited.

Confidence in this architectural recommendation is **high**, based on Bygone's
monotonic scroll model, existing range-based actions, and the separation of
matching from presentation in the researched tools. Confidence in the proposed
thresholds and UI defaults is **medium to low** until tested. Evidence that
would change the recommendation: an integration spike showing that a sidecar
cannot recover important moves without replacing ordinary alignment, or a
review study showing that separate relationships make changes harder to read.

## Existing Bygone boundaries

Inspected development checkout `f313db986f55634c01f46136f8b2ac0f0211f96a`
and local `main` at `e431a208f5ad24e3fae1a22300a14fc7d041375f`.
`src/diffEngine.ts`, `media/scrollMapping.js`, and
`media/diff.worker.entry.js` were inspected in the checkout; the engine and
worker entry have no diff against that local `main`.

- `buildTwoWayDiffModel` interns lines, uses `diffArrays`, refines replacement
  hunks, and emits rows, line decorations, `insert/delete/replace` blocks,
  reflow anchors, and `quality: exact | fallback`.
- `media/scrollMapping.js` maps ordered rows and reflow anchors across adjacent
  panels. Crossed move relationships must not become scroll anchors.
- `media/connectors.js` draws existing change regions. Green indicates
  one-sided content; blue indicates replacement correspondence. A relocation
  needs its own labeled marker, rather than redefining these colors.
- `media/diff.worker.entry.js` runs the shared engine and returns a request ID.
  Move analysis must share code with host/fallback paths and reject stale work.
- `src/changeInventory.ts` produces a separate Git-derived hunk inventory;
  `src/tourCoverage.ts` consumes those units. Renderer blocks and inventory
  units are not interchangeable. A move must not silently change coverage IDs,
  denominators, raw diff statistics, or tour completion.

This extends [diff matching between panels](diff-matching-between-panels.md)
and [conservative replacement blocks](conservative-replacement-blocks.md).
Those plans deliberately exclude matching outside a local hunk. Recheck source
integration points against the implementation branch when work starts.

## Meaning of the labels

The comparison direction is explicitly left → right. For arbitrary files or
divergent revisions, this is a comparison convention, not proof of chronology.
Even ancestor/descendant snapshots cannot prove which editing gesture occurred.

| Observation | Classification | Important qualification |
| --- | --- | --- |
| Corresponding content remains in the ordered alignment | Retained, possibly edited | A changed line number caused by earlier insertions is not a move |
| A disappearing source occurrence has a credible destination outside its ordinary correspondence | Moved, possibly edited | Inferred relocation; not proof of cut-and-paste or unchanged behavior |
| A source occurrence has a retained continuation and an additional destination | Copied, possibly edited | Source survives; its continuation must be evidenced, not guessed |
| Added content has no accepted source | Added; no origin identified in scope | Not a claim that the text has never existed elsewhere |
| Removed content has no accepted destination | Removed; no destination identified in scope | Not proof that all copies or equivalent behavior are gone |
| Several origins/destinations are comparably plausible | Unresolved correspondence | Keep ordinary additions/deletions visible |

An unchanged pair of duplicate blocks is not a new copying event. Similarity
groups within one snapshot and provenance edges across snapshots are different
objects. V1 discovers duplicates only as needed to explain changed content;
it does not become a repository-wide clone scanner.

For `A B → B A`, either block can be described as moved relative to the other.
Preserve the base diff's retained backbone and document the convention; do not
invent a uniquely correct history. For two identical old occurrences and one
new occurrence, cardinality establishes a disappearance but often not which
occurrence survived. For one disappearing occurrence and two new copies,
report ambiguous fan-out unless context establishes a continuation. Never
resolve these by an arbitrary source-order tie-break disguised as confidence.

## Scope and delivery slices

| Slice | Included | Exit condition |
| --- | --- | --- |
| 0: evidence and model | Curated corpus, baseline outputs, relation contract, counting invariants | Expected and legitimately ambiguous cases recorded before tuning |
| 1: exact same-file relationships | Unique multiline moves; copies from retained text; origin/destination navigation; ambiguous groups | Exact corpus and bookkeeping pass; interaction prototype reviewed |
| 2: bounded edited relationships | Reindentation, small edits within moves/copies, local block comparison, nested edit counts | Held-out precision and latency gates pass |
| 3: cross-file follow-up | Search all changed-file snapshots in one revision pair, including entire added/deleted files | Host inventory, navigation, and scope reporting designed and validated |
| 4: history follow-up | Occurrence lineage through multiple revisions, copies branching, deletions ending paths | Separate identity and merge-history proposal |

**First release = slices 0–2**, with slice 2 gated independently if edited
matches are not reliable enough. Include two-panel views and each adjacent
pair in multi-panel views, editable buffers, and existing worker/fallback paths.

Initially exclude repository-wide scanning of unchanged files, semantic
equivalence, AST/parser dependencies, identifier anonymization, automatic
refactoring labels, merge resolution, persistent history identities, move-aware
patch application, and user-editable similarity sliders. Split/join provenance
is deferred; independent nonoverlapping subranges may still be recognized.

Cross-file analysis cannot be bolted onto a two-string worker: it requires a
comparison-level inventory and bounded index. Changed-files-only analysis must
say so; it misses copies from unchanged files. A future expanded search should
be explicit, cancellable, and separate from loading one file.

## Detection pipeline

### 1. Preserve text and establish the ordinary alignment

Keep original text, EOL/trailing-newline information, and source coordinates.
Use zero-based, half-open line ranges internally; convert to one-based inclusive
labels only at presentation boundaries. Visual wrapping never creates lines.
Whitespace normalization is evidence for matching, never a source mutation.

Build the ordinary diff first. Retained exact spans form the default backbone.
Changes in absolute position alone are insufficient evidence of relocation.
Candidate endpoints come from added/removed ranges **and changed portions of
replacement regions**, since local replacement pairing can obscure a move.
Do not search only blocks whose final kind is `insert` or `delete`.

Require a changed position relative to retained anchors, or demonstrable
reordering within a replacement region, before labeling a correspondence as
moved. High text similarity alone cannot turn an ordinary in-place edit into
a move. If the available alignment does not establish relocation, retain the
ordinary edit classification or mark the relationship unresolved.

If the base engine falls back, report move analysis as unavailable in v1;
do not mistake the whole-file delete/insert fallback for evidence of movement.

### 2. Generate candidates cheaply

Index line fingerprints and short contiguous line windows in the before
snapshot. Query changed after-ranges. Include retained before-ranges in the
index so copies remain discoverable. Extend exact seeds in both directions,
then merge compatible overlapping candidates into maximal ranges.

Use raw line equality first. In slice 2, add a separate reindentation mode
that detects a consistent leading-whitespace shift across the block. All
whitespace differences remain available in the block comparison; even uniform
indentation changes can change program meaning. Do not discard comments,
strings, literals, punctuation, or identifier differences.

Suppress frequent boilerplate seeds; require distinctive content to initiate
a relationship. Blank lines and braces can extend a strong match but cannot
establish one. Verify source text after hash matches. A rare substantive single
line may use a stricter special path; ordinary short one-line moves remain
unclassified rather than flooding the view with braces and imports.

If edited moves lack intact line seeds, use bounded lexical token shingles
to retrieve candidates. Winnowing or an inverted token index are possible
retrieval techniques, not acceptance criteria. Measure need before introducing
both. Preserve token order in final verification.

### 3. Separate similarity from confidence

For an initial syntax-agnostic verifier, tokenize into Unicode word runs and
individual non-whitespace punctuation, retaining offsets. No stemming, case
folding, or identifier substitution. Let `L` be the length of an ordered token
LCS for the proposed ranges, and `a,b` their token counts:

```text
contentSimilarity = 2L / (a + b)
sourceCoverage = L / a
destinationCoverage = L / b
```

Zero-token candidates are ineligible. Bound LCS computation and reject or
defer over-budget candidates. Separately measure informative content and
occurrence ambiguity: punctuation contributes to an edit comparison but
cannot establish eligibility alone. Token similarity does not measure the
probability that the origin is correct.

Starting hypotheses for slice 0's sweep, **not measured defaults**:

| Gate | Starting policy | Sweep / reason |
| --- | --- | --- |
| Multiline seed | At least 3 nonblank lines and 40 Unicode letter/number characters | Try 2/3/5 lines and 20/40/80 characters; avoid ASCII-only bias |
| Single-line exception | Raw equality, at least 80 letter/number characters, unique in both snapshots | Test 40/80/120; otherwise defer |
| Exact candidate | Full raw equality plus information and ambiguity gates | Identical boilerplate remains weak provenance evidence |
| Edited candidate | Similarity ≥ 0.85 and both coverages ≥ 0.80 | Sweep similarity 0.75/0.85/0.90/0.95 and coverage separately |
| Competing origins | Best eligible score exceeds the next materially different origin by ≥ 0.10 | Sweep 0.05/0.10/0.15; context may resolve exact ties only under an explicit tested rule |

Compare competing destinations for moves as well as competing sources. Copies
can legitimately have multiple destinations, so source fan-out itself is not
a rejection. Deduplicate candidates for the same occurrence before measuring
margins. Distance is a weak prior only; crossing a large distance is the point.
Do not reuse Bygone's local replacement thresholds or Git/NiCad thresholds as
equivalent numbers; their units and objectives differ.

### 4. Resolve relationships and residuals

Prefer accepted exact evidence over fuzzy evidence. Protect the retained
backbone; in v1, do not steal a retained occurrence merely to make a nicer move.
Reconcile candidate overlaps across replacement regions before assigning
labels. Inspect retained occurrences before calling disappearance a move.

An after-range has at most one accepted incoming provenance edge. An old
range has at most one continuation (retained or moved), plus zero or more
copy edges. Split partially overlapping endpoints into disjoint subranges
where evidence supports it; otherwise leave the conflict unresolved. A copy
source can be referenced repeatedly without consuming its retained content.

Use deterministic candidate ordering and a documented conservative resolver;
do not promise a globally optimal assignment. Recompute ambiguity after
conflicts are removed. Equal explanations stay unresolved even if iteration
order is stable. Keep substantive gaps out of a matched block unless its local
comparison explicitly represents those edits. Do not absorb unrelated nearby
deletions/additions into a move because the surrounding function matches.

Analyze all candidate relations before deriving categories. A fuzzy move may
explain lines provisionally paired as a local replacement, but the overlay
must suppress that provisional *interpretation* in its own ledger to avoid
two accepted counterparts. The ordinary rows remain unchanged for operations.
If such conflicts are frequent, revisit alignment at the stated decision gate.

## Bookkeeping contract

Store occurrences and relationships, not a single `new | moved | deleted`
enum on a line. An illustrative contract, not a committed public schema:

```text
Occurrence = snapshotId + documentId + [startLine, endLine) + contentDigest
Relation = id + kind(move|copy) + source + destination
         + matchMode(raw|reindented|edited) + evidence + localEdits
Analysis = comparisonKey + algorithmVersion + policyVersion + searchScope
         + status(complete|partial|unavailable) + relations + unresolved
```

`comparisonKey` includes both snapshot digests/versions and direction. IDs are
deterministic within that input and policy, not permanent identities. Content
hash alone is insufficient: copies have identical hashes. Use an explicit
occurrence ID and add a relation ID derived from its endpoints and analysis
version. Source survival may be retained or relocated; the latter can coexist
with copy edges when context actually resolves the continuation.

Recompute only affected adjacent pairs after editing in v1. Key results by
both buffer versions, direction, and policy; discard late results and clear
invalid selection. Cross-file indexing later widens the invalidation domain:
an edit to one source can invalidate copies in other files. Cache digests do
not exempt those dependents from revalidation.

Maintain two explicitly named accounting views:

1. **Raw diff:** existing line additions/deletions, executable hunks, inventory
   IDs, and coverage remain authoritative and unchanged.
2. **Interpreted changes:** accepted moves, copies, ordinary modifications,
   residual additions/removals, and unresolved ranges. Preserve nested content
   edits inside each accepted relation.

Partition raw changed-line sets by range intersection, not by subtracting
`movedLineCount` from Git statistics. Every raw added/removed line belongs to
exactly one outer category: move endpoint, copy destination, ordinary edit,
residual addition/removal, or unresolved. Retained copy sources are references,
not new raw deletions. Some relation endpoints overlap raw context because
the Git inventory and renderer chose different alignments; record these
intersections explicitly. Report nested edits as a breakdown, not an extra
outer category summed twice.

| Example under a base diff showing complete endpoints | Raw accounting | Interpreted accounting |
| --- | --- | --- |
| A 20-line block relocates unchanged | +20 / −20 | 1 move; 20 source and 20 destination lines; no local edits |
| Same move, one line replaced at destination | +20 / −20 | 1 move with local −1/+1, not 20 new lines |
| A retained 20-line block gets a second occurrence | +20 / −0 | 1 copy; 20 destination lines; source is not consumed |
| A block disappears with no accepted destination | +0 / −20 | 20 removed lines; no destination identified in analyzed scope |
| Two old identical blocks become one | Alignment-dependent | One occurrence disappeared; its identity may remain unresolved |

Whole-file rename status is separate from block movement. Once a renamed file
is paired, do not label every unchanged block moved merely because its path
changed. Synthetic [deconstructed stages](deconstructed-diffs.md) can display
relationships, but these describe explanation stages, not historical events.

For future history, connect snapshot occurrences in a graph: copies branch,
deletions terminate occurrences, merges can have multiple parents. Do not
compose two high-similarity edges into proof of endpoint similarity or persist
one pair-local relation ID as a universal block identity. Intermediate ranges
must agree, and uncertainty must survive composition.

## Visualization and interaction

Use **endpoint badges and explicit block comparison** as the default.
The [research notes](text-block-move-tracking-research.md#visual-precedents)
describe supporting precedents; usability in Bygone remains unmeasured.

| Strategy | Benefit | Cost / decision |
| --- | --- | --- |
| Endpoint gutter markers with shared short ID | Works across distance; supports keyboard navigation | V1 default; text says “Moved to”, “Moved from”, or “Copied from” |
| All crossing ribbons | Shows global reordering | Clutter and overlap with existing connectors; do not default to this |
| Focused connector on selection | Gives spatial orientation for one relation | Draw only active/hovered relation; offscreen endpoint gets a labeled continuation |
| Source/destination block comparison | Reveals edits inside a move or copy | V1 detail action; preserve original path/line labels and return location |
| Overview lane or grouped inventory | Helps review many relocations and cross-file changes | Add after the endpoint interaction is validated |
| Fold unchanged portions of moved blocks | Reduces visual repetition | Later option; never hide nested edits or make unresolved candidates disappear |

Example interaction:

```text
Old lines 12–31   [M1 · Moved to 80–99]   →   New lines 80–99 [M1]
Selection: “Moved with edits · 1 line replaced”   [Compare block] [Go to source]

Old lines 12–31   [C1 · Source retained]  →   New lines 80–99 [C1 · Copied]
```

Keep existing one-sided/modified shading as the raw-diff background. Use a
distinct outline or marker shape for move/copy relationships and blue inline
emphasis only for actual local edits. Never communicate kind or certainty by
color alone. Screen-reader labels include direction, both endpoints, copy vs
move, and whether edits exist. Unresolved relationships do not get solid move
arrows; an optional detail view can explain competing origins.

“Next change” retains current raw-hunk behavior. A separate “Next relation”
visits each relationship once and lets the user jump to either endpoint.
Selecting a relation may temporarily reveal both endpoints; ordinary scroll
synchronization remains monotonic. Restore normal synchronization afterward
without repeated snapping. In multi-panel views, the active adjacent boundary
owns the relation; do not draw an unvalidated identity across the whole stack.

Move badges are navigation, never copy/apply controls. Existing copy-across
acts on its original raw hunk and does not also delete a distant source. A
future atomic “apply move” needs a separate operation and conflict contract.

## Budgets, validation, and acceptance

Use candidate-count, total token/cell-work, and index-memory limits as well as
an elapsed-time cancellation guard. Do not allocate an all-pairs block matrix.
Deterministic work limits produce reproducible subsets; wall-clock interruption
can produce different partial results and must carry `partial` status.
An unfinished ambiguity search cannot promote a candidate merely because its
competitor was not examined. Preserve the base diff immediately on exhaustion.

Record candidate counts, accepted/unresolved counts, index size, and elapsed
time. Provisional target: ≤100 ms p95 added analysis time for ordinary file
pairs up to 10,000 lines and ≤32 MiB additional working memory on a named
reference machine. These are hypotheses, not measured commitments. Use the
baseline spike to set explicit total-work budgets before shipping; include
100,000-line repeated/generated stress cases with bounded fallback.

Corpus requirements:

- Exact move up/down; two blocks swapping; earlier insert shifting every line
  without relocation; a move contained inside a replacement hunk.
- Copy from unchanged source; source subsequently edited; move plus copy;
  copies already present; duplicate sources with equal evidence; one survivor
  among duplicates; ambiguous fan-out and partial overlap.
- Move plus identifier/literal edit; reindentation; formatting-heavy code;
  moved prose with reflow; unrelated text sharing punctuation and keywords.
- Single long distinctive line, blank/brace runs, repeated imports, long lines,
  Unicode scripts, tabs, CRLF, trailing-newline differences, empty input.
- Partial extraction, split/join, nested candidate blocks; unrecognized parts
  stay visible, without promising semantic extraction detection.
- Three/six panels; edits during worker execution; swapped direction; different
  deterministic budgets; timeout and fallback; synthetic tour stages.

Acceptance gates:

1. All curated exact and ambiguity cases meet recorded expectations. Review
   labels allow multiple valid alignments; no forced fictional ground truth.
2. On a separate manually adjudicated set of at least 200 diverse candidate
   relationships, report move and copy precision/recall separately, block
   boundaries, abstention, and per-language/text-type results. Target ≥99%
   observed precision for automatic accepted labels; report sample sizes and
   uncertainty, not “99% guaranteed”. Do not trade false links for recall.
3. Tune only on training fixtures, pin configurations, and compare against
   plain Bygone, Git color-moved, and VS Code. Clone/AST tools are secondary
   oracles on their supported inputs, never presumed ground truth.
4. Assert accounting conservation and no duplicate destination ownership;
   disabling tracking reproduces ordinary diff behavior and source bytes.
5. Worker and synchronous results agree for completed deterministic work;
   stale results never attach to newer content. Cancellation is explicitly
   partial/unavailable, never a “no moves” conclusion.
6. Reviewers can distinguish copy from move, find both endpoints, and identify
   an inserted bug inside moved code using mouse, keyboard, and accessible
   labels. Test narrow windows, wrapping, offscreen endpoints, and multi-panel
   navigation; measure against the ordinary diff for mistakes and time.
7. Before implementation completion, run applicable compile/lint/tests,
   worker bundle checks, diff/scroll/copy regressions, performance corpus, and
   host interaction smoke checks. No such checks were run for this plan.

## Next step and decisions to resolve with evidence

Implement slice 0 on a development branch based on `main`: fixture corpus,
diagnostic relation output, accounting invariants, and a small UI prototype.
Keep this orphan planning branch out of implementation history.

Use that spike to decide the single-line exception, minimum distinctive block
size, exact score/margin defaults, latency/work limits, and whether edited
copies can meet the precision bar. Revisit the sidecar only if ordinary
alignment hides enough moves to materially harm the corpus. Cross-file search,
history graphs, persistent overrides, and AST matching require later scoped
decisions rather than being implied by the first release.
