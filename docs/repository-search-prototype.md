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

Development and benchmarks currently use a detected system `rg`. Do not expose
repository search as a core feature until one of these contracts is chosen:

1. Bundle verified, signed ripgrep binaries for every supported desktop target
   and maintain their license/provenance/security updates.
2. Require a system executable and provide clear capability, version, setup,
   and unsupported-state guidance.
3. Add a compatible fallback only with tests proving its regex, ignore, hidden,
   symlink, binary, Unicode, and cancellation behavior matches the advertised
   contract.

Silent fallback to a different search language is not acceptable.

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
