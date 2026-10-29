# Bygone product tour — capture 0.11.1

[Open the tour](tour.html), or download `tour.html` and open it in your browser.
The HTML contains its viewer and images; it needs neither Bygone nor internet access.

This guide has 38 steps across eight chapters. The original VS Code sequence,
including before/action/result/next captions, is preserved. Screenshot code and
review data are synthetic. The image paths under `/Users/Shared/bygone-vscode-demo`
refer to the synthetic demo, not a personal checkout. Small UI text can be enlarged
with the viewer's image control.

The capture is **0.11.1**; the exporter is **0.11.2 with image deduplication**.
`manifest.json` records the exporter implementation/runtime hashes and the artifact
hashes. `validation.json` states exactly what packaging verified. This is screenshot
documentation history, not the product's implementation diff.

## Restore exact evidence

Download `evidence.bundle`, `tour.bygone.yaml`, and `manifest.json` into one directory.
Verify the SHA-256 values in the manifest, then run:

```sh
git clone evidence.bundle evidence
git -C evidence checkout --detach 5ee7ff3362dd779de8b1cc08c3f769d7443ace6f
cp tour.bygone.yaml evidence/tour.bygone.yaml
bygone -C evidence tour validate tour.bygone.yaml --json
bygone -C evidence present --tour tour.bygone.yaml
```

Base: `cc7dbd61b9552976f884457d43eba3a76c659306`.
Head: `5ee7ff3362dd779de8b1cc08c3f769d7443ace6f`.
The public bundle contains only the baseline README and product captions/images.

## Rebuild from a Bygone source checkout

Install the checkout's dependencies and run `npm run compile`. From that checkout:

```sh
node scripts/package-tour.cjs verify docs/tours/product/0.11.1
node scripts/package-tour.cjs build docs/tours/product/0.11.1/tour.bygone.yaml docs/tours/product/0.11.1/evidence.bundle docs/tours/product/0.11.1/provenance.json /tmp/rebuilt-product-tour
```

Use a new output directory. The builder restores a fresh clone, validates anchors,
compiles the JSON, and exports embedded HTML. Identical inputs and exporter assets
produce the same artifact hashes; changing the build creates a new package identity.
The compiled JSON keeps the existing Bygone format (and repeated images) for
compatibility. Its `repository.root` is normalized to `.`; for repository-backed
operations, regenerate from YAML in the restored evidence checkout. The HTML has
no repository binding. No global installation, publication, or release is performed.
