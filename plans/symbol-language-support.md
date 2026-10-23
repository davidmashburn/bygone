# Symbols language support

## Goal and decision

Approved rollout, 2026-10-23: build Python support first, finish the languages
supported by the pinned RefactoringMiner engine, then expand to other languages.
This extends the [cross-file correspondence experiment](semantic-correspondence-experiment.md)
and [semantic change evidence](../ideas/semantic-change-evidence.md).

Symbols presents comparison-local declaration relationships and complete local
diffs. It does not establish historical identity or behavior preservation.
Language support must preserve those limits and the complete file comparison.

## Current foundation

`feat/correspondence-evidence` at `27ffec95` consumes validated correspondence
artifacts in authoring context and the Symbols viewer. Local, uncommitted
consolidation adds `scripts/change-analysis/` and
`npm run correspondence:analyze`, allowing generation and viewing from the same
feature checkout without switching to `research/move-tracking-slice0`.

Generation reads changed regular source files from pinned Git merge-base/head
blobs, runs an independent inventory and bounded external engine, validates
source ranges/digests, and emits the viewer format. The existing independent
inventory handles JS/TS, including JSX/TSX and module variants. The artifact
format and viewer do not require a separate representation per language.

Observed validation before Python work: 24 adapter/Git/native-engine tests,
six consumer tests, an Electron browser smoke, and targeted lint pass. A real
JS comparison exposed an arrow-container boundary mismatch; a regression and
fresh engine run now verify the repair. These checks establish integration
and source integrity, not general matching accuracy or reviewer benefit.

## Rollout order

| Phase | Languages | Completion gate |
| --- | --- | --- |
| 1: current implementation | Python | Independent inventory, native engine integration, failure coverage, and a real comparison opened in Symbols |
| 2: finish current engine coverage | Java, Kotlin, C, C++ | Each language independently passes the common gates below; existing JS/TS and Python continue to pass |
| 3: extend beyond the current engine | Go, Rust, Mojo, followed by C#, Ruby, PHP, Swift, Scala, Lua, Elixir as demand warrants | Validate the parser and choose a correspondence producer before advertising edited/renamed matching |

Java and Kotlin precede C/C++ because their declaration structure is a closer
fit to the existing adapter. Treat C and C++ as separate acceptance targets;
C success does not cover templates, overloads, or macros in C++.

The phase-2 list is pinned to RefactoringMiner source
`e7b8db328e7d678bc474ebf4b61739b6d6c85b7f`. Its
[language matrix](https://github.com/tsantalis/RefactoringMiner/blob/e7b8db328e7d678bc474ebf4b61739b6d6c85b7f/README.md)
lists Java, Python, Kotlin, JavaScript, TypeScript, and C/C++ for refactoring
detection and AST diffs. Reconcile that list explicitly when upgrading the
engine; upstream support does not automatically enable Bygone support.

Go, Rust, and Mojo are the first candidates after phase 2, with their exact
order determined by use cases and the parser/matcher probe. The broader list
is a candidate backlog, not a promise that a grammar alone provides accurate
edited correspondence. [Tree-sitter's parser catalog](https://github.com/tree-sitter/tree-sitter/wiki/List-of-parsers)
offers a possible common inventory foundation; Mojo also has
[a dedicated community grammar](https://github.com/lsh/tree-sitter-mojo).
Verify current syntax coverage and licensing before adoption. Python-like
syntax is insufficient grounds to process Mojo as Python.

## Phase 1: Python implementation

Use an independent Python parser to inventory named functions, async functions,
classes, methods, and nested declarations. A bounded, isolated CPython `ast`
subprocess is an acceptable initial implementation: it parses supplied text
without importing or executing the analyzed project, using no project packages.
Record the parser version and make missing runtimes, unsupported syntax, parse
errors, timeout, and output overflow explicit.

Preserve the exact supplied source, including CRLF and Unicode. Convert the
parser's UTF-8 byte columns and line coordinates to the artifact's zero-based,
half-open UTF-16 offsets. Keep full decorators with declaration slices; any
engine range alternatives must correspond to complete, independently parsed
declarations. Nested/lambda/module containers must not claim an enclosing
function merely through a plausible name or overlapping range.

Include `.py` and `.pyi` in Git snapshot selection, with parser limitations
reported. Enumerate methods and declarations under compound suites without
inventing identities for arbitrary callback/lambda expressions. Record excluded
syntax explicitly. Keep imports, assignments, decorators, annotations, and
surrounding binding changes visible in full file diffs, even where they are
outside an individual declaration slice.

Start with functions/classes and one-to-one continuations supported by the
current consumer. Preserve extraction/inline evidence separately; navigable
multi-endpoint operations remain a separate feature. Do not add Python-specific
UI state or a new public artifact format for this slice.

## Common acceptance gates for every language

1. **Inventory:** independently enumerate supported declarations and report
   exclusions, invalid syntax, parser identity, and supported syntax/version
   boundaries. Include nested scopes and repeated names in tests.
2. **Source integrity:** validate exact document/declaration hashes, UTF-16
   offsets, line ranges, CRLF, non-ASCII identifiers, and non-BMP characters.
   Cover language-specific decorators, attributes, generics, macros, or other
   boundary complications before enabling them.
3. **Correspondence:** demonstrate unchanged, edited, renamed, and cross-file
   relationships; additions/deletions and competing/retained origins stay
   explicit. Reject incomplete or ambiguous engine-only matches. Full local
   diffs must reconstruct both endpoint slices exactly.
4. **Failure behavior:** malformed syntax, absent runtimes, engine timeout,
   truncation, output overflow, invalid ranges, and budget violations remain
   visible. Never infer completeness from the engine's success status alone.
5. **Git and consumers:** generate from immutable merge-base/head blobs, load
   with both existing consumers, open a declaration comparison read-only, and
   return to complete file diffs. Dirty working-tree edits must not leak in.
6. **Evaluation:** keep synthetic boundary controls separate from adjudicated
   real-history examples. Record false positives/misses and scope; do not
   promote integration tests into broad precision/recall or usefulness claims.

## Extending beyond RefactoringMiner

Separate declaration discovery from correspondence production. Reuse the
current artifact, source validation, ambiguity policy, local diff, and viewer.
Introduce only the parser dispatch needed by implemented languages; avoid a
speculative plugin framework during the Python slice.

An independent inventory plus unique exact-declaration matching can provide
conservative initial coverage for languages without an engine. Edited or
renamed matching requires a separately tested structural matcher or another
producer; it must not be implied by parser availability. Name-only pairing,
format normalization, or an LLM assertion is insufficient acceptance evidence.

For Go, test receiver methods and generics. For Rust, test traits, `impl`
blocks, attributes, and explicit macro exclusions. For Mojo, first validate
current grammar coverage, declaration kinds, and source coordinates against
representative code. Add each language behind explicit scope reporting and
keep unsupported forms visible in the full comparison.

## Limits, dependencies, and publication

Keep the external engine optional and explicitly configured with a verified
build digest. A Python parser runtime is a development-generation requirement,
not a requirement to load an existing artifact. Document new dependencies and
their failure modes; do not install global runtimes implicitly.

Retain bounded files, snapshot bytes, subprocess time/output, record counts,
and artifact size. Artifacts contain source text: keep private comparisons
outside the Bygone repository, and use generic or public fixtures in commits.
Keep research corpora and evaluations separate from the development runner.

No automatic edit hiding, equivalence labels, binding resolution, transform
stages, repository-wide scanning of unchanged files, or shipped language
runtime bundles are included in this rollout. Those require separate evidence
and decisions.

## Confidence and next steps

High confidence that the artifact/viewer can be reused and that the pinned
engine exposes the phase-2 languages; medium confidence in relative adapter
effort. Boundary failures or poor matching on adjudicated examples would change
the effort estimate and may require a narrower supported subset.

Commit this plan on `project-planning`. Implement and validate Python on the
feature branch, then record its actual scope and limitations beside the code.
Proceed to Java/Kotlin and then C/C++ after those gates pass; expand beyond the
engine only after phase 2. This plan records sequencing and acceptance criteria,
not completion of those later phases.
