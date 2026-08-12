# Search scopes and semantics

Bygone uses the engine that owns each source. This keeps unsaved editor text,
filesystem state, Git snapshots, and compiled tours accurate without pretending
that their regex dialects or lifecycle rules are identical.

| Scope | Engine/source | Options | Limit and freshness | Result behavior |
| --- | --- | --- | --- | --- |
| Active pane | Monaco model | Monaco Find options | Current in-memory model | Selects in the active pane; Replace only when writable |
| Visible or all panels | Monaco models | Literal/regex, case | 500 current in-memory matches | Selects the exact loaded panel and range |
| Current change set | Materialized session snapshots | Literal/JavaScript regex, case | 500 matches per request; rebuilt on request | Opens the changed file comparison and exact side |
| File Git history | Materialized Git parent/commit blobs | Literal/JavaScript regex, case; content or introduction/removal | 500 matches per request; tied to loaded history | Opens the exact revision pair and base/head side |
| Search in Files | System ripgrep 14+ | Literal/ripgrep regex, case, whole word, include/exclude globs, hidden and ignore policy | User-selected 100–5,000; cancellable; file revalidated before open | Opens a read-only source panel at the exact working-tree line |
| Authored tour | Compiled manifest narrative and base/head snapshots | Case-insensitive literal; narrative/code scope | 300 manifest matches | Opens the exact scene/step or code side and preserves Return to tour |

## Deliberate differences

- Broad JavaScript-backed snapshot searches are line-oriented. Their regular
  expressions do not span lines. Zero-length matches advance safely.
- Search in Files uses ripgrep syntax and ignore behavior; Bygone does not
  silently substitute JavaScript regular expressions when ripgrep is missing.
- Tour search is intentionally literal and case-insensitive so presenter
  navigation stays lightweight and predictable.
- Whole-word matching is currently a ripgrep/Monaco capability, not a promise
  made by every snapshot adapter.
- Binary contents, OCR, submodules, remote workspaces, Git blobs outside the
  loaded history, and unsaved Monaco text are not filesystem-search inputs.

## Provenance and stale results

Every scope keeps the identity needed by its owner: panel and range, changed
file side, history entry and revision side, filesystem path and coordinates,
or tour scene/step/file side. Filesystem result paths must remain within the
selected real root, must have been emitted by the active request, and are
rejected if the file changed after the search began. Superseding or closing a
filesystem search cancels the ripgrep process and ignores late batches.

## Performance fixtures

All committed fixtures are generated locally from Bygone-owned text. Run:

```bash
npm run perf:search
npm run perf:search-adapters
```

The repository benchmark covers 4,000 generated files. The adapter benchmark
covers 120 change-set snapshots, 250 history revisions, and a 120-file tour.
Each in-memory adapter has a deliberately generous 1,000 ms regression budget,
overridable with `BYGONE_SEARCH_ADAPTER_BUDGET_MS` for profiling.
