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

The generator uses the existing checkout's TypeScript and `diff` dependencies.
It installs no runtime or package. Existing saved artifacts and consumers have
no matcher runtime requirement. Java remains an optional alternative producer.

## Scope and evidence

The independent inventory remains authoritative for declaration boundaries,
document parsing and syntax exclusions. JS, JSX, TS, TSX, MJS, CJS, MTS and CTS
use the existing parser's supported syntax. Named functions, function variables,
classes/members, bindings, interfaces/types/enums and explicit literal
`registerType` registrations are eligible. Inventory exclusions still apply.
Python uses its existing independent parser and exact matching only in this mode.

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
universe. Mixed Python/JS comparisons stay partial, with complete JS pair
coverage recorded only when the JS search completed. A failed parse, exhausted
budget or engine failure prevents promotion of inferred edited pairs.

## Limits and evaluation

The generator retains limits of 50 paths, 1 MiB per file, 4 MiB total input,
20,000 records and 16 MiB artifacts. The matcher additionally allows 250,000 candidate comparisons,
20,000 tokens per symbol and 30 seconds of cooperative search time; exhausted searches are explicit,
with independent exact fallback only. No extract/inline relationships or
repository-wide binding/dependency analysis are produced in this version.

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
