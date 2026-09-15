# Wrapped diff marker layout artifacts

## Summary

Investigate diff markers that fragment into unnecessary extra single-line
segments when long lines wrap. One observed case shows additional marker lines
for an inserted line above the wrapped content.

## Why it might matter

Word wrap is visual and must not create extra semantic changes. Fragmented
markers make the diff look noisier and may imply changes that do not exist in
the model.

This is a follow-up to the implemented [text wrap
plan](../plans/text-wrap-option.md), whose acceptance criteria require connector
geometry to settle correctly after layout.

## Open questions

- Is the artifact in gutter/line decorations, connector geometry, or both?
- Does it require unequal wrap counts between corresponding lines, an insertion
  immediately above, or a particular viewport width?
- Does the diff model remain correct while only its visual-row projection is
  wrong?

## Possible next steps

Create a minimal long-line fixture with a one-line insertion above it, capture
wrapped and unwrapped screenshots, and inspect Monaco model-line positions
against the marker geometry before choosing a renderer fix.
