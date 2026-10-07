# Bygone, one screen at a time

A 15-screen guided tour of comparisons, multiple panels, directories, search,
repository and file history, branch review, authored tours, explanation stages,
exploration, authoring, sharing, VS Code, and the CLI.

## Open the tour

From this checkout, build and use its CLI so the new image-step renderer is
available. The installed 0.9.9 release predates this feature.

```sh
npm run compile
BYGONE_FORCE_BUNDLED=1 node bin/bygone.js present --tour docs/visual-walkthrough/walkthrough.bygone
```

The command opens a local browser presentation on **Two files, one visual
comparison**. Read down the narrative or select each step in the outline;
each step replaces the evidence area with its screenshot. Next/Previous moves
through the 15 images, skipping the structural headings as separate stops.
Chapter and scene links open their first image, without a file inventory.
**Expand image** makes the screenshot larger; Escape closes it. The controls
inside a screenshot are illustrative, not interactive.

With this branch's build installed, the equivalent command is:

```sh
bygone -C /Users/davmash/code/bygone present --tour docs/visual-walkthrough/walkthrough.bygone
```

## Read or share without a presentation server

The [narrative](narrative.md) is the complete prose. Browse the
[screenshots](images/) alongside it, or export one portable HTML file:

```sh
node bin/bygone.js tour export docs/visual-walkthrough/walkthrough.bygone --output /tmp/bygone-visual-walkthrough.html --profile minimal --runtime embedded
```

Open that file in a browser. Its viewer and screenshots are embedded; it needs
neither internet nor a local repository. Use a fresh output path or add
`--overwrite` to regenerate it. Minimal is the useful default for this visual
guide; full export adds repository history that the screenshots do not need.

## Maintain the guide

The [outline](outline.md) records the scope. The
[capture record](captures.md) identifies the real UI state behind each image
and explains how to regenerate the demonstration repository and desktop images.
The prose was revised against the actual captures before building the tour.
The screenshots are unannotated; the prose and alt text supply the callouts.

`walkthrough.bygone` pins the image and prose commit, so later working-tree edits
cannot silently change its evidence. To revise it:

1. Edit the prose or recapture the images, inspect the results, and commit them.
2. Set `head` in `build-tour.mjs` to that commit's full SHA. Keep the base before
   the guide was added so its narrative anchors remain in the comparison.
3. Run `node docs/visual-walkthrough/build-tour.mjs` from the repository root.
4. Validate, compile, and inspect the presentation again:

```sh
node bin/bygone.js tour validate docs/visual-walkthrough/walkthrough.bygone
node bin/bygone.js tour compile docs/visual-walkthrough/walkthrough.bygone --output /tmp/bygone-visual-walkthrough.json
```

The repository keeps the PNG originals and authored source. Compiled manifests
and HTML duplicate the embedded images, so they are generated outside Git.

## Verification

Checked on macOS on 2026-10-06:

- Validated and compiled the authored source: four arcs, 15 image steps.
- Inspected every capture, then loaded all 15 steps in both the live presentation
  and the generated embedded HTML. The minimal HTML is approximately 24 MB.
- `npm test` passed, including the legacy suite and 136 Node tests.
- `npm run test:export-smoke` passed for ordinary tours and image evidence in
  both Minimal and Full exports, with network requests blocked. It checks image
  decoding, enlargement, Escape, Files → Return to tour, and code/Compare recovery.
- `npm run bundle:check` and `git diff --check` passed.
- ESLint passed for 142 checkout files with `tsconfigRootDir` explicitly set to
  this repository. Plain `npm run lint` encounters an unrelated nested worktree
  with another ESLint configuration; that worktree was excluded from this check.

Linux/Windows rendering, screen-reader interaction, and a packaged installation
of the new image renderer were not tested. The installed VS Code companion was
used for its screenshot; it was not rebuilt. The portable runtime was tested
embedded, not against a published CDN version.
