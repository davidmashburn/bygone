# Public Bygone tour documentation and hosting

## Status and authorization

Finalized proposal, 2026-10-28. Implementation and publication remain pending.
No repository creation, commits, pushes, or deployment is authorized by this document.
This plan covers only the public Bygone product tour and its documentation host.

Implementation starts from current `main`, never this orphan planning branch.
The inspected baseline is `2f42541aaa801ed0cbbd0ba467ac0f9b00fe7161` (0.11.2).
The existing showcase records 0.11.1; preserve that capture version even when a
newer exporter builds the deliverables. Refresh main and recheck the exporter
before implementation because other development is active.

## Outcome and decisions

Readers can open the public Bygone product tour online, or download canonical YAML,
compiled JSON, standalone HTML, and reproducible evidence from the documentation.
Use `docs/tours/product/` for the source of truth. Host on the Bygone project GitHub
Pages site, with intended route `https://www.davmash.com/bygone/`, subject to checking
the inherited custom-domain behavior. Preserve the owner's existing root site and DNS.

## Evidence and constraints

The product tour contains 38 slides in chapters 1–8. Preserve the revised VS Code
sequence and its action/transition explanations. A product-only HTML slideshow exists,
but a clean product-only Bygone source and export still need producing.

Removing other chapters from the combined source is insufficient: prior investigation
found unrelated files still present in the compiled evidence manifest. Public packaging
must use a separate public-only evidence repository/range, not narrative filtering.
These are inherited investigation results; this planning change did not rerun exports
or browser tests.

## Delivery sequence

### 1. Prepare public artifacts locally

Inventory the product source, screenshots, captures, slideshow metadata, and evidence
refs. Record hashes, capture/exporter versions, ordering, and reproduction inputs.
Create clean public-only evidence history with synthetic examples. Inspect every
capture, caption, code snapshot, Git object, filename, and generated manifest for
private content, including intermediate commits intended for publication.

Convert the product source to actual YAML and validate step IDs, ranges, anchors,
and equivalent rendering. Produce:

- canonical `tour.bygone.yaml`;
- compiled `tour.json` without machine-specific paths;
- standalone embedded-viewer `tour.html` that works offline;
- public evidence bundle and manifest with refs and SHA-256 hashes;
- README with browser, download, restore, and local presentation instructions.

Use an explicit reproducible path-sanitization step where the compiler exposes local
repository roots; verify that sanitization preserves the viewer contract.

### 2. Put the public tour into Bygone documentation

Use `docs/tours/product/` for the canonical YAML and requested generated JSON and
HTML, plus provenance and rebuild instructions. Keep source assets/evidence
available through a reproducible bundle. Avoid also committing redundant raw
captures and ZIP copies without a concrete need.

Add a documentation landing page with **View tour**, **Download HTML**, **Tour
YAML**, **Compiled JSON**, and **Local source/evidence** links. Preserve readable
screenshots, clear action transitions, and keyboard navigation at ordinary laptop
sizes. Link the tour from the main README/documentation entry point.

Measure and address repeated embedded image payloads before committing oversized
generated files. Prefer a bounded exporter improvement that deduplicates identical
image bytes while preserving every endpoint and offline behavior. If a format
change is needed, make its compatibility explicit and test older exports. Do not
turn this into a general asset-storage redesign. Separate this code change from
the documentation change so both are reviewable.

Prepare an explicit-allowlist Pages build that includes only approved public
documentation and assets. Use a stable landing URL and versioned tour directories;
keep historical URLs working. Confirm the project path and inherited custom-domain
behavior without changing the owner's existing root site or its DNS.

### 3. Acceptance and rollout

| Area | Required evidence |
| --- | --- |
| Public boundary | Full content/image/history audit; only approved public inputs in YAML, JSON, HTML, bundle, and Pages output |
| Artifact fidelity | All product steps, correct order, readable screenshots, clear transitions, working anchors/navigation |
| Reproducibility | Fresh-directory bundle restore, pinned refs, source validation, generated outputs with recorded hashes |
| Portability | HTML opens offline without localhost, repository paths, external fonts, or a running Bygone process |
| Browser behavior | Desktop Chrome and another browser; laptop viewport; resize, back/deep links, downloads, keyboard navigation |
| Host | Correct custom-domain subpath, no root-site regression, historical links preserved, correct missing-file 404s |
| Size/performance | Record bytes and first usable load under a stated network condition; address image duplication or document measured tradeoffs |

Review the documentation, exports, and hosting configuration together before rollout.
Publish only after approval. Keep source and rollback instructions with the destination.
No package release is implicit; any exporter change gets its own release decision.

## Boundaries and confidence

This is product documentation and static hosting work. Preserve existing tour content
unless fidelity or privacy requires correction. Avoid a general asset-storage redesign.
Confidence is high in the separate public evidence approach; actual export fidelity,
privacy, file sizes, and Pages behavior remain acceptance checks.

## Related plans

- [Self-contained HTML tours](self-contained-html-tours.md)
- [Smaller product-tour version patches](product-tour-patch-size.md)
- [Deep links](deep-linking.md)
- [Tour orientation and narrative framing](tour-orientation-and-narrative-framing.md)
