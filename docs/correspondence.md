# Try symbol correspondence evidence

This experimental integration connects externally produced symbol mappings to
Bygone's authoring context and presentation viewer. It does not run a matcher
or model automatically. RefactoringMiner and Java remain optional external
research tools; neither is a new Bygone runtime dependency.

## Generate evidence in this checkout

The development command inventories changed JS/TS, Python, Java, Go, Rust, C#, Ruby, PHP, C, Lua and
Mojo regular files from committed
Git blobs, runs the bounded analysis adapter and imports its result into the
validated viewer format. It uses the review merge base, just like `present`;
working-tree edits are excluded. No second branch or saved research report is
required.

Start without Java:

```sh
npm run correspondence:analyze -- feature --base main \
  --output /tmp/correspondence.json
```

With no Java engine configuration, this inventories symbols and pairs only
unambiguous declarations with identical bytes. It records partial coverage:
edited or renamed declarations can remain unmatched, so unmatched does not
prove an addition or removal. Use `--exact-only` to choose this mode even when
Java engine environment variables are set.

To use the local Strand correspondence engine:

```sh
npm run correspondence:analyze -- feature --base main --engine bygone-strand \
  --output /tmp/correspondence-strand.json
```

Bygone Strand is an original declaration matcher in the private
[`bygone-strand` workspace package](../packages/strand/README.md). It supports
JS/TS, Python, Java, Go, Rust, C#, Ruby, PHP, C, Lua and experimental Mojo. TypeScript and isolated
CPython parsers retain their existing behavior; the other languages share a
bounded Tree-sitter WASM frontend with pinned, locally shipped grammars. Scoped
declaration identities and syntax/token similarity infer edited continuations,
moves and renames. Strand requires no JVM, native addon or runtime downloads. The explicit selection ignores ambient Java configuration and
cannot be combined with `--exact-only` or Java flags. The default mode is
unchanged. See [the engine contract](../scripts/change-analysis/javascript-engine.md)
for evidence, ambiguity and resource limits.

This version produces one-to-one continuations. Extraction/inline detection,
binding resolution, editing history and behavior preservation are unassessed.
Python functions, async functions, classes, methods and nested declarations
support inferred edits and moves. Decorators and complete source diffs remain
visible. Python `.pyi` stubs retain inventory/exact matching only.

Go receiver and Rust impl/trait identities are conservative: receiver/type
renames are not inferred across owners. Mojo (`.mojo`/`.🔥`) uses a pinned
community grammar and remains experimental; legacy `fn` syntax is unsupported.
See the [package coverage and exclusions](../packages/strand/README.md) and
[grammar provenance](../packages/strand/src/grammars/README.md) for exact scope.
Parser errors/timeouts fail closed, and duplicate origins remain ambiguous.
`npm run test:strand` runs package and artifact integration checks.

For broader inference, build the pinned external engine following
[scripts/change-analysis/README.md](../scripts/change-analysis/README.md), then
supply its verified build digest and JDK explicitly:

```sh
export MAPPING_JAVA=/absolute/path/to/jdk/bin/java
export MAPPING_JAR=/absolute/path/to/RefactoringMiner/build/libs/RM-fat.jar
export MAPPING_JAR_SHA256=<verified-build-sha256>
npm run correspondence:analyze -- feature --base main \
  --output /tmp/correspondence.json
```

Use `--repo /absolute/path/to/checkout` to analyze another repository without
copying its source into this one. `--java`, `--jar` and `--jar-sha256` override
the environment. Supply all three engine settings together; incomplete settings,
unavailable/incompatible toolchains and digest mismatches fail instead of silently
switching modes. The adapter needs a JDK 21+ with sibling `java` and `javac`
(verified with JDK 21). `--exact-only` cannot be combined with Java engine flags.
Python comparisons additionally use `--python` or
`MAPPING_PYTHON` (default `python3`), CPython 3.8+ with syntax support determined
by that interpreter. Named Python functions/classes/methods include decorators
and attached terminal comments; lambdas and variable bindings are excluded.
Python `.pyi` files have inventory/exact matching only and explicitly mark the
comparison partial because the pinned engine does not parse them. Validated
matches between analyzed implementation declarations can still be accepted.

The output must be a new file. Artifacts contain source text;
keep private repositories' evidence outside this repository.

Changed files bound the candidate universe: unchanged files, unsupported
languages, symlinks and submodules are excluded. The artifact records this
scope, the engine/bridge digests, parser version, limits and failure reason.
Engine/bridge digests are present only when that engine is configured.
Timeout, truncation or process failure produces explicitly partial evidence;
only independent exact declarations can survive. Invalid source encoding or
an input budget violation fails without writing an artifact. A comparison with
no supported source documents is explicitly unavailable.

Generation currently runs from a source checkout with development dependencies.
Java and RefactoringMiner are explicit external tools, not npm
`optionalDependencies`: npm does not install their toolchain, and Bygone does not
bundle or download them. Python is needed only to generate Python inventories.
Viewing/importing saved evidence and opening symbol tour stops needs neither
Java nor Python. This keeps engine size, native parser support and runtime updates
outside the viewer's installation path; optional does not imply reduced evidence
is equivalent to a complete engine result.

## Import an existing report

Normalized reports may contain one `analysis` or a `cases` array. Select a case
explicitly when importing a batch:

```sh
bygone correspondence import mappings.json feature --base main \
  --case module-split --output /tmp/imported-correspondence.json
```

The import resolves the selected review's merge-base/head to immutable commit
IDs. It checks every supplied document digest, symbol span and symbol digest
against those Git blobs, resolves endpoints uniquely, rejects conflicting or
ambiguous accepted continuations, and recomputes complete declaration diffs.
Producer-supplied quotations, line numbers, local diffs and equality flags are
not trusted. The artifact records analysis status, supplied document scope,
producer, unmatched counts, syntax exclusions and competing origins.

Only the selected producer case's supplied scope is checked. Source integrity
checks do not independently adjudicate the producer's symbol identities,
parsing, completeness or semantic claims. All mappings remain inferred and
behavior remains unassessed. Partial analysis suppresses engine-only mappings
unless the producer explicitly records complete search coverage for that pair.
The adapter permits this for analyzed implementations when only stubs are
skipped, or unique same-file/scope/name continuations when skipped implementation
files are unchanged. Skipped changed implementations, invalid parsing, engine
failure and truncation still prevent that claim. Import rejects complete pair
coverage from a failed or truncated engine; saved artifacts preserve the claim
and revalidate source bytes and endpoints. This remains producer-supplied search
evidence, not independently established lineage. Older partial artifacts without
pair coverage retain the exact-only guard. Independent exact-declaration
evidence can remain available. Extraction/inline
groups expose their endpoints in Analysis details; they are not accepted continuations.

Exact matching first checks unique same-file, same-scope, same-name bindings
with identical declaration bytes and binding context. Repeated constants in
different files can therefore retain their local continuations. Cross-scope
matching still considers all identical occurrences, including retained sources;
remaining competing origins are reported for variables as well as callables.
Local evidence does not override a conflicting engine candidate.

## Use the same artifact in both places

```sh
bygone tour context feature --base main \
  --correspondence /tmp/correspondence.json --output /tmp/context.json
bygone present feature --base main --correspondence /tmp/correspondence.json
```

No authored `.bygone` file is required. In the viewer, select **Symbols**, filter
by name or path, and select a mapping to compare its complete old and new
source symbol slices, including edits within moved code. Variable slices can
exclude enclosing export/const/let syntax; inspect the complete file for that
context and for surrounding binding/import changes. The labels identify
both paths, source lines and revisions. Editor line numbers are relative to
the declaration slice. **Show file context** opens complete source and destination
files and highlights the declarations at their original lines, including moves
between files. **Return to symbol comparison** restores the declaration slices.
The **Files** rail also nests the same filtered symbol tree beneath each file.
Use the arrow on the right of a file (**Show Symbols** on hover) to reveal or
hide its symbols directly underneath. Each file starts folded and keeps its own
expansion state; selecting files, symbols, or tour stops does not change it.
Symbol names use green for after-only declarations, red for before-only declarations,
and amber for accepted mappings with edits, moves, renames, or reparenting. Ambiguous
origins and unchanged declarations stay neutral. One-sided colors describe the
inventory; they do not confirm additions or deletions.
Symbols and Files share selection; both endpoints of a move are highlighted.
Selecting a file opens its complete diff without advancing the tour.
Symbols groups declarations by file and nests classes, methods and functions
using their source ranges. Expand or collapse branches with the disclosure
buttons (also keyboard accessible). The default filter includes moved, renamed,
edited and unmatched declarations. **Include added or removed local symbols**
is checked by default; uncheck it to hide before-only and after-only declarations
without accepted matches, including ambiguous endpoints. These are not confirmed
additions or deletions. Enable **Include unchanged local symbols** to also show
unchanged matched declarations. Search retains ancestor paths and opens
matching branches. Ancestors retained only for context are dimmed.
Moved or reparented declarations appear at both locations; the old location is
labeled **Before location** and opens the same before/after comparison. Counts
include each accepted mapping once. **Before only**, **After only** and
**Ambiguous** entries have no accepted match; selecting one shows its available
source slice, without claiming a confirmed addition or deletion.
Open **Analysis details** for separate counts and expandable records for paths
outside analysis, syntax not inventoried, rejected engine containers, unmatched
symbols and competing origins, other relationships, and analysis problems.
Records retain reported reasons, revision sides and source locations. Links open
complete file context or inventoried symbols, including unchanged declarations;
symbol links clear search and enable both include options.
Ambiguous groups link every competing endpoint without picking an origin.
Invalid producer ranges retain paths without trusted offsets. A missing candidate
is distinguished from a rejected candidate; when the producer gives no explanation,
the viewer says so. Categories overlap, use explicit units and are not a coverage
percentage. Unchanged files outside a changed-file search are described as a scope
limit, not enumerated as missing symbols. Older artifacts retain their summaries
and show **Detailed diagnostics unavailable** rather than zero diagnostic counts.
The status always names the artifact's pinned base/head, even when exploring
other history comparisons. An uploaded tour does not inherit this evidence.

Both consumers revalidate the artifact against their selected comparison.
Advancing a branch does not silently reuse old evidence: a different head or
merge base requires a new import. Context's ordinary patches, counts and limits
are unchanged; correspondence is a separate optional field with its own
budgets (16 MiB artifact, 128 documents per side, 1 MiB per Git blob, 8 MiB total
source and 8 MiB total symbol text). Nested symbols overlap, so their diffs
must not be summed as coverage or subtracted from changed-line accounting.
For a declaration diff exceeding the comparison effort budget, its entire old
and new slices are retained as removal/addition rather than omitting content.

## Use symbols in authored tours

Version 6 walkthrough steps can select an accepted relation or one unmatched
symbol from a source's `correspondence` artifact. The compiler pins declaration
text and full file context into each stop, preserving one-sided ambiguous
endpoints. See [Symbol-focused stops](change-tour-format.md#symbol-focused-stops)
for the source contract, validation, coverage, and offline behavior.

## Run this checkout's real example

With the explicit engine environment above:

```sh
npm run correspondence:analyze -- 726796b1fe --base '726796b1fe^' \
  --output /tmp/bygone-correspondence.json
BYGONE_FORCE_BUNDLED=1 node bin/bygone.js present 726796b1fe \
  --base '726796b1fe^' --correspondence /tmp/bygone-correspondence.json
```

Search for `validateChangeTourDetails`. The declaration comparison retains the
removed `validateAssessment(...)` call, removed context parameter and changed
allowed-key list. The artifact includes six moved functions and other inferred
continuations. `BYGONE_FORCE_BUNDLED=1` selects the newly built checkout instead
of an older installed desktop application.

`npm run test:correspondence` runs the source/CLI/server checks and an Electron
browser smoke using a portable fixture taken from that real module split.
This slice does not construct intermediate refactoring stages, hide raw edits,
add model annotations, or establish reviewer benefit.

`npm run test:correspondence:engine` uses the same explicit engine environment.
It runs the adapter tests, Git snapshot tests, real JVM timeout/truncation/output
failure checks, Python ranges/moves/renames and fresh module-split generation accepted by the viewer's
consumer. Large archived reports and evaluations stay on the research branch.
