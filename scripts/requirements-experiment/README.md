# Requirements evidence experiment

A local, non-LLM experiment in requirements-to-evidence bookkeeping. It is not a
published requirements package or an exposed Bygone UI feature. All example requirements and code
are synthetic. No PR Reviewer data or code is imported.

From the repository root:

```sh
npm run compile
node scripts/requirements-experiment/run.cjs
```

The root build compiles Bygone's requirements module. The runner tests that module
and Strand's source-reference API, then creates a
temporary Git repository with a baseline and three review states. It prints the
output directory, a standalone interactive HTML report, and three `.bygone` tours.
Open the HTML file directly, or inspect a tour using this checkout's CLI:

```sh
node bin/bygone.js present --tour /absolute/path/from/output/initial.bygone
```

The demo runs real Strand analysis, validates its artifacts against Git, and
compiles the tours with Bygone's existing compiler. It executes one fixed synthetic
test at the initial and final revisions. The initial test passes; the intentional
regression fails. Logs and their SHA-256 digests are retained. It makes no network
or model calls, installs nothing, and does not commit changes in this repository.
Remove the printed temporary directory when finished.

## What to inspect

- **Initial review:** implementation and test source link to R1; a real passing
  execution is recorded. The reviewer note/decision is explicitly simulated.
- **After a move:** Strand relocates the whole declaration. Notes survive, but
  inspection and test execution do not carry forward to the new head.
- **After a regression:** Strand follows an edited declaration. The linked test
  reruns and fails. The core reports the result without inferring fulfillment.
- **Missing coverage:** R2 has no evidence. An unrelated CSS file has no links.

The JSON review files are examples of the authored input format. In
`src/requirements.ts`, `parseReview`
accepts unknown JSON and validates it; `inspect` resolves evidence and computes
queues. `correspondenceEvidence` keeps accepted declaration pairs together with
their analysis receipt (range, producer, scope, status, limitations, and digest of
the validated artifact's JSON serialization). The host must validate the artifact
against Git first. `refresh` consumes that evidence bundle, checks its range, and
retains the receipt. Omit the bundle when no analysis was performed. It delegates source pinning/resolution/relocation to
`bygone-strand/source-references`, whose revision identifiers are opaque. Bygone
owns the Git revision constraint, requirements and provenance, evidence roles,
test records, reviewer fingerprints, and preservation of baseline evidence.
Bygone scopes the snapshots passed to Strand to the referenced paths and supplied
correspondence endpoints; unrelated files stay available for changed-file coverage
without consuming Strand's analysis budget. Requirement-only updates at the same
revision retain evidence and notes, recheck reference validity, and invalidate
inspection when the requirement changes. They accept no correspondence pairs.
The experimental format is now **version 2**; version 1 is rejected rather than
silently assigning its old test associations to the current requirement meaning.
Requirements retain multiple quoted source snapshots. Structured questions retain
competing interpretations and their sources, and an explicit resolution when one
is recorded. The core never chooses an interpretation.

Each run association records a requirement fingerprint and a human-authored scope
describing what the test actually checked. Changing a requirement, its provenance,
or an associated question makes the association stale even at the same Git head.
The execution outcome remains intact; inspection reports `needs-reassessment`
when only stale associations exist at this head. A newly recorded association can
explicitly reassess the same execution, without rewriting the historical one.
Other requirements' edits do not invalidate this association. A pass does not
resolve open questions or prove the whole requirement.

Fingerprints use the schema's field order, so equivalent authored objects retain
their test applicability and reviewer decisions after saving and reloading.
Object property order and discarded unknown fields do not affect the fingerprint;
array order and all retained evidence content still do. Existing version 2 hashes
computed from parsed reviews remain valid. Previously recorded hashes from
unnormalized objects may require explicit reassessment; they are not auto-approved.

Reports retain all analysis receipts with their ranges: a complete incremental
analysis cannot erase a partial baseline analysis or its budget warning.
`current-comparison`, `current-head-delta`, and `historical` distinguish relevance;
there is no inferred overall completeness. An empty analysis list means none was
recorded. The HTML report exposes questions, test scopes/applicability, and analysis
limits alongside evidence.
Both modules perform no I/O; the demo owns Git, test execution, persistence, and
tour generation. No classes or model backend abstractions are needed.

## Experimental limits

- Snapshots are supplied by the host; the demo reads committed Git blobs. The core
  checks matching repository/revision identities and slice digests, but cannot
  independently authenticate a host-provided snapshot or claimed test run.
- Coordinates are zero-based, half-open UTF-16 offsets. Relocation follows only
  complete matched declarations. Unmatched or ambiguous references stay historical
  and unresolved; there is no fuzzy subrange migration.
- Source provenance preserves original text and checks quotations. It cannot prove
  that a paraphrased requirement accurately represents that source.
- Every new comparison requires renewed inspection, including unchanged local
  evidence. Caller/dependency changes are not semantically analyzed.
- Runs are author-associated with requirements; a passing run does not establish
  that the test proves those requirements. Linked test source is separate from a run.
- Coverage is file-level linkage, never hunk coverage or a fulfillment percentage.
- The tour exports linked evidence and mentions gaps in prose; the HTML report
  retains the full gap and lifecycle view. There is no native requirements panel,
  authoring UI, external importer, or stable package API yet.

The requirements module is compiled with Bygone and its tests run in the root
suite. The synthetic demo and HTML renderer remain under this experiment directory.
Strand's reference API has its own package tests. No dependency or workspace
registration was added, and no new requirements package was created.
