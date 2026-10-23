# Cross-file symbol baseline, 2026-10-22

## Question and result

Can a small syntax inventory recover useful cross-file relationships without
pretending to detect behavior-preserving refactors? Yes on a few concrete
examples; usefulness and general accuracy remain unmeasured.

Source baseline: research branch at `c6907bb`, with the new local
`symbol-probe.js` and `symbol-probe.test.js`. Input: the 60 most recent
non-merge commits reachable from Bygone
`9d56b1121d33d0e3ab6b3ec42f51e93e183247ce`, each compared with its parent.
No working-tree edits were analyzed. Raw results:
[JSON](results/symbol-probe-bygone-2026-10-22.json).

| Observation | Count |
| --- | ---: |
| Comparisons completed within the declared subset | 60 |
| Parsed inventoried before/after occurrences | 8,419 / 8,305 |
| Paired occurrences, including unchanged | 8,200 |
| Pairs with changed declaration bytes or context | 234 |
| Pairs with changed body syntax | 228 |
| Cross-file pairs with unique declaration syntax | 3 |
| Unresolved destination occurrences | 6 |
| Unpaired before/after occurrences | 219 / 105 |
| Unsupported top-level declarations/statements, before/after | 6,742 / 6,949 |

Counts repeat symbols across commit comparisons. Unresolved destinations are
included among unpaired destinations. Unsupported includes imports, types,
nonfunction variables, classes, registrations, and other statements; it is not
an estimate of missed functions. “Complete” refers to this extraction subset,
not complete semantic coverage. No parse failures or budget skips occurred in
this sample. The JSON omits byte- and syntax-identical same-path/name matches from the
verbose match list but retains their count in `allMatches`.

## Hand-inspected cases

Commit `726796b1fe` removes `src/tourAssessment.ts` and introduces
`src/tourDetails.ts`. Three complete functions are byte-identical across paths:
`validateAudience`, `requireString`, and `requireStringArray`. The probe pairs
them using unique declaration syntax within the changed-file inputs. Inspect
with:

```sh
git show 726796b1fe^:src/tourAssessment.ts
git show 726796b1fe:src/tourDetails.ts
```

The same comparison has multiple plausible origins for `isRecord` and
`requireOnlyKeys`; these remain unresolved. The altered
`validateChangeTourDetails` is unpaired across the file boundary. A useful
next benchmark asks whether a reusable engine recovers that edited relationship
while preserving the removed assessment validation as a visible edit.
This is a candidate case, not a ground-truth refactoring label.

Another unresolved destination is `cancelPanelReorder` in `576f74f9dc`:
its empty arrow-function syntax also appears in an old `dismissHistoryRailOverlays`.
A retained match blocks treating that trivial syntax as unique new provenance.
This illustrates why even whole-function boundaries do not eliminate idiom.

## Method

Use the installed TypeScript 4.9.5 parser; no new dependency was installed.
Extract top-level named function declarations with bodies and named variables
initialized with arrows/function expressions. Preserve source offsets (UTF-16,
zero-based, half-open) and line ranges (zero-based, half-open). Parse errors
exclude the entire affected file and mark the result partial.

Pair unique path/kind/name entries first, explicitly as tentative
correspondence. Then compare AST node kinds and leaf spellings, retaining
literal/operator/identifier differences and variable declaration mode/modifiers,
but omitting the declaration's own name. Hash equality is a retrieval shortcut
in this research script; a production adapter must verify representations and
source slices. Trivia/comments are absent from the syntax fingerprint, so raw
text equality is reported separately. No internal identifier normalization or
binding resolution is performed. Variable source ranges cover the declarator;
`const`/`let` and export modifiers are additional fingerprint context outside
that range. Thus raw range equality alone does not imply declaration equality.

Require one matching syntax occurrence in each entire supplied inventory for
the second pass. Already paired occurrences remain competitors. Multiple
origins or a retained source produce unresolved equivalent syntax, not an
automatic copy. Location changes within a file are not classified as moves;
line-number shifts alone are insufficient evidence. Added/deleted files are
included via Git `--no-renames`; ordinary file-rename pairing is not modeled.

Limits: 80 eligible paths, 1 MiB per blob, 4 MiB combined before/after bytes per
comparison. Skip over-budget comparisons with an explicit reason. Include
JS/TS/JSX/TSX and module variants; exclude declarations (`.d.ts`), output trees,
minified files, and binary content. The probe reads complete supplied file
snapshots but never searches unchanged files. No incremental cache or UI exists.

## Reproduce

From the research checkout, using a dependency installation containing
TypeScript 4.9.5 (the normal dependency at the measured main revision):

```sh
# Set NODE_PATH only if dependencies live in another checkout.
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/symbol-probe.test.js
NODE_PATH=/path/to/bygone/node_modules node scripts/change-analysis/symbol-probe.js \
  /path/to/bygone 9d56b1121d33d0e3ab6b3ec42f51e93e183247ce 60 \
  > /tmp/symbol-probe-bygone.json
```

The saved report records parser version, input head, per-comparison parents and
paths, policy limits, inventory counts, coordinates, evidence, and exclusions.
Timing is deliberately absent: this was not a latency or memory benchmark.

Thirteen synthetic checks passed: module move, rename, combined move/rename,
abstention on edited cross-file bodies, visible same-name body edit, competing
sources, retained source, comments versus raw equality, changed external binding,
arrow functions, const/let change, parse failure, and unsupported classes and
registrations. These validate policy examples, not accuracy on real history.

## Conclusions and limits

Confidence **high** that syntax equality alone cannot prove behavioral
equivalence: the fixture moves `cost() { return rate; }` between modules with
`rate = 1` versus `rate = 2`. Every output labels behavior `unassessed`.
The fixture checks that the probe maintains that distinction; it is not an
execution-based equivalence test.

Confidence **medium** that a cross-file inventory is a useful next experiment.
Three manually inspected exact pairs show tangible navigation opportunities,
while edited and duplicate cases expose specific missing capabilities. This
sample is one repository, not randomly sampled, with no full hand-labeled truth.
There is no precision/recall estimate, no reviewer study, no Python coverage,
and no evidence that these pairings explain a given share of raw changed lines.
An independently adjudicated sample with mostly unhelpful relationships would
change the prioritization.

RefactoringMiner, GumTree, Difftastic, and SemanticDiff were not installed or
executed. Existing October 8 tests and multi-repository statistics were not
rerun. Production compile/test, worker integration, renderer smoke checks,
transform-stage replay, performance, and accessibility checks were skipped:
this change adds research scripts and documents only.

The `project-planning` branch's `ideas/semantic-change-evidence.md` and
`plans/semantic-correspondence-experiment.md` contain the design and next gate.
