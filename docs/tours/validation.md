# Tour documentation validation

Rebased on main `ddb13c4c` (0.11.3) before committing. Compilation and all eight
targeted export, packaging, and desktop-launcher tests passed after the rebase.
The checked-in capture packages remain the verified original exports below;
their provenance and hashes were not rewritten to match the newer checkout.

Checked locally on 2026-10-29. These results describe this unpublished package,
not a hosted release. Capture version 0.11.1 is distinct from the 0.11.2 exporter
with the accompanying image deduplication and renderer startup fixes.

## Passed

- Compiled the extension, standalone application, and embedded viewer.
- Seven export/package tests: image hydration and deduplication, repeatable
  packaging, fresh evidence restoration, integrity checks, and overwrite refusal.
- Full export browser regression: offline workers, both export profiles and tour
  modes, history/deep links, keyboard navigation, integrity failures, and reopening
  after the presentation server exits.
- Image browser regression with scripts forced to initialize after document
  completion. It failed before the Monaco import fix and passed afterward.
- Ordinary diff-renderer regression passed, including panel reordering/density,
  editing and undo, gutter copy, wrapping, scrolling, and connector rendering.
- Walked all 38 packaged steps in offline Chromium with zero network requests.
  Images loaded, the final Next control disabled, and expansion fit an 850 × 700
  viewport. Screenshots were inspected at a 1366 × 768 laptop viewport.
- Chrome chapter links selected the intended first step. Safari rendered and
  advanced the standalone HTML both over loopback HTTP and directly from disk.
- Read the public captions and inspected all 38 screenshots, with OCR as an
  additional check. Inspected all reachable public bundle paths and text objects.
  The bundle contains synthetic documentation evidence; it is not a code-history
  reconstruction of the features shown in screenshots.
- Built the Pages site from its explicit allowlist and verified the package digest.
- Staged the npm distribution and inspected its dry-run inventory: 95 files,
  22,921,059 unpacked bytes, with no documentation tour bundles. Existing VSIX and
  desktop allowlists also exclude them.

The public HTML is 19,138,899 bytes. It became usable in 1.93 seconds in one local
Chromium file-load run; this is neither a network benchmark nor a performance SLA.
Compiled JSON retains the standard format and is 38,681,953 bytes. The evidence
bundle is 8,838,097 bytes. Exact hashes are in the package manifest.

## Limits

GitHub Pages configuration, inherited domain behavior, CI execution, hosted
latency, and deployment/rollback have not been exercised. No publication occurred.
The complete repository test suite and a new live VS Code capture session were
not run for this documentation change. Existing screenshots retain their original
capture provenance; browser checks validate the packaged viewer, not every
underlying feature shown in the images.

An initial full export smoke run timed out during concurrent package builds;
rerunning it alone passed. A separate direct Electron invocation was rejected by
the harness's Node-mode environment; the repository's `scripts/run-electron.mjs`
launcher was used for successful browser checks.
