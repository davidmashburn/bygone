# Difficult-example correspondence benchmark

This benchmark measures missed and incorrect accepted symbol correspondences in
44 comparisons. It compares the current exact-only mode with the optional
RefactoringMiner engine **plus Bygone's inventory and validation rules**, and
Bygone Strand, the original compact JS/TS/Python correspondence engine.

## Bygone Strand v1

The [Python-enabled report](results-strand-python-2026-10-23.json) reruns all 44
comparisons with unchanged labels. Strand now finds all 8 expected Python
continuations, including decorated, nested and edited move/rename examples,
with no incorrect accepted pair in the labeled scope. JS/TS remains 106/108,
with no incorrect accepted pair. Combined, Strand finds 114/116 (98.3%),
including all 54 targeted expectations; the two remaining misses are the
invalid-syntax context expectations in `control-10`.

Exact-only remains 85/116 and RefactoringMiner plus validation remains 112/116.
Extraction/inline results are unchanged: 0/2, 1/2 and 0/2 respectively. Python
features come from the existing isolated CPython parser; Strand requires no Java.
Stubs remain inventory/exact-only. Confidence is high for these measured counts;
this known development corpus does not establish general precision. Unseen
labeled Python cases could change that assessment.

### Initial JS/TS slice

The [three-mode report](results-strand-2026-10-23.json) uses the same 44
comparisons and unchanged source labels. This historical version did not infer
Python correspondences and used exact matching there.

| JS/TS continuations | Exact only | RefactoringMiner + validation | Bygone Strand |
| --- | ---: | ---: | ---: |
| Expected | 108 | 108 | 108 |
| Correct | 84 | 104 | 106 |
| Missed | 24 | 4 | 2 |
| Incorrect accepted | 0 | 0 | 0 |
| Recall | 77.8% | 96.3% | 98.1% |
| Targeted correct / expected | 27 / 46 | 44 / 46 | 46 / 46 |

Strand recovers the edited `mixed-08` registration and `const-to-let` declaration
context change. Its two misses are the invalid-syntax context expectations in
`control-10`; failed inventory parsing still prevents matching. Python results
are 1/8 exact-only, 8/8 with RefactoringMiner, and 1/8 in Strand mode. Across
both languages those totals are 85/116, 112/116 and 107/116 respectively.

Extraction/inline groups remain separate: 0/2 for exact-only, 1/2 with
RefactoringMiner and 0/2 for Strand, which does not implement them. No incorrect
accepted continuation or group was observed in the labeled scope. Unlabeled
pairs remain counted as ignored. These are development examples, including
negative controls, not a blind test or evidence of general precision. High
confidence applies to these measured counts; independent unseen labeled cases
could change the assessment of the matcher.

Strand uses the existing TypeScript dependency and requires no Java process.
It is explicitly selected with `--engine bygone-strand`; defaults are unchanged.
See [its contract](../javascript-engine.md) for scope, ambiguity and limits.

## After the inventory/validation fix

The [updated report](results-inventory-validation-2026-10-23.json) reruns the
same 44 comparisons and unchanged labels after the inventory/validation changes.
The [baseline report](results-2026-10-23.json) is preserved below.

| Engine + validation | Baseline | Updated |
| --- | ---: | ---: |
| Expected continuations | 116 | 116 |
| Correct | 109 | 112 |
| Missed | 7 | 4 |
| Incorrect accepted | 0 | 0 |
| Recall | 94.0% | 96.6% |
| Targeted correct / expected | 49 / 54 | 52 / 54 |
| Targeted recall | 90.7% | 96.3% |
| Missing inventoried endpoints | 4 | 2 |

Both edited local continuations in `duplicate-bodies-crossing-edits` and the
Python move/rename/edit in `python-stub-partial-scope` now survive validation.
Skipped changed implementations and cross-file candidates competing with
unchanged skipped implementations remain blocked. Duplicate local names and
duplicate ancestors remain ambiguous. Stub declarations themselves still accept
only independent exact matches. Integration tests cover import/reload of the
local pairs and a generated Python Git artifact consumed by the viewer.

`mixed-08` now inventories both `Query` registrations and their direct methods,
closing its inventory gap. It still misses the edited move: inspection of native
output shows module containers and expression fragments, with no registration
candidate. Inventory support alone cannot establish that correspondence.
The other remaining misses are the `const-to-let` engine crash and the two
`control-10` invalid-syntax context expectations. The separate extraction miss
is unchanged. Exact-only counts and ignored-pair counts are unchanged.

The updated JSON adds hashes for the implementation sources and public fixture,
so its uncommitted implementation is identifiable independently of Git HEAD.
Confidence is high for this corpus; it remains a known development corpus,
not evidence of general precision. No engine replacement or matcher heuristic
was added to recover the remaining cases.

## Baseline result

The [2026-10-23 report](results-2026-10-23.json) contains every case, missing gold
pair, inventory gap, parser identity, engine status, rejected endpoint reason,
and unresolved reason.

| Continuations | Exact only | RefactoringMiner + validation |
| --- | ---: | ---: |
| Expected | 116 | 116 |
| Correct | 85 | 109 |
| Missed | 31 | 7 |
| Incorrect accepted | 0 | 0 |
| Recall | 73.3% | 94.0% |
| Targeted expectations (subset) | 54 | 54 |
| Targeted correct | 28 | 49 |
| Targeted missed | 26 | 5 |
| Targeted recall | 51.9% | 90.7% |

Targeted expectations exclude the frozen corpus's unchanged marker functions
and historical context declarations. They include its intended move/edit pairs,
retained-copy and shifted-line controls, and the additional regression, Python,
and module-split expectations. `focus` in the labels defines this subset before
scoring. Both totals are shown so unchanged context cannot hide poor results on
the interesting pairs.

| Corpus | Comparisons | Expected | Exact correct / missed | Engine correct / missed |
| --- | ---: | ---: | ---: | ---: |
| Frozen JS/TS synthetic | 20 | 51 | 40 / 11 | 48 / 3 |
| Frozen JS/TS public history | 10 | 30 | 25 / 5 | 30 / 0 |
| Additional JS/TS regressions | 7 | 15 | 9 / 6 | 12 / 3 |
| Python regressions | 6 | 8 | 1 / 7 | 7 / 1 |
| Public Bygone module split | 1 | 12 | 10 / 2 | 12 / 0 |

No incorrect accepted continuation was observed in any group. This is a small,
known corpus, so that observation does not establish general precision.
Extract/inline relationships are scored separately: exact-only found 0 of 2;
engine mode found the inline relationship and missed the extraction (1 of 2).
Neither mode emitted an incorrect accepted relationship within the labeled scope.

## What the seven engine-mode continuation misses mean

| Case | Misses | Evidence and classification |
| --- | ---: | --- |
| `duplicate-bodies-crossing-edits` | 2 | The engine supplies edited same-file candidates for `b.ts` and `c.ts`, but omits unchanged `a.ts` and `d.ts` from processed paths. Our comparison-wide completeness rule reports `engine-skipped-document` and suppresses those candidates as `incomplete-analysis`. Exact matching preserves only the unchanged two. |
| `python-stub-partial-scope` | 1 | A move/rename/edit candidate is present, but our deliberate `.pyi` exclusion marks the added stub as skipped. The comparison-wide completeness rule suppresses the Python candidate. |
| `const-to-let` | 1 | Declaration context changes defeat exact matching; the engine fails with a GumTree `NullPointerException` involving a null parent tree. This is an actual engine crash, safely reported as unavailable. |
| `mixed-08` | 1 | Neither inventory contains the `registerType("Query", ...)` registration symbol. This is a syntax/inventory coverage gap, not just a failed correspondence guess. |
| `control-10` | 2 | Deliberately invalid destination syntax prevents inventorying its context marker and disables comparison-wide exact fallback, also losing the unchanged origin marker. These are context expectations, outside the targeted subset. |

The four missing inventory endpoints are the two registration endpoints and two
declarations in the deliberately invalid destination. The latter includes a
negative-control declaration that is not itself an expected continuation.

The separate extraction miss is `mixed-01`. Its synthetic cross-file helper has
no added import connecting the files. Preserve that limitation when interpreting
the miss; it does not establish failure on a well-formed imported extraction.

These results favor investigating the scope of our completeness guard first,
then declaration-context changes and missing inventory syntax. Broadly relaxing
the guard is not justified: skipped files can contain competing origins. Any
change needs to preserve abstention in the retained-copy and duplicate-origin
controls. No matcher or validation policy was changed for this measurement.

## Labels and scoring

`cases.js` supplies source-based expectations, not engine-generated gold labels.
The original 30-case JS/TS corpus is frozen byte-for-byte from the
`research/move-tracking-slice0` worktree's
`scripts/change-analysis/semantic-corpus/manifest.json`:

- Recorded corpus base: `9d56b1121d33d0e3ab6b3ec42f51e93e183247ce`.
- SHA-256: `845dfeaf2cfe6bcc59ab6df23b404afcdb915c175cde74241488c0f299fd42f0`.
- Its historical selection is the first eligible `src` JS/TS path per nonmerge
  commit, descending, at most 180 lines, within the last 60 commits.

The added cases cover repeated constants, same-named methods in different
classes, indistinguishable nested declarations, retained competing origins,
variable declaration context, crossing duplicate edits, edited arrow functions,
Python decorations/nesting/moves/stubs, and the existing public module-split
fixture. All top-level declarations in the module-split fixture are labeled;
its precomputed engine matches are not the oracle. No private PR source was
copied, and this is not a quantitative evaluation of private PRs.

Each case declares its evaluated endpoints and expected pairs. Selectors use
path, qualified name, and an explicit occurrence when names repeat. Any accepted
prediction touching a labeled endpoint is scored. Predictions entirely outside
that universe are counted as ignored: 14 exact-only and 15 engine-mode internal
continuations in this run. They have not been audited for correctness. Missing
inventory remains in the recall denominator. A wrong guess counts as both an
incorrect match and a missed intended match; duplicate predictions are incorrect.
Unresolved groups do not count as accepted extract/inline relationships.

## Reproduce

Install repository dependencies and compile the analysis dependencies:

```sh
npm ci
npm run compile
npm run test:correspondence:analysis
npm run correspondence:benchmark -- exact /tmp/correspondence-exact-new.json
```

Output files must not already exist. For the optional engine, follow the
configuration in [the analysis guide](../README.md), supply a JDK with `javac`
beside `java`, and use the pinned artifact hash:

```sh
export MAPPING_JAVA=/absolute/path/to/jdk/bin/java
export MAPPING_JAR=/absolute/path/to/RM-fat.jar
export MAPPING_JAR_SHA256=b0bb3d1c45f36cfe6b0364cafe7e70404be501affac237c457ad65e4bd4a7859
# Optional: choose the Python interpreter explicitly.
export MAPPING_PYTHON=/absolute/path/to/python3
npm run correspondence:benchmark -- both /tmp/correspondence-both-new.json
```

The recorded run used RefactoringMiner source revision
`e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`, JDK 21.0.13+9, Node 26.10.0,
TypeScript 4.9.5, and CPython 3.14.7. The JSON records Git HEAD, hashes of the
expanded corpus, labels, runner, bridge, and engine jar, parser versions, and
analysis limits. HEAD identifies the implementation baseline; the source hashes
identify the additional benchmark files, which were uncommitted during the run.
The updated report also hashes the inventory, normalizer, engine runner, Python
parser, Git adapter, artifact consumer and public module-split fixture.

Confidence is high in the recorded counts for these exact inputs. Generalization
is limited: these are known examples used during development, not a blind test;
the historical sample is small and file-local; unlabeled internals and real PR
gold labels remain unverified. Elapsed times are recorded for diagnosis, not a
controlled performance comparison. No replacement JavaScript matcher, full
release verification, or GitHub CI was run as part of this benchmark.
