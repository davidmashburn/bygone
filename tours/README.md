# Bygone tour changelog

This directory records Bygone's release history as guided, code-connected tours. Each tour pins immutable Git endpoints, explains the major capability arcs, and leaves the complete changed-file set available in the Files rail.

| Release line | Range | Tour | Scope |
| --- | --- | --- | --- |
| Matcher refinement | `1d65666..fa0ba84` | [`diff-matching.bygone.yaml`](./diff-matching.bygone.yaml) | Structural declaration anchors and conservative contextual matching |
| 0.6 | `v0.5.2..e6e3e05` | [`v0.6.bygone.yaml`](./v0.6.bygone.yaml) | Multi-pane comparison, diff correctness, Git review, distribution, and the PR Tour Guide |

Run the latest tour from the repository root:

```sh
bygone present --tour tours/diff-matching.bygone.yaml
```

The 0.6 tour covers 54 commits and 105 changed files. Its bounded agent context excludes 16 binary assets, the package lockfile, and the generated browser source map from patch evidence. The compiled presenter independently keeps every path visible: binary assets and generated maps that cannot be rendered as text appear as disabled entries with their omission reason.
