# Alternating comparison colors

## Status

Shelved, 2026-10-15. Retained for possible reconsideration; not queued for build.

## Idea

Assign alternating blue/violet colors to successive adjacent **comparisons**.
In a middle panel, a span changed against both neighbors uses a horizontal
top/bottom split: the earlier comparison on top, the later comparison below.
This is not a left/right split and does not use underlines. Connector colors
match their comparison. Focus selected pair reduces the view to one blue pair.

## Why it was shelved

The extra color and sliced text made dense prose distracting. The selected
[blue union with optional pair focus](../plans/multi-panel-highlight-union.md)
communicates “this changed” with less visual work. Ownership remains available
on demand instead of competing with reading at every word.

## When to revisit

Revisit if real use shows repeated focus toggling is costly or readers routinely
misattribute a middle-panel change. Compare against blue union on identical
long, messy edits, with both themes and realistic widths. Check readability,
color-vision differences, more than three panels, and overlapping editor states.
Retain the horizontal split as a candidate, not an assumed requirement.
