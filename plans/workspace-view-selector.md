# Compact workspace view tabs

Status: Design direction accepted after interactive mockup; implementation pending.

## Outcome

Replace the boxed History, Compare, Historical tour, and Deconstructed tour
buttons with four visible text tabs. Put them and the revision context in one
compact toolbar. Keep the existing workspace title in its current place and
remove the duplicate title from this navigation area.

The benefit is less repeated chrome and less vertical space above the main
panel stack, while every destination stays visible and takes one click.
Do not add a dropdown, groups, nested modes, or another header row.

This refines the four-button strip in
[Shared workspace, tour discovery, and Open in History](shared-workspace-tour-discovery-and-history-bridge.md).
Its session preservation, editing safeguards, and prompt boundaries still apply.

## Evidence and design decision

Source inspected 2026-10-09 against main `8bdf0b4` plus existing working-tree
changes. Those ongoing changes are the observed baseline, not work performed
for this proposal.

- `media/workspaceControls.js` mounts four peer buttons. Available choices emit
  `workspaceMode`; missing tours open a prompt without changing views.
- `media/workspaceControls.css` makes the buttons expand and wrap.
- `media/script.js` and `web/host.js` mount the shared control. The web export
  disables omitted modes by querying rendered buttons directly.
- `standalone/workspaceHost.js` owns navigation, sessions, and unsaved-edit
  safeguards, and currently refuses navigation to absent tours.
- Hosts can override labels, including the legacy `Final tour` label.

The first proposal used a grouped dropdown. The user rejected the extra
interaction complexity. A visible-tab mockup made sense, but its additional
title row took too much vertical space. The accepted revision combines tabs
and revision context on one row and removes the repeated title.

The interactive source is [workspace-tabs.html](mockups/workspace-tabs.html).
The revised toolbar measured 32.5px tall at a 1024px desktop viewport. This is a
mock measurement, not a verified height in the actual app.

High confidence in the duplication and spacing diagnosis, supported by the
source and mock. Medium confidence in product fit until the shared control is
rendered in each host; crowded contextual controls or lost revision context
would require revising placement.

## Proposed interaction

```text
History   Compare   Historical tour   Deconstructed tour    main → working tree
───────
[existing main panel stack]
```

The active tab has one underline. Use product typography, compact spacing,
and native focus indicators. Keep all four labels visible at desktop widths.
Preserve identifiers `history`, `compare`, `historical`, and `deconstructed`,
host label overrides, and existing contextual actions.

### Selecting and preserving a view

- A tab selects its corresponding view. The selected underline follows the
  host-confirmed mode. Selecting the active tab does nothing.
- A cancelled unsaved-edit transition or failed load keeps the original view
  and selection. Preserve the current error/status surface.
- Reuse restoration of revisions, files, panel layout, comparison drafts,
  and tour positions. Do not add a second saved navigation selection.
- Preserve embedded-view behavior: the outer workspace owns navigation, so
  embedded tours must not render a duplicate tab row or title.

### Missing tours and exports

An absent tour in an authoring-capable workspace opens an empty view with the
tour's full name, a short explanation, and the existing supported actions:
Create tour… and Open existing tour…. It does not open the creation prompt
directly from the navigation tab.

Create tour reuses the kind-specific prompt dialog, including prompt drafts,
copy/reset behavior, skill-file support, and range warnings. It prepares a
prompt for the coding agent. Open existing uses the host's picker or upload
path. Dismissing either action leaves the empty view selected.

This requires a host change: selecting an absent authorable tour must be a
confirmed destination without loading nonexistent content. Keep navigation
guards and saved-session restoration coherent; do not simulate this only by
moving the underline in the shared control.

An unsupported view or a view omitted from an export remains unavailable with
an accessible reason. Do not turn an export omission into an authorable missing
tour, or expose actions that host does not support. Invalid content and failed
loads remain errors, not empty-tour states.

### Keyboard and responsive layout

- Use a labeled tablist, native buttons with `role="tab"`, `aria-selected`,
  `aria-controls`, and corresponding labeled tabpanels.
- Support arrow keys and Home/End for switching tabs; preserve visible focus
  and native focus order. Prompt dismissal restores focus to its action.
- At desktop widths navigation and revision context share one compact row.
  Wrap at narrow widths without truncating names or overlapping controls.
  Give touch targets adequate height on coarse pointers.
- Keep the title in its existing location; do not add branding or another
  title above the tab row to make this layout work.

## Implementation boundary

One frontend/navigation slice based on main:

1. Change shared markup and styling in `media/workspaceControls.js` and
   `media/workspaceControls.css` to text tabs. Fit the existing title/context
   arrangement in each host without introducing another row.
2. Add the missing-tour empty panel and reuse creation/open actions. Update
   native/web navigation and `standalone/workspaceHost.js` only where required
   to confirm the empty destination and preserve navigation guards.
3. Pass availability and supported-action information to the shared control.
   Adapt web export disabling to the final markup and state.
4. Adjust affected interaction selectors and assertions for tabs and empty
   views, preserving host state and session checks.

No tour schema or CLI changes, new dependencies, Git behavior changes, file-rail
or narration redesign, automatic generation/discovery, or window/session
architecture changes. Compare selected/Clear/Select displayed revisions remain
contextual actions outside this scope.

## Acceptance and verification

- Four visible text tabs replace the boxed strip in desktop workspace, browser
  presenter, and export viewer, without duplicating the workspace title.
- Desktop navigation and revision context occupy one compact row; the main
  panel stack gains vertical space compared with the previous mockup.
- Every available destination is reachable in one click. Confirmed selection,
  mode-specific position, submitted comparison, and revision-selection drafts
  survive switching away and back.
- Cancelled edit guards and failed loads preserve the original selection and
  content. Test saved-session reopening when a selected tour is absent.
- Missing authorable tours show their empty view; creation opens the correct
  prompt, preserves edited drafts, and restores focus on dismissal.
- Cover neither/one/both tours, non-Git comparisons, legacy label overrides,
  Minimal/Full exports, and embedded tours without duplicate navigation.
- Check keyboard navigation, screen-reader names/reasons, visible focus,
  light/dark appearance, and layout at 1280, 620, and 320 pixels.
- Run existing host/state tests and affected desktop/web/export smokes after
  implementation. Add focused assertions for missing-tour navigation and
  availability boundaries where existing coverage does not exercise them.

## Work performed and remaining checks

Planning records and source were inspected. The interactive mock was created
and refined in the project-planning worktree. All four mock tab transitions
were checked; the revised desktop toolbar was measured, visually inspected,
and checked for overflow at 320px. Planning whitespace checks passed.

No product code was changed. Actual host integration, screen-reader behavior,
and reader usability have not been verified. Builds, product tests, and runtime
smokes were skipped because the changes are planning and mockups only.
