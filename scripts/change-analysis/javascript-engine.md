# Bygone Strand correspondence engine

Internal name: **Bygone Strand**; CLI and relation producer: `bygone-strand`; contract
version: **1**. This is an original JavaScript implementation of a small part
of the correspondence problem explored with RefactoringMiner. It is not a
port and does not claim RefactoringMiner feature or language parity.

Generate an artifact from committed Git snapshots:

```sh
npm run correspondence:analyze -- feature --base main --engine bygone-strand \
  --output /tmp/correspondence-js.json
```

The generator uses the private `bygone-strand` workspace package and the
checkout's `diff` dependency. Tree-sitter grammars and their licenses ship as
pinned, hash-checked WASM assets; generation performs no runtime downloads. Existing saved artifacts and consumers have
no matcher runtime requirement. Java remains an optional alternative producer.

## Scope and evidence

The independent inventory remains authoritative for declaration boundaries,
document parsing and syntax exclusions. JS, JSX, TS, TSX, MJS, CJS, MTS and CTS
use the existing parser's supported syntax. Named functions, function variables,
classes/members, bindings, interfaces/types/enums and explicit literal
`registerType` registrations are eligible. Inventory exclusions still apply.
Python `.py` functions, async functions, classes, methods and nested declarations
also support inferred edited continuations, moves and renames. The existing
isolated CPython 3.8+ `ast`/`tokenize` subprocess supplies syntax features without
importing or executing project code. Configure `--python` or `MAPPING_PYTHON`
when needed; only Python generation needs the interpreter. Decorators remain in
the declaration slice and in header evidence. Literal/operator spellings remain
in token evidence. Assignments, imports and lambdas retain their existing inventory
exclusions. Python `.pyi` stubs retain inventory/exact matching only.

Java, Go, Rust, C#, Ruby, PHP, C and Lua use the shared bounded Tree-sitter
frontend; Mojo uses the same frontend with an experimental community grammar.
See the [package coverage and exclusions](../../packages/strand/README.md) for
each adapter's declarations, file extensions and ownership constraints.

The matcher compares structural/token features, preserving literal/operator
differences. Strong unique local identities anchor same-scope edits; cross-file
and rename candidates need structural evidence and competition checks.
Nested declarations require a correspondence between their immediate parents;
moving a nested declaration into a different scope is outside this version.
Declarations at ambiguous enclosing identities cannot gain a unique identity
just because a child name occurs once. Retained declarations remain competitors
for copied/moved occurrences. Candidate rejection and ambiguity are recorded;
an unmatched declaration is not proof of an addition or removal.

Accepted mappings pass the common full-range, source-digest and inventory-kind
checks. Artifact import and reload reconstruct declaration bytes and full local
diffs from pinned Git revisions. Match evidence is a correspondence inference;
it is not behavior equivalence or proof of an editing operation. No changed
bytes are hidden. Return to the full file view for enclosing declarations,
imports and surrounding context.

The candidate universe contains supplied changed files, including retained
declarations within those files. Unchanged repository files are outside that
universe. Candidates never compete across languages. Mixed
comparisons can be complete when both searches finish; supplied stubs and
unsupported documents explicitly leave partial coverage. A failed parse, exhausted
budget or engine failure prevents promotion of inferred edited pairs.

## Limits and evaluation

The generator retains limits of 50 paths, 1 MiB per file, 4 MiB total input,
20,000 records and 16 MiB artifacts. The matcher additionally allows 250,000 candidate comparisons,
20,000 tokens per symbol and 30 seconds of cooperative search time; exhausted searches are explicit,
with independent exact fallback only. No extract/inline relationships or
repository-wide binding/dependency analysis are produced in this version.
Python feature extraction shares the inventory subprocess's 10-second and
16 MiB output limits per snapshot. Features are generation evidence; saved
artifacts contain validated source slices and diffs, not a Python runtime.

Run the engine's tests and the difficult-example benchmark:

```sh
npm run test:correspondence:analysis
npm run correspondence:benchmark -- bygone-strand /tmp/correspondence-js-new.json
# With the documented Java configuration, compare all three modes:
npm run correspondence:benchmark -- all /tmp/correspondence-all-new.json
```

The [benchmark](benchmark/README.md) preserves exact-only and RefactoringMiner
baselines. Its source-based labels are fixed before scoring. It is a known
development corpus, not a blind evaluation or a general precision guarantee.
