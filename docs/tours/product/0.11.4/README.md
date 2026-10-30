# Bygone product tour — dependency update 0.11.4

[Open the 44-step tour](tour.html). Chapter 8 adds seven native desktop captures: committed comparisons, file relationships, calls, module initialization, pinned source outside the diff, correspondence-backed call changes, and coverage. These dependency captures were recorded with 0.11.3; the other chapters retain their 0.11.1 captures. The YAML, compiled JSON and standalone HTML package is rebuilt with the 0.11.4 exporter.

The screenshots use synthetic code. The Python example is statically parsed, not executed. Its supplied correspondence is explicitly authored for the fixture. The guide does not demonstrate runtime tracing, exhaustive resolution or every language adapter. Use the viewer’s image enlargement control for small text.

## Restore exact evidence

Download evidence.bundle, tour.bygone.yaml and manifest.json together. Verify the manifest hashes, then run:

```sh
git clone evidence.bundle evidence
git -C evidence checkout --detach 7f061595bd4cc0065abd068f7e8fd036de6bce6a
cp tour.bygone.yaml evidence/tour.bygone.yaml
bygone -C evidence tour validate tour.bygone.yaml --json
bygone -C evidence present --tour tour.bygone.yaml
```

The bundle contains public synthetic documentation history, plus a nested demo bundle and correspondence fixture under public-guide/dependencies. Its README gives the exact demo range and reproduction commands. The tour’s own range pins captions and captures, not the product implementation diff.

## Rebuild

From a compiled Bygone source checkout:

```sh
node scripts/package-tour.cjs verify docs/tours/product/0.11.4
node scripts/package-tour.cjs build docs/tours/product/0.11.4/tour.bygone.yaml docs/tours/product/0.11.4/evidence.bundle docs/tours/product/0.11.4/provenance.json /tmp/rebuilt-product-tour-0.11.4
```

Use a new output directory. The build restores a fresh bundle clone and validates all source anchors before generating portable JSON and embedded HTML. See validation.json for packaging checks and the checks below for capture and viewing evidence. Local preparation does not publish a release.

## Validation — 2026-10-30

Fresh bundle compilation resolved all 44 anchors; package hashes and the two-version public site build passed. Native capture assertions exercised file/symbol and phase filters, pinned read-only source navigation outside the diff, and validated synthetic correspondence (one added, one removed, four unclassified calls). HTML, Mermaid and dependency-aware authoring-context exports completed. In the browser, all seven new step links loaded their images; call-graph narration and image enlargement were visually inspected.

The public evidence history and captions were reviewed for private workflow material; the new screenshots contain synthetic examples. Existing 0.11.1 files remain unchanged. These checks do not establish runtime behavior. VS Code graph interactions, Go/Rust/Mojo captures, full product regression tests, CI and hosted publication/access checks were not rerun for this documentation-only update.
