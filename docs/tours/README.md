# Product tours

[View the product guide](product/0.11.4/tour.html) · [Version 0.11.4 artifacts](product/0.11.4/README.md)

The 44-step guide adds native dependency exploration in chapter 8. [The previous 0.11.1 capture](product/0.11.1/tour.html) remains available.

The guide covers Bygone itself, using synthetic code and public-only screenshot
evidence. The canonical YAML, ordinary compiled JSON, standalone HTML, and Git
bundle live together in each version directory. Do not overwrite a published
version: add a version directory and retain earlier entries in `releases.json`.
The pinned package digest prevents an accidental replacement during site builds.

See [local validation and remaining hosting checks](validation.md).

## Prepare GitHub Pages

```sh
npm run compile
node scripts/build-tour-site.cjs /tmp/bygone-pages
python3 -m http.server 8765 --bind 127.0.0.1 --directory /tmp/bygone-pages
```

The build copies an explicit allowlist, not the repository or all of `docs/`.
All links are relative so the same output works at `/bygone/` on a project site.
The intended address is `https://www.davmash.com/bygone/`; enable GitHub Pages with
GitHub Actions and verify the inherited custom domain before publishing. No CNAME
or root-site/DNS changes are part of this build.

The `Tour documentation` workflow is manual. Its default only builds an artifact;
setting `publish` deploys to Pages and requires a separate publication decision.
The download artifact is a build handoff, not a durable hosting substitute. Pages
serves the committed versioned files, including the offline HTML and bundle.

Keep prior version directories in subsequent deployments. To roll back the landing
page, restore its earlier contents without deleting released versions. Unknown
paths return the host's 404 response; there is no SPA fallback to another tour.
