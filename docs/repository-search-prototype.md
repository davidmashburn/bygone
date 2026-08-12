# Repository search prototype

Bygone contains an experimental host-side adapter for filesystem search using
`rg --json`. It is not yet exposed as a production repository-search command.

## Current contract

- The host passes an absolute root and structured options.
- The adapter spawns an executable with an argument array and `shell: false`.
- JSON lines are validated at runtime before becoming normalized matches.
- Result paths must remain inside the selected root.
- Result and stderr sizes are bounded.
- Cancellation and truncation terminate the child process.
- Unsaved editors, Git blobs, index content, tours, and synthetic stages are
  outside this filesystem adapter and require their owning source adapters.

## Distribution gate

Bygone has chosen a detected system `rg` for the experimental phase. It
requires ripgrep 14 or newer, uses `BYGONE_RG_PATH` as an explicit executable
override, and exposes **Help → Repository Search Status…**. Missing,
unparseable, and unsupported versions are explicit capability states. Bygone
does not silently use a different regex/search engine.

This keeps desktop packages small while the feature and update burden are
evaluated. Revisit the choice before advertising repository search as a
zero-setup core feature. The alternatives remain:

1. Bundle verified, signed ripgrep binaries for every supported desktop target
   and maintain their license/provenance/security updates.
2. Require a system executable and provide clear capability, version, setup,
   and unsupported-state guidance.
3. Add a compatible fallback only with tests proving its regex, ignore, hidden,
   symlink, binary, Unicode, and cancellation behavior matches the advertised
   contract.

Silent fallback to a different search language remains unacceptable.

## Open-source benchmark

Run:

```bash
npm run compile
npm run perf:search
```

The benchmark creates a temporary synthetic tree, searches literal and regex
queries, reports elapsed time and match counts, and deletes the tree. Adjust
its scale with `BYGONE_SEARCH_BENCH_FILES`. It must not be pointed at or seeded
from proprietary repositories for committed evidence.
