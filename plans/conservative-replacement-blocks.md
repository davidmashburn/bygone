# Conservative replacement blocks

## Goal

Make Bygone's diff colors tell the truth about correspondence:

- blue means the old and new content are credible versions of the same line or
  block;
- green means content is present on only one side of the comparison; and
- unrelated content must not become a blue change merely because a deletion
  run is adjacent to an insertion run.

The committed regression fixture is the Bygone comparison between:

- [replacement-block-before.md](fixtures/replacement-block-before.md); and
- [replacement-block-after.md](fixtures/replacement-block-after.md).

The middle list item is a credible edit and should be blue. The first and last
items discuss different subjects and should be green one-sided changes. The
current comparison paints the coarse three-line replacement blue.

## Current behavior

`buildTwoWayDiffModel` first uses `diffArrays` to identify unchanged,
removed, and added line runs. Whenever a removed run is immediately followed
by an added run, it:

1. calls `alignReplacementLines` to choose possible line counterparts;
2. applies inline highlights to the chosen pairs; and
3. emits one `replace` block covering the entire removed and added runs.

The third step does not depend on the alignment result. A hunk remains a
`replace` block even when:

- the matcher accepts no line pairs;
- only a small minority of its lines pair;
- accepted pairs are low-confidence contextual matches; or
- unrelated lines happen to occupy compatible positions.

The renderer maps every `replace` block to the blue
`bygone-paired-line` decoration and every `insert` or `delete` block to
the green `bygone-one-sided-line` decoration. The current model therefore
conflates Git-level hunk adjacency with semantic correspondence.

The completed [diff-matching plan](diff-matching-between-panels.md) improved
line scoring and alignment, but explicitly left semantic block colors
unchanged. This is a focused follow-up to that work.

## Desired behavior

- A blue line always has an accepted counterpart on the other side.
- Blue counterparts refer to recognizably related content.
- Unpaired deleted and added lines use green one-sided styling, including when
  they occur inside one coarse replacement hunk.
- One coarse hunk may render as several alternating paired and one-sided
  blocks.
- Blue inline emphasis appears only within accepted paired lines.
- Weak or ambiguous evidence prefers two green one-sided regions over a
  confident-looking blue replacement.
- Line pairing, block construction, connectors, change navigation, copy, and
  synchronized scrolling agree on the same correspondence decision.

## Proposed approach

### 1. Preserve the observed comparison as a regression

Use the committed Markdown pair as the end-to-end regression input. Also
represent its expected alignment as a small table-driven unit fixture
containing:

- the left and right source lines;
- the score and evidence that currently admit the pair;
- expected paired line indices;
- expected unpaired line indices; and
- expected `replace`, `insert`, and `delete` block ranges.

The unit fixture is authoritative. The Markdown comparison protects the
rendered integration without depending on unrelated planning-document edits.

Before implementation, capture a screenshot or line-numbered note of the
fixture's incorrect blue block so the visual regression is explicit.

### 2. Separate coarse hunks from rendered blocks

Treat the adjacent removed and added runs returned by `diffArrays` as one
coarse replacement candidate, not as the final blue block.

After `alignReplacementLines` returns aligned rows, partition the candidate
into maximal contiguous regions:

- rows with accepted left/right counterparts become `replace` regions;
- left-only rows become `delete` regions;
- right-only rows become `insert` regions.

Emit `DiffBlock` ranges from those regions. Do not emit an outer
`replace` block around their union.

This preserves the current `DiffBlock` kinds and renderer vocabulary while
allowing one coarse hunk to contain honest blue and green sub-blocks.

### 3. Tighten correspondence eligibility

Re-evaluate the false pairs against the existing scoring paths:

- the informative singleton exception;
- ordinary eligibility at `MINIMUM_MATCH_SCORE`;
- contextual neighbor support;
- weak diagonal-run support; and
- large-hunk structural anchors.

Add a minimum shared-content requirement that cannot be satisfied by position,
similar length, Markdown punctuation, headings, list markers, or common prose
tokens alone. A contextual neighbor may disambiguate between already plausible
candidates, but must not make an otherwise unrelated pair eligible.

Retain syntax-agnostic scoring. Calibrate the smallest threshold or evidence
change that rejects the observed false pairs without breaking the existing
curated matches.

### 4. Make confidence explicit at the alignment boundary

Replace the current aligned-row shape only if needed to prevent block
construction from re-inferring pairing:

```ts
interface AlignedReplacementRow {
    left?: string;
    right?: string;
    correspondence?: {
        score: number;
        confidence: 'high' | 'contextual';
    };
}
```

Production rendering does not need to expose numeric scores. Tests and
diagnostics should be able to distinguish:

- a deliberately accepted counterpart;
- a left/right row that exists only for visual alignment; and
- two unpaired one-sided rows.

If the existing presence of both `left` and `right` already guarantees
accepted correspondence after the matcher fix, keep the smaller current
contract and expose diagnostics through a test-only helper.

### 5. Keep consumers consistent

Use the refined blocks and alignments everywhere the shared diff model is
built:

- two-way file comparisons;
- multi-panel comparisons;
- stacked and deconstructed tours;
- worker recomputation;
- synchronous fallback; and
- editable comparisons.

Verify consumers rather than changing their product semantics:

- change navigation visits each refined block in source order;
- connectors bind only credible paired regions;
- copy-across uses exact source ranges;
- synchronized scrolling uses paired rows and placeholders consistently;
- inline highlights never appear on green one-sided lines; and
- block-edge decorations do not visually join blue and green regions.

## Scope and non-goals

Required:

- regression fixtures for the committed Markdown comparison;
- conservative line-pair eligibility;
- alignment-derived block partitioning;
- blue styling only for accepted counterparts;
- green styling for unpaired content inside coarse replacement hunks;
- host/worker parity and consumer regression tests.

Supporting:

- test-only scoring diagnostics;
- focused visual snapshots or manual comparison notes;
- documentation of the blue-versus-green semantic contract.

Not in scope:

- changing the blue or green palette;
- introducing separate addition and deletion colors;
- syntax-aware or language-specific matching;
- moved-code detection outside the coarse hunk;
- N-way correspondence across three or more panels;
- many-to-many split or join matching;
- redesigning connectors, navigation, copy, or synchronized scrolling;
- changes to the unified tour zoom-mode proposal.

## Delivery sequence

1. Capture the fixture's exact false matches.
2. Add minimal alignment and block-classification fixtures for each failure.
3. Partition coarse replacement candidates from accepted alignment rows.
4. Tighten only the scoring paths implicated by the fixtures.
5. Apply the refined model through worker and synchronous rendering.
6. Verify decorations and downstream range consumers.
7. Reopen the committed Markdown comparison and confirm its green → blue →
   green classification.

## Validation

Automated coverage:

- a coarse replacement candidate with no accepted pairs becomes one deletion
  block plus one insertion block;
- mixed matched and unmatched rows split into ordered blue and green blocks;
- unrelated prose headings, list items, and paragraphs remain unpaired;
- genuinely edited prose and code lines remain paired;
- inline segments exist only for accepted pairs;
- empty files, trailing newlines, uneven hunks, and large bounded hunks retain
  correct source ranges;
- worker and synchronous models are identical;
- navigation, connectors, copying, and scroll maps consume the refined ranges;
- existing matcher corpus and performance budgets still pass.

Manual verification:

```sh
node ./bin/bygone.js --diff "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/replacement-block-before.md" "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/replacement-block-after.md"
```

The middle list item should be blue. The first and last list items should be
green one-sided regions.

## Acceptance criteria

- Neither unrelated outer fixture line is shown as a blue counterpart.
- A line receives blue whole-line or inline styling only when the diff model
  records an accepted counterpart.
- Coarse replacement hunks with little or no credible correspondence are
  predominantly or entirely green.
- Mixed hunks can contain separate blue and green regions without incorrect
  ranges or joined edges.
- Existing high-confidence code and prose edits remain blue.
- Worker and synchronous paths produce identical alignment, blocks, and
  decorations.
- The fix changes classification and matching, not source content, edit state,
  or the color palette.
