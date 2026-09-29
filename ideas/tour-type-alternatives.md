# Tour types and navigation alternatives

## Status and context

Preserved alternatives from the tour navigation discussion. These are options to
revisit, not an implementation backlog or a claim that every option was rejected.
The discussion establishes the product choices; the earlier
[unified tour zoom plan](../plans/unified-tour-zoom-modes.md) records the more
ambitious mapping behavior we moved away from.

The resulting implementation is commit
[`2b5add9`](https://github.com/davidmashburn/bygone/commit/2b5add94769bf5fc4c22d89f60be07886913a4b7),
on `feat/tour-modes-and-directory-overviews`, integrated into `main` by
`e506b60`. Version 3 authoring and the shared History/Compare workspace have
since extended it. The alternatives below preserve the discussion at that point.

## Where we landed

There are four distinct reader activities, grouped by whether they are guided:

| Activity | Current name and purpose |
| --- | --- |
| Explore actual chronology | **History**: browse Git history and open point-to-point comparisons. |
| Inspect a result without explanation | **Compare**: compare chosen endpoints; Final diff is a convenient base-to-head preset. |
| Explain actual evolution | **Historical tour**: authored narration over real revisions, including updates, reversals, and decisions. |
| Explain in a constructed order | **Deconstructed tour**: authored narration over synthetic cumulative stages. |

Historical and Deconstructed can be authored independently within one tour
source. Directory comparisons are evidence within an Overview, rather than
another top-level tour type. An Overview uses stable endpoints; opening a file
keeps its narration and saved step, with `Overview › file path` providing the
return route.

## Alternatives worth retaining

### A third authored tour: explain the final result

**Variation:** one file contains three authored narratives: actual history,
conceptual deconstruction, and an explanation of the final base-to-head result.
The user explicitly raised “3 tours in one file” while questioning the boundary
between Revisions and Final diff.

**What it adds:** a concise account of what survives in the finished change,
without explaining every iteration or constructing intermediate stages. It
answers “what am I approving?” while the Historical tour answers “how and why
did this change along the way?” A reverted approach belongs in the latter and
may disappear entirely from the final diff.

**Why it did not become another default mode:** a final comparison and a final
narrative are different things. Giving Final diff its own privileged mode mixed
those concerns and overlapped with ordinary two-way comparisons. The chosen
flow made comparisons general and kept two explicitly named guided modes.

**What remains open:** this does not establish that a third narrative is
unnecessary. A normal two-way walkthrough remains a useful representation; a
separately selectable third narrative in the same file was not added by this
work. Revisit it if authors have a distinct final-result explanation that fits
neither the historical account nor the constructed sequence.

### One story with progressively deeper views

**Variation:** treat Final diff, Revisions, and Explanation stages as successive
levels of the same story. Switching representation would carry the reader to
the corresponding concept or source range.

**What it adds:** a short explanation could expand into real revision detail or
a finer teaching sequence without making the reader locate the concept again.

**Why we moved away:** reliable correspondence is the hard part. A final change
may combine several revisions; a real revision can contain several concepts;
a reversal can have no surviving final hunk. Synthetic stages need not follow
Git chronology. The user specifically questioned “how much cross-comparison
mapping can be reliable.”

**What survived:** shared presentation and saved per-mode positions. We did not
make dependable semantic correspondence between independently authored tours
a prerequisite for navigation.

**Revisit condition:** a narrow, explicitly authored correspondence that can be
validated. Do not revive broad automatic mapping merely because paths or line
numbers happen to match. Author-provided correspondence is a possible future
experiment, not a decision already made in this discussion.

### Collapse Revisions and Final diff whenever there are only two endpoints

**Variation:** omit Revisions when it renders the same two panes as Final diff.
The earlier zoom plan explicitly described this collapse, and the user pointed
out the apparent duplication.

**What it gets right:** duplicate raw comparisons should not require duplicate
navigation choices.

**Why the rule was insufficient:** panel count does not determine the reader's
purpose. A two-way Historical tour can still explain why a revision happened;
a plain comparison has no such narrative. Conversely, substantive stacked-PR
history needs explanation precisely because something was updated or reverted.

**What survived:** consolidate the raw comparison experience, while retaining a
separate guided historical account. Do not collapse away an authored narrative
solely because its current evidence has two endpoints.

### Final diff as a special destination

**Variation:** make Final diff a permanent peer of History and the tour modes.

**What it adds:** a very obvious route to the complete net result.

**Why we moved away:** the same reader may want base-to-intermediate,
intermediate-to-head, or another point-to-point comparison. Opening those from
History makes the final comparison one useful case of a general operation.

**What survived:** Final diff remains a convenient preset in Compare. Its
shortcut value was retained; its special status as a separate mode was not.

### Revisions as an inspection view, with explanation concentrated elsewhere

**Variation:** use Revisions mainly to expose real panels, while putting the
primary narrative in a final-result or deconstructed tour.

**Why this was a poor fit:** the user's central use case is stacked PRs with
substantive evolution that needs color: “this was reverted,” “this was updated,”
and why. Those facts can be invisible in the final state and should not depend
on a synthetic teaching sequence to receive explanation.

**Result:** actual revision history earned its own authored **Historical tour**.
The real-revision capability was preserved and made more explicit, rather than
removed along with the old Revisions label.

### A directory Overview that follows the saved step

**Variation:** narrate a directory comparison for whichever adjacent revision
or synthetic stage pair the saved step currently selects. This was tried in the
local implementation before being changed.

**What it adds:** a quick view of the files affected by the current stage.

**Why we changed it:** returning to the same Overview could show a different
tree beneath unchanged narration. That makes an overview's scope difficult to
predict and can detach the explanation from its evidence.

**What survived:** stable Overview comparisons, defaulting to the scene's first
and last panels, with explicit authored endpoints for a narrower range.

**Potential future use:** a clearly labeled “Files in this step” view could
still make sense. That is a different promise from a scene Overview, and is not
part of the current implementation.

## Naming alternatives and the distinction to preserve

**Revisions**, **Explanation stages**, **Real changes tour**, and **Artificial
changes tour** appeared during the discussion. The user favored **Deconstructed**
for the synthetic explanation; the resulting pair is **Historical tour** and
**Deconstructed tour**. “Explanation stages” can still describe the internal
stages without being the tour's canonical name.

The durable distinction is actual chronology versus constructed explanation.
Synthetic intermediate states are teaching devices, not claims about commits
that happened. A directory view, two-way diff, or multi-panel diff describes
how evidence is displayed; it does not by itself define the narrative's purpose.

## Related records

- [Unified tour zoom modes](../plans/unified-tour-zoom-modes.md): earlier mode
  hierarchy, collapse rules, and mapping ambitions. Read its shipped status as
  history of that implementation, not as the specification for `2b5add9`.
- [Multi-panel diff tours for stacked PRs](../plans/multi-panel-diff-tours-for-stacked-prs.md):
  the substantive real-revision use case.
- [Deconstructed diffs](../plans/deconstructed-diffs.md): the synthetic evidence
  model and its limits.
