# Repository search prototype

Bygone exposes a read-only desktop **Edit → Search in Files…** workflow backed
by the host-side `rg --json` adapter. Choose an explicit root, enter a query,
and run the search; results stream into a bounded panel and open as read-only
single-panel source views at the exact matched line.

After a complete case-sensitive literal search, enter replacement text and
choose **Preview Replace**. The preview groups occurrences by file and allows
individual files to be excluded. Bygone confirms the selected totals, hashes
and revalidates every file before writing, uses atomic same-directory writes,
rolls back completed writes if a later write fails, and offers immediate Undo.
Undo is rejected if any replaced file changed afterward. Regex and
case-insensitive Replace in Files are intentionally unavailable because their
match semantics must not diverge from ripgrep search results.

## Current contract

- The host passes an absolute root and structured options.
- The adapter spawns an executable with an argument array and `shell: false`.
- JSON lines are validated at runtime before becoming normalized matches.
- Result paths must remain inside the selected root.
- Result and stderr sizes are bounded.
- Cancellation and truncation terminate the child process.
- A superseding query cancels the previous process and stale batches are ignored.
- Result navigation accepts only identities emitted by the active search,
  rechecks root containment and file type, and rejects files modified after
  the search began.
- Unsaved editors, Git blobs, index content, tours, and synthetic stages are
  outside this filesystem adapter and require their owning source adapters.

## Distribution decision

Bygone currently requires a detected system `rg`. It
requires ripgrep 14 or newer, uses `BYGONE_RG_PATH` as an explicit executable
override, and exposes **Help → Repository Search Status…**. **Search in Files…**
routes to that status when the capability is unavailable. Missing,
unparseable, and unsupported versions are explicit capability states. Bygone
does not silently use a different regex/search engine.

This keeps desktop packages small and makes availability explicit; repository
search is therefore an optional system capability rather than a zero-setup
core feature. The alternatives remain:

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
