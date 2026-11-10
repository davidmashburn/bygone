# Bygone product tour — 0.13.1

[Open the 51-step tour](tour.html). Chapter 9 shows the reader: the introduction, the main path, one optional question, return or continue, checks, and related explanations. Chapter 10 opens **Git → Review Pull Request…** and stops before submit. Earlier chapters keep their 0.11.1 captures, and the dependency chapter keeps its 0.11.3 captures. Reader and pull-request screenshots were captured on 0.13.0. The YAML, compiled JSON, and standalone HTML were built with the 0.13.1 exporter.

The reader screenshots use a synthetic request handler. The sample test is shown and was not executed. The pull-request capture uses a synthetic two-commit history and does not fetch a pull request or build a version 2 review package. Use the viewer’s image enlargement control for small text.

## Restore exact evidence

Download evidence.bundle, tour.bygone.yaml, and manifest.json together. Verify the manifest hashes, then run:

```sh
git clone evidence.bundle evidence
git -C evidence checkout --detach 94e398ae86e15d46a997b895038868b4bf8e4510
cp tour.bygone.yaml evidence/tour.bygone.yaml
bygone -C evidence tour validate tour.bygone.yaml --json
bygone -C evidence present --tour tour.bygone.yaml
```

The bundle contains public synthetic documentation history, plus a nested demo bundle and correspondence fixture under public-guide/dependencies. The tour’s own range pins captions and captures, not the product implementation diff.

## Rebuild

From a compiled Bygone 0.13.1 source checkout:

```sh
node scripts/package-tour.cjs verify docs/tours/product/0.13.1
node scripts/package-tour.cjs build docs/tours/product/0.13.1/tour.bygone.yaml docs/tours/product/0.13.1/evidence.bundle docs/tours/product/0.13.1/provenance.json /tmp/rebuilt-product-tour-0.13.1
```

Use a new output directory. The build restores a fresh bundle clone and validates all source anchors before generating portable JSON and embedded HTML. See validation.json for packaging checks. Local preparation does not publish a release.

## Validation — 2026-11-10

Fresh bundle compilation resolved all 51 anchors. The package was built with the 0.13.1 exporter. The reader and pull-request captures are from Bygone 0.13.0 at `232f25b3c429bf29bcf7d7f2278a0aa83637b31e`. Visible page text in the new captures was checked for private filesystem paths. The sample test was not executed, and Review was not submitted.

The 0.11.1 and 0.11.4 packages were left in place. These checks do not establish runtime behavior of the older screenshots. Full product regression tests, CI, and hosted publication were not rerun.
