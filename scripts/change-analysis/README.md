# Local correspondence engine

[Bygone Strand](javascript-engine.md) is the local correspondence
producer. Select it with `--engine bygone-strand` to infer JS/TS/Python edited
continuations, moves and renames without Java. The default and optional
RefactoringMiner path described below remain available.

## Optional RefactoringMiner adapter

This development-only adapter uses the multi-language engine in
[RefactoringMiner](https://github.com/tsantalis/RefactoringMiner),
source commit `e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`. Obtain that source
separately; Bygone does not download the engine or install Java.

The Git command works without Java: it inventories declarations and accepts only
unambiguous byte-identical matches, recording partial coverage and the missing
engine. `--exact-only` ignores ambient engine configuration. Edited/renamed
symbols can remain unmatched; unmatched is not proof of an addition or removal.
Java is an optional external analysis backend, not an npm optional dependency
or a dependency of the viewer, desktop app, VS Code extension or saved tours.

Use a JDK 21+ with both `java` and its sibling `javac` (tested with JDK 21). In the pinned engine
checkout, build the fat jar with an explicit JDK:

```sh
JAVA_HOME=/absolute/path/to/jdk ./gradlew shadowJar --no-daemon --console=plain -x test
shasum -a 256 build/libs/RM-fat.jar
```

Verify the source checkout and build before supplying that jar's digest as
`MAPPING_JAR_SHA256`. The digest identifies the actual build; it can differ
between builds because the jar includes build metadata. Bygone verifies the
supplied digest before compiling or executing the bridge; it cannot infer a
jar's source provenance from that digest. No global JDK is selected implicitly.
Both executables are checked before bridge compilation. Incomplete configuration,
unsupported/missing toolchains and bad checksums fail explicitly; they do not
silently produce exact-only coverage. Runtime analysis failures still preserve
independent inventory/exact evidence and record the failure.

The Git command and environment setup are documented in
[docs/correspondence.md](../../docs/correspondence.md). TypeScript and `diff`
come from this checkout's existing development dependencies. The Java bridge
is compiled into a temporary directory and removed after each command.

Python source (`.py`) uses an isolated CPython 3.8+ standard-library `ast`
subprocess for the independent inventory. Configure `MAPPING_PYTHON` or
`--python /absolute/path/to/python3`; otherwise `python3` is resolved on PATH.
Only Python comparisons require it. Parsing uses `-I -S`, receives source over
stdin, and never imports or executes project code. The installed interpreter
sets accepted syntax; its version is recorded. Generation does not install a
Python runtime or packages. Loading an artifact does not require Python.

Named functions, async functions, classes, methods and nested declarations
(including compound suites) are inventoried. Full slices include decorators
and attached terminal comments. AST UTF-8 columns are converted to exact UTF-16
source offsets, preserving Unicode and CRLF. Independent token boundaries
provide explicit def/class engine ranges; synthetic module/lambda containers
cannot claim enclosing declarations. Assignments, imports and lambdas stay
visible in full files; bindings and lambdas are not Python symbols in this slice.

Python `.pyi` stubs have inventory/exact support only: this pinned engine's
Python file predicate accepts `.py`, not `.pyi`. Their presence marks the
comparison partial; engine-only matches can still connect analyzed implementation
declarations, while stub declarations accept only independent exact matches.
Missing Python, invalid syntax, parser timeout or output overflow marks documents invalid and preserves
diagnostics; no inferred or exact pairs are promoted from a failed parse.
The Python subprocess is bounded to 10 seconds and 16 MiB output per snapshot.

The adapter inventories declarations independently, validates engine ranges
and hashes against the input strings, and retains full old/new declaration
diffs. Coordinates are UTF-16, zero-based and half-open. It treats engine
continuations as inferred and behavior as unassessed. Extraction/inline groups
remain separate; competing origins are unresolved. Declaration slices may
exclude binding/export syntax, so complete file diffs remain necessary.

Default limits are 50 changed source paths, 1 MiB per file, 4 MiB combined
snapshot bytes, 20,000 exported engine records, 30 seconds per JVM comparison,
16 MiB engine stdout, and a 2 GiB JVM heap. Bridge compilation has a 30-second
timeout and 1 MiB output limit. Declaration diff effort is bounded and falls
back to complete removal/addition. The viewer applies additional artifact and
source budgets. Parse errors, timeout, truncation and process failure remain
visible; they never turn an engine-only candidate into an accepted match.

Skipped changed implementation files still block engine-only matches. When the
engine omits byte-identical implementation files, only unique continuations at
the same file/scope/name identity may use engine evidence; cross-file candidates
remain unresolved because omitted declarations can compete for their origins.
Skipped documents remain visible as partial coverage even when a local pair is
accepted. Every engine-only pair must have both endpoint files in the reported
processed paths.

The JS/TS inventory also recognizes explicit top-level
`registerType("Name", { method() {} })` registrations and their direct named
methods. Dynamic names, arbitrary calls, nested registrations and callback
properties remain excluded. Identical registrations can use independent exact
matching; the pinned engine does not supply registration-level candidates for
the edited move in the difficult-example corpus.

Accepted engine pairs within a partial comparison carry `coverage: "complete"`
through import and saved-artifact validation. This is a producer claim about
the pair's search scope, not independent proof of lineage. Failed/truncated
engines cannot supply that claim; older partial reports without it retain the
exact-only guard. The comparison and skipped-document diagnostics stay partial.

`run-refactoring-mappings.js` also supports the original manifest interface:

```sh
node scripts/change-analysis/run-refactoring-mappings.js \
  "$MAPPING_JAVA" "$MAPPING_JAR" manifest.json /tmp/report.json "$MAPPING_JAR_SHA256"
```

A manifest has `cases: [{id, before: {path: text}, after: {path: text}}]`.
The Git command is preferable for ordinary comparisons because it pins and
validates the artifact directly against Git. Raw reports can be imported
with `bygone correspondence import`. Research corpora, archived reports,
evaluation code and legacy move experiments are not required here.

## Checks

`npm test` includes the analysis unit and Git artifact tests without Java.
`npm run test:correspondence:analysis` runs those tests alone (Python inventory
tests use `python3`). `npm run test:correspondence:engine` additionally runs the
real-engine integration tests and requires all three `MAPPING_JAVA`,
`MAPPING_JAR` and `MAPPING_JAR_SHA256` settings. It fails when they are absent;
an explicitly requested integration check is never silently skipped.
