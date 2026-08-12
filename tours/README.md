# Bygone tour changelog

This directory records Bygone's release history as guided, code-connected tours. Each tour pins immutable Git endpoints, explains the major capability arcs, and leaves the complete changed-file set available in the Files rail.

| Release line | Range | Tour | Scope |
| --- | --- | --- | --- |
| 0.7 | `v0.6.3..a18023f` | [`v0.7.bygone`](./v0.7.bygone) | Multi-panel and Git review, guided tours, matcher correctness, and distribution |
| Matcher refinement | `1d65666..fa0ba84` | [`diff-matching.bygone`](./diff-matching.bygone) | Structural declaration anchors and conservative contextual matching |
| 0.6 | `v0.5.2..e6e3e05` | [`v0.6.bygone`](./v0.6.bygone) | Multi-pane comparison, diff correctness, Git review, distribution, and the PR Tour Guide |

Run the latest tour from the repository root:

```sh
bygone present --tour tours/v0.7.bygone
```

The 0.7 tour covers 54 commits and 110 changed files. Its bounded context omits 13 binary assets plus the package lockfile and two generated source maps from patch evidence; the complete file rail retains every path and its omission reason.

The 0.6 tour covers 54 commits and 105 changed files. Its bounded agent context excludes 16 binary assets, the package lockfile, and the generated browser source map from patch evidence. The compiled presenter independently keeps every path visible: binary assets and generated maps that cannot be rendered as text appear as disabled entries with their omission reason.
