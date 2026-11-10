# Pinned evidence and live repair

Evidence Review connects a saved requirement to exact Git source, then offers an
explicit handoff to Bygone's existing synchronized VS Code editor. The saved
review stays pinned while you edit. This is an inspection aid: a valid source
reference, a passing recorded command, and a human inspection are separate facts.
None is an automatic approval or proof that a requirement is fulfilled.

## Authored-tour revision impact

An authored tour does not need imported requirements to inspect its evidence
after a revision. First save a compiled snapshot while its original range is
still current. Later, compare that snapshot to an explicit committed head:

```sh
bygone tour compile review.bygone --output original-tour.json
bygone tour impact original-tour.json --head HEAD --output impact.json
bygone tour impact original-tour.json --head HEAD --correspondence mappings.json
```

`impact` emits JSON and requires a new output file when `--output` is supplied.
Use `-C /path/to/repo` to bind the snapshot to another checkout containing the
same commits. The snapshot's SHA-256 digest identifies the exact input document.
Do not recompile the old document after its branch refs have moved: that would
capture a different baseline.

Step fragments identify locations in the original tour or its HTML export.
Evidence and changed-file links open pinned comparisons in the local Bygone app;
they require the bound checkout and its Git objects. These links do not recompile
the tour or change its saved baseline.

The report preserves the original base and head, resolves the requested head to
an immutable commit, and rejects rewritten or unrelated history. It follows
actual step references and connection endpoints; prose is not source evidence.
Head evidence is checked against the new head using the existing conservative
Strand mapping rules. Base and intermediate evidence remains historical.
Unsupported or unavailable evidence is explicitly incomplete. Unresolved
locations are not repaired by guessing nearby lines or matching names.

Observations distinguish unchanged, relocated, changed, missing, and incomplete
evidence, and expose new changes outside the cited evidence in the old-head →
new-head delta. This delta is separate from the original whole-tour comparison.
An unchanged quotation does not establish that its explanation or a recorded
check remains correct. Every new comparison requires renewed inspection.
The command leaves the original snapshot, authored prose, checks, and decisions
unchanged; it does not generate an updated tour automatically.

## Load and inspect

Use **Bygone: Open Evidence Review** in a trusted local VS Code workspace and
choose a version 2 review JSON file. The selected workspace binds the artifact to
a local repository. Bygone requires both immutable commits to exist there and
validates referenced text against Git; the repository label is descriptive, not
an authenticated remote identity. Dirty files are excluded from the review.

The view shows quoted source material, questions, valid and broken links,
recorded executions, inspection notes, analysis limits, and changed files with
no valid evidence link. A linked file can still contain unexplained changes.
Use **Pinned source** for the exact range or **Pinned file diff** for context.
Both are read-only. Deleted/missing counterparts remain historical evidence.

The CLI exposes the same inspection and refresh policy:

```sh
bygone -C /path/to/repo evidence inspect review.json
bygone -C /path/to/repo evidence import exported-review.json --output imported.json
bygone -C /path/to/repo evidence inspect imported.json --dependencies dependencies.json
bygone -C /path/to/repo evidence tour imported.json --output evidence.bygone
bygone -C /path/to/repo present --tour evidence.bygone
```

Import validates source references and removes carried inspection decisions.
The versioned review model is in `src/requirements.ts`. Old exports with only
branch names or timestamps cannot be imported as pinned evidence. All output
commands require new files; existing artifacts are never overwritten.

## Portable review packages

`scripts/package-tour.cjs` builds a self-contained tour package from a source
tour and Git bundle. Its optional fifth CLI argument is a directory containing
exactly the three review inputs `review.json`, `report.json`, and `report.md`:

```sh
node scripts/package-tour.cjs build tour.bygone evidence.bundle metadata.json package-dir review-dir
node scripts/package-tour.cjs verify package-dir
```

The JavaScript API accepts these paths as
`buildPackage(source, bundle, metadata, destination, { reviewArtifacts })`, where
`reviewArtifacts` maps those three filenames to input paths. Omitting this option
produces the existing version 1 package. Supplying it produces version 2 with a
separate `reviewArtifacts` inventory; every file's size and SHA-256 hash contributes
to the package identity. Input files are copied unchanged and must be regular
files. Existing output directories are never overwritten.

`review.json` is a version 2 Evidence Review produced by `bygone evidence import`.
Its base and head must match the packaged evidence. `report.json` has
`schemaVersion: 1`, `kind: "advisory-review"`, and a `capture` object: `mergeBase`
and `head` match the evidence endpoints, while `base` records the separately
captured base-branch tip as a full commit ID. `report.md` is the nonempty readable
rendering supplied by the producer. The package verifier checks this generic
envelope, revision binding, and byte integrity; the producer owns its full report
schema, findings, and agreement between JSON and Markdown. A valid package does
not establish that the review is complete or correct.

## Edit, return, refresh

**Edit working counterpart** maps the exact cited snapshot/range to the current
working document. Whole-declaration mapping uses existing Strand JS/TS analysis.
Identical file content can retain an exact range. Ambiguous mappings, partial
ranges in changed files, and unsupported syntax fall back to full-file context;
no match is inferred from a name or reused offset. Git-reported renames preserve before/after paths. An absent working counterpart
opens read-only historical source instead. **Edit working file** explicitly opens full-file
context without symbol mapping.

The left side is the cited immutable snapshot; the right side is the live VS Code
`TextDocument`. The existing version/range-guarded bridge owns edits, dirty state,
save, undo, and recovery. Staging remains VS Code Git's responsibility. Returning
with the **Return to Evidence Review** toolbar button or command restores the pinned review panel and
its scroll position while that panel remains open; a closed panel is recreated.
Editing or saving does not change its claims. Following's
**Resume** deliberately leaves the review snapshot and returns to ordinary HEAD
following.

After committing a repair, choose **Refresh to committed revision**. Supply a
validated correspondence artifact for old-head → new-head to relocate changed
whole declarations, or refresh unchanged files only and leave changed evidence
unresolved. The new head must descend from the captured head; rewritten or unrelated history
requires a separately imported review. The original PR baseline is preserved. A head delta is not a new
whole-PR comparison. New comparisons require renewed inspection, even if cited
bytes match; notes remain visible.

```sh
bygone evidence refresh review.json --head <new-commit> \
  --correspondence old-head-to-new-head.json --output refreshed.json
bygone evidence refresh review.json --head <same-commit> \
  --requirements edited-review.json --output reworded.json
bygone evidence tour refreshed.json --output refreshed.bygone
```

The requirement-only option takes the edited requirement array from a complete
review document with the same repository/base/head identity; its IDs must remain compatible with existing links/questions.
Regenerate a current tour after repairs. Keep deliberately historical tours and
reviews pinned. **Record inspection in new artifact** saves a fingerprint and
note, not approval, and never overwrites the source artifact.

## Producer boundary

Bygone consumes the version 2 review shape from compatible producers, including
the PR Reviewer bridge. Producers must capture immutable comparison identities
and retain the original source quotations in their saved snapshots. A later push
must not relabel historical evidence.

Unmapped anchors, producer-reported unexplained hunks, overflow counts, and
unavailable discussion capture are listed as limitations; producer assessments
remain rationale. Unexplained-change line labels are retained as unvalidated
producer context, not source anchors. File-level linked coverage does not
establish coverage of every hunk. Checklists, discussions, publication state,
and approvals remain in the producing system; they are not Bygone decisions or
execution records. Exports without immutable capture cannot be imported as pinned
evidence.

The producer receipt digest identifies the initial exported projection. Its hashing recipe is recorded in the analysis scope: replace that receipt digest with 64 zeroes, serialize sorted keys as compact UTF-8 JSON without ASCII escaping, then SHA-256. It is not authentication or a checksum of later review edits; refresh retains historical provenance.

## Dependency-guided inspection and limits

Load an existing `bygone dependencies` report for exactly the review's merge-base
and head. Navigation includes reported added/removed module edges, direct
unchanged consumers, and initialization sites, with phase, loading, and resolution labels.
Source ranges, content digests, blob IDs, and comparison identities are checked
against Git. Producer coverage, omissions, diagnostics, and assumptions remain
visible. Imported summaries must match all inventory identity fields. Validation
checks referenced file counts and bytes against reported coverage and declared
limits (up to 16 MiB per snapshot, 32 MiB across both), and applies the declared time budget to local validation/Git reads.
Records provide only a lower bound on producer input: files without sites and
resolver-only inputs are not reconstructible from the report, nor is the original
producer's elapsed time independently verifiable.

This is syntactic module evidence, not a semantic call graph or runtime trace.
Changing an imported binding within the same module can leave graph edges
unchanged. New TypeScript syntax/options, malformed package metadata, and input
budgets can limit resolution. No graph change is never proof of behavioral safety.

Hosts bound JSON/source sizes and refuse oversized or non-text evidence rather
than silently reporting it as complete. Live editing retains its existing
128 KiB/5,000-line limit. Remote workspaces and untrusted workspaces are not
supported by this first host. The web viewer explains when Symbols is unavailable
because no validated correspondence artifact was supplied.

Keep issue decisions, CI, approval, and merge in their existing systems. A review
can use ordinary diffs and equivalent source links; a tour is optional. Evidence
artifacts should be retained only when they help inspect, reproduce, or hand off
the review, not as a mandatory second task ledger.

## Verification record

Implementation was based on `dda37567` after the dependency validation work
landed. Local verification on 2026-10-26 covered:

- Bygone's legacy runner and all 503 Node tests, TypeScript checking, ESLint,
  bundle budgets, VSIX packaging, and npm packaging/dry-run. The staged npm CLI
  also inspected a real pinned review successfully.
- Producer interoperability: exported review → Bygone import → validated tour.
- A fresh Linux ARM64 Lima checkout: 9 evidence handoff checks, 29 SCM checks,
  and 16 original following checks on each of VS Code 1.74.0 and 1.143.1. These
  exercise the real Extension Host and Monaco, including dirty text, shared undo,
  intervening native edits, slice boundaries, index preservation, rename/missing
  counterparts, explicit refresh, and unsupported-symbol fallback.
  The evidence suite was repeated after the workflow fixes; the SCM/following
  results cover the unchanged editing bridges from earlier in this implementation.
  The final evidence rerun includes switching or closing the review while a real
  symbol worker is pending; a stale result cannot replace the comparison or its
  return context. Import rejects inconsistent file and unresolved-edge counters.

To rerun the handoff suite after compiling:

```sh
BYGONE_EVIDENCE_TEST=1 BYGONE_VSCODE_EXECUTABLE=/path/to/code \
  xvfb-run -a node scripts/test-following.mjs
```

A retrospective fixture for merged SCM repair `c7219ed0` validated one quoted
requirement and two exact implementation/test links, generated a pinned tour,
and left three other changed files explicitly uncovered. It recorded no test
execution or approval merely because the linked test exists. The same source
was inspected through an ordinary diff. The evidence view retains requirement,
range, and freshness context; no human review-time or comprehension advantage
was measured. This is a functional comparison, not a usability study.

Not verified here: live producer API/model runs, manual browser visual QA, Windows/macOS Extension Hosts, remote workspaces, or a human paired
review trial. No release was published by these checks.
