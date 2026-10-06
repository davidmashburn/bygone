# Links and portable HTML tours

## Local desktop links

Each title, chapter, scene, and step has a **Copy link** button. In a saved local
tour it copies a `bygone://open/v1` link to that document, authored mode, and
section ID. Open it with the installed desktop app, or choose **File → Open
Bygone Link from Clipboard**. Links require the repository at the same local
path; they do not clone repositories or find another checkout automatically.

These document links open the **current saved document**. A branch named in the
document may have moved since the link was copied. Use an HTML export when the
recipient must see a fixed snapshot. Missing documents, modes, or section IDs
produce an error rather than choosing a different step. Tour format v3 is
retired: remove its `review` block, set `version: 4`, and recompile.

**File → Copy Local Comparison Link** copies a two-revision comparison using
full commit IDs in panel order. These links preserve the evidence even when
branches move. The URL also supports an optional repository-relative `file`,
selected `revision`, and one-based `line`. Missing commits, files, or lines fail
before replacing the current comparison. Links open comparisons read-only.

The versioned URL fields are:

- Common: `kind=tour|compare`, `repo=<local file URL>`.
- Tour: `tour=<relative document path>`, `mode=historical|deconstructed`,
  `part=title|chapter|scene|step`, and the matching `chapter`, `scene`, or
  `scene` plus `step` IDs.
- Comparison: two ordered `rev=<full commit ID>` fields, with optional `file`,
  `revision`, and `line`. A line requires a file and selected revision.

## Export a saved tour

Choose **File → Export Tour as HTML…**, or run:

```sh
bygone tour export path/to/tour.bygone --output tour.html
bygone tour export path/to/tour.bygone --output tour-full.html --profile full
```

Existing output files require `--overwrite`. Export reads the saved tour and
committed Git evidence. It freezes referenced revisions once, packages all
authored modes, and leaves the source file unchanged.

| Profile | Included evidence | Exploration |
| --- | --- | --- |
| Minimal (default) | Authored modes and full files needed for the endpoint comparison | Tour navigation and fixed base → head comparison |
| Full | Minimal plus a bounded Git commit graph and scoped file snapshots | Included history and comparisons among included revisions |

Full includes the range's merge base, commits between it and the head, and
explicitly referenced tour revisions. Its path scope includes changed paths,
rename predecessors, and tour evidence paths. It preserves intermediate changes
that were reverted before the head. This is a read-only, Git-derived snapshot,
not a cloneable repository or an arbitrary Git command environment. Parents
outside the included set are unavailable. History diffs use the first parent;
comparisons use exact paths, so renames appear as deletion and addition.

Both profiles can contain full surrounding and deleted source code. Full also
includes commit authors and email addresses. Local repository bindings are
removed, but authored prose and paths remain. Inspect the output before sharing.
**Tour details** reports the packaged evidence and profile boundaries.

Initial Full limits are 256 revisions, 4,096 paths, 2 MiB per text file, and
64 KiB per line; the final HTML limit is 128 MiB. Binary/non-UTF-8 files,
submodules, Git LFS objects, and oversized files have explicit omission reasons.
Queries beyond the packaged scope fail rather than fetching replacement evidence.

## Viewer and internet access

The default embeds the viewer, styles, workers, licenses, and evidence in one
HTML file. Open it directly in a browser; no Bygone installation or local server
is required. Editing, local repository operations, and link previews are
unavailable. Narration uses only locally available system voices.

A smaller CDN variant can load viewer assets from an exact npm release on
jsDelivr. Evidence still lives in the HTML. It displays an internet-required
message and checks each asset against its build-time SHA-256 digest. There is no
fallback to a newer runtime. The matching export-enabled npm release must be
published first; ordinary exports do not assume that release exists.

For a verified published build, opt in with `--runtime cdn --runtime-base
https://cdn.jsdelivr.net/npm/@davmash/bygone@<exact-version>/`. The version must
match the exporting build. A missing, modified, or inaccessible asset produces a
loading error; an embedded export avoids that network dependency.

**Copy link** inside an export copies a browser URL with a semantic fragment.
Share the HTML separately. When the recipient stores it elsewhere, append the
fragment (starting with `#location=1`) to their file or hosted URL. Title,
chapter, scene, and step targets are mode-specific; unknown targets produce an
error. Exported evidence has a content digest for corruption detection, not a
digital signature or proof of authorship.
