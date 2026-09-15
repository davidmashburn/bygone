# Conservative replacement blocks

## Goal

Make Bygone's diff colors tell the truth about correspondence:

- blue means the old and new content are credible versions of the same line or
  block;
- green means content is present on only one side of the comparison; and
- unrelated content must not become a blue change merely because a deletion
  run is adjacent to an insertion run.

Two committed comparisons exercise different decisions.

### Coherent replacement: preserve blue, emphasize all changes

- [replacement-block-before.md](fixtures/replacement-block-before.md); and
- [replacement-block-after.md](fixtures/replacement-block-after.md).

The same heading, list structure, and nearly identical middle item support
treating this as one blue replacement block. The first and last items are
entirely rewritten and need strong emphasis across their changed text. They
do not automatically require separate green blocks. The current comparison
paints the three-line replacement blue; that alone is not a rendering defect.

### Unrelated sections: green, with a separate blue control

- [block-correspondence-before.md](fixtures/block-correspondence-before.md); and
- [block-correspondence-after.md](fixtures/block-correspondence-after.md).

The old cache-eviction section (left lines 3–6) is removed. The new
keyboard-shortcuts section (right lines 3–7) is added. Their heading, subject,
content, and structure differ; no substantive content establishes continuity.
Sharing a location in the document, heading punctuation, and a blank line is
insufficient evidence for blue correspondence. The intended classification is
green one-sided content on each side, without implying line counterparts.

The separate `Shared setting` section retains its subject and sentence,
changing only `beside` to `above` (left line 10, right line 11). It should stay
blue with precise inline emphasis. The title, shared headings, and closing note
remain unchanged.

Manual observation in the installed Bygone 0.8.14 app: the heading pair, the
two-line prose/three-item list body pair, and the shared-setting edit all render as
blue blocks, giving three changes. The unrelated body lacks strong text-level
emphasis while the small shared-setting edit is emphasized. This verifies the
current appearance; the expected green classification is the product policy
this plan proposes, not a consequence of the observed color itself.

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

- Blue blocks have credible correspondence as a whole; they may contain
  entirely rewritten or unmatched lines.
- Within a blue block, paired lines receive precise inline emphasis and
  unmatched changed lines receive emphasis across their changed text.
- Green identifies independent removed or added content when block
  correspondence is unsupported.
- Shared document position, punctuation, and blank lines alone do not justify
  a blue block. Retained substantive content and coherent structure can.
- Split a coarse replacement candidate when doing so clarifies independent
  changes, not mechanically at every unmatched line.
- Line pairing, block construction, connectors, change navigation, copy, and
  synchronized scrolling agree on the same correspondence decision.

## Proposed approach

### 1. Preserve the observed comparison as a regression

Use both committed Markdown pairs as end-to-end regression inputs. Also
represent their expected behavior as small table-driven unit fixtures
containing:

- the left and right source lines;
- the score and evidence that currently admit the pair;
- expected paired line indices;
- expected unpaired line indices;
- expected `replace`, `insert`, and `delete` block ranges; and
- expected changed-text emphasis, including unmatched lines in blue blocks.

Unit expectations encode the reviewed product policy. The Markdown comparisons
protect the rendered integration without depending on planning-document edits.

The line-numbered observation above records the new fixture's current behavior.
Recheck both comparisons when implementing; the coherent list is a control
against over-fragmenting blue replacements.

### 2. Separate coarse hunks from rendered blocks

Treat the adjacent removed and added runs returned by `diffArrays` as one
coarse replacement candidate, not as the final blue block.

Evaluate block correspondence separately from line pairing. A coherent block
can remain `replace` even when some of its rows have no counterpart. When the
candidate lacks substantive continuity, emit `delete` and `insert` regions.

Use neighboring unchanged context to understand boundaries, but do not count
blank lines or Markdown markers as substantive continuity. The new fixture
deliberately includes a shared blank line between unrelated headings and bodies;
neither resulting coarse candidate should inherit correspondence from it.

Keep the existing `DiffBlock` vocabulary if it can express these decisions.
Do not prescribe alternating blue/green regions for the original list fixture.
Choose the smallest block-evidence rule that satisfies both fixture policies,
and calibrate it against the existing corpus before fixing numerical thresholds.

### 3. Tighten correspondence eligibility

Inspect which line pairs, if any, the matcher actually accepts in the unrelated
sections. Blue block coloring alone does not establish a line-matching error.
If false pairs exist, evaluate them against the existing scoring paths:

- the informative singleton exception;
- ordinary eligibility at `MINIMUM_MATCH_SCORE`;
- contextual neighbor support;
- weak diagonal-run support; and
- large-hunk structural anchors.

For line pairing, add a minimum shared-content requirement if needed that
cannot be satisfied by position, similar length, Markdown punctuation,
headings, list markers, or common prose
tokens alone. A contextual neighbor may disambiguate between already plausible
candidates, but must not make an otherwise unrelated line pair eligible.
This constraint does not forbid those lines from belonging to a coherent blue
block; block membership and precise line correspondence are different decisions.

Retain syntax-agnostic scoring. Calibrate the smallest threshold or evidence
change that rejects the observed false pairs without breaking the existing
curated matches.

### 4. Preserve unmatched-line visibility

Do not use the absence of a line counterpart to omit changed-text emphasis
inside a blue block. Use precise inline differences where a credible pair
exists, and full changed-text emphasis where it does not. Verify the original
list fixture does not make the small middle edit look like the only change.

### 5. Make correspondence explicit at the alignment boundary

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

### 6. Keep consumers consistent

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
- connectors express credible block correspondence without claiming every
  contained line is paired;
- copy-across uses exact source ranges;
- synchronized scrolling uses paired rows and placeholders consistently;
- inline highlights never appear on green one-sided lines; and
- block-edge decorations do not visually join blue and green regions.

## Scope and non-goals

Required:

- regression fixtures for both committed Markdown comparisons;
- distinct block-correspondence and line-pairing decisions;
- block classification supported by substantive continuity;
- complete changed-text emphasis inside coherent blue replacements;
- green styling for independent removed and added content;
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

1. Record block classification, line pairing, and emphasis separately for both
   fixtures.
2. Add regression expectations for the coherent blue list and unrelated green
   sections, retaining the small blue edit as a control.
3. Implement block correspondence and unmatched-line emphasis.
4. Tighten only line-scoring paths implicated by verified false pairs.
5. Verify worker parity, decorations, and downstream range consumers.
6. Reopen both comparisons and check classification and emphasis independently.

## Validation

Automated coverage:

- unrelated sections become deletion and insertion regions;
- a coherent replacement containing unmatched lines can remain one blue block;
- unchanged punctuation or blank lines do not confer block correspondence;
- unrelated lines do not receive invented precise counterparts;
- genuinely edited prose and code lines remain paired;
- paired lines receive precise inline segments, and unmatched lines inside blue
  blocks receive full changed-text emphasis;
- empty files, trailing newlines, uneven hunks, and large bounded hunks retain
  correct source ranges;
- worker and synchronous models are identical;
- navigation, connectors, copying, and scroll maps consume the refined ranges;
- existing matcher corpus and performance budgets still pass.

Manual verification:

```sh
node ./bin/bygone.js --diff "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/replacement-block-before.md" "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/replacement-block-after.md"
```

The list can remain one blue block. The entirely rewritten outer items must
receive strong changed-text emphasis, alongside the precise middle edit.

```sh
node ./bin/bygone.js --diff "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/block-correspondence-before.md" "/Users/davmash/code/worktrees/bygone-project-planning/plans/fixtures/block-correspondence-after.md"
```

The removed cache section and added keyboard section should be green. The
shared-setting sentence should remain blue with only `beside`/`above` emphasized.
Do not hard-code a navigation count until the refined block ranges are settled.

## Acceptance criteria

- The unrelated cache and keyboard sections use green one-sided styling.
- The original coherent list can remain blue, with all rewritten text visible
  through changed-text emphasis.
- Blue block membership does not imply an accepted counterpart for every line.
- Separate blue and green regions have correct ranges and boundaries.
- Existing high-confidence code and prose edits remain blue.
- Worker and synchronous paths produce identical alignment, blocks, and
  decorations.
- The fix changes classification and matching, not source content, edit state,
  or the color palette.
