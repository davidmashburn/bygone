# Dependency evidence validation

This is a reproducible validation of the static JS/TS module graph, not a runtime
profiler or a human review study. The measured report is
[results-2026-10-26.json](results-2026-10-26.json). It identifies the implementation
commit, source and bundle hashes, fixture/harness hashes, public repository OIDs,
Node version, hardware, individual measurements, mismatches and diagnostics.

## Measured result — 2026-10-26

Implementation `c7219ed06351626b8a65627fbb0427b57c576bbf`, TypeScript 4.9.5,
Node v26.10.0, macOS arm64, Apple M4, 32 GiB RAM.

All 36 contract-labeled HEAD sites matched exactly across ten cases: 17 imports,
5 re-exports, 7 requires and 7 dynamic imports. Precision and recall of these
joint field labels are 100% for each relationship on this small corpus. The
labeled deltas, direct consumer, two initialization sites, and negative controls
also matched. Two additional malformed-package sites matched their separately
marked characterization. This includes correctly retained unknowns; it does not
mean all targets resolved. All 158 source sites checked across both revisions
of the synthetic cases and four selected public files passed evidence validation.

| Input | HEAD sources indexed | HEAD edges | Analysis ms: first / next / next | Peak RSS MiB, range | Index complete |
| --- | ---: | ---: | --- | ---: | --- |
| Synthetic 100 | 100 | 100 | 147 / 141 / 136 | 123–123 | Yes |
| Synthetic 500 | 500 | 500 | 249 / 240 / 232 | 134–134 | Yes |
| Synthetic 1,500 | 1,500 | 1,500 | 577 / 686 / 544 | 141–141 | Yes |
| Synthetic 2,500 | 1,999 | 1,999 | 724 / 710 / 715 | 143–143 | No |
| express | 142 | 408 | 285 / 275 / 273 | 143–154 | Yes |
| p-limit | 6 | 24 | 123 / 125 / 130 | 126–127 | No |
| redux | 139 | 397 | 235 / 238 / 230 | 153–156 | No |
| bygone | 261 | 1,165 | 992 / 885 / 885 | 223–226 | Yes |

Public HEAD endpoint counts were: Express 64 resolved / 344 unknown, p-limit
4 / 20, Redux 13 / 384, and Bygone 376 / 789. Unknown includes computed specifiers
and invalid configuration; installed dependencies and builtins are deliberately
outside resolution scope. These are coverage observations, not error rates.

The selected-file oracle matched Express 9/9 and p-limit 1/1 edge records. It
resolved all four expected internal Express targets. Redux resolved none of its
13 expected internal entry-file targets because its configuration was rejected;
all 13 remained explicit `invalid-config` sites. No wrong resolved endpoint was
accepted in this tiny selected-file sample. The remaining public files were not
manually labeled, and mostly documentation/version changes in the public ranges
mean these runs say little about real-world dependency-delta quality.

Three compatibility/coverage issues deserve work before adding visualization:

1. **Compiler compatibility.** Redux uses `moduleResolution: bundler`; its website
   also uses `noUncheckedSideEffectImports`. TypeScript 4.9 rejects these options,
   invalidating resolution for 367 of 397 HEAD sites. p-limit's `benchmark.js:51`
   uses a `using` declaration and yields a parser diagnostic. Both report partial
   coverage, but useful evidence is lost.
2. **Malformed package metadata.** The truncated `package.json` characterization
   silently becomes an empty package object through TypeScript's reader. NodeNext
   therefore falls back from ESM to CommonJS, resolves an extensionless import,
   and still reports complete indexing with no diagnostic. This is a concrete
   diagnostic gap, not proof of valid runtime resolution. Because the same module
   target already existed through `./lib.js`, the delta contains only the removed
   unresolved edge, not a new resolved module edge.
3. **Input selection.** All JSON shares the source/config budget. Three Redux
   example lockfiles exceed the per-file limit, making the whole report partial
   despite every candidate source being indexed. Configuration-relevant metadata
   needs a more precise selection and completeness policy.

Confidence is high in these observed counts and compatibility failures, moderate
in the local timing ranges, and low in extrapolation to other repositories or
reviewer benefit. A broader unseen corpus, parser/resolver changes, different
hardware, or a human comparison could change the recommendation.

The next bounded slice should address compiler compatibility and metadata
coverage: evaluate a parser/resolver update against this pinned corpus, diagnose
malformed package metadata, and distinguish relevant config/package inputs from
unrelated JSON. Preserve committed-only resolution and explicit unknowns; do not
silently discard unsupported options to obtain more resolved edges. Replay the
public entry-file oracle and scale checks before advancing to symbol-binding and
import-time context. Runtime ingestion and graph UI remain separate later work.

Validation for this pass: compile/typecheck, 22 focused tests (including scoring
negative controls), syntax checks, targeted benchmark lint, and the full benchmark
passed. No production implementation changed. Full application tests, UI smoke,
packaging, CI and installation sync were not rerun for this benchmark-only work.
An independent focused review found no blocking defects; it noted the RSS sampling
boundary and skipped oracle behavior for unpinned heads, both clarified here.

## Reproduce

From the repository root:

```sh
npm run compile
node --test scripts/dependency-benchmark/scoring.test.cjs test/dependencyGraph.test.js test/moduleDependencies.test.js
node scripts/dependency-benchmark/run.cjs --output /tmp/dependency-results.json
```

The last command runs synthetic correctness cases and scale checks. To include
public repositories, clone Express, p-limit and Redux into the paths in
[repos.example.json](repos.example.json), then add:

```sh
node scripts/dependency-benchmark/run.cjs --output /tmp/dependency-results.json --repos scripts/dependency-benchmark/repos.example.json
```

For each clone, fetch the pinned revision with
`git -C <path> fetch --depth 2 origin <head-OID-from-manifest>` if necessary.
The manifest specifies both base and head, so branch movement does not change
which snapshots are measured. Change only local paths when reproducing. The
Bygone entry assumes this repository is the working directory and has its pinned
commits. Public target dependencies are neither installed nor executed. Fixture
Git repositories are temporary and removed after each case.

## What the checks establish

[cases.cjs](cases.cjs) contains independently authored, source-based labels, with
parent review before scoring. One computed-import phase typo and one delta label
were corrected during review: the computed expression is top-level, and an
additional site is not a new module edge if another spelling already resolved to
that endpoint. The malformed package input was changed from a trailing comma
(accepted by TypeScript's config reader) to truncated JSON.

HEAD edges are compared as multisets of source file, written specifier,
relationship, phase, loading, resolution and target. Missing edges, incorrect
fields and unexpected/duplicate sites are penalized. Optional labels also check
added/removed module edges and direct unchanged consumers. Registration has an
explicit initialization-site oracle, excluding its callback-body calls. Every
emitted source site in the synthetic cases and selected public files is checked
against its committed blob, digest, UTF-16 coordinates and link revision.

The malformed-package case is **behavior characterization**, not a correctness
endorsement. Its fallback is a known limitation described below. A passing
`passed` field means the synthetic contract, characterization and scale checks
passed. Public capability misses are reported separately and do not affect that
field; it is not a claim that all public projects are supported.

[public-labels.cjs](public-labels.cjs) hand-labels complete edge lists for four
selected files: Express's entry and factory, p-limit's entry, and Redux's public
entry. These labels apply only at their pinned head OIDs; a different head skips that
selected-file oracle, so its absence must not be interpreted as a pass. Redux's expected
internal targets are labeled from source intent; compiler incompatibility counts
as missed resolution, not as a successful unknown. All other public files are
compatibility observations without an accuracy oracle. These small, known cases
cannot establish general precision or recall.

Each scale/public input runs sequentially in three fresh Node processes. Analysis
time includes Git range discovery and both committed snapshots, but excludes
module loading, fixture creation and evidence verification. The JSON also records
module-load and process-wall times; labeled process-wall times include evidence
verification and are not comparable with ordinary runs. RSS is the whole Node
process high-water mark through graph analysis in KiB, including the parser;
result serialization and evidence verification occur after the sample. The first run is merely the first observed run; subsequent runs may
benefit from OS caches. Disk caches were not flushed, and no in-process warm-cache
or controlled cold-cache measurement is claimed. Concurrent workstation activity
and three samples limit timing conclusions.

The scale corpus is a ring of tiny TypeScript modules, with one changed value.
It tests 100, 500, 1,500 and 2,500 source files. A single config consumes one of the
2,000 input slots, so the last case must index 1,999 sources and report 501 omitted
sources with partial coverage. Its simple syntax is not a realistic large-codebase
memory or latency model.

## Review-task comparison

The case records contain questions, source-checked answers, ordinary diff/search
steps and the graph's contribution. This is a qualitative inspection, not a timed
user experiment or evidence that navigation effort decreased.

| Task | Ordinary diff/search | Dependency evidence | Remaining boundary |
| --- | --- | --- | --- |
| Alias retargets an unchanged consumer | Read config diff, search alias users, inspect both targets | Shows removed/added endpoints and the direct unchanged consumer | No transitive impact claim |
| Identical reader moves between directories | Inspect rename and resolve the relative import in both directories | Detects changed target despite identical source bytes | Does not bind the imported symbol |
| Registration references a lazy callback | Read registration and callback bodies separately | Keeps registration initialization sites separate from invocation-phase dependencies | No proof of callback execution or cycle safety |
| Imported name changes within one module | The import/export diff directly shows the change | No module-edge delta | Symbol evidence is still needed |
| Broken compiler/package metadata | Inspect config/package diff before trusting imports | Compiler-config errors are explicit; malformed package fallback is silent | Completeness needs stronger metadata diagnostics |

A graph UI was not built or compared with the existing relation list. Runtime
workloads, Python, symbol/call resolution, human review quality, and general
resolver equivalence were not evaluated.
