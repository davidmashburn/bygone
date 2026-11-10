# Symbol and dependency analysis

Use this workflow when the tour or surrounding task needs symbol or dependency
evidence. Analysis can inform a standalone comparison even when no tour is
selected. Reuse artifacts only when their immutable comparison and scope match.

## Generate and inspect evidence

Resolve the repository and intended immutable endpoints first, following the
skill's comparison rules. These analysis commands use the review merge base and
head. Inspect the resolved OIDs before reusing their output: if the merge base
differs from the intended base, stop and report the mismatch rather than silently
substituting it. All artifacts below must describe the intended pair. Dirty edits
are excluded. After local repairs,
reconcile their diff separately and label earlier artifacts; do not claim those
artifacts cover the repairs or create commits without authorization.

To generate new symbol correspondence, locate an available Bygone source checkout
with its existing build and analysis dependencies. Generation currently uses its
development script, not an installed `bygone correspondence analyze` command.
Reusing a valid artifact or gathering dependency context alone does not require
that generator. The combined workflow below collects both kinds of evidence;
omit `--dependencies` when only symbols are needed, or skip generation and omit
`--correspondence` when only dependencies are needed. From any directory, use real
absolute paths and immutable refs in place of these placeholders:

```sh
node /absolute/bygone/scripts/change-analysis/analyze-git.js HEAD_OID \
  --repo /absolute/review-repository --base BASE_OID --engine bygone-strand \
  --output /absolute/review-artifacts/symbols.json
bygone -C /absolute/review-repository tour context HEAD_OID --base BASE_OID \
  --dependencies --correspondence /absolute/review-artifacts/symbols.json \
  --output /absolute/review-artifacts/context.json
```

Check installed CLI capabilities; an already-built source checkout's
`node /absolute/bygone/bin/bygone.js` can replace `bygone` when needed. Missing
builds, parsers, or tooling are blockers to that analysis, not implicit permission
to install or rebuild Bygone. Continue independent review and report the gap.
The generator refuses to overwrite artifacts; use a new path after a revision
change rather than deleting or overwriting unrelated evidence.

Prefer the explicit Strand engine for edited/moved declarations. `--exact-only`
is a reduced fallback when Strand cannot run; record why it was used. An inventory
plus identical-byte matches does not supply equivalent rename/move evidence.

Inspect the combined context's `correspondence`, `dependencies`, and
`dependencyChanges`, progressively rather than dumping every source snapshot:

- Symbols: accepted relations, changed declarations, unmatched endpoints,
  ambiguity, diagnostics, engine status, and scope. The correspondence search is
  bounded to changed supported-language files; unchanged origins are not searched.
- Dependencies: changed calls/relationships, affected consumers, source sites,
  unresolved targets, omitted files, and budget/coverage diagnostics. Trace
  consequential consumers in surrounding source and tests beyond the diff.
  Inspect initialization and constructor sites, phase/loading labels, and
  resolution assumptions when present, particularly for import-time/startup
  changes. These labels describe static syntax, not observed execution order.
- Limits: preserve partial/unavailable analysis and unsupported inputs. Inferred
  correspondence is not behavioral equivalence; an unmatched symbol is not proof
  of addition/deletion; static affected-consumer counts are not runtime impact.

Retain a concise analysis outcome in the existing review or tour checks, including
the range, engine, artifact paths, and limits. Zero findings is distinct from
missing or partial analysis. These artifacts contain source: keep them local to
the reviewed project and out of reusable skills repositories and public uploads.

## Inspect supplied Evidence Review artifacts

If an existing or supplied artifact is a Bygone Evidence Review JSON, validate it
against its repository before reusing its conclusions:

```sh
bygone -C /absolute/review-repository evidence inspect /absolute/review-artifacts/review.json
```

Check its pinned comparison against the current review. Reconcile broken source
references, changed files without valid evidence, recorded executions, inspection
notes, and analysis limits. A valid link does not explain every change in that
file, and a recorded execution or inspection may not cover the current revision.
Keep deliberately historical evidence labeled as historical. This conditional
check does not require creating an Evidence Review artifact when none exists.

## Carry the evidence into a selected tour

Generating context alone does not enable Symbols in the reader. For the live
presentation, supply the artifact explicitly:

```sh
bygone -C /absolute/review-repository present \
  --tour /absolute/review-artifacts/review.bygone \
  --correspondence /absolute/review-artifacts/symbols.json
```

Print the concrete one-line command at handoff. Preserve `--correspondence` when
using the T3 Browser launch workflow. Verify Symbols is available, open a useful
symbol comparison, and check file-context/return navigation. Report untested UI
behavior; successful compilation alone does not establish that symbols are visible.

For authored symbol-focused stops, inspect the current schema (source version 6
or later). Set root `correspondence` to the artifact's repository-relative path;
it must be inside the reviewed repository, including after symlink resolution.
Use an untracked review-artifact directory there when needed; do not commit the
source-bearing artifact merely to use it. An outside-repository artifact can be
loaded with the presentation flag, but cannot back authored symbol stops.

A walkthrough step uses `symbol: { relation: RELATION_ID }` for an accepted match,
or `symbol: { symbol: SYMBOL_ID }` for an unmatched endpoint. Use actual IDs from
the artifact and retain the required `focus` anchor inside the selected declaration
on its revision side. Do not combine a symbol stop with image or connection
evidence. If both the source and the CLI specify correspondence, they must identify
the same actual file, not separate copies with equal bytes.

Live presentation loads source-declared correspondence automatically. Offline
HTML retains selected symbol stops and their full file contexts, but omits the
complete symbol inventory/browser. Retain the artifact and live command, disclose
that difference, and inspect selected stops in the actual delivered export. Do not
claim full offline symbol exploration or try to repair it through authoring prose.

Dependency context does not automatically become a graph inside the tour. Use its
evidence to choose claims and anchors. When a graph helps the reviewer, create and
link a separate artifact:

```sh
bygone -C /absolute/review-repository dependencies HEAD_OID --base BASE_OID \
  --html --output /absolute/review-artifacts/dependencies.html
```

Standalone dependency HTML shows static snapshot evidence; it does not expose
the correspondence loader or include the correspondence-aware change report.
Use the combined context's `dependencyChanges` for that analysis, or load the
matching symbol artifact in Bygone's native Dependencies viewer. Do not promise
the native loader in an offline HTML graph. Retain JSON for full bounded evidence;
diagrams can truncate nodes and edges.
