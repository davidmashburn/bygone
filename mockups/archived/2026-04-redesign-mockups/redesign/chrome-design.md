# Bygone chrome design

Derived from `state-model.md`. Minimum set of controls to serve the L1 × L2
axes without the current collisions, targeting N = 2 at L1 and two-ref /
history at L2.

## Principles

1. **One row of chrome per surface**, not four. The current 4-row header is
   the single biggest source of noise; collapsing it is the biggest win.
2. **Per-pane state on the pane header, per-scope state on the top bar.**
   Ref, kind, writability, focus, buffer state → pane header. Scope label,
   within-scope navigation, overflow → top bar.
3. **Keybindings first, toolbar second, overflow menu third.** Anything on
   the toolbar has to earn its spot by being clicked often enough to justify
   the pixels.
4. **Make implicit state visible.** Focused pane, writability, ref kind,
   and copy target should never require a user to infer them.
5. **Copy is two buttons in the center column**, flanking the gutter: **Copy →**
   (left pane as source, arrow on the **inner** edge points right) and **← Copy**
   (right pane as source, arrow on the inner edge points left). The direction
   whose **target** is not writable is **disabled**. When nothing is writable,
   both disabled.

## Chrome anatomy

Three horizontal bands, all ~24–40px tall:

```
┌─ top bar (3 columns) ────────────────────────────────────────────────┐
│ [scope] [breadcrumb]    [Copy→] [←Copy] (center)    [actions] ⋯  │
├─ pane headers ─────────────────────────────────────────────────────┤
│ [ref label + kind] [SHA]  ⇄  [ref label + kind] [write ●] [SHA]    │
├─ content (panes with existing diff gutter connectors) ─────────────┤
│                                                                    │
├─ status bar ───────────────────────────────────────────────────────┤
│ change 3/19 · Ln 46 · UTF-8 · LF      F7/⇧F7 · ⌘←→ · [/] · ⌥↵ copy    │
└────────────────────────────────────────────────────────────────────┘
```

## Top bar per scope

**Three columns** on a single row: `left` (scope + breadcrumb) · `center`
(optional **two Copy** buttons — same pair in file and history) · `right`
(scope actions) · `⋯` overflow. Grid: `1fr` · `auto` · `1fr` so the center sits
on the **diff gutter** when the window is two panes.

### File diff

- **Left**: `File` badge, path breadcrumb.
- **Center**: **two buttons** — `Copy` with **→** toward the gutter (L→R),
  and **←** toward the gutter + `Copy` (R→L). Primary/emphasis on whichever
  direction is valid under L2 (often only L→R). Tooltips name source and target.
- **Right**: `↑` / `↓` change nav · `⋯`
- Overflow: collapse unchanged, ignore whitespace, sync scroll, wrap, line
  numbers, diff algorithm, go to line.

### Directory diff

- **Left**: `Directory` badge, path breadcrumb.
- **Center**: empty (keeps the same grid as other scopes; gutter isn’t
  file-level here).
- **Right**: **icon-only** tree actions with **`title` tooltips**, then
  `Open → Diff` · `⋯`. Icons are **Lucide** SVG files from
  `mockups/redesign/icons/lucide/` (see gallery in `mockups/redesign/icon-options.html`).

  **Chosen set — Option A (outline):**

  | Slot | Lucide file | Tooltip idea |
  |------|-------------|----------------|
  | Expand all | `chevron-down.svg` | Expand all folders |
  | Collapse all | `chevron-right.svg` | Collapse all folders |
  | Hide unchanged | `list-filter.svg` | Hide unchanged paths — show differences only |

- Overflow: include staged, include untracked, follow renames, ignore
  whitespace.

### File history

- **Left**: `History` badge, path breadcrumb, position `12 / 86`.
- **Center**: same **two Copy** buttons; **both** `disabled`; tooltips explain
  no writable pane.
- **Right**: `← Older` / `Newer →` · `Staged` · `⋯`
- Overflow: jump to commit…, follow renames.

## Pane headers

One row per pane, flanking a divider with the swap control.

```
┌────────────────────────────────────────┬────────────────────────────────────────┐
│ main [branch]  4653c81 · 2d · D.M.     ⇄  working tree [writable ●]  unsaved ●  │
└────────────────────────────────────────┴────────────────────────────────────────┘
```

Each pane header carries:

- **Ref label**: the user-visible ref (`main`, `HEAD~1`, `4653c81`,
  `working tree`, `staged`, etc.). Click to open the ref picker.
- **Ref kind chip**: `branch`, `commit`, `tag`, `working tree`, `staged`,
  `untracked`. Makes `HEAD~1` and `working tree` visibly different.
- **Writability dot**: present only when the pane is writable. Colored fill
  when there's an unsaved buffer, hollow when clean.
- **Commit metadata** (if the ref resolves to a commit): short SHA, relative
  time, author — compact, single line, optional.
- **Focus indicator**: a 2px accent line on the outer edge of the focused
  pane, matching Bygone's existing paired-blue. Persistent, never hidden.

Swap `⇄` lives between the two headers; for N = 2 it's a simple flip.

## Status bar

Thin (22px) footer, always visible, always the same shape across scopes:

- **Left**: current position — `change 3/19 · Ln 46, Col 24`.
- **Middle**: context hints — file encoding, line endings, branch.
- **Right**: keyboard hints for the current scope — `F7/⇧F7 next change ·
  ⌘←→ copy · [/] sibling file`.

Keyboard hints replace the current floating `Why.` block under the toolbar.

## Copy model

L2 forces copy to be asymmetric — target is at most one (usually
working tree). Chrome reflects that:

- **Action**: two verbs — **Copy →** (into right pane) and **← Copy** (into
  left pane). Arrows sit on the **edges toward the gutter**. Hotkey `⌘→` /
  `⌘←` when that direction’s target is writable.
- **Disabled** per direction when the **target** pane is read-only; **both**
  disabled when neither side is writable (e.g. history).
- **Granularity**: defaults to current change. A selection (line range)
  narrows scope automatically; a "Copy file" appears in the overflow menu.
- **Visual cue**: writable pane's header shows the writability dot; which
  of the **two** center buttons is enabled mirrors which target is writable.
  Source pane's focused change is highlighted on hover/focus.
- **Pure-L1 mode** (no L2 overlay, two writable files/dirs): **both**
  directions can be enabled.

## Focused pane

Three reinforcing signals so focus is never a guess:

1. **2px accent edge** on the outer side of the focused pane (blue, matching
   the paired-line accent already in use).
2. **Pane header tint**: focused pane header gets a slightly lighter
   background (same delta as VS Code's focused editor group).
3. **Cursor visibility**: normal blinking caret in the focused pane only.

`Tab` toggles focus between panes. Clicking inside a pane focuses it.

## Keybindings (draft)

Grouped by what the user is trying to do, annotated with the axis they
serve. Focus-sensitive bindings are marked `*`.

| Intent                     | Binding        | Axis                   |
|----------------------------|----------------|------------------------|
| Next change                  | `F7` / `↓`*    | L1.3 within-view       |
| Prev change                  | `⇧F7` / `↑`*   | L1.3 within-view       |
| Next / prev line           | `↓` / `↑`*     | L1.3 cursor            |
| Sibling file on disk       | `[` / `]`      | L1.3 sibling           |
| Next / prev changed file   | `⌘↓` / `⌘↑`    | L1.3 + L2 "changed"    |
| Toggle pane focus          | `Tab`          | L1.3 focus             |
| Copy change to working tree  | `⌘→` / `⌘←`    | L1.4 + L2 coupling     |
| Save working tree pane     | `⌘S`           | L1.4 save              |
| Revert working tree pane   | `⌘⇧Z` (edit)   | L1.4 revert            |
| Older / newer (history)    | `[` / `]`      | L2.4 history           |
| Open ref picker (focused)  | `⌘R`           | L2.3 change ref        |
| Swap panes                 | `⌘⇧X`          | L2.3 swap              |
| Overflow menu              | `⌘;`           | overflow               |

Collision to resolve: `[` / `]` is both sibling-on-disk (file diff) and
older/newer (history). Safe because the scopes don't overlap — sibling
nav is undefined in history mode — but worth confirming that's the right
call rather than using different keys.

## What's not on the toolbar

Moved to overflow or keybinding-only:

- All view flags (collapse unchanged, ignore whitespace, sync scroll, word
  wrap, line numbers, diff algorithm).
- `includeStaged`, `includeUntracked`, follow-renames.
- Jump-to-line, jump-to-commit.
- Revert / discard.

Rationale: these are set once per session (or once ever) and then
forgotten. Toolbar real estate belongs to the actions a user hits
repeatedly during a single comparison.

## What's not designed yet

- Ref picker UI (click a ref label → what opens? fuzzy input? list? tree?).
- Overflow menu contents and ordering.
- Empty / error / loading states (enumerated in state-model.md §L1.6–1.7).
- Visual detail of the ref-kind chips (color, border, typography).
- Exact accent colors for focused-pane edge vs paired-line highlight (they
  need to be distinguishable).

## Next steps

1. Mock each scope's chrome against this spec, replacing today's 4-row
   header with the single-row + pane-header + status-bar arrangement.
2. Resolve the ref-picker question — it's the only remaining piece large
   enough to affect the top-bar layout.
3. Pick concrete colors / typography for the ref-kind chip and focus edge.
4. Revisit against the existing `media/style.css` tokens so the chrome
   change doesn't drag the rest of the CSS with it.
