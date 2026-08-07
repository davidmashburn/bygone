# Text wrap option

## Summary

Add a display option that lets readers wrap long lines within each diff pane
instead of requiring horizontal scrolling. Keep the current unwrapped display
available for readers who want line structure and indentation to remain
visually exact.

## Why it might matter

Long lines are difficult to review when a narrow window or multi-panel layout
leaves little horizontal space. Wrapping could keep the full line visible and
reduce repeated horizontal scrolling, especially when comparing several
revisions at once.

## Open questions

- Should wrapping be a global preference, a per-tour setting, or a temporary
  control for the current view?
- Should the preference persist between sessions?
- How should continuation rows align with line numbers, gutters, and inline
  change highlights?
- Should all panes wrap at the same width so corresponding lines remain easy
  to compare?
- How should wrapped lines interact with synchronized vertical scrolling and
  focused change ranges?
- Should authors be able to recommend a default while readers retain control?

## Possible next steps

- Prototype a reader-controlled toggle in two-way and multi-panel views.
- Verify that line numbers, diff backgrounds, inline highlights, and focused
  ranges render correctly across continuation rows.
- Test whether synchronized scrolling remains useful when corresponding lines
  wrap to different heights.
- Decide the default and persistence behavior after trying the option on
  narrow windows and long-line-heavy changes.
