# Bygone Dynamic Multi-Panel Plan

This note scopes dynamic multi-panel diffing as a first-class compare mode with panel add/remove support and a minimum of one panel.

The goal is not “three-way, but more.” The goal is a coherent N-panel compare mode whose navigation, copy semantics, and host behavior remain predictable as panels are inserted and removed.

## Summary

Add a dynamic multi-panel compare mode that supports:

- `1..N` file panels
- adding a panel to either side of the active panel
- removing the active panel
- adjacent-pair diffing only
- active-pair-based change navigation and copy

For the first pass:

- multi-panel remains read-only
- no history mode
- no directory mode
- no arbitrary non-adjacent pair selection
- no drag-to-reorder

## Product Model

### Core objects

Dynamic multi-panel needs two separate selections:

1. `active panel`
2. `active pair`

This distinction is required because:

- file navigation is panel-scoped
- change navigation is pair-scoped
- copy is pair-scoped
- connector highlighting is pair-scoped

Without an explicit active pair, `prev/next change` and `copy left/right` are ambiguous once there are more than two panels.

### Minimum 1 panel

The mode should remain valid with one panel.

`1 panel` means:

- render the same multi-panel shell
- no gutters
- no connectors
- no pair-scoped actions
- read-only editor
- toolbar remains visible, but pair actions are disabled

This avoids special-casing the mode into a different product surface.

### Adjacent pairs only

For `N` panels, diffs are only computed between adjacent panels:

- `0 ↔ 1`
- `1 ↔ 2`
- `2 ↔ 3`
- etc.

This keeps the geometry legible and preserves the current gutter model.

Non-adjacent pair comparison is explicitly out of scope for the first implementation.

## Interaction Model

### File navigation

In multi-panel mode, `Prev File` and `Next File` should move the active panel left or right within the current panel set.

They should not:

- open files outside the current set
- cycle globally through workspace files
- switch pairs directly

This keeps file navigation local to the visible compare context.

### Change navigation

`Prev Change` and `Next Change` operate within the active adjacent pair only.

They should not:

- jump across multiple gutters
- flatten all pair diffs into one global sequence

A global cross-pair hunk order would be hard to explain and hard to trust.

### Copy semantics

`Copy Left` and `Copy Right` are relative to the active pair only.

For example, if the active pair is panel `1 ↔ 2`:

- `Copy Left` means “apply current change into panel 1”
- `Copy Right` means “apply current change into panel 2”

For the first pass, these actions should remain disabled because the multi-panel mode stays read-only.

The semantics should still be modeled now so the UI and state shape do not need to change later.

### Panel add/remove

Required operations:

- add panel to left of active panel
- add panel to right of active panel
- remove active panel

If removing the active panel leaves:

- `N >= 2`: choose the nearest surviving panel as active
- `1`: remain in multi-panel mode with one panel
- `0`: disallow removal

Minimum panel count is therefore `1`.

### Active pair fallback rules

When pair structure changes:

- if the previous active pair still exists, preserve it
- otherwise prefer the pair adjacent to the active panel
- otherwise clear the active pair if only one panel remains

This avoids arbitrary jumps in toolbar state.

## UI Plan

### Shell

Reuse the existing multi-panel shell:

- panel headers
- inter-panel gutters
- shared connection canvas

Add:

- active panel styling in the panel header
- active pair styling in the gutter
- add/remove affordances in headers or gutters

### Toolbar behavior

The top control strip should remain visible in multi-panel mode.

Behavior by panel count:

- `1 panel`
  - file nav enabled only if a later add/remove workflow makes movement possible
  - change nav disabled
  - copy disabled
  - position indicator shows `—`
- `2+ panels`
  - file nav uses active panel
  - change nav uses active pair
  - copy remains disabled in v1, but positioned and labeled according to active-pair semantics

### Header controls

Each panel header should eventually support:

- activate panel
- remove panel
- add panel to adjacent side

The first implementation can keep this simpler:

- activate panel from header click
- remove panel from header button
- add panel from gutter or edge button

The implementation should avoid duplicating controls in every possible place until the basic model feels correct.

### Gutter behavior

Each gutter corresponds to exactly one adjacent pair.

The gutter should own:

- active-pair state
- pair connector highlighting
- pair change navigation target

This is already close to the current renderer model, which is why adjacent-pair scope is the right first cut.

## Architecture Changes

### 1. Shared message model

Update [src/webviewMessages.ts](/Users/davmash/Git/melden/src/webviewMessages.ts):

- add stable `id` to `MultiDiffPanel`
- keep `label` and `content`
- optionally add `path`
- extend `ShowMultiDiffMessage` with:
  - `activePanelId?`
  - `activePairIndex?`

Add inbound events for:

- `multiSetActivePanel`
- `multiSetActivePair`
- `multiAddPanel`
- `multiRemovePanel`
- `multiReplacePanelFile`

Index-only identity is not robust once insertion and deletion are supported.

### 2. Webview runtime state

Refactor [media/script.js](/Users/davmash/Git/melden/media/script.js):

- replace the current stateless `showMultiDiff(panels, pairs)` behavior with persistent multi-panel session state
- track:
  - `multiPanels`
  - `multiDiffPairs`
  - `activeMultiPanelId`
  - `activeMultiPairIndex`

Required behavior changes:

- allow `panels.length === 1`
- stop treating multi-way mode as a pure one-shot render
- update toolbar state from active panel/pair
- update header/gutter chrome from active panel/pair

### 3. Shell rendering

Update [media/script.js](/Users/davmash/Git/melden/media/script.js) shell rendering so:

- panel DOM nodes are keyed by stable ids where possible
- active panel styling is applied to headers
- active pair styling is applied to gutters
- add/remove controls can be attached without rewriting the shell architecture later

The first pass may still rebuild the shell on mutation, but that should be treated as a temporary implementation, not the ideal steady state.

### 4. Connector rendering

Review [media/connectors.js](/Users/davmash/Git/melden/media/connectors.js):

- preserve arbitrary adjacent-pair rendering
- add active-pair emphasis
- ensure one-panel mode simply draws nothing

This area is already relatively well-positioned for N panels because it thinks in gutters and pairs rather than hardcoded left/right panes.

### 5. Host session model

Refactor standalone session handling in [standalone/main.js](/Users/davmash/Git/melden/standalone/main.js):

- replace fixed multi-file launch assumptions with mutable session state
- keep an ordered panel array
- recompute adjacent diff pairs after:
  - add
  - remove
  - replace

The host should be the source of truth for panel contents and pair diff models.

### 6. VS Code host surface

Update [src/fileComparator.ts](/Users/davmash/Git/melden/src/fileComparator.ts):

- generalize `compareThreeFiles()` into a real multi-file compare flow
- support arbitrary file counts for the multi-panel mode
- keep legacy three-file entry points only as compatibility aliases if needed

The extension command surface should not keep implying that the feature is inherently “three-way” once the renderer supports N panels.

### 7. CLI surface

Update standalone launch parsing in [standalone/main.js](/Users/davmash/Git/melden/standalone/main.js):

- replace `--diff3` with a general multi-panel launch form

Reasonable options:

- `bygone --diff a b`
- `bygone --diff a b c d`

or:

- `bygone a b c d`

The first option is clearer and easier to evolve.

## Implementation Order

### Phase 1: Make the model valid

1. Support one-panel multi-way sessions
2. Introduce active panel state
3. Introduce active pair state
4. Keep toolbar visible with correct disabled states

This phase should not add panel mutation yet. It should make the runtime semantically correct first.

### Phase 2: Add dynamic mutation

1. Add panel insertion
2. Add panel removal
3. Recompute adjacent pairs after mutation
4. Preserve active panel/pair when possible

This phase makes the mode dynamic.

### Phase 3: Generalize entry surfaces

1. Standalone CLI supports arbitrary panel counts
2. Standalone menus support add/remove panel
3. VS Code command flow supports true multi-file compare

This phase exposes the new capability broadly.

### Phase 4: Polish

1. Active gutter emphasis
2. Better header controls
3. Better editor reuse across shell mutations
4. Optional future editability model

## Explicit Non-Goals For V1

- editing in multi-panel mode
- drag-to-reorder panels
- history-backed multi-panel mode
- directory-backed multi-panel mode
- global cross-pair change traversal
- non-adjacent pair diffing
- merge conflict resolution semantics

These are all plausible later, but they should not shape the first implementation.

## Risks

### Editor lifecycle churn

If add/remove rebuilds every Monaco instance, the feature will work but feel heavy and potentially glitch focus and scroll state.

This is acceptable for a first pass only if the implementation is cleanly isolated and easy to improve.

### Ambiguous focus

Users need to be able to tell:

- which panel is active
- which gutter pair is active

If either is unclear, the controls will feel arbitrary.

### Toolbar overload

Multi-panel mode can become confusing if file-nav, change-nav, and copy are not explicitly scoped.

That is why this plan keeps:

- file navigation panel-scoped
- change navigation pair-scoped
- copy pair-scoped

### Scope creep

Adding dynamic panels will naturally tempt:

- reorder
- editability
- saved layouts
- history overlays

Those should be resisted in the first implementation.

## Success Criteria

The first implementation is successful if:

- one panel renders cleanly in the multi-panel shell
- panels can be added and removed without breaking the session
- active panel and active pair are visually obvious
- adjacent connectors remain correct after mutation
- toolbar actions remain predictable
- the mode no longer feels like a special-case three-file prototype

## Recommendation

Implement this as a dynamic, read-only, adjacent-pair compare mode first.

That yields a coherent product surface with manageable complexity and preserves the current connector model. Once that is solid, editability and deeper git integration can be evaluated on top of a stable state model rather than folded into the same first pass.
