---
author: David Mashburn
created_at: 2026-04-29T18:15:00Z
modified_at: 2026-04-29T18:15:00Z
generated_by: Codex
generated_for: David Mashburn
reviewed_by:
approved_by:
---

# UI Archive Record and Top 10 Changes

## Archived

- From: `mockups/redesign/`
- To: `mockups/archived/2026-04-redesign-mockups/redesign/`
- Included:
  - `chrome-mockup.html`
  - `chrome-design.md`
  - `state-model.md`
  - `current-state.html`
  - `redesign-visual-language.html`
  - `icon-options.html`
  - `icons/` (including Lucide SVGs)

Supporting docs:

- `mockups/README.md` explains new work should track `standalone/` and `media/`.
- `mockups/archived/2026-04-redesign-mockups/README.md` explains archive scope and purpose.

Note:

- Standalone specs (`copy-jump-controls.html`, `navigation-shell-implementation-spec.md`, `n-panel-diff-visual-options.html`) remain under `mockups/`.

## Top 10 Impactful Changes for Current UI

1. Collapse header vertical stack to reduce pre-editor height.
2. Move `change-hint` out of nav row into a thin status strip (or reduce to shortcut-only help).
3. Directory tree toolbar: shorten and iconify controls.
4. Make copy controls asymmetric and more obviously directional.
5. Increase visual priority of `Next change` over sibling navigation.
6. Reduce duplicate commit identity between history toolbar and pane headers.
7. Add sustained focused-pane treatment in file header chrome.
8. Couple edit mode state more directly to writable pane.
9. Reduce `context-bar` hierarchy overload; prioritize location first.
10. Add persistent novice affordance for open/drag-drop path in empty states.

Minimal next iteration focus from the prior recommendation: `1`, `3`, and `7`.
