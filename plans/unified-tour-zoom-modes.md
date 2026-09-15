# Unified tour zoom modes

## Goal

Let readers jump from an incremental explanation to the end result or Git
history, then return without losing their place. One **Mode** drop-down provides
direct access to every supported view; movement is not limited to adjacent modes.

Tours require the originating Git repository. Portable tours are out of scope:
packaging the necessary files and history can become prohibitively large.

## Which modes appear

The deepest representation authored anywhere in the tour sets its available
detail. Include every broader view, and collapse Revisions into Final diff when
both would compare the same two real endpoints.

| Authored tour | Modes |
| --- | --- |
| Deconstructed, with a distinct real stack | Explanation stages, Revisions, Final diff, Git history |
| Deconstructed, with only two real endpoints | Explanation stages, Final diff, Git history |
| Stacked, with three or more real panels | Revisions, Final diff, Git history |
| Regular two-way or two-panel stack | Final diff, Git history |

- Availability is tour-wide. A file, scene, or range without an exact counterpart
  never disables a mode.
- Never offer deconstructed stages unless they were authored.
- Explanation stages are synthetic; Revisions uses real Git revisions.
- Final diff compares the real base and head of the change, with explicit
  endpoint labels. Derived views need no invented narration.
- Keep the same switcher and presentation session when entering Git history.

A deconstructed tour is a regular tour plus explanation stages. It must include
an explicit authored stack of real revisions, with the same real endpoints as
its deconstruction. A two-endpoint stack is valid and collapses into Final diff.
The compiler must not infer a missing stack from Git history or synthetic stages.

## Switching and returning

Selecting a mode always enters it. Prefer the same file and corresponding source
range, then the nearest change in that file, then the nearest authored item or
the destination's first meaningful location. Follow renames and handle files
that exist on only one side. Explain a surprising fallback unobtrusively.

Each mode retains its scene/step/stage, file, panel pair or history revision,
focused range, scroll position, keyboard focus, and narration state.

- **Switch without navigating:** preserve the departure location. Returning
  restores it exactly, including through intermediate modes visited without
  navigation.
- **Navigate before switching:** map from the newly selected location. Navigation
  includes changing a file, step, stage, panel pair, revision, focused change, or
  intentionally scrolling; automatic landing and focus restoration do not count.
- Use a mode's saved location when no useful mapping exists. A fallback landing
  must not erase the saved location unless the reader navigates there.
- Switching alone never advances narration.

Example: jump from an explanation stage to Final diff and back to restore the
stage and viewport. If you inspect another file in Final diff, returning instead
finds the closest explanation for that file.

## Format and evidence

This is a breaking format change: bump both authored `.bygone` sources and
compiled `.tour.json` manifests from version 1 to version 2. Keep v1 readable on
the existing UI path; show the new control only for v2 tours. Unsupported versions
must produce an explicit error.

The v2 compiler should:

- derive and validate maximum authored depth from the scenes;
- require an explicit real revision stack for every deconstructed tour and
  validate that its endpoints agree with the explanation's real range;
- supply evidence for each distinct broader mode through Final diff;
- retain real endpoint IDs, repository identity, rename-aware paths, and stable
  locations for mapping between views;
- omit duplicate two-panel Revisions views;
- reject missing or ambiguous required evidence during compilation, rather
  than disabling modes as the reader moves around.

Reuse existing scene and file evidence where possible. Exact serialized fields
and mapping thresholds are implementation decisions.

## Repository and Git history

Git history queries the originating repository and can extend beyond the commits
embedded in a tour. “Trusted desktop/local” meant access to that repository; it
is not useful product terminology. Enter history near the active file and target
commit. If that commit does not touch the file, choose the closest preceding
file-history entry and disclose the fallback.

Resolve the originating repository before opening a v2 tour. If it is unavailable,
report that prerequisite rather than opening a partially functional mode switcher.
Compiled manifests may support local presentation, but are not self-contained
portable tours. The authored stack determines revision order, including the
chosen path through merge history.

## Implementation and verification

1. Add v2 parsing, validation, compilation, and authoring documentation.
2. Implement shared mode state, deterministic location mapping, and saved cursors.
3. Add the accessible drop-down and connect repository history to the same session.
4. Test all mode combinations, two-panel collapse, v1 UI compatibility, rename/
   create/delete cases, missing counterparts, and narration/focus restoration.
   Reject deconstructed tours with missing stacks or mismatched endpoints, and
   verify that v2 presentation requires a resolved repository.

Manually verify direct Explanation → Final diff → Explanation and Explanation →
History → Final diff → Explanation trips, both with and without navigation in
the intermediate views. Check that unmappable locations never disable modes or
destroy the departure cursor.

Beyond requiring the underlying regular tour, no expansion of deconstructed
authoring is required. Portable packaging, invented narrative, persistent cursors
across relaunches, and redesign of the file rail, search, or narration are out of
scope.
