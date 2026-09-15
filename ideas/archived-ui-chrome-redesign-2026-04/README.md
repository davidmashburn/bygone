# Archived UI chrome redesign (April 2026)

This directory preserves an exploratory UI redesign that was implemented and
later removed on `refactor/pane-focus-cleanup`. It remains useful as design
evidence, not as a description of the current product.

The snapshot explored:

- consolidating the application header and navigation chrome;
- making pane focus, ref kind, and writability explicit;
- clarifying directional copy controls;
- simplifying directory-tree actions with icons; and
- separating the generic diff engine from its Git-specific state.

Start with [top-10-followups.md](top-10-followups.md), then read
[redesign/state-model.md](redesign/state-model.md) and
[redesign/chrome-design.md](redesign/chrome-design.md). The HTML files are
standalone visual prototypes. `current-state.html` records the April 2026
baseline and is intentionally historical.

The original implementation commits were `0581fd5` and `30ffd0e`; the later
cleanup checkpoint was `af9b2e8`.
