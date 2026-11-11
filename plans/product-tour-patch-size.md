# Smaller product-tour version patches

Status: Proposed, 2026-11-10. Not authorized to implement by this document.

Implementation starts from `main`, never this orphan planning branch.
Inspected baseline: `22c04fd8ae8eac0234c5a7441de39acc6feca369` (0.13.2).
The working tree on that checkout was clean after the two commits below.
No uncommitted implementation work is part of this proposal.

## Goal

A product-version patch that does not change the product guide should not
rewrite the published tour package. A later edit to the guide's text should
change the text, not tens of megabytes of screenshots.

## Context

`22c04fd8` (`docs(tours): label the product guide 0.13.2`) renamed
`docs/tours/product/0.13.1` to `0.13.2` and replaced the title strings. Git
showed that as a 99% rename: four lines in `tour.json` and six in `tour.html`.
The committed `tour.json` is still 55,009,492 bytes and contains 153
`data:image/png;base64` payloads. GitHub warned on the push that the file is
52.46 MB, over its 50 MB recommended maximum. `tour.html` is 24,330,803 bytes
for the same reason. `evidence.bundle` did not change.

The label edit itself was a streaming replace of `Bygone 0.13.1` plus a
manifest rehash. `node scripts/package-tour.cjs verify` passed. The screenshots
remain the 0.13.0 captures, and the embedded viewer `runtimeVersion` stayed
`0.13.1` because the package was not rebuilt. `docs/tours/README.md` on `main`
now records that procedure. It is fast for a person or script. It is not a
small Git patch, because any byte change stores a new copy of the inlined
images.

The same rename also drops the previous version directory. `1fadd131` did that
from 0.13.0 to 0.13.1, and `22c04fd8` did it again. The hosting plan asks for
versioned directories and stable historical URLs. These label renames break
the previous patch's path.

## Proposed approach

Use two different changes. They solve different edits.

1. **Leave the published directory in place when the guide text did not
   change.** A release-label bump updates `package.json`, the changelog, and
   the landing-page note that names the product version. It does not rename
   `docs/tours/product/<version>/`, retitle `tour.json`, or rehash the package.
   The directory name stays the version of the guide content. `releases.json`
   can record which product version still uses that guide. Old links keep
   working.

2. **Keep screenshots out of `tour.json` when the guide text does change.**
   The compiled JSON should hold the narrative, anchors, and image references.
   The PNG bytes should live once beside it, or already inside `evidence.bundle`
   if that object is the stored capture. A title or sentence edit then changes
   the JSON text. Offline `tour.html` can keep embedding those bytes: the
   one-file HTML contract in the HTML-export plan stays intact. This slice is
   only the committed JSON package, not a new asset store for every export.

Do the directory rule first. It needs no format change and it is the case
that just rewrote 55 MB for two title strings. Split the screenshots out of
`tour.json` when the next real guide edit needs it, or before the next label
rename if the directory rule is rejected.

## Scope and non-goals

Included:

- The public product-tour package under `docs/tours/product/`.
- `docs/tours/releases.json`, `docs/tours/site/index.html`, and the short
  relabel note in `docs/tours/README.md`.
- The compiled `tour.json` image embedding, only if the second slice is chosen.

Not included:

- Rebuilding or recapturing the 0.13.0 screenshots.
- Changing `tour.html` away from a single offline file.
- A general asset pipeline for other tours, the VS Code package, or the desktop app.
- Deduplicating repeated image bytes inside one file. The hosting plan already
  asks to measure that. This plan does not replace that measurement.
- Publishing GitHub Pages or changing DNS.

## Risks and decisions

The open choice is whether a patch version's public URL must equal the package
version. The 0.13.1 and 0.13.2 commits assumed it must, and renamed the
directory. This plan proposes the opposite for a label-only patch: the URL
names the guide, and the product version is recorded next to it. If that
assumption is rejected, only the screenshot split makes a retitle small.

`package-tour.cjs verify` hashes `tour.json` as one artifact. Moving image
bytes changes that inventory. Older published directories stay byte-identical;
the new layout applies to the next package that needs a text edit. The hosting
plan already says a format change must name its compatibility and must not
become a general asset-storage redesign.

Leaving `runtimeVersion` and `exporter.version` unchanged during a label edit
was deliberate in `22c04fd8`. A future retitle should keep doing that unless
the exporter actually ran.

## Next steps

1. Decide whether the guide directory may stay put across patch releases.
2. If yes, adjust the relabel note on `main` so the next bump does not rename
   `docs/tours/product/0.13.2`. Record the product version separately from the
   directory name.
3. If a text edit or a required retitle still has to touch `tour.json`, replace
   the 153 inlined PNG data URLs with references and re-verify the package.
   Compare the resulting blob size with 55,009,492 bytes.
4. Do not implement either slice from this branch.

## Related plans

- [Public Bygone tour documentation and hosting](tour-library-and-hosting.md)
- [HTML tour exports](self-contained-html-tours.md)
